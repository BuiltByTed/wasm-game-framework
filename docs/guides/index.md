# WASM Game Framework

Current release: **{{VERSION}}**

This is the shared browser shell for native game engines compiled to
WebAssembly. It is the launcher, the loading surface, the canvas and capture
lifecycle, the save/config mount, the game-data gate, and the container
boundary. A game does not ship a second website. It ships policy and a native
seam.

The live example is [Wolfenstein: Enemy Territory]({{LIVE_EXAMPLE}}). That
deployment uses this framework’s launcher, persistent provisioning, browser
cache, input capture, graphics profiles, fullscreen-on-Play, and idle
dedicated-server wakeup.

## What you build

You compile an engine to Wasm, then declare how it should appear and behave.
The framework turns that declaration into the document the player sees.

Start a new game directory with the scaffold:

```bash
npx create-wasm-game my-game
npm create wasm-game@latest my-game
```

That writes `web/wasm-game.json`, `web/game-adapter.js`, an exact pin of
`{{PACKAGE_NAME}}@{{VERSION}}`, a Docker build, a package-contract test, and
`RUNBOOK.md` for the implementation agent. It does not write `index.html`,
launcher CSS, a service worker, or a web manifest. Those stay in the
framework so every title upgrades together.

## What the framework owns

- the HTML document, launcher, loading view, and canvas
- pointer lock, menu-cursor policy, and mapped menu coordinates
- Gamepad discovery and polling
- IndexedDB caches for validated game files and selected media
- IDBFS save/config/keybinding persistence
- first-run provisioning into a persistent `/data` volume
- PWA metadata, the shell service worker, and fullscreen-on-Play
- optional play password and dedicated-server wake/idle

## What a game owns

- `wasm-game.json` — display, cursor, controller, persistence, branding
- `game-adapter.js` — start the native runtime and report honest engine state
- `wasm-game-data.json` — which files or media entries are allowed
- compiled engine artifacts and public art
- optional validators, media transformers, and a wake/idle server

The dependency direction is one way: framework → engine family → game adapter
→ suite or single-title image. Nothing downstream is copied back up.

## How to read these docs

1. [Getting started](getting-started.html) — install, test, and pin.
2. [Build a game](build-a-game.html) — the actual work sequence.
3. [How it works](how-it-works.html) — the mental model.
4. The contract pages — exact fields, states, and APIs.
5. The runbooks — acceptance checklists used by every title in the portfolio.

If you are an LLM or a tool, start at [`/llms.txt`](llms.txt) and use
[`/llms-full.txt`](llms-full.txt) when you need the full contract in one file.
