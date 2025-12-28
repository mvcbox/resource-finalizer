[![npm version](https://badge.fury.io/js/resource-finalizer.svg)](https://badge.fury.io/js/resource-finalizer)

# Resource Finalizer

Deterministic cleanup helpers for TypeScript/JavaScript based on **ECMAScript Explicit Resource Management** (`using` / `await using`) and **DisposableStack**.

The package provides two base classes:

- `Destructor` — synchronous cleanup
- `AsyncDestructor` — asynchronous cleanup

When an instance is disposed, **all destructors declared in the class inheritance chain** are invoked automatically (from the most-derived class to the base class).

---

## Features

- ✅ Works with `using` / `await using` (and manual `Symbol.dispose` / `Symbol.asyncDispose` calls)
- ✅ Automatic destructor chaining across inheritance (`C -> B -> A`)
- ✅ Built-in `DisposableStack` / `AsyncDisposableStack` (via the `disposablestack` polyfill)
- ✅ Small API surface, TypeScript-first typings

---

## Install

```bash
npm install resource-finalizer
```

---

## Requirements

- **TypeScript:** enable the disposable APIs in your `tsconfig.json`:

```jsonc
{
  "compilerOptions": {
    "lib": ["ES2022", "ESNext.Disposable"]
  }
}
```

- **Runtime:** this library imports `disposablestack/auto` internally to ensure `DisposableStack` / `AsyncDisposableStack` exist on `globalThis`.

> `using` / `await using` are part of the Explicit Resource Management proposal and require TypeScript (or a runtime) that understands this syntax.

---

## Quick start (sync)

```ts
import { Symbols, Destructor } from 'resource-finalizer';

class A extends Destructor {
  constructor() {
    super();
    console.log('[A] constructor');
  }

  [Symbols.destructor](): void {
    console.log('[A] destructor');
  }
}

class B extends A {
  constructor() {
    super();
    console.log('[B] constructor');
  }

  [Symbols.destructor](): void {
    console.log('[B] destructor');
  }
}

class C extends B {
  constructor() {
    super();
    console.log('[C] constructor');
  }

  [Symbols.destructor](): void {
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
  constructor() {
    super();
    console.log('[Async][A] constructor');
  }

  async [Symbols.asyncDestructor](): Promise<void> {
    console.log('[Async][A] destructor');
  }
}

class B extends A {
  constructor() {
    super();
    console.log('[Async][B] constructor');
  }

  async [Symbols.asyncDestructor](): Promise<void> {
    console.log('[Async][B] destructor');
  }
}

class C extends B {
  constructor() {
    super();
    console.log('[Async][C] constructor');
  }

  async [Symbols.asyncDestructor](): Promise<void> {
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
  constructor() {
    super();
    console.log('[B] constructor');
  }

  [Symbols.destructor](): void {
    console.log('[B] destructor');
  }
}

class C extends B {
  constructor() {
    super();
    console.log('[C] constructor');
  }

  [Symbols.destructor](): void {
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

  constructor(fd: number) {
    super();
    this.fd = fd;

    // Register cleanup actions.
    this[Symbols.disposableStack].defer(() => {
      // close(fd)
    });
  }

  [Symbols.destructor](): void {
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

### Types

- `Destructible`
- `AsyncDestructible`

### Stack re-exports

- `DisposableStack`
- `AsyncDisposableStack`

### Utils

- `createDisposableStack(): DisposableStack`
- `createAsyncDisposableStack(): AsyncDisposableStack`
- `callDestructorsChain(obj: object): void`
- `asyncCallDestructorsChain(obj: object): Promise<void>`

## License

MIT
