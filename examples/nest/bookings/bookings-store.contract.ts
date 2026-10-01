import type { BookingsStore, Hall, NewBooking } from './bookings.store.js';

/** A store to test, and a way to give it a hall (halls are not created through the store). */
export interface BookingsStoreHarness {
  store: BookingsStore;
  addHall(capacity?: number): Promise<Hall>;
}

/**
 * What every BookingsStore must do, written once and run against each implementation: the
 * in-memory fake (in-memory-bookings.store.spec.ts, a unit test) and the real TypeORM store
 * (examples/nest/typeorm, against MySQL). The services' unit tests trust the fake; this is what
 * earns that trust. If the two ever behave differently, one of the two runs fails.
 *
 * Not a test file itself (no .spec in the name): the two files that call it are.
 */
export function bookingsStoreContract(
  name: string,
  makeHarness: () => BookingsStoreHarness | Promise<BookingsStoreHarness>
) {
  describe(`${name} behaves like a BookingsStore`, () => {
    let store: BookingsStore;
    let addHall: BookingsStoreHarness['addHall'];

    beforeEach(async () => {
      ({ store, addHall } = await makeHarness());
    });

    function booking(overrides: Partial<NewBooking>): NewBooking {
      return { hallId: 1, date: '2026-10-01', guests: 2, contactEmail: 'asha@example.com', bookedBy: 7, ...overrides };
    }

    it('finds a hall by id, and answers null for one that does not exist', async () => {
      const hall = await addHall(80);

      await expect(store.findHall(hall.id)).resolves.toMatchObject({ id: hall.id, capacity: 80 });
      await expect(store.findHall(hall.id + 1)).resolves.toBeNull();
    });

    it('adds up the guests for that hall on that date only', async () => {
      const main = await addHall();
      const annex = await addHall();
      await store.save(booking({ hallId: main.id, guests: 30 }));
      await store.save(booking({ hallId: main.id, guests: 12 }));
      await store.save(booking({ hallId: main.id, guests: 50, date: '2026-10-02' })); // another day
      await store.save(booking({ hallId: annex.id, guests: 70 })); // another hall

      await expect(store.guestsBooked(main.id, '2026-10-01')).resolves.toBe(42);
    });

    // In SQL, SUM over no rows is NULL, not 0: the real store has to turn it into a number.
    it('counts zero guests when nothing is booked', async () => {
      const main = await addHall();

      await expect(store.guestsBooked(main.id, '2026-10-01')).resolves.toBe(0);
    });

    it('saves a booking and reads it back unchanged, not reminded yet', async () => {
      const main = await addHall();

      const saved = await store.save(booking({ hallId: main.id, guests: 3, contactEmail: 'a@b.test' }));

      // The date comes back as the same string: no time zone shifts it to the day before.
      await expect(store.findBooking(saved.id)).resolves.toEqual({
        id: saved.id,
        hallId: main.id,
        date: '2026-10-01',
        guests: 3,
        contactEmail: 'a@b.test',
        bookedBy: 7,
        reminderSentAt: null
      });
    });

    it('answers null for a booking that does not exist', async () => {
      await expect(store.findBooking(999)).resolves.toBeNull();
    });

    it("lists one user's bookings and nobody else's, oldest first", async () => {
      const main = await addHall();
      const first = await store.save(booking({ hallId: main.id, bookedBy: 7 }));
      await store.save(booking({ hallId: main.id, bookedBy: 8 })); // another user
      const second = await store.save(booking({ hallId: main.id, bookedBy: 7, date: '2026-10-02' }));

      const mine = await store.bookingsFor(7);

      expect(mine.map(b => b.id)).toEqual([first.id, second.id]);
    });

    it('finds bookings due a reminder: that date, not yet reminded', async () => {
      const main = await addHall();
      const due = await store.save(booking({ hallId: main.id }));
      const reminded = await store.save(booking({ hallId: main.id }));
      await store.markReminderSent(reminded.id, new Date('2026-09-30T08:00:00Z'));
      await store.save(booking({ hallId: main.id, date: '2026-10-02' })); // another day

      const found = await store.dueForReminder('2026-10-01');

      expect(found.map(b => b.id)).toEqual([due.id]);
    });

    it('records when a reminder was sent', async () => {
      const main = await addHall();
      const saved = await store.save(booking({ hallId: main.id }));
      // A whole second: a DATETIME column keeps no milliseconds, and the fake must not either.
      const sentAt = new Date('2026-09-30T08:00:00Z');

      await store.markReminderSent(saved.id, sentAt);

      await expect(store.findBooking(saved.id)).resolves.toMatchObject({ reminderSentAt: sentAt });
    });
  });
}
