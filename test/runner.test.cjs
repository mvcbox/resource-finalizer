'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { validateStagedPackage } = require('./run-tests.cjs');

function withFixture(callback) {
  const date = new Date().toISOString();
  const timestamp = [
    date.slice(0, 10).replace(/-/g, ''),
    date.slice(11, 19).replace(/:/g, ''),
    date.slice(20, 23)
  ].join('-');
  const temporaryRoot = path.join(__dirname, '..', '_local_data');

  fs.mkdirSync(temporaryRoot, { recursive: true });

  const temporaryPath = fs.mkdtempSync(path.join(temporaryRoot, `${timestamp}-runner-`));
  const stagePath = path.join(temporaryPath, 'package with spaces');
  const cachePath = path.join(temporaryPath, 'cache with spaces');
  const npmCliPath = path.join(temporaryPath, 'npm cli with spaces.cjs');
  const manifestSource = `${JSON.stringify({
    name: 'resource-finalizer-runner-fixture',
    version: '1.0.0',
    files: ['dist'],
    scripts: {
      prepack: 'node -e "process.exit(97)"',
      prepare: 'node -e "process.exit(98)"',
      postpack: 'node -e "process.exit(99)"'
    }
  }, null, 2)}\n`;

  try {
    fs.mkdirSync(path.join(stagePath, 'dist'), { recursive: true });
    fs.writeFileSync(path.join(stagePath, 'package.json'), manifestSource);
    fs.writeFileSync(path.join(stagePath, 'README.md'), '# Runner fixture\n');
    fs.writeFileSync(path.join(stagePath, 'LICENSE'), 'MIT\n');
    fs.writeFileSync(path.join(stagePath, 'dist', 'index.js'), "'use strict';\n");
    fs.writeFileSync(path.join(stagePath, 'dist', 'index.d.ts'), 'export {};\n');
    fs.copyFileSync(path.join(__dirname, 'fixtures', 'npm-cli.cjs'), npmCliPath);

    callback({
      stagePath,
      cachePath,
      manifestSource,
      environment: {
        ...process.env,
        npm_execpath: npmCliPath,
        RESOURCE_FINALIZER_NPM_TEST_CLI: process.env.npm_execpath
      }
    });
  } finally {
    fs.rmSync(temporaryPath, { recursive: true, force: true });
  }
}

test('package validation runs the npm JS entry with spaces and skips hooks on the installed npm version', function() {
  withFixture(function({ stagePath, cachePath, manifestSource, environment }) {
    validateStagedPackage(stagePath, cachePath, environment);

    assert.equal(fs.readFileSync(path.join(stagePath, 'package.json'), 'utf8'), manifestSource);
    assert.equal(fs.existsSync(path.join(stagePath, 'dist', 'index.js')), true);
  });
});

test('package validation reports invalid npm output and restores the staged manifest after failure', function() {
  withFixture(function({ stagePath, cachePath, manifestSource, environment }) {
    const failures = [
      { mode: 'invalid-json', messages: [/npm pack returned invalid JSON/, /unexpected lifecycle output/] },
      { mode: 'invalid-package', messages: [/npm pack must return a JSON array containing one package/] },
      { mode: 'failed-command', messages: [/status 7/, /pack diagnostic on stdout/, /pack diagnostic on stderr/] }
    ];

    for (const { mode, messages } of failures) {
      assert.throws(function() {
        validateStagedPackage(stagePath, cachePath, {
          ...environment,
          RESOURCE_FINALIZER_NPM_FIXTURE_MODE: mode
        });
      }, function(error) {
        for (const message of messages) {
          assert.match(error.message, message);
        }

        return true;
      });

      assert.equal(fs.readFileSync(path.join(stagePath, 'package.json'), 'utf8'), manifestSource);
    }
  });
});
