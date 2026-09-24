import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException
} from '@nestjs/common';
import { type Booking, BookingsStore } from './bookings.store.js';
import { Clock, dateOf } from './clock.js';

export interface BookingRequest {
  hallId: number;
  date: string;
  guests: number;
  contactEmail: string;
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
      contactEmail: request.contactEmail.trim().toLowerCase()
    });
  }
}
