'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { registerCoreContracts } = require('./contracts.cjs');
const { createPackageRealm, hasNativePrimitives } = require('./realm.cjs');

if (hasNativePrimitives()) {
  test('native differential preserves native primitive identities after package import', function() {
    const realm = createPackageRealm({ captureOriginal: true });
    const { globals, originalPrimitives } = realm;

    assert.equal(globals.Symbol.dispose, originalPrimitives.SymbolDispose);
    assert.equal(globals.Symbol.asyncDispose, originalPrimitives.SymbolAsyncDispose);
    assert.equal(globals.DisposableStack, originalPrimitives.DisposableStack);
    assert.equal(globals.AsyncDisposableStack, originalPrimitives.AsyncDisposableStack);
    assert.equal(globals.SuppressedError, originalPrimitives.SuppressedError);
  });

  registerCoreContracts(test, function() {
    return createPackageRealm({ captureOriginal: true });
  }, 'native differential');
} else {
  test('native differential requires all native explicit-resource primitives', { skip: true }, function() {});
}
