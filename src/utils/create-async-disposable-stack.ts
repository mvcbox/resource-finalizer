import { AsyncDisposableStack } from '../AsyncDisposableStack';

export function createAsyncDisposableStack(): AsyncDisposableStack {
  return new AsyncDisposableStack();
}
