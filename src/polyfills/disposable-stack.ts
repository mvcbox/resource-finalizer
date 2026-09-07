import {
  APPLY,
  POP,
  PUSH,
  SET_PROTOTYPE,
  SET_STATE,
  TYPE_ERROR,
  createDisposableResource,
  createResourceList,
  getStackState,
  requireActiveStack
} from './stack-helpers';
import type { StackState } from './stack-helpers';
import { SUPPRESSED_ERROR } from './suppressed-error';

if (typeof globalThis.DisposableStack === 'undefined') {
  const STATES = new WeakMap<object, StackState>();

  class DisposableStack implements globalThis.DisposableStack {
    public declare [Symbol.dispose]: () => void;
    public declare readonly [Symbol.toStringTag]: string;

    public constructor() {
      APPLY(SET_STATE, STATES, [this, { disposed: false, resources: createResourceList() }]);
    }

    public get disposed(): boolean {
      return getStackState(STATES, this).disposed;
    }

    public use<T extends Disposable | null | undefined>(value: T): T {
      const { resources } = requireActiveStack(STATES, this);

      if (value !== undefined && value !== null) {
        const resource = createDisposableResource(value, false);
        APPLY(PUSH, resources, [resource]);
      }

      return value;
    }

    public adopt<T>(value: T, onDispose: (value: T) => void): T {
      const state = requireActiveStack(STATES, this);

      if (typeof onDispose !== 'function') {
        throw new TYPE_ERROR('Dispose callback must be callable');
      }

      APPLY(PUSH, state.resources, [{
        value: undefined,
        method: function(): unknown {
          return APPLY(onDispose, undefined, [value]);
        }
      }]);

      return value;
    }

    public defer(onDispose: () => void): void {
      const state = requireActiveStack(STATES, this);

      if (typeof onDispose !== 'function') {
        throw new TYPE_ERROR('Dispose callback must be callable');
      }

      APPLY(PUSH, state.resources, [{
        value: undefined,
        method: onDispose
      }]);
    }

    public move(): DisposableStack {
      const state = requireActiveStack(STATES, this);
      const target = new DisposableStack();
      getStackState(STATES, target).resources = state.resources;
      state.resources = createResourceList();
      state.disposed = true;
      return target;
    }

    public dispose(): void {
      const state = getStackState(STATES, this);

      if (state.disposed) {
        return;
      }

      state.disposed = true;
      const resources = state.resources;
      state.resources = createResourceList();
      let failed = false;
      let failure: unknown;
      let resource = APPLY(POP, resources, []);

      while (resource) {
        try {
          if (resource.method) {
            APPLY(resource.method, resource.value, []);
          }
        } catch (error) {
          failure = failed ? new SUPPRESSED_ERROR(error, failure) : error;
          failed = true;
        }

        resource = APPLY(POP, resources, []);
      }

      if (failed) {
        throw failure;
      }
    }
  }

  // Built-in constructors use their own default prototype when NewTarget.prototype is not an object.
  const CONSTRUCTOR = new Proxy(DisposableStack, {
    construct: function(target, _args, newTarget): DisposableStack {
      const prototype: unknown = newTarget.prototype;
      const result = new target();

      if (prototype !== null && (typeof prototype === 'object' || typeof prototype === 'function')) {
        SET_PROTOTYPE(result, prototype);
      }

      return result;
    }
  });

  Object.defineProperties(DisposableStack.prototype, {
    constructor: { value: CONSTRUCTOR, writable: true, configurable: true },
    [Symbol.dispose]: { value: DisposableStack.prototype.dispose, writable: true, configurable: true },
    [Symbol.toStringTag]: { value: 'DisposableStack', configurable: true }
  });

  Object.defineProperty(globalThis, 'DisposableStack', {
    value: CONSTRUCTOR,
    writable: true,
    enumerable: false,
    configurable: true
  });
}
