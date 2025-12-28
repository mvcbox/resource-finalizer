require('disposablestack/auto');

export function createAsyncDisposableStack(): AsyncDisposableStack {
  return new AsyncDisposableStack();
}
