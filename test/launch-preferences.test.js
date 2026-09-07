'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { readLaunchPreferences, createPreferences } = require('../dist/wasm-game-framework');

const config = { profiles: [{ value: 'classic' }, { value: 'modernized' }], fpsTargets: [60, 120], controller: { mode: 'wasdMouse' } };
test('URL options are allowlisted, bounded, and scoped to the selected variant', () => {
  const search = '?wgGame=blood&wgProfile=modernized&wgFps=120&wgPlayer=Caleb%00&wgFullscreen=0&wgDynamicQuality=1&wgController=auto';
  assert.deepEqual(readLaunchPreferences(config, search, 'blood'), { qualityProfile: 'modernized', targetFps: 120, playerName: 'Caleb', fullscreen: false, dynamicQuality: true, controller: 'auto' });
  assert.deepEqual(readLaunchPreferences(config, search, 'duke3d'), {});
  assert.deepEqual(readLaunchPreferences(config, '?wgProfile=modernized', 'blood'), {});
  assert.deepEqual(readLaunchPreferences(config, '?wgGame=blood&wgProfile=exec%20evil.cfg&wgFps=999999999&wgFullscreen=false&wgController=device:bad', 'blood'), {});
  assert.equal(readLaunchPreferences(config, '?wgGame=blood&wgPlayer=' + 'x'.repeat(100), 'blood').playerName.length, 32);
  const disabled = { ...config, graphics: false, identity: false, fullscreen: false, controller: { mode: 'disabled' } };
  assert.deepEqual(readLaunchPreferences(disabled, search, 'blood'), {});
  assert.deepEqual(readLaunchPreferences({ ...config, advanced: false }, search, 'blood'), { qualityProfile: 'modernized', playerName: 'Caleb', fullscreen: false, controller: 'auto' });
});

test('per-variant preferences migrate legacy storage; URL overrides win before adapter initialization', () => {
  const previousStorage = globalThis.localStorage;
  const previousDocument = globalThis.document;
  const storage = new Map([['wasm-game-preferences:build-family', JSON.stringify({ qualityProfile: 'modernized', targetFps: 999, fullscreen: 'false' })]]);
  globalThis.localStorage = { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value) };
  globalThis.document = { querySelector: () => null };
  const field = (value, choices) => ({ nodeType: 1, value, checked: false, addEventListener() {}, options: choices && choices.map(value => ({ value: String(value) })) });
  const create = (variant, overrides) => createPreferences({
    namespace: `build-family.${variant}`, legacyNamespace: 'build-family', overrides,
    qualityProfile: field('classic', ['classic', 'modernized']), targetFps: field('60', [60, 120]),
    fullscreen: field(''), defaults: { qualityProfile: 'classic', targetFps: 60, fullscreen: false },
  });
  try {
    const blood = create('blood', { qualityProfile: 'classic', targetFps: 120 });
    const duke = create('duke3d', {});
    assert.equal(blood.values().qualityProfile, 'classic');
    assert.equal(blood.values().targetFps, 120);
    assert.equal(duke.values().qualityProfile, 'modernized');
    assert.equal(duke.values().targetFps, 60, 'invalid persisted select falls back to valid defaults');
    assert.equal(duke.values().fullscreen, false);
    blood.save(); duke.save();
    assert.notEqual(storage.get(blood.storageKey), storage.get(duke.storageKey));
    assert.equal(blood.values().qualityProfile, 'classic', 'another game cannot change this launch');
    assert.ok(storage.has('wasm-game-preferences:build-family'), 'legacy data is preserved');
  } finally { globalThis.localStorage = previousStorage; globalThis.document = previousDocument; }
});
