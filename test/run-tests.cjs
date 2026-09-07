'use strict';

const assert = require('node:assert/strict');
const childProcess = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const repositoryPath = path.resolve(__dirname, '..');

function timestamp() {
  const now = new Date();
  const date = now.toISOString();

  return `${date.slice(0, 10).replace(/-/g, '')}-${date.slice(11, 19).replace(/:/g, '')}-${date.slice(20, 23)}`;
}

function run(command, argumentsList, options = {}) {
  const result = childProcess.spawnSync(command, argumentsList, {
    cwd: options.cwd || repositoryPath,
    env: options.env || process.env,
    encoding: 'utf8'
  });

  if (!options.silent && result.stdout) {
    process.stdout.write(result.stdout);
  }

  if (!options.silent && result.stderr) {
    process.stderr.write(result.stderr);
  }

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    const details = options.silent ? [result.stdout, result.stderr].filter(Boolean).join('\n').trim() : '';

    throw new Error(`${command} exited with status ${String(result.status)}.${details ? `\n${details}` : ''}`);
  }

  return result.stdout;
}

function copyPackageFiles(stagePath) {
  for (const filename of ['package.json', 'README.md', 'LICENSE']) {
    fs.copyFileSync(path.join(repositoryPath, filename), path.join(stagePath, filename));
  }
}

function compileStagedPackage(stagePath) {
  const typescriptPath = path.join(repositoryPath, 'node_modules', 'typescript', 'bin', 'tsc');
  const distPath = path.join(stagePath, 'dist');

  run(process.execPath, [
    typescriptPath,
    '--project', path.join(repositoryPath, 'tsconfig.json'),
    '--outDir', distPath
  ]);

  assert.equal(fs.existsSync(path.join(distPath, 'index.js')), true);
  assert.equal(fs.existsSync(path.join(distPath, 'index.d.ts')), true);
}

function validateStagedPackage(stagePath, cachePath, environment = process.env) {
  const npmCliPath = environment.npm_execpath;

  if (typeof npmCliPath !== 'string' || npmCliPath === '') {
    throw new Error('Run the test suite with npm test so npm_execpath points to the npm CLI.');
  }

  const manifestPath = path.join(stagePath, 'package.json');
  const manifestSource = fs.readFileSync(manifestPath, 'utf8');
  const manifest = JSON.parse(manifestSource);
  let output;

  // npm 8.6 runs pack hooks despite --ignore-scripts; the staging copy is already compiled.
  delete manifest.scripts;

  try {
    fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    output = run(process.execPath, [npmCliPath, 'pack', '--dry-run', '--ignore-scripts', '--json'], {
      cwd: stagePath,
      env: {
        ...environment,
        npm_config_cache: cachePath
      },
      silent: true
    });
  } finally {
    fs.writeFileSync(manifestPath, manifestSource);
  }

  let packageDetails;

  try {
    packageDetails = JSON.parse(output);
  } catch (error) {
    throw new Error(`npm pack returned invalid JSON:\n${output}`, { cause: error });
  }

  assert.ok(
    Array.isArray(packageDetails) && packageDetails.length === 1 && Array.isArray(packageDetails[0]?.files),
    'npm pack must return a JSON array containing one package with a files array.'
  );

  const files = packageDetails[0].files.map(function(file) {
    assert.equal(typeof file?.path, 'string', 'Every npm pack file entry must contain a path.');

    return file.path;
  });

  assert.equal(files.includes('dist/index.js'), true);
  assert.equal(files.includes('dist/index.d.ts'), true);
  assert.equal(files.includes('README.md'), true);
  assert.equal(files.includes('LICENSE'), true);
}

function compileConsumerFixtures(stagePath, temporaryPath) {
  const consumerPath = path.join(temporaryPath, 'consumer');
  const packageLinkPath = path.join(consumerPath, 'node_modules', 'resource-finalizer');
  const fixturePath = path.join(repositoryPath, 'test', 'fixtures');
  const configPath = path.join(consumerPath, 'tsconfig.json');
  const typescriptPath = path.join(repositoryPath, 'node_modules', 'typescript', 'bin', 'tsc');

  fs.mkdirSync(path.dirname(packageLinkPath), { recursive: true });
  fs.symlinkSync(stagePath, packageLinkPath, process.platform === 'win32' ? 'junction' : 'dir');
  fs.writeFileSync(path.join(consumerPath, 'package.json'), '{\n  "private": true,\n  "type": "commonjs"\n}\n');

  for (const filename of ['types.ts', 'using.ts', 'using.mts']) {
    fs.copyFileSync(path.join(fixturePath, filename), path.join(consumerPath, filename));
  }

  fs.writeFileSync(configPath, `${JSON.stringify({
    extends: path.join(repositoryPath, 'tsconfig.json'),
    compilerOptions: {
      rootDir: '.',
      outDir: './compiled',
      module: 'NodeNext',
      moduleResolution: 'NodeNext',
      noEmitOnError: true
    },
    include: ['./types.ts', './using.ts', './using.mts']
  }, null, 2)}\n`);

  run(process.execPath, [typescriptPath, '--project', configPath], { cwd: consumerPath });
  run(process.execPath, [path.join(consumerPath, 'compiled', 'using.js')], { cwd: consumerPath });
  run(process.execPath, [path.join(consumerPath, 'compiled', 'using.mjs')], { cwd: consumerPath });
}

function runRuntimeTests(stagePath) {
  const testPath = path.join(repositoryPath, 'test', 'runtime');
  const environment = {
    ...process.env,
    RESOURCE_FINALIZER_TEST_PACKAGE: stagePath
  };
  const files = [
    'fallback.test.cjs',
    'native.test.cjs',
    'polyfills.test.cjs',
    'child-smoke.test.cjs'
  ];

  for (const filename of files) {
    run(process.execPath, [path.join(testPath, filename)], { env: environment });
  }
}

function main() {
  const temporaryPath = path.join(repositoryPath, '_local_data', `${timestamp()}-test-${process.pid}`);
  const stagePath = path.join(temporaryPath, 'package');
  const cachePath = path.join(temporaryPath, 'npm-cache');

  fs.mkdirSync(stagePath, { recursive: true });
  fs.mkdirSync(cachePath, { recursive: true });
  run(process.execPath, [path.join(repositoryPath, 'test', 'runner.test.cjs')]);
  copyPackageFiles(stagePath);
  compileStagedPackage(stagePath);
  validateStagedPackage(stagePath, cachePath);
  compileConsumerFixtures(stagePath, temporaryPath);
  runRuntimeTests(stagePath);
}

if (require.main === module) {
  main();
}

module.exports = { validateStagedPackage };
