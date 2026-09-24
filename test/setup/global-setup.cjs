const Module = require('node:module');

/**
 * Jest's globalSetup entry point. Jest runs globalSetup with Node's own require(), where the
 * moduleNameMapper that turns `./x.js` into `./x.ts` does not apply. For as long as the setup
 * runs (including files project.ts's migrate() loads later, such as a TypeORM DataSource), this
 * teaches require() the same thing, then undoes it. Jest compiles the .ts files it loads.
 */
module.exports = async function globalSetup(...args) {
  const resolve = Module._resolveFilename;
  Module._resolveFilename = function (request, ...rest) {
    try {
      return resolve.call(this, request, ...rest);
    } catch (error) {
      if (request.startsWith('.') && request.endsWith('.js')) {
        return resolve.call(this, request.slice(0, -3), ...rest);
      }
      throw error;
    }
  };
  try {
    return await require('./global-setup.ts').default(...args);
  } finally {
    Module._resolveFilename = resolve;
  }
};
