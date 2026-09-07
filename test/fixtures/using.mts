import { AsyncScopeGuard } from 'resource-finalizer';

async function main(): Promise<void> {
  const events: string[] = [];

  {
    await using guard = new AsyncScopeGuard(async function(): Promise<void> {
      events.push('dispose');
    });

    events.push('body');
  }

  if (events.join(',') !== 'body,dispose') {
    throw new Error(`Unexpected await using order: ${events.join(',')}`);
  }
}

main().then(undefined, function(error) {
  console.error(error);
  process.exitCode = 1;
});
