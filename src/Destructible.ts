import type { Destructor } from './Destructor';

export interface Destructible extends Disposable {
  [Destructor.disposableStack]: DisposableStack;
}
