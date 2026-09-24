import express, { type NextFunction, type Response } from 'express';
import request from 'supertest';
import { hallsRouter } from './halls.routes.js';
import { type AuthedRequest, requireRole } from './auth.middleware.js';

// Two ways to test Express middleware. First on its own, with a fake request and response: fast,
// and every branch is easy to reach. Then through a router with supertest, which proves the
// middlewares are wired to the route in the right order.

function fakeResponse() {
  const res = { status: jest.fn(), json: jest.fn() };
  res.status.mockReturnValue(res);
  return res;
}

describe('requireRole (on its own)', () => {
  it('calls next() for a user with one of the roles', () => {
    const next = jest.fn();
    const req = { user: { id: 1, roles: ['front-desk'] } } as AuthedRequest;

    requireRole('admin', 'front-desk')(req, fakeResponse() as unknown as Response, next as NextFunction);

    expect(next).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['nobody is signed in', undefined, 401],
    ['the user has none of the roles', { id: 2, roles: ['member'] }, 403]
  ])('answers without calling next() when %s', (_label, user, status) => {
    const next = jest.fn();
    const res = fakeResponse();

    requireRole('admin')({ user } as AuthedRequest, res as unknown as Response, next as NextFunction);

    expect(res.status).toHaveBeenCalledWith(status);
    expect(next).not.toHaveBeenCalled();
  });
});

describe('POST /halls (middlewares on a route)', () => {
  const saveHall = jest.fn();
  const app = express();
  app.use(express.json());
  // Stands in for the authentication middleware: the X-Test-Role header becomes the user.
  app.use((req, _res, next) => {
    const role = req.header('x-test-role');
    if (role) (req as AuthedRequest).user = { id: 7, roles: [role] };
    next();
  });
  app.use('/halls', hallsRouter(saveHall));

  const post = (body: object, role = 'admin') => request(app).post('/halls').set('X-Test-Role', role).send(body);

  it('saves a valid hall, with the name trimmed, and answers 201', async () => {
    saveHall.mockResolvedValue({ id: 3 });

    const res = await post({ name: '  Annex ', capacity: 80 });

    expect(res.status).toBe(201);
    expect(res.body).toEqual({ id: 3, name: 'Annex', capacity: 80 });
    expect(saveHall).toHaveBeenCalledWith({ name: 'Annex', capacity: 80 });
  });

  it.each([
    ['a missing name', { capacity: 80 }, 'name'],
    ['a one-letter name', { name: 'A', capacity: 80 }, 'name'],
    ['capacity as text', { name: 'Annex', capacity: '80' }, 'capacity'],
    ['zero capacity', { name: 'Annex', capacity: 0 }, 'capacity'],
    ['fractional capacity', { name: 'Annex', capacity: 1.5 }, 'capacity']
  ])('answers 400 for %s, naming the field, and saves nothing', async (_label, body, field) => {
    const res = await post(body);

    expect(res.status).toBe(400);
    expect((res.body as { issues: { path: string }[] }).issues.map(issue => issue.path)).toContain(field);
    expect(saveHall).not.toHaveBeenCalled();
  });

  it('checks the role before the body: a member gets 403 even with a bad body', async () => {
    const res = await post({}, 'member');

    expect(res.status).toBe(403);
    expect(saveHall).not.toHaveBeenCalled();
  });
});
