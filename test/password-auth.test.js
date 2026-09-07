'use strict';

const assert = require('node:assert/strict');
const http = require('node:http');
const { createPasswordGate, passwordOptions } = require('../server/password-auth');
const { createPasswordClient } = require('../dist/wasm-game-framework');

assert.deepEqual(passwordOptions({
  WASM_GAME_PASSWORD: 'secret',
  WASM_GAME_PASSWORD_TTL: '2h',
  WASM_GAME_TRUST_PROXY: 'true'
}), { password: 'secret', cookiePath: '/', ttlMs: 7200000, trustProxy: true, secret: null });
assert.equal(typeof createPasswordClient, 'function');

function start(gate) {
  const server = http.createServer(async (request, response) => {
    const url = new URL(request.url, 'http://localhost');
    if (await gate.handle(request, response, url)) return;
    if (url.pathname === '/protected') {
      if (!gate.require(request, response)) return;
      response.writeHead(204);
      return response.end();
    }
    response.writeHead(404);
    response.end();
  });
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server)));
}

(async () => {
  const openGate = createPasswordGate({ password: '' });
  assert.equal(openGate.required, false);
  assert.equal(openGate.authenticated({ headers: {} }), true);

  const sharedSecret = Buffer.alloc(32, 7);
  const gate = createPasswordGate({
    password: 'correct horse battery staple',
    secret: sharedSecret,
    maximumFailures: 3
  });
  const server = await start(gate);
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    let response = await fetch(`${base}/auth/status`);
    assert.deepEqual(await response.json(), { required: true, authenticated: false });

    response = await fetch(`${base}/protected`);
    assert.equal(response.status, 401);
    assert.doesNotMatch(await response.text(), /correct horse/);

    response = await fetch(`${base}/auth/login`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: 'wrong' })
    });
    assert.equal(response.status, 401);
    assert.doesNotMatch(await response.text(), /correct horse/);

    response = await fetch(`${base}/auth/login`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: 'correct horse battery staple' })
    });
    assert.equal(response.status, 200);
    const cookie = response.headers.get('set-cookie');
    assert.match(cookie, /^wasm_game_session=/);
    assert.match(cookie, /HttpOnly/);
    assert.match(cookie, /SameSite=Strict/);
    assert.doesNotMatch(cookie, /correct horse/);
    const cookieHeader = cookie.split(';')[0];

    response = await fetch(`${base}/protected`, { headers: { cookie: cookieHeader } });
    assert.equal(response.status, 204);
    const siblingGate = createPasswordGate({
      password: 'correct horse battery staple',
      secret: sharedSecret
    });
    assert.equal(siblingGate.authenticated({ headers: { cookie: cookieHeader } }), true,
      'a static server and game supervisor must accept the same signed session');
    const unrelatedGate = createPasswordGate({
      password: 'correct horse battery staple',
      secret: Buffer.alloc(32, 8)
    });
    assert.equal(unrelatedGate.authenticated({ headers: { cookie: cookieHeader } }), false);
    const tamperedCookie = `${cookieHeader.slice(0, -1)}${cookieHeader.endsWith('a') ? 'b' : 'a'}`;
    response = await fetch(`${base}/protected`, { headers: { cookie: tamperedCookie } });
    assert.equal(response.status, 401);

    response = await fetch(`${base}/auth/logout`, { method: 'POST', headers: { cookie: cookieHeader } });
    assert.equal(response.status, 200);
    assert.match(response.headers.get('set-cookie'), /Max-Age=0/);

    response = await fetch(`${base}/auth/login`, {
      method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://example.invalid' },
      body: JSON.stringify({ password: 'correct horse battery staple' })
    });
    assert.equal(response.status, 403);

    const client = createPasswordClient({
      statusUrl: `${base}/auth/status`, loginUrl: `${base}/auth/login`, logoutUrl: `${base}/auth/logout`
    });
    assert.deepEqual(await client.status(), { required: true, authenticated: false });
    await assert.rejects(client.login('wrong'), error => error.statusCode === 401 && /Incorrect/.test(error.message));
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
  console.log('password session and browser-client tests passed');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
