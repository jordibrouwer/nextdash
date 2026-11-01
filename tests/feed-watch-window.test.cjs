'use strict';

/**
 * How long the news modal stays "open for you" after news arrives.
 *
 * The window starts when the tab is visible, not when the entry was published or
 * found: news that lands while the tab is in the background has not been seen
 * yet. A reload inside the window keeps the same start; newer news restarts it.
 *
 * Run with: node tests/feed-watch-window.test.cjs
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const context = { window: {} };
vm.createContext(context);
vm.runInContext(
    fs.readFileSync(path.join(__dirname, '..', 'static', 'js', 'dashboard', 'feed-watch-window.js'), 'utf8'),
    context
);
const { next } = context.window.FeedWatchWindow;
const WINDOW = 30 * 60 * 1000;

// starts only when visible
{
    const hidden = next(null, { newestNewAt: 1000, now: 5000, visible: false, windowMs: WINDOW });
    assert.strictEqual(hidden.phase, 'pending');
    assert.strictEqual(hidden.stored.startedAt, 0);
    const shown = next(hidden.stored, { newestNewAt: 1000, now: 7_205_000, visible: true, windowMs: WINDOW });
    assert.strictEqual(shown.phase, 'open');
    assert.strictEqual(shown.stored.startedAt, 7_205_000);
    assert.strictEqual(shown.remainingMs, WINDOW);
}

// closes after the window
{
    const stored = { newestNewAt: 1000, startedAt: 1 };
    assert.strictEqual(next(stored, { newestNewAt: 1000, now: 1 + WINDOW, visible: true, windowMs: WINDOW }).phase, 'closed');
    const last = next(stored, { newestNewAt: 1000, now: WINDOW, visible: true, windowMs: WINDOW });
    assert.strictEqual(last.phase, 'open');
    assert.strictEqual(last.remainingMs, 1);
}

// survives a reload inside the window
{
    const stored = { newestNewAt: 1000, startedAt: 50_000 };
    const again = next(stored, { newestNewAt: 1000, now: 50_000 + 10 * 60 * 1000, visible: true, windowMs: WINDOW });
    assert.strictEqual(again.phase, 'open');
    assert.strictEqual(again.stored.startedAt, 50_000);
}

// newer news restarts it, even after it closed
{
    const closed = { newestNewAt: 1000, startedAt: 1 };
    const restarted = next(closed, { newestNewAt: 2000, now: 99_000_000, visible: true, windowMs: WINDOW });
    assert.strictEqual(restarted.phase, 'open');
    assert.strictEqual(restarted.stored.startedAt, 99_000_000);
    assert.strictEqual(restarted.stored.newestNewAt, 2000);
}

// reading one of several sites does not restart or revive the window
{
    // A had news at 10:00 and B at 11:00; the window (started when B arrived) is over.
    const closed = { newestNewAt: 11_000, startedAt: 1 };
    const afterReadingB = next(closed, { newestNewAt: 10_000, now: 1 + WINDOW + 5000, visible: true, windowMs: WINDOW });
    assert.strictEqual(afterReadingB.phase, 'closed');
    assert.strictEqual(afterReadingB.stored.startedAt, 1);
    assert.strictEqual(afterReadingB.stored.newestNewAt, 11_000);
    // Inside the window it simply keeps running.
    const open = next({ newestNewAt: 11_000, startedAt: 50_000 }, { newestNewAt: 10_000, now: 60_000, visible: true, windowMs: WINDOW });
    assert.strictEqual(open.phase, 'open');
    assert.strictEqual(open.stored.startedAt, 50_000);
}

// no news
{
    const none = next({ newestNewAt: 1000, startedAt: 5 }, { newestNewAt: 0, now: 10, visible: true, windowMs: WINDOW });
    assert.strictEqual(none.phase, 'none');
    assert.strictEqual(next(null, { newestNewAt: 0, now: 10, visible: true, windowMs: WINDOW }).stored, null);
}

console.log('feed-watch-window: ok');
