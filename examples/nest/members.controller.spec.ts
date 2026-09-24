import { type INestApplication, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { MembersController, MembersService } from './members.controller.js';

// An API test for NestJS: the real controller, pipes and exception handling, over HTTP with
// supertest. The service behind the controller is replaced, so no database is needed and it runs
// with the unit tests. (To run against the real database, name it *.e2e-spec.ts and import the
// real module: it then runs with `npm run test:integration`.)

describe('GET /members/:id', () => {
  let app: INestApplication;
  const members = { findOne: jest.fn() };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [MembersController],
      providers: [{ provide: MembersService, useValue: members }]
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns the member', async () => {
    members.findOne.mockResolvedValue({ id: 7, name: 'Asha' });

    const res = await request(app.getHttpServer()).get('/members/7');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ id: 7, name: 'Asha' });
    expect(members.findOne).toHaveBeenCalledWith(7); // ParseIntPipe turned "7" into 7
  });

  it('answers 400 for an id that is not a number, without asking the service', async () => {
    const res = await request(app.getHttpServer()).get('/members/seven');

    expect(res.status).toBe(400);
    expect(members.findOne).not.toHaveBeenCalled();
  });

  it('answers 404 when the service says the member does not exist', async () => {
    members.findOne.mockRejectedValue(new NotFoundException('Member #7 not found'));

    const res = await request(app.getHttpServer()).get('/members/7');

    expect(res.status).toBe(404);
    expect(res.body.message).toBe('Member #7 not found');
  });
});
