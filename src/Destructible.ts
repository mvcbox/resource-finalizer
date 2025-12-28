import { Symbols } from './Symbols';

export interface Destructible extends Disposable {
  [Symbols.disposableStack]: DisposableStack;
  [Symbols.callDestructorsChain](): void;
  [Symbols.destructor](): void;
}
