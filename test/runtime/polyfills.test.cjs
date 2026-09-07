'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const vm = require('node:vm');
const { captureSync } = require('./assertions.cjs');
const { createPackageRealm } = require('./realm.cjs');

test('fallback installs immutable disposal symbols and bundled constructors', function() {
  const realm = createPackageRealm({ forceMissing: true });
  const { exports, globals } = realm;
  const disposeDescriptor = Object.getOwnPropertyDescriptor(globals.Symbol, 'dispose');
  const asyncDisposeDescriptor = Object.getOwnPropertyDescriptor(globals.Symbol, 'asyncDispose');

  assert.equal(typeof globals.Symbol.dispose, 'symbol');
  assert.equal(typeof globals.Symbol.asyncDispose, 'symbol');
  assert.equal(globals.Symbol.keyFor(globals.Symbol.dispose), undefined);
  assert.equal(globals.Symbol.keyFor(globals.Symbol.asyncDispose), undefined);
  assert.notEqual(globals.Symbol.dispose, globals.Symbol.for('Symbol.dispose'));
  assert.notEqual(globals.Symbol.asyncDispose, globals.Symbol.for('Symbol.asyncDispose'));
  assert.notEqual(globals.Symbol.dispose, globals.Symbol.asyncDispose);
  assert.deepEqual(disposeDescriptor, {
    value: globals.Symbol.dispose,
    writable: false,
    enumerable: false,
    configurable: false
  });
  assert.deepEqual(asyncDisposeDescriptor, {
    value: globals.Symbol.asyncDispose,
    writable: false,
    enumerable: false,
    configurable: false
  });
  assert.equal(exports.DisposableStack, globals.DisposableStack);
  assert.equal(exports.AsyncDisposableStack, globals.AsyncDisposableStack);
  assert.equal(typeof globals.SuppressedError, 'function');

  const accidentalResource = {
    [globals.Symbol.for('Symbol.dispose')]: function() {
      assert.fail('A registered application symbol must not become a disposal hook.');
    }
  };
  const failure = captureSync(function() {
    new exports.DisposableStack().use(accidentalResource);
  });
  assert.equal(failure.name, 'TypeError');
});

test('partial fallback preserves native symbols while replacing only missing stack primitives', function() {
  const realm = createPackageRealm({ removeStacks: true, captureOriginal: true, ensureSymbols: true });
  const { globals, originalPrimitives } = realm;

  assert.equal(globals.Symbol.dispose, originalPrimitives.SymbolDispose);
  assert.equal(globals.Symbol.asyncDispose, originalPrimitives.SymbolAsyncDispose);
  assert.notEqual(globals.DisposableStack, originalPrimitives.DisposableStack);
  assert.notEqual(globals.AsyncDisposableStack, originalPrimitives.AsyncDisposableStack);
  assert.notEqual(globals.SuppressedError, originalPrimitives.SuppressedError);
});

test('globalThis fallback initializes the realm before installing resource primitives', function() {
  const realm = createPackageRealm({ forceMissing: true, removeGlobalThis: true });

  assert.equal(vm.runInContext('globalThis === this', realm.context), true);
  assert.equal(typeof realm.globals.DisposableStack, 'function');
  assert.equal(typeof realm.globals.AsyncDisposableStack, 'function');
});

test('fallback SuppressedError observes derived prototype once and preserves conversion failures', function() {
  const realm = createPackageRealm({ forceMissing: true });
  const SuppressedError = realm.globals.SuppressedError;
  const error = new Error('error');
  const suppressed = new Error('suppressed');
  const derivedPrototype = {};
  let prototypeReads = 0;
  const newTarget = new Proxy(function() {}, {
    get: function(target, key, receiver) {
      if (key === 'prototype') {
        prototypeReads++;
        return derivedPrototype;
      }

      return Reflect.get(target, key, receiver);
    }
  });

  const derived = Reflect.construct(SuppressedError, [error, suppressed], newTarget);
  assert.equal(prototypeReads, 1);
  assert.equal(Object.getPrototypeOf(derived), derivedPrototype);

  function PrimitiveTarget() {}

  PrimitiveTarget.prototype = 1;
  const primitive = Reflect.construct(SuppressedError, [error, suppressed], PrimitiveTarget);
  assert.equal(Object.getPrototypeOf(primitive), SuppressedError.prototype);

  const conversionFailure = new Error('conversion failed');
  const message = {
    toString: function() {
      throw conversionFailure;
    }
  };

  assert.equal(captureSync(function() {
    return new SuppressedError(error, suppressed, message);
  }), conversionFailure);
});
