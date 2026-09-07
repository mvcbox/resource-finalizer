'use strict';

const test = require('node:test');
const { registerCoreContracts } = require('./contracts.cjs');
const { createPackageRealm } = require('./realm.cjs');

registerCoreContracts(test, function() {
  return createPackageRealm({ forceMissing: true });
}, 'fallback');
