'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(process.env.WASM_CONSOLE_BOOTSTRAP_SOURCE ||
  path.join(__dirname, '../dist/wasm-game-bootstrap.js'), 'utf8');
const start = source.includes("  let pendingConsoleText = '';")
  ? source.indexOf("  let pendingConsoleText = '';") : source.indexOf('  function log(value) {');
const end = source.indexOf('\n  function context()', start);
assert.ok(start >= 0 && end > start, 'the test must execute the production bootstrap logger');

class TextNode {
  constructor(data) { this.data = data; }
  get length() { return this.data.length; }
  appendData(data) { this.data += data; }
  deleteData(offset, count) { this.data = this.data.slice(0, offset) + this.data.slice(offset + count); }
}

let intersectsConsole = false;
const selection = {
  isCollapsed: true, rangeCount: 1,
  getRangeAt() { return { intersectsNode(node) { assert.equal(node, output); return intersectsConsole; } }; }
};
const handlers = new Map();
const output = {
  children: [], replacements: 0, scrollWrites: 0, _scrollTop: 0, clientHeight: 48,
  get firstChild() { return this.children[0]; },
  get lastChild() { return this.children.at(-1); },
  get textContent() { return this.children.map(node => node.data).join(''); },
  set textContent(value) {
    this.replacements++;
    this.children = value ? [new TextNode(value)] : [];
    // Replacing a selected text node invalidates its original DOM range.
    if (intersectsConsole) selection.isCollapsed = true;
  },
  appendChild(node) { this.children.push(node); },
  removeChild(node) { this.children.splice(this.children.indexOf(node), 1); },
  get scrollHeight() { return Math.max(this.clientHeight, this.textContent.split('\n').length * 16); },
  get scrollTop() { return this._scrollTop; },
  set scrollTop(value) {
    this.scrollWrites++;
    this._scrollTop = Math.max(0, Math.min(value, this.scrollHeight - this.clientHeight));
  }
};
const sandbox = {
  elements: { console: output },
  document: {
    getSelection: () => selection,
    createTextNode: value => new TextNode(value),
    addEventListener(type, callback) { handlers.set(type, callback); }
  }
};
vm.runInNewContext(source.slice(start, end) + '\nglobalThis.appendLog = log;', sandbox);
const log = sandbox.appendLog;
const select = active => { selection.isCollapsed = !active; intersectsConsole = active; };

log('\x1b[31merror one\x1b[0m');
const first = output.firstChild;
log('<b>literal text</b>');
assert.equal(output.textContent, 'error one\n<b>literal text</b>\n');
assert.equal(output.firstChild, first, 'appending must not replace existing console text nodes');
assert.equal(output.replacements, 0);

for (let index = 0; index < 12; index++) log(`line ${index}`);
assert.equal(output.scrollTop, output.scrollHeight - output.clientHeight, 'a following console stays at the bottom');
output._scrollTop = 0;
const scrollWrites = output.scrollWrites;
log('read older messages');
assert.equal(output.scrollTop, 0, 'new output must not scroll a reader back to the bottom');
assert.equal(output.scrollWrites, scrollWrites);

select(true);
const selectedText = output.textContent;
const selectedNodes = output.children.slice();
log('pending while copying');
assert.equal(selection.isCollapsed, false);
assert.equal(output.textContent, selectedText, 'new output must not mutate the selected range');
assert.deepEqual(output.children, selectedNodes);
assert.equal(output.scrollWrites, scrollWrites);
select(false);
handlers.get('selectionchange')();
assert.ok(output.textContent.endsWith('pending while copying\n'), 'clearing selection flushes without waiting for another engine message');
assert.equal(output.scrollTop, 0);

selection.isCollapsed = false;
intersectsConsole = false;
log('selection elsewhere');
assert.ok(output.textContent.endsWith('selection elsewhere\n'), 'an unrelated selection must not freeze this console');

select(true);
const beforeFlood = output.textContent;
for (let index = 0; index < 200; index++) log(`flood-${index}:` + 'x'.repeat(1000));
assert.equal(output.textContent, beforeFlood, 'flooding must not evict selected text');
assert.equal(selection.isCollapsed, false);
select(false);
handlers.get('selectionchange')();
assert.ok(output.textContent.length <= 80000, 'display and pending history remain bounded');
assert.ok(output.textContent.includes('flood-199:'), 'retain the newest buffered output');
assert.ok(!output.textContent.includes('flood-0:'), 'discard the oldest pending overflow');

log('G'.repeat(100000));
assert.equal(output.textContent.length, 60000, 'a single oversized message must be bounded');
assert.ok(output.textContent.endsWith('G\n'));
for (let index = 0; index < 10000; index++) log('');
assert.ok(output.children.length < 30, 'empty-line floods must not allocate one DOM node per line');
assert.ok(output.textContent.length <= 80000);
assert.equal(output.replacements, 0, 'history trimming must not rewrite the whole console');

console.log('production console logger: stable text nodes, selection, reader scrolling, deferred flush and bounded history passed');
