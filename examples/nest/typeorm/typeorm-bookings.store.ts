import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, type Repository } from 'typeorm';
import { type Booking, BookingsStore, type Hall, type NewBooking } from '../bookings/bookings.store.js';
import { BookingEntity, HallEntity } from './booking.entities.js';

/**
 * The real BookingsStore, with TypeORM. Its queries are what an integration test is for: a unit
 * test with a mocked repository cannot tell whether the SUM, the filters or the dates are right.
 */
@Injectable()
export class TypeOrmBookingsStore extends BookingsStore {
  constructor(
    @InjectRepository(HallEntity) private readonly halls: Repository<HallEntity>,
    @InjectRepository(BookingEntity) private readonly bookings: Repository<BookingEntity>
  ) {
    super();
  }

  findHall(hallId: number): Promise<Hall | null> {
    return this.halls.findOne({ where: { id: hallId } });
  }

  async guestsBooked(hallId: number, date: string): Promise<number> {
    const row = await this.bookings
      .createQueryBuilder('booking')
      .select('COALESCE(SUM(booking.guests), 0)', 'guests')
      .where('booking.hallId = :hallId', { hallId })
      .andWhere('booking.date = :date', { date })
      .getRawOne<{ guests: string }>();
    return Number(row?.guests ?? 0);
  }

  save(booking: NewBooking): Promise<Booking> {
    return this.bookings.save(this.bookings.create({ ...booking, reminderSentAt: null }));
  }

  dueForReminder(date: string): Promise<Booking[]> {
    return this.bookings.find({ where: { date, reminderSentAt: IsNull() }, order: { id: 'ASC' } });
  }

  async markReminderSent(bookingId: number, at: Date): Promise<void> {
    await this.bookings.update(bookingId, { reminderSentAt: at });
  }
}
