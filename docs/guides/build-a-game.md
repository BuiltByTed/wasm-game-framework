# Build a game

This is the working sequence used by the engine-family ports. Compiling Wasm
and seeing a canvas is not a finished adapter.

## 1. Scaffold the contract

```bash
npx create-wasm-game quake2 --title "Quake II" --display-mode dynamic --menu-cursor browser
cd quake2
npm test
```

You now have:

```text
web/wasm-game.json      browser policy
web/game-adapter.js     native seam
web/wasm-game-data.json allowlisted files / media
framework-lock.json     exact {{PACKAGE_NAME}}@{{VERSION}} pin
Dockerfile              layered on the versioned framework base
test/package-contract.test.js
RUNBOOK.md              AI implementation contract for this title
```

`RUNBOOK.md` is the prompt to give an implementation agent. It pins this
project's display/cursor/controller/persistence policy and points at
[llms.txt](llms.txt) plus the [adapter runbook](adapter-runbook.html).

Edit the manifest. Do not add an `index.html`.

## 2. Declare the browser policy

Every merged variant needs an explicit display mode, cursor policy,
controller mode, persistence policy, fullscreen flag, icon, and PWA name.
The checker rejects omissions.

Decide these before writing adapter code:

1. **Aspect.** `4:3` or `16:9` if the renderer is fixed. `dynamic` only if
   the native backbuffer really changes.
2. **Cursor.** `native` if the runtime draws a pointer. `browser` if the host
   pointer should stay visible. `none` if menus do not use a pointer.
3. **Controller.** Leave `disabled` unless you will map frames into the
   native input queue. Do not poll “just in case.”
4. **Persistence.** A virtual root such as `/save/{variant}`, or `false`
   only when the runtime has no writable state.

Ready-state copy describes the game, not setup. File instructions go in
`provisioningText`, which is shown only while data is missing.

## 3. Point the adapter at the engine

Replace `createNativeModule()` with the compiled factory. Keep this order:

```js
async start(context) {
  context.showLoading();
  const module = await createModule({ noInitialRun: true });
  const saves = await context.persistence.attach(module.FS, {
    root: context.persistence.root
  });
  // syncfs(true) has finished. Native config loading is now safe.
  module.callMain(['+set', 'fs_homepath', saves.root]);
}
```

If the filesystem lives in a worker, post only `namespace` and `root`. The
worker imports the same released `wasm-game-framework.js` and attaches there.
An Emscripten `FS` object cannot be structured-cloned.

## 4. Report honest state

`readEngineState()` must come from native truth: a cvar, an exported
function, a snapshot. Never infer gameplay from a timeout or from the last
button the browser clicked.

| State | Capture |
| --- | --- |
| `menu`, `paused`, `debrief`, `launcher`, `crashed` | Released |
| `gameplay` | Captured |
| `loading` | Released unless a trusted JOIN/New Game/Resume intent is active |

`captureLost()` opens the native pause menu exactly once. The framework is
the only code that calls `requestPointerLock()`.

## 5. Declare and validate data

Fixed titles list files in `wasm-game-data.json`. Suites use `variants`.
Variable collections use `mediaLibrary` and a downstream `.mjs` validator.
The framework does not know WAD, CUE/BIN, or installer formats.

Load only validated entries:

```js
const restored = await context.dataClient.load(dataSet);
await WasmGameFramework.mountOwnerFiles(module.FS, restored.entries, {
  root: '/game',
  preservePaths: true
});
```

For a media library, `context.dataClient.media.load()` restores the selected
entry with a bounded parallel pool (default 12) and keeps manifest order.

## 6. Prove it

```bash
npm test
node /path/to/wasm-game-framework/scripts/check-game-package.js web
```

Then run the title in Chromium against a production image. The adapter
runbook lists the acceptance pass: setup and ready launchers, cache reload,
cursor corners, resize and fullscreen, JOIN capture, Escape/Resume, audio
categories, a real save surviving hard refresh, and no downstream document.

A hook that looks plausible is not evidence. If the engine cannot reach
gameplay yet, record the native blocker and pass only the items you can
reach.

## 7. Ship an image, not the data

```bash
WASM_GAME_FRAMEWORK_ROOT=/path/to/wasm-game-framework npm run build:image
docker run --rm -p 8088:8088 -v quake2-data:/data quake2-wasm:dev
```

Game archives stay on the volume. The image contains the site and the
pinned framework. Pin the framework version exactly; do not slide the whole
portfolio forward because a newer tag exists.
