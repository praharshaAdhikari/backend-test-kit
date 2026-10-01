import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { type BookingRequest, BookingsService } from './bookings.service.js';
import { Clock } from './clock.js';
import { InMemoryBookingsStore } from './in-memory-bookings.store.js';

// A unit test of a service: its rules, with the store faked in memory and the clock fixed.
// No Nest module is needed: a service is a class, so the test constructs it directly. (Use
// Test.createTestingModule when the dependency wiring itself is what you want to test.)

class FixedClock extends Clock {
  constructor(private readonly moment: Date) {
    super();
  }

  now(): Date {
    return this.moment;
  }
}

const TODAY = '2026-09-24';

// Two front-desk users and an admin: who is asking decides what findOne and listMine answer.
const asha = { id: 7, roles: ['front-desk'] };
const binod = { id: 8, roles: ['front-desk'] };
const admin = { id: 1, roles: ['admin'] };

describe('BookingsService', () => {
  let store: InMemoryBookingsStore;
  let service: BookingsService;

  beforeEach(() => {
    store = new InMemoryBookingsStore();
    service = new BookingsService(store, new FixedClock(new Date(`${TODAY}T10:00:00Z`)));
  });

  // Test data builder: every field has a sensible default; each test states only what matters.
  function request(overrides: Partial<BookingRequest> = {}): BookingRequest {
    return {
      hallId: 1,
      date: '2026-10-01',
      guests: 10,
      contactEmail: 'asha@example.com',
      bookedBy: asha.id,
      ...overrides
    };
  }

  describe('create', () => {
    it('saves a booking that fits', async () => {
      const hall = store.addHall({ capacity: 100 });

      const booking = await service.create(request({ hallId: hall.id, guests: 40 }));

      expect(booking).toEqual({
        id: 1,
        hallId: hall.id,
        date: '2026-10-01',
        guests: 40,
        contactEmail: 'asha@example.com',
        bookedBy: asha.id,
        reminderSentAt: null
      });
      expect(store.bookings).toHaveLength(1);
    });

    it('stores the contact email trimmed and lower-case', async () => {
      const hall = store.addHall();

      const booking = await service.create(request({ hallId: hall.id, contactEmail: '  Asha@Example.COM ' }));

      expect(booking.contactEmail).toBe('asha@example.com');
    });

    it('rejects an unknown hall, naming it', async () => {
      const refused = service.create(request({ hallId: 99 }));

      await expect(refused).rejects.toThrow(NotFoundException);
      await expect(refused).rejects.toThrow('Hall #99 not found');
    });

    it('rejects a date in the past, and accepts today', async () => {
      const hall = store.addHall();

      const yesterday = service.create(request({ hallId: hall.id, date: '2026-09-23' }));

      await expect(yesterday).rejects.toThrow(BadRequestException);
      await expect(yesterday).rejects.toThrow('A booking cannot be for a date in the past');
      await expect(service.create(request({ hallId: hall.id, date: TODAY }))).resolves.toMatchObject({
        date: TODAY
      });
    });

    // Table test: both sides of the capacity limit, with guests already booked that day.
    it.each([
      [60, 'fills the hall exactly', 'accepted'],
      [61, 'is one guest over', 'refused']
    ])('with 40 of 100 places taken, a booking of %i (%s) is %s', async (guests, _label, expected) => {
      const hall = store.addHall({ capacity: 100 });
      await service.create(request({ hallId: hall.id, guests: 40 }));

      const outcome = await service.create(request({ hallId: hall.id, guests })).then(
        () => 'accepted',
        (error: unknown) => (error instanceof ConflictException ? 'refused' : error)
      );

      expect(outcome).toBe(expected);
    });

    it('says how many places are left when it refuses', async () => {
      const hall = store.addHall({ name: 'Annex', capacity: 20 });
      await service.create(request({ hallId: hall.id, guests: 15 }));

      await expect(service.create(request({ hallId: hall.id, guests: 6 }))).rejects.toThrow(
        'Annex has 5 place(s) left on 2026-10-01, not 6'
      );
    });

    it('saves nothing when it refuses', async () => {
      const hall = store.addHall({ capacity: 10 });

      await expect(service.create(request({ hallId: hall.id, guests: 11 }))).rejects.toThrow();

      expect(store.bookings).toEqual([]);
    });
  });

  // Who may read a booking. Role checks ("may this kind of user call this route?") are the
  // guard's job; this is the other half, which a guard cannot do: "is this record theirs?"
  describe('findOne', () => {
    it('returns a booking to the user who made it', async () => {
      const hall = store.addHall();
      const booking = await service.create(request({ hallId: hall.id, bookedBy: asha.id }));

      await expect(service.findOne(booking.id, asha)).resolves.toEqual(booking);
    });

    it("answers not found for another user's booking, exactly as for one that does not exist", async () => {
      const hall = store.addHall();
      const booking = await service.create(request({ hallId: hall.id, bookedBy: asha.id }));

      const someoneElses = await service.findOne(booking.id, binod).catch((error: unknown) => error);
      const missing = await service.findOne(booking.id + 1, binod).catch((error: unknown) => error);

      expect(someoneElses).toBeInstanceOf(NotFoundException);
      expect(missing).toBeInstanceOf(NotFoundException);
      // Same wording too, apart from the id asked for: nothing gives away that the booking exists.
      expect((someoneElses as Error).message).toBe(`Booking #${booking.id} not found`);
      expect((missing as Error).message).toBe(`Booking #${booking.id + 1} not found`);
    });

    it("lets an admin read anyone's booking", async () => {
      const hall = store.addHall();
      const booking = await service.create(request({ hallId: hall.id, bookedBy: asha.id }));

      await expect(service.findOne(booking.id, admin)).resolves.toEqual(booking);
    });
  });

  describe('listMine', () => {
    it("lists the user's own bookings and nobody else's", async () => {
      const hall = store.addHall();
      const mine = await service.create(request({ hallId: hall.id, bookedBy: asha.id }));
      await service.create(request({ hallId: hall.id, bookedBy: binod.id }));

      await expect(service.listMine(asha)).resolves.toEqual([mine]);
    });
  });
});
