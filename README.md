# Backend test kit: Jest, supertest, MSW, real MySQL

Drop-in test setup for Node.js services written in TypeScript (Express, NestJS, or plain Node):
unit tests, API tests over HTTP, and integration tests against a real MySQL that starts in Docker
for each run and is thrown away afterwards.

This repo is not an app and has no `package.json`: `setup.sh` adds it to a service with one
command, described below.

Verified on 2026-09-24 with Node 24, Jest 30, SWC, Express 4, NestJS 12 (ESM, converted from its
Vitest template), MySQL 8.0 and Testcontainers 12: examples pass, `tsc` is clean in both CommonJS
and ESM projects, and each example test fails when the behaviour it covers is broken.

## Three kinds of test

| Kind | Files | Runs against | Command | Written by |
|---|---|---|---|---|
| Unit | `*.spec.ts` next to the code | Nothing outside the process | `npm run test:unit` | The developer who writes the code |
| API | `*.spec.ts` | The app over HTTP (supertest); outside APIs faked (MSW); the database faked | `npm run test:unit` | The developer who writes the endpoint |
| Integration and end-to-end | `*.int-spec.ts`, `*.e2e-spec.ts` | A real MySQL in Docker, built with the project's own migrations | `npm run test:integration` | QA, or the developer who builds the feature |

Unit and API tests run in seconds with no Docker, so they run on every save and every PR.
Integration tests need Docker and take about 20 seconds to start; they run before merging and in CI.

## What's here

```
setup.sh                        -> run in a service to add everything below
jest.config.cjs                 -> unit and API tests (*.spec.ts)
jest.integration.config.cjs     -> integration and e2e tests (*.int-spec.ts, *.e2e-spec.ts)
eslint.testing.mjs              -> test lint rules (no it.only, every test asserts)
test/setup/project.ts           -> THIS service's settings: how to build the schema, which env vars
test/setup/jest.base.cjs        -> shared config: SWC, path aliases from tsconfig, ESM packages
test/setup/jest.setup.ts        -> MSW on, env and mocks reset, database closed after each file
test/setup/global-setup.cjs/.ts -> starts MySQL, runs migrate(), sets the env (integration only)
test/setup/global-teardown.ts   -> removes the container
test/setup/test-database.ts     -> runSqlFiles(), seeded-row bookkeeping
test/helpers/database.ts        -> testDb(), resetDatabase() for integration tests
test/helpers/fake-apis.ts       -> fakeApis: MSW for the outside APIs the service calls
examples/                       -> reference tests, one per kind of code (setup.sh --examples)
  common/split-amount           a utility function: boundaries, table tests
  common/notes-repository       plain SQL (mysql2): constraints, a transaction, resetDatabase()
  nest/bookings                 a service with business rules (the walkthrough below), its
                                in-memory fake store, a clock, a roles guard, an interceptor
  nest/bookings-api             a controller + DTO over HTTP: validation, roles, status codes
  nest/reminders                a scheduled job (@Cron) and a wrapped SDK (a mailer)
  nest/typeorm                  TypeORM queries against real MySQL; the service with the real store
  nest/members                  a controller with its service replaced
  express/members               an Express route that calls another service: supertest + MSW
  express/auth                  Express middleware: roles and a zod-validated body
  requires.json                 which examples need extra packages (class-validator, zod, ...)
ci/backend-tests.yml            -> a GitHub Actions workflow to copy
docs/backend-testing-practices.md  the rules, and the tests each kind of code needs
docs/troubleshooting.md            exact error messages and their fixes
```

## Start testing in a service

From the service's root (the folder with `package.json` and `tsconfig.json`):

```bash
curl -fsSL https://raw.githubusercontent.com/praharshaAdhikari/backend-test-kit/main/setup.sh | bash -s -- --examples
npm run check                # typecheck + unit and API tests
npm run test:integration     # needs Docker
```

The script:

1. copies the files above; with `--examples`, copies the examples for the service's framework
   into `<source folder>/examples/` (they add no routes; delete the folder when you are done).
   An example that needs a package the service does not have (`class-validator` for the DTO,
   `@nestjs/schedule` for the job, TypeORM, zod) is left out, and the script says which.
2. writes `test/setup/project.ts` from what it finds: how the schema is built (Prisma, or folders
   of numbered `.sql` files), which env variables the app reads for its database (`DB_HOST`,
   `MYSQL_HOST`, ... from the code and `.env.example`), and `testEnv`: the settings the app needs
   just to load, taken from `.env.example`. **Check all three once.**
3. if the service's `tsconfig.json` is only for its build (it limits `types`, sets `rootDir`, or
   leaves out `test/`), adds a `tsconfig.test.json` that also checks the tests, and keeps test
   files (and the examples) out of the build so `npm run build` never compiles them
4. adds `test:unit`, `test:unit:watch`, `test:unit:coverage`, `test:integration`, and `typecheck`
   and `check` if the service does not have them; adds `coverage/` to `.gitignore`
5. installs only the packages the service does not already have (its own jest, supertest or
   mysql2 stay at their versions), with npm, pnpm, yarn or bun
6. runs the unit tests once, then deletes the download

It changes nothing if a kit file already exists (`--force` overwrites them, but never
`project.ts`). `--help` lists the options.

**A new NestJS 12 project** comes with Vitest. The script converts an untouched template to Jest:
it removes the two `vitest.config*.ts` files and the Vitest packages, points `test`, `test:watch`,
`test:cov`, `test:debug` and `test:e2e` at Jest, switches the tsconfig `types` to `jest`, and fixes
the template's `supertest/types` import, which fails `tsc` with supertest 7.3. Its tests run
unchanged.

**A service with no database** (one that only calls other APIs): the script sets
`needsDatabase = false` when it finds no database library, migrations or database settings, and
`npm run test:integration` runs the e2e tests without Docker. A service that has a database
library it does not use (an old `mysql2` dependency, say) gets `true`: set it to `false` once.

**A config module that exits on import** (`env.ts` validating `process.env` and calling
`process.exit(1)`): put the settings it requires in `testEnv` in `project.ts`, with test values.
They are set before any test file loads; a value already in the environment wins.

### Existing services: what the script stops on

**Already using Jest** with your own `jest.config.*` or a custom `"jest"` section? The script will
not touch it. Either merge by hand (the parts that matter are the SWC `transform`,
`setupFilesAfterEnv`, and for integration tests `globalSetup`), or move your settings aside and let
the kit's config replace them. NestJS's own default `"jest"` section is replaced automatically.

**Already using Vitest** with tests of your own? The script refuses to add a second runner.

**Tests named `*.test.ts`?** The kit looks for `*.spec.ts`. Rename them, or widen `testMatch` in
`jest.config.cjs`.

**ESLint:** add `...testingConfig` from `eslint.testing.mjs` to your `eslint.config.*` (the script
prints the two lines; config shapes vary too much to edit it for you).

## Building the schema

`migrate(db)` in `test/setup/project.ts` builds the schema in the empty test database, once per
run. Use the same migrations production uses: a migration that cannot run on an empty database
then fails here, in the test run, instead of on the next new environment.

```ts
// Numbered .sql files (setup.sh writes this when it finds them)
await runSqlFiles(db, 'db/migrations');

// Prisma 7 and earlier (setup.sh writes this when it finds Prisma). Prisma 8, a release
// candidate as of September 2026, replaces `migrate deploy`: write its equivalent by hand.
execSync('npx prisma migrate deploy', { stdio: 'inherit', env: { ...process.env, DATABASE_URL: db.url } });

// TypeORM (setup.sh writes this when it finds a DataSource with migrations): the DataSource reads
// env vars, so point them at the test database first (appEnv), then run its migrations
Object.assign(process.env, appEnv(db));
const { AppDataSource } = await import('../../src/data-source.js');
await AppDataSource.initialize();
await AppDataSource.runMigrations();
await AppDataSource.destroy();

// Knex (setup.sh writes this when it finds Knex migrations)
const { host, port, user, password, database } = db;
const knex = (await import('knex')).default({ client: 'mysql2', connection: { host, port, user, password, database } });
await knex.migrate.latest({ directory: 'migrations' });
await knex.destroy();
```

Anything else the schema needs goes here too: stored procedures, triggers kept outside the
numbered series, reference data. `runSqlFiles` understands `DELIMITER` blocks.

**Seed data.** Rows the migrations insert (lookup tables, a chart of accounts) are kept by
`resetDatabase()`: each table is trimmed back to its seeded rows, not emptied. Tests must not edit
seeded rows; they create their own.

## Writing tests

### Which example to copy

| The code you are writing | Copy | Kind of test |
|---|---|---|
| A utility function (money, dates, parsing) | `common/split-amount` | unit |
| A service with business rules | `nest/bookings/bookings.service` | unit, with a fake store and a fixed clock |
| A guard or role check | `nest/bookings/roles.guard` | unit (and over HTTP in `bookings-api`) |
| An interceptor or pipe | `nest/bookings/envelope.interceptor` | unit |
| A controller and its DTO | `nest/bookings-api` | API: validation, roles, status codes |
| A scheduled job, or code that sends email / uploads / charges | `nest/reminders` | unit, with the SDK behind a small class you fake |
| A repository or custom query (TypeORM) | `nest/typeorm` | integration, real MySQL |
| Plain SQL, a transaction | `common/notes-repository` | integration, real MySQL |
| An Express route that calls another service | `express/members` | API: supertest + MSW |
| Express middleware and body validation | `express/auth` | unit, then API |

### Walkthrough: writing a service and its tests

The worked example is `nest/bookings`: booking a hall. The finished files are in the kit.

**1. List the rules before writing code.** Each becomes a test:

- an unknown hall is refused (404)
- a date in the past is refused (400); today is allowed
- a booking bigger than the places left that day is refused (409), and says how many are left
- exactly filling the hall is allowed; one guest more is not
- a refused booking saves nothing
- the contact email is stored trimmed and lower-case

**2. Give the service dependencies you can replace.** The service needs storage and "today":

```ts
@Injectable()
export class BookingsService {
  constructor(private readonly store: BookingsStore, private readonly clock: Clock) {}
```

`BookingsStore` is a small abstract class with the five things the service needs
(`findHall`, `guestsBooked`, `save`, ...), not TypeORM's whole `Repository`. That keeps the unit
test simple: an in-memory fake (`in-memory-bookings.store.ts`) instead of mocking a query-builder
chain. `Clock` is "now", injected, so a test can pick the date.

**3. Write the unit tests** (`bookings.service.spec.ts`). Construct the service directly with the
fake and a fixed clock, and state only what each test is about:

```ts
beforeEach(() => {
  store = new InMemoryBookingsStore();
  service = new BookingsService(store, new FixedClock(new Date('2026-09-24T10:00:00Z')));
});

it.each([
  [60, 'fills the hall exactly', true],
  [61, 'is one guest over', false]
])('with 40 of 100 places taken, a booking of %i (%s) is accepted: %s', async (guests, _label, accepted) => {
  const hall = store.addHall({ capacity: 100 });
  await service.create(request({ hallId: hall.id, guests: 40 }));

  const attempt = service.create(request({ hallId: hall.id, guests }));

  if (accepted) await expect(attempt).resolves.toMatchObject({ guests });
  else await expect(attempt).rejects.toThrow(ConflictException);
});
```

`request({ ... })` is a test data builder: a valid booking with defaults, where each test changes
only the field it is about.

**4. Test the endpoint over HTTP** (`bookings-api/bookings.controller.spec.ts`). The controller has
no rules of its own; what it adds is HTTP: the DTO's validation, the role check, status codes and
the response shape. Replace the service and send real requests:

```ts
it.each([
  ['zero guests', { guests: 0 }, 'guests'],
  ['an invalid email', { contactEmail: 'asha' }, 'contactEmail'],
  ['a field the API does not accept', { discount: 50 }, 'discount']
])('answers 400 for %s', async (_label, change, mentioned) => {
  const res = await post({ ...valid, ...change });

  expect(res.status).toBe(400);
  expect(bookings.create).not.toHaveBeenCalled();
});
```

**5. Test the real store against MySQL** (`typeorm/typeorm-bookings.store.int-spec.ts`). The fake
proves the rules; only the database proves the SUM counts that hall on that date and nothing else:

```ts
it('adds up the guests for that hall on that date only', async () => {
  await booking(main.id, '2026-10-01', 30);
  await booking(main.id, '2026-10-01', 12);
  await booking(main.id, '2026-10-02', 50); // another day
  await booking(annex.id, '2026-10-01', 70); // another hall

  await expect(store.guestsBooked(main.id, '2026-10-01')).resolves.toBe(42);
});
```

The last test there runs the service with the real store: the full path, once.

**6. Break it on purpose.** Change `>` to `>=` in the capacity check, or drop the date from the
query, and run the tests: one must fail. Every example in the kit was checked this way.

What the example shows:

- **Rules in the service, HTTP in the controller, SQL in the store**: each tested where it lives,
  so each test is small and fails for one reason.
- **Fakes for what you own, MSW or a wrapper class for what you do not.** The reminders job sends
  email through a `Mailer` class of its own; its test uses a fake mailer that records messages and
  can be told to fail.
- **Time is a parameter.** Tests run in UTC (the kit sets `TZ=UTC`; `TEST_TZ=Asia/Kathmandu npm
  run test:unit` tries another zone), and "today" comes from the clock, so date rules are testable.

### A unit test

`examples/common/split-amount.spec.ts`: a function in, a value out. Name each test as a sentence,
test both sides of every limit, and use `it.each` for rules that must hold on many inputs.

### An API test (no database)

`examples/express/members-app.spec.ts`: requests go into the app with supertest; the other
service it calls is faked with `fakeApis` (MSW).

```ts
fakeApis.use(http.get(`${MEMBERS_API}/members/:id`, () => HttpResponse.json({ id: 7, name: 'Asha' })));

const res = await request(app).get('/api/members/7').set('Authorization', 'Bearer abc');

expect(res.status).toBe(200);
```

Test every way the other service can answer (404, 500, unreachable with `HttpResponse.error()`),
and what the client gets for each. A request to an outside address the test did not fake fails
the test, so no test reaches a real service.

The kit starts MSW before any test file loads, so code that keeps a reference to `fetch` when its
module loads (`const fetchFn = global.fetch`) gets the faked one too.

For this to work, **build the app in one function and listen in another**:
`export function createApp()` in `app.ts`, `createApp().listen(port)` in `server.ts`. A file that
does both cannot be imported by a test without starting a server.

If the app is built and started in the same file (`server.ts` calls `app.listen()`), test one
router at a time until it is split: mount it the way the server does.

```ts
const app = express();
app.use(express.json());
app.use(cookieParser());
app.use('/api/leave-types', leaveTypesRoutes);
```

NestJS: `examples/nest/members.controller.spec.ts` builds a testing module with the real
controller and a replaced service, then calls it with `request(app.getHttpServer())`.

### An integration test (real MySQL)

`examples/common/notes-repository.int-spec.ts`:

```ts
import { resetDatabase, testDb } from '../../../test/helpers/database.js';

beforeEach(() => resetDatabase());

it('saves none of the notes when one of them fails', async () => {
  await expect(notes.createAll([{ title: 'One' }, { title: 'One' }])).rejects.toMatchObject({ code: 'ER_DUP_ENTRY' });

  expect(await notes.list()).toEqual([]);
});
```

- `resetDatabase()` in `beforeEach`: every test starts from the migrated state.
- Arrange with the code under test or with `testDb()` (a mysql2 pool); check results in the
  database, not only in return values. A count after a failed write proves nothing was saved.
- In NestJS, build a testing module with `TypeOrmModule.forRoot(...)` pointed at the env that
  `appEnv()` set, plus only the providers the test needs; or import the whole `AppModule` in an
  `*.e2e-spec.ts` and call it over HTTP.
- Test files run one at a time (they share the database). Keep each file's setup in `beforeAll`.

`docs/backend-testing-practices.md` lists the cases each kind of code needs; when something fails
in a way you do not recognise, see [`docs/troubleshooting.md`](docs/troubleshooting.md).

## Commands

```bash
npm run test:unit                                  # unit and API tests
npm run test:unit:watch                            # re-runs affected tests on save
npx jest members-app                               # one file (any part of the path)
npx jest -t "passes the caller's token"            # tests whose name matches
npm run test:unit:coverage                         # coverage/ (open coverage/lcov-report/index.html)
npm run test:integration                           # integration and e2e, real MySQL
TESTCONTAINERS_REUSE_ENABLE=true npm run test:integration   # keep the container: ~2s startup
npm run check                                      # lint + typecheck + unit, before pushing
```

## CI

`ci/backend-tests.yml` runs `npm run check` and `npm run test:integration` on every pull request.
GitHub's Ubuntu runners have Docker, so Testcontainers works with no extra setup. Copy it to
`.github/workflows/` and adjust the Node version.

## Why SWC (and when ts-jest)

ts-jest with type-checking checks every test file, in every Jest worker. On a large NestJS service that is
minutes per run and over a gigabyte of memory per worker; seven workers can exhaust a laptop. SWC
only strips the types (a few MB per worker) and `npm run typecheck` checks them once. Decorators
and `emitDecoratorMetadata`, which NestJS and TypeORM need, are configured in `jest.base.cjs`.

One exception: TypeORM entities that import each other fail under SWC ("Cannot access 'Role'
before initialization"). For TypeORM projects on TypeScript 6 or earlier, setup.sh switches the
kit to ts-jest in transpile-only mode (`compiler = 'ts-jest'` in `jest.base.cjs`): TypeScript's own
output, still without type-checking. On a NestJS + TypeORM service with 665 tests that ran in about
40 seconds on two workers, where type-checking ts-jest had taken over ten minutes.

Mocks: the kit clears call history between tests (`clearMocks`) and leaves implementations
alone, so suites that set up mocks once in a `jest.mock()` factory keep working.
