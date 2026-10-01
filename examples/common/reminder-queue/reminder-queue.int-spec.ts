import { Queue, QueueEvents, type Worker } from 'bullmq';
import { flushRedis, testRedis } from '../../../../test/helpers/redis.js';
import { REMINDERS_QUEUE, type ReminderJob, ReminderQueue, startReminderWorker } from './reminder-queue.js';

// An integration test of a queue: the producer and the worker, joined by the real Redis that
// `npm run test:integration` starts (needsRedis = true in test/setup/project.ts). Each side has
// unit tests of its own; only a real round trip shows that the worker understands what the
// producer sends, that a failure is retried, and that the same job is not done twice.
//
// What the worker does with a job (send an email) is faked. No fake timers here: BullMQ's own
// timing runs in Redis. Waiting is done with waitUntilFinished, never with a sleep.

const reminder: ReminderJob = { bookingId: 42, contactEmail: 'asha@example.com', date: '2026-10-01' };

describe('the reminder queue (real Redis)', () => {
  const { host, port } = testRedis();
  const connection = { host, port };
  let reminders: ReminderQueue;
  let events: QueueEvents;
  let worker: Worker<ReminderJob> | undefined;

  beforeEach(async () => {
    await flushRedis();
    reminders = new ReminderQueue(connection, 20); // retry after 20 ms: the tests wait for retries
    events = new QueueEvents(REMINDERS_QUEUE, { connection });
    await events.waitUntilReady(); // or the "finished" event of a fast job is missed
  });

  // Everything that holds a connection is closed, worker first: an open one keeps Jest from
  // exiting, and a worker left running would pick up the next test's jobs.
  afterEach(async () => {
    await worker?.close();
    worker = undefined;
    await events.close();
    await reminders.close();
  });

  it('delivers to the worker exactly what the producer queued', async () => {
    const send = jest.fn().mockResolvedValue(undefined);
    worker = startReminderWorker(connection, send);

    const job = await reminders.enqueue(reminder);
    await job.waitUntilFinished(events, 10_000);

    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith(reminder);
  });

  it('tries again when sending fails, and stops once it succeeds', async () => {
    const send = jest.fn().mockRejectedValueOnce(new Error('SMTP connection refused')).mockResolvedValue(undefined);
    worker = startReminderWorker(connection, send);

    const job = await reminders.enqueue(reminder);
    await job.waitUntilFinished(events, 10_000);

    expect(send).toHaveBeenCalledTimes(2);
  });

  it('gives up after three attempts and keeps the job as failed, with the reason', async () => {
    const send = jest.fn().mockRejectedValue(new Error('SMTP connection refused'));
    worker = startReminderWorker(connection, send);

    const job = await reminders.enqueue(reminder);

    await expect(job.waitUntilFinished(events, 10_000)).rejects.toThrow('SMTP connection refused');
    expect(send).toHaveBeenCalledTimes(3);
    await expect(job.getState()).resolves.toBe('failed');
  });

  it('queues one job when the same booking is asked for twice', async () => {
    // No worker yet, so both requests arrive while the first job is still waiting.
    await reminders.enqueue(reminder);
    await reminders.enqueue(reminder);

    const queue = new Queue(REMINDERS_QUEUE, { connection });
    const waiting = await queue.getWaitingCount();
    await queue.close();

    expect(waiting).toBe(1);
  });
});
