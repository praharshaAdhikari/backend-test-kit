import jest from 'eslint-plugin-jest';

/**
 * Test rules for the backend. Spread into eslint.config.mjs:
 *   import { testingConfig } from './eslint.testing.mjs';
 *   export default [...yourConfig, ...testingConfig];
 * Catches focused tests left in (`it.only`), tests with no assertion, and duplicate names.
 */
export const testingConfig = [
  // The kit's own config files are CommonJS (Jest loads them with require). Linted with a
  // TypeScript config they fail `no-require-imports`; they are the kit's, so they are skipped.
  {
    ignores: [
      'jest.config.cjs',
      'jest.integration.config.cjs',
      'test/setup/global-setup.cjs',
      'test/setup/jest.base.cjs',
      'test/setup/tsconfig.cjs'
    ]
  },
  {
    ...jest.configs['flat/recommended'],
    files: ['**/*.spec.ts', '**/*.int-spec.ts', '**/*.e2e-spec.ts', '**/*.contract.ts', 'test/**/*.ts'],
    rules: {
      ...jest.configs['flat/recommended'].rules,
      'jest/no-focused-tests': 'error',
      'jest/no-disabled-tests': 'warn',
      'jest/no-identical-title': 'error',
      // supertest's `.expect(200)` counts as an assertion too.
      'jest/expect-expect': ['error', { assertFunctionNames: ['expect', 'request.**.expect'] }]
    }
  },
  // A contract file (tests shared by several implementations, e.g. a fake and the real store)
  // exports the function that the spec files call.
  { files: ['**/*.contract.ts'], rules: { 'jest/no-export': 'off' } }
];
