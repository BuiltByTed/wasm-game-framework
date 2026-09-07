'use strict';

const { normalizeBasePath, publicPath } = require('./public-path');

// Shared by the generic server and game-owned HTTP hosts. Inputs describe the
// selected game; no process-global deployment state or HTTP server is started.
function createPwaManifest({ selected = {}, locked = true, media = '', url, basePath = '/' }) {
  basePath = normalizeBasePath(basePath);
  const pwa = selected.pwa && typeof selected.pwa === 'object' ? selected.pwa : {};
  const title = String(pwa.name || selected.title || 'WASM Game');
  const shortName = String(pwa.shortName || title).slice(0, 30);
  const selectedKey = String(selected.id || '').toLowerCase();
  const selectedMedia = media || (/^[a-f0-9]{32}$/i.test(String(url.searchParams.get('media') || '')) ?
    String(url.searchParams.get('media')).toLowerCase() : '');
  const startParams = new URLSearchParams();
  if (!locked && selectedKey) startParams.set('game', selectedKey);
  if (selectedMedia) startParams.set('media', selectedMedia);
  const defaultStartUrl = startParams.size ? `/?${startParams}` : '/';
  const startUrl = publicPath(pwa.startUrl || defaultStartUrl, basePath);
  const fallbackIcon = selected.icon ? [{ src: String(selected.icon), sizes: 'any' }] : [];
  const icons = Array.isArray(pwa.icons) && pwa.icons.length ? pwa.icons : fallbackIcon;
  return {
    id: publicPath(pwa.id || startUrl, basePath),
    name: title,
    short_name: shortName,
    description: String(pwa.description || selected.description || ''),
    start_url: startUrl,
    scope: publicPath(pwa.scope || '/', basePath),
    display: String(pwa.display || 'standalone'),
    background_color: String(pwa.backgroundColor || '#000000'),
    theme_color: String(pwa.themeColor || selected.theme?.accent || '#111827'),
    orientation: String(pwa.orientation || 'landscape'),
    icons: icons.map(icon => ({
      src: publicPath(icon.src, basePath),
      sizes: String(icon.sizes || 'any'),
      ...(icon.type ? { type: String(icon.type) } : {}),
      ...(icon.purpose ? { purpose: String(icon.purpose) } : {})
    }))
  };
}

function createServiceWorkerSource({ version, basePath = '/' }) {
  basePath = normalizeBasePath(basePath);
  if (!version) throw new Error('The framework service worker requires a version.');
  const scopeTag = `:${encodeURIComponent(basePath)}`;
  const cacheName = `wasm-game-shell-${version}${scopeTag}`;
  const shellPaths = ['/', '/shared-shell/wasm-game-framework.css', '/shared-shell/wasm-game-framework.js',
    '/shared-shell/wasm-game-bootstrap.js', '/wasm-game.json', '/game-adapter.js'].map(value => publicPath(value, basePath));
  return `'use strict';\n` +
    `const CACHE = ${JSON.stringify(cacheName)};\n` +
    `const SHELL = ${JSON.stringify(shellPaths)};\n` +
    `self.addEventListener('install', event => { event.waitUntil(caches.open(CACHE).then(cache => Promise.all(SHELL.map(path => fetch(path, { cache: 'no-cache' }).then(response => { if (response.ok) return cache.put(path, response); }).catch(() => undefined)))).then(() => self.skipWaiting())); });\n` +
    `self.addEventListener('activate', event => { event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('wasm-game-shell-') && key.endsWith(${JSON.stringify(scopeTag)}) && key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim())); });\n` +
    `self.addEventListener('fetch', event => { const url = new URL(event.request.url); if (event.request.method !== 'GET' || url.origin !== self.location.origin || !SHELL.includes(url.pathname)) return; event.respondWith(fetch(event.request).then(response => { if (response.ok) { const copy = response.clone(); caches.open(CACHE).then(cache => cache.put(url.pathname, copy)); } return response; }).catch(() => caches.match(url.pathname).then(response => response || Response.error()))); });\n`;
}

module.exports = { createPwaManifest, createServiceWorkerSource };
