'use strict';

const assert = require('node:assert/strict');
const vm = require('node:vm');
const {
  assertFailureChain,
  captureAsync,
  captureSync,
  createThenableWithPoisonedThen,
  definePoisonedCallProperties
} = require('./assertions.cjs');

function assertErrorName(error, name) {
  assert.equal(typeof error, 'object');
  assert.notEqual(error, null);
  assert.equal(error.name, name);
}

function getBindings(realm) {
  return {
    AsyncDestructor: realm.exports.AsyncDestructor,
    AsyncDisposableStack: realm.exports.AsyncDisposableStack,
    Destructor: realm.exports.Destructor,
    DisposableStack: realm.exports.DisposableStack,
    Symbols: realm.exports.Symbols,
    asyncCallDestructorsChain: realm.exports.asyncCallDestructorsChain,
    callDestructorsChain: realm.exports.callDestructorsChain,
    Error: realm.globals.Error,
    SuppressedError: realm.globals.SuppressedError,
    Symbol: realm.globals.Symbol
  };
}

function registerStackContracts(test, createRealm, label) {
  test(`${label}: synchronous stack invokes captured callbacks in reverse registration order`, function() {
    const realm = createRealm();
    const { DisposableStack, Symbol } = getBindings(realm);
    const events = [];
    const stack = new DisposableStack();
    const resource = {};
    const adopted = {};

    resource[Symbol.dispose] = definePoisonedCallProperties(function() {
      assert.equal(this, resource);
      assert.equal(arguments.length, 0);
      events.push('resource');
    });

    const adoptedCallback = definePoisonedCallProperties(function(value) {
      assert.equal(this, undefined);
      assert.equal(value, adopted);
      events.push('adopted');
    });
    const deferredCallback = definePoisonedCallProperties(function() {
      assert.equal(this, undefined);
      assert.equal(arguments.length, 0);
      events.push('deferred');
    });

    assert.equal(stack.use(resource), resource);
    assert.equal(stack.adopt(adopted, adoptedCallback), adopted);
    stack.defer(deferredCallback);
    stack.dispose();

    assert.deepEqual(events, ['deferred', 'adopted', 'resource']);
    assert.equal(stack.disposed, true);
  });

  test(`${label}: synchronous stack captures a disposal method exactly once at registration`, function() {
    const realm = createRealm();
    const { DisposableStack, Symbol } = getBindings(realm);
    const stack = new DisposableStack();
    const resource = {};
    let getterCalls = 0;
    let capturedCalls = 0;
    let replacementCalls = 0;

    const captured = function() {
      assert.equal(this, resource);
      capturedCalls++;
    };
    const replacement = function() {
      replacementCalls++;
    };

    Object.defineProperty(resource, Symbol.dispose, {
      configurable: true,
      get: function() {
        getterCalls++;
        return captured;
      }
    });
    stack.use(resource);
    Object.defineProperty(resource, Symbol.dispose, { value: replacement });
    stack.dispose();

    assert.equal(getterCalls, 1);
    assert.equal(capturedCalls, 1);
    assert.equal(replacementCalls, 0);
  });

  test(`${label}: synchronous stack preserves primitive failures and suppresses later failures`, function() {
    const realm = createRealm();
    const { DisposableStack } = getBindings(realm);
    const primitiveStack = new DisposableStack();

    primitiveStack.defer(function() {
      throw undefined;
    });

    assert.equal(captureSync(function() {
      primitiveStack.dispose();
    }), undefined);

    const stack = new DisposableStack();
    const first = new Error('first');
    const second = new Error('second');
    const third = new Error('third');
    const events = [];

    stack.defer(function() {
      events.push('third');
      throw third;
    });
    stack.defer(function() {
      events.push('second');
      throw second;
    });
    stack.defer(function() {
      events.push('first');
      throw first;
    });

    const failure = captureSync(function() {
      stack.dispose();
    });

    assert.deepEqual(events, ['first', 'second', 'third']);
    assertFailureChain(failure, [first, second, third]);
  });

  test(`${label}: synchronous stack rejects invalid registration and forged receivers before mutation`, function() {
    const realm = createRealm();
    const { DisposableStack, Symbol } = getBindings(realm);
    const stack = new DisposableStack();
    const events = [];
    const getterFailure = new Error('dispose getter failed');
    const resource = {};

    stack.defer(function() {
      events.push('kept');
    });

    Object.defineProperty(resource, Symbol.dispose, {
      get: function() {
        throw getterFailure;
      }
    });

    assert.equal(captureSync(function() {
      stack.use(resource);
    }), getterFailure);
    assertErrorName(captureSync(function() {
      stack.use({});
    }), 'TypeError');
    assertErrorName(captureSync(function() {
      stack.adopt({}, 1);
    }), 'TypeError');
    assertErrorName(captureSync(function() {
      stack.defer(1);
    }), 'TypeError');
    stack.dispose();
    assert.deepEqual(events, ['kept']);

    assertErrorName(captureSync(function() {
      stack.defer(function() {});
    }), 'ReferenceError');
    assertErrorName(captureSync(function() {
      Reflect.apply(DisposableStack.prototype.dispose, {}, []);
    }), 'TypeError');
    assertErrorName(captureSync(function() {
      const descriptor = Object.getOwnPropertyDescriptor(DisposableStack.prototype, 'disposed');
      Reflect.apply(descriptor.get, {}, []);
    }), 'TypeError');
  });

  test(`${label}: synchronous stack move, reentrancy, and large stacks retain ownership semantics`, function() {
    const realm = createRealm();
    const { DisposableStack } = getBindings(realm);
    const events = [];
    const stack = new DisposableStack();

    stack.defer(function() {
      events.push('moved');
    });

    const moved = stack.move();

    assert.equal(stack.disposed, true);
    assert.equal(moved.disposed, false);
    assert.notEqual(moved, stack);
    assert.equal(moved.constructor, DisposableStack);
    assertErrorName(captureSync(function() {
      stack.move();
    }), 'ReferenceError');
    moved.dispose();
    assert.deepEqual(events, ['moved']);

    class DerivedStack extends DisposableStack {}

    const derivedTarget = new DerivedStack().move();
    assert.equal(derivedTarget.constructor, DisposableStack);
    assert.equal(derivedTarget instanceof DerivedStack, false);

    const reentrant = new DisposableStack();
    let reentrantCount = 0;

    reentrant.defer(function() {
      reentrantCount++;
      reentrant.dispose();
    });
    reentrant.dispose();
    assert.equal(reentrantCount, 1);

    const large = new DisposableStack();
    let largeCount = 0;

    for (let index = 0; index < 5000; index++) {
      large.defer(function() {
        largeCount++;
      });
    }

    large.dispose();
    assert.equal(largeCount, 5000);
  });

  test(`${label}: synchronous stack exposes the expected disposal protocol`, function() {
    const realm = createRealm();
    const { DisposableStack, Symbol } = getBindings(realm);
    const stack = new DisposableStack();
    const disposalDescriptor = Object.getOwnPropertyDescriptor(DisposableStack.prototype, Symbol.dispose);
    const tagDescriptor = Object.getOwnPropertyDescriptor(DisposableStack.prototype, Symbol.toStringTag);

    assert.equal(stack[Symbol.dispose], stack.dispose);
    assert.equal(disposalDescriptor.value, DisposableStack.prototype.dispose);
    assert.equal(disposalDescriptor.writable, true);
    assert.equal(disposalDescriptor.enumerable, false);
    assert.equal(disposalDescriptor.configurable, true);
    assert.equal(tagDescriptor.value, 'DisposableStack');
    assert.equal(tagDescriptor.writable, false);
    assert.equal(tagDescriptor.enumerable, false);
    assert.equal(tagDescriptor.configurable, true);
    assert.equal(Object.prototype.toString.call(stack), '[object DisposableStack]');
  });
}

function registerAsyncStackContracts(test, createRealm, label) {
  test(`${label}: asynchronous stack invokes captured callbacks sequentially`, async function() {
    const realm = createRealm();
    const { AsyncDisposableStack, Symbol } = getBindings(realm);
    const events = [];
    const stack = new AsyncDisposableStack();
    const resource = {};
    const adopted = {};

    resource[Symbol.asyncDispose] = definePoisonedCallProperties(function() {
      assert.equal(this, resource);
      assert.equal(arguments.length, 0);
      events.push('resource');
      return Promise.resolve();
    });

    const adoptedCallback = definePoisonedCallProperties(function(value) {
      assert.equal(this, undefined);
      assert.equal(value, adopted);
      events.push('adopted');
      return Promise.resolve();
    });
    const deferredCallback = definePoisonedCallProperties(function() {
      assert.equal(this, undefined);
      assert.equal(arguments.length, 0);
      events.push('deferred');
      return Promise.resolve();
    });

    assert.equal(stack.use(resource), resource);
    assert.equal(stack.adopt(adopted, adoptedCallback), adopted);
    stack.defer(deferredCallback);
    await stack.disposeAsync();

    assert.deepEqual(events, ['deferred', 'adopted', 'resource']);
    assert.equal(stack.disposed, true);
  });

  test(`${label}: asynchronous stack captures methods and handles async lookup fallbacks`, async function() {
    const realm = createRealm();
    const { AsyncDisposableStack, Symbol } = getBindings(realm);
    const captureStack = new AsyncDisposableStack();
    const captureResource = {};
    let getterCalls = 0;
    let capturedCalls = 0;
    let replacementCalls = 0;

    const captured = function() {
      assert.equal(this, captureResource);
      capturedCalls++;
      return Promise.resolve();
    };
    const replacement = function() {
      replacementCalls++;
      return Promise.resolve();
    };

    Object.defineProperty(captureResource, Symbol.asyncDispose, {
      configurable: true,
      get: function() {
        getterCalls++;
        return captured;
      }
    });
    captureStack.use(captureResource);
    Object.defineProperty(captureResource, Symbol.asyncDispose, { value: replacement });
    await captureStack.disposeAsync();

    assert.equal(getterCalls, 1);
    assert.equal(capturedCalls, 1);
    assert.equal(replacementCalls, 0);

    const nullAsyncMethodStack = new AsyncDisposableStack();
    const nullAsyncMethodResource = {};
    const nullAsyncMethodEvents = [];

    nullAsyncMethodResource[Symbol.asyncDispose] = null;
    nullAsyncMethodResource[Symbol.dispose] = function() {
      nullAsyncMethodEvents.push('sync fallback');
    };
    nullAsyncMethodStack.use(nullAsyncMethodResource);
    await nullAsyncMethodStack.disposeAsync();
    assert.deepEqual(nullAsyncMethodEvents, ['sync fallback']);

    const invalidAsyncMethodStack = new AsyncDisposableStack();
    const invalidAsyncMethodResource = {};
    const invalidAsyncMethodEvents = [];

    invalidAsyncMethodResource[Symbol.asyncDispose] = 1;
    invalidAsyncMethodResource[Symbol.dispose] = function() {
      invalidAsyncMethodEvents.push('sync fallback');
    };
    assertErrorName(captureSync(function() {
      invalidAsyncMethodStack.use(invalidAsyncMethodResource);
    }), 'TypeError');
    await invalidAsyncMethodStack.disposeAsync();
    assert.deepEqual(invalidAsyncMethodEvents, []);

    const thenableStack = new AsyncDisposableStack();
    const thenableFailure = new Error('thenable rejected');
    const thenableEvents = [];
    const thenableResource = {};

    thenableResource[Symbol.asyncDispose] = function() {
      thenableEvents.push('thenable');
      return {
        then: function(resolve, reject) {
          void resolve;
          reject(thenableFailure);
        }
      };
    };
    thenableStack.defer(function() {
      thenableEvents.push('lower');
      return Promise.resolve();
    });
    thenableStack.use(thenableResource);

    assert.equal(await captureAsync(function() {
      return thenableStack.disposeAsync();
    }), thenableFailure);
    assert.deepEqual(thenableEvents, ['thenable', 'lower']);
  });

  test(`${label}: asynchronous stack continues after rejection and preserves the rejection tree`, async function() {
    const realm = createRealm();
    const { AsyncDisposableStack } = getBindings(realm);
    const regressionStack = new AsyncDisposableStack();
    const regressionFailure = new Error('upper rejected');
    const regressionEvents = [];

    regressionStack.defer(function() {
      regressionEvents.push('destructor');
      return Promise.resolve();
    });
    regressionStack.defer(function() {
      regressionEvents.push('lower');
      return Promise.resolve();
    });
    regressionStack.defer(function() {
      regressionEvents.push('upper');
      return Promise.reject(regressionFailure);
    });

    assert.equal(await captureAsync(function() {
      return regressionStack.disposeAsync();
    }), regressionFailure);
    assert.deepEqual(regressionEvents, ['upper', 'lower', 'destructor']);

    const undefinedStack = new AsyncDisposableStack();

    undefinedStack.defer(function() {
      throw undefined;
    });
    assert.equal(await captureAsync(function() {
      return undefinedStack.disposeAsync();
    }), undefined);

    const stack = new AsyncDisposableStack();
    const first = new Error('first');
    const second = new Error('second');
    const third = new Error('third');
    const events = [];

    stack.defer(function() {
      events.push('third');
      return Promise.reject(third);
    });
    stack.defer(function() {
      events.push('second');
      return Promise.reject(second);
    });
    stack.defer(function() {
      events.push('first');
      return Promise.reject(first);
    });

    const failure = await captureAsync(function() {
      return stack.disposeAsync();
    });

    assert.deepEqual(events, ['first', 'second', 'third']);
    assertFailureChain(failure, [first, second, third]);
  });

  test(
    `${label}: asynchronous stack handles synchronous fallback methods without assimilating their return values`,
    async function() {
      const realm = createRealm();
      const { AsyncDisposableStack, Symbol } = getBindings(realm);
      const ignoredThenableStack = new AsyncDisposableStack();
      const ignoredThenableResource = {};
      const events = [];

      ignoredThenableResource[Symbol.dispose] = definePoisonedCallProperties(function() {
        events.push('sync');
        return createThenableWithPoisonedThen();
      });
      ignoredThenableStack.use(ignoredThenableResource);
      await ignoredThenableStack.disposeAsync();
      assert.deepEqual(events, ['sync']);

      const throwingStack = new AsyncDisposableStack();
      const throwingResource = {};
      const failure = new Error('sync fallback failed');
      const continued = [];

      throwingStack.defer(function() {
        continued.push('lower');
        return Promise.resolve();
      });
      throwingResource[Symbol.dispose] = function() {
        continued.push('sync');
        throw failure;
      };
    throwingStack.use(throwingResource);

    const disposal = throwingStack.disposeAsync();
    assert.deepEqual(continued, ['sync']);
    let settled = false;
      disposal.then(function() {
        settled = true;
      }, function() {
        settled = true;
      });

      assert.equal(typeof disposal.then, 'function');
      assert.equal(settled, false);
      assert.equal(await captureAsync(function() {
        return disposal;
      }), failure);
      assert.deepEqual(continued, ['sync', 'lower']);
    }
  );

  test(`${label}: asynchronous stack prefers async methods and preserves nullish await timing`, async function() {
    const realm = createRealm();
    const { AsyncDisposableStack, Symbol } = getBindings(realm);
    const stack = new AsyncDisposableStack();
    const resource = {};
    const events = [];

    resource[Symbol.asyncDispose] = function() {
      events.push('async');
      return Promise.resolve();
    };
    resource[Symbol.dispose] = function() {
      events.push('sync');
    };
    stack.use(resource);
    await stack.disposeAsync();
    assert.deepEqual(events, ['async']);

    const nullishStack = new AsyncDisposableStack();
    const timing = [];

    nullishStack.use(null);
    const disposal = nullishStack.disposeAsync().then(function() {
      timing.push('dispose');
    });
    Promise.resolve().then(function() {
      timing.push('microtask');
    });
    await disposal;

    assert.deepEqual(timing, ['microtask', 'dispose']);
  });

  test(`${label}: asynchronous stack has independent concurrent disposal and protocol aliases`, async function() {
    const realm = createRealm();
    const { AsyncDisposableStack, Symbol } = getBindings(realm);
    const stack = new AsyncDisposableStack();
    const events = [];
    let release;
    const gate = new Promise(function(resolve) {
      release = resolve;
    });

    stack.defer(async function() {
      events.push('start');
      await gate;
      events.push('end');
    });

    const first = stack.disposeAsync();
    const second = stack.disposeAsync();
    let secondFinished = false;
    second.then(function() {
      secondFinished = true;
    });
    await Promise.resolve();

    assert.equal(stack.disposed, true);
    assert.notEqual(first, second);
    assert.deepEqual(events, ['start']);
    await second;
    assert.equal(secondFinished, true);
    assert.deepEqual(events, ['start']);
    release();
    await first;
    assert.deepEqual(events, ['start', 'end']);

    const protocolStack = new AsyncDisposableStack();
    const disposalDescriptor = Object.getOwnPropertyDescriptor(AsyncDisposableStack.prototype, Symbol.asyncDispose);
    const tagDescriptor = Object.getOwnPropertyDescriptor(AsyncDisposableStack.prototype, Symbol.toStringTag);

    assert.equal(protocolStack[Symbol.asyncDispose], protocolStack.disposeAsync);
    assert.equal(disposalDescriptor.value, AsyncDisposableStack.prototype.disposeAsync);
    assert.equal(disposalDescriptor.writable, true);
    assert.equal(disposalDescriptor.enumerable, false);
    assert.equal(disposalDescriptor.configurable, true);
    assert.equal(tagDescriptor.value, 'AsyncDisposableStack');
    assert.equal(tagDescriptor.writable, false);
    assert.equal(tagDescriptor.enumerable, false);
    assert.equal(tagDescriptor.configurable, true);
    assert.equal(Object.prototype.toString.call(protocolStack), '[object AsyncDisposableStack]');

    const reentrant = new AsyncDisposableStack();
    let reentrantCount = 0;

    reentrant.defer(async function() {
      reentrantCount++;
      await reentrant.disposeAsync();
    });
    await reentrant.disposeAsync();
    assert.equal(reentrantCount, 1);

    const source = new AsyncDisposableStack();
    const movedEvents = [];

    source.defer(function() {
      movedEvents.push('moved');
      return Promise.resolve();
    });
    const moved = source.move();
    await source.disposeAsync();
    assert.deepEqual(movedEvents, []);
    await moved.disposeAsync();
    assert.deepEqual(movedEvents, ['moved']);
    await source.disposeAsync();
    assert.deepEqual(movedEvents, ['moved']);
  });

  test(`${label}: asynchronous stack validates registration and transfers moved resources`, async function() {
    const realm = createRealm();
    const { AsyncDisposableStack, Symbol } = getBindings(realm);
    const stack = new AsyncDisposableStack();
    const getterFailure = new Error('async dispose getter failed');
    const resource = {};
    const events = [];

    Object.defineProperty(resource, Symbol.asyncDispose, {
      get: function() {
        throw getterFailure;
      }
    });
    stack.defer(function() {
      events.push('kept');
      return Promise.resolve();
    });

    assert.equal(captureSync(function() {
      stack.use(resource);
    }), getterFailure);
    assertErrorName(captureSync(function() {
      stack.use({});
    }), 'TypeError');
    assertErrorName(captureSync(function() {
      stack.adopt({}, 1);
    }), 'TypeError');
    assertErrorName(captureSync(function() {
      stack.defer(1);
    }), 'TypeError');

    const moved = stack.move();
    assert.equal(stack.disposed, true);
    await moved.disposeAsync();
    assert.deepEqual(events, ['kept']);
    assertErrorName(captureSync(function() {
      stack.move();
    }), 'ReferenceError');
    await assert.rejects(function() {
      return Reflect.apply(AsyncDisposableStack.prototype.disposeAsync, {}, []);
    });
  });
}

function registerConstructorContracts(test, createRealm, label) {
  test(`${label}: stack constructors honor Reflect.construct prototypes without losing their brands`, async function() {
    const realm = createRealm();
    const { AsyncDisposableStack, DisposableStack } = getBindings(realm);
    const stacks = [
      {
        name: 'DisposableStack',
        StackConstructor: DisposableStack,
        dispose: DisposableStack.prototype.dispose,
        disposed: Object.getOwnPropertyDescriptor(DisposableStack.prototype, 'disposed').get
      },
      {
        name: 'AsyncDisposableStack',
        StackConstructor: AsyncDisposableStack,
        dispose: AsyncDisposableStack.prototype.disposeAsync,
        disposed: Object.getOwnPropertyDescriptor(AsyncDisposableStack.prototype, 'disposed').get
      }
    ];

    for (const stack of stacks) {
      const constructed = vm.runInContext(
        `
          (function() {
            function PrimitiveTarget() {}
            PrimitiveTarget.prototype = 1;
            const primitiveInstance = Reflect.construct(${stack.name}, [], PrimitiveTarget);
            const customPrototype = {};
            let prototypeReads = 0;
            const newTarget = new Proxy(function() {}, {
              get: function(target, key, receiver) {
                if (key === 'prototype') {
                  prototypeReads++;
                  return customPrototype;
                }

                return Reflect.get(target, key, receiver);
              }
            });
            const customInstance = Reflect.construct(${stack.name}, [], newTarget);

            return { primitiveInstance, customInstance, customPrototype, prototypeReads };
          })()
        `,
        realm.context,
        { filename: `construct-${stack.name}.js` }
      );

      assert.equal(Object.getPrototypeOf(constructed.primitiveInstance), stack.StackConstructor.prototype);
      await Reflect.apply(stack.dispose, constructed.primitiveInstance, []);
      assert.equal(Reflect.apply(stack.disposed, constructed.primitiveInstance, []), true);
      assert.equal(constructed.prototypeReads, 1);
      assert.equal(Object.getPrototypeOf(constructed.customInstance), constructed.customPrototype);
      await Reflect.apply(stack.dispose, constructed.customInstance, []);
      assert.equal(Reflect.apply(stack.disposed, constructed.customInstance, []), true);
    }
  });

  test(`${label}: constructors preserve intrinsic operations across a derived prototype getter`, async function() {
    for (const name of ['DisposableStack', 'AsyncDisposableStack', 'SuppressedError']) {
      const operations = name === 'SuppressedError'
        ? ['Object.setPrototypeOf', 'Error', 'Object.defineProperty', 'Object.defineProperties', 'String', 'TypeError']
        : ['Object.setPrototypeOf'];

      for (const operation of operations) {
        const realm = createRealm();
        const constructed = vm.runInContext(
          `
            (function() {
              const prototype = {};
              const error = {};
              const suppressed = {};
              const injected = new Error('replaced intrinsic');
              const typeErrorPrototype = TypeError.prototype;
              const message = ${operation === 'TypeError'} ? Symbol('message') : 'message';
              let prototypeReads = 0;
              const newTarget = new Proxy(function() {}, {
                get: function(target, key, receiver) {
                  if (key === 'prototype') {
                    prototypeReads++;
                    ${operation} = function() { throw injected; };
                    return prototype;
                  }

                  return Reflect.get(target, key, receiver);
                }
              });
              let instance;
              let failure;

              try {
                instance = Reflect.construct(${name}, [error, suppressed, message], newTarget);
              } catch (caught) {
                failure = caught;
              }

              return { instance, failure, prototype, prototypeReads, error, suppressed, typeErrorPrototype };
            })()
          `,
          realm.context,
          { filename: `construct-${name}-${operation}.js` }
        );

        assert.equal(constructed.prototypeReads, 1);

        if (operation === 'TypeError') {
          assert.equal(Object.getPrototypeOf(constructed.failure), constructed.typeErrorPrototype);
          continue;
        }

        assert.equal(constructed.failure, undefined, `${name}: ${operation}`);
        assert.equal(Object.getPrototypeOf(constructed.instance), constructed.prototype);

        if (name === 'SuppressedError') {
          assert.equal(constructed.instance.error, constructed.error);
          assert.equal(constructed.instance.suppressed, constructed.suppressed);
          assert.equal(constructed.instance.message, 'message');
        } else {
          const prototype = realm.globals[name].prototype;
          const dispose = name === 'DisposableStack' ? prototype.dispose : prototype.disposeAsync;
          const disposed = Object.getOwnPropertyDescriptor(prototype, 'disposed').get;
          assert.equal(Reflect.apply(disposed, constructed.instance, []), false);
          await Reflect.apply(dispose, constructed.instance, []);
          assert.equal(Reflect.apply(disposed, constructed.instance, []), true);
        }
      }
    }
  });
}

function registerDestructorContracts(test, createRealm, label) {
  test(`${label}: synchronous destructor chains continue at every failure position`, function() {
    const realm = createRealm();
    const { Destructor, Symbol, Symbols } = getBindings(realm);

    for (const failingLevel of ['C', 'B', 'A']) {
      const events = [];
      const failure = new Error(`failure at ${failingLevel}`);

      class A extends Destructor {
        [Symbols.destructor]() {
          events.push('A');

          if (failingLevel === 'A') {
            throw failure;
          }
        }
      }

      class B extends A {
        [Symbols.destructor]() {
          events.push('B');

          if (failingLevel === 'B') {
            throw failure;
          }
        }
      }

      class C extends B {
        [Symbols.destructor]() {
          events.push('C');

          if (failingLevel === 'C') {
            throw failure;
          }
        }
      }

      const instance = new C();
      assert.equal(captureSync(function() {
        instance[Symbol.dispose]();
      }), failure);
      assert.deepEqual(events, ['C', 'B', 'A']);
    }

    const errors = [new Error('C'), new Error('B'), new Error('A')];
    const events = [];

    class A extends Destructor {
      [Symbols.destructor]() {
        events.push('A');
        throw errors[2];
      }
    }

    class B extends A {
      [Symbols.destructor]() {
        events.push('B');
        throw errors[1];
      }
    }

    class C extends B {
      [Symbols.destructor]() {
        events.push('C');
        throw errors[0];
      }
    }

    const allFailures = captureSync(function() {
      new C()[Symbol.dispose]();
    });

    assert.deepEqual(events, ['C', 'B', 'A']);
    assertFailureChain(allFailures, errors);
  });

  test(`${label}: synchronous destructor walker handles poisoned callback properties and lookup failures`, function() {
    const realm = createRealm();
    const { Symbols, callDestructorsChain } = getBindings(realm);
    const events = [];
    const callback = definePoisonedCallProperties(function() {
      assert.equal(this, context);
      assert.equal(arguments.length, 0);
      events.push('callback');
    });
    const prototype = {};
    const context = Object.create(prototype);

    Object.defineProperty(prototype, Symbols.destructor, { value: callback });
    callDestructorsChain(context);
    assert.deepEqual(events, ['callback']);

    const accessorFailure = new Error('accessor failed');
    const accessorEvents = [];
    const accessorBase = {};
    const accessorPrototype = Object.create(accessorBase);
    const accessorContext = Object.create(accessorPrototype);

    Object.defineProperty(accessorBase, Symbols.destructor, {
      value: function() {
        accessorEvents.push('base');
      }
    });
    Object.defineProperty(accessorPrototype, Symbols.destructor, {
      get: function() {
        throw accessorFailure;
      }
    });
    assert.equal(captureSync(function() {
      callDestructorsChain(accessorContext);
    }), accessorFailure);
    assert.deepEqual(accessorEvents, ['base']);

    const proxyFailure = new Error('proxy lookup failed');
    const proxyEvents = [];
    const lookupBase = {};
    const lookupPrototype = new Proxy(Object.create(lookupBase), {
      getOwnPropertyDescriptor: function(target, key) {
        if (key === Symbols.destructor) {
          throw proxyFailure;
        }

        return Reflect.getOwnPropertyDescriptor(target, key);
      }
    });
    const proxyContext = new Proxy({}, {
      getPrototypeOf: function() {
        return lookupPrototype;
      }
    });

    Object.defineProperty(lookupBase, Symbols.destructor, {
      value: function() {
        proxyEvents.push('base');
      }
    });

    assert.equal(captureSync(function() {
      callDestructorsChain(proxyContext);
    }), proxyFailure);
    assert.deepEqual(proxyEvents, ['base']);

    const callbackFailure = new Error('callback failed');
    const nextPrototypeFailure = new Error('next prototype failed');
    const nextPrototypeTarget = {};
    const nextPrototype = new Proxy(nextPrototypeTarget, {
      getPrototypeOf: function() {
        throw nextPrototypeFailure;
      }
    });
    const nextContext = new Proxy({}, {
      getPrototypeOf: function() {
        return nextPrototype;
      }
    });

    Object.defineProperty(nextPrototypeTarget, Symbols.destructor, {
      value: function() {
        throw callbackFailure;
      }
    });

    const combinedFailure = captureSync(function() {
      callDestructorsChain(nextContext);
    });

    assertFailureChain(combinedFailure, [callbackFailure, nextPrototypeFailure]);
  });

  test(`${label}: asynchronous destructor chains continue at every failure position`, async function() {
    const realm = createRealm();
    const { AsyncDestructor, Symbol, Symbols } = getBindings(realm);

    for (const failingLevel of ['C', 'B', 'A']) {
      const events = [];
      const failure = new Error(`failure at ${failingLevel}`);

      class A extends AsyncDestructor {
        async [Symbols.asyncDestructor]() {
          events.push('A');

          if (failingLevel === 'A') {
            throw failure;
          }
        }
      }

      class B extends A {
        async [Symbols.asyncDestructor]() {
          events.push('B');

          if (failingLevel === 'B') {
            throw failure;
          }
        }
      }

      class C extends B {
        async [Symbols.asyncDestructor]() {
          events.push('C');

          if (failingLevel === 'C') {
            throw failure;
          }
        }
      }

      const instance = new C();
      assert.equal(await captureAsync(function() {
        return instance[Symbol.asyncDispose]();
      }), failure);
      assert.deepEqual(events, ['C', 'B', 'A']);
    }

    const errors = [new Error('C'), new Error('B'), new Error('A')];
    const events = [];

    class A extends AsyncDestructor {
      async [Symbols.asyncDestructor]() {
        events.push('A');
        throw errors[2];
      }
    }

    class B extends A {
      async [Symbols.asyncDestructor]() {
        events.push('B');
        throw errors[1];
      }
    }

    class C extends B {
      async [Symbols.asyncDestructor]() {
        events.push('C');
        throw errors[0];
      }
    }

    const allFailures = await captureAsync(function() {
      return new C()[Symbol.asyncDispose]();
    });

    assert.deepEqual(events, ['C', 'B', 'A']);
    assertFailureChain(allFailures, errors);
  });

  test(`${label}: asynchronous destructor walker handles poisoned callbacks and lookup failures`, async function() {
    const realm = createRealm();
    const { Symbols, asyncCallDestructorsChain } = getBindings(realm);
    const events = [];
    let context;
    const callback = definePoisonedCallProperties(async function() {
      assert.equal(this, context);
      assert.equal(arguments.length, 0);
      events.push('callback');
    });
    const prototype = {};

    context = Object.create(prototype);
    Object.defineProperty(prototype, Symbols.asyncDestructor, { value: callback });
    await asyncCallDestructorsChain(context);
    assert.deepEqual(events, ['callback']);

    const accessorFailure = new Error('async accessor failed');
    const accessorEvents = [];
    const accessorBase = {};
    const accessorPrototype = Object.create(accessorBase);
    const accessorContext = Object.create(accessorPrototype);

    Object.defineProperty(accessorBase, Symbols.asyncDestructor, {
      value: function() {
        accessorEvents.push('base');
        return Promise.resolve();
      }
    });
    Object.defineProperty(accessorPrototype, Symbols.asyncDestructor, {
      get: function() {
        throw accessorFailure;
      }
    });
    assert.equal(await captureAsync(function() {
      return asyncCallDestructorsChain(accessorContext);
    }), accessorFailure);
    assert.deepEqual(accessorEvents, ['base']);

    const proxyFailure = new Error('async proxy lookup failed');
    const proxyEvents = [];
    const lookupBase = {};
    const lookupPrototype = new Proxy(Object.create(lookupBase), {
      getOwnPropertyDescriptor: function(target, key) {
        if (key === Symbols.asyncDestructor) {
          throw proxyFailure;
        }

        return Reflect.getOwnPropertyDescriptor(target, key);
      }
    });
    const proxyContext = new Proxy({}, {
      getPrototypeOf: function() {
        return lookupPrototype;
      }
    });

    Object.defineProperty(lookupBase, Symbols.asyncDestructor, {
      value: function() {
        proxyEvents.push('base');
        return Promise.resolve();
      }
    });

    assert.equal(await captureAsync(function() {
      return asyncCallDestructorsChain(proxyContext);
    }), proxyFailure);
    assert.deepEqual(proxyEvents, ['base']);
  });
}

function registerSuppressedErrorContracts(test, createRealm, label) {
  test(`${label}: SuppressedError is callable, subclassable, and preserves descriptors`, function() {
    const realm = createRealm();
    const { Error, SuppressedError } = getBindings(realm);
    const error = { error: true };
    const suppressed = { suppressed: true };
    const callable = Reflect.apply(SuppressedError, undefined, [error, suppressed]);
    const constructed = new SuppressedError(error, suppressed, 42);

    assert.equal(callable instanceof SuppressedError, true);
    assert.equal(callable instanceof Error, true);
    assert.equal(callable.error, error);
    assert.equal(callable.suppressed, suppressed);
    assert.equal(Object.hasOwn(callable, 'message'), false);
    assert.equal(constructed.message, '42');
    assert.deepEqual(Object.getOwnPropertyDescriptor(callable, 'error'), {
      value: error,
      writable: true,
      enumerable: false,
      configurable: true
    });
    assert.deepEqual(Object.getOwnPropertyDescriptor(callable, 'suppressed'), {
      value: suppressed,
      writable: true,
      enumerable: false,
      configurable: true
    });
    assert.equal(SuppressedError.name, 'SuppressedError');
    assert.equal(SuppressedError.length, 3);
    assert.equal(Object.getOwnPropertyDescriptor(SuppressedError, 'prototype').writable, false);

    class ChildSuppressedError extends SuppressedError {}

    const child = new ChildSuppressedError(error, suppressed);
    assert.equal(child instanceof ChildSuppressedError, true);
    assert.equal(child instanceof SuppressedError, true);

    const converted = new SuppressedError(error, suppressed, {
      toString: function() {
        return 'converted';
      }
    });
    assert.equal(converted.message, 'converted');
  });
}

function registerBoundaryContracts(test, createRealm, label) {
  test(`${label}: resource getters cannot replace captured disposal protocol keys`, async function() {
    for (const asyncMode of [false, true]) {
      const realm = createRealm();
      const bindings = getBindings(realm);
      const Constructor = asyncMode ? bindings.AsyncDisposableStack : bindings.DisposableStack;
      const stack = new Constructor();
      const dispose = bindings.Symbol.dispose;
      const key = asyncMode ? bindings.Symbol.asyncDispose : dispose;
      const events = [];
      const resource = {};
      const first = function() {
        events.push('first');
      };

      Object.defineProperty(resource, key, {
        get: function() {
          realm.globals.globalThis.Symbol = {};
          return asyncMode ? undefined : first;
        }
      });

      if (asyncMode) {
        resource[dispose] = first;
      }

      assert.equal(stack.use(resource), resource);
      stack.use({
        [dispose]: function() {
          events.push('second');
        }
      });

      if (asyncMode) {
        await stack.disposeAsync();
      } else {
        stack.dispose();
      }

      assert.deepEqual(events, ['second', 'first']);
    }
  });

  test(`${label}: resource getters cannot replace intrinsic validation errors`, async function() {
    for (const mode of ['sync', 'async', 'sync fallback']) {
      const realm = createRealm();
      const bindings = getBindings(realm);
      const Constructor = mode === 'sync' ? bindings.DisposableStack : bindings.AsyncDisposableStack;
      const TypeErrorConstructor = realm.globals.globalThis.TypeError;
      const ReferenceErrorConstructor = realm.globals.globalThis.ReferenceError;
      const stack = new Constructor();
      const key = mode === 'async' ? bindings.Symbol.asyncDispose : bindings.Symbol.dispose;
      const injected = new Error('replaced validation error');
      const resource = {};

      Object.defineProperty(resource, key, {
        get: function() {
          const replacement = function() {
            throw injected;
          };
          realm.globals.globalThis.TypeError = replacement;
          realm.globals.globalThis.ReferenceError = replacement;
          return 1;
        }
      });

      assert.equal(Object.getPrototypeOf(captureSync(function() {
        stack.use(resource);
      })), TypeErrorConstructor.prototype);
      assert.equal(Object.getPrototypeOf(captureSync(function() {
        stack.defer(1);
      })), TypeErrorConstructor.prototype);
      assert.equal(Object.getPrototypeOf(captureSync(function() {
        stack.adopt({}, 1);
      })), TypeErrorConstructor.prototype);

      if (mode === 'sync') {
        assert.equal(Object.getPrototypeOf(captureSync(function() {
          Reflect.apply(Constructor.prototype.dispose, {}, []);
        })), TypeErrorConstructor.prototype);
        stack.dispose();
      } else {
        assert.equal(Object.getPrototypeOf(await captureAsync(function() {
          return Reflect.apply(Constructor.prototype.disposeAsync, {}, []);
        })), TypeErrorConstructor.prototype);
        await stack.disposeAsync();
      }

      assert.equal(Object.getPrototypeOf(captureSync(function() {
        stack.use(resource);
      })), ReferenceErrorConstructor.prototype);
    }
  });

  test(`${label}: destructor traversal survives replacement of the global Object`, async function() {
    for (const asyncMode of [false, true]) {
      const realm = createRealm();
      const bindings = getBindings(realm);
      const key = asyncMode ? bindings.Symbols.asyncDestructor : bindings.Symbols.destructor;
      const events = [];
      const original = new Error('original destructor failure');

      class Base {
        [key]() {
          events.push('base');
        }
      }

      class Derived extends Base {
        [key]() {
          events.push('derived');
          realm.globals.globalThis.Object = undefined;
          throw original;
        }
      }

      const context = new Derived();
      const failure = asyncMode
        ? await captureAsync(function() {
          return bindings.asyncCallDestructorsChain(context);
        })
        : captureSync(function() {
          bindings.callDestructorsChain(context);
        });

      assert.equal(failure, original);
      assert.deepEqual(events, ['derived', 'base']);
    }
  });

  test(`${label}: registration survives changes to private collection prototypes`, async function() {
    for (const asyncMode of [false, true]) {
      const realm = createRealm();
      const bindings = getBindings(realm);
      const Constructor = asyncMode ? bindings.AsyncDisposableStack : bindings.DisposableStack;
      const key = asyncMode ? bindings.Symbol.asyncDispose : bindings.Symbol.dispose;
      const stack = new Constructor();
      const events = [];
      const resource = {};

      Object.defineProperty(resource, key, {
        get: function() {
          vm.runInContext(`
            Array.prototype.push = function() { throw new Error('poisoned push'); };
            WeakMap.prototype.get = function() { throw new Error('poisoned get'); };
            WeakMap.prototype.set = function() { throw new Error('poisoned set'); };
            Object.defineProperty(Array.prototype, '0', {
              get: function() { throw new Error('poisoned index read'); },
              set: function() { throw new Error('poisoned index write'); },
              configurable: true
            });
          `, realm.context);

          return function() {
            events.push('resource');
          };
        }
      });

      assert.equal(stack.use(resource), resource);
      assert.equal(stack.disposed, false);
      stack.adopt('adopted', function(value) {
        events.push(value);
      });
      stack.defer(function() {
        events.push('deferred');
      });

      const later = new Constructor();
      later.defer(function() {
        events.push('later');
      });

      if (asyncMode) {
        await later.disposeAsync();
        await stack.disposeAsync();
      } else {
        later.dispose();
        stack.dispose();
      }

      assert.deepEqual(events, ['later', 'deferred', 'adopted', 'resource']);
    }
  });

  test(`${label}: cleanup survives a replaced Array pop and preserves the original failure`, async function() {
    for (const asyncMode of [false, true]) {
      const realm = createRealm();
      const bindings = getBindings(realm);
      const Constructor = asyncMode ? bindings.AsyncDisposableStack : bindings.DisposableStack;
      const stack = new Constructor();
      const events = [];
      const original = new Error('original cleanup failure');

      stack.defer(function() {
        events.push('lower');
      });
      stack.defer(function() {
        events.push('upper');
        vm.runInContext(
          "Array.prototype.pop = function() { throw new Error('poisoned pop'); };",
          realm.context
        );
        throw original;
      });

      const failure = asyncMode ? await captureAsync(function() {
        return stack.disposeAsync();
      }) : captureSync(function() {
        stack.dispose();
      });

      assert.equal(failure, original);
      assert.deepEqual(events, ['upper', 'lower']);
    }
  });

  test(`${label}: prototype cycles stop after each destructor is attempted once`, async function() {
    for (const asyncMode of [false, true]) {
      for (const scenario of ['no methods', 'methods', 'throwing methods']) {
        const realm = createRealm();
        const bindings = getBindings(realm);
        const key = asyncMode ? bindings.Symbols.asyncDestructor : bindings.Symbols.destructor;
        const events = [];
        const original = new Error('first destructor failed');
        const firstTarget = {};
        const secondTarget = {};
        let prototypeReads = 0;
        let second;

        function nextPrototype(value) {
          prototypeReads++;

          // Bound the regression itself so a broken walker fails instead of hanging the test process.
          if (prototypeReads > 6) {
            throw new Error('cycle detection did not stop traversal');
          }

          return value;
        }

        const first = new Proxy(firstTarget, {
          getPrototypeOf: function() {
            return nextPrototype(second);
          }
        });
        second = new Proxy(secondTarget, {
          getPrototypeOf: function() {
            return nextPrototype(first);
          }
        });

        if (scenario !== 'no methods') {
          firstTarget[key] = function() {
            events.push('first');
            vm.runInContext(`
              WeakSet.prototype.has = function() { return false; };
              WeakSet.prototype.add = function() { throw new Error('poisoned add'); };
              Object.getPrototypeOf = function() { return null; };
            `, realm.context);

            if (scenario === 'throwing methods') {
              throw original;
            }
          };
          secondTarget[key] = function() {
            events.push('second');
          };
        }

        const context = Object.create(first);
        const failure = asyncMode ? await captureAsync(function() {
          return bindings.asyncCallDestructorsChain(context);
        }) : captureSync(function() {
          bindings.callDestructorsChain(context);
        });

        assert.deepEqual(events, scenario === 'no methods' ? [] : ['first', 'second']);
        assert.equal(prototypeReads, 2);

        if (scenario === 'throwing methods') {
          assertErrorName(failure, 'SuppressedError');
          assertErrorName(failure.error, 'TypeError');
          assert.equal(failure.suppressed, original);
        } else {
          assertErrorName(failure, 'TypeError');
        }
      }
    }
  });
}

function registerCoreContracts(test, createRealm, label) {
  registerStackContracts(test, createRealm, label);
  registerAsyncStackContracts(test, createRealm, label);
  registerConstructorContracts(test, createRealm, label);
  registerDestructorContracts(test, createRealm, label);
  registerSuppressedErrorContracts(test, createRealm, label);
  registerBoundaryContracts(test, createRealm, label);
}

module.exports = {
  registerCoreContracts
};
