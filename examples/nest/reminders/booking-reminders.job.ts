import { Injectable } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { BookingsStore } from '../bookings/bookings.store.js';
import { Clock, addDays, dateOf } from '../bookings/clock.js';
import { Mailer } from './mailer.js';

/**
 * Every morning, reminds everyone booked for tomorrow. Safe to run twice (after a restart, or on
 * two servers): each sent reminder is recorded, and only unrecorded bookings are picked up. A
 * reminder that fails is not recorded, so the next run tries it again.
 */
@Injectable()
export class BookingRemindersJob {
  constructor(
    private readonly store: BookingsStore,
    private readonly mailer: Mailer,
    private readonly clock: Clock
  ) {}

  @Cron('0 8 * * *')
  async sendReminders(): Promise<{ sent: number; failed: number }> {
    const tomorrow = addDays(dateOf(this.clock.now()), 1);
    let sent = 0;
    let failed = 0;
    for (const booking of await this.store.dueForReminder(tomorrow)) {
      try {
        await this.mailer.send({
          to: booking.contactEmail,
          subject: `Your booking tomorrow (${booking.date})`,
          text: `See you tomorrow: ${booking.guests} guest(s), booking #${booking.id}.`
        });
        await this.store.markReminderSent(booking.id, this.clock.now());
        sent++;
      } catch {
        failed++; // left unrecorded: the next run retries it
      }
    }
    return { sent, failed };
  }
}
