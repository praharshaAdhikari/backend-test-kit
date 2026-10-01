import { createConnection } from 'node:net';

/**
 * The test Redis, for integration tests (*.int-spec.ts, *.e2e-spec.ts) of code that caches or
 * queues. Only available when running `npm run test:integration` with needsRedis = true in
 * test/setup/project.ts: test/setup/global-setup.ts starts it.
 */

export interface TestRedis {
  host: string;
  port: number;
  /** redis://host:port */
  url: string;
}

/** Where the test Redis is: pass it to your own client (ioredis, node-redis, BullMQ). */
export function testRedis(): TestRedis {
  const raw = process.env.TEST_REDIS;
  if (!raw) {
    throw new Error(
      'No test Redis. Integration tests run with `npm run test:integration`, and need ' +
        'needsRedis = true in test/setup/project.ts.'
    );
  }
  return JSON.parse(raw) as TestRedis;
}

/**
 * Empties the test Redis: every key, queue and job. Call it in beforeEach so every test starts
 * from nothing, after closing any worker a test started (a running worker writes its keys back).
 *
 * It talks to Redis directly, so it works whichever client the service uses. It only ever
 * connects to the container global-setup started (TEST_REDIS), never to the REDIS_URL the app
 * would use, so it cannot empty a real Redis.
 */
export function flushRedis(): Promise<void> {
  const { host, port } = testRedis();
  return new Promise((resolve, reject) => {
    const socket = createConnection({ host, port });
    const fail = (error: Error) => {
      socket.destroy();
      reject(error);
    };
    socket.setTimeout(5000, () => fail(new Error(`The test Redis at ${host}:${port} did not answer FLUSHALL`)));
    socket.once('error', fail);
    socket.once('connect', () => socket.write('FLUSHALL\r\n'));
    socket.once('data', reply => {
      const answer = reply.toString().trim();
      if (answer === '+OK') {
        socket.destroy();
        resolve();
      } else {
        fail(new Error(`The test Redis refused FLUSHALL: ${answer}`));
      }
    });
  });
}
