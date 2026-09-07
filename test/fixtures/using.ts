import { ScopeGuard } from 'resource-finalizer';

const events: string[] = [];

{
  using guard = new ScopeGuard(function() {
    events.push('dispose');
  });

  events.push('body');
}

if (events.join(',') !== 'body,dispose') {
  throw new Error(`Unexpected using order: ${events.join(',')}`);
}
