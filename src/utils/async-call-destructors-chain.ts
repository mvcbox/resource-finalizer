import { Symbols } from '../Symbols';

export async function asyncCallDestructorsChain(thisContext: object): Promise<void> {
  let proto = Object.getPrototypeOf(thisContext);

  while (proto && proto !== Object.prototype) {
    if (Object.prototype.hasOwnProperty.call(proto, Symbols.asyncDestructor)) {
      const fn = proto[Symbols.asyncDestructor];

      if (typeof fn === 'function') {
        await fn.call(thisContext);
      }
    }

    proto = Object.getPrototypeOf(proto);
  }
}
