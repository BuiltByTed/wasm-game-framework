'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const DISPLAY_MODES = new Set(['4:3', '16:9', 'dynamic']);
const MENU_CURSORS = new Set(['native', 'browser', 'none']);
const CONTROLLER_MODES = new Set(['disabled', 'wasdMouse', 'custom']);

const FORBIDDEN_SITE_FILES = Object.freeze([
  'web/index.html',
  'web/service-worker.js',
  'web/app.webmanifest'
]);

function fail(message) {
  const error = new Error(message);
  error.code = 'CREATE_WASM_GAME';
  throw error;
}

function sanitizeId(value) {
  const id = String(value || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  if (!id || !/^[a-z0-9][a-z0-9-]*$/.test(id)) fail('Game id must contain letters, numbers, or dashes.');
  return id;
}

function resolveFrameworkRoot(explicit) {
  if (explicit) {
    const root = path.resolve(explicit);
    if (!fs.existsSync(path.join(root, 'dist', 'wasm-game-framework.js'))) {
      fail(`WASM_GAME_FRAMEWORK_ROOT is not a framework checkout: ${root}`);
    }
    return root;
  }
  if (process.env.WASM_GAME_FRAMEWORK_ROOT) {
    return resolveFrameworkRoot(process.env.WASM_GAME_FRAMEWORK_ROOT);
  }
  const repoRoot = path.resolve(__dirname, '..', '..', '..');
  if (fs.existsSync(path.join(repoRoot, 'dist', 'wasm-game-framework.js'))) return repoRoot;
  const bundled = path.resolve(__dirname, '..', 'framework');
  if (fs.existsSync(path.join(bundled, 'dist', 'wasm-game-framework.js'))) return bundled;
  fail('Cannot find wasm-game-framework. Set WASM_GAME_FRAMEWORK_ROOT or run from the framework repository.');
}

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function frameworkLock(frameworkRoot) {
  const pkg = JSON.parse(fs.readFileSync(path.join(frameworkRoot, 'package.json'), 'utf8'));
  return {
    package: pkg.name,
    version: pkg.version,
    javascriptSha256: sha256(path.join(frameworkRoot, 'dist', 'wasm-game-framework.js')),
    stylesheetSha256: sha256(path.join(frameworkRoot, 'dist', 'wasm-game-framework.css')),
    bootstrapSha256: sha256(path.join(frameworkRoot, 'dist', 'wasm-game-bootstrap.js')),
    documentSha256: sha256(path.join(frameworkRoot, 'dist', 'index.html'))
  };
}

function parseOptions(input) {
  const raw = input || {};
  const directory = path.resolve(raw.directory || process.cwd());
  const id = sanitizeId(raw.name || path.basename(directory));
  const title = String(raw.title || id.replace(/-/g, ' ').replace(/\b\w/g, part => part.toUpperCase()));
  const displayMode = String(raw.displayMode || '4:3');
  const menuCursor = String(raw.menuCursor || 'browser');
  const controller = String(raw.controller || 'disabled');
  if (!DISPLAY_MODES.has(displayMode)) fail('displayMode must be 4:3, 16:9, or dynamic.');
  if (!MENU_CURSORS.has(menuCursor)) fail('menuCursor must be native, browser, or none.');
  if (!CONTROLLER_MODES.has(controller)) fail('controller must be disabled, wasdMouse, or custom.');
  return Object.freeze({
    directory,
    id,
    title,
    shortName: String(raw.shortName || title).slice(0, 30),
    kicker: String(raw.kicker || 'WASM Game'),
    displayMode,
    menuCursor,
    controller,
    persistence: raw.persistence !== false,
    media: raw.media === true,
    server: raw.server === true,
    nativeManaged: raw.nativeManaged === true || displayMode === 'dynamic',
    pointerLock: raw.pointerLock !== false,
    fullscreen: raw.fullscreen !== false,
    force: raw.force === true,
    frameworkRoot: resolveFrameworkRoot(raw.frameworkRoot)
  });
}

function iconSvg(title) {
  const label = String(title || 'WG').slice(0, 2).toUpperCase();
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" role="img" aria-label="${title}">
  <rect width="64" height="64" fill="#100c08"/>
  <rect x="4" y="4" width="56" height="56" fill="none" stroke="#c4a35a" stroke-width="2"/>
  <text x="32" y="40" text-anchor="middle" fill="#f0d48a" font-size="18" font-family="sans-serif">${label}</text>
</svg>
`;
}

function adapterSource(options) {
  const methods = [];
  methods.push(`  async init(context) {
    context.log('adapter init');
  }`);
  methods.push(`  async start(context) {
    context.showLoading();
    context.setLoading('Starting ${options.title}…', '', 10);
    const module = await createNativeModule();
    if (context.persistence) {
      // Restore IDBFS before native main reads configs or saves.
      await context.persistence.attach(module.FS, {
        root: context.persistence.root,
        allowUnsupported: !module.FS?.filesystems?.IDBFS
      });
    }
    context.setLoading('Entering runtime…', '', 80);
    if (typeof module.callMain === 'function') module.callMain([]);
    context.showRuntime('menu');
  }`);
  if (options.pointerLock) {
    methods.push(`  readEngineState() {
    return engineState;
  }`);
    methods.push(`  captureLost() {
    engineState = 'paused';
  }`);
  }
  if (options.nativeManaged) {
    methods.push(`  resize(detail) {
    const width = Math.max(2, detail.requestedWidth);
    const height = Math.max(2, detail.requestedHeight);
    nativeWidth = width;
    nativeHeight = height;
  }`);
  }
  if (options.menuCursor !== 'none' && (options.menuCursor === 'native' || options.pointerSpace)) {
    methods.push(`  pointerMove(detail) {
    if (detail.captured) return;
    pointerX = detail.x;
    pointerY = detail.y;
  }`);
    methods.push(`  pointerButton() {}`);
  }
  if (options.controller !== 'disabled') {
    methods.push(`  controllerFrame(detail) {
    lastController = detail;
  }`);
    methods.push(`  controllerChanged(detail) {
    if (!detail.connected || detail.selection === 'disabled') lastController = null;
  }`);
  }

  return `/* global WasmGameAdapter */
'use strict';

let engineState = 'menu';
let nativeWidth = 640;
let nativeHeight = 480;
let pointerX = 320;
let pointerY = 240;
let lastController = null;

function createNativeModule() {
  // Replace this with the compiled Emscripten factory (noInitialRun: true).
  return Promise.resolve({
    FS: {},
    callMain() {
      engineState = 'menu';
    }
  });
}

globalThis.WasmGameAdapter = Object.freeze({
${methods.join(',\n\n')}
});
`;
}

function manifestJson(options) {
  const controller = { mode: options.controller };
  if (options.controller === 'wasdMouse') {
    controller.label = 'WASD + mouse mapping';
    controller.moveDeadzone = 0.18;
    controller.lookDeadzone = 0.14;
  } else if (options.controller === 'custom') {
    controller.label = 'Game-specific mapping';
  }

  const manifest = {
    id: options.id,
    title: options.title,
    kicker: options.kicker,
    description: `Play ${options.title} in the browser.`,
    icon: '/icon.svg',
    background: '/icon.svg',
    adapter: '/game-adapter.js',
    displayMode: options.displayMode,
    menuCursor: options.menuCursor,
    nativeManaged: options.nativeManaged,
    syncBackbuffer: !options.nativeManaged,
    pointerLock: options.pointerLock,
    fullscreen: options.fullscreen,
    identity: false,
    graphics: false,
    controller,
    persistence: options.persistence
      ? {
        root: '/save/{variant}',
        debounceMs: 750,
        intervalMs: 5000,
        requestDurability: true
      }
      : false,
    pwa: {
      name: options.title,
      shortName: options.shortName,
      description: `${options.title} browser runtime.`,
      themeColor: '#c4a35a',
      backgroundColor: '#100c08',
      icons: [
        { src: '/icon.svg', sizes: 'any', type: 'image/svg+xml' }
      ]
    }
  };

  if (options.menuCursor === 'native') {
    manifest.pointerWidth = 640;
    manifest.pointerHeight = 480;
    manifest.pointerFit = 'contain';
  }

  return `${JSON.stringify(manifest, null, 2)}\n`;
}

function dataManifest(options) {
  const manifest = {
    namespace: options.id,
    version: 'content-v1',
    files: [
      {
        key: 'game',
        name: 'game.dat',
        path: 'game.dat',
        maxSize: 67108864,
        required: false
      }
    ]
  };
  if (options.media) {
    manifest.mediaLibrary = {
      minimumEntries: 1,
      launcherVisibleWhenReady: true,
      maxFilesPerEntry: 64,
      maxFileBytes: 67108864,
      maxEntryBytes: 67108864,
      maxBrowserCacheBytes: 67108864,
      validator: {
        module: '/data-validator.mjs',
        export: 'validateMediaBundle',
        version: `${options.id}-media-v1`,
        maxReadBytes: 65536,
        maxTotalReadBytes: 262144,
        policy: { kind: 'scaffold' }
      }
    };
  }
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

function validatorSource() {
  return `export async function validateMediaBundle({ files, policy, file }) {
  if (!Array.isArray(files) || files.length === 0) {
    return { accepted: false, error: 'media bundle is empty' };
  }
  const primary = files[0].name;
  if (!file(primary)) return { accepted: false, error: \`missing primary file \${primary}\` };
  return {
    accepted: true,
    label: primary,
    primary,
    identity: policy?.kind || 'scaffold-media',
    version: '1',
    metadata: { files: files.length }
  };
}

export default validateMediaBundle;
`;
}

function serverSource(options) {
  return `'use strict';

const { IdleServiceSupervisor, environmentOptions } =
  require('@wasm-game-framework/browser/server/lifecycle');

const lifecycle = new IdleServiceSupervisor({
  ...environmentOptions(process.env),
  maps: ['map01'],
  async start({ map }) {
    return { map, pid: process.pid };
  },
  async waitUntilReady(handle) {
    return handle;
  },
  async stop() {
    return undefined;
  }
});

module.exports = { lifecycle, title: ${JSON.stringify(options.title)} };
`;
}

function packageJson(options, lock) {
  return `${JSON.stringify({
    name: `${options.id}-wasm`,
    private: true,
    version: '0.1.0',
    description: `${options.title} browser game`,
    scripts: {
      test: 'node test/package-contract.test.js',
      start: 'node scripts/start.js',
      'sync-framework': 'node scripts/sync-framework.js',
      'build:image': 'bash scripts/build-image.sh'
    },
    wasmGameFramework: {
      package: lock.package,
      version: lock.version
    }
  }, null, 2)}\n`;
}

function contractTest() {
  return `'use strict';

const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const checker = path.join(root, 'vendor', 'wasm-game-framework', 'scripts', 'check-game-package.js');
const site = path.join(root, 'web');
const result = spawnSync(process.execPath, [checker, site], { encoding: 'utf8' });
if (result.status !== 0) {
  process.stderr.write(result.stderr || result.stdout || 'package contract failed\\n');
  process.exit(result.status || 1);
}
process.stdout.write(result.stdout);
`;
}

function startScript() {
  return `#!/usr/bin/env node
'use strict';

const path = require('node:path');
const { spawn } = require('node:child_process');

const root = path.resolve(__dirname, '..');
process.env.WASM_GAME_SITE_ROOT = path.join(root, 'web');
process.env.WASM_GAME_SHELL_ROOT = path.join(root, 'vendor', 'wasm-game-framework', 'dist');
process.env.WASM_GAME_DATA_ROOT = process.env.WASM_GAME_DATA_ROOT || path.join(root, '.data');
process.env.WASM_GAME_HTTP_PORT = process.env.WASM_GAME_HTTP_PORT || '8088';
const child = spawn(process.execPath, [
  path.join(root, 'vendor', 'wasm-game-framework', 'server', 'static-server.js')
], { stdio: 'inherit' });
child.on('exit', code => process.exit(code || 0));
`;
}

function syncFrameworkScript() {
  return `#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const vendor = path.join(root, 'vendor', 'wasm-game-framework');
const lock = JSON.parse(fs.readFileSync(path.join(root, 'framework-lock.json'), 'utf8'));
process.stdout.write(\`framework pin \${lock.package}@\${lock.version}\\n\`);
if (!fs.existsSync(path.join(vendor, 'dist', 'wasm-game-framework.js'))) {
  process.stderr.write('vendor/wasm-game-framework is missing. Re-run create-wasm-game or copy the framework package.\\n');
  process.exit(1);
}
`;
}

function buildImageScript(options, lock) {
  return `#!/usr/bin/env bash
set -euo pipefail
root="$(cd "$(dirname "\${BASH_SOURCE[0]}")/.." && pwd)"
image="\${1:-${options.id}-wasm:dev}"
framework_root="\${WASM_GAME_FRAMEWORK_ROOT:-}"
if [[ -n "\${framework_root}" && -x "\${framework_root}/scripts/build-static-image.sh" ]]; then
  "\${framework_root}/scripts/build-static-image.sh" "\${root}/web" "\${image}"
  exit 0
fi
echo "Building \${image} from Dockerfile (expects wasm-game-framework:${lock.version} or WASM_GAME_FRAMEWORK_IMAGE)"
docker build --build-arg "FRAMEWORK_IMAGE=\${WASM_GAME_FRAMEWORK_IMAGE:-wasm-game-framework:${lock.version}}" --tag "\${image}" "\${root}"
`;
}

function dockerfile(lock) {
  return `ARG FRAMEWORK_IMAGE=wasm-game-framework:${lock.version}
FROM \${FRAMEWORK_IMAGE}
ARG GAME_VARIANT=suite
COPY web/ /opt/game-site/
ENV WASM_GAME_VARIANT=\${GAME_VARIANT}
`;
}

function readme(options, lock) {
  return `# ${options.title}

Scaffolded with \`create-wasm-game\` against **${lock.package}@${lock.version}**.

This directory is a game site, not a web application. The framework owns
\`index.html\`, launcher CSS, the service worker, and the web manifest.

## Files you own

- \`web/wasm-game.json\` — browser policy
- \`web/game-adapter.js\` — native seam
- \`web/wasm-game-data.json\` — validated data / media policy
- \`Dockerfile\` and \`scripts/build-image.sh\` — image build
- \`test/package-contract.test.js\` — package checker
- \`RUNBOOK.md\` — AI implementation contract (this tree + framework docs)

## Commands

\`\`\`bash
npm test
npm start
WASM_GAME_FRAMEWORK_ROOT=/path/to/wasm-game-framework npm run build:image
\`\`\`

Replace \`createNativeModule()\` in \`web/game-adapter.js\` with the compiled
engine factory. Keep \`persistence.attach()\` before native main.

Created with:

\`\`\`bash
npx create-wasm-game ${options.id} --display-mode ${options.displayMode} --menu-cursor ${options.menuCursor} --controller ${options.controller}
\`\`\`
`;
}

function gitignore() {
  return `node_modules/
.data/
npm-debug.log*
`;
}

function docsUrl(page) {
  return `https://theodorecharles.github.io/wasm-game-framework/${page}`;
}

function aiRunbook(options, lock) {
  const persistenceLine = options.persistence
    ? '`attach()` the IDBFS root `/save/{variant}` **before** native main reads configs or saves.'
    : '`persistence` is `false`. Do not invent a save mount unless the engine actually writes state.';
  const resizeLine = options.nativeManaged
    ? '`resize(detail)` must change the real backbuffer, viewport, and projection in the same frame. Use `detail.cssWidth`/`cssHeight` when the CSS box is the intended size.'
    : 'Fixed display: keep `syncBackbuffer` true unless you later switch to `dynamic`.';
  const pointerLine = options.menuCursor === 'native'
    ? 'Forward `detail.x`/`detail.y` into the 640×480 native menu. Do not add CSS, DPR, or letterbox offsets.'
    : options.menuCursor === 'none'
      ? 'Menus are pointer-free. Do not start handling pointer callbacks without changing `menuCursor`.'
      : 'Host cursor stays visible on menus. Branch on `detail.captured` for relative look vs absolute menu.';
  const captureLine = options.pointerLock
    ? 'The framework is the only caller of `requestPointerLock()`. Report capture intent on the trusted JOIN/New Game click; `readEngineState()` must come from native truth.'
    : 'Pointer lock is off. Do not request it from the adapter.';
  const controllerLine = options.controller === 'disabled'
    ? 'Controller polling is off. Do not add Gamepad code until you change `controller.mode`.'
    : options.controller === 'wasdMouse'
      ? 'Map `controllerFrame(detail).actions` into the same native queue as keyboard/mouse. Never dispatch synthetic DOM events.'
      : 'Map raw `detail.gamepad` yourself. Release all held native actions on disconnect.';
  const mediaLine = options.media
    ? `Media library is declared. Load only the selected entry with \`context.dataClient.media.load()\`. Keep format knowledge in \`web/data-validator.mjs\`.`
    : 'Fixed files live in `web/wasm-game-data.json`. Put format checks in a downstream `.mjs` validator, not the framework.';
  const serverLine = options.server
    ? `A dedicated-server stub is in \`server/lifecycle.js\`. Follow ${docsUrl('server-runbook.html')} and ${docsUrl('lifecycle.html')} before exposing \`/wake\` or \`/ws\`.`
    : 'No dedicated-server stub. Add `--server` and read the server runbook before inventing wake/idle or a WebSocket proxy.';

  return `# ${options.title} — AI implementation runbook

This file is the working contract for an agent implementing **${options.title}**
on WASM Game Framework **${lock.package}@${lock.version}**.

Read the canonical docs before editing. Do not invent a second website.

## Canonical docs

Read these first, in order:

1. ${docsUrl('llms.txt')} — machine-readable contract index
2. ${docsUrl('build-a-game.html')} — working sequence
3. \`vendor/wasm-game-framework/ADAPTER_RUNBOOK.md\`
   (same text as ${docsUrl('adapter-runbook.html')})
4. ${docsUrl('adapter.html')}, ${docsUrl('display.html')}, ${docsUrl('input.html')},
   ${docsUrl('persistence.html')}, ${docsUrl('game-data.html')}

Full dump: ${docsUrl('llms-full.txt')}

## This project's declared policy

These values are already written into \`web/wasm-game.json\`. Change the
manifest if the engine requires different policy. Do not leave them implicit.

| Field | Value |
| --- | --- |
| id | \`${options.id}\` |
| title | ${options.title} |
| displayMode | \`${options.displayMode}\` |
| menuCursor | \`${options.menuCursor}\` |
| nativeManaged | \`${options.nativeManaged}\` |
| syncBackbuffer | \`${!options.nativeManaged}\` |
| pointerLock | \`${options.pointerLock}\` |
| fullscreen | \`${options.fullscreen}\` |
| controller.mode | \`${options.controller}\` |
| persistence | ${options.persistence ? '`/save/{variant}`' : '`false`'} |
| media library | \`${options.media}\` |
| dedicated server stub | \`${options.server}\` |
| framework pin | \`${lock.package}@${lock.version}\` |

## What the scaffold already did

- Canonical document, launcher, CSS, PWA, and service worker stay in the
  framework. This tree must not grow a downstream \`index.html\`, CSS file,
  service worker, or web manifest.
- \`web/game-adapter.js\` is a stub. \`start()\` already attaches persistence
  (when enabled) before \`callMain\`.
- \`npm test\` runs \`vendor/wasm-game-framework/scripts/check-game-package.js\`
  against \`web/\`.
- \`npm start\` serves this site with the pinned framework document.

## What you implement

Work in this order. Do not skip to a canvas screenshot and call it done.

1. **Native source.** Start from official or maintained **native** source. Design
   the Emscripten target, cooperative loop, filesystem mounts, and adapter here.
   Do not copy another project's generated JS/WASM or its web port.
2. **Compile.** Produce the engine factory with \`noInitialRun: true\`. Replace
   \`createNativeModule()\` in \`web/game-adapter.js\`. Keep
   \`context.persistence.attach(module.FS, { root: context.persistence.root })\`
   before any native config or save lookup.
3. **Data.** Fill \`web/wasm-game-data.json\` with the real allowlisted files
   (or finish the media-library validator). Game archives stay on \`/data\`,
   never in Git. ${mediaLine}
4. **State.** ${captureLine} Valid states: \`launcher\`, \`loading\`, \`menu\`,
   \`gameplay\`, \`paused\`, \`debrief\`, \`crashed\`. Gameplay only after a
   real controllable snapshot or world.
5. **Display.** ${resizeLine}
6. **Pointer.** ${pointerLine}
7. **Identity and quality.** Sanitize the player name. Re-apply it after
   native configs load. Profiles must change real renderer settings.
8. **Controller.** ${controllerLine}
9. **Persistence.** ${persistenceLine} Hard-refresh must restore a changed
   keybinding or save the engine actually read.
10. **Dedicated server.** ${serverLine}
11. **Image.** \`WASM_GAME_FRAMEWORK_ROOT=… npm run build:image\`. Data is a
    \`/data\` volume. Do not bake PAKs/WADs/ISOs into the image.

## Forbidden

- Downstream \`index.html\`, \`*.css\`, service worker, or \`*.webmanifest\`
- Inferring \`gameplay\` from a timeout, canvas visibility, or the last click
- Calling \`requestPointerLock()\` / \`exitPointerLock()\` from the adapter
- Dispatching synthetic DOM keyboard/mouse events for the gamepad
- Tracking game data or generated WASM in Git
- Marking unreached behavior as passed because a hook looks plausible

## Commands

\`\`\`bash
npm test
npm start
# http://127.0.0.1:8088/
WASM_GAME_FRAMEWORK_ROOT=/path/to/wasm-game-framework npm run build:image
\`\`\`

## Acceptance

Follow section 11 of the adapter runbook. At minimum record evidence for:

1. missing-data setup vs ready launcher
2. second load from the browser cache
3. honest menu → loading → first controllable frame
4. declared cursor policy, including after resize
5. capture / Escape release / Resume (if pointer lock is on)
6. a real save or config surviving hard refresh (if persistence is on)
7. \`npm test\` still passing
8. no forbidden downstream web files

Compiling, linking, or reaching a menu is not a finished adapter.

Created by \`create-wasm-game\` for \`${options.id}\`.
`;
}

function vendorCopies(frameworkRoot) {
  const copies = [];
  function walk(relative) {
    const from = path.join(frameworkRoot, relative);
    if (!fs.existsSync(from)) return;
    const stat = fs.statSync(from);
    if (stat.isDirectory()) {
      for (const entry of fs.readdirSync(from)) walk(path.join(relative, entry));
      return;
    }
    copies.push({
      from,
      to: path.join('vendor', 'wasm-game-framework', relative)
    });
  }
  walk('package.json');
  walk('ADAPTER_RUNBOOK.md');
  walk('SERVER_RUNBOOK.md');
  walk('dist');
  walk('server');
  walk(path.join('scripts', 'check-game-package.js'));
  return copies;
}

function generateProject(input) {
  const options = parseOptions(input);
  const lock = frameworkLock(options.frameworkRoot);
  const adapterOptions = {
    ...options,
    pointerSpace: options.menuCursor === 'native'
  };

  const files = {
    'package.json': packageJson(options, lock),
    'framework-lock.json': `${JSON.stringify(lock, null, 2)}\n`,
    'README.md': readme(options, lock),
    'RUNBOOK.md': aiRunbook(options, lock),
    '.gitignore': gitignore(),
    'Dockerfile': dockerfile(lock),
    'web/wasm-game.json': manifestJson(options),
    'web/wasm-game-data.json': dataManifest(options),
    'web/game-adapter.js': adapterSource(adapterOptions),
    'web/icon.svg': iconSvg(options.title),
    'test/package-contract.test.js': contractTest(),
    'scripts/start.js': startScript(),
    'scripts/sync-framework.js': syncFrameworkScript(),
    'scripts/build-image.sh': buildImageScript(options, lock)
  };

  if (options.media) files['web/data-validator.mjs'] = validatorSource();
  if (options.server) files['server/lifecycle.js'] = serverSource(options);

  for (const forbidden of FORBIDDEN_SITE_FILES) {
    if (Object.prototype.hasOwnProperty.call(files, forbidden)) {
      fail(`Refusing to emit downstream file ${forbidden}`);
    }
  }

  return Object.freeze({
    options,
    lock,
    files: Object.freeze(files),
    copies: Object.freeze(vendorCopies(options.frameworkRoot))
  });
}

function writeProject(project) {
  const root = project.options.directory;
  if (fs.existsSync(root)) {
    const entries = fs.readdirSync(root).filter(name => name !== '.' && name !== '..');
    if (entries.length && !project.options.force && !fs.existsSync(path.join(root, 'framework-lock.json'))) {
      fail(`Directory is not empty: ${root} (pass --force to overwrite a scaffold)`);
    }
  }
  fs.mkdirSync(root, { recursive: true });
  for (const [relative, content] of Object.entries(project.files)) {
    const dest = path.join(root, relative);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, content);
    if (relative.endsWith('.sh') || relative.startsWith('scripts/')) {
      fs.chmodSync(dest, 0o755);
    }
  }
  for (const copy of project.copies) {
    const dest = path.join(root, copy.to);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(copy.from, dest);
  }
  return root;
}

module.exports = {
  DISPLAY_MODES,
  MENU_CURSORS,
  CONTROLLER_MODES,
  FORBIDDEN_SITE_FILES,
  parseOptions,
  generateProject,
  writeProject,
  resolveFrameworkRoot
};
