'use strict';

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function requirePackagePath() {
  const packagePath = process.env.RESOURCE_FINALIZER_TEST_PACKAGE;

  if (typeof packagePath !== 'string' || packagePath === '') {
    throw new Error('RESOURCE_FINALIZER_TEST_PACKAGE must point to the staged package.');
  }

  return path.resolve(packagePath);
}

function resolveModuleFile(filename) {
  const candidates = [filename, `${filename}.js`, path.join(filename, 'index.js')];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
      return candidate;
    }
  }

  throw new Error(`Cannot resolve staged module: ${filename}`);
}

function assertInside(rootPath, candidatePath) {
  const relativePath = path.relative(rootPath, candidatePath);

  if (
    relativePath === '' ||
    (!relativePath.startsWith(`..${path.sep}`) && relativePath !== '..' && !path.isAbsolute(relativePath))
  ) {
    return;
  }

  throw new Error(`Module escapes the staged package: ${candidatePath}`);
}

function createLoader(context, packagePath) {
  const cache = new Map();
  const distPath = path.join(packagePath, 'dist');

  function load(requestPath) {
    const filename = resolveModuleFile(requestPath);
    assertInside(distPath, filename);

    const existing = cache.get(filename);

    if (existing !== undefined) {
      return existing.exports;
    }

    const module = vm.runInContext('({ exports: {} })', context, { filename });
    cache.set(filename, module);

    const source = fs.readFileSync(filename, 'utf8');
    const wrapper = vm.runInContext(
      `(function (exports, require, module, __filename, __dirname) {\n${source}\n})`,
      context,
      { filename }
    );

    function localRequire(request) {
      if (typeof request !== 'string' || !request.startsWith('.')) {
        throw new Error(`Unexpected external dependency in staged package: ${String(request)}`);
      }

      return load(path.resolve(path.dirname(filename), request));
    }

    Reflect.apply(wrapper, module.exports, [module.exports, localRequire, module, filename, path.dirname(filename)]);

    return module.exports;
  }

  return {
    load: function loadEntry() {
      return load(path.join(distPath, 'index.js'));
    }
  };
}

function forceMissingPrimitives(context) {
  vm.runInContext(
    `
      const NativeSymbol = Symbol;
      function RealmSymbol(description) {
        return NativeSymbol(description);
      }
      Object.setPrototypeOf(RealmSymbol, NativeSymbol);
      Object.defineProperty(RealmSymbol, 'prototype', { value: NativeSymbol.prototype });
      Object.defineProperty(RealmSymbol, 'dispose', {
        value: undefined,
        writable: true,
        configurable: true
      });
      Object.defineProperty(RealmSymbol, 'asyncDispose', {
        value: undefined,
        writable: true,
        configurable: true
      });
      Object.defineProperty(this, 'Symbol', {
        value: RealmSymbol,
        writable: true,
        configurable: true
      });
      delete this.DisposableStack;
      delete this.AsyncDisposableStack;
      delete this.SuppressedError;
    `,
    context,
    { filename: 'force-missing-primitives.js' }
  );
}

function removeStackPrimitives(context) {
  vm.runInContext(
    `
      delete this.DisposableStack;
      delete this.AsyncDisposableStack;
      delete this.SuppressedError;
    `,
    context,
    { filename: 'remove-stack-primitives.js' }
  );
}

function ensureSymbolPrimitives(context) {
  vm.runInContext(
    `
      if (typeof Symbol.dispose === 'undefined') {
        Object.defineProperty(Symbol, 'dispose', { value: Symbol('preinstalled dispose') });
      }
      if (typeof Symbol.asyncDispose === 'undefined') {
        Object.defineProperty(Symbol, 'asyncDispose', { value: Symbol('preinstalled async dispose') });
      }
    `,
    context,
    { filename: 'ensure-symbol-primitives.js' }
  );
}

function removeGlobalThis(context) {
  vm.runInContext('delete globalThis.globalThis;', context, { filename: 'remove-global-this.js' });
}

function captureOriginalPrimitives(context) {
  return vm.runInContext(
    `
      ({
        SymbolDispose: Symbol.dispose,
        SymbolAsyncDispose: Symbol.asyncDispose,
        DisposableStack: typeof DisposableStack === 'undefined' ? undefined : DisposableStack,
        AsyncDisposableStack: typeof AsyncDisposableStack === 'undefined' ? undefined : AsyncDisposableStack,
        SuppressedError: typeof SuppressedError === 'undefined' ? undefined : SuppressedError
      })
    `,
    context,
    { filename: 'capture-original-primitives.js' }
  );
}

function readGlobals(context) {
  return vm.runInContext(
    '({ globalThis, Symbol, DisposableStack, AsyncDisposableStack, SuppressedError, Reflect, Object, Error, Promise })',
    context,
    { filename: 'read-installed-primitives.js' }
  );
}

function hasNativePrimitives() {
  const context = vm.createContext({});

  return vm.runInContext(
    `
      typeof Symbol.dispose === 'symbol' &&
      typeof Symbol.asyncDispose === 'symbol' &&
      typeof DisposableStack === 'function' &&
      typeof AsyncDisposableStack === 'function' &&
      typeof SuppressedError === 'function'
    `,
    context,
    { filename: 'check-native-primitives.js' }
  );
}

function createPackageRealm(options = {}) {
  const context = vm.createContext({});

  if (options.ensureSymbols) {
    ensureSymbolPrimitives(context);
  }

  const originalPrimitives = options.captureOriginal ? captureOriginalPrimitives(context) : undefined;

  if (options.forceMissing) {
    forceMissingPrimitives(context);
  } else if (options.removeStacks) {
    removeStackPrimitives(context);
  }

  if (options.removeGlobalThis) {
    removeGlobalThis(context);
  }

  const packagePath = requirePackagePath();
  const loader = createLoader(context, packagePath);
  const exports = loader.load();

  return {
    context,
    exports,
    globals: readGlobals(context),
    originalPrimitives
  };
}

module.exports = {
  createPackageRealm,
  hasNativePrimitives,
  requirePackagePath
};
