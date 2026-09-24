const { existsSync } = require('node:fs');
const path = require('node:path');
const { readTsconfig } = require('./tsconfig.cjs');

/**
 * Settings shared by jest.config.cjs (unit) and jest.integration.config.cjs.
 * Everything project-specific is worked out here at run time, so there is nothing to keep in
 * step by hand: path aliases come from tsconfig.json, and coverage from the source folder.
 */

const rootDir = path.resolve(__dirname, '..', '..');

// Every test run in UTC, whatever the machine's time zone, so date code gives the same answer on
// a laptop in Kathmandu and in CI. To test another zone, run with TEST_TZ=Asia/Kathmandu.
process.env.TZ = process.env.TEST_TZ ?? 'UTC';

/**
 * Packages in node_modules that ship only ES modules, which Jest cannot load as they are, so
 * they are compiled like the project's own code. MSW needs the first three. When a test fails
 * with "Must use import to load ES Module" for a file in node_modules, add its package here.
 */
const esmPackages = ['rettime', 'until-async', '@open-draft/deferred-promise'];

// NestJS 12 ships its packages as ES modules only (11 and earlier are CommonJS).
if (isEsmOnly('@nestjs/core')) esmPackages.push('@nestjs');

function isEsmOnly(name) {
  // Read from node_modules directly: packages that declare "exports" hide their package.json.
  const file = path.join(rootDir, 'node_modules', name, 'package.json');
  return existsSync(file) && JSON.parse(require('node:fs').readFileSync(file, 'utf8')).type === 'module';
}

/** The folder the code lives in: coverage is collected from here. */
const sourceDir = ['src', 'server', 'app', 'lib'].find(dir => existsSync(path.join(rootDir, dir))) ?? '.';

/**
 * tsconfig "paths" and "baseUrl" as Jest settings, so `import x from '@/lib/x'` works in tests as
 * it does in the build. Read by tsconfig.cjs, which follows `extends` and allows comments.
 */
function aliasesFromTsconfig() {
  const file = path.join(rootDir, 'tsconfig.json');
  if (!existsSync(file)) return { moduleNameMapper: {}, modulePaths: [] };
  const { compilerOptions: options } = readTsconfig(file);

  const moduleNameMapper = {};
  for (const [alias, targets] of Object.entries(options.paths ?? {})) {
    // `(.*?)(?:\.js)?` also accepts '@/lib/x.js', as ESM projects write it, and finds x.ts.
    const from = `^${alias.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace('*', '(.*?)(?:\\.js)?')}$`;
    moduleNameMapper[from] = targets.map(target => path.resolve(options.pathsBase, target).replace('*', '$1'));
  }
  // baseUrl on its own lets code import 'server/app/x' from the project root.
  const modulePaths = options.baseUrl ? [options.baseUrl] : [];
  return { moduleNameMapper, modulePaths };
}

/**
 * ESM TypeScript (NestJS 12's default, "module": "nodenext") writes relative imports with `.js`
 * ('./app.service.js') for files that are really .ts. Map those back so Jest finds them. Harmless
 * in CommonJS projects.
 */
function withRelativeJsImports(aliases) {
  return {
    ...aliases,
    moduleNameMapper: { ...aliases.moduleNameMapper, '^(\\.{1,2}/.*)\\.js$': '$1' }
  };
}

/**
 * SWC strips the types and compiles; it does not type-check (tsc and ESLint do that). That keeps
 * each Jest worker small and fast: ts-jest type-checks the whole project in every worker, which
 * on a large NestJS app is minutes per run and over a gigabyte of memory per worker.
 * The decorator settings are the ones NestJS and TypeORM need.
 */
const swc = [
  '@swc/jest',
  {
    jsc: {
      parser: { syntax: 'typescript', decorators: true },
      transform: { legacyDecorator: true, decoratorMetadata: true },
      target: 'es2022',
      keepClassNames: true
    },
    module: { type: 'commonjs' },
    sourceMaps: 'inline'
  }
];

/**
 * Which compiler turns TypeScript into what Jest runs:
 * - 'swc' (default): fastest.
 * - 'ts-jest': TypeScript's own output, without type-checking. For TypeORM entities that point
 *   at each other (User <-> Role): with SWC those circular imports fail with "Cannot access 'Role'
 *   before initialization"; TypeScript's output handles them as the build does. Needs TypeScript
 *   6 or earlier and a CommonJS project; setup.sh picks it for such TypeORM projects. (ESM
 *   projects wrap relations in TypeORM's Relation<> type, which avoids the problem under SWC.)
 * ES-module JavaScript from node_modules (esmPackages) always goes through SWC.
 */
const compiler = 'swc'; // __COMPILER__
const tsJest = ['ts-jest', { tsconfig: '<rootDir>/test/setup/tsconfig.jest.json' }];
const transform =
  compiler === 'ts-jest'
    ? { '^.+\\.[cm]?ts$': tsJest, '^.+\\.[cm]?js$': swc }
    : { '^.+\\.[cm]?[tj]s$': swc };

const ignoredFolders = ['/node_modules/', '/dist/', '/build/', '/coverage/'];

module.exports = {
  rootDir,
  sourceDir,
  baseConfig: {
    rootDir,
    testEnvironment: 'node',
    transform,
    // `\.pnpm` keeps pnpm's nested node_modules layout working.
    transformIgnorePatterns: [`/node_modules/(?!(?:\\.pnpm|${esmPackages.join('|')})/)`],
    ...withRelativeJsImports(aliasesFromTsconfig()),
    testPathIgnorePatterns: ignoredFolders,
    setupFilesAfterEnv: ['<rootDir>/test/setup/jest.setup.ts'],
    // Call history is cleared between tests. Implementations are left alone, so mocks a test file
    // sets up once (in a jest.mock factory, or beforeAll) keep working, as existing suites expect.
    clearMocks: true,
    collectCoverageFrom: [
      `<rootDir>/${sourceDir === '.' ? '' : `${sourceDir}/`}**/*.ts`,
      '!**/*.spec.ts',
      '!**/*.int-spec.ts',
      '!**/*.e2e-spec.ts',
      '!**/*.d.ts',
      '!**/examples/**',
      '!<rootDir>/test/**',
      ...ignoredFolders.map(folder => `!**${folder}**`)
    ],
    coverageReporters: ['text-summary', 'json-summary', 'html', 'lcov']
  }
};
