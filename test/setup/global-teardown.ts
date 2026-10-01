export default async function globalTeardown(): Promise<void> {
  // Reused containers stay up for the next run.
  if (process.env.TESTCONTAINERS_REUSE_ENABLE === 'true') return;
  const containers = (globalThis as { __TEST_CONTAINERS__?: { stop(): Promise<unknown> }[] }).__TEST_CONTAINERS__;
  await Promise.all((containers ?? []).map(container => container.stop()));
}
