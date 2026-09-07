# Getting started

You need Node 18+, and Docker only when you want an image. The framework
repository is self-contained. It does not include a game engine or game data.

## Create a game

The fastest honest start is the scaffold. It writes a project that already
passes the package checker:

```bash
npx create-wasm-game my-game
cd my-game
npm test
npm start
```

`npm create wasm-game@latest my-game` is the same command. The scaffold writes
`RUNBOOK.md`: give that file to an implementation agent along with
[llms.txt](llms.txt). Useful flags:

```bash
npx create-wasm-game my-game \
  --display-mode dynamic \
  --menu-cursor native \
  --controller wasdMouse
```

Defaults, on purpose:

| Choice | Default | Why |
| --- | --- | --- |
| `displayMode` | `4:3` | Contain, never stretch. Switch to `dynamic` only when the native renderer can change its backbuffer. |
| `menuCursor` | `browser` | A stub has no native pointer. Use `native` when the runtime draws one, `none` when menus are pointer-free. |
| `controller` | `disabled` | Most ports in this portfolio do not poll a gamepad. Opt in with `wasdMouse` or `custom`. |
| `persistence` | `/save/{variant}` | The adapter attaches this mount before native main. |

The scaffold never emits `index.html`, CSS, a service worker, or a web
manifest. If you add those files later, you have left the contract.

## Work from the framework checkout

```bash
git clone https://github.com/theodorecharles/wasm-game-framework.git
cd wasm-game-framework
npm test
```

To attach the current checkout to an existing game site during development:

```bash
./scripts/install-browser-package.sh /absolute/path/to/my-game/web/shared-shell link
```

Release and image builds use `copy` instead of `link`. That writes
`wasm-game-framework.json` with the version and SHA-256 of each package file.

## Build the base image

```bash
./scripts/build-base-image.sh wasm-game-framework:{{VERSION}}
./scripts/build-static-image.sh /absolute/path/to/my-game/web my-game-wasm:dev
```

Run the image with a persistent `/data` volume. On first use the operator
uploads the files allowed by `wasm-game-data.json`. After that, visitors see
the normal launcher. Each browser keeps a validated IndexedDB cache.

```bash
docker run --rm -p 8088:8088 -v my-game-data:/data my-game-wasm:dev
```

Optional: `WASM_GAME_PASSWORD`, `WASM_SETUP_TOKEN`, `WASM_GAME_VARIANT`,
`WASM_GAME_MEDIA`. See [Docker and env](docker.html).

## What “done” looks like locally

- `npm test` in the generated project prints `adapter package contract passed`.
- `npm start` serves the canonical document at `http://127.0.0.1:8088/`.
- Play is enabled once required data (if any) is ready.
- There is still no game world until you replace `createNativeModule()` with
  the compiled engine. That is expected. The scaffold is a contract, not a
  ROM.

Next: [Build a game](build-a-game.html).
