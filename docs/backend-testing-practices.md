# Backend testing practices

Short enough to read once, specific enough to review against.

## Who writes what

- **Unit and API tests** are written by the developer, with the code, in the same pull request.
  A change without them is not done.
- **Integration and end-to-end tests** are written by QA or by the developer who builds the
  feature, whoever is closer to it. They are reviewed like production code.
- **A bug fix** ships with a test that failed before the fix, at whatever level the bug lived
  (a wrong query needs an integration test; a wrong calculation a unit test).

## The rules

1. **Test behaviour, not implementation.** Assert what a caller gets back or what ends up in the
   database. Never assert that an internal method was called, or how a query was built.
2. **Do not mock what you own.** Mock only at the edge of the process: outside APIs (MSW,
   `fakeApis`), the clock (`jest.useFakeTimers()`), randomness, and in unit tests the module that
   talks to the database. If a test needs to mock a query builder chain
   (`createQueryBuilder().where().andWhere()...`), write an integration test instead: the mock
   cannot tell whether the SQL is right.
3. **One behaviour per test, named as a sentence.** `it('refuses a second note with the same
   title')`, not `it('works')`. Arrange, act, assert, with a blank line between each.
4. **Every test starts clean.** `resetDatabase()` in `beforeEach` for integration tests; nothing
   shared through module-level `let`. The kit resets mocks, env, timers and MSW handlers for you.
5. **Specific assertions.** The exact status, the exact body, the exact rows. No bare
   `toHaveBeenCalled()`, no `toBeTruthy()` on something with a real value.
6. **No real network, no real time.** A request to an address the test did not fake fails it.
   Pass the current time in (`now = new Date()` as a parameter) or use fake timers; never wait.
7. **Break it to prove it.** Before you commit a test, break the line it is about and watch it
   fail. A test that never failed proves nothing.

## Required tests, by kind of code

**Pure logic** (calculations, validation, date rules, state transitions)
- [ ] The normal case with realistic values
- [ ] Both sides of every limit, and zero, empty and negative
- [ ] Every rejection path, one table row each
- [ ] Money: whole cents, and the total of the parts equals the whole

**An HTTP endpoint** (Express route, NestJS controller), as an API test
- [ ] Success: status and the exact body (including that private fields are *not* in it)
- [ ] Invalid input: 400 and the error, and nothing downstream called
- [ ] Not signed in (401) and not allowed (403), for every endpoint that checks
- [ ] Not found (404)
- [ ] Each way a dependency fails, and what the caller gets for it

**A call to another service** (payment, email, a core API behind a backend-for-frontend)
- [ ] The request sent: URL, method, headers passed on (tokens), body
- [ ] The success response mapped to what the caller needs
- [ ] The other service's 4xx, its 5xx, and it being unreachable (`HttpResponse.error()`)
- [ ] Timeouts, if the code sets one (fake timers)

**Database code** (repositories, services with queries), as integration tests
- [ ] What is written: read it back from the database
- [ ] Filters and boundaries in the query (dates, statuses, ownership: only this user's rows)
- [ ] Constraints: unique keys, foreign keys, NOT NULL (the error the database raises)
- [ ] Transactions: when the second write fails, the first is not saved either
- [ ] Sums and money in SQL (DECIMAL), checked to the cent
- [ ] Triggers, if the schema has them: the rows they write

**Scheduled jobs and queues**
- [ ] The job's effect, called directly (not through the scheduler)
- [ ] Running it twice does not do the work twice
- [ ] What it does when a dependency fails halfway

## Reviewing a test

- [ ] The names read as a list of behaviours; the `it` names alone explain the feature
- [ ] Each required case for its kind of code (above) is present, or its absence is explained
- [ ] Mocks only at the edge (outside APIs, clock, randomness)
- [ ] Assertions are exact
- [ ] Integration tests reset the database and create their own rows
- [ ] Break the code the test is about: the test fails
