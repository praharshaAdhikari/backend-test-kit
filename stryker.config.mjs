/**
 * Mutation testing (optional; `setup.sh --mutation` adds it). Stryker changes the code one small
 * piece at a time (`>` to `>=`, `&&` to `||`, a string to '') and runs the unit tests against
 * each change. A change no test notices "survived": that line can break without a test failing.
 * It is "break it on purpose", done for every line.
 *
 *   npm run test:mutation -- --mutate src/bookings/bookings.service.ts
 *
 * Run it on the file or folder you are working on, not the whole service (minutes per file).
 * Never in CI. The report is coverage/mutation/index.html.
 *
 * @type {import('@stryker-mutator/api/core').PartialStrykerOptions}
 */
const config = {
  testRunner: 'jest',
  jest: { configFile: 'jest.config.cjs' }, // the unit tests; integration tests are too slow for this
  coverageAnalysis: 'perTest', // each change is tested only by the tests that reach it
  mutate: [
    'src/**/*.ts',
    '!src/**/*.spec.ts',
    '!src/**/*.int-spec.ts',
    '!src/**/*.e2e-spec.ts',
    '!src/**/*.contract.ts',
    '!src/**/*.d.ts'
  ],
  reporters: ['clear-text', 'progress', 'html'],
  htmlReporter: { fileName: 'coverage/mutation/index.html' },
  cleanTempDir: 'always'
};

export default config;
