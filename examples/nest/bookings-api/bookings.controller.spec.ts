import { ConflictException, type INestApplication, NotFoundException, ValidationPipe } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import type { Server } from 'node:http';
import request from 'supertest';
import { BookingsController } from './bookings.controller.js';
import { BookingsService } from '../bookings/bookings.service.js';
import { RolesGuard } from '../bookings/roles.guard.js';

// An API test of a controller: real HTTP through Nest's pipeline (the ValidationPipe, the roles
// guard, the interceptor, exception handling), with the service replaced. It checks what only
// the HTTP layer does: status codes, validation, roles, the response shape, and which user the
// service is asked on behalf of. The rules themselves are the service's unit test.

describe('the bookings API', () => {
  let app: INestApplication;
  const bookings = { create: jest.fn(), findOne: jest.fn(), listMine: jest.fn() };

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
    // X-Test-Role header becomes the signed-in user, with the id in X-Test-User (7 if not given).
    app.use((req: { headers: Record<string, string>; user?: unknown }, _res: unknown, next: () => void) => {
      const role = req.headers['x-test-role'];
      if (role) req.user = { id: Number(req.headers['x-test-user'] ?? 7), roles: [role] };
      next();
    });
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  const valid = { hallId: 1, date: '2026-10-01', guests: 40, contactEmail: 'asha@example.com' };
  const saved = { id: 5, ...valid, bookedBy: 7, reminderSentAt: null };

  describe('POST /bookings', () => {
    function post(body: object, role: string | null = 'front-desk') {
      const req = request(app.getHttpServer() as Server).post('/bookings').send(body);
      return role ? req.set('X-Test-Role', role) : req;
    }

    it('creates the booking for the signed-in user and answers 201 with it in { data }', async () => {
      bookings.create.mockResolvedValue(saved);

      const res = await post(valid);

      expect(res.status).toBe(201);
      expect(res.body).toEqual({ data: saved });
      expect(bookings.create).toHaveBeenCalledWith({ ...valid, bookedBy: 7 });
    });

    // Table test: every rule in CreateBookingDto, one bad body each. None reaches the service.
    it.each([
      ['a missing hallId', { hallId: undefined }, 'hallId'],
      ['hallId as text', { hallId: 'one' }, 'hallId'],
      ['a date that is not YYYY-MM-DD', { date: '01/10/2026' }, 'date must be YYYY-MM-DD'],
      ['zero guests', { guests: 0 }, 'guests'],
      ['more than 500 guests', { guests: 501 }, 'guests'],
      ['an invalid email', { contactEmail: 'asha' }, 'contactEmail'],
      ['a field the API does not accept', { discount: 50 }, 'discount'],
      ["a booking in another user's name", { bookedBy: 99 }, 'bookedBy']
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

  // Reading one record by id is where "user A reads user B's data" bugs live. The decision is
  // the service's (and its unit test's); over HTTP, check that the service is asked as the
  // signed-in user and that its "not found" reaches the client as a 404 with nothing in it.
  describe('GET /bookings/:id', () => {
    function get(id: string, user: { id: number; role: string } | null = { id: 7, role: 'front-desk' }) {
      const req = request(app.getHttpServer() as Server).get(`/bookings/${id}`);
      return user ? req.set('X-Test-Role', user.role).set('X-Test-User', String(user.id)) : req;
    }

    it('answers 200 with the booking, asking the service as the signed-in user', async () => {
      bookings.findOne.mockResolvedValue(saved);

      const res = await get('5', { id: 7, role: 'front-desk' });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ data: saved });
      expect(bookings.findOne).toHaveBeenCalledWith(5, { id: 7, roles: ['front-desk'] });
    });

    it("answers 404, with no booking in the body, when it is another user's or does not exist", async () => {
      bookings.findOne.mockRejectedValue(new NotFoundException('Booking #5 not found'));

      const res = await get('5', { id: 8, role: 'front-desk' });

      expect(res.status).toBe(404);
      expect(res.body).toEqual({ statusCode: 404, error: 'Not Found', message: 'Booking #5 not found' });
      expect(bookings.findOne).toHaveBeenCalledWith(5, { id: 8, roles: ['front-desk'] });
    });

    it('answers 400 for an id that is not a number, without asking the service', async () => {
      const res = await get('five');

      expect(res.status).toBe(400);
      expect(bookings.findOne).not.toHaveBeenCalled();
    });

    it('answers 401 when nobody is signed in', async () => {
      const res = await get('5', null);

      expect(res.status).toBe(401);
      expect(bookings.findOne).not.toHaveBeenCalled();
    });
  });

  describe('GET /bookings', () => {
    it("answers 200 with the signed-in user's bookings", async () => {
      bookings.listMine.mockResolvedValue([saved]);

      const res = await request(app.getHttpServer() as Server)
        .get('/bookings')
        .set('X-Test-Role', 'front-desk')
        .set('X-Test-User', '7');

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ data: [saved] });
      expect(bookings.listMine).toHaveBeenCalledWith({ id: 7, roles: ['front-desk'] });
    });
  });
});
