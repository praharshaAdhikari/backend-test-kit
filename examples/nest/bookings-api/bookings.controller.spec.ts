import { ConflictException, type INestApplication, ValidationPipe } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import type { Server } from 'node:http';
import request from 'supertest';
import { BookingsController } from './bookings.controller.js';
import { BookingsService } from '../bookings/bookings.service.js';
import { RolesGuard } from '../bookings/roles.guard.js';

// An API test of a controller: real HTTP through Nest's pipeline (the ValidationPipe, the roles
// guard, the interceptor, exception handling), with the service replaced. It checks what only
// the HTTP layer does: status codes, validation, roles, the response shape. The rules themselves
// are the service's unit test.

describe('POST /bookings', () => {
  let app: INestApplication;
  const bookings = { create: jest.fn() };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [BookingsController],
      providers: [
        { provide: BookingsService, useValue: bookings },
        { provide: APP_GUARD, useClass: RolesGuard }
      ]
    }).compile();
    app = moduleRef.createNestApplication();
    // The same pipe settings as main.ts: unknown fields are an error, types are converted.
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    // Stands in for the authentication guard (JWT), which has its own tests: the role in the
    // X-Test-Role header becomes the signed-in user.
    app.use((req: { headers: Record<string, string>; user?: unknown }, _res: unknown, next: () => void) => {
      const role = req.headers['x-test-role'];
      if (role) req.user = { id: 7, roles: [role] };
      next();
    });
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  const valid = { hallId: 1, date: '2026-10-01', guests: 40, contactEmail: 'asha@example.com' };

  function post(body: object, role: string | null = 'front-desk') {
    const req = request(app.getHttpServer() as Server).post('/bookings').send(body);
    return role ? req.set('X-Test-Role', role) : req;
  }

  it('creates the booking and answers 201 with it in { data }', async () => {
    bookings.create.mockResolvedValue({ id: 5, ...valid, reminderSentAt: null });

    const res = await post(valid);

    expect(res.status).toBe(201);
    expect(res.body).toEqual({ data: { id: 5, ...valid, reminderSentAt: null } });
    expect(bookings.create).toHaveBeenCalledWith(valid);
  });

  // Table test: every rule in CreateBookingDto, one bad body each. None reaches the service.
  it.each([
    ['a missing hallId', { hallId: undefined }, 'hallId'],
    ['hallId as text', { hallId: 'one' }, 'hallId'],
    ['a date that is not YYYY-MM-DD', { date: '01/10/2026' }, 'date must be YYYY-MM-DD'],
    ['zero guests', { guests: 0 }, 'guests'],
    ['more than 500 guests', { guests: 501 }, 'guests'],
    ['an invalid email', { contactEmail: 'asha' }, 'contactEmail'],
    ['a field the API does not accept', { discount: 50 }, 'discount']
  ])('answers 400 for %s', async (_label, change, mentioned) => {
    const res = await post({ ...valid, ...change });

    expect(res.status).toBe(400);
    expect(JSON.stringify((res.body as { message: unknown }).message)).toContain(mentioned);
    expect(bookings.create).not.toHaveBeenCalled();
  });

  it('answers 401 when nobody is signed in', async () => {
    const res = await post(valid, null);

    expect(res.status).toBe(401);
    expect(bookings.create).not.toHaveBeenCalled();
  });

  it('answers 403 for a role that may not book', async () => {
    const res = await post(valid, 'member');

    expect(res.status).toBe(403);
    expect(bookings.create).not.toHaveBeenCalled();
  });

  it('answers 409 with the reason when the service refuses (hall full)', async () => {
    bookings.create.mockRejectedValue(new ConflictException('Main hall has 5 place(s) left'));

    const res = await post(valid);

    expect(res.status).toBe(409);
    expect((res.body as { message: unknown }).message).toBe('Main hall has 5 place(s) left');
  });
});
