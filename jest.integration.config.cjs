const { baseConfig } = require('./test/setup/jest.base.cjs');

/**
 * Integration and end-to-end tests: `*.int-spec.ts` and `*.e2e-spec.ts`, against a real MySQL
 * that test/setup/global-setup.ts starts in Docker (Testcontainers) and migrates once per run.
 * Run with `npm run test:integration`. Needs Docker.
 */
module.exports = {
  ...baseConfig,
  displayName: 'integration',
  testMatch: ['<rootDir>/**/*.int-spec.ts', '<rootDir>/**/*.e2e-spec.ts'],
  globalSetup: '<rootDir>/test/setup/global-setup.cjs',
  globalTeardown: '<rootDir>/test/setup/global-teardown.ts',
  // One database for the whole run: test files take turns instead of racing each other.
  maxWorkers: 1,
  testTimeout: 30000
};
