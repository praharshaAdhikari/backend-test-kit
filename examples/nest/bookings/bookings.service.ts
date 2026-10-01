import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException
} from '@nestjs/common';
import { type Booking, BookingsStore } from './bookings.store.js';
import { Clock, dateOf } from './clock.js';
import type { RequestUser } from './roles.guard.js';

export interface BookingRequest {
  hallId: number;
  date: string;
  guests: number;
  contactEmail: string;
  /** The signed-in user's id. The controller takes it from the request, never from the body. */
  bookedBy: number;
}

/**
 * The business rules for booking a hall. Every rule is a unit test in bookings.service.spec.ts;
 * how guests are counted in the database is an integration test in examples/nest/typeorm.
 */
@Injectable()
export class BookingsService {
  constructor(
    private readonly store: BookingsStore,
    private readonly clock: Clock
  ) {}

  async create(request: BookingRequest): Promise<Booking> {
    const hall = await this.store.findHall(request.hallId);
    if (!hall) {
      throw new NotFoundException(`Hall #${request.hallId} not found`);
    }
    if (request.date < dateOf(this.clock.now())) {
      throw new BadRequestException('A booking cannot be for a date in the past');
    }

    const placesLeft = hall.capacity - (await this.store.guestsBooked(hall.id, request.date));
    if (request.guests > placesLeft) {
      throw new ConflictException(
        `${hall.name} has ${placesLeft} place(s) left on ${request.date}, not ${request.guests}`
      );
    }

    return this.store.save({
      hallId: hall.id,
      date: request.date,
      guests: request.guests,
      contactEmail: request.contactEmail.trim().toLowerCase(),
      bookedBy: request.bookedBy
    });
  }

  /** A booking, for the user who made it or an admin. */
  async findOne(bookingId: number, user: RequestUser): Promise<Booking> {
    const booking = await this.store.findBooking(bookingId);
    // Someone else's booking gets the same answer as one that does not exist: a 403 would tell
    // the caller that booking #N is real.
    if (!booking || (booking.bookedBy !== user.id && !user.roles.includes('admin'))) {
      throw new NotFoundException(`Booking #${bookingId} not found`);
    }
    return booking;
  }

  listMine(user: RequestUser): Promise<Booking[]> {
    return this.store.bookingsFor(user.id);
  }
}
