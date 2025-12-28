import './polyfills';

require('disposablestack/auto');

export const AsyncDisposableStack = (globalThis as any).AsyncDisposableStack as typeof globalThis.AsyncDisposableStack;
