'use strict';

const path = require('node:path');
const framework = require('../dist/wasm-game-framework.js');
const pkg = require('../package.json');

const VERSION = pkg.version;
const PACKAGE_NAME = pkg.name;
const REPOSITORY_URL = 'https://github.com/BuiltByTed/wasm-game-framework';
const PAGES_ORIGIN = 'https://builtbyted.github.io/wasm-game-framework';
const LIVE_EXAMPLE = {
  title: 'Wolfenstein: Enemy Territory',
  url: 'https://wolfet.tedcharles.net/'
};

const ENGINE_STATES = Object.freeze([
  { id: 'provisioning', capture: 'Released', meaning: 'Required container data is missing; only setup UI is shown.' },
  { id: 'launcher', capture: 'Released', meaning: 'Framework options are visible and Play has not started the runtime.' },
  { id: 'loading', capture: 'Released unless launch capture intent is active', meaning: 'Engine, map, or connection is not yet player-controllable.' },
  { id: 'menu', capture: 'Released', meaning: 'Native main or menu UI owns absolute pointer input.' },
  { id: 'gameplay', capture: 'Captured', meaning: 'A valid player snapshot or world is controllable.' },
  { id: 'paused', capture: 'Released', meaning: 'In-game menu or pause UI is active.' },
  { id: 'debrief', capture: 'Released', meaning: 'Score or intermission UI is active.' },
  { id: 'crashed', capture: 'Released', meaning: 'Native runtime cannot continue.' }
]);

const DISPLAY_MODES = Object.freeze([
  { id: '4:3', meaning: 'Contain the canvas at 4:3 with black bars. Never distort.' },
  { id: '16:9', meaning: 'Contain the canvas at 16:9 with black bars. Never distort.' },
  { id: 'dynamic', meaning: 'Fill the live viewport. A native-managed engine must acknowledge the new backbuffer.' }
]);

const MENU_CURSOR_MODES = Object.freeze([
  { id: 'native', meaning: 'Runtime draws its own menu pointer. Host pointer is hidden. Mapped absolute callbacks still fire.' },
  { id: 'browser', meaning: 'Host pointer stays visible. Mapped absolute callbacks still fire.' },
  { id: 'none', meaning: 'Pointer-free menus. Host pointer is hidden and released pointer callbacks are suppressed.' }
]);

const CONTROLLER_MODES = Object.freeze([
  { id: 'disabled', meaning: 'Hide controller controls and perform no Gamepad polling.' },
  { id: 'wasdMouse', meaning: 'Normalized left-stick move, right-stick look, triggers, face, shoulder, menu, and scoreboard actions.' },
  { id: 'custom', meaning: 'Immutable raw axes and buttons for a console pad, wheel, or other native mapping.' }
]);

const CONTROLLER_ACTIONS = Object.freeze([
  'moveX', 'moveY', 'lookX', 'lookY',
  'forward', 'backward', 'left', 'right',
  'jump', 'crouch', 'reload', 'weapon',
  'previousWeapon', 'nextWeapon', 'altAttack', 'attack',
  'scoreboard', 'menu', 'sprint', 'melee'
]);

const ADAPTER_METHODS = Object.freeze([
  { name: 'init', required: 'optional', when: 'Always available. Load policy and install native callbacks without starting the game.' },
  { name: 'start', required: 'always', when: 'Start or resume the native runtime exactly once per launch.' },
  { name: 'readEngineState', required: 'when pointerLock is not false', when: 'Return authoritative native state from engine truth, never from timeouts or the last click.' },
  { name: 'readCaptureIntent', required: 'optional', when: 'Return true only during a JOIN, New Game, or Resume gesture that should capture on the trusted pointerup.' },
  { name: 'resize', required: 'when nativeManaged is true', when: 'Apply requestedWidth/requestedHeight to the drawing buffer, viewport, projection, and resolution cvars in the same frame when the engine permits it.' },
  { name: 'pointerMove', required: 'when pointerWidth, pointerHeight, or pointerFit is declared', when: 'Forward mapped menu coordinates or captured relative deltas.' },
  { name: 'pointerButton', required: 'when pointerWidth, pointerHeight, or pointerFit is declared', when: 'Forward mapped button state in the same virtual space.' },
  { name: 'controllerFrame', required: 'when controller.mode is wasdMouse or custom', when: 'Write one immutable frame into the native input queue. Never dispatch synthetic DOM events.' },
  { name: 'controllerChanged', required: 'when controller.mode is wasdMouse or custom', when: 'Release held native actions on disable or disconnect.' },
  { name: 'preferencesChanged', required: 'optional', when: 'Apply later player-name, profile, FPS, and dynamic-quality changes.' },
  { name: 'inputCaptureChanged', required: 'optional', when: 'Update explicit native relative-mouse mode when capture changes.' },
  { name: 'captureLost', required: 'when pointerLock is not false', when: 'Invoke exactly one native pause or menu action.' },
  { name: 'persistenceChanged', required: 'optional', when: 'Observe serialized save/config flush status.' },
  { name: 'contextLost', required: 'optional', when: 'Stop native rendering safely and report paused plus a recoverable diagnostic.' },
  { name: 'contextRestored', required: 'optional', when: 'Rebuild renderer resources or restart the native renderer.' }
]);

const BROWSER_EXPORTS = Object.freeze(Object.keys(framework).filter(name => name !== 'version').sort());

const WASD_MOUSE_DEFAULTS = Object.freeze({
  moveDeadzone: 0.18,
  lookDeadzone: 0.14
});

const MEDIA_DEFAULTS = Object.freeze({
  restoreConcurrency: 12,
  concurrencyRange: [1, 32],
  minimumEntries: 0,
  maxEntries: 512,
  maxFilesPerEntry: 256,
  maxFileBytes: 16 * 1024 * 1024 * 1024,
  maxEntryBytes: 32 * 1024 * 1024 * 1024,
  maxBrowserCacheBytes: 4 * 1024 * 1024 * 1024,
  launcherVisibleWhenReady: true
});

const PERSISTENCE_BOUNDS = Object.freeze({
  debounceMs: [0, 60000],
  intervalMs: [0, 600000]
});

const MEDIA_ERROR_CODES = Object.freeze([
  { code: 'MEDIA_LIBRARY_UNAVAILABLE', meaning: 'The container has no media-library policy.' },
  { code: 'MEDIA_SELECTION_REQUIRED', meaning: 'Play or load was attempted without a selected entry. Treat as a launcher state.' },
  { code: 'MEDIA_SELECTION_INVALID', meaning: 'The requested ID is not 32 hexadecimal characters.' },
  { code: 'MEDIA_SELECTION_UNAVAILABLE', meaning: 'The explicit ID is well-formed but not installed. Fail closed; do not fall back.' },
  { code: 'MEDIA_SELECTION_LOCKED', meaning: 'An adapter asked load() for an ID other than the WASM_GAME_MEDIA lock.' },
  { code: 'MEDIA_RANDOM_ACCESS_REQUIRED', meaning: 'The selected entry exceeds maxBrowserCacheBytes. Do not materialize it in memory.' },
  { code: 'CONTAINER_DATA_REQUIRED', meaning: 'Fixed files or required media are not ready.' },
  { code: 'OWNER_DATA_MISSING', meaning: 'A requested fixed-file key is not installed.' }
]);

const MANIFEST_FIELDS = Object.freeze([
  { name: 'id', required: true, type: 'string', consumed: true, notes: 'Stable title or family id. Suite variants inherit this as a fallback identity.' },
  { name: 'title', required: true, type: 'string', consumed: true, notes: 'Human title. Required for PWA name when pwa.name is omitted.' },
  { name: 'kicker', required: false, type: 'string', consumed: true, notes: 'Small launcher eyebrow. engine is used if kicker is omitted.' },
  { name: 'engine', required: false, type: 'string', consumed: true, notes: 'Optional engine label used as the kicker fallback.' },
  { name: 'description', required: false, type: 'string', consumed: true, notes: 'Optional ready-state launcher copy. Must stay neutral: no setup, file, cache, or storage language.' },
  { name: 'loadingTitle', required: false, type: 'string', consumed: true, notes: 'Optional loading heading. Must also stay free of provisioning language.' },
  { name: 'provisioningText', required: false, type: 'string', consumed: true, notes: 'Shown only while required fixed files are missing.' },
  { name: 'mediaProvisioningText', required: false, type: 'string', consumed: true, notes: 'Shown only while a required media library has no selected entry.' },
  { name: 'icon', required: true, type: 'url', consumed: true, notes: 'Launcher icon and tab favicon. Must exist in the public site or be a /game-data/files/ URL.' },
  { name: 'iconPixelated', required: false, type: 'boolean', consumed: true, notes: 'Crisp-nearest filtering for low-resolution original icons.' },
  { name: 'background', required: false, type: 'url', consumed: true, notes: 'Launcher background image.' },
  { name: 'backgroundPosition', required: false, type: 'string', consumed: true, notes: 'CSS background-position. Default center.' },
  { name: 'backgroundSize', required: false, type: 'string', consumed: true, notes: 'CSS background-size. Default cover.' },
  { name: 'adapter', required: true, type: 'url', consumed: true, notes: 'Public path to game-adapter.js. Default /game-adapter.js.' },
  { name: 'pwa', required: true, type: 'object', consumed: true, notes: 'Installable-app metadata. shortName and at least one icon are required.' },
  { name: 'displayMode', required: true, type: '4:3 | 16:9 | dynamic', consumed: true, notes: 'Aspect policy, not necessarily a user-facing control.' },
  { name: 'nativeManaged', required: false, type: 'boolean', consumed: true, notes: 'When true the adapter owns the physical backbuffer and must implement resize().' },
  { name: 'syncBackbuffer', required: false, type: 'boolean', consumed: true, notes: 'When true the shell sizes the canvas drawing buffer to the CSS rectangle.' },
  { name: 'resizeTransition', required: false, type: 'immediate | native', consumed: true, notes: 'immediate fills the new viewport in the same frame. Use only when resize() updates the native buffer immediately.' },
  { name: 'canvasWidth', required: false, type: 'number', consumed: true, notes: 'Initial canvas drawing-buffer width. Default 640.' },
  { name: 'canvasHeight', required: false, type: 'number', consumed: true, notes: 'Initial canvas drawing-buffer height. Default 480.' },
  { name: 'pixelated', required: false, type: 'boolean', consumed: true, notes: 'Nearest-neighbor canvas filtering for software or low-res buffers.' },
  { name: 'maxDpr', required: false, type: 'number', consumed: true, notes: 'Device-pixel-ratio ceiling. Default 1.' },
  { name: 'pointerWidth', required: false, type: 'number', consumed: true, notes: 'Native menu coordinate width. Must be declared with pointerHeight. Unrelated to the render target.' },
  { name: 'pointerHeight', required: false, type: 'number', consumed: true, notes: 'Native menu coordinate height. Must be declared with pointerWidth.' },
  { name: 'pointerFit', required: false, type: 'contain | fill', consumed: true, notes: 'contain removes letterbox or pillarbox before converting into native menu space.' },
  { name: 'pointerLock', required: false, type: 'boolean', consumed: true, notes: 'Default true. When not false, readEngineState() and captureLost() are required.' },
  { name: 'menuCursor', required: false, type: 'native | browser | none', consumed: true, notes: 'Released-menu pointer policy. Omitted values default to native for compatibility. New manifests must declare it.' },
  { name: 'fullscreen', required: true, type: 'boolean', consumed: true, notes: 'Must be explicit. false hides Launch fullscreen.' },
  { name: 'defaultFullscreen', required: false, type: 'boolean', consumed: true, notes: 'When true, Launch fullscreen starts checked.' },
  { name: 'controller', required: true, type: 'object | string', consumed: true, notes: 'Must be explicit. mode is disabled, wasdMouse, or custom.' },
  { name: 'persistence', required: true, type: 'false | object', consumed: true, notes: 'Must be explicit. false only when the runtime has no writable state.' },
  { name: 'identity', required: false, type: 'boolean', consumed: true, notes: 'When false the player-name field is hidden. Default true.' },
  { name: 'graphics', required: false, type: 'boolean', consumed: true, notes: 'When false, advanced graphics controls are hidden. Default true.' },
  { name: 'advanced', required: false, type: 'boolean', consumed: true, notes: 'When false the Advanced settings disclosure is hidden.' },
  { name: 'fps', required: false, type: 'boolean', consumed: true, notes: 'When false the target-FPS control is hidden.' },
  { name: 'fpsTargets', required: false, type: 'number[]', consumed: true, notes: 'Selectable FPS targets. Default [60].' },
  { name: 'dynamicQuality', required: false, type: 'boolean', consumed: true, notes: 'When false the dynamic-quality checkbox is hidden.' },
  { name: 'defaultDynamicQuality', required: false, type: 'boolean', consumed: true, notes: 'Initial dynamic-quality checkbox. Default true when the control is shown.' },
  { name: 'profiles', required: false, type: '{value,label}[]', consumed: true, notes: 'Graphics profiles. Default a single default profile.' },
  { name: 'defaultProfile', required: false, type: 'string', consumed: true, notes: 'Initially selected profile value.' },
  { name: 'defaultFps', required: false, type: 'number', consumed: true, notes: 'Initially selected FPS target. Default 60.' },
  { name: 'defaultPlayerName', required: false, type: 'string', consumed: true, notes: 'Initial player name. Default Player.' },
  { name: 'defaultController', required: false, type: 'disabled | auto', consumed: true, notes: 'Initial controller selection. Default auto unless mode is disabled.' },
  { name: 'theme', required: false, type: 'object', consumed: true, notes: 'CSS custom properties under --wasm-game-framework-*. Common keys: accent, accent-strong, panel, field, border, text, muted, danger.' },
  { name: 'variants', required: false, type: 'object', consumed: true, notes: 'Suite map. Each variant is merged over the root object and locked to its key as id.' },
  { name: 'defaultVariant', required: false, type: 'string', consumed: true, notes: 'Suite fallback when ?game= is omitted and WASM_GAME_VARIANT is suite.' },
  { name: 'preferencesNamespace', required: false, type: 'string', consumed: true, notes: 'localStorage namespace for launcher preferences. Default id.' },
  { name: 'persistenceNamespace', required: false, type: 'string', consumed: true, notes: 'IDBFS namespace prefix before -{variant}. Default id.' }
]);

const PWA_FIELDS = Object.freeze([
  { name: 'name', required: false, type: 'string', notes: 'Install name. Falls back to title.' },
  { name: 'shortName', required: true, type: 'string', notes: 'Required. Truncated to 30 characters in the generated web manifest.' },
  { name: 'description', required: false, type: 'string', notes: 'Must stay free of provisioning or storage language.' },
  { name: 'id', required: false, type: 'string', notes: 'Web-app id. Defaults to the computed start_url.' },
  { name: 'themeColor', required: false, type: 'color', notes: 'Theme color and document theme-color. Default theme.accent or #111827.' },
  { name: 'backgroundColor', required: false, type: 'color', notes: 'Default #000000.' },
  { name: 'startUrl', required: false, type: 'url', notes: 'Override the generated start_url. The server otherwise adds ?game= and ?media= when needed.' },
  { name: 'scope', required: false, type: 'url', notes: 'Default /.' },
  { name: 'display', required: false, type: 'string', notes: 'Default standalone.' },
  { name: 'orientation', required: false, type: 'string', notes: 'Default landscape.' },
  { name: 'icons', required: true, type: 'icon[]', notes: 'Each icon needs src, sizes, and type. Supply 192x192 and 512x512 PNGs or an SVG with sizes any.' }
]);

const CONTROLLER_FIELDS = Object.freeze([
  { name: 'mode', required: true, type: 'disabled | wasdMouse | custom', notes: 'Required. A bare string is accepted as the mode.' },
  { name: 'label', required: false, type: 'string', notes: 'Shown under the launch-card selector.' },
  { name: 'moveDeadzone', required: false, type: 'number', notes: `Common left-stick deadzone for wasdMouse. Default ${WASD_MOUSE_DEFAULTS.moveDeadzone}.` },
  { name: 'lookDeadzone', required: false, type: 'number', notes: `Common right-stick deadzone for wasdMouse. Default ${WASD_MOUSE_DEFAULTS.lookDeadzone}.` },
  { name: 'lookSensitivity', required: false, type: 'number', notes: 'Right-stick look scale. Clamped to 0.01–10. Default 1.' },
  { name: 'invertY', required: false, type: 'boolean', notes: 'Invert lookY in wasdMouse frames.' }
]);

const PERSISTENCE_FIELDS = Object.freeze([
  { name: 'root', required: true, type: 'absolute path', notes: 'Traversal-free virtual FS path. Use {variant} or {namespace} in suites. The package checker rejects colliding resolved roots.' },
  { name: 'namespace', required: false, type: 'string', notes: 'Override the resolved IDBFS namespace.' },
  { name: 'debounceMs', required: true, type: 'number', notes: `Explicit dirty-flush debounce. Allowed ${PERSISTENCE_BOUNDS.debounceMs[0]}–${PERSISTENCE_BOUNDS.debounceMs[1]}.` },
  { name: 'intervalMs', required: false, type: 'number', notes: `Periodic flush interval. Allowed ${PERSISTENCE_BOUNDS.intervalMs[0]}–${PERSISTENCE_BOUNDS.intervalMs[1]}.` },
  { name: 'requestDurability', required: false, type: 'boolean', notes: 'Best-effort navigator.storage.persist() during attach. Default true. Rejection cannot block startup.' }
]);

const DATA_MANIFEST_FIELDS = Object.freeze([
  { name: 'namespace', required: true, type: 'string', notes: 'Lowercase key used for browser cache isolation. Default game or game-suite.' },
  { name: 'version', required: true, type: 'string', notes: 'Content-set version. Changing it invalidates browser cache records that do not share the new key.' },
  { name: 'validator', required: false, type: 'object', notes: 'Default downstream validator inherited by files unless a file sets validator: false.' },
  { name: 'files', required: 'when no mediaLibrary', type: 'file[]', notes: 'Fixed allowlisted files. Empty is allowed when a media library is declared.' },
  { name: 'mediaLibrary', required: 'when no files', type: 'object | false', notes: 'Variable private media collection. A manifest must contain at least one file or a media library.' },
  { name: 'variants', required: false, type: 'object', notes: 'Independent policies keyed by the same variant ids as wasm-game.json.' }
]);

const DATA_FILE_FIELDS = Object.freeze([
  { name: 'key', required: true, type: 'string', notes: 'Stable setup and download key. [a-z0-9._-]+.' },
  { name: 'name', required: true, type: 'string', notes: 'Canonical filename used for matching uploads and serving downloads.' },
  { name: 'names', required: false, type: 'string[]', notes: 'Accepted filename aliases, for example DOOM.WAD.' },
  { name: 'path', required: false, type: 'relative path', notes: 'Traversal-safe path under /data. Default name.' },
  { name: 'required', required: false, type: 'boolean', notes: 'Default true. Optional files do not block readiness.' },
  { name: 'size', required: false, type: 'number', notes: 'Exact size. Equivalent to a one-element sizes array.' },
  { name: 'sizes', required: false, type: 'number[]', notes: 'Closed set of accepted sizes.' },
  { name: 'minSize', required: false, type: 'number', notes: 'Inclusive lower size bound.' },
  { name: 'maxSize', required: false, type: 'number', notes: 'Inclusive upper size bound and validator upload envelope when sizes is empty.' },
  { name: 'sha256', required: false, type: 'hex | hex[]', notes: 'Optional SHA-256 allowlist.' },
  { name: 'magic', required: false, type: 'bytes | {bytes,offset}[]', notes: 'Optional magic-byte checks at an offset.' },
  { name: 'validator', required: false, type: 'object | false', notes: 'Per-file override or opt-out. A validator requires sizes or maxSize.' },
  { name: 'validateCached', required: false, type: 'boolean', notes: 'When false, cache restores skip the downstream validator after exact cache-policy, name, size, and signature checks.' }
]);

const VALIDATOR_FIELDS = Object.freeze([
  { name: 'module', required: true, type: '/…/*.mjs', notes: 'Traversal-safe same-origin .mjs path inside the game site.' },
  { name: 'export', required: false, type: 'identifier | default', notes: 'Default default for files, or the named export. Media transformers default to transformMediaBundle.' },
  { name: 'version', required: true, type: 'string', notes: 'Explicit semantic version of the module. Part of every cache key. Max 128 characters.' },
  { name: 'policy', required: false, type: 'object', notes: 'Bounded JSON object, at most 64 KiB encoded. Merged from root, variant, and file.' },
  { name: 'maxReadBytes', required: false, type: 'number', notes: 'Per-call read budget. Default 4 MiB. Range 1 byte–512 MiB.' },
  { name: 'maxTotalReadBytes', required: false, type: 'number | null', notes: 'Total random-read budget. Default one file length. Range 0–32 GiB.' }
]);

const MEDIA_LIBRARY_FIELDS = Object.freeze([
  { name: 'namespace', required: false, type: 'string', notes: 'Cache and storage namespace. Default {manifest.namespace}-media.' },
  { name: 'version', required: false, type: 'string', notes: 'Library version inherited from the data manifest when omitted.' },
  { name: 'path', required: false, type: 'relative path', notes: 'Storage directory under /data. Default media/{namespace}.' },
  { name: 'minimumEntries', required: false, type: 'number', notes: `Required installed entries before ready. Default ${MEDIA_DEFAULTS.minimumEntries}.` },
  { name: 'launcherVisibleWhenReady', required: false, type: 'boolean', notes: 'Default true. Set false for a single-install flow that hides the selector after readiness.' },
  { name: 'maxEntries', required: false, type: 'number', notes: `Default ${MEDIA_DEFAULTS.maxEntries}.` },
  { name: 'maxFilesPerEntry', required: false, type: 'number', notes: `Default ${MEDIA_DEFAULTS.maxFilesPerEntry}.` },
  { name: 'maxFileBytes', required: false, type: 'number', notes: `Default ${MEDIA_DEFAULTS.maxFileBytes} (16 GiB).` },
  { name: 'maxEntryBytes', required: false, type: 'number', notes: `Default ${MEDIA_DEFAULTS.maxEntryBytes} (32 GiB).` },
  { name: 'maxBrowserCacheBytes', required: false, type: 'number', notes: `Default ${MEDIA_DEFAULTS.maxBrowserCacheBytes} (4 GiB). 0 forces MEDIA_RANDOM_ACCESS_REQUIRED.` },
  { name: 'publicMetadata', required: false, type: 'string[]', notes: 'Allowlisted scalar metadata keys copied into public listings. Never host paths or raw filenames.' },
  { name: 'validator', required: true, type: 'object', notes: 'Required bundle validator. Same Node/browser module contract as file validators, plus files/totalSize/file().' },
  { name: 'transformer', required: false, type: 'object | false', notes: 'Optional trusted server-side module. The framework has no installer or archive knowledge.' }
]);

const TRANSFORMER_FIELDS = Object.freeze([
  { name: 'module', required: true, type: '/…/*.mjs', notes: 'Absolute site-root .mjs path.' },
  { name: 'export', required: false, type: 'identifier', notes: 'Default transformMediaBundle.' },
  { name: 'version', required: true, type: 'string', notes: 'Transformer version included in installed entry identity.' },
  { name: 'policy', required: false, type: 'object', notes: 'Bounded JSON policy given to the transformer.' }
]);

const ENVIRONMENT = Object.freeze([
  { name: 'WASM_GAME_SITE_ROOT', default: '/opt/game-site', notes: 'Public game site containing wasm-game.json and adapter assets.' },
  { name: 'WASM_GAME_SHELL_ROOT', default: '/opt/shared-shell', notes: 'Canonical document and framework package files.' },
  { name: 'WASM_GAME_DATA_ROOT', default: '/data', notes: 'Persistent volume. Never served as /data or /local-data.' },
  { name: 'WASM_GAME_HTTP_PORT', default: '8088', notes: 'Static server listen port.' },
  { name: 'WASM_GAME_VARIANT', default: 'suite', notes: 'suite leaves the selector visible. Any other key locks that variant.' },
  { name: 'WASM_GAME_MEDIA', default: 'empty', notes: 'Optional 32-hex entry lock. Published through /wasm-game-config.js. Takes precedence over ?media=.' },
  { name: 'WASM_GAME_DATA_MANIFEST', default: '$SITE/wasm-game-data.json', notes: 'Override the data-policy path.' },
  { name: 'WASM_SETUP_TOKEN', default: 'empty', notes: 'When set, provisioning and media mutations require Bearer or x-wasm-setup-token.' },
  { name: 'WASM_GAME_PASSWORD', default: 'empty', notes: 'Shared play password. Empty leaves the launcher ungated.' },
  { name: 'WASM_GAME_PASSWORD_TTL', default: '12h', notes: 'HttpOnly session lifetime. Accepts ms, s, m, h.' },
  { name: 'WASM_GAME_TRUST_PROXY', default: 'false', notes: 'Trust X-Forwarded-Proto from a controlled TLS proxy so the session cookie can be Secure.' },
  { name: 'WASM_GAME_SESSION_SECRET', default: 'generated', notes: 'At least 32 random bytes. The static entrypoint generates one when a password is set and this is empty.' },
  { name: 'WASM_GAME_FRAMEWORK_VERSION', default: 'image label', notes: 'Recorded on the base image and printed at startup.' },
  { name: 'WASM_GAME_FRAMEWORK_IMAGE', default: 'rebuild local base', notes: 'Downstream image builds may pin an immutable base instead of rebuilding the sibling checkout.' },
  { name: 'KEEP_ALIVE', default: 'false', notes: 'Keep the native dedicated server running with zero humans. Does not bypass readiness.' },
  { name: 'IDLE_TIMEOUT', default: '5m', notes: 'Empty-human duration before native shutdown. 0 means stop as soon as the last human leaves.' }
]);

const STATIC_ROUTES = Object.freeze([
  { method: 'GET', path: '/', notes: 'Canonical dist/index.html when wasm-game.json exists.' },
  { method: 'GET', path: '/wasm-game.json', notes: 'Declarative browser contract.' },
  { method: 'GET', path: '/wasm-game-config.js', notes: 'Injects WASM_GAME_VARIANT and WASM_GAME_MEDIA.' },
  { method: 'GET', path: '/app.webmanifest', notes: 'Variant-aware and media-aware web app manifest.' },
  { method: 'GET', path: '/service-worker.js', notes: 'Network-first cache for the small framework shell only.' },
  { method: 'GET', path: '/shared-shell/*', notes: 'Framework CSS, JS, bootstrap, and document.' },
  { method: 'GET', path: '/auth/status', notes: 'Password requirement and session state.' },
  { method: 'POST', path: '/auth/login', notes: 'Same-origin password login. Sets an HttpOnly cookie.' },
  { method: 'POST', path: '/auth/logout', notes: 'Clears the session cookie.' },
  { method: 'GET', path: '/game-data/status', notes: 'Fixed-file and media readiness. Password-gated when a password is set.' },
  { method: 'PUT', path: '/game-data/setup/:key', notes: 'Atomic validated install of one fixed file. Setup-token gated.' },
  { method: 'GET', path: '/game-data/files/:key', notes: 'Allowlisted download after the policy is ready.' },
  { method: 'GET', path: '/game-data/media/entries', notes: 'Opaque public media listing.' },
  { method: 'GET', path: '/game-data/media/entries/:id', notes: 'Private selected-entry detail.' },
  { method: 'GET', path: '/game-data/media/entries/:id/files/:fileId', notes: 'Range-capable immutable file route.' },
  { method: 'POST', path: '/game-data/media/uploads', notes: 'Begin a bounded multi-file upload session.' },
  { method: 'PUT', path: '/game-data/media/uploads/:id/files/:fileId', notes: 'Upload one declared file into the session.' },
  { method: 'POST', path: '/game-data/media/uploads/:id/commit', notes: 'Validate, optionally transform, and atomically publish the bundle.' },
  { method: 'DELETE', path: '/game-data/media/uploads/:id', notes: 'Abort an incomplete upload.' },
  { method: 'GET/HEAD', path: '/data, /local-data', notes: 'Always 404. The volume is not a public tree.' }
]);

const LIFECYCLE_ROUTES = Object.freeze([
  { method: 'GET', path: '/status', notes: 'Lifecycle state and public match metadata. Must not wake the server.' },
  { method: 'POST', path: '/wake', notes: 'Idempotent start. Only framework Play or reconnect may call this.' },
  { method: 'GET', path: '/wake', notes: 'Must be 405.' },
  { method: 'WS', path: '/ws', notes: 'Game-packet proxy. Must not wake the server. Password-gated when a password is set.' }
]);

const LIFECYCLE_STATES = Object.freeze(['sleeping', 'starting', 'running', 'stopping', 'failed']);

const SERVER_EXPORTS = Object.freeze({
  lifecycle: ['IdleServiceSupervisor', 'parseDuration', 'environmentOptions'],
  passwordAuth: ['createPasswordGate', 'passwordOptions'],
  provisioning: ['normalizeManifest', 'normalizeManifestCollection', 'createProvisioningStore'],
  mediaLibrary: ['normalizeMediaLibrary', 'createMediaLibraryStore']
});

const PACKAGE_FILES = Object.freeze([
  'wasm-game.json',
  'wasm-game-data.json',
  'game-adapter.js',
  'engine JavaScript/WebAssembly',
  'game-specific public icons and backgrounds'
]);

const FORBIDDEN_DOWNSTREAM = Object.freeze([
  'index.html',
  'CSS that styles the launcher or viewport',
  'service workers',
  'web manifests',
  'pointer-lock managers',
  'launcher markup'
]);

const BROWSER_API = Object.freeze([
  { name: 'version', kind: 'string', summary: 'Exact package version string, currently matching package.json.' },
  { name: 'DISPLAY_MODES', kind: 'enum', summary: '4:3, 16:9, and dynamic.' },
  { name: 'ENGINE_STATES', kind: 'enum', summary: 'provisioning through crashed, including launcher, loading, menu, gameplay, paused, and debrief.' },
  { name: 'CONTROLLER_MODES', kind: 'enum', summary: 'disabled, wasdMouse, and custom.' },
  { name: 'MENU_CURSOR_MODES', kind: 'enum', summary: 'native, browser, and none.' },
  { name: 'validateAdapterContract', kind: 'function', summary: 'Throws if required adapter methods are missing for the declared manifest policy.' },
  { name: 'normalizeControllerMode', kind: 'function', summary: 'Accepts an object or string and returns disabled, wasdMouse, custom, or null.' },
  { name: 'normalizeMenuCursor', kind: 'function', summary: 'Returns native when omitted, a declared mode, or null when invalid.' },
  { name: 'configure', kind: 'function', summary: 'Create the shell: surfaces, display, capture, pointer mapping, preferences, and controller manager.' },
  { name: 'fitRect', kind: 'function', summary: 'Contain or fill a rectangle to an aspect ratio.' },
  { name: 'mapPointerPoint', kind: 'function', summary: 'Map client coordinates through the live CSS canvas into virtual menu space.' },
  { name: 'resolveDisplayRect', kind: 'function', summary: 'Compute the visible canvas rectangle, preserving last valid native aspect until a dynamic engine acknowledges resize.' },
  { name: 'detectCapabilities', kind: 'function', summary: 'Probe wasm, WebGL, audio, gamepad, pointer lock, workers, SAB/COI, IndexedDB, and desktop heuristics.' },
  { name: 'requireCapabilities', kind: 'function', summary: 'Return supported/missing/available for a required capability set.' },
  { name: 'createPreferences', kind: 'function', summary: 'Persist player name, profile, FPS, dynamic quality, fullscreen, and controller selection.' },
  { name: 'createControllerManager', kind: 'function', summary: 'Discover, remember, poll, and rumble a selected Gamepad without using transient indices.' },
  { name: 'normalizeWasdMouseController', kind: 'function', summary: 'Build the common action object from a raw gamepad snapshot.' },
  { name: 'createQualityController', kind: 'function', summary: 'Automatic quality-profile stepping from FPS telemetry.' },
  { name: 'createPersistentFs', kind: 'function', summary: 'One IDBFS mount with serialized syncfs, dirty debounce, and unload flush.' },
  { name: 'createPersistenceManager', kind: 'function', summary: 'Attach one or more mounts, markDirty, and save. Used by the bootstrap and by worker-hosted engines.' },
  { name: 'resolvePersistenceRoot', kind: 'function', summary: 'Substitute {variant} and {namespace} and reject traversal.' },
  { name: 'createDiagnostics', kind: 'function', summary: 'Bounded log plus window error/rejection capture.' },
  { name: 'requestStorageDurability', kind: 'function', summary: 'Bounded persist() request. Pending permission UI cannot block startup.' },
  { name: 'resolveDeployment', kind: 'function', summary: 'Suite versus WASM_GAME_VARIANT lock and ?game= selection.' },
  { name: 'createDataCache', kind: 'function', summary: 'Versioned IndexedDB Blob cache with getOrLoad dedupe.' },
  { name: 'createOwnerDataSet', kind: 'function', summary: 'Cache-first restore of a declared fixed-file set with validator-aware keys.' },
  { name: 'normalizeDataValidatorDeclaration', kind: 'function', summary: 'Normalize and bound a validator object.' },
  { name: 'dataValidatorCacheTag', kind: 'function', summary: 'Stable cache-key fragment for module, export, version, limits, and policy.' },
  { name: 'createBoundedDataReader', kind: 'function', summary: 'Offset/length reader with per-call and total budgets plus streaming digest().' },
  { name: 'runDataValidator', kind: 'function', summary: 'Execute a file validator in Node or the browser.' },
  { name: 'runMediaBundleValidator', kind: 'function', summary: 'Execute a bundle validator against a file set.' },
  { name: 'normalizeMediaRelativeName', kind: 'function', summary: 'Traversal-safe relative media path.' },
  { name: 'mediaLibraryLauncherVisible', kind: 'function', summary: 'Whether the selector remains visible after readiness.' },
  { name: 'normalizeMediaEntryId', kind: 'function', summary: 'Accept exactly 32 hexadecimal characters.' },
  { name: 'resolveMediaSelection', kind: 'function', summary: 'Resolve lock, query, stored, and first-available selection with fail-closed explicit IDs.' },
  { name: 'validateOwnerFile', kind: 'function', summary: 'Apply size, magic, hash, and optional downstream validator checks.' },
  { name: 'ownerFileValidation', kind: 'function', summary: 'Describe the cache-policy signature for a file.' },
  { name: 'mountOwnerFiles', kind: 'function', summary: 'Read-only WORKERFS or chunked MEMFS mount. preservePaths keeps relative directories.' },
  { name: 'createContainerDataClient', kind: 'function', summary: 'status, provision, load, applyGate, and media.* against /game-data.' },
  { name: 'createPasswordClient', kind: 'function', summary: 'status, login, and logout against /auth/* using the session cookie.' },
  { name: 'createWakeClient', kind: 'function', summary: 'POST /wake and poll /status until running or ready.' }
]);

const CONTEXT_FIELDS = Object.freeze([
  { name: 'framework', notes: 'The WasmGameFramework API object.' },
  { name: 'shell', notes: 'Return value of configure(): display, capture, preferences, controller, and surface helpers.' },
  { name: 'dataClient', notes: 'createContainerDataClient() bound to the selected variant and media deployment.' },
  { name: 'persistence', notes: 'createPersistenceManager() or null when persistence is false. root is already resolved.' },
  { name: 'config', notes: 'Merged variant manifest, including normalized menuCursor.' },
  { name: 'rootConfig', notes: 'Raw wasm-game.json including variants.' },
  { name: 'variant', notes: 'Selected variant key or the single-title id.' },
  { name: 'elements', notes: 'Canonical document nodes. Adapters should not restyle them.' },
  { name: 'preferences', notes: 'shell.preferences.' },
  { name: 'setStatus', notes: 'Launcher status or error line.' },
  { name: 'setLoading', notes: 'Loading copy, detail, and 0–100 progress.' },
  { name: 'log', notes: 'Append to the loading console.' },
  { name: 'setEngineState', notes: 'Forward to shell.setEngineState().' },
  { name: 'showLauncher', notes: 'Return to the launcher surface.' },
  { name: 'showLoading', notes: 'Show the loading surface.' },
  { name: 'showRuntime', notes: 'Show the canvas surface and optionally set engine state.' }
]);

const SHELL_METHODS = Object.freeze([
  'config', 'launcher', 'loading', 'runtime', 'canvas',
  'resumeAudio', 'inputCaptured', 'requestInputCapture', 'pointerPosition',
  'engineState', 'setEngineState', 'preferences', 'controller', 'resize',
  'setDisplay', 'setDisplayMode', 'showLauncher', 'showLoading', 'showRuntime', 'destroy'
]);

const SOURCE_DOCUMENTS = Object.freeze([
  { id: 'readme', title: 'README', file: 'README.md', page: 'readme.html' },
  { id: 'architecture', title: 'Architecture', file: 'ARCHITECTURE.md', page: 'architecture.html' },
  { id: 'adapter-runbook', title: 'Adapter runbook', file: 'ADAPTER_RUNBOOK.md', page: 'adapter-runbook.html' },
  { id: 'server-runbook', title: 'Server runbook', file: 'SERVER_RUNBOOK.md', page: 'server-runbook.html' }
]);

const NAV = Object.freeze([
  {
    title: 'Start',
    items: [
      { id: 'index', href: 'index.html', title: 'Overview' },
      { id: 'getting-started', href: 'getting-started.html', title: 'Getting started' },
      { id: 'build-a-game', href: 'build-a-game.html', title: 'Build a game' },
      { id: 'how-it-works', href: 'how-it-works.html', title: 'How it works' },
      { id: 'architecture', href: 'architecture.html', title: 'Architecture' }
    ]
  },
  {
    title: 'Contracts',
    items: [
      { id: 'manifest', href: 'manifest.html', title: 'wasm-game.json' },
      { id: 'game-data', href: 'game-data.html', title: 'Game data' },
      { id: 'media-library', href: 'media-library.html', title: 'Media library' },
      { id: 'adapter', href: 'adapter.html', title: 'Adapter seam' },
      { id: 'display', href: 'display.html', title: 'Display and resize' },
      { id: 'input', href: 'input.html', title: 'Pointer and capture' },
      { id: 'controllers', href: 'controllers.html', title: 'Controllers' },
      { id: 'persistence', href: 'persistence.html', title: 'Persistence' },
      { id: 'validators', href: 'validators.html', title: 'Validators' }
    ]
  },
  {
    title: 'Server',
    items: [
      { id: 'http', href: 'http.html', title: 'HTTP and routes' },
      { id: 'password', href: 'password.html', title: 'Password and PWA' },
      { id: 'lifecycle', href: 'lifecycle.html', title: 'Wake and idle' },
      { id: 'docker', href: 'docker.html', title: 'Docker and env' }
    ]
  },
  {
    title: 'Reference',
    items: [
      { id: 'browser-api', href: 'browser-api.html', title: 'Browser API' },
      { id: 'server-api', href: 'server-api.html', title: 'Server API' },
      { id: 'testing', href: 'testing.html', title: 'Tests and checker' },
      { id: 'examples', href: 'examples.html', title: 'Examples' },
      { id: 'projects', href: 'projects.html', title: 'Projects' }
    ]
  },
  {
    title: 'Source',
    items: [
      { id: 'readme', href: 'readme.html', title: 'README' },
      { id: 'adapter-runbook', href: 'adapter-runbook.html', title: 'Adapter runbook' },
      { id: 'server-runbook', href: 'server-runbook.html', title: 'Server runbook' }
    ]
  }
]);

const REQUIRED_LLM_HEADINGS = Object.freeze([
  'Current version',
  'Canonical contracts',
  'wasm-game.json',
  'Adapter lifecycle',
  'menuCursor',
  'Controller modes',
  'Persistence',
  'Validators',
  'Media libraries',
  'Server wake/sleep',
  'Docker',
  'Tests',
  'Examples'
]);

const RELEASE_NOTES = Object.freeze([
  {
    version: '0.9.6',
    summary: 'Restore large browser media libraries with a bounded parallel worker pool (default 12, range 1–32) while preserving manifest order and draining failures before the selected-entry cache is cleared.'
  },
  {
    version: '0.9.5',
    summary: 'Bounded, downstream-owned media transformation. A launch card can ingest installer or archive sets and atomically publish only validated output.'
  },
  {
    version: '0.9.4',
    summary: 'Stable direct-media launch links and deployment locks: /?game=<variant>&media=<32-hex-id> and WASM_GAME_MEDIA=<id>. Unavailable explicit selections fail closed.'
  }
]);

function repoRoot() {
  return path.resolve(__dirname, '..');
}

function everyNavPage() {
  return NAV.flatMap(group => group.items);
}

function factsForDrift() {
  return Object.freeze({
    version: VERSION,
    packageName: PACKAGE_NAME,
    engineStates: ENGINE_STATES.map(item => item.id),
    displayModes: DISPLAY_MODES.map(item => item.id),
    menuCursorModes: MENU_CURSOR_MODES.map(item => item.id),
    controllerModes: CONTROLLER_MODES.map(item => item.id),
    adapterRequiredAlways: ADAPTER_METHODS.filter(item => item.required === 'always').map(item => item.name),
    browserExports: BROWSER_EXPORTS,
    mediaErrorCodes: MEDIA_ERROR_CODES.map(item => item.code),
    lifecycleStates: LIFECYCLE_STATES,
    forbiddenDownstream: FORBIDDEN_DOWNSTREAM,
    packageFiles: PACKAGE_FILES,
    restoreConcurrency: MEDIA_DEFAULTS.restoreConcurrency,
    liveExample: LIVE_EXAMPLE.url
  });
}

module.exports = Object.freeze({
  VERSION,
  PACKAGE_NAME,
  REPOSITORY_URL,
  PAGES_ORIGIN,
  LIVE_EXAMPLE,
  ENGINE_STATES,
  DISPLAY_MODES,
  MENU_CURSOR_MODES,
  CONTROLLER_MODES,
  CONTROLLER_ACTIONS,
  ADAPTER_METHODS,
  BROWSER_EXPORTS,
  WASD_MOUSE_DEFAULTS,
  MEDIA_DEFAULTS,
  PERSISTENCE_BOUNDS,
  MEDIA_ERROR_CODES,
  MANIFEST_FIELDS,
  PWA_FIELDS,
  CONTROLLER_FIELDS,
  PERSISTENCE_FIELDS,
  DATA_MANIFEST_FIELDS,
  DATA_FILE_FIELDS,
  VALIDATOR_FIELDS,
  MEDIA_LIBRARY_FIELDS,
  TRANSFORMER_FIELDS,
  ENVIRONMENT,
  STATIC_ROUTES,
  LIFECYCLE_ROUTES,
  LIFECYCLE_STATES,
  SERVER_EXPORTS,
  PACKAGE_FILES,
  FORBIDDEN_DOWNSTREAM,
  BROWSER_API,
  CONTEXT_FIELDS,
  SHELL_METHODS,
  SOURCE_DOCUMENTS,
  NAV,
  REQUIRED_LLM_HEADINGS,
  RELEASE_NOTES,
  repoRoot,
  everyNavPage,
  factsForDrift
});
