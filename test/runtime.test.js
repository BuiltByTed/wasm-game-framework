'use strict';

const assert = require('node:assert/strict');

let trustedPointerActivation = false;

class Target {
  constructor() { this.listeners = new Map(); }
  addEventListener(type, callback) {
    const values = this.listeners.get(type) || [];
    values.push(callback);
    this.listeners.set(type, values);
  }
  removeEventListener(type, callback) {
    this.listeners.set(type, (this.listeners.get(type) || []).filter(value => value !== callback));
  }
  dispatch(type, event = {}) {
    event.type = type;
    const priorActivation = trustedPointerActivation;
    if (type === 'pointerdown' || type === 'pointerup') trustedPointerActivation = true;
    try {
      for (const callback of [...(this.listeners.get(type) || [])]) callback(event);
    } finally {
      trustedPointerActivation = priorActivation;
    }
  }
}

function node() {
  const target = new Target();
  target.hidden = false;
  target.dataset = {};
  target.style = { setProperty(name, value) { this[name] = value; } };
  target.classList = { add() {}, remove() {} };
  target.setAttribute = (name, value) => { target[name] = value; };
  target.focus = () => { target.focused = true; };
  return target;
}

const frames = new Map();
let nextFrame = 1;
global.requestAnimationFrame = callback => {
  const id = nextFrame++;
  frames.set(id, callback);
  return id;
};
global.cancelAnimationFrame = id => frames.delete(id);
function flushFrame() {
  const callbacks = [...frames.values()];
  frames.clear();
  callbacks.forEach(callback => callback());
}

const windowTarget = new Target();
windowTarget.innerWidth = 800;
windowTarget.innerHeight = 600;
windowTarget.dispatchEvent = event => windowTarget.dispatch(event.type, event);
global.window = windowTarget;
global.CustomEvent = class CustomEvent { constructor(type, init) { this.type = type; this.detail = init?.detail; } };

const documentTarget = new Target();
documentTarget.documentElement = node();
documentTarget.body = node();
documentTarget.pointerLockElement = null;
documentTarget.querySelector = () => null;
documentTarget.querySelectorAll = () => [];
documentTarget.createElement = () => node();
documentTarget.exitPointerLock = () => {
  documentTarget.pointerLockElement = null;
  documentTarget.dispatch('pointerlockchange');
};
global.document = documentTarget;

const canvas = node();
canvas.width = 640;
canvas.height = 480;
canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: windowTarget.innerWidth, height: windowTarget.innerHeight });
let pointerLockRequests = 0;
let pointerLockDenied = 0;
canvas.requestPointerLock = () => {
  pointerLockRequests += 1;
  if (!trustedPointerActivation) {
    pointerLockDenied += 1;
    throw new Error('NotAllowedError: requestPointerLock requires transient activation');
  }
  documentTarget.pointerLockElement = canvas;
  documentTarget.dispatch('pointerlockchange');
  return Promise.resolve();
};

const framework = require('../dist/wasm-game-framework.js');
let nativeState = 'menu';
let captureIntent = false;
let pointerAction = 'sync';
let captureLost = 0;
const pointerMoves = [];
const resizes = [];
const shell = framework.configure({
  launcher: node(), card: node(), loading: node(), runtime: node(), canvas,
  desktopNotice: false,
  displayMode: 'dynamic', nativeManaged: true, resizeTransition: 'immediate',
  pointerLock: true, engineState: 'menu',
  readEngineState: () => nativeState,
  readCaptureIntent: () => captureIntent,
  onPointerButton: detail => {
    if (detail.pressed && pointerAction === 'down-intent') {
      captureIntent = true;
    } else if (!detail.pressed) {
      if (pointerAction === 'sync') {
        nativeState = 'loading';
        captureIntent = true;
      } else if (pointerAction === 'sync-intent-only') {
        captureIntent = true;
      } else if (pointerAction === 'delayed') {
        requestAnimationFrame(() => {
          nativeState = 'loading';
          captureIntent = true;
        });
      }
    }
  },
  onCaptureLost: () => { captureLost += 1; },
  onPointerMove: detail => pointerMoves.push(detail),
  onNativeResizeRequest: detail => resizes.push(detail)
});

assert.equal(shell.engineState(), 'menu');
assert.equal(shell.config.menuCursor, 'native', 'menuCursor must default to native for existing manifests');
assert.equal(documentTarget.documentElement.dataset.shellMenuCursor, 'native');
assert.equal(documentTarget.documentElement.dataset.shellHostCursor, 'hidden',
  'the default policy hides the host pointer while a native menu owns it');
canvas.dispatch('pointermove', { clientX: 200, clientY: 150, movementX: 99, movementY: 88 });
assert.equal(pointerMoves.at(-1).captured, false);
assert.equal(pointerMoves.at(-1).x, 160);
assert.equal(pointerMoves.at(-1).y, 120);
assert.equal('movementX' in pointerMoves.at(-1), false,
  'released pointer events deliver absolute mapped coordinates, not relative deltas');
assert.equal(Object.isFrozen(pointerMoves.at(-1)), true);
canvas.dispatch('pointerdown', { clientX: 400, clientY: 300, button: 0, pointerId: 1 });
canvas.dispatch('pointerup', { clientX: 400, clientY: 300, button: 0, pointerId: 1 });
assert.equal(shell.engineState(), 'loading', 'JOIN must publish authoritative loading state inside the trusted callback');
assert.equal(shell.inputCaptured(), true, 'synchronous JOIN intent must capture before trusted activation ends');
assert.equal(documentTarget.documentElement.dataset.shellHostCursor, 'hidden', 'captured loading keeps the host pointer hidden');
canvas.dispatch('pointermove', { clientX: 1, clientY: 2, movementX: 12, movementY: -7 });
assert.equal(pointerMoves.at(-1).captured, true);
assert.equal(pointerMoves.at(-1).movementX, 12);
assert.equal(pointerMoves.at(-1).movementY, -7);
assert.equal('x' in pointerMoves.at(-1), false,
  'captured pointer events deliver only relative deltas, never absolute menu coordinates');
assert.equal(Object.isFrozen(pointerMoves.at(-1)), true);
assert.equal(pointerLockRequests, 1);
flushFrame();
assert.equal(pointerLockRequests, 1, 'the next-frame fallback must not duplicate an already successful request');

shell.setEngineState('loading');
assert.equal(shell.inputCaptured(), true, 'loading must retain capture while native launch intent is active');
shell.showLoading();
assert.equal(shell.runtime.hidden, false, 'the loading overlay must not hide a capture-intent canvas');
assert.equal(shell.loading.hidden, false, 'capture-intent loading still displays progress');
assert.equal(shell.inputCaptured(), true);
captureIntent = false;
shell.showLoading();
assert.equal(shell.inputCaptured(), false, 'cancelled loading intent must release capture');
assert.equal(shell.runtime.hidden, true, 'ordinary boot/cancelled loading still hides the runtime');
assert.equal(documentTarget.documentElement.dataset.shellHostCursor, 'hidden',
  'default native menu loading keeps the host pointer hidden after capture release');

nativeState = 'gameplay';
shell.setEngineState('gameplay');
canvas.dispatch('pointerdown', { clientX: 400, clientY: 300, button: 0 });
assert.equal(shell.inputCaptured(), true, 'gameplay interaction must capture');
assert.equal(documentTarget.documentElement.dataset.shellHostCursor, 'hidden');
documentTarget.pointerLockElement = null;
documentTarget.dispatch('pointerlockchange');
assert.equal(captureLost, 1, 'losing gameplay capture must call the native menu action once');
assert.equal(documentTarget.documentElement.dataset.shellHostCursor, 'visible',
  'an uncaptured gameplay frame exposes the host pointer until native state reports its menu');

nativeState = 'menu';
shell.setEngineState('menu');
assert.equal(documentTarget.documentElement.dataset.shellHostCursor, 'hidden');
canvas.dispatch('pointermove', { clientX: 600, clientY: 450, movementX: -200, movementY: -200 });
assert.equal(pointerMoves.at(-1).captured, false);
assert.equal(pointerMoves.at(-1).x, 480);
assert.equal(pointerMoves.at(-1).y, 360);
pointerAction = 'none';
const beforeMenuClick = pointerLockRequests;
canvas.dispatch('pointerdown', { clientX: 400, clientY: 300, button: 0, pointerId: 2 });
canvas.dispatch('pointerup', { clientX: 400, clientY: 300, button: 0, pointerId: 2 });
assert.equal(shell.inputCaptured(), false, 'native menu actions without immediate intent must never capture');
assert.equal(pointerLockRequests, beforeMenuClick, 'a normal menu click must not request pointer lock');
flushFrame();
assert.equal(pointerLockRequests, beforeMenuClick, 'the fallback must not invent intent for a normal menu click');

nativeState = 'paused';
captureIntent = false;
pointerAction = 'none';
shell.setEngineState('paused');
assert.equal(documentTarget.documentElement.dataset.shellHostCursor, 'hidden');
const beforePausedClick = pointerLockRequests;
canvas.dispatch('pointerdown', { clientX: 400, clientY: 300, button: 0, pointerId: 3 });
canvas.dispatch('pointerup', { clientX: 400, clientY: 300, button: 0, pointerId: 3 });
assert.equal(shell.inputCaptured(), false, 'an ordinary paused-menu click must not capture');
assert.equal(pointerLockRequests, beforePausedClick);
flushFrame();

captureIntent = true;
const beforeStaleIntent = pointerLockRequests;
canvas.dispatch('pointerdown', { clientX: 400, clientY: 300, button: 0, pointerId: 4 });
canvas.dispatch('pointerup', { clientX: 400, clientY: 300, button: 0, pointerId: 4 });
assert.equal(shell.inputCaptured(), false, 'stale paused-state intent must not become trusted for a later click');
assert.equal(pointerLockRequests, beforeStaleIntent);
flushFrame();

captureIntent = false;
pointerAction = 'sync-intent-only';
canvas.dispatch('pointerdown', { clientX: 400, clientY: 300, button: 0, pointerId: 5 });
canvas.dispatch('pointerup', { clientX: 400, clientY: 300, button: 0, pointerId: 5 });
assert.equal(shell.engineState(), 'paused', 'queued native Resume may honestly remain paused inside pointerButton');
assert.equal(shell.inputCaptured(), true, 'a rising event-scoped Resume intent must capture inside its trusted callback');
captureIntent = false;
shell.setEngineState('paused');
assert.equal(shell.inputCaptured(), false, 'a failed or cancelled Resume can release while authoritative state remains paused');
flushFrame();

captureIntent = false;
pointerAction = 'down-intent';
const beforeDownEdge = pointerLockRequests;
canvas.dispatch('pointerdown', { clientX: 400, clientY: 300, button: 0, pointerId: 6 });
assert.equal(shell.inputCaptured(), false, 'a pointerdown intent edge waits for its matching pointerup');
canvas.dispatch('pointerup', { clientX: 400, clientY: 300, button: 0, pointerId: 6 });
assert.equal(shell.inputCaptured(), true, 'intent raised on pointerdown captures on the matching pointerup gesture');
assert.equal(pointerLockRequests, beforeDownEdge + 1);
captureIntent = false;
shell.setEngineState('paused');
flushFrame();

pointerAction = 'none';
const beforeBetweenEvents = pointerLockRequests;
canvas.dispatch('pointerdown', { clientX: 400, clientY: 300, button: 0, pointerId: 11 });
captureIntent = true; // Native/SDL processing may run on a frame between DOM events.
canvas.dispatch('pointerup', { clientX: 400, clientY: 300, button: 0, pointerId: 11 });
assert.equal(shell.inputCaptured(), true, 'intent raised between matching down/up events remains part of that trusted gesture');
assert.equal(pointerLockRequests, beforeBetweenEvents + 1);
captureIntent = false;
shell.setEngineState('paused');
flushFrame();

captureIntent = false;
pointerAction = 'down-intent';
const beforeMismatchedPointer = pointerLockRequests;
canvas.dispatch('pointerdown', { clientX: 400, clientY: 300, button: 0, pointerId: 7 });
canvas.dispatch('pointerup', { clientX: 400, clientY: 300, button: 0, pointerId: 8 });
assert.equal(shell.inputCaptured(), false, 'a different pointer cannot consume a tracked intent gesture');
assert.equal(pointerLockRequests, beforeMismatchedPointer);
canvas.dispatch('pointercancel', { pointerId: 7, button: 0 });
canvas.dispatch('pointerup', { clientX: 400, clientY: 300, button: 0, pointerId: 7 });
assert.equal(pointerLockRequests, beforeMismatchedPointer, 'cancelled intent cannot be reused by a later pointerup');

captureIntent = false;
const beforeMismatchedButton = pointerLockRequests;
canvas.dispatch('pointerdown', { clientX: 400, clientY: 300, button: 0, pointerId: 9 });
canvas.dispatch('pointerup', { clientX: 400, clientY: 300, button: 1, pointerId: 9 });
assert.equal(shell.inputCaptured(), false, 'a different button cannot consume a tracked intent gesture');
assert.equal(pointerLockRequests, beforeMismatchedButton);
canvas.dispatch('pointerup', { clientX: 400, clientY: 300, button: 0, pointerId: 9 });
assert.equal(pointerLockRequests, beforeMismatchedButton, 'button mismatch clears the stale gesture');
captureIntent = false;

pointerAction = 'sync-intent-only';
const beforeUntrackedUp = pointerLockRequests;
canvas.dispatch('pointerup', { clientX: 400, clientY: 300, button: 0, pointerId: 12 });
assert.equal(shell.inputCaptured(), false, 'an untracked pointerup cannot authorize event-scoped capture');
assert.equal(pointerLockRequests, beforeUntrackedUp);
captureIntent = false;

pointerAction = 'delayed';
nativeState = 'menu';
shell.setEngineState('menu');
const beforeDelayed = pointerLockRequests;
canvas.dispatch('pointerdown', { clientX: 400, clientY: 300, button: 0, pointerId: 10 });
canvas.dispatch('pointerup', { clientX: 400, clientY: 300, button: 0, pointerId: 10 });
assert.equal(shell.inputCaptured(), false);
assert.equal(pointerLockRequests, beforeDelayed, 'intent unavailable inside dispatch must not request capture synchronously');
flushFrame();
assert.equal(shell.engineState(), 'loading', 'the rAF fallback still observes delayed native state');
assert.equal(shell.inputCaptured(), false, 'delayed-only intent cannot bypass the trusted activation requirement');
assert.equal(pointerLockRequests, beforeDelayed + 1, 'the fallback still attempts compatibility capture');
assert.equal(pointerLockDenied, 1, 'the test browser rejects pointer lock outside the dispatch activation window');
captureIntent = false;
nativeState = 'menu';
shell.setEngineState('menu');

const beforeFullscreen = resizes.length;
windowTarget.innerWidth = 1920;
windowTarget.innerHeight = 1080;
documentTarget.dispatch('fullscreenchange');
flushFrame();
windowTarget.innerWidth = 1030;
windowTarget.innerHeight = 710;
flushFrame();
flushFrame();
assert.ok(resizes.length >= beforeFullscreen + 3, 'fullscreen changes must sample more than the first viewport frame');
assert.equal(resizes.at(-1).requestedWidth, 1030);
assert.equal(resizes.at(-1).requestedHeight, 710);

nativeState = 'debrief';
shell.setEngineState('debrief');
assert.equal(documentTarget.documentElement.dataset.shellHostCursor, 'hidden',
  'the backward-compatible native menu cursor policy also covers debrief UI');

shell.destroy();

nativeState = 'menu';
captureIntent = false;
documentTarget.pointerLockElement = null;
const browserPointerMoves = [];
const browserPointerButtons = [];
const browserCursorShell = framework.configure({
  launcher: node(), card: node(), loading: node(), runtime: node(), canvas,
  desktopNotice: false,
  pointerLock: true, menuCursor: 'browser', engineState: 'menu',
  readEngineState: () => nativeState,
  onPointerMove: detail => browserPointerMoves.push(detail),
  onPointerButton: detail => browserPointerButtons.push(detail),
  onCaptureLost: () => { nativeState = 'menu'; browserCursorShell.setEngineState('menu'); }
});

assert.equal(browserCursorShell.config.menuCursor, 'browser');
assert.equal(documentTarget.documentElement.dataset.shellMenuCursor, 'browser');
for (const state of ['menu', 'loading', 'paused', 'debrief']) {
  nativeState = state;
  browserCursorShell.setEngineState(state);
  assert.equal(documentTarget.documentElement.dataset.shellHostCursor, 'visible',
    `menuCursor=browser must show the browser pointer in ${state}`);
}

nativeState = 'menu';
browserCursorShell.setEngineState('menu');
canvas.dispatch('pointermove', { clientX: 515, clientY: 355, movementX: 40, movementY: 30 });
canvas.dispatch('pointerdown', { clientX: 515, clientY: 355, button: 0, pointerId: 20 });
canvas.dispatch('pointerup', { clientX: 515, clientY: 355, button: 0, pointerId: 20 });
assert.equal(browserPointerMoves.length, 1, 'browser-cursor menus still deliver pointerMove');
assert.equal(browserPointerMoves[0].captured, false);
assert.equal('x' in browserPointerMoves[0], true);
assert.equal(browserPointerButtons.length, 2, 'browser-cursor menus still deliver pointerButton down/up');
flushFrame();

nativeState = 'gameplay';
browserCursorShell.setEngineState('gameplay');
assert.equal(documentTarget.documentElement.dataset.shellHostCursor, 'visible',
  'uncaptured gameplay leaves a visible pointer that can initiate capture');
canvas.dispatch('pointerdown', { clientX: 400, clientY: 300, button: 0 });
assert.equal(browserCursorShell.inputCaptured(), true);
assert.equal(documentTarget.documentElement.dataset.shellHostCursor, 'hidden',
  'captured gameplay always hides the browser pointer');
canvas.dispatch('pointermove', { clientX: 515, clientY: 355, movementX: 6, movementY: -11 });
assert.equal(browserPointerMoves.at(-1).captured, true);
assert.equal(browserPointerMoves.at(-1).movementX, 6);
assert.equal(browserPointerMoves.at(-1).movementY, -11);
assert.equal('x' in browserPointerMoves.at(-1), false);
documentTarget.pointerLockElement = null;
documentTarget.dispatch('pointerlockchange');
assert.equal(browserCursorShell.engineState(), 'menu');
assert.equal(documentTarget.documentElement.dataset.shellHostCursor, 'visible',
  'capture loss restores the browser pointer when the native runtime opens a cursorless menu');

assert.equal(browserCursorShell.setMenuCursor('native'), 'native');
assert.equal(browserCursorShell.config.menuCursor, 'native');
assert.equal(documentTarget.documentElement.dataset.shellHostCursor, 'hidden');
browserCursorShell.setMenuCursor('none');
const priorMoves = browserPointerMoves.length;
canvas.dispatch('pointermove', { clientX: 515, clientY: 355 });
assert.equal(browserPointerMoves.length, priorMoves, 'dynamic none policy suppresses menu movement');
browserCursorShell.setMenuCursor('browser');
assert.equal(documentTarget.documentElement.dataset.shellHostCursor, 'visible');
canvas.dispatch('pointermove', { clientX: 515, clientY: 355 });
assert.equal(browserPointerMoves.length, priorMoves + 1, 'dynamic browser policy restores menu movement');
assert.throws(() => browserCursorShell.setMenuCursor('crosshair'), /menuCursor/);
assert.equal(browserCursorShell.config.menuCursor, 'browser', 'invalid policy does not mutate the current mode');
nativeState = 'gameplay';
browserCursorShell.setEngineState('gameplay');
canvas.dispatch('pointerdown', { clientX: 400, clientY: 300, button: 0 });
browserCursorShell.setMenuCursor('browser');
assert.equal(documentTarget.documentElement.dataset.shellHostCursor, 'hidden', 'capture still hides a dynamically selected browser cursor');
documentTarget.pointerLockElement = null;
documentTarget.dispatch('pointerlockchange');
assert.equal(documentTarget.documentElement.dataset.shellHostCursor, 'visible');
browserCursorShell.destroy();

nativeState = 'menu';
documentTarget.pointerLockElement = null;
const nonePointerMoves = [];
const nonePointerButtons = [];
const noMenuCursorShell = framework.configure({
  launcher: node(), card: node(), loading: node(), runtime: node(), canvas,
  desktopNotice: false,
  pointerLock: true, menuCursor: 'none', engineState: 'menu',
  readEngineState: () => nativeState,
  onPointerMove: detail => nonePointerMoves.push(detail),
  onPointerButton: detail => nonePointerButtons.push(detail),
  onCaptureLost: () => { nativeState = 'menu'; noMenuCursorShell.setEngineState('menu'); }
});

assert.equal(noMenuCursorShell.config.menuCursor, 'none');
assert.equal(documentTarget.documentElement.dataset.shellMenuCursor, 'none');
let pointerId = 30;
for (const state of ['menu', 'loading', 'paused', 'debrief']) {
  nativeState = state;
  noMenuCursorShell.setEngineState(state);
  assert.equal(documentTarget.documentElement.dataset.shellHostCursor, 'hidden',
    `menuCursor=none must hide the host pointer in ${state}`);
  canvas.dispatch('pointermove', { clientX: 400, clientY: 300, movementX: 9, movementY: 4 });
  canvas.dispatch('pointerdown', { clientX: 400, clientY: 300, button: 0, pointerId });
  canvas.dispatch('pointerup', { clientX: 400, clientY: 300, button: 0, pointerId });
  pointerId += 1;
  flushFrame();
}
assert.equal(nonePointerMoves.length, 0, 'menuCursor=none suppresses released menu pointerMove callbacks');
assert.equal(nonePointerButtons.length, 0, 'menuCursor=none suppresses released menu pointerButton callbacks');

nativeState = 'gameplay';
noMenuCursorShell.setEngineState('gameplay');
canvas.dispatch('pointerdown', { clientX: 400, clientY: 300, button: 0 });
assert.equal(noMenuCursorShell.inputCaptured(), true);
canvas.dispatch('pointermove', { clientX: 0, clientY: 0, movementX: -14, movementY: 3 });
assert.equal(nonePointerMoves.length, 1, 'menuCursor=none must not suppress captured gameplay movement');
assert.equal(nonePointerMoves[0].captured, true);
assert.equal(nonePointerMoves[0].movementX, -14);
assert.equal(nonePointerMoves[0].movementY, 3);
assert.equal('x' in nonePointerMoves[0], false);
documentTarget.pointerLockElement = null;
documentTarget.dispatch('pointerlockchange');
assert.equal(noMenuCursorShell.engineState(), 'menu');
assert.equal(documentTarget.documentElement.dataset.shellHostCursor, 'hidden');

noMenuCursorShell.destroy();

async function testPendingCapture() {
  documentTarget.pointerLockElement = null;
  const asyncShell = framework.configure({
    launcher: node(), card: node(), loading: node(), runtime: node(), canvas,
    desktopNotice: false, pointerLock: true, engineState: 'menu'
  });
  asyncShell.setEngineState('gameplay');
  const requests = [];
  canvas.requestPointerLock = () => new Promise((resolve, reject) => requests.push({ resolve, reject }));
  canvas.dispatch('pointerdown', { clientX: 400, clientY: 300, button: 0, pointerId: 40 });
  canvas.dispatch('pointerup', { clientX: 400, clientY: 300, button: 0, pointerId: 40 });
  asyncShell.setEngineState('gameplay', { capture: true });
  flushFrame();
  assert.equal(requests.length, 1,
    'down, up, native-state publication and next-frame fallback must share one pending browser request');
  assert.equal(asyncShell.inputCaptured(), false, 'a pending request is not capture');
  assert.equal(documentTarget.documentElement.dataset.shellCaptureStatus, 'pending');
  assert.deepEqual(JSON.parse(documentTarget.documentElement.dataset.shellCaptureContext), {
    event: 'pointerdown', trusted: false, connected: false, sameDocument: false,
    visibility: null, focused: null, activation: null
  });
  documentTarget.dispatch('pointerlockchange');
  assert.equal(asyncShell.requestInputCapture(), false);
  assert.equal(requests.length, 1, 'a false lock-change event must not clear a pending Promise');
  requests[0].reject(new Error('WrongDocumentError'));
  await Promise.resolve();
  assert.equal(documentTarget.documentElement.dataset.shellCaptureStatus, 'denied');
  assert.equal(documentTarget.documentElement.dataset.shellCaptureError, 'Error: WrongDocumentError');
  documentTarget.dispatch('pointerlockerror');
  assert.equal(documentTarget.documentElement.dataset.shellCaptureError, 'Error: WrongDocumentError',
    'the later error event preserves the Promise rejection detail');
  assert.equal(asyncShell.requestInputCapture(), true, 'a rejected request must allow another interaction');
  assert.equal(requests.length, 2);
  documentTarget.pointerLockElement = canvas;
  documentTarget.dispatch('pointerlockchange');
  assert.equal(asyncShell.inputCaptured(), true);
  assert.equal(documentTarget.documentElement.dataset.shellCaptureStatus, 'captured');
  documentTarget.exitPointerLock();
  assert.equal(asyncShell.requestInputCapture(), true, 'real capture loss permits a new request');
  assert.equal(requests.length, 3);
  requests[1].resolve();
  await Promise.resolve();
  assert.equal(documentTarget.documentElement.dataset.shellCaptureStatus, 'pending', 'stale settlement cannot overwrite a newer diagnostic');
  asyncShell.requestInputCapture();
  assert.equal(requests.length, 3, 'late settlement of the old request cannot clear a newer request');
  requests[2].reject(new Error('NotAllowedError'));
  await Promise.resolve();

  let legacyRequests = 0;
  canvas.requestPointerLock = () => { legacyRequests += 1; };
  assert.equal(asyncShell.requestInputCapture(), true);
  assert.equal(asyncShell.requestInputCapture(), false);
  assert.equal(legacyRequests, 1, 'legacy undefined-return requests also remain pending');
  documentTarget.dispatch('pointerlockerror');
  assert.equal(asyncShell.requestInputCapture(), true, 'legacy error events permit retry');
  documentTarget.pointerLockElement = canvas;
  documentTarget.dispatch('pointerlockchange');
  documentTarget.exitPointerLock();
  assert.equal(asyncShell.requestInputCapture(), true, 'legacy success and release permit retry');
  documentTarget.dispatch('pointerlockerror');

  let throws = 0;
  canvas.requestPointerLock = () => { throws += 1; throw new Error('NotAllowedError'); };
  assert.equal(asyncShell.requestInputCapture(), false);
  assert.equal(asyncShell.requestInputCapture(), false);
  assert.equal(throws, 2, 'synchronous rejection must not leave a pending request');
  assert.equal(documentTarget.documentElement.dataset.shellCaptureError, 'Error: NotAllowedError');
  canvas.requestPointerLock = undefined;
  assert.equal(asyncShell.requestInputCapture(), false, 'missing browser support is not a request');
  canvas.requestPointerLock = () => Promise.resolve();
  assert.equal(asyncShell.requestInputCapture(), true);
  await Promise.resolve();
  assert.equal(asyncShell.requestInputCapture(), true, 'settled Promise must not leave a permanent pending request');
  asyncShell.destroy();
  await Promise.resolve();
  assert.equal((documentTarget.listeners.get('pointerlockerror') || []).length, 0,
    'destroy removes the legacy request error listener');
}

testPendingCapture().then(() => {
  console.log('runtime state, cursor policy, capture intent, async request coalescing/retry, release, and fullscreen resize tests passed');
}).catch(error => { console.error(error); process.exitCode = 1; });
