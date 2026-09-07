'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const path = require('node:path');
const { requirePackagePath } = require('./realm.cjs');

function removeNativeResourcePrimitives() {
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
  Object.defineProperty(globalThis, 'Symbol', {
    value: RealmSymbol,
    writable: true,
    configurable: true
  });
  delete globalThis.DisposableStack;
  delete globalThis.AsyncDisposableStack;
  delete globalThis.SuppressedError;
}

removeNativeResourcePrimitives();

const packagePath = requirePackagePath();
const resourceFinalizer = require(path.resolve(packagePath));

test('fallback works after a first package import in a separate process', async function() {
  const syncEvents = [];
  const syncStack = new resourceFinalizer.DisposableStack();

  syncStack.defer(function() {
    syncEvents.push('sync');
  });
  syncStack.dispose();
  assert.deepEqual(syncEvents, ['sync']);

  const asyncEvents = [];
  const asyncStack = new resourceFinalizer.AsyncDisposableStack();

  asyncStack.defer(function() {
    asyncEvents.push('async');
    return Promise.resolve();
  });
  await asyncStack.disposeAsync();
  assert.deepEqual(asyncEvents, ['async']);
});
