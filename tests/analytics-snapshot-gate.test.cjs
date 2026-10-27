'use strict';

/**
 * How often the snapshots go out, and the three small events beside them.
 *
 * A snapshot per page load was 55% of every event and 700,000 stored
 * properties in a hundred days. Now one goes out when it has something new to
 * say: a changed payload, a new month, or a week since the last. The
 * deciding is done in the browser from what it remembered, so it is tested
 * here against a fake storage rather than a running server.
 *
 * Run with: node tests/analytics-snapshot-gate.test.cjs
 */

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'static', 'js', 'umami-analytics.js'), 'utf8');
const DAY = 24 * 60 * 60 * 1000;

/** A fresh tracker over a shared fake storage; `ready` fires the tracker's load event. */
function boot({ storage = {}, release = 'v1.19.8', content = '', demo = false, now = Date.parse('2026-10-10T10:00:00Z') } = {}) {
    const sent = [];
    const listeners = {};
    const windowListeners = {};
    const realNow = Date.now;
    Date.now = () => now;
    const identified = [];
    global.window = {
        umami: { track: (name, props) => sent.push([name, props]), identify: (id) => identified.push(id) },
        localStorage: {
            getItem: (key) => (key in storage ? storage[key] : null),
            setItem: (key, value) => { storage[key] = String(value); },
        },
        addEventListener: (type, fn) => { windowListeners[type] = fn; },
        location: { origin: 'http://nextdash.test', hash: '#config/appearance', href: 'http://nextdash.test/' },
    };
    global.document = {
        currentScript: {
            getAttribute: (attr) => ({
                'data-nextdash-analytics': 'on',
                'data-website-id': 'test',
                'data-analytics-src': 'https://stats.example/script.js',
                'data-release': release,
                'data-content': content,
                'data-install': 'a1b2c3d4e5f60718',
                'data-distribution': 'docker',
                'data-mode': demo ? 'demo' : '',
            })[attr] || '',
        },
        querySelector: () => null,
        createElement: () => ({
            addEventListener(type, fn) { listeners[type] = fn; },
            setAttribute() {},
        }),
        head: { appendChild() {} },
    };
    // eslint-disable-next-line no-new-func
    new Function(SRC)();
    const api = {
        sent,
        identified,
        storage,
        win: global.window,
        ready: () => listeners.load && listeners.load(),
        fail: () => listeners.error && listeners.error(),
        fire: (type, event) => windowListeners[type] && windowListeners[type](event),
        // The tracker's own pageview is a function-named call; only events count here.
        names: () => sent.map(([name]) => name).filter((name) => typeof name === 'string'),
        done: () => { Date.now = realNow; },
    };
    return api;
}

function settingsSnapshot(app, settings) {
    app.win.nextdashTrackSettings._sent = false;
    app.win.nextdashTrackSettings(settings);
}

// 1. The same payload is not sent twice, a changed one is.
{
    const storage = {};
    const first = boot({ storage });
    first.ready();
    settingsSnapshot(first, { theme: 'moss-stone-dark' });
    assert.deepStrictEqual(first.names(), ['settings-snapshot'], 'first load sends');
    first.done();

    const second = boot({ storage });
    second.ready();
    settingsSnapshot(second, { theme: 'moss-stone-dark' });
    assert.deepStrictEqual(second.names(), [], 'unchanged payload stays quiet on the next load');
    settingsSnapshot(second, { theme: 'steel-dawn-dark' });
    assert.deepStrictEqual(second.names(), ['settings-snapshot'], 'a changed payload goes out');
    second.done();
}

// 2. A week later, or a new calendar month, it goes out again unchanged.
{
    const storage = {};
    const a = boot({ storage, now: Date.parse('2026-10-10T10:00:00Z') });
    a.ready();
    settingsSnapshot(a, { theme: 'x' });
    a.done();

    const sameWeek = boot({ storage, now: Date.parse('2026-10-14T10:00:00Z') });
    sameWeek.ready();
    settingsSnapshot(sameWeek, { theme: 'x' });
    assert.deepStrictEqual(sameWeek.names(), [], 'four days later: quiet');
    sameWeek.done();

    const nextWeek = boot({ storage, now: Date.parse('2026-10-18T10:00:01Z') });
    nextWeek.ready();
    settingsSnapshot(nextWeek, { theme: 'x' });
    assert.deepStrictEqual(nextWeek.names(), ['settings-snapshot'], 'a week later: repeated');
    nextWeek.done();

    const other = {};
    const late = boot({ storage: other, now: Date.parse('2026-10-31T23:00:00Z') });
    late.ready();
    settingsSnapshot(late, { theme: 'x' });
    late.done();
    const newMonth = boot({ storage: other, now: Date.parse('2026-11-01T01:00:00Z') });
    newMonth.ready();
    settingsSnapshot(newMonth, { theme: 'x' });
    assert.deepStrictEqual(newMonth.names(), ['settings-snapshot'], 'a new month repeats it even two hours later');
    newMonth.done();
}

// 3. A new release always sends a full set, because the release is in the payload.
{
    const storage = {};
    const old = boot({ storage, release: 'v1.19.8' });
    old.ready();
    settingsSnapshot(old, { theme: 'x' });
    old.done();
    const updated = boot({ storage, release: 'v1.21.3' });
    updated.ready();
    settingsSnapshot(updated, { theme: 'x' });
    assert.deepStrictEqual(updated.names(), ['app-updated', 'settings-snapshot']);
    assert.deepStrictEqual(updated.sent.find(([n]) => n === 'app-updated')[1], { from: 'v1.19', to: 'v1.21' });
    updated.done();
}

// 4. A tracker that never loaded did not send anything, so nothing is remembered.
{
    const storage = {};
    const blocked = boot({ storage });
    settingsSnapshot(blocked, { theme: 'x' });
    blocked.fail();
    blocked.done();
    const retry = boot({ storage });
    retry.ready();
    settingsSnapshot(retry, { theme: 'x' });
    assert.deepStrictEqual(retry.names(), ['settings-snapshot'], 'sent after a failed attempt');
    retry.done();
}

// 5. Nothing is stored and nothing is sent in the demo.
{
    const storage = {};
    const demo = boot({ storage, demo: true });
    demo.ready();
    settingsSnapshot(demo, { theme: 'x' });
    assert.deepStrictEqual(demo.names(), []);
    assert.deepStrictEqual(Object.keys(storage), [], 'the demo writes nothing to storage');
    demo.done();
}

// 6. The first bookmark of a small install is timed once, as a band.
{
    const storage = {};
    const app = boot({ storage, content: JSON.stringify({ bookmarks: 0 }) });
    app.ready();
    app.win.nextdashTrack('bookmark-created', { result: 'invalid' });
    app.win.nextdashTrack('bookmark-created', { result: 'ok', source: 'new-modal' });
    app.win.nextdashTrack('bookmark-created', { result: 'ok', source: 'new-modal' });
    assert.deepStrictEqual(app.names().filter((n) => n === 'first-bookmark').length, 1, 'once');
    assert.deepStrictEqual(app.sent.find(([n]) => n === 'first-bookmark')[1], { after: '10m' });
    app.done();

    const big = boot({ storage: {}, content: JSON.stringify({ bookmarks: 300 }) });
    big.ready();
    big.win.nextdashTrack('bookmark-created', { result: 'ok' });
    assert.deepStrictEqual(big.names().includes('first-bookmark'), false, 'an existing library is not timed');
    big.done();
}

// 6b. A new install starts with example links, far past ten bookmarks, so the
// server says it is new: that install is timed too. Without the flag it is not.
{
    const fresh = boot({ storage: {}, content: JSON.stringify({ bookmarks: 99, fresh: true }) });
    fresh.ready();
    fresh.win.nextdashTrack('bookmark-created', { result: 'ok', source: 'new-modal' });
    assert.deepStrictEqual(fresh.names().filter((n) => n === 'first-bookmark').length, 1, 'a new install with example links is timed');
    fresh.done();

    const old = boot({ storage: {}, content: JSON.stringify({ bookmarks: 99, fresh: false }) });
    old.ready();
    old.win.nextdashTrack('bookmark-created', { result: 'ok' });
    assert.deepStrictEqual(old.names().includes('first-bookmark'), false, 'a settled library is not timed');
    old.done();
}

// 6c. The content snapshot carries the untagged share as a band, never a count.
{
    const band = (bookmarks, untagged) => {
        const app = boot({ storage: {}, content: JSON.stringify({ bookmarks, untagged }) });
        app.ready();
        app.win.nextdashTrackContent?.();
        const sent = app.sent.find(([n]) => n === 'content-snapshot');
        app.done();
        return sent && sent[1].untaggedShare;
    };
    assert.strictEqual(band(40, 0), 'none');
    assert.strictEqual(band(40, 10), 'quarter');
    assert.strictEqual(band(40, 20), 'half');
    assert.strictEqual(band(40, 30), 'most');
    assert.strictEqual(band(40, 39), 'nearly-all');
    assert.strictEqual(band(0, 0), 'unset');
}

// 7. An error is a fixed word and a view name; three per load at most.
{
    const app = boot({ storage: {} });
    app.ready();
    // Each from a different view: the same error twice within half a second is
    // dropped as a duplicate before it ever gets to the cap.
    const views = ['config', 'inbox', 'health', 'docker', 'bookmarks', 'library'];
    views.forEach((view) => {
        app.win.location.hash = `#${view}`;
        app.fire('error', { filename: 'http://nextdash.test/static/js/x.js', message: 'secret https://x.test' });
    });
    const errors = app.sent.filter(([n]) => n === 'app-error');
    assert.strictEqual(errors.length, 3, 'capped');
    assert.deepStrictEqual(errors[0][1], { kind: 'error', view: 'config' });
    app.fire('error', { filename: 'chrome-extension://abc/inject.js' });
    assert.strictEqual(app.sent.filter(([n]) => n === 'app-error').length, 3, 'foreign scripts are ignored');
    assert.ok(!JSON.stringify(app.sent).includes('secret'), 'the message never leaves');
    app.done();
}

// 8. The settings snapshot says which install it is and how it is reached;
// the hostname Umami would record is replaced by one word.
{
    const app = boot({ storage: {} });
    app.win.location.hostname = 'dash.example.org';
    app.ready();
    settingsSnapshot(app, { theme: 'x' });
    const props = app.sent.find(([n]) => n === 'settings-snapshot')[1];
    assert.strictEqual(props.installId, 'a1b2c3d4e5f60718');
    assert.strictEqual(props.distribution, 'docker');
    assert.strictEqual(props.exposure, 'domain');
    assert.ok(!JSON.stringify(props).includes('example.org'), 'the hostname itself never goes out');

    const exposure = app.win.nextdashHostExposure;
    for (const [host, word] of [
        ['localhost', 'localhost'], ['127.0.0.1', 'localhost'], ['[::1]', 'localhost'],
        ['192.168.50.34', 'lan'], ['10.0.0.100', 'lan'], ['172.20.1.5', 'lan'], ['172.32.1.5', 'domain'],
        ['nas', 'lan'], ['tower.local', 'lan'], ['start.potterus.com', 'domain'], ['8.8.8.8', 'domain'],
    ]) assert.strictEqual(exposure(host), word, host);

    const out = app.win.nextdashBeforeSend('event', {
        hostname: '192.168.50.34', referrer: 'https://auth.example.org/login', title: 'My private page', url: '/', screen: '2560x1440',
    });
    assert.deepStrictEqual(out, { hostname: 'lan', referrer: '', title: 'nextDash', url: '/', screen: '2560x1440' });
    app.done();

    const demo = boot({ storage: {}, demo: true });
    assert.strictEqual(demo.win.nextdashBeforeSend, undefined, 'the demo keeps its own hook');
    demo.done();
}

// 9. The install code is Umami's identity for the visitor, so its sessions
// stay together past the monthly session id; once, only once the tracker is
// there, and never in the demo.
{
    const app = boot({ storage: {} });
    assert.deepStrictEqual(app.identified, [], 'nothing before the tracker has loaded');
    app.ready();
    assert.deepStrictEqual(app.identified, ['a1b2c3d4e5f60718']);
    app.done();

    const demo = boot({ storage: {}, demo: true });
    demo.ready();
    assert.deepStrictEqual(demo.identified, [], 'the demo has no identity');
    demo.done();
}

console.log('ok  snapshots are gated, and the small events are bands and fixed words');
