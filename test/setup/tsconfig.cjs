const { existsSync, readFileSync } = require('node:fs');
const path = require('node:path');

/**
 * Reads a tsconfig.json the way TypeScript does, without TypeScript's JavaScript API (TypeScript 7,
 * the native compiler, does not have one). Handles comments, trailing commas and `extends` chains
 * (relative files and packages such as "@tsconfig/node22/tsconfig.json").
 *
 * Returns the merged compilerOptions, with `baseUrl` made absolute and `pathsBase` set to the
 * folder `paths` are relative to, plus the effective `include`.
 */
function readTsconfig(file) {
  const dir = path.dirname(file);
  const raw = parseJsonc(readFileSync(file, 'utf8'));
  const own = raw.compilerOptions ?? {};

  let merged = { compilerOptions: {}, include: undefined };
  const parents = raw.extends === undefined ? [] : [].concat(raw.extends);
  for (const parent of parents) {
    const parentFile = resolveExtends(parent, dir);
    if (parentFile) {
      const inherited = readTsconfig(parentFile);
      merged = {
        compilerOptions: { ...merged.compilerOptions, ...inherited.compilerOptions },
        include: inherited.include ?? merged.include
      };
    }
  }

  const compilerOptions = { ...merged.compilerOptions, ...own };
  if (own.baseUrl !== undefined) compilerOptions.baseUrl = path.resolve(dir, own.baseUrl);
  if (own.rootDir !== undefined) compilerOptions.rootDir = path.resolve(dir, own.rootDir);
  if (own.paths !== undefined) compilerOptions.pathsBase = compilerOptions.baseUrl ?? dir;
  else if (compilerOptions.paths && own.baseUrl !== undefined) compilerOptions.pathsBase = compilerOptions.baseUrl;

  return { compilerOptions, include: raw.include ?? merged.include };
}

function resolveExtends(name, fromDir) {
  const candidates = name.startsWith('.') || path.isAbsolute(name)
    ? [path.resolve(fromDir, name), path.resolve(fromDir, `${name}.json`)]
    : [];
  for (const candidate of candidates) if (existsSync(candidate)) return candidate;
  if (candidates.length > 0) return undefined;
  for (const request of [name, `${name}.json`, `${name}/tsconfig.json`]) {
    try {
      return require.resolve(request, { paths: [fromDir] });
    } catch {
      // try the next form
    }
  }
  return undefined;
}

/** JSON with comments and trailing commas, as tsconfig files allow. */
function parseJsonc(text) {
  let out = '';
  let inString = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inString) {
      out += c;
      if (c === '\\') out += text[++i] ?? '';
      else if (c === '"') inString = false;
    } else if (c === '"') {
      inString = true;
      out += c;
    } else if (c === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') i++;
      out += '\n';
    } else if (c === '/' && text[i + 1] === '*') {
      i += 2;
      while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i++;
      i++;
    } else {
      out += c;
    }
  }
  return JSON.parse(out.replace(/,(\s*[}\]])/g, '$1'));
}

module.exports = { readTsconfig };
