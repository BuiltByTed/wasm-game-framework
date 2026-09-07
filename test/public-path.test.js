'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const vm = require('node:vm');
const { spawn } = require('node:child_process');
const { normalizeBasePath, publicPath, publicDocument } = require('../server/public-path');
const framework = require('../dist/wasm-game-framework');

test('public paths are validated, idempotent and independent of native virtual-FS paths', () => {
  assert.equal(normalizeBasePath('/doom2'), '/doom2/');
  for (const value of ['https://bad', '//bad/', '/x/../y/', '/x%2f/', '/x?y', '/x; Path=/']) assert.throws(() => normalizeBasePath(value));
  const before = globalThis.WASM_GAME_BASE_PATH;
  globalThis.WASM_GAME_BASE_PATH = '/doom2/';
  try {
    for (const [value, expected] of [['/engine.wasm', '/doom2/engine.wasm'], ['engine.wasm', '/doom2/engine.wasm'], ['/doom2/engine.wasm', '/doom2/engine.wasm'], ['/ws?variant=doom2', '/doom2/ws?variant=doom2'], ['https://cdn.test/game.wasm', 'https://cdn.test/game.wasm'], ['blob:engine', 'blob:engine']]) {
      assert.equal(publicPath(value, '/doom2/'), expected); assert.equal(framework.publicUrl(value), expected);
    }
    for (const value of ['../wrong', '/doom2/../../wrong', '/doom2/%2e%2e/wrong']) {
      assert.throws(() => publicPath(value, '/doom2/')); assert.throws(() => framework.publicUrl(value));
    }
    const html = '<head><script src="/game.js"></script><script>const save="/persistent/doom";</script><link href="data:,"></head>';
    const rendered = publicDocument(html, '/doom2/');
    assert.match(rendered, /<base href="\/doom2\/">/); assert.match(rendered, /src="\/doom2\/game.js"/);
    assert.match(rendered, /save="\/persistent\/doom"/); assert.match(rendered, /href="data:,"/);
  } finally { globalThis.WASM_GAME_BASE_PATH = before; }
});

test('real server behind a stripped-prefix proxy scopes documents, variants, auth, data and PWA caches', async t => {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'wasm-public-path-'));
  t.after(() => fs.rm(temporary, { recursive: true, force: true }));
  const site = path.join(temporary, 'site'); const data = path.join(temporary, 'data');
  await fs.mkdir(site); await fs.mkdir(data);
  const game = { id: 'suite', defaultVariant: 'alpha', variants: { alpha: { title: 'Alpha', icon: '/icon.svg' }, beta: { title: 'Beta', icon: '/icon.svg', pwa: { id: '/apps/beta', scope: '/', startUrl: '/' } } } };
  await fs.writeFile(path.join(site, 'wasm-game.json'), JSON.stringify(game));
  await fs.writeFile(path.join(site, 'icon.svg'), '<svg/>');
  await fs.writeFile(path.join(site, 'game-adapter.js'), 'globalThis.WasmGameAdapter = {};');
  await fs.writeFile(path.join(site, 'wasm-game-data.json'), JSON.stringify({ namespace: 'prefix-fixture', version: '1', variants: {
    alpha: { files: [{ key: 'pak', name: 'alpha.pak', path: 'alpha.pak', size: 9, magic: 'PACK' }] },
    beta: { files: [{ key: 'pak', name: 'beta.pak', path: 'beta.pak', size: 8, magic: 'PACK' }] }
  } }));
  await fs.writeFile(path.join(data, 'alpha.pak'), 'PACKalpha'); await fs.writeFile(path.join(data, 'beta.pak'), 'PACKbeta');
  const child = spawn(process.execPath, [path.join(__dirname, '../server/static-server.js')], { env: {
    ...process.env, WASM_GAME_SITE_ROOT: site, WASM_GAME_SHELL_ROOT: path.join(__dirname, '../dist'),
    WASM_GAME_DATA_ROOT: data, WASM_GAME_HTTP_PORT: '0', WASM_GAME_VARIANT: 'beta', WASM_GAME_MEDIA: '',
    WASM_GAME_BASE_PATH: '/doom2/', WASM_GAME_PASSWORD: 'test-password', WASM_SETUP_TOKEN: '',
  }, stdio: ['ignore', 'pipe', 'pipe'] });
  t.after(async () => {
    if (child.exitCode === null) await new Promise(resolve => { child.once('exit', resolve); child.kill(); });
  });
  let stderr = ''; child.stderr.on('data', bytes => { stderr += bytes; });
  const port = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Fixture did not start: ' + stderr)), 5000);
    child.once('exit', code => { clearTimeout(timeout); reject(new Error('Fixture exited: ' + code + ' ' + stderr)); });
    child.stdout.on('data', bytes => { const match = String(bytes).match(/tcp\/(\d+)/); if (match) { clearTimeout(timeout); resolve(Number(match[1])); } });
  });
  const proxy = http.createServer((request, response) => {
    if (!request.url.startsWith('/doom2/')) { response.writeHead(404); response.end(); return; }
    const upstream = http.request({ hostname: '127.0.0.1', port, path: request.url.slice('/doom2'.length), method: request.method, headers: request.headers }, result => {
      response.writeHead(result.statusCode, result.headers); result.pipe(response);
    });
    upstream.on('error', () => { response.writeHead(502); response.end(); }); request.pipe(upstream);
  });
  await new Promise(resolve => proxy.listen(0, '127.0.0.1', resolve));
  t.after(async () => { proxy.closeAllConnections(); await new Promise(resolve => proxy.close(resolve)); });
  const base = `http://127.0.0.1:${proxy.address().port}`;
  const request = (resource, options) => fetch(base + '/doom2/' + resource, options);
  const html = await request('').then(response => response.text());
  for (const attribute of [...html.matchAll(/(?:src|href)="([^"]+)"/g)].map(match => match[1]).filter(value => value.startsWith('/'))) {
    assert.ok(attribute.startsWith('/doom2/'), attribute);
    assert.equal((await fetch(base + attribute)).status, 200, attribute);
  }
  const config = await request('wasm-game-config.js?game=alpha').then(response => response.text());
  assert.match(config, /WASM_GAME_VARIANT = "beta"/); assert.match(config, /WASM_GAME_BASE_PATH = "\/doom2\/"/);
  const manifest = await request('app.webmanifest?variant=alpha').then(response => response.json());
  assert.equal(manifest.name, 'Beta'); assert.equal(manifest.scope, '/doom2/'); assert.equal(manifest.start_url, '/doom2/');
  assert.equal(manifest.id, '/doom2/apps/beta'); assert.equal(manifest.icons[0].src, '/doom2/icon.svg');
  assert.equal((await request('favicon.ico', { redirect: 'manual' })).headers.get('location'), '/doom2/icon.svg');
  assert.equal((await request('game-data/status')).status, 401);
  const login = await request('auth/login', { method: 'POST', headers: { 'content-type': 'application/json', origin: base }, body: JSON.stringify({ password: 'test-password' }) });
  assert.equal(login.status, 200);
  const cookie = login.headers.get('set-cookie'); assert.match(cookie, /Path=\/doom2\//);
  const authenticated = { headers: { cookie: cookie.split(';')[0] } };
  const status = await request('game-data/status?variant=alpha', authenticated).then(response => response.json());
  assert.equal(status.variant, 'beta'); assert.equal(status.ready, true);
  assert.equal(await request('game-data/files/pak?variant=alpha', authenticated).then(response => response.text()), 'PACKbeta');
  assert.equal((await request('data/beta.pak', authenticated)).status, 404);
  const worker = await request('service-worker.js'); assert.equal(worker.headers.get('service-worker-allowed'), '/doom2/');
  const source = await worker.text(); assert.match(source, /\/doom2\/shared-shell\//);
  const callbacks = {}; const deleted = [];
  vm.runInNewContext(source, { self: { addEventListener: (name, fn) => { callbacks[name] = fn; }, clients: { claim() {} } }, caches: {
    keys: async () => ['wasm-game-shell-old:%2Fdoom1%2F', 'wasm-game-shell-old:%2Fdoom2%2F', 'unrelated-cache'],
    delete: async key => { deleted.push(key); },
  } });
  let activation; callbacks.activate({ waitUntil: promise => { activation = promise; } }); await activation;
  assert.deepEqual(deleted, ['wasm-game-shell-old:%2Fdoom2%2F'], 'one game never deletes another game or desktop cache');
});
