import { type CallHandler, type ExecutionContext, Injectable, type NestInterceptor } from '@nestjs/common';
import { type Observable, map } from 'rxjs';

export interface Envelope<T> {
  data: T | null;
}

/** Wraps every response of a controller as { data }, and an empty result as { data: null }. */
@Injectable()
export class EnvelopeInterceptor<T> implements NestInterceptor<T, Envelope<T>> {
  intercept(_context: ExecutionContext, next: CallHandler<T>): Observable<Envelope<T>> {
    return next.handle().pipe(map(data => ({ data: data ?? null })));
  }
}
