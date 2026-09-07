'use strict';

function normalizeBasePath(value) {
  const input = String(value || '/');
  if (input === '/') return input;
  if (!/^\/(?:[a-zA-Z0-9_-]+\/)*[a-zA-Z0-9_-]+\/?$/.test(input)) {
    throw new Error('WASM_GAME_BASE_PATH must be an absolute path of safe URL segments.');
  }
  return input.endsWith('/') ? input : `${input}/`;
}

function publicPath(value, base) {
  const prefix = normalizeBasePath(base);
  const input = String(value || '');
  // Absolute external URLs and data/blob resources are not deployment paths.
  if (/^[a-z][a-z0-9+.-]*:/i.test(input) || input.startsWith('//')) return input;
  const target = new URL(prefix !== '/' && input.startsWith(prefix) ? input : input.replace(/^\//, ''), `https://game.invalid${prefix}`);
  if (!target.pathname.startsWith(prefix)) throw new Error('A public asset URL escapes its game base path.');
  return target.pathname + target.search + target.hash;
}

function publicDocument(html, base) {
  const prefix = normalizeBasePath(base);
  // Only HTML resource attributes are URLs. Never rewrite native FS strings in JS.
  return html.replace(/\b(src|href)="\/(?!\/)([^"]*)"/g,
    (_, attribute, value) => `${attribute}="${publicPath(value, prefix)}"`)
    .replace('<head>', `<head>\n  <base href="${prefix}">`);
}

module.exports = { normalizeBasePath, publicPath, publicDocument };
