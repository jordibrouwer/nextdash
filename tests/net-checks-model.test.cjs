'use strict';

/**
 * The network checks' rules, without a browser: badge states, names, the
 * form's live explanation, the failure blocks and the form's validation.
 *
 * Run with: node tests/net-checks-model.test.cjs
 */

const path = require('path');
const assert = require('assert');

const M = require(path.join(__dirname, '..', 'static', 'js', 'shared', 'net-checks-model.js'));
const t = (key, fallback) => fallback;
const bm = { url: 'https://cloud.example.org/login', monitorIntervalMinutes: 30 };
const caps = { typesBuilt: ['tcp', 'ping'], allowCustomHost: false, icmp: 'unknown', pingMode: 'auto', notifyRetries: 3 };

// Type names are not translated
assert.strictEqual(M.typeName('tcp'), 'TCP');
assert.strictEqual(M.typeName('json'), 'JSON');

// badgeState: off, unknown, down, warn, slow, ok -- in that order of importance
assert.strictEqual(M.badgeState({ enabled: false, state: { ok: true } }), 'off');
assert.strictEqual(M.badgeState({ enabled: true }), 'unknown');
assert.strictEqual(M.badgeState({ enabled: true, state: { ok: false, slow: true } }), 'down');
assert.strictEqual(M.badgeState({ enabled: true, state: { ok: true, warn: true, slow: true } }), 'warn');
assert.strictEqual(M.badgeState({ enabled: true, state: { ok: true, slow: true } }), 'slow');
assert.strictEqual(M.badgeState({ enabled: true, state: { ok: true } }), 'ok');

assert.strictEqual(M.stateLabel('down', t), 'Down');
assert.strictEqual(M.stateLabel('off', t), 'Not scheduled');
assert.strictEqual(M.stateLabel('whatever', t), 'No result yet');

// labelFor: own label, else type and port
assert.strictEqual(M.labelFor({ type: 'ping' }, bm), 'Ping');
assert.strictEqual(M.labelFor({ type: 'tcp', port: 8443 }, bm), 'TCP 8443');
assert.strictEqual(M.labelFor({ type: 'tcp' }, bm), 'TCP 443', 'the port comes from the address');
assert.strictEqual(M.labelFor({ type: 'tcp' }, { url: 'http://plex.lan:32400' }), 'TCP 32400');
assert.strictEqual(M.labelFor({ type: 'tcp', port: 22, label: 'SSH' }, bm), 'SSH');

// targetOf
assert.deepStrictEqual(M.targetOf({ type: 'tcp' }, bm), { host: 'cloud.example.org', port: 443 });
assert.deepStrictEqual(M.targetOf({ type: 'tcp', host: 'Other.Example.org', port: 22 }, bm), { host: 'other.example.org', port: 22 });
assert.strictEqual(M.targetOf({ type: 'ping' }, { url: 'http://[::1]:8080/x' }).host, '::1');

// explain
const tcp = M.explain({ type: 'tcp', enabled: true, port: 8443 }, bm, caps, t);
assert.ok(tcp.summary.includes('cloud.example.org') && tcp.summary.includes('8443'), tcp.summary);
assert.ok(tcp.lines.some((l) => l.includes('30 minutes')), 'the bookmark\'s interval is used: ' + tcp.lines);
assert.ok(tcp.lines.some((l) => l.includes('3 failed checks')));
assert.deepStrictEqual(tcp.warnings, []);
const own = M.explain({ type: 'tcp', enabled: true, intervalMinutes: 60 }, bm, caps, t);
assert.ok(own.lines.some((l) => l.includes('1 hour')));
const off = M.explain({ type: 'tcp', enabled: false }, bm, caps, t);
assert.ok(off.lines.some((l) => l.startsWith('Not scheduled')));
assert.ok(!off.lines.some((l) => l.startsWith('Every')));
const ping = M.explain({ type: 'ping', enabled: true, count: 6, maxLossPct: 25, maxMs: 150 }, bm, caps, t);
assert.ok(ping.summary.includes('6 packets'));
assert.ok(ping.lines.some((l) => l.includes('25%')));
assert.ok(ping.lines.some((l) => l.includes('150 ms')));
assert.strictEqual(ping.warnings.length, 0, 'no ICMP warning while ICMP is unknown');
assert.strictEqual(M.explain({ type: 'ping', enabled: true }, bm, { ...caps, icmp: 'blocked' }, t).warnings[0].kind, 'icmp');
assert.strictEqual(M.explain({ type: 'ping', enabled: true }, bm, { ...caps, pingMode: 'tcp-only' }, t).warnings[0].kind, 'icmp');
assert.strictEqual(M.explain({ type: 'tcp', enabled: true }, bm, { ...caps, icmp: 'blocked' }, t).warnings.length, 0, 'only ping warns about ICMP');
assert.ok(M.explain({ type: 'tcp', enabled: true, muted: true }, bm, caps, t).lines.some((l) => l.startsWith('Muted')));

// errorBlock: one block per class, with its one step
const icmp = M.errorBlock({ class: 'icmp', host: 'cloud.example.org' }, t);
assert.strictEqual(icmp.tone, 'warn');
assert.ok(icmp.snippet.includes('net.ipv4.ping_group_range'));
assert.deepStrictEqual(icmp.actions, ['copy']);
const guard = M.errorBlock({ class: 'guard', host: 'cloud.home.lan', ip: '192.168.1.20' }, t);
assert.strictEqual(guard.tone, 'err');
assert.ok(guard.body.includes('192.168.1.20') && guard.body.includes('cloud.home.lan'));
assert.deepStrictEqual(guard.actions, ['allowLocal']);
assert.ok(!M.errorBlock({ class: 'guard', host: 'h' }, t).body.includes('{'), 'no placeholder is left in the text');
assert.ok(M.errorBlock({ class: 'timeout', host: 'h', port: 8443, timeoutSec: 10 }, t).title.includes('10 s'));
assert.ok(M.errorBlock({ class: 'refused', host: 'h', port: 22 }, t).body.includes('22'));
assert.ok(M.errorBlock({ class: 'dns', host: 'cloud.exmaple.org' }, t).body.includes('cloud.exmaple.org'));
assert.strictEqual(M.errorBlock({ class: 'other' }, t), null);
assert.strictEqual(M.errorBlock(null, t), null);

// validate: a mirror of the server's limits
const ok = (c) => M.validate(c, caps, t);
assert.strictEqual(ok({ type: 'tcp', port: 443 }).ok, true);
assert.strictEqual(ok({ type: 'tcp', port: 443, intervalMinutes: 0, timeoutSec: 5 }).ok, true);
assert.ok(ok({ type: 'dns' }).errors.type, 'a type that is not built is refused');
assert.ok(ok({ type: 'tcp', port: 70000 }).errors.port);
assert.ok(ok({ type: 'tcp', port: -1 }).errors.port);
assert.ok(ok({ type: 'tcp', intervalMinutes: 4 }).errors.intervalMinutes);
assert.ok(ok({ type: 'tcp', intervalMinutes: 1441 }).errors.intervalMinutes);
assert.strictEqual(ok({ type: 'tcp', intervalMinutes: 5 }).ok, true);
assert.ok(ok({ type: 'tcp', timeoutSec: 11 }).errors.timeoutSec);
assert.ok(ok({ type: 'ping', count: 11 }).errors.count);
assert.ok(ok({ type: 'ping', maxLossPct: 101 }).errors.maxLossPct);
assert.ok(ok({ type: 'ping', maxMs: 60001 }).errors.maxMs);
assert.ok(ok({ type: 'tcp', label: 'x'.repeat(61) }).errors.label);
assert.ok(ok({ type: 'tcp', label: 'a\u0007b' }).errors.label);
assert.ok(ok({ type: 'tcp', host: 'other.example.org' }).errors.host, 'a custom host needs the setting');
const custom = { ...caps, allowCustomHost: true };
assert.strictEqual(M.validate({ type: 'tcp', host: 'other.example.org' }, custom, t).ok, true);
assert.ok(M.validate({ type: 'tcp', host: 'https://x.org' }, custom, t).errors.host);
assert.ok(M.validate({ type: 'tcp', host: 'x.org:22' }, custom, t).errors.host);
assert.strictEqual(M.validate({ type: 'tcp', host: '192.168.1.5' }, custom, t).ok, true);

// pickForType keeps only what the type uses
assert.deepStrictEqual(Object.keys(M.pickForType({ type: 'tcp', count: 6, port: 22, maxLossPct: 10 })).includes('count'), false);
assert.strictEqual(M.pickForType({ type: 'ping', count: 6, port: 22 }).port, undefined);
assert.strictEqual(M.pickForType({ type: 'ping', count: 6 }).count, 6);

// badgeSlice: scheduled checks only, three at most, the worst never hidden
const mk = (type, enabled, state) => ({ type, enabled, state });
assert.deepStrictEqual(M.badgeSlice([mk('tcp', false, { ok: true })], 3), { shown: [], more: [] }, 'an unscheduled check has no badge');
const four = [mk('tcp', true, { ok: true }), mk('ping', true, { ok: true }), mk('dns', true, { ok: true }), mk('tls', true, { ok: false })];
const sliced = M.badgeSlice(four, 3);
assert.strictEqual(sliced.shown.length, 3);
assert.strictEqual(sliced.more.length, 1);
assert.ok(sliced.shown.includes(four[3]), 'the failing check keeps its place');
assert.deepStrictEqual(sliced.shown.map((c) => c.type), ['tcp', 'ping', 'tls'], 'shown ones keep the order of the checks');
assert.strictEqual(M.badgeSlice(four.slice(0, 3), 3).more.length, 0);

// railKeys: any, one per type, down only for a scheduled failure
assert.deepStrictEqual(M.railKeys([]), []);
assert.deepStrictEqual(M.railKeys([mk('tcp', false, { ok: false })]), ['any', 'tcp'], 'a failure of an unscheduled check is not "down"');
assert.deepStrictEqual(M.railKeys([mk('tcp', true, { ok: true }), mk('tcp', true, { ok: false }), mk('ping', true, null)]), ['any', 'tcp', 'ping', 'down']);

console.log('net-checks-model: ok');
