#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const packageRoot = path.resolve(__dirname, '..');
const repoRoot = path.resolve(packageRoot, '..', '..');
const dest = path.join(packageRoot, 'framework');

function copyFile(from, to) {
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
}

function copyDir(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const source = path.join(from, entry.name);
    const target = path.join(to, entry.name);
    if (entry.isDirectory()) copyDir(source, target);
    else if (entry.isFile()) copyFile(source, target);
  }
}

if (!fs.existsSync(path.join(repoRoot, 'dist', 'wasm-game-framework.js'))) {
  if (fs.existsSync(path.join(dest, 'dist', 'wasm-game-framework.js'))) process.exit(0);
  throw new Error('Cannot snapshot wasm-game-framework: dist/wasm-game-framework.js is missing.');
}

fs.rmSync(dest, { recursive: true, force: true });
copyDir(path.join(repoRoot, 'dist'), path.join(dest, 'dist'));
copyDir(path.join(repoRoot, 'server'), path.join(dest, 'server'));
copyFile(path.join(repoRoot, 'scripts', 'check-game-package.js'), path.join(dest, 'scripts', 'check-game-package.js'));
copyFile(path.join(repoRoot, 'package.json'), path.join(dest, 'package.json'));
copyFile(path.join(repoRoot, 'ADAPTER_RUNBOOK.md'), path.join(dest, 'ADAPTER_RUNBOOK.md'));
copyFile(path.join(repoRoot, 'SERVER_RUNBOOK.md'), path.join(dest, 'SERVER_RUNBOOK.md'));
process.stdout.write(`create-wasm-game: snapshotted framework ${require(path.join(repoRoot, 'package.json')).version}\n`);
