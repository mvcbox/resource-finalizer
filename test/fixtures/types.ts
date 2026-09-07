import {
  AsyncDisposableStack as AsyncStack,
  AsyncScopeGuard,
  DisposableStack as SyncStack,
  ScopeGuard
} from 'resource-finalizer';
import type {
  AsyncDisposableStack as ImportedAsyncStack,
  DisposableStack as ImportedSyncStack
} from 'resource-finalizer';
import * as ResourceFinalizer from 'resource-finalizer';

const syncStack: ImportedSyncStack = new SyncStack();
const asyncStack: ImportedAsyncStack = new AsyncStack();
const namespaceSyncStack: ResourceFinalizer.DisposableStack = new ResourceFinalizer.DisposableStack();
const namespaceAsyncStack: ResourceFinalizer.AsyncDisposableStack = new ResourceFinalizer.AsyncDisposableStack();
const guard = new ScopeGuard(function() {});
const asyncGuard = new AsyncScopeGuard(async function(): Promise<void> {});
const syncResult: void = guard[Symbol.dispose]();
const asyncResult: Promise<void> = asyncGuard[Symbol.asyncDispose]();

void namespaceSyncStack;
void namespaceAsyncStack;
void syncResult;
void asyncResult;
