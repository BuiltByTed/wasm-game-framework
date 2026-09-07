# create-wasm-game

Create a [WASM Game Framework](https://builtbyted.github.io/wasm-game-framework/) project.

**Documentation:** [builtbyted.github.io/wasm-game-framework](https://builtbyted.github.io/wasm-game-framework/)

The framework is the shared browser shell for native engines compiled to
WebAssembly. It owns the document, launcher, loading surface, canvas, pointer
capture, controller polling, IndexedDB game-data cache, IDBFS save/config
mount, PWA metadata, service worker, optional play password, and dedicated
server wake/idle. A game does not ship a second website. It ships policy and a
native seam.

This package writes that game side of the contract.

```bash
npx create-wasm-game my-game
npm create wasm-game@latest my-game
```

Then:

```bash
cd my-game
# Hand RUNBOOK.md to an implementation agent, or follow it yourself.
npm test
npm start
```

`npm test` runs the framework package checker against `web/`. `npm start`
serves the canonical framework document with this site as the game root.

## What you get

| Path | Role |
| --- | --- |
| `web/wasm-game.json` | Browser policy: display, cursor, controller, persistence, PWA, branding |
| `web/game-adapter.js` | Native seam. `start()` attaches persistence **before** native main |
| `web/wasm-game-data.json` | Allowlisted fixed files and optional media-library policy |
| `web/icon.svg` | Launcher / PWA icon |
| `framework-lock.json` | Exact `@wasm-game-framework/browser` version and file SHA-256s |
| `vendor/wasm-game-framework/` | Pinned framework copy used by `npm test` and `npm start` |
| `Dockerfile`, `scripts/build-image.sh` | Image layered on `wasm-game-framework:<version>` |
| `test/package-contract.test.js` | Runs `check-game-package.js` |
| `RUNBOOK.md` | AI implementation contract: this project's policy, ordered work, acceptance |
| `vendor/wasm-game-framework/ADAPTER_RUNBOOK.md` | Full adapter acceptance runbook |

The generated `web/` directory is a game site, not a web application.

## What this never writes

The framework owns these. Downstream copies go stale and fail the contract:

- `index.html`
- launcher or viewport CSS
- a service worker
- a web app manifest

Do not add them later.

## Defaults

These are explicit in the generated manifest, not implied:

| Field | Default | Why |
| --- | --- | --- |
| `displayMode` | `4:3` | Contain the canvas. Never stretch. Use `dynamic` only when the native backbuffer can change. |
| `menuCursor` | `browser` | A stub has no native pointer. Use `native` when the runtime draws one, `none` when menus are pointer-free. |
| `controller.mode` | `disabled` | No Gamepad polling unless you opt in with `wasdMouse` or `custom`. |
| `persistence` | `/save/{variant}` | The adapter must `attach()` this IDBFS root before native main reads configs or saves. |
| Ready-state copy | Neutral | Describes the game. File/setup instructions belong in `provisioningText` only. |

## Options

```text
npx create-wasm-game <directory> [options]

  --name <id>                 Game id (default: directory name)
  --title <title>             Human title
  --display-mode <mode>       4:3 | 16:9 | dynamic
  --menu-cursor <mode>        native | browser | none
  --controller <mode>         disabled | wasdMouse | custom
  --media                     Media-library seam and .mjs validator
  --server                    Managed dedicated-server lifecycle stub
  --native-managed            Require adapter.resize() (implied by dynamic)
  --no-persistence            persistence: false (only if there is no writable state)
  --no-pointer-lock           Disable gameplay pointer capture
  --no-fullscreen             Hide Launch fullscreen
  --force                     Overwrite an existing scaffold
  --framework-root <path>     Framework checkout used for the pin
```

Example:

```bash
npx create-wasm-game quake2 \
  --title "Quake II" \
  --display-mode dynamic \
  --menu-cursor browser
```

## After the scaffold

1. Replace `createNativeModule()` in `web/game-adapter.js` with the compiled
   Emscripten factory (`noInitialRun: true`).
2. Keep `context.persistence.attach(module.FS, { root: context.persistence.root })`
   before `callMain`.
3. Report honest engine state from native truth (`menu`, `gameplay`, `paused`,
   `debrief`, `crashed`). Do not infer gameplay from a timeout.
4. Fill `wasm-game-data.json` with the real allowlisted files or a media
   library. Put format knowledge in a downstream `.mjs` validator.
5. Build an image. Data stays on a `/data` volume, not in the image.

```bash
WASM_GAME_FRAMEWORK_ROOT=/path/to/wasm-game-framework npm run build:image
docker run --rm -p 8088:8088 -v my-game-data:/data my-game-wasm:dev
```

## Docs

- [Overview](https://builtbyted.github.io/wasm-game-framework/)
- [Getting started](https://builtbyted.github.io/wasm-game-framework/getting-started.html)
- [Build a game](https://builtbyted.github.io/wasm-game-framework/build-a-game.html)
- [How it works](https://builtbyted.github.io/wasm-game-framework/how-it-works.html)
- [Adapter runbook](https://builtbyted.github.io/wasm-game-framework/adapter-runbook.html)
- [llms.txt](https://builtbyted.github.io/wasm-game-framework/llms.txt)

Source: [BuiltByTed/wasm-game-framework](https://github.com/BuiltByTed/wasm-game-framework)
