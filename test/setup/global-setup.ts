import { MySqlContainer } from '@testcontainers/mysql';
// Loaded through global-setup.cjs, which makes the `.js` imports below find the .ts files.
import { appEnv, keepTables, migrate, mysqlArgs, mysqlImage, needsDatabase } from './project.js';
import { recordSeededRows, type TestDatabase } from './test-database.js';

/**
 * TESTCONTAINERS_REUSE_ENABLE=true keeps the container between runs: startup drops from about
 * 20 seconds to 2. Its data survives, which is fine: migrations skip what is applied (if the
 * project's migrate() does; plain SQL files must be re-runnable), and tests reset in beforeEach.
 */
const reuse = process.env.TESTCONTAINERS_REUSE_ENABLE === 'true';

/**
 * Once per `jest` run, before any test file: starts MySQL in Docker, builds the schema with
 * project.ts's migrate(), and sets the environment so the app and the test helpers find it.
 */
export default async function globalSetup(): Promise<void> {
  if (!needsDatabase) return; // project.ts: this service has no database of its own
  const started = Date.now();
  const builder = new MySqlContainer(mysqlImage)
    .withDatabase('app_test')
    .withUsername('app')
    .withUserPassword('app')
    .withCommand(mysqlArgs);
  const container = await (reuse ? builder.withReuse() : builder).start();

  const db: TestDatabase = {
    host: container.getHost(),
    port: container.getPort(),
    user: 'app',
    password: 'app',
    database: 'app_test',
    url: `mysql://app:app@${container.getHost()}:${container.getPort()}/app_test`
  };

  await migrate(db);
  await recordSeededRows(db, keepTables);

  Object.assign(process.env, appEnv(db), {
    TEST_DB: JSON.stringify(db),
    TEST_DB_KEEP_TABLES: JSON.stringify(keepTables)
  });
  (globalThis as { __TEST_MYSQL__?: unknown }).__TEST_MYSQL__ = container;
  console.log(`\nTest MySQL ready at ${db.host}:${db.port} (${((Date.now() - started) / 1000).toFixed(1)}s)`);
}
