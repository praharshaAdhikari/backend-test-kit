import { Test, type TestingModule } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConflictException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { resetDatabase } from '../../../../test/helpers/database.js';
import { BookingEntity, HallEntity } from './booking.entities.js';
import { BookingsService } from '../bookings/bookings.service.js';
import { BookingsStore } from '../bookings/bookings.store.js';
import { Clock, SystemClock } from '../bookings/clock.js';
import { TypeOrmBookingsStore } from './typeorm-bookings.store.js';

// An integration test of TypeORM code: the real repository and query builder against the MySQL
// that `npm run test:integration` starts. It checks what only the database can: the SUM, the
// WHERE clauses, dates, and NULLs. The last test runs the service with the real store.
//
// In your project the migrations create the tables; this example creates its own so it runs
// anywhere. In your tests, point TypeOrmModule at the env variables your app reads.

/** TypeORM settings for the test database (test/setup/global-setup.ts puts them in TEST_DB). */
function testDatabase() {
  const { host, port, user, password, database } = JSON.parse(process.env.TEST_DB ?? '{}') as {
    host: string;
    port: number;
    user: string;
    password: string;
    database: string;
  };
  return { type: 'mysql' as const, host, port, username: user, password, database, timezone: 'Z' };
}

describe('TypeOrmBookingsStore (real MySQL)', () => {
  let moduleRef: TestingModule;
  let store: TypeOrmBookingsStore;
  let dataSource: DataSource;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [
        TypeOrmModule.forRoot({ ...testDatabase(), entities: [HallEntity, BookingEntity] }),
        TypeOrmModule.forFeature([HallEntity, BookingEntity])
      ],
      providers: [
        TypeOrmBookingsStore,
        { provide: BookingsStore, useExisting: TypeOrmBookingsStore },
        { provide: Clock, useClass: SystemClock },
        BookingsService
      ]
    }).compile();
    store = moduleRef.get(TypeOrmBookingsStore);
    dataSource = moduleRef.get(DataSource);
    await dataSource.query(`CREATE TABLE IF NOT EXISTS example_halls (
      id INT AUTO_INCREMENT PRIMARY KEY, name VARCHAR(100) NOT NULL, capacity INT NOT NULL)`);
    await dataSource.query(`CREATE TABLE IF NOT EXISTS example_bookings (
      id INT AUTO_INCREMENT PRIMARY KEY, hallId INT NOT NULL, date DATE NOT NULL, guests INT NOT NULL,
      contactEmail VARCHAR(200) NOT NULL, reminderSentAt DATETIME NULL)`);
  });

  afterAll(async () => {
    await dataSource.query('DROP TABLE IF EXISTS example_bookings');
    await dataSource.query('DROP TABLE IF EXISTS example_halls');
    await moduleRef.close();
  });

  beforeEach(() => resetDatabase());

  async function hall(capacity = 100) {
    return dataSource.getRepository(HallEntity).save({ name: 'Main hall', capacity });
  }

  async function booking(hallId: number, date: string, guests: number, reminderSentAt: Date | null = null) {
    return dataSource
      .getRepository(BookingEntity)
      .save({ hallId, date, guests, contactEmail: 'asha@example.com', reminderSentAt });
  }

  it('adds up the guests for that hall on that date only', async () => {
    const main = await hall();
    const annex = await hall();
    await booking(main.id, '2026-10-01', 30);
    await booking(main.id, '2026-10-01', 12);
    await booking(main.id, '2026-10-02', 50); // another day
    await booking(annex.id, '2026-10-01', 70); // another hall

    await expect(store.guestsBooked(main.id, '2026-10-01')).resolves.toBe(42);
  });

  it('counts zero guests when nothing is booked (SUM of no rows is NULL in SQL)', async () => {
    const main = await hall();

    await expect(store.guestsBooked(main.id, '2026-10-01')).resolves.toBe(0);
  });

  it('saves a booking and reads it back with the same date, not reminded yet', async () => {
    const main = await hall();

    const saved = await store.save({ hallId: main.id, date: '2026-10-01', guests: 3, contactEmail: 'a@b.test' });

    // A DATE column read back as a string: no time zone shifts it to the day before.
    await expect(store.dueForReminder('2026-10-01')).resolves.toEqual([
      { id: saved.id, hallId: main.id, date: '2026-10-01', guests: 3, contactEmail: 'a@b.test', reminderSentAt: null }
    ]);
  });

  it('finds bookings due a reminder: that date, not yet reminded', async () => {
    const main = await hall();
    const due = await booking(main.id, '2026-10-01', 2);
    await booking(main.id, '2026-10-01', 2, new Date('2026-09-30T08:00:00Z')); // already reminded
    await booking(main.id, '2026-10-02', 2); // another day

    const found = await store.dueForReminder('2026-10-01');

    expect(found.map(b => b.id)).toEqual([due.id]);
  });

  it('marks a reminder as sent, so it is not due any more', async () => {
    const main = await hall();
    const due = await booking(main.id, '2026-10-01', 2);

    await store.markReminderSent(due.id, new Date('2026-09-30T08:00:00Z'));

    await expect(store.dueForReminder('2026-10-01')).resolves.toEqual([]);
  });

  it('with the real store, the service refuses a booking the hall has no room for', async () => {
    const main = await hall(50);
    await booking(main.id, '2099-01-01', 45);
    const service = moduleRef.get(BookingsService);

    await expect(
      service.create({ hallId: main.id, date: '2099-01-01', guests: 6, contactEmail: 'a@b.test' })
    ).rejects.toThrow(ConflictException);
    await expect(store.guestsBooked(main.id, '2099-01-01')).resolves.toBe(45);
  });
});
