import request from 'supertest';
import { http, HttpResponse } from 'msw';
import { fakeApis } from '../../../../test/helpers/fake-apis.js';
import { createApp } from './members-app.js';

// An API test: real HTTP requests into the Express app with supertest, and the service it calls
// faked with MSW (fakeApis). No server is started and nothing leaves the machine, so it runs
// with the unit tests.

const MEMBERS_API = 'https://members.example.test';
const app = createApp({ membersApiUrl: MEMBERS_API });

/** Makes the members service answer GET /members/:id, and records the token it received. */
function givenMembersApi(respond: () => Response) {
  const received: { token: string | null }[] = [];
  fakeApis.use(
    http.get(`${MEMBERS_API}/members/:id`, ({ request: req }) => {
      received.push({ token: req.headers.get('authorization') });
      return respond();
    })
  );
  return received;
}

describe('GET /api/members/:id', () => {
  it('returns the member, with only the fields the client needs', async () => {
    givenMembersApi(() => HttpResponse.json({ id: 7, name: 'Asha', passwordHash: 'x' }));

    const res = await request(app).get('/api/members/7').set('Authorization', 'Bearer abc');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ id: 7, name: 'Asha' });
  });

  it("passes the caller's token on to the members service", async () => {
    const received = givenMembersApi(() => HttpResponse.json({ id: 7, name: 'Asha' }));

    await request(app).get('/api/members/7').set('Authorization', 'Bearer abc');

    expect(received).toEqual([{ token: 'Bearer abc' }]);
  });

  it('rejects an id that is not a number, without calling the members service', async () => {
    const received = givenMembersApi(() => HttpResponse.json({}));

    const res = await request(app).get('/api/members/seven').set('Authorization', 'Bearer abc');

    expect(res.status).toBe(400);
    expect(received).toHaveLength(0);
  });

  it('asks the caller to sign in when there is no token', async () => {
    const res = await request(app).get('/api/members/7');

    expect(res.status).toBe(401);
  });

  // Table test: every way the other service can fail, and what the client gets for each.
  it.each([
    ['says the member does not exist', () => new HttpResponse(null, { status: 404 }), 404],
    ['fails', () => HttpResponse.json({ message: 'boom' }, { status: 500 }), 502],
    ['cannot be reached', () => HttpResponse.error(), 502]
  ])('when the members service %s, answers %i', async (_label, respond, status) => {
    givenMembersApi(respond);

    const res = await request(app).get('/api/members/7').set('Authorization', 'Bearer abc');

    expect(res.status).toBe(status);
    expect((res.body as { error: unknown }).error).toEqual(expect.any(String));
  });
});
