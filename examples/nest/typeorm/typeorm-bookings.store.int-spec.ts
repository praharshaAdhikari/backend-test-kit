import { Test, type TestingModule } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { resetDatabase } from '../../../../test/helpers/database.js';
import { BookingEntity, HallEntity } from './booking.entities.js';
import { bookingsStoreContract } from '../bookings/bookings-store.contract.js';
import { BookingsService } from '../bookings/bookings.service.js';
import { BookingsStore } from '../bookings/bookings.store.js';
import { Clock, SystemClock } from '../bookings/clock.js';
import { TypeOrmBookingsStore } from './typeorm-bookings.store.js';

// An integration test of TypeORM code: the real repository and query builder against the MySQL
// that `npm run test:integration` starts. It checks what only the database can: the SUM, the
// WHERE clauses, dates, and NULLs.
//
// The store's behaviour is the shared contract (../bookings/bookings-store.contract.ts), the same
// tests the in-memory fake passes. After it, the service runs with the real store: the full
// path, once.
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

describe('the TypeORM bookings store (real MySQL)', () => {
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
    // Dropped first: a run that was interrupted (or a container kept between runs) may have left
    // the tables behind in an older shape.
    await dataSource.query('DROP TABLE IF EXISTS example_bookings');
    await dataSource.query('DROP TABLE IF EXISTS example_halls');
    await dataSource.query(`CREATE TABLE example_halls (
      id INT AUTO_INCREMENT PRIMARY KEY, name VARCHAR(100) NOT NULL, capacity INT NOT NULL)`);
    await dataSource.query(`CREATE TABLE example_bookings (
      id INT AUTO_INCREMENT PRIMARY KEY, hallId INT NOT NULL, date DATE NOT NULL, guests INT NOT NULL,
      contactEmail VARCHAR(200) NOT NULL, bookedBy INT NOT NULL, reminderSentAt DATETIME NULL)`);
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

  async function booking(hallId: number, date: string, guests: number, bookedBy = 7) {
    return dataSource
      .getRepository(BookingEntity)
      .save({ hallId, date, guests, contactEmail: 'asha@example.com', bookedBy, reminderSentAt: null });
  }

  bookingsStoreContract('TypeOrmBookingsStore', () => ({ store, addHall: hall }));

  describe('BookingsService with this store', () => {
    it('refuses a booking the hall has no room for', async () => {
      const main = await hall(50);
      await booking(main.id, '2099-01-01', 45);
      const service = moduleRef.get(BookingsService);

      await expect(
        service.create({ hallId: main.id, date: '2099-01-01', guests: 6, contactEmail: 'a@b.test', bookedBy: 7 })
      ).rejects.toThrow(ConflictException);
      await expect(store.guestsBooked(main.id, '2099-01-01')).resolves.toBe(45);
    });

    it("answers not found for another user's booking, and returns it to its owner", async () => {
      const main = await hall();
      const ashas = await booking(main.id, '2099-01-01', 2, 7);
      const service = moduleRef.get(BookingsService);

      await expect(service.findOne(ashas.id, { id: 8, roles: ['front-desk'] })).rejects.toThrow(NotFoundException);
      await expect(service.findOne(ashas.id, { id: 7, roles: ['front-desk'] })).resolves.toMatchObject({
        id: ashas.id,
        bookedBy: 7
      });
    });
  });
});
