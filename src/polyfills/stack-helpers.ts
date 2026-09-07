import './symbols';

export type DisposeMethod = (this: unknown) => unknown;

export type DisposableResource = {
  readonly value: object | undefined;
  readonly method: DisposeMethod | undefined;
};

export type StackState = {
  disposed: boolean;
  resources: DisposableResource[];
};

// Resource getters and finalizers can replace collection methods during registration or cleanup.
export const APPLY = Reflect.apply;
export const PUSH: (this: DisposableResource[], resource: DisposableResource) => number = Array.prototype.push;
export const POP: (this: DisposableResource[]) => DisposableResource | undefined = Array.prototype.pop;
export const SET_STATE = WeakMap.prototype.set;
export const SET_PROTOTYPE = Object.setPrototypeOf;
export const TYPE_ERROR = TypeError;
const REFERENCE_ERROR = ReferenceError;
const DISPOSE = Symbol.dispose;
const ASYNC_DISPOSE = Symbol.asyncDispose;
const GET_STATE: (
  this: WeakMap<object, StackState>,
  receiver: object
) => StackState | undefined = WeakMap.prototype.get;

export function createResourceList(): DisposableResource[] {
  // Inherited numeric setters must not intercept internal resource registration.
  const resources: DisposableResource[] = [];
  SET_PROTOTYPE(resources, null);
  return resources;
}

export function getStackState(states: WeakMap<object, StackState>, receiver: object): StackState {
  const state = APPLY(GET_STATE, states, [receiver]);

  if (!state) {
    throw new TYPE_ERROR('Incompatible disposable stack receiver');
  }

  return state;
}

export function requireActiveStack(states: WeakMap<object, StackState>, receiver: object): StackState {
  const state = getStackState(states, receiver);

  if (state.disposed) {
    throw new REFERENCE_ERROR('Disposable stack is already disposed');
  }

  return state;
}

function getMethod(value: object, key: symbol): DisposeMethod | undefined {
  const method: unknown = (value as Record<symbol, unknown>)[key];

  if (method === undefined || method === null) {
    return undefined;
  }

  if (typeof method !== 'function') {
    throw new TYPE_ERROR('Dispose method must be callable');
  }

  return method as DisposeMethod;
}

export function createDisposableResource(value: unknown, async: boolean): DisposableResource {
  if (value === undefined || value === null) {
    return {
      value: undefined,
      method: undefined
    };
  }

  if (typeof value !== 'object' && typeof value !== 'function') {
    throw new TYPE_ERROR('Disposable resource must be an object');
  }

  const asyncMethod = async ? getMethod(value, ASYNC_DISPOSE) : undefined;
  const method = asyncMethod || getMethod(value, DISPOSE);

  if (!method) {
    throw new TYPE_ERROR('Resource does not have a dispose method');
  }

  if (async && !asyncMethod) {
    return {
      value,
      // GetDisposeMethod requires an awaited Promise wrapper that ignores the sync method's return value.
      // https://tc39.es/ecma262/multipage/abstract-operations.html#sec-getdisposemethod
      method: async function(this: unknown): Promise<void> {
        APPLY(method, this, []);
      }
    };
  }

  return {
    value,
    method
  };
}
