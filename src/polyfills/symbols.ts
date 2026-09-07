import './global-this';

if (typeof Symbol.dispose === 'undefined') {
  Object.defineProperty(Symbol, 'dispose', {
    value: Symbol('Symbol.dispose'),
    writable: false,
    enumerable: false,
    configurable: false
  });
}

if (typeof Symbol.asyncDispose === 'undefined') {
  Object.defineProperty(Symbol, 'asyncDispose', {
    value: Symbol('Symbol.asyncDispose'),
    writable: false,
    enumerable: false,
    configurable: false
  });
}
