'use strict';

const path = require('node:path');
const { generateProject, writeProject } = require('./generate');

function printHelp() {
  process.stdout.write(`Usage: create-wasm-game <directory> [options]

Create a WASM Game Framework project. Writes RUNBOOK.md for an
implementation agent. The framework owns the document, launcher CSS,
service worker, and web manifest. This scaffold never writes those files.

Options:
  --name <id>                 Game id (default: directory name)
  --title <title>             Human title
  --display-mode <mode>       4:3 | 16:9 | dynamic (default: 4:3)
  --menu-cursor <mode>        native | browser | none (default: browser)
  --controller <mode>         disabled | wasdMouse | custom (default: disabled)
  --media                     Declare a media-library seam and validator
  --server                    Add a managed-server lifecycle stub
  --native-managed            Require adapter.resize() (implied by dynamic)
  --no-persistence            Declare persistence: false (not the default)
  --no-pointer-lock           Disable gameplay pointer capture
  --no-fullscreen             Hide Launch fullscreen
  --force                     Overwrite an existing scaffold
  --framework-root <path>     Framework checkout used for the exact pin
  -h, --help                  Show this help

Examples:
  npx create-wasm-game my-game
  npm create wasm-game@latest my-game -- --display-mode dynamic
`);
}

function takeValue(argv, index, flag) {
  const value = argv[index + 1];
  if (value == null || value.startsWith('-')) {
    throw new Error(`${flag} requires a value.`);
  }
  return value;
}

function parseArgv(argv) {
  const args = argv.slice(2);
  const options = {};
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '-h' || arg === '--help') return { help: true };
    if (!arg.startsWith('-') && !options.directory) {
      options.directory = path.resolve(arg);
      continue;
    }
    if (arg === '--name') { options.name = takeValue(args, i, arg); i += 1; continue; }
    if (arg === '--title') { options.title = takeValue(args, i, arg); i += 1; continue; }
    if (arg === '--display-mode') { options.displayMode = takeValue(args, i, arg); i += 1; continue; }
    if (arg === '--menu-cursor') { options.menuCursor = takeValue(args, i, arg); i += 1; continue; }
    if (arg === '--controller') { options.controller = takeValue(args, i, arg); i += 1; continue; }
    if (arg === '--framework-root') { options.frameworkRoot = takeValue(args, i, arg); i += 1; continue; }
    if (arg === '--media') { options.media = true; continue; }
    if (arg === '--server') { options.server = true; continue; }
    if (arg === '--native-managed') { options.nativeManaged = true; continue; }
    if (arg === '--no-persistence') { options.persistence = false; continue; }
    if (arg === '--no-pointer-lock') { options.pointerLock = false; continue; }
    if (arg === '--no-fullscreen') { options.fullscreen = false; continue; }
    if (arg === '--force') { options.force = true; continue; }
    throw new Error(`Unknown argument: ${arg}`);
  }
  if (!options.directory) throw new Error('A target directory is required.');
  return options;
}

function main(argv) {
  let parsed;
  try {
    parsed = parseArgv(argv);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
    return;
  }
  if (parsed.help) {
    printHelp();
    return;
  }
  try {
    const project = generateProject(parsed);
    const root = writeProject(project);
    process.stdout.write(`Created ${project.options.title} in ${root}\n`);
    process.stdout.write(`Pinned ${project.lock.package}@${project.lock.version}\n`);
    process.stdout.write('Wrote RUNBOOK.md for the implementation agent\n');
    process.stdout.write('Next: cd into the directory, read RUNBOOK.md, and run npm test\n');
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = { parseArgv, printHelp, main };

if (require.main === module) main(process.argv);
