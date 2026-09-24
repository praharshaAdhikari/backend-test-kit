import { setupServer } from 'msw/node';

/**
 * Fake versions of the outside APIs this service calls (payment providers, email, other
 * services), using MSW. Started in jest.setup.ts; each test says what an API returns:
 *
 *   fakeApis.use(http.get('https://api.example.com/members/7', () => HttpResponse.json({ id: 7 })));
 *
 * Handlers are reset after every test. A request to an outside address with no handler fails
 * the test, so no test reaches a real service by accident. Requests to localhost (supertest
 * calling the app under test) go through untouched.
 */
export const fakeApis = setupServer();
