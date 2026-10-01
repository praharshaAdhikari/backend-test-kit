import { Body, Controller, Get, Param, ParseIntPipe, Post, Req, UseInterceptors } from '@nestjs/common';
import { BookingsService } from '../bookings/bookings.service.js';
import { CreateBookingDto } from './create-booking.dto.js';
import { EnvelopeInterceptor } from '../bookings/envelope.interceptor.js';
import { Roles } from '../bookings/roles.decorator.js';
import type { RequestUser } from '../bookings/roles.guard.js';

/** A request after the authentication and roles guards: there is always a user. */
type SignedInRequest = { user: RequestUser };

// Every route has @Roles: one without it is open to anyone, signed in or not.
@Controller('bookings')
@UseInterceptors(EnvelopeInterceptor)
@Roles('admin', 'front-desk')
export class BookingsController {
  constructor(private readonly bookings: BookingsService) {}

  @Post()
  create(@Body() body: CreateBookingDto, @Req() req: SignedInRequest) {
    // Who made the booking comes from the session, never from the body: a client must not be
    // able to book in someone else's name.
    return this.bookings.create({ ...body, bookedBy: req.user.id });
  }

  @Get()
  listMine(@Req() req: SignedInRequest) {
    return this.bookings.listMine(req.user);
  }

  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number, @Req() req: SignedInRequest) {
    return this.bookings.findOne(id, req.user);
  }
}
