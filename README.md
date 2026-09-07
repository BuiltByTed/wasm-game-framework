# WASM Game Framework

This repository is the single launcher, loading-surface, controls, controller,
save/config persistence, viewport, game-data, PWA, and container-lifecycle contract used by a portfolio of native
game engines compiled to WebAssembly. It follows the proven WolfET browser
shell so each engine supplies policy rather than maintaining a different web
application.

Current release: **0.9.6**

Documentation: [builtbyted.github.io/wasm-game-framework](https://builtbyted.github.io/wasm-game-framework/)

Version 0.9.6 restores large browser media libraries with bounded parallel
HTTP and IndexedDB work instead of serializing thousands of files. Version
0.9.5 added bounded, downstream-owned media transformation so a launch card can
ingest installer/archive sets and atomically publish only their validated
output. Version 0.9.4 added stable direct-media launch links and
deployment locks. A suite may open `/?game=ps1&media=<32-hex-entry-id>`, while
`WASM_GAME_MEDIA=<id>` locks an image to one installed entry. An unavailable
explicit selection fails closed instead of silently launching the first entry.

Live example: [Wolfenstein: Enemy Territory](https://wolfet.tedcharles.net/)
uses the framework's launcher, persistent game-data provisioning, browser
cache, responsive canvas, input-capture lifecycle, graphics profiles,
fullscreen launch, and idle dedicated-server wakeup.

## Quick start

Start a new game with the published scaffold:

```bash
npx create-wasm-game my-game
cd my-game
npm test
npm start
```

`npm create wasm-game@latest my-game` is the same command. The scaffold writes
`web/wasm-game.json`, `web/game-adapter.js`, data policy, an exact
`@wasm-game-framework/browser@0.9.6` pin, Docker build files, a package
contract test, and `RUNBOOK.md` for the implementation agent. It does not
write `index.html`, launcher CSS, a service worker, or a web manifest.
Defaults are explicit `displayMode: "4:3"`, `menuCursor: "browser"`,
`controller.mode: "disabled"`, persistence attached before native main, and
neutral ready-state copy.

Useful flags: `--display-mode`, `--menu-cursor`, `--controller`, `--media`,
`--server`. See [Getting started](https://builtbyted.github.io/wasm-game-framework/getting-started.html).

The framework repository itself is self-contained and does not include a game
engine, compiled game WASM, or game data. To work on the framework:

```bash
git clone https://github.com/BuiltByTed/wasm-game-framework.git
cd wasm-game-framework
npm test
./scripts/build-base-image.sh wasm-game-framework:0.9.6
```

To integrate an existing compiled game site, point the installer and image
builder at that game's web directory:

```bash
game_site=/absolute/path/to/my-game-wasm/web
./scripts/install-browser-package.sh "$game_site/shared-shell" copy
./scripts/build-static-image.sh "$game_site" my-game-wasm:dev
```

A framework-served downstream directory contains `wasm-game.json`,
`wasm-game-data.json`, `game-adapter.js`, its compiled engine artifacts, and
public title assets. The framework supplies the document, launcher, styling,
data boundary, and browser lifecycle; it does not supply the native port.

Mount a persistent `/data` volume when running that image. On first use, the
administrator uploads the exact files allowed by
`wasm-game-data.json`; subsequent visitors see the normal launcher, and each
browser keeps a validated private IndexedDB cache for fast reloads.

Version 0.9 adds a generic private media library alongside the original fixed-
file contract. A deployment may accept zero or more named entries, where an
entry is one file or an atomic multi-file bundle. The framework handles bounded
upload sessions, atomic installation, safe metadata lists, selection, and a
selected-entry-only browser cache. A downstream pure `.mjs` validator owns all
format knowledge and executes unchanged in Node and the browser. Existing
`files`, `status()`, `provision()`, `load()`, and `applyGate()` APIs remain
compatible.

Storage durability is best-effort and bounded. Browsers may reject, omit, or
leave `navigator.storage.persist()` pending while waiting on permission UI;
none of those outcomes can block media loading or native startup. IndexedDB
caching and IDBFS persistence continue normally even when durable quota is not
granted.

The enforced dependency direction is documented in [ARCHITECTURE.md](ARCHITECTURE.md):
framework behavior flows into an engine-family adapter, then into a small game
adapter. Framework releases are linked during local development and copied
with a version/SHA manifest for reproducible offline images.

Use [ADAPTER_RUNBOOK.md](ADAPTER_RUNBOOK.md) when adding or auditing a game.
It defines the exact state, capture, resize, pointer, identity, profile,
persistence, audio, Docker, and real-browser acceptance requirements.
Use [SERVER_RUNBOOK.md](SERVER_RUNBOOK.md) for games with a dedicated server.
It defines Play-triggered wake, readiness, population tracking, bot fill,
idle shutdown, transport routing, recovery, and container acceptance.

The browser document itself is framework-owned. A downstream game does not
ship or maintain `index.html`; it ships only `wasm-game.json`,
`game-adapter.js`, compiled engine artifacts, and game-specific public assets.
When `wasm-game.json` exists, the framework server serves its canonical
`dist/index.html` for `/` and client-side routes. The launcher description is
optional and appears only when the manifest supplies `description`; the
framework does not substitute fallback copy.

The canonical document loads the same immutable package files:

```html
<link rel="stylesheet" href="/shared-shell/wasm-game-framework.css">
<script src="/shared-shell/wasm-game-framework.js"></script>
<script src="/shared-shell/wasm-game-bootstrap.js"></script>
```

Then it calls `WasmGameFramework.configure()` with only engine-specific policy:

- a `4:3`, `16:9`, or `dynamic` display contract;
- whether canvas pixels should be crisp;
- whether released runtime menus use a native, browser, or no cursor;
- whether a graphics profile and dynamic-quality controls are meaningful;
- whether multiplayer identity is currently meaningful;
- an optional resize callback for engines that can change their backbuffer.

The declarative boundary looks like this:

```json
{
  "id": "quake2",
  "title": "Quake II",
  "kicker": "id Tech 2",
  "icon": "/quake2.ico",
  "iconPixelated": false,
  "background": "/quake2-background.jpg",
  "backgroundPosition": "center",
  "backgroundSize": "cover",
  "pwa": {
    "shortName": "Quake II",
    "themeColor": "#5f190d",
    "backgroundColor": "#000000",
    "icons": [
      { "src": "/pwa-192.png", "sizes": "192x192", "type": "image/png" },
      { "src": "/pwa-512.png", "sizes": "512x512", "type": "image/png" }
    ]
  },
  "displayMode": "dynamic",
  "nativeManaged": true,
  "menuCursor": "browser",
  "controller": {
    "mode": "wasdMouse",
    "label": "WASD + mouse mapping",
    "moveDeadzone": 0.18,
    "lookDeadzone": 0.14
  },
  "persistence": {
    "root": "/save/{variant}",
    "debounceMs": 750,
    "intervalMs": 5000,
    "requestDurability": true
  },
  "identity": true,
  "graphics": true,
  "profiles": [
    { "value": "original", "label": "Original" },
    { "value": "modern", "label": "Modernized" }
  ],
  "fpsTargets": [30, 60, 120],
  "adapter": "/game-adapter.js"
}
```

`game-adapter.js` registers one object, not markup:

```js
globalThis.WasmGameAdapter = {
  async init(context) {},
  async start(context) {},
  readEngineState(context) { return 'menu'; },
  readCaptureIntent(context) { return false; },
  resize(detail, context) {},
  controllerFrame(detail, context) {},
  controllerChanged(detail, context) {},
  captureLost(detail, context) {}
};
```

A media-library declaration is format-neutral:

```json
{
  "namespace": "console-suite",
  "version": "media-v1",
  "files": [],
  "mediaLibrary": {
    "minimumEntries": 1,
    "launcherVisibleWhenReady": true,
    "maxFilesPerEntry": 64,
    "maxFileBytes": 2147483648,
    "maxEntryBytes": 4294967296,
    "maxBrowserCacheBytes": 2147483648,
    "publicMetadata": ["system", "region"],
    "transformer": {
      "module": "/media-transformer.mjs",
      "export": "transformMediaBundle",
      "version": "example-transform-v1",
      "policy": { "format": "example-installer" }
    },
    "validator": {
      "module": "/data-validator.mjs",
      "export": "validateMediaBundle",
      "version": "console-media-v1",
      "policy": { "system": "example" },
      "maxReadBytes": 1048576,
      "maxTotalReadBytes": 8388608
    }
  }
}
```

`transformer` is optional and server-side. When present, the framework gives
the trusted downstream module private input and output directories plus the
declared file inventory and JSON policy. Returning `{ transformed: true }`
causes the framework to inventory the output without following symbolic links,
enforce the same file-count and byte ceilings, validate the transformed bundle,
and install it atomically. Returning `{ transformed: false }` validates and
installs the original upload. The framework contains no installer or archive
format knowledge; the downstream image supplies any extraction tool it needs.

`launcherVisibleWhenReady` defaults to `true`, which keeps a ROM or disc
library selectable after startup. Set it to `false` for a single-install media
flow: the selector and Add-media controls remain available while provisioning
is incomplete, then disappear once the required entry is ready.

The shared browser client exposes `dataClient.media.status()`,
`selected(library)`, `selection(library)`, `select(id, library)`,
`upload(files, options)`, `detail(id)`, and `load(id?, options)`. `load()`
downloads and validates only the selected entry,
returns its relative mount names and primary file, and clears the prior
selection's versioned cache. If an entry exceeds `maxBrowserCacheBytes`, it
fails with `MEDIA_RANDOM_ACCESS_REQUIRED`; a downstream streaming/random-access
adapter is required rather than silently materializing an unsafe amount of
memory.

Installed entries have stable 32-character hexadecimal IDs. In a suite, use
`/?game=ps1&media=<id>` to preselect one entry without replacing the normal
console and game selectors. The user may choose a different entry; the
launcher stores the change and updates `media` in the current URL. If an
explicit ID is malformed or not installed, Play stays disabled and the
launcher explains that the requested media is unavailable. It never falls back
to another entry.

Set `WASM_GAME_MEDIA=<id>` to hard-lock a deployment to one entry. The server
publishes the value through `/wasm-game-config.js`, the launcher hides only the
media selector, and Add-media controls remain available when that entry still
needs to be installed. A hard lock takes precedence over `?media=` and cannot
be bypassed by an adapter calling `load()` with another ID.

The adapter owns native engine seams and validation policy. The framework owns
all launcher, provisioning, loading, preference, canvas, mobile notice, and
capture markup and behavior.

`icon` is also installed as the tab favicon. Suite variants override it so the
launcher and browser tab use the same configured title icon;
`iconPixelated` is available for intentionally low-resolution originals.

The same manifest supplies installable-app metadata under `pwa`. The framework
serves a variant-aware `/app.webmanifest`, registers its own service worker,
and opens installed games in standalone landscape mode. Supply 192x192 and
512x512 PNGs, or a scalable SVG with `sizes: "any"`, so Chrome can
offer **Install app** with the correct game artwork. The service worker uses a
network-first fallback only for the small framework shell. It deliberately
does not duplicate engine artifacts or game data; validated
files remain in the framework's versioned IndexedDB cache.

The display mode is title/profile policy, not necessarily a user-facing
control. `4:3` and `16:9` always contain the canvas with black bars and never
distort it. `dynamic` fills the live viewport. A native-managed dynamic engine
receives the requested dimensions and the shell keeps showing its last valid
backbuffer aspect until the engine confirms the new one, preventing resize
stretching.

Engines that can resize promptly may set `resizeTransition: "immediate"`.
That fills the new viewport in the same animation frame while the native
backbuffer is being updated, avoiding a visible black interval during resize.

Examples: Wolf3D and original/smooth Doom use `4:3`; modernized Doom, WolfET,
Quake III, and modernized Quake use `dynamic`. An adapter changes the active
profile with `shell.setDisplayMode()`.

## Launcher and runtime state

The framework owns the browser-facing state machine:

```text
provisioning -> launcher -> loading -> menu -> gameplay -> paused/debrief
                                                    \-> crashed
```

Engine adapters report their native state through `readEngineState()`. The
framework focuses the canvas and captures in `gameplay`; entering a menu,
pause, debrief, launcher, or crash state releases it. An asynchronous JOIN,
New Game, or Resume action reports a separate synchronous
`readCaptureIntent()`. The framework snapshots that bit at pointerdown and
tracks the matching pointer ID/button through pointerup. A false-to-true edge
during that exact gesture may reserve pointer lock even when queued SDL/native
work leaves `readEngineState()` at `menu` or `paused` until the next frame.
This exception is event-scoped: intent already true before pointerdown is
stale, mismatched/cancelled gestures cannot consume it, and persistent capture
still requires honest `loading` or `gameplay` state. The adapter must expose
intent from native menu dispatch or from a predeclared capture target for that
exact button; a generic menu click never implies capture. A next-animation-
frame check remains for engines whose native state becomes visible late, but
it is a compatibility fallback and cannot replace the first trusted request in
browsers that require transient activation.
Browser defaults for gameplay keys are suppressed only while input is actually
captured, so Ctrl+Shift+R, copy/paste, and normal page controls continue to
work outside play. A lost gameplay capture invokes the adapter's
`captureLost()` hook so the game can open its native pause menu exactly once.

Native menus declare `pointerWidth` and `pointerHeight` in `wasm-game.json`.
The framework maps client coordinates through the canvas's actual CSS rectangle
and calls `pointerMove(detail, event, context)` and
`pointerButton(detail, event, context)` in that virtual coordinate space.
Set `menuCursor: "native"` when the runtime draws its own menu pointer; the
framework hides the host pointer while continuing to publish mapped absolute
pointer callbacks. Use `"browser"` to keep the host pointer visible and still
publish those callbacks. Use `"none"` for pointer-free menus: the host pointer
is hidden and released menu/loading/pause/debrief pointer callbacks are
suppressed. Captured gameplay always hides the host pointer and still publishes
relative movement. Omitted `menuCursor` defaults to `"native"` for backward
compatibility.
The same `pointerMove(detail, event, context)` hook has two explicit shapes:
released events carry mapped `x`, `y`, normalization/rectangle fields, and
`captured: false`; captured events carry only `movementX`, `movementY`,
`state`, `canvas`, and `captured: true`. Adapters must branch on
`detail.captured` and never reuse absolute menu coordinates for gameplay look.
Widescreen renderers whose native UI remains centered at a fixed aspect set
`pointerFit: "contain"`; the transform then removes the exact letterbox or
pillarbox offset before converting into native menu coordinates.

`createPreferences()` owns persistent player name, quality profile, dynamic
quality, target-FPS, controller selection, and “Launch fullscreen” controls. Fullscreen is requested
directly from the Play click so browser user-activation rules are satisfied;
set `fullscreen: false` only for a title that cannot support it, or
`defaultFullscreen: true` when fullscreen should start checked. The common selectors are
`data-shell-player-name`, `data-shell-quality-profile`,
`data-shell-dynamic-quality`, and `data-shell-target-fps`. The shell also adds
a compact “best on desktop” notice for small/coarse-pointer devices.

## Controller input

Controller discovery and selection happen on the shared launch card. The
framework uses the browser Gamepad API, recognizes USB and Bluetooth devices,
survives connection changes, remembers a stable device identity instead of a
transient Gamepad index, polls on animation frames, and exposes optional
dual-rumble output. A controller becomes available after the browser reports
it; users normally press any button once after pairing it with the operating
system.

Every game explicitly declares one controller mode:

- `disabled` hides controller controls and performs no polling;
- `wasdMouse` provides common left-stick movement, right-stick look, trigger,
  face-button, shoulder, menu, and scoreboard actions;
- `custom` provides immutable raw axes/buttons so the adapter can implement a
  console pad, steering wheel, flight controls, or another native mapping.

The framework does not dispatch synthetic DOM keyboard or mouse events. A
controller-enabled adapter implements `controllerFrame(detail, context)` and
writes common actions or raw values into its native input queue. Button/axis
to key, mouse axis/button, or emulator-pad mappings live in that adapter.
Optional `controllerChanged()` handles device-specific setup, and
`context.shell.controller.rumble()` exposes supported haptics.

## Saves, configs, and keybindings

Validated game archives and writable player state are separate. Game archives
remain read-only; saves, save RAM, memory cards, configuration files,
keybindings, screenshots, and recorded demos live under a variant-scoped
IDBFS mount backed by IndexedDB.

The manifest explicitly declares `persistence: false` or a writable virtual
root. A persistence-enabled adapter restores that mount before native startup:

```js
async start(context) {
  const module = await createNativeModule({ noInitialRun: true });
  const saves = await context.persistence.attach(module.FS, {
    root: context.persistence.root
  });
  // syncfs(true) has completed here. Native config loading is now safe.
  module.callMain(['+set', 'fs_homepath', saves.root]);
}
```

The framework serializes IDBFS operations, requests durable browser storage,
flushes periodically, debounces explicit `markDirty()` notifications, and
flushes on visibility loss and page exit. Adapters call
`context.persistence.markDirty()` after a native save/config write and may
`await context.persistence.save()` at high-value boundaries such as a manual
save, map completion, or settings confirmation. Browser-local writable state
is namespaced by game variant so suite images cannot mix saves or keybindings.
Use `{variant}` or `{namespace}` in the manifest root. The bootstrap resolves
the template before the adapter sees `context.persistence.root`, and the
package checker rejects two suite variants that resolve to the same IDBFS
mount path.

For a worker-hosted engine, send only `context.persistence.namespace` and
`context.persistence.root` to the worker. The worker imports the same released
`wasm-game-framework.js`, creates its own `createPersistenceManager()` with
those values, attaches the worker-local Module FS, waits for restore, and only
then calls native main. An Emscripten FS object is not structured-cloneable and
must never be passed through `postMessage()`.

Game data is installed separately from this package.

## Container provisioning and browser cache

There are deliberately two durable data layers:

1. The administrator provisions the required files once into the container's
   persistent `/data` volume.
2. Each browser downloads each validated file from that container once and
   retains it in origin-private IndexedDB for fast reloads.

Every game image includes `wasm-game-data.json` with filename and bounded-size
policies. Exact `sizes`, byte `magic`, and `sha256` allowlists remain available
when a title has a closed set of known releases. A downstream validator module
can instead recognize a family of structurally valid releases without teaching
the framework about a game format. While required files are
missing or invalid, `createContainerDataClient().applyGate()` shows only the
elements marked `data-shell-provisioning`. The first-run picker uploads exact
files to `/game-data/setup/<key>`; the framework server validates before an
atomic write to `/data`. Set `WASM_SETUP_TOKEN` to require that token during
provisioning. As soon as `/game-data/status` reports ready, provisioning is
hidden for every visitor and only the regular launcher is shown.

The data server exposes neither `/data` nor `/local-data`. Once the complete
policy is valid, it serves only `/game-data/files/<key>`. Arbitrary names, path
traversal, files outside their size envelope, failed validators, and replacement
of already-valid files are rejected.

## Optional play password

Set `WASM_GAME_PASSWORD` in a Docker deployment to put the canonical launcher
and protected game routes behind one shared password. When it is empty or
unset, the launcher behaves exactly as before. When it is set, the launcher
shows a password field before it loads the adapter or requests game data.

```bash
docker run -e WASM_GAME_PASSWORD='friends-only' -v game-data:/data IMAGE
```

A successful login creates a signed, expiring, HttpOnly, same-site session
cookie. The password is never placed in a manifest, browser script, URL,
status response, or log. `WASM_GAME_PASSWORD_TTL` controls the session lifetime
and defaults to `12h`. Behind a trusted TLS-terminating proxy, set
`WASM_GAME_TRUST_PROXY=true` so the session cookie receives its `Secure` flag.

The canonical static server automatically protects `/game-data/status`, setup,
and file delivery. A downstream server that owns `/wake` or `/ws` must create
the same `createPasswordGate()` instance and require it for both the wake route
and WebSocket upgrade; the exact integration is in
[SERVER_RUNBOOK.md](SERVER_RUNBOOK.md). Protecting only the launcher is not an
accepted server implementation.

Example site manifest:

```json
{
  "namespace": "example-game",
  "version": "content-v1",
  "validator": {
    "module": "/data-validator.mjs",
    "export": "validateGameData",
    "version": "archive-reader-v3",
    "maxReadBytes": 4194304,
    "maxTotalReadBytes": 67108864
  },
  "files": [
    {
      "key": "archive",
      "name": "game.dat",
      "path": "base/game.dat",
      "maxSize": 536870912,
      "validator": {
        "policy": { "requiredSections": ["maps", "textures"] }
      }
    }
  ]
}
```

The root or selected variant may provide validator module defaults; each file
inherits them and may override `policy`, limits, export, or version. Set a
file's `validator` to `false` to opt it out. A validated file must declare
either finite `sizes` or `maxSize`, which is also the upload envelope. Validator
paths are traversal-safe same-origin `.mjs` files inside the game site.

The exact same module is imported by the Node provisioning server and browser
cache validator. It receives no filesystem or framework internals—only bounded
access to the selected file:

```js
export async function validateGameData({ name, size, policy, read, digest }) {
  const header = await read(0, 16); // Uint8Array; range and budgets enforced
  if (!recognized(header, policy)) {
    return { accepted: false, error: 'unrecognized archive header' };
  }
  return {
    accepted: true,
    identity: detectIdentity(header),
    version: detectVersion(header),
    fingerprint: await digest('SHA-256'),
    metadata: { sections: await inspectDirectory(read, size) }
  };
}
```

`read(offset, length)` is constrained to the file, to `maxReadBytes` per call,
and to `maxTotalReadBytes` overall (one file length by default). `digest()`
supports SHA-256, SHA-384, and SHA-512; it streams in Node and uses Web Crypto
in the browser. A digest is a separate, at-most-one-pass operation cached per
algorithm; it does not consume the random-read budget. The declared file-size
envelope bounds that pass. A validator decides whether a digest gates
acceptance. Results must be bounded JSON data and use `{ accepted: true, ... }` or
`{ accepted: false, error }`. Successful identity/version/fingerprint metadata,
the validator module/version/policy, and rejection reason appear in setup
status. Uploads are validated at a private temporary path and atomically renamed
only after acceptance.

Suite images may put independent policies under a top-level `variants` map.
The launcher passes its selected deployment key to
`createContainerDataClient({ variant })`, and every status, setup, and file
request is scoped to that exact variant. A unified Doom image can therefore
launch after provisioning Doom II alone; it does not demand every IWAD. A
single-title image uses its locked `WASM_GAME_VARIANT` when the query is
omitted.

```json
{
  "namespace": "doom-suite",
  "version": "iwads-v1",
  "variants": {
    "doom":  { "files": [{ "key": "iwad", "name": "doom.wad",  "path": "doom/doom.wad",  "maxSize": 268435456 }] },
    "doom2": { "files": [{ "key": "iwad", "name": "doom2.wad", "path": "doom2/doom2.wad", "maxSize": 268435456 }] }
  }
}
```

Files marked `"required": false` do not block readiness. A missing optional
file is skipped during browser-cache restore, and an administrator may add it
later through the same exact allowlisted setup endpoint. Calling
`provision(source, { includeOptional: true })` explicitly requests that later
optional-data pass.

`WasmGameFramework.createDataCache()` stores already validated game files as
Blobs in a per-game IndexedDB database. `getOrLoad()` checks that private cache
first, deduplicates simultaneous requests, and calls the container download
loader only on a true miss. A cache-version bump invalidates prior records
without redownloading unchanged code assets. `persist()` requests durable
browser storage during the Play gesture and reports quota estimates.

```js
const data = WasmGameFramework.createOwnerDataSet({
  namespace: 'doom-suite',
  version: 'iwad-content-v1',
  validator: {
    module: '/data-validator.mjs',
    export: 'validateIwad',
    version: 'iwad-reader-v2'
  },
  files: [{
    key: 'doom2', name: 'doom2.wad', maxSize: 268435456,
    validator: { policy: { game: 'doom2' } }
  }]
});
const restored = await context.dataClient.load(data);
// restored.entries[0].cached is true after the first successful load.
```

Validation policy remains downstream-owned. The game-data cache automatically
includes each validator's module path, explicit validator version, limits, and
policy in its revalidation key. Bump the validator `version` whenever its module
semantics change; change the content-set `version` for non-validator policy
changes. IndexedDB is origin-private; provisioning uploads only to the user's
own same-origin container.

For very large archives whose full digest was already verified during initial
ingestion, a file policy may set `validateCached: false`. Cache restores still
check the exact cache-policy version, filename, size, and signature but skip
the downstream validator and custom callback. Validator version/policy changes
still invalidate that record automatically.

For a multi-file game, `createOwnerDataSet()` applies the engine/game policy,
restores every valid file cache-first, requests only missing files, and asks
for durable storage. `mountOwnerFiles()` then presents the results read-only
through WORKERFS when available or copies them to MEMFS in bounded chunks.
This is the standard game-data path for every downstream engine.
Legacy Emscripten filesystems are supported through their `createPath` API,
and a same-size file already restored by the engine's persistent filesystem is
reused instead of being destructively reopened. Set `reuseExisting: false`
only when an adapter deliberately needs to replace an existing mount path.
Build-engine games and other layouts with meaningful subdirectories can pass
`preservePaths: true`; the framework then creates traversal-safe relative
directories in MEMFS and retains policy `mountName` paths such as
`movie/LOGO.SMK` instead of flattening them.

The matching server package exports `IdleServiceSupervisor`. It deduplicates
simultaneous wake requests, chooses a random rotation map, tracks fully joined
human population, honors `KEEP_ALIVE`, and stops an idle dedicated server after
`IDLE_TIMEOUT`. Browser launchers call `createWakeClient()` from their Play
gesture so loading feedback starts immediately while the native server wakes.
The complete integration and acceptance contract is in
[SERVER_RUNBOOK.md](SERVER_RUNBOOK.md).

## Suite and single-title images

`WasmGameFramework.resolveDeployment()` is the common deployment contract for a
shared engine family. A suite image leaves its title selector visible. A
single-title image injects `WASM_GAME_VARIANT` before the launcher loads; the
same launcher then selects and locks that title and hides only the selector.
URL query selection remains available in suite builds for portal shortcuts.
Media-library suites use `?media=<id>` beside `?game=<variant>` for an optional
direct-game shortcut. A deployment may instead set `WASM_GAME_MEDIA=<id>` to
lock the media entry while retaining the same launcher and adapter.

```html
<script src="/wasm-game-config.js"></script>
<script src="/shared-shell/wasm-game-framework.js"></script>
<script>
  const deployment = WasmGameFramework.resolveDeployment({
    selector: '#game',
    variants: gameDefinitions,
    defaultVariant: 'doom'
  });
</script>
```

The Doom, GoldSource, and Source families use this once to emit both forms:

- unified suite image: `WASM_GAME_VARIANT=suite`;
- individually branded image: `WASM_GAME_VARIANT=doom2`, `opfor`, `hl2`, etc.

This is a presentation/deployment lock. Every variant still validates its
required data independently.

The generic static-image builder first creates the exact versioned
`wasm-game-framework:<version>` base image, then layers only a game site and
variant lock on it. It never copies game data into an image:

```bash
./scripts/build-static-image.sh ../idtech1-wasm/web idtech1-wasm:dev suite
./scripts/build-static-image.sh ../idtech1-wasm/web idtech1-doom2-wasm:dev doom2
```

Downstream CI may set `WASM_GAME_FRAMEWORK_IMAGE` to a published immutable
framework base. Without that override, every local game-image build rebuilds
the versioned base from the sibling framework checkout so uncommitted framework
work flows into local downstream images too.

At runtime `/data` is a persistent volume. The framework server
is the sole provisioning and download boundary described above.

## Development

Run the complete Node test suite with `npm test`. It covers the canonical
document, launcher and viewport behavior, lifecycle supervision, validated
provisioning, private data delivery, PWA metadata, and service-worker policy.
Docker smoke tests should additionally verify that `/data` is never publicly
served and that the image reports the exact framework package version.

Never submit framework or downstream engine changes to any upstream project.

## Projects and release status

Projects are listed as **Live** when a public deployment is available and
**Still in development** while work continues toward a release.

The intended public shape is one repository per reusable engine family, not
one repository per executable and not one monorepo for unrelated engines. A
family repository owns shared native/Emscripten adaptations and can emit both
a suite image and independently branded game images. Existing per-game
repositories remain available until the corresponding family repository
reaches feature parity; they will then be archived with a clear “moved to”
link rather than deleted.

| Engine family | Games | Status | Current repositories |
| --- | --- | --- | --- |
| id Tech 1 | Doom, Doom II, TNT, Plutonia, Heretic, Hexen, Chex Quest | **Still in development** | [idtech1-wasm](https://github.com/BuiltByTed/idtech1-wasm) |
| id Tech 2 | Quake, Quake II | **Still in development** | [idtech2-wasm](https://github.com/BuiltByTed/idtech2-wasm) |
| id Tech 3 | Quake III Arena, Return to Castle Wolfenstein | **Still in development** | [idtech3-wasm](https://github.com/BuiltByTed/idtech3-wasm) |
| id Tech 3 | Wolfenstein: Enemy Territory | **Live** | [idtech3-wasm](https://github.com/BuiltByTed/idtech3-wasm), [wolfet-wasm](https://github.com/BuiltByTed/wolfet-wasm), [live deployment](https://wolfet.tedcharles.net/) |
| id Tech 4 | Doom 3, Resurrection of Evil, Quake 4, Prey (2006) | **Still in development** | [idtech4-wasm](https://github.com/BuiltByTed/idtech4-wasm) |
| Build | Blood, Duke Nukem 3D | **Still in development** | [build-wasm](https://github.com/BuiltByTed/build-wasm) |
| GoldSource | Half-Life, Opposing Force, Blue Shift, Counter-Strike | **Still in development** | [goldsource-wasm](https://github.com/BuiltByTed/goldsource-wasm) |
| Source | Half-Life 2 | **Still in development** | [source-wasm](https://github.com/BuiltByTed/source-wasm) |
| IW 2.0 reconstruction | Call of Duty 2 Multiplayer | **Still in development** | [cod2-wasm](https://github.com/BuiltByTed/cod2-wasm) |
| Wolf3D | Wolfenstein 3D, Spear of Destiny | **Still in development** | [wolf3d-wasm](https://github.com/BuiltByTed/wolf3d-wasm) |
| DOSBox | Jill of the Jungle 1–3, Jazz Jackrabbit, Duke Nukem 1–2, Grand Theft Auto DOS Demo, The Need for Speed, SimCity 2000 | **Still in development** | [dosbox-wasm](https://github.com/BuiltByTed/dosbox-wasm) |
| OpenRCT2 | RollerCoaster Tycoon 1+2 | **Still in development** | [openrct2-wasm](https://github.com/BuiltByTed/openrct2-wasm) |
| Console emulation | NES, SNES, PlayStation, PlayStation 2 | **Still in development** | [emulation-wasm](https://github.com/BuiltByTed/emulation-wasm) |
