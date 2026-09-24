import { BookingRemindersJob } from './booking-reminders.job.js';
import { Clock } from '../bookings/clock.js';
import { type Email, Mailer } from './mailer.js';
import { InMemoryBookingsStore } from '../bookings/in-memory-bookings.store.js';

// A unit test of a scheduled job: call the method the @Cron decorator runs, directly, with the
// clock fixed and the outside world (email) faked. What runs it on schedule is Nest's job, not
// something to test here.

class FixedClock extends Clock {
  constructor(public moment: Date) {
    super();
  }

  now(): Date {
    return this.moment;
  }
}

/** Records every email instead of sending it; can be told to fail for one address. */
class FakeMailer extends Mailer {
  readonly sent: Email[] = [];
  failFor: string | null = null;

  send(email: Email): Promise<void> {
    if (email.to === this.failFor) return Promise.reject(new Error('SMTP connection refused'));
    this.sent.push(email);
    return Promise.resolve();
  }
}

describe('BookingRemindersJob', () => {
  let store: InMemoryBookingsStore;
  let mailer: FakeMailer;
  let clock: FixedClock;
  let job: BookingRemindersJob;

  beforeEach(() => {
    store = new InMemoryBookingsStore();
    mailer = new FakeMailer();
    // 23:30 UTC: late in the day is where "tomorrow" is most often computed wrong.
    clock = new FixedClock(new Date('2026-09-24T23:30:00Z'));
    job = new BookingRemindersJob(store, mailer, clock);
  });

  async function book(date: string, contactEmail = 'asha@example.com') {
    return store.save({ hallId: 1, date, guests: 2, contactEmail });
  }

  it('reminds the bookings for tomorrow and no other day', async () => {
    await book('2026-09-24', 'today@example.com');
    await book('2026-09-25', 'tomorrow@example.com');
    await book('2026-09-26', 'later@example.com');

    const result = await job.sendReminders();

    expect(mailer.sent.map(email => email.to)).toEqual(['tomorrow@example.com']);
    expect(result).toEqual({ sent: 1, failed: 0 });
  });

  it('sends each reminder once, however many times it runs', async () => {
    await book('2026-09-25');

    await job.sendReminders();
    await job.sendReminders();

    expect(mailer.sent).toHaveLength(1);
  });

  it('records when each reminder was sent', async () => {
    const booking = await book('2026-09-25');

    await job.sendReminders();

    expect(store.bookings.find(b => b.id === booking.id)?.reminderSentAt).toEqual(clock.moment);
  });

  it('keeps going when one email fails, and retries that one on the next run', async () => {
    await book('2026-09-25', 'broken@example.com');
    await book('2026-09-25', 'fine@example.com');
    mailer.failFor = 'broken@example.com';

    await expect(job.sendReminders()).resolves.toEqual({ sent: 1, failed: 1 });
    expect(mailer.sent.map(email => email.to)).toEqual(['fine@example.com']);

    mailer.failFor = null;
    await expect(job.sendReminders()).resolves.toEqual({ sent: 1, failed: 0 });
    expect(mailer.sent.map(email => email.to)).toEqual(['fine@example.com', 'broken@example.com']);
  });

  it('writes a subject and text the guest can act on', async () => {
    const booking = await book('2026-09-25');

    await job.sendReminders();

    expect(mailer.sent[0]).toEqual({
      to: 'asha@example.com',
      subject: 'Your booking tomorrow (2026-09-25)',
      text: `See you tomorrow: 2 guest(s), booking #${booking.id}.`
    });
  });
});
