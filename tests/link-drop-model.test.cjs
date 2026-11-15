'use strict';
/**
 * The links in a drop, without a browser.
 *
 * Run with: node tests/link-drop-model.test.cjs
 */
const fs = require('fs');
const path = require('path');
const assert = require('assert');

global.window = {};
new Function(fs.readFileSync(path.join(__dirname, '..', 'static', 'js', 'shared', 'link-drop-model.js'), 'utf8'))();
const M = window.LinkDropModel;
const transfer = (data) => ({ getData: (type) => data[type] || '' });

// uri-list: comments skipped, order kept, duplicates dropped, only http(s)
assert.deepStrictEqual(
    M.linksFromTransfer(transfer({ 'text/uri-list': '# from a tab\r\nhttps://a.example/x\r\nftp://nope.example/\r\nhttps://b.example\r\nhttps://a.example/x' })),
    [{ url: 'https://a.example/x', title: '' }, { url: 'https://b.example', title: '' }],
);

// the anchor text of a dragged link becomes the title
assert.deepStrictEqual(
    M.linksFromTransfer(transfer({
        'text/uri-list': 'https://a.example/x?a=1&b=2',
        'text/html': '<a href="https://a.example/x?a=1&amp;b=2"><span>Great</span> page</a>',
    })),
    [{ url: 'https://a.example/x?a=1&b=2', title: 'Great page' }],
);

// Firefox: address and title on alternate lines
assert.deepStrictEqual(
    M.linksFromTransfer(transfer({ 'text/x-moz-url': 'https://a.example/\nA title\nhttps://b.example/\nB title' })),
    [{ url: 'https://a.example/', title: 'A title' }, { url: 'https://b.example/', title: 'B title' }],
);

// plain text: a link per line, a bare host only when it is the whole drop
assert.deepStrictEqual(M.linksFromTransfer(transfer({ 'text/plain': 'https://a.example' })), [{ url: 'https://a.example', title: '' }]);
assert.deepStrictEqual(M.linksFromTransfer(transfer({ 'text/plain': 'github.com/x/y' })), [{ url: 'https://github.com/x/y', title: '' }]);
assert.deepStrictEqual(M.linksFromTransfer(transfer({ 'text/plain': 'see github.com/x/y' })), []);
assert.deepStrictEqual(M.linksFromTransfer(transfer({ 'text/plain': 'github.com\nhttps://a.example' })), [{ url: 'https://a.example', title: '' }]);
assert.deepStrictEqual(M.linksFromTransfer(transfer({ 'text/plain': 'e.g.' })), []);
assert.deepStrictEqual(M.linksFromTransfer(transfer({ 'text/plain': '' })), []);
assert.deepStrictEqual(M.linksFromTransfer(null), []);

// what a dragover may judge by: the types alone
assert.strictEqual(M.mayCarryLink(['text/uri-list', 'text/plain']), true);
assert.strictEqual(M.mayCarryLink(['text/plain']), true);
assert.strictEqual(M.mayCarryLink(['Files']), false);
assert.strictEqual(M.mayCarryLink(['Files', 'text/plain']), false);
assert.strictEqual(M.mayCarryLink([]), false);

// entities in a title are decoded, in the address too
assert.deepStrictEqual(
    M.linksFromTransfer(transfer({
        'text/uri-list': 'https://a.example/?x=1&y=2',
        'text/html': '<a href="https://a.example/?x=1&amp;y=2">A &lt;b&gt; &#39;q&#39; &quot;z&quot; &#x41;</a>',
    })),
    [{ url: 'https://a.example/?x=1&y=2', title: 'A <b> \'q\' "z" A' }],
);

// a big text drop is read once, not once per line
const big = Array.from({ length: 20000 }, (_, i) => `line ${i}`).join('\n');
let reads = 0;
M.linksFromTransfer({ getData: (type) => { reads += 1; return type === 'text/plain' ? big : ''; } });
assert.ok(reads <= 5, `getData called ${reads} times`);

// a long list stops somewhere
const many = Array.from({ length: 80 }, (_, i) => `https://h${i}.example`).join('\n');
assert.strictEqual(M.linksFromTransfer(transfer({ 'text/uri-list': many })).length, 50);

console.log('link-drop-model: ok');
