'use strict';

const assert = require('node:assert/strict');

function captureSync(action) {
  try {
    action();
  } catch (error) {
    return error;
  }

  assert.fail('Expected operation to throw.');
}

async function captureAsync(action) {
  try {
    await action();
  } catch (error) {
    return error;
  }

  assert.fail('Expected operation to reject.');
}

function assertFailureChain(error, failures) {
  let current = error;

  for (let index = failures.length - 1; index > 0; index--) {
    assert.equal(current.error, failures[index]);
    current = current.suppressed;
  }

  assert.equal(current, failures[0]);
}

function definePoisonedCallProperties(callback) {
  Object.defineProperties(callback, {
    call: {
      get: function() {
        throw new Error('callback.call must not be read');
      },
      configurable: true
    },
    apply: {
      get: function() {
        throw new Error('callback.apply must not be read');
      },
      configurable: true
    }
  });

  return callback;
}

function createThenableWithPoisonedThen() {
  return Object.defineProperty({}, 'then', {
    get: function() {
      throw new Error('sync disposal return value must not be inspected');
    }
  });
}

module.exports = {
  assertFailureChain,
  captureAsync,
  captureSync,
  createThenableWithPoisonedThen,
  definePoisonedCallProperties
};
