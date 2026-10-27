'use strict';

/**
 * Two promises about how much the analytics script says.
 *
 * Umami counts every history.pushState/replaceState as a pageview, so each
 * in-app view change (#config, #inbox, #1) became one and bounce rate read
 * 0.8%. The tracker is told not to, and the page load is reported once.
 *
 * And a loop must not be able to flood: an identical event within 500 ms is
 * dropped, as is anything past 100 events in a rolling minute, except the
 * snapshots.
 *
 * Run with: node tests/analytics-pageview-rate.test.cjs
 */

const fs = require('fs');
const path = require('path');
const assert = require('assert');

function load(extraAttrs = {}) {
    const src = fs.readFileSync(
        path.join(__dirname, '..', 'static', 'js', 'umami-analytics.js'), 'utf8');
    const sent = [];
    const attrs = {};
    const listeners = {};
    global.window = {
        umami: { track: (name, props) => sent.push([name, props]) },
        location: { pathname: '/config', hash: '#inbox', search: '?q=secret' },
        addEventListener() {},
    };
    global.document = {
        currentScript: {
            getAttribute: (attr) => ({
                'data-nextdash-analytics': 'on',
                'data-website-id': 'test',
                'data-analytics-src': 'https://stats.example/script.js',
                ...extraAttrs,
            })[attr] || '',
        },
        querySelector: () => null,
        createElement: () => ({
            addEventListener(type, fn) { listeners[type] = fn; },
            setAttribute(k, v) { attrs[k] = v; },
        }),
        head: { appendChild() {} },
    };
    new Function(src)();
    return { window: global.window, sent, attrs, flush: () => listeners.load?.() };
}

// Pageviews: auto-tracking off, one explicit pageview with the path only.
{
    const { sent, attrs, flush, window: w } = load();
    assert.strictEqual(attrs['data-auto-track'], 'false');
    flush();
    assert.strictEqual(sent.length, 1);
    const [fn, props] = sent[0];
    assert.strictEqual(typeof fn, 'function');
    assert.strictEqual(props, undefined);
    assert.deepStrictEqual(fn({ website: 'x', url: '/config#inbox?q=secret', title: 'secret' }),
        { website: 'x', url: '/config', title: 'secret' });
    w.nextdashTrack('view:inbox');
    assert.strictEqual(sent.length, 2);
}

// The demo keeps its hook.
{
    const { attrs } = load({ 'data-mode': 'demo' });
    assert.strictEqual(attrs['data-before-send'], 'nextdashDemoBeforeSend');
    assert.strictEqual(attrs['data-auto-track'], 'false');
}

// Rate limit, driven with a fake clock.
{
    const { window: w } = load();
    const allow = w.nextdashRateLimit();

    // Same name and props inside 500 ms: dropped; different props or later: kept.
    assert.strictEqual(allow('view:inbox', { a: 1 }, 1000), true);
    assert.strictEqual(allow('view:inbox', { a: 1 }, 1400), false);
    assert.strictEqual(allow('view:inbox', { a: 2 }, 1450), true);
    assert.strictEqual(allow('view:inbox', { a: 2 }, 1950), true);

    // 100 per rolling minute, then silence, then room again as the window moves.
    const cap = w.nextdashRateLimit();
    let ok = 0;
    for (let i = 0; i < 150; i += 1) if (cap(`e${i}`, undefined, 10000 + i)) ok += 1;
    assert.strictEqual(ok, 100);
    assert.strictEqual(cap('late', undefined, 10000 + 59999), false);
    assert.strictEqual(cap('later', undefined, 10000 + 60100), true);

    // Snapshots are never capped.
    const snap = w.nextdashRateLimit();
    for (let i = 0; i < 100; i += 1) snap(`e${i}`, undefined, 5000);
    assert.strictEqual(snap('x', undefined, 5000), false);
    assert.strictEqual(snap('settings-snapshot', { a: 1 }, 5001), true);
    assert.strictEqual(snap('content-snapshot', { a: 1 }, 5002), true);
}

// And through nextdashTrack itself: a tight loop reaches Umami once.
{
    const { window: w, sent, flush } = load();
    flush();
    sent.length = 0;
    for (let i = 0; i < 50; i += 1) w.nextdashTrack('loop', { n: 1 });
    assert.strictEqual(sent.length, 1);
}

console.log('ok  one pageview per load, and a loop cannot flood');
