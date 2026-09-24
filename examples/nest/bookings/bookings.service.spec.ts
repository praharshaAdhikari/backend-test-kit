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

describe('BookingsService.create', () => {
  let store: InMemoryBookingsStore;
  let service: BookingsService;

  beforeEach(() => {
    store = new InMemoryBookingsStore();
    service = new BookingsService(store, new FixedClock(new Date(`${TODAY}T10:00:00Z`)));
  });

  // Test data builder: every field has a sensible default; each test states only what matters.
  function request(overrides: Partial<BookingRequest> = {}): BookingRequest {
    return { hallId: 1, date: '2026-10-01', guests: 10, contactEmail: 'asha@example.com', ...overrides };
  }

  it('saves a booking that fits', async () => {
    const hall = store.addHall({ capacity: 100 });

    const booking = await service.create(request({ hallId: hall.id, guests: 40 }));

    expect(booking).toEqual({
      id: 1,
      hallId: hall.id,
      date: '2026-10-01',
      guests: 40,
      contactEmail: 'asha@example.com',
      reminderSentAt: null
    });
    expect(store.bookings).toHaveLength(1);
  });

  it('stores the contact email trimmed and lower-case', async () => {
    const hall = store.addHall();

    const booking = await service.create(request({ hallId: hall.id, contactEmail: '  Asha@Example.COM ' }));

    expect(booking.contactEmail).toBe('asha@example.com');
  });

  it('rejects an unknown hall', async () => {
    await expect(service.create(request({ hallId: 99 }))).rejects.toThrow(NotFoundException);
  });

  it('rejects a date in the past, and accepts today', async () => {
    const hall = store.addHall();

    await expect(service.create(request({ hallId: hall.id, date: '2026-09-23' }))).rejects.toThrow(
      BadRequestException
    );
    await expect(service.create(request({ hallId: hall.id, date: TODAY }))).resolves.toMatchObject({
      date: TODAY
    });
  });

  // Table test: both sides of the capacity limit, with guests already booked that day.
  it.each([
    [60, 'fills the hall exactly', true],
    [61, 'is one guest over', false]
  ])('with 40 of 100 places taken, a booking of %i (%s) is accepted: %s', async (guests, _label, accepted) => {
    const hall = store.addHall({ capacity: 100 });
    await service.create(request({ hallId: hall.id, guests: 40 }));

    const attempt = service.create(request({ hallId: hall.id, guests }));

    if (accepted) await expect(attempt).resolves.toMatchObject({ guests });
    else await expect(attempt).rejects.toThrow(ConflictException);
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
