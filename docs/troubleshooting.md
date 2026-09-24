# Troubleshooting

Each problem with its message, cause and fix. Search this page for part of the message you see.

## Tests use all the memory / take minutes / the machine freezes

**Cause:** the service's old Jest config uses ts-jest, which type-checks the whole project in every
Jest worker: on a large NestJS service, over a gigabyte per worker, several workers at once.

**Fix:** use the kit's `jest.config.cjs` (SWC: no type-checking, a few MB per worker). Types are
still checked, once, by `npm run typecheck`. Until you switch, cap the workers:
`npx jest --maxWorkers=2`.

## "Must use import to load ES Module"

```
Must use import to load ES Module: .../node_modules/some-package/build/index.mjs
```

**Cause:** a package ships only ES modules, which Jest cannot load as they are. MSW's dependencies
do, and so does NestJS from version 12.

**Fix:** add the package name (as it appears after `node_modules/`) to `esmPackages` in
`test/setup/jest.base.cjs`. Run again; add the next one if another appears. NestJS 12 is detected
and added automatically.

## "Could not locate module ..." / "Cannot find module '@/...'"

**Cause:** a path alias Jest does not know. `jest.base.cjs` reads `paths` and `baseUrl` from
`tsconfig.json`; an alias defined somewhere else (a bundler, a second tsconfig) is not read.

**Fix:** put the alias in the root `tsconfig.json`, or add it to `moduleNameMapper` in
`jest.config.cjs`.

## "Could not find a working container runtime strategy"

**Cause:** Docker is not running, or your user cannot reach it.

**Fix:** start Docker (`docker info` should answer). On Linux, add yourself to the `docker` group
or use rootless Docker. Unit tests do not need Docker; only `npm run test:integration` does.

## "Migration db/migrations/005_x.sql failed on an empty database: ..."

**Cause:** that migration assumes something that only exists in an older database: a table
created by hand, a column added outside the migrations, data it expects to find.

**Fix:** fix the migration (make it create what it needs, or guard it with `IF NOT EXISTS`). This
is the test setup working: a new environment would have failed the same way.

## "No test database. Integration tests run with `npm run test:integration` ..."

**Cause:** a test uses `testDb()` or `resetDatabase()`, but it ran under `npm run test:unit` (it
is named `*.spec.ts`), or `needsDatabase` is `false` in `test/setup/project.ts`.

**Fix:** name it `*.int-spec.ts`, or set `needsDatabase = true`.

## "[MSW] Error: intercepted a request without a matching request handler"

**Cause:** the code called an outside API the test did not fake. On purpose: no test reaches a
real service.

**Fix:** `fakeApis.use(http.get('https://...', () => HttpResponse.json(...)))` before the request.
Check the method and the full URL, including the base URL the code reads from its config.

## "Jest did not exit one second after the test run has completed"

**Cause:** something still open: a database pool the test created itself, a Nest app not closed,
a timer, a server started with `listen()`.

**Fix:** close what you open in `afterAll` (`await app.close()`, `await pool.end()`). Use
`testDb()` rather than your own pool: the kit closes it. Test the app with supertest on
`createApp()` rather than a listening server. `npx jest --detectOpenHandles` shows what is open.

## The test process exits with "Environment validation failed" (or similar) before any test runs

**Cause:** a config module checks `process.env` when it is imported and calls `process.exit(1)`
when a required setting is missing. Importing any route imports it.

**Fix:** add the required settings to `testEnv` in `test/setup/project.ts`, with test values
(`API_URL: 'https://api.test'`). Outside APIs are faked, so they are never really called.

## A faked API is ignored and the test reaches the network (or fails with a DNS error)

**Cause:** the handler does not match (method, full URL including any `/api` prefix), or the code
uses an HTTP client MSW does not see (a custom agent, a native module).

**Fix:** log the URL the code calls, and match it exactly in `fakeApis.use(...)`. MSW sees
`fetch`, `http`/`https`, and clients built on them (axios, got, node-fetch).

## The app connects to the wrong database in tests

**Cause:** the app reads env variables that `appEnv()` in `test/setup/project.ts` does not set,
or reads them from a `.env` file that wins over the test values.

**Fix:** list every variable the app reads for its database in `appEnv()`. If the app loads
`.env` with `override: true`, turn that off in tests. For NestJS `ConfigModule`, values already in
`process.env` win over `.env`, which is what the kit relies on.

## A test passes on its own but fails with the others

**Cause:** leftover state: rows another test wrote (no `resetDatabase()`), a module-level
variable, a mock another file set up.

**Fix:** `beforeEach(() => resetDatabase())`, set up everything inside the test or `beforeEach`,
and run the pair together with `npx jest <file> -t "<name>"` to find which one leaks.
