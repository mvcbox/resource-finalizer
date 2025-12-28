import { Symbols } from '../Symbols';

export function callDestructorsChain(thisContext: object): void {
  let proto = Object.getPrototypeOf(thisContext);

  while (proto && proto !== Object.prototype) {
    if (Object.prototype.hasOwnProperty.call(proto, Symbols.destructor)) {
      const fn = proto[Symbols.destructor];

      if (typeof fn === 'function') {
        fn.call(thisContext);
      }
    }

    proto = Object.getPrototypeOf(proto);
  }
}
