'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const cli = path.join(root, 'packages', 'create-wasm-game', 'bin', 'create-wasm-game.js');
const {
  generateProject,
  writeProject,
  FORBIDDEN_SITE_FILES
} = require('../packages/create-wasm-game/lib/generate');

function makeDir(name) {
  return fs.mkdtempSync(path.join(os.tmpdir(), name));
}

function checker(site) {
  return spawnSync(process.execPath, [path.join(root, 'scripts', 'check-game-package.js'), site], {
    encoding: 'utf8'
  });
}

function assertScaffold(projectRoot) {
  const manifest = JSON.parse(fs.readFileSync(path.join(projectRoot, 'web', 'wasm-game.json'), 'utf8'));
  const lock = JSON.parse(fs.readFileSync(path.join(projectRoot, 'framework-lock.json'), 'utf8'));
  const adapter = fs.readFileSync(path.join(projectRoot, 'web', 'game-adapter.js'), 'utf8');
  const pkg = JSON.parse(fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8'));

  assert.ok(manifest.displayMode, 'displayMode must be explicit');
  assert.ok(manifest.menuCursor, 'menuCursor must be explicit');
  assert.equal(typeof manifest.fullscreen, 'boolean');
  assert.equal(manifest.controller.mode, 'disabled');
  assert.equal(typeof manifest.persistence, 'object');
  assert.match(manifest.persistence.root, /^\/save\//);
  assert.match(manifest.description, /in the browser/i);
  assert.doesNotMatch(manifest.description, /upload|cache|game data|files?/i);
  assert.doesNotMatch(manifest.pwa.description, /upload|cache|game data|files?/i);
  assert.equal(lock.package, '@wasm-game-framework/browser');
  assert.equal(lock.version, require('../package.json').version);
  assert.equal(pkg.wasmGameFramework.version, lock.version);
  assert.match(adapter, /persistence\.attach/);
  assert.match(adapter, /createNativeModule/);
  assert.ok(fs.existsSync(path.join(projectRoot, 'Dockerfile')));
  assert.ok(fs.existsSync(path.join(projectRoot, 'scripts', 'build-image.sh')));
  assert.ok(fs.existsSync(path.join(projectRoot, 'test', 'package-contract.test.js')));
  assert.ok(fs.existsSync(path.join(projectRoot, 'RUNBOOK.md')));
  assert.ok(fs.existsSync(path.join(projectRoot, 'vendor', 'wasm-game-framework', 'scripts', 'check-game-package.js')));
  assert.ok(fs.existsSync(path.join(projectRoot, 'vendor', 'wasm-game-framework', 'ADAPTER_RUNBOOK.md')));
  const runbook = fs.readFileSync(path.join(projectRoot, 'RUNBOOK.md'), 'utf8');
  assert.match(runbook, /llms\.txt/);
  assert.match(runbook, /ADAPTER_RUNBOOK/);
  assert.match(runbook, /persistence\.attach|IDBFS/);
  assert.match(runbook, new RegExp(manifest.title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(runbook, /displayMode/);
  assert.doesNotMatch(runbook, /index\.html[\s\S]{0,40}you should add/i);

  for (const forbidden of [...FORBIDDEN_SITE_FILES, 'web/service-worker.js', 'index.html']) {
    assert.equal(fs.existsSync(path.join(projectRoot, forbidden)), false, `must not emit ${forbidden}`);
  }
  assert.equal(fs.existsSync(path.join(projectRoot, 'web', 'app.webmanifest')), false);
  const siteFiles = fs.readdirSync(path.join(projectRoot, 'web'));
  assert.ok(!siteFiles.some(name => name.endsWith('.css')), 'must not emit downstream CSS');
  assert.ok(!siteFiles.some(name => name.endsWith('.webmanifest')));

  const check = checker(path.join(projectRoot, 'web'));
  assert.equal(check.status, 0, check.stderr || check.stdout);

  const generatedTest = spawnSync(process.execPath, [path.join(projectRoot, 'test', 'package-contract.test.js')], {
    encoding: 'utf8'
  });
  assert.equal(generatedTest.status, 0, generatedTest.stderr || generatedTest.stdout);
}

const generated = generateProject({
  directory: makeDir('create-wasm-game-map-'),
  name: 'example-game',
  title: 'Example Game',
  frameworkRoot: root
});

assert.ok(generated.files['web/wasm-game.json']);
assert.ok(generated.files['web/game-adapter.js']);
assert.ok(generated.files['Dockerfile']);
assert.ok(generated.files['test/package-contract.test.js']);
assert.ok(generated.files['RUNBOOK.md']);
assert.match(generated.files['RUNBOOK.md'], /AI implementation runbook/);
assert.match(generated.files['RUNBOOK.md'], /theodorecharles\.github\.io\/wasm-game-framework\/llms\.txt/);
assert.ok(!generated.files['web/index.html']);
assert.ok(!generated.files['web/service-worker.js']);
assert.ok(!generated.files['web/app.webmanifest']);
assert.match(generated.files['web/game-adapter.js'], /context\.persistence\.attach/);
writeProject(generated);
assertScaffold(generated.options.directory);
fs.rmSync(generated.options.directory, { recursive: true, force: true });

const first = makeDir('create-wasm-game-cli-1-');
const second = makeDir('create-wasm-game-cli-2-');
for (const target of [first, second]) {
  const result = spawnSync(process.execPath, [cli, target, '--name', 'cli-game', '--title', 'CLI Game'], {
    encoding: 'utf8'
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /Pinned @wasm-game-framework\/browser@/);
  assertScaffold(target);
  fs.rmSync(target, { recursive: true, force: true });
}

const mediaDir = makeDir('create-wasm-game-media-');
writeProject(generateProject({
  directory: mediaDir,
  name: 'media-game',
  media: true,
  frameworkRoot: root,
  force: true
}));
assert.ok(fs.existsSync(path.join(mediaDir, 'web', 'data-validator.mjs')));
assert.equal(checker(path.join(mediaDir, 'web')).status, 0);
fs.rmSync(mediaDir, { recursive: true, force: true });

console.log('create-wasm-game generator, CLI, and package-checker checks passed');
