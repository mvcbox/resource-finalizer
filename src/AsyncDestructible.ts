import { Symbols } from './Symbols';

export interface AsyncDestructible extends AsyncDisposable {
  [Symbols.asyncDisposableStack]: AsyncDisposableStack;
  [Symbols.asyncCallDestructorsChain](): Promise<void>;
  [Symbols.asyncDestructor](): Promise<void>;
}
