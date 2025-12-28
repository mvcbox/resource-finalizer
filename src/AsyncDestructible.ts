import type { Destructor } from './Destructor';

export interface AsyncDestructible extends AsyncDisposable {
  [Destructor.asyncDisposableStack]: AsyncDisposableStack;
}
