import { type CallHandler, type ExecutionContext } from '@nestjs/common';
import { lastValueFrom, of, throwError } from 'rxjs';
import { EnvelopeInterceptor } from './envelope.interceptor.js';

// A unit test of an interceptor: intercept() with a CallHandler that returns what the route
// would have returned. lastValueFrom turns the Observable into a promise to assert on.

const context = {} as ExecutionContext; // this interceptor does not read the context

function handlerReturning(value: unknown): CallHandler {
  return { handle: () => of(value) };
}

describe('EnvelopeInterceptor', () => {
  const interceptor = new EnvelopeInterceptor();

  it('wraps what the route returns in { data }', async () => {
    const result = interceptor.intercept(context, handlerReturning({ id: 1 }));

    await expect(lastValueFrom(result)).resolves.toEqual({ data: { id: 1 } });
  });

  it.each([undefined, null])('turns an empty result (%p) into { data: null }', async value => {
    await expect(lastValueFrom(interceptor.intercept(context, handlerReturning(value)))).resolves.toEqual({
      data: null
    });
  });

  it('keeps falsy values that are real results', async () => {
    await expect(lastValueFrom(interceptor.intercept(context, handlerReturning(0)))).resolves.toEqual({ data: 0 });
  });

  it('lets errors through unchanged, for the exception filters to handle', async () => {
    const failing: CallHandler = { handle: () => throwError(() => new Error('boom')) };

    await expect(lastValueFrom(interceptor.intercept(context, failing))).rejects.toThrow('boom');
  });
});
