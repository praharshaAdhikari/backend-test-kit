import { closeTestDb } from '../helpers/database.js';
import { fakeApis } from '../helpers/fake-apis.js';
import { testEnv } from './project.js';

// project.ts's testEnv, before any test file (and the app code it imports) loads.
for (const [name, value] of Object.entries(testEnv)) process.env[name] ??= value;
const originalEnv = process.env;

// Started now, not in beforeAll: this file runs before the test file and the app code it
// imports. Code that keeps a reference to fetch when it loads (`const fetchFn = global.fetch`)
// then holds MSW's fetch; with beforeAll it would hold the real one and reach the network.
fakeApis.listen({
  onUnhandledRequest(request, print) {
    const { hostname } = new URL(request.url);
    // supertest calls the app under test on localhost: that is not an outside API.
    if (hostname === '127.0.0.1' || hostname === 'localhost' || hostname === '::1') return;
    print.error();
  }
});

beforeEach(() => {
  process.env = { ...originalEnv }; // tests may set process.env.X freely
});

afterEach(() => {
  fakeApis.resetHandlers();
  jest.useRealTimers();
  process.env = originalEnv;
});

afterAll(async () => {
  fakeApis.close();
  await closeTestDb();
});
