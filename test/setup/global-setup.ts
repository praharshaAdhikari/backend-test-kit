import { MySqlContainer } from '@testcontainers/mysql';
import { RedisContainer } from '@testcontainers/redis';
// Loaded through global-setup.cjs, which makes the `.js` imports below find the .ts files.
import { flushRedis, type TestRedis } from '../helpers/redis.js';
import * as project from './project.js';
import { appEnv, keepTables, migrate, mysqlArgs, mysqlImage, needsDatabase } from './project.js';
import { recordSeededRows, type TestDatabase } from './test-database.js';

/**
 * TESTCONTAINERS_REUSE_ENABLE=true keeps the containers between runs: startup drops from about
 * 20 seconds to 2. Their data survives, which is fine: migrations skip what is applied (if the
 * project's migrate() does; plain SQL files must be re-runnable), and tests reset in beforeEach.
 */
const reuse = process.env.TESTCONTAINERS_REUSE_ENABLE === 'true';

/**
 * project.ts's Redis settings. All optional here: setup.sh never overwrites project.ts, so one
 * written before the kit had Redis has none of them (add them to turn Redis on; see the README).
 */
interface RedisSettings {
  needsRedis: boolean;
  redisImage: string;
  redisEnv(redis: TestRedis): Record<string, string>;
}
const {
  needsRedis = false,
  redisImage = 'redis:7-alpine',
  // The usual names, and no password: the app must never fall through to a Redis on localhost.
  redisEnv = (redis: TestRedis) => ({
    REDIS_URL: redis.url,
    REDIS_HOST: redis.host,
    REDIS_PORT: String(redis.port),
    REDIS_PASSWORD: ''
  })
} = project as unknown as Partial<RedisSettings>;

type Stoppable = { stop(): Promise<unknown> };

/**
 * Once per `jest` run, before any test file: starts what project.ts says the service needs
 * (MySQL, Redis) in Docker, builds the schema with migrate(), and sets the environment so the
 * app and the test helpers find them.
 */
export default async function globalSetup(): Promise<void> {
  const containers = await Promise.all([needsDatabase ? startMySql() : null, needsRedis ? startRedis() : null]);
  (globalThis as { __TEST_CONTAINERS__?: Stoppable[] }).__TEST_CONTAINERS__ = containers.filter(
    container => container !== null
  );
}

async function startMySql(): Promise<Stoppable> {
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
  console.log(`\nTest MySQL ready at ${db.host}:${db.port} (${((Date.now() - started) / 1000).toFixed(1)}s)`);
  return container;
}

async function startRedis(): Promise<Stoppable> {
  const started = Date.now();
  const builder = new RedisContainer(redisImage);
  const container = await (reuse ? builder.withReuse() : builder).start();

  const redis: TestRedis = {
    host: container.getHost(),
    port: container.getPort(),
    url: `redis://${container.getHost()}:${container.getPort()}`
  };

  Object.assign(process.env, redisEnv(redis), { TEST_REDIS: JSON.stringify(redis) });
  if (reuse) await flushRedis(); // a kept container still holds the last run's keys
  console.log(`\nTest Redis ready at ${redis.host}:${redis.port} (${((Date.now() - started) / 1000).toFixed(1)}s)`);
  return container;
}
