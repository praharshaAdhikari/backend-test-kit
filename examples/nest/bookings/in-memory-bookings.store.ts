import { type Booking, BookingsStore, type Hall, type NewBooking } from './bookings.store.js';

/**
 * A fake BookingsStore for unit tests: real behaviour, kept in memory. A hand-written fake like
 * this reads better than a pile of jest.fn()s, and one fake serves every test of every class
 * that uses the store (BookingsService, BookingRemindersJob, ...).
 */
export class InMemoryBookingsStore extends BookingsStore {
  readonly halls: Hall[] = [];
  readonly bookings: Booking[] = [];

  addHall(hall: Partial<Hall> = {}): Hall {
    const saved = { id: this.halls.length + 1, name: 'Main hall', capacity: 100, ...hall };
    this.halls.push(saved);
    return saved;
  }

  findHall(hallId: number): Promise<Hall | null> {
    return Promise.resolve(this.halls.find(hall => hall.id === hallId) ?? null);
  }

  guestsBooked(hallId: number, date: string): Promise<number> {
    return Promise.resolve(
      this.bookings
        .filter(booking => booking.hallId === hallId && booking.date === date)
        .reduce((sum, booking) => sum + booking.guests, 0)
    );
  }

  save(booking: NewBooking): Promise<Booking> {
    const saved = { ...booking, id: this.bookings.length + 1, reminderSentAt: null };
    this.bookings.push(saved);
    return Promise.resolve(saved);
  }

  dueForReminder(date: string): Promise<Booking[]> {
    return Promise.resolve(this.bookings.filter(booking => booking.date === date && !booking.reminderSentAt));
  }

  markReminderSent(bookingId: number, at: Date): Promise<void> {
    const booking = this.bookings.find(candidate => candidate.id === bookingId);
    if (booking) booking.reminderSentAt = at;
    return Promise.resolve();
  }
}
