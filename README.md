[![npm version](https://badge.fury.io/js/resource-finalizer.svg)](https://badge.fury.io/js/resource-finalizer)

# Resource Finalizer

Deterministic cleanup helpers for TypeScript/JavaScript based on **ECMAScript Explicit Resource Management** (`using` / `await using`) and **DisposableStack**.

The package provides two base classes:

- `Destructor` — synchronous cleanup
- `AsyncDestructor` — asynchronous cleanup

And two ready-to-use scope guards:

- `ScopeGuard` — run a callback on scope exit (sync)
- `AsyncScopeGuard` — run an async callback on scope exit (async)


When an instance is disposed, **all destructors declared in the class inheritance chain** are invoked automatically (from the most-derived class to the base class).

---

## Features

- ✅ Works with `using` / `await using` (and manual `Symbol.dispose` / `Symbol.asyncDispose` calls)
- ✅ Automatic destructor chaining across inheritance (`C -> B -> A`)
- ✅ Existing `DisposableStack` / `AsyncDisposableStack` implementations, with bundled fallbacks when absent
- ✅ Scope guards for ad-hoc cleanup (`ScopeGuard` / `AsyncScopeGuard`)
- ✅ Small API surface, TypeScript-first typings

---

## Install

```bash
npm install resource-finalizer
```

---

## Requirements

- **TypeScript 5.2 or later:** enable the disposable APIs in your `tsconfig.json`. Use an appropriate output target for your runtime; `ES6` supports the package's Node.js 6 minimum:

```jsonc
{
  "compilerOptions": {
    "target": "ES6",
    "lib": ["ES2022", "ESNext.Disposable"]
  }
}
```

- **Runtime:** Node.js 6 or later. The package installs its own fallbacks for missing `Symbol.dispose`, `Symbol.asyncDispose`, `SuppressedError`, `DisposableStack`, and `AsyncDisposableStack`, and initializes `globalThis` if needed. No runtime dependencies are required.

Existing non-`undefined` global values are preserved without validation, including native implementations and third-party polyfills. The exported `DisposableStack` and `AsyncDisposableStack` values reference the globals present when the package is first imported. Pre-installed polyfills are neither replaced nor repaired, and later changes to those globals do not update the exports.

Fallback symbols created in separate realms have different identities. Resources shared across realms (for example, iframes) must expose the receiving realm's disposal symbols.

> Runtime API polyfills do not transform `using` / `await using` syntax. Compile these declarations with TypeScript 5.2+ when your runtime does not support them. See the [TypeScript 5.2 release notes](https://www.typescriptlang.org/docs/handbook/release-notes/typescript-5-2.html#using-declarations-and-explicit-resource-management).

---

## Quick start (sync)

```ts
import { Symbols, Destructor } from 'resource-finalizer';

class A extends Destructor {
  public constructor() {
    super();
    console.log('[A] constructor');
  }

  public [Symbols.destructor](): void {
    console.log('[A] destructor');
  }
}

class B extends A {
  public constructor() {
    super();
    console.log('[B] constructor');
  }

  public [Symbols.destructor](): void {
    console.log('[B] destructor');
  }
}

class C extends B {
  public constructor() {
    super();
    console.log('[C] constructor');
  }

  public [Symbols.destructor](): void {
    console.log('[C] destructor');
  }
}

{
  using instance = new C();
  console.log('End scope');
}

console.log('End code');
```

Expected order:

- constructors: `A -> B -> C`
- destructors (on scope exit): `C -> B -> A`

---

## Quick start (async)

```ts
import { Symbols, AsyncDestructor } from 'resource-finalizer';

class A extends AsyncDestructor {
  public constructor() {
    super();
    console.log('[Async][A] constructor');
  }

  public async [Symbols.asyncDestructor](): Promise<void> {
    console.log('[Async][A] destructor');
  }
}

class B extends A {
  public constructor() {
    super();
    console.log('[Async][B] constructor');
  }

  public async [Symbols.asyncDestructor](): Promise<void> {
    console.log('[Async][B] destructor');
  }
}

class C extends B {
  public constructor() {
    super();
    console.log('[Async][C] constructor');
  }

  public async [Symbols.asyncDestructor](): Promise<void> {
    console.log('[Async][C] destructor');
  }
}

(async () => {
  {
    await using instance = new C();
    console.log('[Async] End scope');
  }

  console.log('[Async] End code');
})().catch(console.error);
```

---


## Scope guards

If you only need “run this cleanup when the scope ends”, you don’t have to define a new class.
Use `ScopeGuard` / `AsyncScopeGuard` — small wrappers around `Destructor` / `AsyncDestructor` that execute a user-provided finalizer when disposed.

### Sync (`ScopeGuard`)

```ts
import { ScopeGuard } from 'resource-finalizer';

{
  using _ = new ScopeGuard(() => {
    console.log('cleanup runs on scope exit');
  });

  console.log('work');
}

console.log('after scope');
```

### Async (`AsyncScopeGuard`)

This file-system example requires Node.js 14.18 or later for `node:fs` and `fs.promises.rm`.

```ts
import { AsyncScopeGuard } from 'resource-finalizer';
import { promises as fs } from 'node:fs';

async function demo() {
  const path = './tmp.txt';
  await fs.writeFile(path, 'hello');

  await using _ = new AsyncScopeGuard(async () => {
    await fs.rm(path, { force: true });
  });

  // use the file...
}
```

### Without `using` / `await using`

```ts
import { ScopeGuard, AsyncScopeGuard } from 'resource-finalizer';

const g = new ScopeGuard(() => console.log('cleanup'));
try {
  // work...
} finally {
  g[Symbol.dispose]();
}

async function demoAsync() {
  const g = new AsyncScopeGuard(async () => console.log('async cleanup'));
  try {
    // work...
  } finally {
    await g[Symbol.asyncDispose]();
  }
}
```

### Combine with `DisposableStack`

Because scope guards implement `Disposable` / `AsyncDisposable`, you can register them in a stack:

```ts
import { Symbols, Destructor, ScopeGuard } from 'resource-finalizer';

class Service extends Destructor {
  public constructor() {
    super();

    this[Symbols.disposableStack].use(
      new ScopeGuard(() => console.log('Service stopped'))
    );
  }

  public [Symbols.destructor](): void {
    // other cleanup...
  }
}
```

---


## Without inheritance from Destructor / AsyncDestructor

```ts
import { Symbols, Destructible, createDisposableStack, callDestructorsChain } from 'resource-finalizer';

class SomeBaseClass {}

/**
 * We need to add destructor support to a class that is already a derived class.
 * To do this, you need to implement the following yourself
 *
 * - [Symbols.disposableStack]: DisposableStack;
 * - [Symbols.callDestructorsChain](): void;
 * - [Symbols.destructor](): void;
 * - [Symbol.dispose](): void;
 */
class A extends SomeBaseClass implements Destructible {
  public [Symbols.disposableStack] = createDisposableStack();

  public [Symbol.dispose](): void {
    this[Symbols.disposableStack].dispose();
  }

  public constructor() {
    super();

    this[Symbols.disposableStack].defer(() => {
      this[Symbols.callDestructorsChain]();
    });

    console.log('[A] constructor');
  }

  public [Symbols.callDestructorsChain](): void {
    callDestructorsChain(this);
  }

  public [Symbols.destructor](): void {
    console.log('[A] destructor');
  }
}

class B extends A {
  public constructor() {
    super();
    console.log('[B] constructor');
  }

  public [Symbols.destructor](): void {
    console.log('[B] destructor');
  }
}

class C extends B {
  public constructor() {
    super();
    console.log('[C] constructor');
  }

  public [Symbols.destructor](): void {
    console.log('[C] destructor');
  }
}

{
  using instance = new C();
  console.log('End scope');
}

console.log('End code');

```

---

## Using the built-in stacks

Every `Destructor` instance owns a `DisposableStack` accessible via a symbol key:

```ts
import { Symbols, Destructor } from 'resource-finalizer';

class FileHandle extends Destructor {
  private fd: number;

  public constructor(fd: number) {
    super();
    this.fd = fd;

    // Register cleanup actions.
    this[Symbols.disposableStack].defer(() => {
      // close(fd)
    });
  }

  public [Symbols.destructor](): void {
    // Additional destructor logic (logging, metrics, invariants, etc.)
  }
}
```

For async cleanup, use `AsyncDestructor` and `Symbols.asyncDisposableStack`.

---

### Important note about destructor chaining

The destructor chain is discovered by walking the **prototype chain** and calling destructors that are **defined directly on each prototype**.

That means:

- ✅ Define destructors as class methods: `public [Symbols.destructor](){...}`
- ❌ Don’t assign destructors as instance fields (e.g. `this[Symbols.destructor] = () => {}`), because they won’t be found by the chain walker.
- ❌ Don’t call `super[Symbols.destructor]()` manually — the base destructors are called automatically and you’d double-run them.

### Cleanup errors

Cleanup continues after a destructor throws or rejects: every discoverable destructor is attempted in `C -> B -> A` order. Stack callbacks likewise continue in reverse registration order. Errors are thrown or rejected only after cleanup finishes.

A cyclic prototype chain reported by a `Proxy` ends the walk with a `TypeError`; each prototype is visited at most once.

A single failure is rethrown unchanged, including a non-Error value. Multiple failures form a `SuppressedError` chain: each later failure is stored in `.error`, with the preceding failure in `.suppressed`. For `C -> B -> A` where all three fail, the final error contains `A` in `.error`, `B` in `.suppressed.error`, and the original `C` failure in `.suppressed.suppressed`. This follows [ECMAScript resource disposal](https://tc39.es/ecma262/multipage/abstract-operations.html#sec-disposeresources).

The stack is marked disposed before cleanup starts. Repeated disposal does not retry callbacks; a concurrent second `disposeAsync()` returns its own resolved promise without waiting for the first call. A failure in a `using` body can be wrapped together with cleanup failures by the compiler or runtime.

---

## API

### `Symbols`

A holder of unique symbols used as keys:

- `Symbols.destructor`
- `Symbols.asyncDestructor`
- `Symbols.disposableStack`
- `Symbols.asyncDisposableStack`
- `Symbols.callDestructorsChain`
- `Symbols.asyncCallDestructorsChain`

### `class Destructor`

- Implements `Disposable` (`[Symbol.dispose]()`)
- Provides an instance `DisposableStack` at `this[Symbols.disposableStack]`
- Requires you to implement `public abstract [Symbols.destructor](): void`

### `class AsyncDestructor`

- Implements `AsyncDisposable` (`[Symbol.asyncDispose]()`)
- Provides an instance `AsyncDisposableStack` at `this[Symbols.asyncDisposableStack]`
- Requires you to implement `public abstract [Symbols.asyncDestructor](): Promise<void>`


### `class ScopeGuard`

- Extends `Destructor`
- Constructor: `new ScopeGuard(() => void)`
- Executes the finalizer on `[Symbol.dispose]()` / `using` scope exit

### `class AsyncScopeGuard`

- Extends `AsyncDestructor`
- Constructor: `new AsyncScopeGuard(() => Promise<void>)`
- Executes the finalizer on `[Symbol.asyncDispose]()` / `await using` scope exit

### Types

- `Destructible`
- `AsyncDestructible`

### Stack re-exports

- `DisposableStack`
- `AsyncDisposableStack`

Both names export a constructor and an instance type, including when imported under an alias or through a namespace:

```ts
import {
  DisposableStack as SyncStack,
  AsyncDisposableStack as AsyncStack
} from 'resource-finalizer';
import type * as ResourceFinalizer from 'resource-finalizer';

const sync: SyncStack = new SyncStack();
const async: AsyncStack = new AsyncStack();
const syncInstance: ResourceFinalizer.DisposableStack = sync;
const asyncInstance: ResourceFinalizer.AsyncDisposableStack = async;
```

### Utils

- `createDisposableStack(): DisposableStack`
- `createAsyncDisposableStack(): AsyncDisposableStack`
- `callDestructorsChain(obj: object): void`
- `asyncCallDestructorsChain(obj: object): Promise<void>`

## Development

Development requires Node.js 18 or later and npm 8.6 or later, separately from the published package's runtime minimum.

```bash
npm run typecheck
npm test
```

The tests compile a fresh package and TypeScript consumers into `_local_data/`, then exercise native stacks when available and isolated fallbacks, including `using` / `await using`. These checks preserve the root `dist` directory. `npm run build` replaces `dist` for packaging.

## License

MIT
