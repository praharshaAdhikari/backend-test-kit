export interface Hall {
  id: number;
  name: string;
  capacity: number;
}

export interface Booking {
  id: number;
  hallId: number;
  /** YYYY-MM-DD */
  date: string;
  guests: number;
  contactEmail: string;
  /** Id of the user who made the booking: only they, and admins, may read it. */
  bookedBy: number;
  reminderSentAt: Date | null;
}

export type NewBooking = Omit<Booking, 'id' | 'reminderSentAt'>;

/**
 * Where bookings are stored. BookingsService depends on this small class instead of on TypeORM,
 * so its unit test can use an in-memory fake (in-memory-bookings.store.ts) and every rule is
 * tested in milliseconds. The real version (examples/nest/typeorm) is tested against MySQL, and
 * bookings-store.contract.ts runs the same tests against both, so the fake cannot drift.
 *
 * An abstract class, not an interface, so Nest can use it as the injection token.
 */
export abstract class BookingsStore {
  abstract findHall(hallId: number): Promise<Hall | null>;
  /** Guests already booked in this hall on this date. */
  abstract guestsBooked(hallId: number, date: string): Promise<number>;
  abstract save(booking: NewBooking): Promise<Booking>;
  abstract findBooking(bookingId: number): Promise<Booking | null>;
  /** The bookings this user made, oldest first. */
  abstract bookingsFor(userId: number): Promise<Booking[]>;
  /** Bookings on this date that have not had a reminder yet. */
  abstract dueForReminder(date: string): Promise<Booking[]>;
  abstract markReminderSent(bookingId: number, at: Date): Promise<void>;
}
