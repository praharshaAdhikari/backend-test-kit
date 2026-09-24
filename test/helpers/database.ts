import type { Pool } from 'mysql2/promise';

/**
 * The test database, for integration tests (*.int-spec.ts, *.e2e-spec.ts). Only available when
 * running `npm run test:integration`: test/setup/global-setup.ts creates it.
 */

let pool: Pool | undefined;

/** A connection pool to the test database, for arranging data and checking results. */
export function testDb(): Pool {
  if (!pool) {
    const raw = process.env.TEST_DB;
    if (!raw) {
      throw new Error(
        'No test database. Integration tests run with `npm run test:integration`, and need ' +
          'needsDatabase = true in test/setup/project.ts.'
      );
    }
    const { host, port, user, password, database } = JSON.parse(raw);
    // Imported here, not at the top, so unit tests never load mysql2.
    const { createPool } = require('mysql2/promise') as typeof import('mysql2/promise');
    pool = createPool({ host, port, user, password, database, connectionLimit: 2 });
  }
  return pool;
}

/**
 * Puts the database back to how the migrations left it: every table emptied except the
 * migration ledgers (project.ts keepTables), and tables the migrations seeded trimmed back to
 * their seeded rows. Call it in beforeEach so every test starts from the same state.
 *
 * Seeded rows are trimmed, not restored: tests must not edit them. Create your own rows.
 */
export async function resetDatabase(): Promise<void> {
  const conn = await testDb().getConnection(); // one session: FOREIGN_KEY_CHECKS is per session
  try {
    const keep: string[] = JSON.parse(process.env.TEST_DB_KEEP_TABLES ?? '[]');
    const [[seed]] = await conn.query<import('mysql2').RowDataPacket[]>(
      'SELECT ranges FROM test_kit_seed LIMIT 1'
    );
    const seeded: Record<string, number> = seed?.ranges ?? {};
    const [tables] = await conn.query<import('mysql2').RowDataPacket[]>(
      `SELECT table_name AS name FROM information_schema.tables
        WHERE table_schema = DATABASE() AND table_type = 'BASE TABLE'`
    );
    await conn.query('SET FOREIGN_KEY_CHECKS = 0');
    // DELETE, not TRUNCATE: on the small tables tests create it is much faster.
    for (const { name } of tables) {
      if (keep.includes(name) || name === 'test_kit_seed') continue;
      if (name in seeded) {
        await conn.query(`DELETE FROM \`${name}\` WHERE id > ?`, [seeded[name]]);
      } else {
        await conn.query(`DELETE FROM \`${name}\``);
      }
    }
    // Delete triggers (audit logs) may have written rows into tables the first pass had already
    // emptied. A second pass clears those; it fires nothing new, as the other tables are empty.
    for (const { name } of tables) {
      if (keep.includes(name) || name === 'test_kit_seed' || name in seeded) continue;
      await conn.query(`DELETE FROM \`${name}\``);
    }
  } finally {
    await conn.query('SET FOREIGN_KEY_CHECKS = 1');
    conn.release();
  }
}

/** Closes the pool. jest.setup.ts calls this after each test file, so Jest can exit. */
export async function closeTestDb(): Promise<void> {
  await pool?.end();
  pool = undefined;
}
