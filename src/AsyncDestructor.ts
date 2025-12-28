import { Symbols } from './Symbols';
import type { AsyncDestructible } from './AsyncDestructible';
import { createAsyncDisposableStack, asyncCallDestructorsChain } from './utils';

export abstract class AsyncDestructor implements AsyncDestructible {
  public [Symbols.asyncDisposableStack] = createAsyncDisposableStack();

  protected constructor() {
    this[Symbols.asyncDisposableStack].defer(async () => {
      await this[Symbols.asyncCallDestructorsChain]();
    });
  }

  public async [Symbol.asyncDispose](): Promise<void> {
    await this[Symbols.asyncDisposableStack].disposeAsync();
  }

  public async [Symbols.asyncCallDestructorsChain](): Promise<void> {
    await asyncCallDestructorsChain(this);
  }

  public abstract [Symbols.asyncDestructor](): Promise<void>;
}
