import { type ConnectionOptions, type Job, Queue, Worker } from 'bullmq';

export const REMINDERS_QUEUE = 'booking-reminders';

/** What the producer puts on the queue, and so what the worker must be able to read. */
export interface ReminderJob {
  bookingId: number;
  contactEmail: string;
  date: string;
}

/**
 * The producing side: the API process calls enqueue() and answers the request straight away.
 * retryDelayMs is how long a failed reminder waits before the next attempt.
 */
export class ReminderQueue {
  private readonly queue: Queue<ReminderJob>;

  constructor(
    connection: ConnectionOptions,
    private readonly retryDelayMs = 30_000
  ) {
    this.queue = new Queue<ReminderJob>(REMINDERS_QUEUE, { connection });
  }

  enqueue(reminder: ReminderJob): Promise<Job<ReminderJob>> {
    return this.queue.add('send-reminder', reminder, {
      // The booking decides the job id, so asking twice for the same booking queues one job.
      jobId: `reminder-${reminder.bookingId}`,
      attempts: 3,
      backoff: { type: 'fixed', delay: this.retryDelayMs }
    });
  }

  close(): Promise<void> {
    return this.queue.close();
  }
}

/**
 * The consuming side: a worker process runs this. `send` does the work (an email, here); when
 * it throws, BullMQ retries the job, and after the last attempt keeps it as failed.
 */
export function startReminderWorker(
  connection: ConnectionOptions,
  send: (reminder: ReminderJob) => Promise<void>
): Worker<ReminderJob> {
  return new Worker<ReminderJob>(REMINDERS_QUEUE, job => send(job.data), { connection });
}
