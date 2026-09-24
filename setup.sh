#!/usr/bin/env bash
# Adds the backend test setup (Jest + SWC, supertest, MSW, Testcontainers MySQL) to the Node.js
# service in the current directory. Run it from the service's root:
#
#   curl -fsSL <url>/setup.sh | bash
#   curl -fsSL <url>/setup.sh | bash -s -- --examples     also copy the reference tests
#
# It downloads the kit to a temporary folder, copies the files, fills in test/setup/project.ts
# from what it finds (how the project migrates, which env variables point at the database),
# adds npm scripts, installs the dev dependencies, checks that Jest starts, and deletes the
# download. It never overwrites an existing file unless you pass --force, and never overwrites
# test/setup/project.ts.

set -euo pipefail

# Everything is inside main() so that `curl ... | bash` reads the whole script before running
# any of it; otherwise a command that reads stdin could swallow the rest of the script.
main() {
  local repo_url="${QA_KIT_REPO:-https://github.com/praharshaAdhikari/backend-test-kit.git}"
  local ref="${QA_KIT_REF:-main}"
  local examples=0 force=0 install=1

  while [ $# -gt 0 ]; do
    case "$1" in
      --examples) examples=1 ;;
      --force) force=1 ;;
      --no-install) install=0 ;;
      -h | --help)
        usage
        return 0
        ;;
      *) fail "Unknown option: $1 (try --help)" ;;
    esac
    shift
  done

  # --- Preflight ---------------------------------------------------------------------------

  command -v node >/dev/null || fail "node is not installed."
  command -v npm >/dev/null || fail "npm is not installed."
  [ -f package.json ] || fail "No package.json here. Run this from the root of the service."
  [ -f tsconfig.json ] || fail "No tsconfig.json here. The kit is for TypeScript services."

  local project
  project="$(node -e '
    const p = require("./package.json");
    const deps = { ...p.dependencies, ...p.devDependencies };
    const framework = deps["@nestjs/core"] ? "nest" : deps.express ? "express" : "other";
    console.log(JSON.stringify({
      framework,
      vitest: Boolean(deps.vitest),
      jest: deps.jest || null,
      deps: Object.keys(deps)
    }));
  ')"
  local framework
  framework="$(node -e "console.log(JSON.parse(process.argv[1]).framework)" "$project")"

  # NestJS 12's new-project template uses Vitest. An untouched one is converted to Jest (its
  # tests use only describe/it/expect, which Jest runs as they are); a project with its own
  # Vitest tests or config is left alone.
  local convert_vitest=0
  if [ "$(node -e "console.log(JSON.parse(process.argv[1]).vitest)" "$project")" = true ]; then
    if [ "$framework" = nest ] && is_nest_vitest_template; then
      convert_vitest=1
    else
      fail "This service already uses Vitest. Keep one test runner: see 'Already using Vitest?' in the kit README."
    fi
  fi

  local other
  for other in jest.config.js jest.config.ts jest.config.mjs jest.config.json; do
    [ -e "$other" ] && fail "$other already exists. Merge the kit's jest.config.cjs into it by hand: see 'Already using Jest?' in the kit README."
  done

  # A "jest" section in package.json: NestJS's scaffold default is replaced (the kit's config
  # does the same job with SWC); anything else is someone's configuration, so stop.
  local jest_key_action=none
  if node -e 'process.exit(require("./package.json").jest ? 0 : 1)'; then
    if node -e '
      const j = require("./package.json").jest;
      const nestDefault = j.rootDir === "src" && j.testRegex === ".*\\.spec\\.ts$" &&
        Object.values(j.transform || {}).includes("ts-jest");
      process.exit(nestDefault ? 0 : 1);
    '; then
      jest_key_action=remove
    else
      fail "package.json has a custom \"jest\" section. Merge the kit's jest.config.cjs into it by hand: see 'Already using Jest?' in the kit README."
    fi
  fi

  local source_dir=.
  local candidate
  for candidate in src server app lib; do
    if [ -d "$candidate" ]; then source_dir="$candidate"; break; fi
  done

  # --- Download ----------------------------------------------------------------------------

  local tmp kit
  tmp="$(mktemp -d)"
  # shellcheck disable=SC2064 # expand $tmp now
  trap "rm -rf '$tmp'" EXIT

  if [ -n "${QA_KIT_DIR:-}" ]; then
    kit="$(cd "$QA_KIT_DIR" && pwd)"
    step "Using the kit at $kit"
  else
    command -v git >/dev/null || fail "git is not installed."
    step "Downloading the kit from $repo_url ($ref)"
    git clone --quiet --depth 1 --branch "$ref" "$repo_url" "$tmp/kit" ||
      fail "Could not download $repo_url"
    kit="$tmp/kit"
  fi
  [ -f "$kit/jest.integration.config.cjs" ] || fail "$kit does not look like the backend-test-kit repo."

  # --- Copy --------------------------------------------------------------------------------

  step "Copying files"
  local files=(
    jest.config.cjs
    jest.integration.config.cjs
    eslint.testing.mjs
    test/setup/jest.base.cjs
    test/setup/tsconfig.cjs
    test/setup/tsconfig.jest.json
    test/setup/jest.setup.ts
    test/setup/global-setup.cjs
    test/setup/global-setup.ts
    test/setup/global-teardown.ts
    test/setup/test-database.ts
    test/helpers/database.ts
    test/helpers/fake-apis.ts
  )
  local conflicts=() file
  for file in "${files[@]}"; do
    [ -e "$file" ] && conflicts+=("$file")
  done
  if [ "$examples" = 1 ] && [ -e "$source_dir/examples" ]; then conflicts+=("$source_dir/examples"); fi
  if [ "${#conflicts[@]}" -gt 0 ] && [ "$force" = 0 ]; then
    fail "These already exist: ${conflicts[*]}. Nothing was changed. Merge them by hand, or re-run with --force to overwrite."
  fi

  for file in "${files[@]}"; do
    mkdir -p "$(dirname "$file")"
    cp "$kit/$file" "$file"
    echo "  $file"
  done

  if [ "$convert_vitest" = 1 ]; then
    convert_nest_vitest_template
  fi

  if [ "$jest_key_action" = remove ]; then
    node -e '
      const fs = require("fs");
      const p = JSON.parse(fs.readFileSync("package.json", "utf8"));
      delete p.jest;
      fs.writeFileSync("package.json", JSON.stringify(p, null, 2) + "\n");
    '
    echo "  package.json: removed NestJS's default \"jest\" section (jest.config.cjs replaces it)"
  fi

  # --- test/setup/project.ts ---------------------------------------------------------------

  step "Writing test/setup/project.ts"
  if [ -e test/setup/project.ts ]; then
    echo "  kept yours: test/setup/project.ts is this project's own settings"
  else
    cp "$kit/test/setup/project.ts" test/setup/project.ts
    KIT_SOURCE_DIR="$source_dir" node - <<'NODE'
const fs = require('fs');
const path = require('path');

const skip = new Set(['node_modules', 'dist', 'build', 'coverage', '.git', '.next', 'test']);
function walk(dir, depth, found) {
  if (depth > 4) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory() || skip.has(entry.name) || entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    const sql = fs.readdirSync(full).filter(f => /^\d+.*\.sql$/i.test(f) && !/rollback/i.test(f));
    if (sql.length > 0) found.push({ dir: full, count: sql.length });
    walk(full, depth + 1, found);
  }
}

/** A TypeORM DataSource that has migrations configured: { file, name } or undefined. */
function typeormDataSource() {
  const files = [];
  (function collect(dir, depth) {
    if (depth > 4 || !fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!skip.has(entry.name) && !entry.name.startsWith('.')) collect(full, depth + 1);
      } else if (/\.ts$/.test(entry.name) && !/\.(spec|int-spec|e2e-spec|d)\.ts$/.test(entry.name)) {
        files.push(full);
      }
    }
  })('.', 0);
  for (const file of files) {
    const text = fs.readFileSync(file, 'utf8');
    if (!/new DataSource\(/.test(text) || !/\bmigrations\s*:/.test(text)) continue;
    const named = text.match(/export\s+const\s+(\w+)\s*=\s*new DataSource\(/);
    const name = named ? named[1] : /export\s+default\s+new DataSource\(/.test(text) ? 'default' : null;
    if (name) return { file: file.replace(/^\.\//, '').split(path.sep).join('/'), name };
  }
  return undefined;
}

/** The Knex migrations folder: from the knexfile if it names one, else ./migrations. */
function knexMigrations() {
  const pkgDeps = JSON.parse(fs.readFileSync('package.json', 'utf8'));
  if (!{ ...pkgDeps.dependencies, ...pkgDeps.devDependencies }.knex) return undefined;
  const knexfile = ['knexfile.ts', 'knexfile.js', 'knexfile.cjs', 'knexfile.mjs'].find(f => fs.existsSync(f));
  const named = knexfile && fs.readFileSync(knexfile, 'utf8').match(/directory\s*:\s*['"]([^'"]+)['"]/);
  const dir = (named ? named[1] : 'migrations').replace(/^\.\//, '');
  const hasFiles = fs.existsSync(dir) && fs.readdirSync(dir).some(f => /\.(ts|js|cjs|mjs)$/.test(f));
  return hasFiles ? dir : undefined;
}

// How the schema is built.
const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const deps = { ...pkg.dependencies, ...pkg.devDependencies };
const databaseDeps = ['mysql2', 'mysql', 'typeorm', '@nestjs/typeorm', 'prisma', '@prisma/client', 'knex',
  'sequelize', 'drizzle-orm', '@mikro-orm/core', 'kysely'];
const hasDatabaseLibrary = databaseDeps.some(name => deps[name]);
const found = [];
walk('.', 0, found);
found.sort((a, b) => b.count - a.count);
let migrate;
let summary;
const prismaMajor = (() => {
  try {
    return parseInt(JSON.parse(fs.readFileSync('node_modules/prisma/package.json', 'utf8')).version, 10);
  } catch {
    return NaN;
  }
})();
if ((deps.prisma || deps['@prisma/client'] || fs.existsSync('prisma/schema.prisma')) && prismaMajor >= 8) {
  // Prisma 8 replaces `migrate deploy` with a different migration model; not verified yet.
  migrate = [
    "  // Prisma 8 changed how migrations are applied (prisma db migrate). Run the equivalent of",
    "  // `migrate deploy` here with DATABASE_URL set to db.url.",
    `  throw new Error('test/setup/project.ts: migrate() is not set up for Prisma ${prismaMajor} yet.');`
  ].join('\n');
  summary = `Prisma ${prismaMajor}: fill in migrate() (the kit knows Prisma 7 and earlier)`;
} else if (deps.prisma || deps['@prisma/client'] || fs.existsSync('prisma/schema.prisma')) {
  migrate = [
    "  // Prisma: apply the committed migrations, as a deploy does.",
    "  const { execSync } = await import('node:child_process');",
    "  execSync('npx prisma migrate deploy', { stdio: 'inherit', env: { ...process.env, DATABASE_URL: db.url } });"
  ].join('\n');
  summary = 'Prisma migrations (npx prisma migrate deploy)';
} else if (typeormDataSource()) {
  const { file, name } = typeormDataSource();
  const imported = name === 'default' ? 'default: dataSource' : name === 'dataSource' ? 'dataSource' : `${name}: dataSource`;
  migrate = [
    "  // TypeORM: the app's DataSource reads its settings from the environment, so point it at the",
    "  // test database first, then run its migrations.",
    "  Object.assign(process.env, appEnv(db));",
    `  const { ${imported} } = await import('../../${file.replace(/\.ts$/, '.js')}');`,
    "  await dataSource.initialize();",
    "  await dataSource.runMigrations();",
    "  await dataSource.destroy();"
  ].join('\n');
  summary = `TypeORM migrations, through the DataSource in ${file}`;
} else if (knexMigrations()) {
  const dir = knexMigrations();
  migrate = [
    "  // Knex: run its migrations against the test database.",
    "  const { host, port, user, password, database } = db;",
    "  const knex = (await import('knex')).default({ client: 'mysql2', connection: { host, port, user, password, database } });",
    `  await knex.migrate.latest({ directory: '${dir}' });`,
    "  await knex.destroy();"
  ].join('\n');
  summary = `Knex migrations in ${dir}/`;
} else if (found.length > 0) {
  const dir = found[0].dir.replace(/^\.\//, '').split(path.sep).join('/');
  migrate = `  // Numbered .sql files, run in name order (rollbacks skipped).\n  await runSqlFiles(db, '${dir}');`;
  summary = `${found[0].count} SQL migration files in ${dir}/`;
}
if (!migrate) {
  migrate = [
    "  // Nothing detected. Tell the tests how to build the schema: see 'Building the schema' in",
    "  // the kit README (plain SQL files, TypeORM, Prisma, Knex, Sequelize).",
    "  throw new Error('test/setup/project.ts: migrate() does not know how to build this project\\'s schema yet.');"
  ].join('\n');
  summary = 'nothing found: fill in migrate() before running integration tests';
}

// Which environment variables point the app at its database. A prefix counts when it has a
// HOST and a database-ish member (DB, NAME, DATABASE) and is not another service's.
const names = new Set();
const envFiles = ['.env.example', '.env.template', '.env.sample', '.env.dist'].filter(f => fs.existsSync(f));
for (const f of envFiles) {
  for (const m of fs.readFileSync(f, 'utf8').matchAll(/^[ \t]*([A-Z][A-Z0-9_]*)[ \t]*=/gm)) names.add(m[1]);
}
function scan(dir, depth) {
  if (depth > 6) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!skip.has(entry.name) && !entry.name.startsWith('.')) scan(full, depth + 1);
    } else if (/\.(ts|js)$/.test(entry.name)) {
      for (const m of fs.readFileSync(full, 'utf8').matchAll(/process\.env\.([A-Z][A-Z0-9_]*)/g)) names.add(m[1]);
    }
  }
}
const sourceDir = process.env.KIT_SOURCE_DIR;
scan(sourceDir, 0);
for (const f of ['ormconfig.ts', 'ormconfig.js', 'data-source.ts', 'knexfile.ts', 'knexfile.js']) {
  if (fs.existsSync(f)) for (const m of fs.readFileSync(f, 'utf8').matchAll(/process\.env\.([A-Z][A-Z0-9_]*)/g)) names.add(m[1]);
}

const roles = [
  ['host', /_HOST(NAME)?$/],
  ['port', /_PORT$/],
  ['user', /_(USER|USERNAME)$/],
  ['password', /_(PASS|PASSWORD|PWD)$/],
  ['database', /_(DB|NAME|DATABASE|DBNAME|SCHEMA)$/]
];
const otherServices = /REDIS|SMTP|MAIL|S3|AWS|MONGO|RABBIT|KAFKA|ELASTIC|STRIPE|SQUARE|SENTRY|APP_|SERVER_/;
// Connection tuning and container-only settings, not "where is the database".
const notConnection = /STRICT|ROOT|HOST_PORT|SSL|POOL|TIMEOUT|LIMIT|CHARSET|LOGGING|SYNC/;
const env = [];
const prefixes = new Set([...names].filter(n => /_HOST(NAME)?$/.test(n)).map(n => n.replace(/_HOST(NAME)?$/, '')));
for (const prefix of prefixes) {
  if (otherServices.test(`${prefix}_`)) continue;
  const members = [...names].filter(n => n.startsWith(`${prefix}_`));
  if (!members.some(n => /_(DB|NAME|DATABASE|DBNAME)$/.test(n))) continue;
  for (const name of members) {
    if (notConnection.test(name.slice(prefix.length))) continue;
    const role = roles.find(([, re]) => re.test(name.slice(prefix.length)));
    if (role) env.push(`    ${name}: ${role[0] === 'port' ? 'String(db.port)' : `db.${role[0]}`},`);
  }
}
const lines = env.length > 0 ? env.join('\n') + '\n' : '';

// A service has a database if it has a database library, migrations, or database settings.
const needsDatabase = hasDatabaseLibrary || found.length > 0 || env.length > 0 ||
  fs.existsSync('prisma/schema.prisma');
if (!needsDatabase) {
  migrate = '  void db; // needsDatabase is false above: this runs only if you turn it on.';
  summary = 'no database library, migrations or database settings found: integration tests run without MySQL (needsDatabase = false)';
}

// testEnv: the example values from .env.example (committed, so not secrets), minus the database
// settings appEnv() sets and the ones Jest or the app decide themselves.
const testEnv = [];
const dbNames = new Set(env.map(line => line.trim().split(':')[0]));
for (const f of envFiles) {
  for (const m of fs.readFileSync(f, 'utf8').matchAll(/^[ \t]*([A-Z][A-Z0-9_]*)[ \t]*=[ \t]*(.*)$/gm)) {
    const [, name, raw] = m;
    const value = raw.replace(/\s+#.*$/, '').trim().replace(/^(['"])(.*)\1$/, '$2');
    if (!value || dbNames.has(name) || ['NODE_ENV', 'PORT', 'DATABASE_URL'].includes(name)) continue;
    if (!testEnv.some(line => line.startsWith(`  ${name}:`))) testEnv.push(`  ${name}: ${JSON.stringify(value)},`);
  }
}

let s = fs.readFileSync('test/setup/project.ts', 'utf8');
s = s.replace('  // __TEST_ENV__', testEnv.length > 0
  ? `  // From ${envFiles[0]}. Replace anything that looks real with a test value.\n${testEnv.join('\n')}`
  : '  // Nothing found in .env.example. Add what the app needs to load, e.g. API_URL: \'https://api.test\'');
if (!/\bawait\b/.test(migrate)) {
  // Nothing to await: a plain function (strict lint rejects async without await), and db still
  // referenced so it does not count as unused.
  if (!/void db;/.test(migrate)) migrate = `  void db;\n${migrate}`;
  s = s.replace('export async function migrate(db: TestDatabase): Promise<void> {',
    'export function migrate(db: TestDatabase): Promise<void> | void {');
}
s = s.replace('  // __MIGRATE__', migrate);
s = s.replace('export const needsDatabase = true; // __NEEDS_DATABASE__', `export const needsDatabase = ${needsDatabase};`);
s = s.replace('    // __APP_ENV__\n', lines);
fs.writeFileSync('test/setup/project.ts', s);
console.log(`  schema: ${summary}`);
console.log(`  settings for tests (testEnv): ${testEnv.length > 0 ? `${testEnv.length} from ${envFiles[0]}` : 'none found'}`);
console.log(`  database settings: ${env.length > 0 ? env.map(l => l.trim().split(':')[0]).join(', ') + ', DATABASE_URL' : 'DATABASE_URL only (none detected)'}`);
NODE
    echo "  Check both in test/setup/project.ts before the first integration run."
  fi

  # --- Examples ----------------------------------------------------------------------------

  if [ "$examples" = 1 ]; then
    step "Copying examples into $source_dir/examples/"
    rm -rf "$source_dir/examples"
    mkdir -p "$source_dir/examples"
    cp -R "$kit/examples/common" "$source_dir/examples/common"
    if [ "$framework" != other ]; then
      cp -R "$kit/examples/$framework" "$source_dir/examples/$framework"
    fi
    if [ "$source_dir" = . ]; then
      # One folder less between the examples and test/: drop one '../' from each path to test/.
      find ./examples -name '*.ts' -exec sed -i.bak -E "s#'\.\./((\.\./)*test/)#'\1#" {} + &&
        find ./examples -name '*.bak' -delete
    fi
    # Leave out examples that need packages this service does not have (examples/requires.json),
    # and the database examples when it has no database.
    KIT="$kit" SOURCE_DIR="$source_dir" node -e '
      const fs = require("fs");
      const path = require("path");
      const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
      const deps = { ...pkg.dependencies, ...pkg.devDependencies };
      const requires = JSON.parse(fs.readFileSync(process.env.KIT + "/examples/requires.json", "utf8"));
      const root = path.join(process.env.SOURCE_DIR, "examples");
      for (const [folder, needs] of Object.entries(requires)) {
        if (folder.startsWith("/") || !fs.existsSync(path.join(root, folder))) continue;
        const missing = needs.filter(name => !deps[name]);
        if (missing.length > 0) {
          fs.rmSync(path.join(root, folder), { recursive: true });
          console.log(`  (left out ${folder}: needs ${missing.join(", ")})`);
        }
      }
      const noDatabase = /needsDatabase = false/.test(fs.readFileSync("test/setup/project.ts", "utf8"));
      if (noDatabase) {
        for (const folder of ["common/notes-repository", "nest/typeorm"]) {
          const target = path.join(root, folder);
          const files = folder.includes("/notes-") ? fs.readdirSync(path.dirname(target))
            .filter(f => f.startsWith("notes-repository")).map(f => path.join(path.dirname(target), f)) : [target];
          for (const file of files) if (fs.existsSync(file)) fs.rmSync(file, { recursive: true });
        }
        console.log("  (left out the database examples: this service has no database)");
      }
    '
    find "$source_dir/examples" -name '*spec.ts' | sed 's/^/  /'
  fi

  # --- Compiler ----------------------------------------------------------------------------

  local compiler=swc
  if node -e '
    const fs = require("fs");
    const p = JSON.parse(fs.readFileSync("package.json", "utf8"));
    const deps = { ...p.dependencies, ...p.devDependencies };
    let tsMajor = NaN;
    try { tsMajor = parseInt(JSON.parse(fs.readFileSync("node_modules/typescript/package.json", "utf8")).version, 10); } catch {}
    // ESM projects (type: module) stay on SWC: ts-jest would emit ES modules there, and TypeORM
    // already requires ESM projects to wrap relations in Relation<>, which avoids the cycle.
    const commonJs = p.type !== "module";
    process.exit((deps.typeorm || deps["@nestjs/typeorm"]) && tsMajor < 7 && commonJs ? 0 : 1);
  '; then
    compiler=ts-jest
    sed -i.bak "s#^const compiler = 'swc'; // __COMPILER__#const compiler = 'ts-jest'; // TypeORM: see above#" test/setup/jest.base.cjs
    rm -f test/setup/jest.base.cjs.bak
    step "Compiler"
    echo "  ts-jest (transpile-only): in a CommonJS TypeORM project, entities that import each other"
    echo "  fail under SWC"
  fi

  # --- TypeScript --------------------------------------------------------------------------

  step "TypeScript"
  local typecheck_command
  typecheck_command="$(KIT="$kit" EXAMPLES_DIR="$( [ "$examples" = 1 ] && echo "$source_dir/examples" )" node - <<'NODE'
const fs = require('fs');
const path = require('path');
// Read without TypeScript's API: TypeScript 7 (the native compiler) does not have one.
const { readTsconfig } = require(`${process.env.KIT}/test/setup/tsconfig.cjs`);
const { compilerOptions: options, include } = readTsconfig(path.resolve('tsconfig.json'));
const coversTests = !include || include.some(p => /^(\.\/)?(\*\*|test)(\/|$)/.test(p));
// Without a "types" list, TypeScript 6 and later load no @types packages at all (5 loaded them
// all), so describe/it are unknown unless a config names jest.
const typesMissJest = !Array.isArray(options.types) || !options.types.includes('jest');
const rootDirTooNarrow = options.rootDir && path.resolve(options.rootDir) !== process.cwd();

if (!coversTests || typesMissJest || rootDirTooNarrow) {
  // The service's tsconfig is for its build: it leaves out test/, or only knows Node's types.
  // A second config checks the tests too, without changing what the build sees.
  const testConfig = {
    extends: './tsconfig.json',
    compilerOptions: {
      noEmit: true,
      rootDir: '.',
      types: Array.isArray(options.types) ? [...options.types, 'jest'] : ['node', 'jest']
    },
    include: [...(include ?? ['**/*']), 'test/**/*'],
    exclude: ['node_modules', 'dist', 'build', 'coverage']
  };
  if (!fs.existsSync('tsconfig.test.json')) {
    fs.writeFileSync('tsconfig.test.json', JSON.stringify(testConfig, null, 2) + '\n');
    console.error('  tsconfig.test.json: type-checks the code and test/ with Jest types');
  }

  // If the build compiles tsconfig.json itself (no tsconfig.build.json), keep test files out of it,
  // or `npm run build` fails on describe/it and ships the tests.
  const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
  const buildsWithMainConfig = !fs.existsSync('tsconfig.build.json') &&
    Object.values(pkg.scripts ?? {}).some(cmd => /(^|&&\s*|\s)tsc(\s|$)(?!.*-p\s)/.test(cmd) && !/--noEmit/.test(cmd));
  if (buildsWithMainConfig) {
    const patterns = ['**/*.spec.ts', '**/*.int-spec.ts', '**/*.e2e-spec.ts'];
    // The copied examples are for reading and running, not for shipping.
    if (process.env.EXAMPLES_DIR) patterns.push(`${process.env.EXAMPLES_DIR.replace(/^\.\//, '')}/**`);
    let text = fs.readFileSync('tsconfig.json', 'utf8');
    if (!patterns.every(p => text.includes(p))) {
      const quoted = patterns.map(p => JSON.stringify(p)).join(', ');
      if (/"exclude"\s*:\s*\[/.test(text)) {
        text = text.replace(/("exclude"\s*:\s*\[)(\s*)/, (m, head, space) => `${head}${space}${quoted}, `);
      } else {
        text = text.replace(/\}\s*$/, `,\n  "exclude": ["node_modules", "dist", ${quoted}]\n}\n`);
      }
      fs.writeFileSync('tsconfig.json', text);
      console.error('  tsconfig.json: test files excluded from the build');
    }
  }
  console.log('tsc -p tsconfig.test.json');
} else {
  console.log('tsc --noEmit');
}
NODE
)"
  echo "  typecheck: $typecheck_command"

  # --- package.json ------------------------------------------------------------------------

  step "Adding npm scripts"
  KIT="$kit" TYPECHECK="$typecheck_command" node - <<'NODE'
const fs = require('fs');
const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const { scripts } = JSON.parse(fs.readFileSync(`${process.env.KIT}/package.additions.json`, 'utf8'));
pkg.scripts ??= {};
const add = (name, command) => {
  if (pkg.scripts[name] === undefined) {
    pkg.scripts[name] = command;
    console.log(`  ${name}: ${command}`);
  } else if (pkg.scripts[name] !== command) {
    console.log(`  ${name}: kept yours ("${pkg.scripts[name]}"); the kit's is "${command}"`);
  }
};
for (const [name, command] of Object.entries(scripts)) add(name, command);
add('typecheck', process.env.TYPECHECK);
add('check', [pkg.scripts.lint ? 'npm run lint' : null, 'npm run typecheck', 'npm run test:unit'].filter(Boolean).join(' && '));
fs.writeFileSync('package.json', JSON.stringify(pkg, null, 2) + '\n');

// The coverage report is generated: keep it out of git.
if (fs.existsSync('.gitignore')) {
  const ignore = fs.readFileSync('.gitignore', 'utf8');
  if (!/^\/?coverage\/?$/m.test(ignore)) {
    fs.appendFileSync('.gitignore', `${ignore.endsWith('\n') ? '' : '\n'}coverage/\n`);
    console.log('  .gitignore: added coverage/');
  }
}
NODE

  # --- ESLint ------------------------------------------------------------------------------

  step "ESLint"
  local eslint_file=""
  for candidate in eslint.config.mjs eslint.config.js eslint.config.ts eslint.config.cjs; do
    if [ -e "$candidate" ]; then eslint_file="$candidate"; break; fi
  done
  if [ -z "$eslint_file" ]; then
    echo "  no eslint.config.* here: eslint.testing.mjs is ready for when there is one"
  elif grep -q testingConfig "$eslint_file"; then
    echo "  $eslint_file already uses testingConfig"
  else
    echo "  Add the test rules to $eslint_file (its shape varies, so this is by hand):"
    echo "    import { testingConfig } from './eslint.testing.mjs';"
    echo "    ...and add ...testingConfig to the exported array."
  fi

  # --- Install and check -------------------------------------------------------------------

  if [ "$install" = 1 ]; then
    local deps pm
    deps="$(KIT="$kit" PROJECT="$project" COMPILER="$compiler" node -e '
      const { devDependencies } = require(process.env.KIT + "/package.additions.json");
      const project = JSON.parse(process.env.PROJECT);
      // Only what the project does not have yet: its own versions of jest, supertest, mysql2, ...
      // stay as they are, so the kit never upgrades something under code that relies on it.
      const has = project.deps;
      const missing = Object.entries(devDependencies).filter(([n]) => !has.includes(n));
      if (has.includes("jest")) missing.splice(0, missing.length, ...missing.filter(([n]) => n !== "@types/jest"));
      if (process.env.COMPILER === "ts-jest" && !has.includes("ts-jest")) missing.push(["ts-jest", "^29.4.0"]);
      console.log(missing.map(([n, v]) => `${n}@${v}`).join(" "));
    ')"
    if [ -f pnpm-lock.yaml ]; then pm=pnpm
    elif [ -f yarn.lock ]; then pm=yarn
    elif [ -f bun.lock ] || [ -f bun.lockb ]; then pm=bun
    else pm=npm; fi

    step "Installing dev dependencies with $pm"
    # shellcheck disable=SC2086 # $deps is a space-separated list on purpose
    case "$pm" in
      pnpm)
        # pnpm 11 stops on install scripts nobody approved. The kit's packages bring these, and
        # none is needed (the tests pass without them): msw copies a browser worker; @swc/core
        # and unrs-resolver only check for their prebuilt binaries; ssh2 and cpu-features
        # (Testcontainers -> dockerode) are optional native speed-ups; protobufjs prints a
        # version check. Deny those; anything else is left for you to decide.
        pnpm add -D --config.strict-dep-builds=false $deps </dev/null
        if [ -f pnpm-workspace.yaml ] && grep -q 'set this to true or false' pnpm-workspace.yaml; then
          sed -i.bak -E "s/^( +(msw|'@parcel\\/watcher'|'@swc\\/core'|unrs-resolver|ssh2|cpu-features|protobufjs)): set this to true or false$/\\1: false/" pnpm-workspace.yaml
          rm -f pnpm-workspace.yaml.bak
          if grep -q 'set this to true or false' pnpm-workspace.yaml; then
            warn "pnpm-workspace.yaml lists packages waiting for a build decision. Run 'pnpm approve-builds'."
          else
            pnpm install </dev/null
          fi
        fi
        ;;
      yarn) yarn add -D $deps </dev/null ;;
      bun) bun add -d $deps </dev/null ;;
      npm) npm install -D --no-audit --no-fund $deps </dev/null ;;
    esac

    step "Checking that Jest starts"
    npx jest --passWithNoTests --maxWorkers=2 </dev/null
  fi

  step "Done"
  cat <<EOF
Next:
  npm run test:unit            unit and API tests (no Docker)
  npm run test:integration     tests against a real MySQL (needs Docker)
  npm run check                what CI runs; run it before pushing

Check test/setup/project.ts once: how the schema is built and which env variables the app reads.
How to write tests: https://github.com/praharshaAdhikari/backend-test-kit#writing-tests
EOF
}

# An untouched NestJS 12 template: its Vitest configs are the generated ones and no test file
# uses anything Vitest-specific.
is_nest_vitest_template() {
  node -e '
    const fs = require("fs");
    const configs = ["vitest.config.ts", "vitest.config.e2e.ts"].filter(f => fs.existsSync(f));
    if (!configs.includes("vitest.config.ts")) process.exit(1);
    for (const f of configs) {
      const s = fs.readFileSync(f, "utf8");
      if (!s.includes("vite-tsconfig-paths") || !/globals:\s*true/.test(s)) process.exit(1);
    }
    const walk = dir => fs.readdirSync(dir, { withFileTypes: true }).flatMap(e =>
      e.isDirectory() ? (["node_modules", "dist", ".git"].includes(e.name) ? [] : walk(dir + "/" + e.name))
        : /\.(ts|js)$/.test(e.name) ? [dir + "/" + e.name] : []);
    for (const f of walk(".")) {
      if (/vitest\.config/.test(f)) continue;
      const s = fs.readFileSync(f, "utf8");
      if (/from ["\x27]vitest["\x27]/.test(s) || /\bvi\.[a-zA-Z]/.test(s)) process.exit(1);
    }
  '
}

convert_nest_vitest_template() {
  rm -f vitest.config.ts vitest.config.e2e.ts
  node -e '
    const fs = require("fs");
    const p = JSON.parse(fs.readFileSync("package.json", "utf8"));
    for (const name of Object.keys(p.devDependencies || {})) {
      if (name === "vitest" || name.startsWith("@vitest/") || name === "vite-tsconfig-paths") delete p.devDependencies[name];
    }
    const jestScripts = {
      test: "jest",
      "test:watch": "jest --watch",
      "test:cov": "jest --coverage",
      "test:debug": "node --inspect-brk node_modules/.bin/jest --runInBand",
      "test:e2e": "jest --config jest.integration.config.cjs --passWithNoTests"
    };
    for (const [name, command] of Object.entries(p.scripts || {})) {
      if (!/\bvitest\b/.test(command)) continue;
      if (jestScripts[name]) p.scripts[name] = jestScripts[name];
      else delete p.scripts[name];
    }
    fs.writeFileSync("package.json", JSON.stringify(p, null, 2) + "\n");
    const ts = fs.readFileSync("tsconfig.json", "utf8");
    fs.writeFileSync("tsconfig.json", ts.replace(/"vitest\/globals"/g, "\"jest\""));
    // The template imports supertest/types, which supertest 7.3 no longer has, so tsc fails.
    const e2e = "test/app.e2e-spec.ts";
    if (fs.existsSync(e2e)) {
      const s = fs.readFileSync(e2e, "utf8");
      fs.writeFileSync(e2e, s.replace(/^import \{ App \} from .supertest\/types.;\n/m, "")
        .replace("INestApplication<App>", "INestApplication"));
    }
  '
  echo "  converted NestJS's Vitest template to Jest: removed vitest.config*.ts and the vitest packages,"
  echo "  pointed test, test:watch, test:cov, test:debug and test:e2e at Jest, and tsconfig types at jest"
}

usage() {
  cat <<'EOF'
Adds Jest, supertest, MSW and Testcontainers MySQL to the Node.js service in the current directory.

Usage: curl -fsSL <url>/setup.sh | bash -s -- [options]

Options:
  --examples     also copy the reference tests into <source folder>/examples/ (delete it when done)
  --force        overwrite kit files that already exist (never test/setup/project.ts)
  --no-install   copy and configure only; skip installing dependencies and the Jest check
  -h, --help     show this help

Environment:
  QA_KIT_REPO    git URL to download the kit from
  QA_KIT_REF     branch or tag (default: main)
  QA_KIT_DIR     use a local copy of the kit instead of downloading
EOF
}

step() { printf '\n\033[1m==> %s\033[0m\n' "$*"; }
warn() { printf '\033[33mwarning:\033[0m %s\n' "$*" >&2; }
fail() {
  printf '\033[31merror:\033[0m %s\n' "$*" >&2
  exit 1
}

main "$@"
