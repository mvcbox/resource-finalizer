'use strict';

const mode = process.env.RESOURCE_FINALIZER_NPM_FIXTURE_MODE;

if (mode === 'invalid-json') {
  process.stdout.write('unexpected lifecycle output\n[]\n');
} else if (mode === 'invalid-package') {
  process.stdout.write('[]\n');
} else if (mode === 'failed-command') {
  process.stdout.write('pack diagnostic on stdout\n');
  process.stderr.write('pack diagnostic on stderr\n');
  process.exitCode = 7;
} else {
  require(process.env.RESOURCE_FINALIZER_NPM_TEST_CLI);
}
