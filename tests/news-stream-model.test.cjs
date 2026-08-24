'use strict';

/**
 * The stream's arithmetic, without a browser.
 *
 * Three sources go in and one ordered list comes out, which is the whole idea:
 * once everything carries a moment, nobody has to be told what the difference
 * between "New features" and "Latest update" was.
 *
 * Run with: node tests/news-stream-model.test.cjs
 */

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const store = new Map();
global.window = {};
global.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
};
new Function(fs.readFileSync(path.join(__dirname, '..', 'static', 'js', 'dashboard', 'dashboard-news-stream.js'), 'utf8'))();
const news = window.DashboardNewsStream;

const releases = [
    { tag: 'v1.3.2', releasedAt: '2026-08-21', date: '21 August 2026' },
    { tag: 'v1.3.1', releasedAt: '2026-08-20', date: '20 August 2026' },
    { tag: 'v1.3.0', releasedAt: '2026-08-19', date: '19 August 2026' },
    { tag: 'v1.2.1', releasedAt: '2026-08-17', date: '17 August 2026' },
    { tag: 'v1.2.0', releasedAt: '2026-08-16', date: '16 August 2026' },
    { tag: 'v1.1.0', releasedAt: '2026-08-15', date: '15 August 2026' },
    { tag: 'v1.0.0', releasedAt: '2026-08-13', date: '13 August 2026' },
];
const features = [
    { titleKey: 'a', titleFallback: 'Preview card', whatFallback: '…', since: 'v1.3.2', go: {} },
    { titleKey: 'b', titleFallback: 'Fresh', whatFallback: '…', since: 'v1.3.0', go: {} },
    { titleKey: 'c', titleFallback: 'Side rail', whatFallback: '…', go: {} },
];
const site = {
    enabled: true,
    items: [
        { title: 'Hover cards', url: 'https://nextdash.cc/a/', summary: 'x', publishedAt: Date.UTC(2026, 7, 21, 14) },
        { title: 'Older post', url: 'https://nextdash.cc/b/', summary: 'y', publishedAt: Date.UTC(2026, 7, 18, 9) },
    ],
};

const stream = news.buildStream({ site, releases, features });

// Newest first, whatever the source.
const times = stream.map((i) => i.at);
assert.deepStrictEqual(times, [...times].sort((a, b) => b - a), 'the stream is not in date order');
assert.strictEqual(stream[0].title, 'Hover cards');

// The release index holds every release ever shipped; a stream of tags is a
// changelog, not news, so only the recent ones join it.
const releaseRows = stream.filter((i) => i.source === 'release');
assert.strictEqual(releaseRows.length, 5, `expected five releases, got ${releaseRows.length}`);

// A feature belongs to the release it landed in — both for its place in the
// order and for whether it is recent enough to be news at all.
const featureRows = stream.filter((i) => i.source === 'feature');
assert.deepStrictEqual(featureRows.map((i) => i.titleKey), ['a'],
    'only features from the current releases belong in the stream');
assert.strictEqual(featureRows[0].at, Date.parse('2026-08-21T12:00:00Z'));

// Undated features — the back catalogue imported in one go — stay out.
assert.ok(!stream.some((i) => i.titleKey === 'c'), 'an undated feature reached the stream');

// A first visit stamps "now": everything ever published counting as unread
// would put a badge of 156 on Overview and teach the reader to ignore it.
const seenAt = news.readSeenAt();
assert.ok(seenAt > 0, 'the first visit should stamp a moment');
assert.strictEqual(news.unreadCount(stream, seenAt), 0, 'a first visit should be quiet');

// And then it counts what arrived since.
const later = [...stream, { source: 'site', title: 'Brand new', at: Date.now() + 60_000 }];
assert.strictEqual(news.unreadCount(later, seenAt), 1);

console.log('ok  the news stream orders three sources and counts what is new');
