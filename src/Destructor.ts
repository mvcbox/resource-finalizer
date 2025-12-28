import { Symbols } from './Symbols';
import type { Destructible } from './Destructible';
import { createDisposableStack, callDestructorsChain } from './utils';

export abstract class Destructor implements Destructible {
  public [Symbols.disposableStack] = createDisposableStack();

  protected constructor() {
    this[Symbols.disposableStack].defer(() => {
      this[Symbols.callDestructorsChain]();
    });
  }

  public [Symbol.dispose](): void {
    this[Symbols.disposableStack].dispose();
  }

  public [Symbols.callDestructorsChain](): void {
    callDestructorsChain(this);
  }

  public abstract [Symbols.destructor](): void;
}
