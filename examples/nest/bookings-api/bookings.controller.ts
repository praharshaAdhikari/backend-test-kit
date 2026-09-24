import { Body, Controller, Post, UseInterceptors } from '@nestjs/common';
import { BookingsService } from '../bookings/bookings.service.js';
import { CreateBookingDto } from './create-booking.dto.js';
import { EnvelopeInterceptor } from '../bookings/envelope.interceptor.js';
import { Roles } from '../bookings/roles.decorator.js';

@Controller('bookings')
@UseInterceptors(EnvelopeInterceptor)
export class BookingsController {
  constructor(private readonly bookings: BookingsService) {}

  @Post()
  @Roles('admin', 'front-desk')
  create(@Body() body: CreateBookingDto) {
    return this.bookings.create(body);
  }
}
