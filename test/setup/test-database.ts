import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { Connection, RowDataPacket } from 'mysql2/promise';

interface TableRow extends RowDataPacket {
  name: string;
}

interface MaxIdRow extends RowDataPacket {
  maxId: number | null;
}

/** Where the test database is. Passed to project.ts's migrate() and appEnv(). */
export interface TestDatabase {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
  /** mysql://user:password@host:port/database, for ORMs that take a URL (Prisma, ...). */
  url: string;
}

/** A connection to the test database that can run files with many statements. */
export async function connect(db: TestDatabase): Promise<Connection> {
  const { createConnection } = await import('mysql2/promise');
  const { host, port, user, password, database } = db;
  return createConnection({ host, port, user, password, database, multipleStatements: true });
}

/**
 * MySQL clients do not understand the `DELIMITER` command that dump files and trigger scripts
 * use; the server only needs each statement once. Strips it and turns `END //` back into `END;`.
 */
export function withoutDelimiters(sql: string): string {
  return sql
    .replace(/\r\n/g, '\n')
    .replace(/^\s*DELIMITER\s+\S+\s*$/gim, '')
    .replace(/\bEND\s*(\/\/|\$\$)/gi, 'END;')
    .trim();
}

/**
 * Runs every `.sql` file in `dir` (relative to the project root), in name order, skipping
 * rollbacks (`*rollback*`, `*down*`). For projects whose migrations are plain numbered SQL files.
 */
export async function runSqlFiles(db: TestDatabase, dir: string): Promise<void> {
  const folder = resolve(__dirname, '..', '..', dir);
  const files = readdirSync(folder)
    .filter(name => name.toLowerCase().endsWith('.sql') && !/rollback|[._-]down\./i.test(name))
    .sort((a, b) => a.localeCompare(b));
  const conn = await connect(db);
  try {
    for (const file of files) {
      const sql = withoutDelimiters(readFileSync(join(folder, file), 'utf8'));
      if (!sql) continue;
      try {
        await conn.query(sql);
      } catch (error) {
        throw new Error(`Migration ${dir}/${file} failed on an empty database: ${(error as Error).message}`);
      }
    }
  } finally {
    await conn.end();
  }
}

/**
 * { table: highest id } for every table that has rows straight after migrating: seed data such
 * as lookup tables. resetDatabase() trims those tables back to these rows instead of emptying
 * them. Worked out once on the fresh database and stored in it (test_kit_seed), because a reused
 * container also holds rows the previous run's tests left behind.
 */
export async function recordSeededRows(db: TestDatabase, keepTables: string[]): Promise<void> {
  const conn = await connect(db);
  try {
    await conn.query('CREATE TABLE IF NOT EXISTS test_kit_seed (ranges JSON NOT NULL)');
    const [[saved]] = await conn.query<RowDataPacket[]>('SELECT 1 FROM test_kit_seed LIMIT 1');
    if (saved) return;

    const [tables] = await conn.query<TableRow[]>(
      `SELECT t.table_name AS name FROM information_schema.tables t
         JOIN information_schema.columns c
           ON c.table_schema = t.table_schema AND c.table_name = t.table_name AND c.column_name = 'id'
        WHERE t.table_schema = DATABASE() AND t.table_type = 'BASE TABLE'`
    );
    const ranges: Record<string, number> = {};
    for (const { name } of tables) {
      if (keepTables.includes(name) || name === 'test_kit_seed') continue;
      const [[row]] = await conn.query<MaxIdRow[]>(`SELECT MAX(id) AS maxId FROM \`${name}\``);
      if (row.maxId !== null) ranges[name] = Number(row.maxId);
    }
    await conn.query('INSERT INTO test_kit_seed (ranges) VALUES (?)', [JSON.stringify(ranges)]);
  } finally {
    await conn.end();
  }
}
