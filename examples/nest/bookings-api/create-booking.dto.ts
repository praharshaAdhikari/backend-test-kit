import { IsEmail, IsInt, Matches, Max, Min } from 'class-validator';

/**
 * What POST /bookings accepts. ValidationPipe checks it before the controller runs, so a bad
 * body never reaches the service: test that over HTTP (bookings.controller.spec.ts).
 */
export class CreateBookingDto {
  @IsInt()
  @Min(1)
  hallId!: number;

  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'date must be YYYY-MM-DD' })
  date!: string;

  @IsInt()
  @Min(1)
  @Max(500)
  guests!: number;

  @IsEmail()
  contactEmail!: string;
}
