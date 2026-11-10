/**
 * Network checks on a bookmark, without a browser: what a check is called,
 * which state its badge shows, what the form says it will do, what a failure
 * means, and whether a form is worth sending.
 *
 * Pure functions: the translator comes in as `t(key, fallback)` so the same
 * code runs in Node (tests/net-checks-model.test.cjs) and in the panel.
 * `validate` mirrors normalizeNetChecks (internal/app/nettool_validate.go) so
 * the form can say what is wrong before the server has to.
 *
 * Type names are not translated: TCP, Ping, DNS, TLS, HTTP and JSON are what
 * the tools are called everywhere.
 */
(function (global) {
    'use strict';

    const TYPES = ['tcp', 'ping', 'dns', 'tls', 'http', 'json'];
    const TYPE_NAMES = { tcp: 'TCP', ping: 'Ping', dns: 'DNS', tls: 'TLS', http: 'HTTP', json: 'JSON' };
    const MAX_CHECKS_PER_BOOKMARK = 6;
    const DEFAULT_INTERVAL_MINUTES = 15;
    const DEFAULT_PING_COUNT = 4;
    const DEFAULT_MAX_LOSS_PCT = 50;
    const INTERVAL_MIN = 5;
    const INTERVAL_MAX = 1440;

    function fmt(text, vars) {
        return String(text).replace(/\{(\w+)\}/g, (m, k) => (vars && vars[k] != null ? String(vars[k]) : m));
    }

    function typeName(type) {
        return TYPE_NAMES[type] || String(type || '').toUpperCase();
    }

    /** One line under a type tile (mockup b1). */
    function typeHint(type, t) {
        switch (type) {
        case 'tcp': return t('nettools.hintTcp', 'Is the port open?');
        case 'ping': return t('nettools.hintPing', 'Reachable, and how fast');
        case 'dns': return t('nettools.hintDns', 'Records, changes');
        case 'tls': return t('nettools.hintTls', 'Chain, expiry');
        case 'http': return t('nettools.hintHttp', 'Timeline, redirects');
        case 'json': return t('nettools.hintJson', 'A value in the answer');
        default: return '';
        }
    }

    function parseUrl(raw) {
        try {
            return new URL(String(raw || ''));
        } catch {
            return null;
        }
    }

    /** The host of a bookmark's address, lower case, without brackets or port. */
    function hostOf(bm) {
        const u = parseUrl(bm && bm.url);
        if (!u) return '';
        return u.hostname.replace(/^\[|\]$/g, '').toLowerCase();
    }

    /** The port in the address, else the scheme's own; 0 when neither is known. */
    function defaultPort(bm) {
        const u = parseUrl(bm && bm.url);
        if (!u) return 0;
        if (u.port) return Number(u.port);
        if (u.protocol === 'https:') return 443;
        if (u.protocol === 'http:') return 80;
        return 0;
    }

    function targetOf(check, bm) {
        const host = String((check && check.host) || '').trim().toLowerCase() || hostOf(bm);
        const port = Number(check && check.port) > 0 ? Number(check.port) : defaultPort(bm);
        return { host, port };
    }

    /** The name a check goes by: its own label, else its type (and port). */
    function labelFor(check, bm) {
        const own = String((check && check.label) || '').trim();
        if (own) return own;
        const name = typeName(check && check.type);
        if ((check.type === 'tcp' || check.type === 'tls')) {
            const port = targetOf(check, bm).port;
            if (port > 0) return `${name} ${port}`;
        }
        return name;
    }

    /**
     * What a check's badge shows: ok, slow, warn, down, unknown (enabled, no
     * result yet) or off (not scheduled). `state` is the newest sample.
     */
    function badgeState(check) {
        if (!check || check.enabled !== true) return 'off';
        const s = check.state;
        if (!s) return 'unknown';
        if (!s.ok) return 'down';
        if (s.warn) return 'warn';
        if (s.slow) return 'slow';
        return 'ok';
    }

    /** The badge state in words. */
    function stateLabel(state, t) {
        switch (state) {
        case 'ok': return t('nettools.stateOk', 'Up');
        case 'slow': return t('nettools.stateSlow', 'Slow');
        case 'warn': return t('nettools.stateWarn', 'Warning');
        case 'down': return t('nettools.stateDown', 'Down');
        case 'off': return t('nettools.stateOff', 'Not scheduled');
        default: return t('nettools.stateUnknown', 'No result yet');
        }
    }

    function intervalMinutes(check, bm) {
        const own = Number(check && check.intervalMinutes);
        if (own > 0) return own;
        return Number(bm && bm.monitorIntervalMinutes) || DEFAULT_INTERVAL_MINUTES;
    }

    /** "5 minutes", "1 hour", "1 day": the cadence in words. */
    function intervalWords(minutes, t) {
        const m = Number(minutes) || 0;
        if (m >= 1440 && m % 1440 === 0) {
            const d = m / 1440;
            return d === 1 ? t('nettools.oneDay', '1 day') : fmt(t('nettools.nDays', '{n} days'), { n: d });
        }
        if (m >= 60 && m % 60 === 0) {
            const h = m / 60;
            return h === 1 ? t('nettools.oneHour', '1 hour') : fmt(t('nettools.nHours', '{n} hours'), { n: h });
        }
        return fmt(t('nettools.nMinutes', '{n} minutes'), { n: m });
    }

    /**
     * The live explanation next to the form (mockup b2): one sentence on what
     * will happen, the rules as bullets, and warnings that need a decision.
     */
    function explain(check, bm, caps, t) {
        const c = check || {};
        const cap = caps || {};
        const { host, port } = targetOf(c, bm);
        const name = typeName(c.type);
        const lines = [];
        const warnings = [];
        let summary = '';
        const hostText = host || t('nettools.thisBookmark', 'this bookmark');
        const every = c.enabled === false
            ? ''
            : fmt(t('nettools.every', 'Every {interval}'), { interval: intervalWords(intervalMinutes(c, bm), t) });

        if (c.type === 'tcp') {
            summary = fmt(t('nettools.explainTcp', 'Opens a connection to {host} on port {port}.'), { host: hostText, port: port || '?' });
            lines.push(t('nettools.ruleTcpDown', 'Down when the connection is refused or gets no answer'));
            if (Number(c.maxMs) > 0) lines.push(fmt(t('nettools.ruleSlow', 'Slow above {ms} ms (still counts as up)'), { ms: c.maxMs }));
        } else if (c.type === 'ping') {
            const count = Number(c.count) > 0 ? Number(c.count) : DEFAULT_PING_COUNT;
            const loss = Number(c.maxLossPct) > 0 ? Number(c.maxLossPct) : DEFAULT_MAX_LOSS_PCT;
            summary = fmt(t('nettools.explainPing', 'Sends {count} packets to {host}.'), { count, host: hostText });
            lines.push(fmt(t('nettools.rulePingDown', 'Down at {pct}% loss or more, or no answer'), { pct: loss }));
            if (Number(c.maxMs) > 0) lines.push(fmt(t('nettools.ruleSlowAvg', 'Slow when the average is above {ms} ms'), { ms: c.maxMs }));
            if (cap.icmp === 'blocked' || cap.pingMode === 'tcp-only') {
                warnings.push({
                    kind: 'icmp',
                    title: t('nettools.icmpWarnTitle', 'ICMP is not used here'),
                    body: fmt(t('nettools.icmpWarnBody', 'This check falls back to a TCP connection on port {port} and says so.'), { port: port || 443 }),
                });
            }
        } else {
            summary = fmt(t('nettools.explainOther', 'Runs a {type} check on {host}.'), { type: name, host: hostText });
        }

        if (c.enabled === false) {
            lines.push(t('nettools.ruleOff', 'Not scheduled: it only runs when you test it'));
        } else {
            lines.push(every);
            lines.push(fmt(t('nettools.ruleAlert', 'Alerts after {n} failed checks (your setting), sends the recovery, follows maintenance windows'),
                { n: Number(cap.notifyRetries) > 0 ? Number(cap.notifyRetries) : 3 }));
        }
        if (c.muted) lines.push(t('nettools.ruleMuted', 'Muted: no alerts, the history is still kept'));
        return { summary, lines: lines.filter(Boolean), warnings };
    }

    /**
     * A failure as a block with one clear step (mockup g1). `result` is the
     * check's newest state plus the target: { class, host, port, ip,
     * timeoutSec }. Returns null for a class without a block of its own.
     * `actions` are ids the panel knows how to draw.
     */
    function errorBlock(result, t) {
        const r = result || {};
        const host = r.host || t('nettools.thisBookmark', 'this bookmark');
        switch (r.class) {
        case 'icmp':
            return {
                cls: 'icmp', tone: 'warn',
                title: t('nettools.errIcmpTitle', 'ICMP is not allowed here'),
                body: t('nettools.errIcmpBody', 'Ping cannot open a raw socket in this container. nextDash falls back to TCP and says so.'),
                snippet: 'services:\n  nextdash:\n    sysctls:\n      net.ipv4.ping_group_range: "0 2147483647"',
                note: t('nettools.errIcmpNote', 'Restart the container afterwards. With network_mode: host the setting belongs to the host: run sysctl -w net.ipv4.ping_group_range="0 2147483647" there. The NET_RAW capability does not help, nextDash runs as an unprivileged user.'),
                actions: ['copy'],
            };
        case 'guard':
            return {
                cls: 'guard', tone: 'err',
                title: t('nettools.errGuardTitle', 'Host blocked by the address guard'),
                body: r.ip
                    ? fmt(t('nettools.errGuardBodyIp', '{host} resolves to {ip}, a private address. nextDash does not test addresses on your own network unless you allow it.'), { host, ip: r.ip })
                    : fmt(t('nettools.errGuardBody', '{host} is a private address. nextDash does not test addresses on your own network unless you allow it.'), { host }),
                actions: ['allowLocal'],
            };
        case 'timeout':
            return {
                cls: 'timeout', tone: 'err',
                title: fmt(t('nettools.errTimeoutTitle', 'Time-out after {s} s'), { s: r.timeoutSec || 5 }),
                body: fmt(t('nettools.errTimeoutBody', 'Port {port} on {host} gave no answer. That can be a firewall dropping packets, or a service that is not listening.'),
                    { host, port: r.port || '?' }),
                actions: [],
            };
        case 'refused':
            return {
                cls: 'refused', tone: 'err',
                title: t('nettools.errRefusedTitle', 'Connection refused'),
                body: fmt(t('nettools.errRefusedBody', '{host} answered, but nothing listens on port {port}.'), { host, port: r.port || '?' }),
                actions: [],
            };
        case 'dns':
            return {
                cls: 'dns', tone: 'err',
                title: t('nettools.errDnsTitle', 'Name does not exist'),
                body: fmt(t('nettools.errDnsBody', 'No address found for {host}. A typo in the bookmark address?'), { host }),
                actions: [],
            };
        default:
            return null;
        }
    }

    function intOr(value, fallback) {
        if (value === '' || value == null) return fallback;
        const n = Number(value);
        return Number.isFinite(n) ? n : NaN;
    }

    const HOST_RE = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$/i;

    function validHost(host) {
        const h = String(host || '').trim();
        if (!h || h.length > 253) return false;
        if (/[/\s@?#]/.test(h)) return false;
        if (/^\[.*\]$/.test(h) || h.includes(':')) return /^[0-9a-f:.]+$/i.test(h.replace(/^\[|\]$/g, ''));
        return HOST_RE.test(h);
    }

    /**
     * Whether one check can be sent: { ok, errors } with a sentence per field
     * (host, port, label, interval, timeout, count, loss, maxMs, type).
     */
    function validate(check, caps, t) {
        const c = check || {};
        const cap = caps || {};
        const errors = {};
        const built = Array.isArray(cap.typesBuilt) ? cap.typesBuilt : [];
        if (!built.includes(c.type)) errors.type = t('nettools.errType', 'Pick a check type.');

        const label = String(c.label || '').trim();
        if (Array.from(label).length > 60) errors.label = t('nettools.errLabelLong', 'The label can be at most 60 characters.');
        // eslint-disable-next-line no-control-regex
        else if (/[\u0000-\u001f\u007f]/.test(label)) errors.label = t('nettools.errLabelControl', 'The label cannot contain control characters.');

        const host = String(c.host || '').trim();
        if (host) {
            if (!cap.allowCustomHost) errors.host = t('nettools.errHostOff', 'A custom host is switched off in the settings.');
            else if (!validHost(host)) errors.host = t('nettools.errHost', 'Use a host name or an IP address, without scheme, port or path.');
        }

        const port = intOr(c.port, 0);
        if (!Number.isInteger(port) || port < 0 || port > 65535) errors.port = t('nettools.errPort', 'The port must be between 1 and 65535.');

        const interval = intOr(c.intervalMinutes, 0);
        if (!Number.isInteger(interval) || (interval !== 0 && (interval < INTERVAL_MIN || interval > INTERVAL_MAX))) {
            errors.intervalMinutes = fmt(t('nettools.errInterval', 'The interval must be between {min} and {max} minutes.'), { min: INTERVAL_MIN, max: INTERVAL_MAX });
        }
        const timeout = intOr(c.timeoutSec, 0);
        if (!Number.isInteger(timeout) || timeout < 0 || timeout > 10) errors.timeoutSec = t('nettools.errTimeout', 'The time-out must be between 1 and 10 seconds.');
        const count = intOr(c.count, 0);
        if (!Number.isInteger(count) || count < 0 || count > 10) errors.count = t('nettools.errCount', 'The packet count must be between 1 and 10.');
        const loss = intOr(c.maxLossPct, 0);
        if (!Number.isInteger(loss) || loss < 0 || loss > 100) errors.maxLossPct = t('nettools.errLoss', 'The allowed loss must be between 0 and 100 percent.');
        const maxMs = intOr(c.maxMs, 0);
        if (!Number.isInteger(maxMs) || maxMs < 0 || maxMs > 60000) errors.maxMs = t('nettools.errSlow', 'The slow threshold must be between 0 and 60000 ms.');

        return { ok: Object.keys(errors).length === 0, errors };
    }

    const SEVERITY = { down: 4, warn: 3, slow: 2, unknown: 1, ok: 0, off: -1 };

    /**
     * The badges a list row shows: only checks that are scheduled, at most
     * `max` of them. When there are more, the worst states win the places
     * (a problem is never the one hidden behind "+n"), and the shown ones keep
     * the order the checks have. `more` is what did not fit.
     */
    function badgeSlice(items, max) {
        const scheduled = (items || []).filter((c) => c && c.enabled === true);
        if (scheduled.length <= max) return { shown: scheduled, more: [] };
        const ranked = scheduled
            .map((c, i) => ({ c, i, sev: SEVERITY[badgeState(c)] }))
            .sort((a, b) => (b.sev - a.sev) || (a.i - b.i))
            .slice(0, max)
            .sort((a, b) => a.i - b.i);
        const keep = new Set(ranked.map((r) => r.c));
        return { shown: ranked.map((r) => r.c), more: scheduled.filter((c) => !keep.has(c)) };
    }

    /**
     * The rail's keys one bookmark falls under: "any" when it has a check, one
     * per type it has, and "down" when a scheduled check is failing. A check
     * counts whether or not it is scheduled; "down" needs a schedule.
     */
    function railKeys(items) {
        const list = items || [];
        if (!list.length) return [];
        const keys = ['any'];
        list.forEach((c) => { if (c.type && !keys.includes(c.type)) keys.push(c.type); });
        if (list.some((c) => badgeState(c) === 'down')) keys.push('down');
        return keys;
    }

    /** A fresh check for a type, as the form starts it. */
    function blankCheck(type) {
        return { id: '', type, enabled: true, label: '', host: '', port: 0, intervalMinutes: 0, timeoutSec: 0, muted: false, count: 0, maxLossPct: 0, maxMs: 0 };
    }

    /** The fields the server keeps for one type; the rest are dropped on a type change. */
    function pickForType(check) {
        const base = { id: check.id || '', type: check.type, enabled: check.enabled !== false, label: check.label || '', intervalMinutes: Number(check.intervalMinutes) || 0, timeoutSec: Number(check.timeoutSec) || 0, muted: check.muted === true };
        if (check.host) base.host = check.host;
        if (check.type === 'tcp') {
            if (Number(check.port) > 0) base.port = Number(check.port);
            if (Number(check.maxMs) > 0) base.maxMs = Number(check.maxMs);
        } else if (check.type === 'ping') {
            if (Number(check.count) > 0) base.count = Number(check.count);
            if (Number(check.maxLossPct) > 0) base.maxLossPct = Number(check.maxLossPct);
            if (Number(check.maxMs) > 0) base.maxMs = Number(check.maxMs);
        }
        return base;
    }

    /** The types the Tools tab has a card for: the ones this install can run, in the usual order. */
    function toolTypes(caps) {
        const built = Array.isArray(caps && caps.typesBuilt) ? caps.typesBuilt : [];
        return TYPES.filter((type) => built.includes(type));
    }

    /** What a one-off result shows as its state: ok, slow, warn or down (the badge's words). */
    function testState(res) {
        if (!res) return 'unknown';
        if (!res.ok) return 'down';
        if (res.warn) return 'warn';
        if (res.slow) return 'slow';
        return 'ok';
    }

    /** A failed result as a block: the class's own, else the server's sentence. */
    function testErrorBlock(res, t) {
        const r = res || {};
        const own = errorBlock({ class: r.class, host: r.host, port: r.port, ip: r.ip, timeoutSec: 10 }, t);
        if (own) return own;
        return {
            cls: r.class || 'other', tone: 'err',
            title: t('nettools.errOtherTitle', 'The test did not work'),
            body: r.error || t('nettools.errOtherBody', 'The test failed without saying why.'),
            actions: [],
        };
    }

    /** One line under a card: the answer in a few words. */
    function testSummary(res, t) {
        if (!res) return t('nettools.toolNotRun', 'Not run yet');
        const ms = Number(res.ms) > 0 ? Math.round(res.ms) : 0;
        if (!res.ok) return testErrorBlock(res, t).title;
        if (res.type === 'tcp') {
            const parts = [fmt(t('nettools.toolPortOpen', '{port} open'), { port: res.port || '?' })];
            if (ms) parts.push(`${ms} ms`);
            return parts.join(' · ');
        }
        if (res.type === 'ping') {
            const p = res.ping || {};
            if (res.viaTcp || p.viaTcp) return [t('nettools.viaTcp', 'via TCP'), ms ? `${ms} ms` : ''].filter(Boolean).join(' · ');
            return [fmt(t('nettools.toolLoss', '{pct}% loss'), { pct: Number(p.lossPct) || 0 }),
                fmt(t('nettools.toolAvg', 'avg {ms} ms'), { ms: Number(p.avgMs) || ms })].join(' · ');
        }
        return ms ? `${ms} ms` : t('nettools.stateOk', 'Up');
    }

    /**
     * What the form starts with when a one-off result is saved as a scheduled
     * check: its type, and the port only when the test used one other than the
     * bookmark address's own (the form says "empty uses the address").
     */
    function checkFromTest(res, bm) {
        const type = res && res.type;
        const check = blankCheck(type);
        if (type === 'tcp' && Number(res.port) > 0 && Number(res.port) !== defaultPort(bm)) check.port = Number(res.port);
        return check;
    }

    const api = {
        toolTypes, testState, testErrorBlock, testSummary, checkFromTest,
        TYPES, TYPE_NAMES, MAX_CHECKS_PER_BOOKMARK,
        typeName, typeHint, hostOf, defaultPort, targetOf, labelFor, badgeState, stateLabel,
        intervalMinutes, intervalWords, explain, errorBlock, validate, blankCheck, pickForType,
        badgeSlice, railKeys,
    };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    global.NetChecksModel = api;
}(typeof window !== 'undefined' ? window : globalThis));
