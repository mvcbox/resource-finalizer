require('disposablestack/auto');

export function createDisposableStack(): DisposableStack {
  return new DisposableStack();
}
