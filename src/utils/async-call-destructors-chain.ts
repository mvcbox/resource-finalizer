import { Symbols } from '../Symbols';
import { SUPPRESSED_ERROR } from '../polyfills/suppressed-error';

const APPLY = Reflect.apply;
const HAS_OWN = Object.prototype.hasOwnProperty;
const GET_PROTOTYPE = Object.getPrototypeOf;
const OBJECT_PROTOTYPE = Object.prototype;
const WEAK_SET = WeakSet;
const HAS_VISITED = WeakSet.prototype.has;
const MARK_VISITED = WeakSet.prototype.add;
const TYPE_ERROR = TypeError;

export async function asyncCallDestructorsChain(thisContext: object): Promise<void> {
  const visited = new WEAK_SET<object>();
  let proto: Record<symbol, unknown> | null = GET_PROTOTYPE(thisContext);
  let failed = false;
  let failure: unknown;

  while (proto && proto !== OBJECT_PROTOTYPE) {
    // Proxy traps can describe cycles even though ordinary prototype chains cannot.
    if (APPLY(HAS_VISITED, visited, [proto])) {
      const error = new TYPE_ERROR('Cyclic destructor prototype chain');
      failure = failed ? new SUPPRESSED_ERROR(error, failure) : error;
      failed = true;
      break;
    }

    APPLY(MARK_VISITED, visited, [proto]);

    try {
      if (APPLY(HAS_OWN, proto, [Symbols.asyncDestructor])) {
        const fn = proto[Symbols.asyncDestructor];

        if (typeof fn === 'function') {
          await APPLY(fn, thisContext, []);
        }
      }
    } catch (error) {
      failure = failed ? new SUPPRESSED_ERROR(error, failure) : error;
      failed = true;
    }

    try {
      proto = GET_PROTOTYPE(proto);
    } catch (error) {
      // A failed prototype lookup makes the remaining chain undiscoverable.
      failure = failed ? new SUPPRESSED_ERROR(error, failure) : error;
      failed = true;
      break;
    }
  }

  if (failed) {
    throw failure;
  }
}
