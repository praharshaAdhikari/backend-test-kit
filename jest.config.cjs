const { baseConfig } = require('./test/setup/jest.base.cjs');

/**
 * Unit tests: `*.spec.ts` next to the code. No Docker, no database: anything outside the process
 * is faked (outside APIs with MSW, the database by mocking the module that talks to it).
 * Run with `npm run test:unit`.
 */
module.exports = {
  ...baseConfig,
  displayName: 'unit',
  testMatch: ['<rootDir>/**/*.spec.ts'],
  // Half the cores: enough for speed, without taking the whole machine.
  maxWorkers: '50%'
};
