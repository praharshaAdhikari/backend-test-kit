import { runSqlFiles, type TestDatabase } from './test-database.js';

/**
 * Everything the test setup needs to know about THIS project. The rest of test/setup is generic.
 * setup.sh filled in what it could detect; check each item once.
 */

/**
 * Settings the app needs just to load in a test: config modules that validate the environment
 * when imported (and exit when something is missing) need these before any test file loads.
 * Use harmless test values; outside APIs are faked, so URLs here are never really called.
 * Applied for unit and integration tests; a value already set in the environment wins.
 */
export const testEnv: Record<string, string> = {
  // __TEST_ENV__
};

/**
 * Whether this service has its own database. When false, `npm run test:integration` runs the
 * end-to-end tests without starting MySQL (a service that only calls other APIs, say).
 */
export const needsDatabase = true; // __NEEDS_DATABASE__

/** The MySQL image the tests run against. Match production's major version. */
export const mysqlImage = 'mysql:8.0';

/** Extra server flags. This one lets migrations create triggers and stored functions. */
export const mysqlArgs = ['--log-bin-trust-function-creators=1'];

/**
 * Tables resetDatabase() never empties: migration ledgers. Every other table is emptied before
 * each test (seeded rows are kept; see recordSeededRows in test-database.ts).
 */
export const keepTables = [
  'migrations',
  '_prisma_migrations',
  'knex_migrations',
  'knex_migrations_lock',
  'SequelizeMeta'
];

/**
 * Builds the schema in the empty test database, once per test run. Use the same migrations as
 * production, so a migration that cannot run from scratch fails here first.
 */
export async function migrate(db: TestDatabase): Promise<void> {
  // __MIGRATE__
}

/**
 * The environment variables the app reads to find its database, pointed at the test database.
 * Set before any test file loads, so modules that read process.env on import see them.
 */
export function appEnv(db: TestDatabase): Record<string, string> {
  return {
    // __APP_ENV__
    DATABASE_URL: db.url
  };
}

// Kept so the SQL-files strategy compiles even when migrate() uses another one.
void runSqlFiles;
