import './global-this';

if (typeof globalThis.SuppressedError === 'undefined') {
  // Derived prototype getters and message conversion can replace global functions during construction.
  const ERROR = Error;
  const TYPE_ERROR = TypeError;
  const SET_PROTOTYPE = Object.setPrototypeOf;
  const DEFINE_PROPERTY = Object.defineProperty;
  const DEFINE_PROPERTIES = Object.defineProperties;
  const STRING = String;

  function createError(
    error: unknown,
    suppressed: unknown,
    message: unknown,
    prototype: unknown
  ): globalThis.SuppressedError {
    // Allocate an actual Error, including its internal error data, before applying the derived prototype.
    const result = new ERROR() as globalThis.SuppressedError;

    SET_PROTOTYPE(
      result,
      prototype !== null && (typeof prototype === 'object' || typeof prototype === 'function')
        ? prototype
        : SuppressedError.prototype
    );

    if (message !== undefined) {
      // Unlike the String function, the specification's ToString rejects a Symbol.
      if (typeof message === 'symbol') {
        throw new TYPE_ERROR('Cannot convert a Symbol value to a string');
      }

      DEFINE_PROPERTY(result, 'message', { value: STRING(message), writable: true, configurable: true });
    }

    DEFINE_PROPERTIES(result, {
      error: { value: error, writable: true, configurable: true },
      suppressed: { value: suppressed, writable: true, configurable: true }
    });

    return result;
  }

  function SuppressedError(error: unknown, suppressed: unknown, message?: unknown): globalThis.SuppressedError {
    return createError(error, suppressed, message, SuppressedError.prototype);
  }

  // A construct trap avoids an ordinary function's extra allocation and second NewTarget.prototype lookup.
  const CONSTRUCTOR = new Proxy(SuppressedError, {
    construct: function(_target, args, newTarget): globalThis.SuppressedError {
      return createError(args[0], args[1], args[2], newTarget.prototype);
    }
  });

  SET_PROTOTYPE(CONSTRUCTOR, ERROR);
  DEFINE_PROPERTY(CONSTRUCTOR, 'prototype', {
    value: Object.create(ERROR.prototype, {
      constructor: { value: CONSTRUCTOR, writable: true, configurable: true },
      name: { value: 'SuppressedError', writable: true, configurable: true },
      message: { value: '', writable: true, configurable: true }
    }),
    writable: false
  });

  DEFINE_PROPERTY(globalThis, 'SuppressedError', {
    value: CONSTRUCTOR,
    writable: true,
    enumerable: false,
    configurable: true
  });
}

export const SUPPRESSED_ERROR = globalThis.SuppressedError;
