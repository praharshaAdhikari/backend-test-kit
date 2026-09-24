import { Injectable } from '@nestjs/common';

/**
 * "Now", injected. Code that asks the clock instead of calling new Date() can be tested on any
 * date: a test passes a FixedClock. (jest.useFakeTimers() + jest.setSystemTime() works too.)
 */
export abstract class Clock {
  abstract now(): Date;
}

@Injectable()
export class SystemClock extends Clock {
  now(): Date {
    return new Date();
  }
}

/** YYYY-MM-DD of a moment, in UTC. The kit runs tests with TZ=UTC so this is the same everywhere. */
export function dateOf(moment: Date): string {
  return moment.toISOString().slice(0, 10);
}

export function addDays(date: string, days: number): string {
  const moment = new Date(`${date}T00:00:00Z`);
  moment.setUTCDate(moment.getUTCDate() + days);
  return dateOf(moment);
}
