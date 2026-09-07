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

if (typeof globalThis.AsyncDisposableStack === 'undefined') {
  const STATES = new WeakMap<object, StackState>();

  class AsyncDisposableStack implements globalThis.AsyncDisposableStack {
    public declare [Symbol.asyncDispose]: () => Promise<void>;
    public declare readonly [Symbol.toStringTag]: string;

    public constructor() {
      APPLY(SET_STATE, STATES, [this, { disposed: false, resources: createResourceList() }]);
    }

    public get disposed(): boolean {
      return getStackState(STATES, this).disposed;
    }

    public use<T extends AsyncDisposable | Disposable | null | undefined>(value: T): T {
      const { resources } = requireActiveStack(STATES, this);
      const resource = createDisposableResource(value, true);
      APPLY(PUSH, resources, [resource]);
      return value;
    }

    public adopt<T>(value: T, onDisposeAsync: (value: T) => PromiseLike<void> | void): T {
      const state = requireActiveStack(STATES, this);

      if (typeof onDisposeAsync !== 'function') {
        throw new TYPE_ERROR('Dispose callback must be callable');
      }

      APPLY(PUSH, state.resources, [{
        value: undefined,
        method: function(): unknown {
          return APPLY(onDisposeAsync, undefined, [value]);
        }
      }]);

      return value;
    }

    public defer(onDisposeAsync: () => PromiseLike<void> | void): void {
      const state = requireActiveStack(STATES, this);

      if (typeof onDisposeAsync !== 'function') {
        throw new TYPE_ERROR('Dispose callback must be callable');
      }

      APPLY(PUSH, state.resources, [{
        value: undefined,
        method: onDisposeAsync
      }]);
    }

    public move(): AsyncDisposableStack {
      const state = requireActiveStack(STATES, this);
      const target = new AsyncDisposableStack();
      getStackState(STATES, target).resources = state.resources;
      state.resources = createResourceList();
      state.disposed = true;
      return target;
    }

    public async disposeAsync(): Promise<void> {
      const state = getStackState(STATES, this);

      if (state.disposed) {
        return;
      }

      state.disposed = true;
      const resources = state.resources;
      state.resources = createResourceList();
      let failed = false;
      let failure: unknown;
      let needsAwait = false;
      let hasAwaited = false;
      let resource = APPLY(POP, resources, []);

      while (resource) {
        try {
          if (resource.method) {
            const result = APPLY(resource.method, resource.value, []);
            hasAwaited = true;
            await result;
          } else {
            needsAwait = true;
          }
        } catch (error) {
          failure = failed ? new SUPPRESSED_ERROR(error, failure) : error;
          failed = true;
        }

        resource = APPLY(POP, resources, []);
      }

      // A nullish resource must still introduce an await, even if every actual callback threw synchronously.
      // https://tc39.es/ecma262/multipage/abstract-operations.html#sec-disposeresources
      if (needsAwait && !hasAwaited) {
        await undefined;
      }

      if (failed) {
        throw failure;
      }
    }
  }

  // Built-in constructors use their own default prototype when NewTarget.prototype is not an object.
  const CONSTRUCTOR = new Proxy(AsyncDisposableStack, {
    construct: function(target, _args, newTarget): AsyncDisposableStack {
      const prototype: unknown = newTarget.prototype;
      const result = new target();

      if (prototype !== null && (typeof prototype === 'object' || typeof prototype === 'function')) {
        SET_PROTOTYPE(result, prototype);
      }

      return result;
    }
  });

  Object.defineProperties(AsyncDisposableStack.prototype, {
    constructor: { value: CONSTRUCTOR, writable: true, configurable: true },
    [Symbol.asyncDispose]: { value: AsyncDisposableStack.prototype.disposeAsync, writable: true, configurable: true },
    [Symbol.toStringTag]: { value: 'AsyncDisposableStack', configurable: true }
  });

  Object.defineProperty(globalThis, 'AsyncDisposableStack', {
    value: CONSTRUCTOR,
    writable: true,
    enumerable: false,
    configurable: true
  });
}
