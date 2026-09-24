import type { StartedMySqlContainer } from '@testcontainers/mysql';

export default async function globalTeardown(): Promise<void> {
  // A reused container stays up for the next run.
  if (process.env.TESTCONTAINERS_REUSE_ENABLE === 'true') return;
  await (globalThis as { __TEST_MYSQL__?: StartedMySqlContainer }).__TEST_MYSQL__?.stop();
}
