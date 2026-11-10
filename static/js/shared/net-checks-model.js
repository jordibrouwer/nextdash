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
    const DNS_RECORDS = ['A', 'AAAA', 'CNAME', 'MX', 'TXT', 'NS'];
    // A valid certificate with fewer days left than this is a warning (up, not down).
    const TLS_DEFAULT_MIN_DAYS = 14;
    const TLS_MAX_MIN_DAYS = 120;
    // HTTP-detail: what the status rule says when a check names none.
    const HTTP_DEFAULT_STATUS = '200-299';
    const HTTP_ENDPOINT_MAX = 200;
    const HTTP_EXPECT_HEADER_MAX = 200;
    // JSON check: the value to look at, how to judge it, and what to compare with.
    const JSON_OPS = ['eq', 'ne', 'gt', 'lt', 'contains', 'exists'];
    const JSON_PATH_MAX = 200;
    const JSON_EXPECT_MAX = 200;
    const JSON_SECRET_PATH = /token|key|secret|password/i;
    // Drift is on for the records that change rarely and mean something when
    // they do; off for A and AAAA, which rotate behind a CDN.
    const DRIFT_DEFAULT_ON = ['MX', 'TXT', 'NS', 'CNAME'];

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

    /**
     * The port a TLS check inspects when it names none: the port of an https
     * address, else 443. The port of a plain http address is not a TLS port.
     */
    function tlsPort(bm) {
        const u = parseUrl(bm && bm.url);
        if (u && u.protocol === 'https:' && u.port) return Number(u.port);
        return 443;
    }

    function targetOf(check, bm) {
        const host = String((check && check.host) || '').trim().toLowerCase() || hostOf(bm);
        const fallback = check && check.type === 'tls' ? tlsPort(bm) : defaultPort(bm);
        const port = Number(check && check.port) > 0 ? Number(check.port) : fallback;
        return { host, port };
    }

    /** "12 days left", "1 day left", "expires today", "expired 3 days ago": days from the certificate's end. */
    function tlsDaysText(days, t) {
        const n = Math.trunc(Number(days) || 0);
        if (n < 0) return fmt(t('nettools.tlsExpiredAgo', 'expired {n} days ago'), { n: -n });
        if (n === 0) return t('nettools.tlsExpiresToday', 'expires today');
        if (n === 1) return t('nettools.tlsOneDayLeft', '1 day left');
        return fmt(t('nettools.tlsDaysLeft', '{n} days left'), { n });
    }

    /** The name a check goes by: its own label, else its type (and port). */
    function labelFor(check, bm) {
        const own = String((check && check.label) || '').trim();
        if (own) return own;
        const name = typeName(check && check.type);
        if (check.type === 'dns' && check.record) return `${name} \u00b7 ${check.record}`;
        if (check.type === 'json' && String(check.path || '').trim()) {
            const p = Array.from(String(check.path).trim());
            return `${name} \u00b7 ${p.length > 28 ? `${p.slice(0, 28).join('')}\u2026` : p.join('')}`;
        }
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

    /** "Up when the value at db.state is ok": the rule of a JSON check in words. */
    function jsonRule(c, t) {
        const path = String(c.path || '').trim() || '?';
        const value = String(c.expect || '').trim() || '?';
        switch (c.op) {
        case 'exists': return fmt(t('nettools.ruleJsonExists', 'Up when there is a value at {path}'), { path });
        case 'ne': return fmt(t('nettools.ruleJsonNe', 'Up when the value at {path} is not {value}'), { path, value });
        case 'gt': return fmt(t('nettools.ruleJsonGt', 'Up when the value at {path} is more than {value}'), { path, value });
        case 'lt': return fmt(t('nettools.ruleJsonLt', 'Up when the value at {path} is less than {value}'), { path, value });
        case 'contains': return fmt(t('nettools.ruleJsonContains', 'Up when the value at {path} contains {value}'), { path, value });
        default: return fmt(t('nettools.ruleJsonEq', 'Up when the value at {path} is {value}'), { path, value });
        }
    }

    /** The operator in words, for a result: "is", "is not", "is more than", ... */
    function jsonOpText(op, t) {
        switch (op) {
        case 'ne': return t('nettools.opNe', 'is not');
        case 'gt': return t('nettools.opGt', 'is more than');
        case 'lt': return t('nettools.opLt', 'is less than');
        case 'contains': return t('nettools.opContains', 'contains');
        case 'exists': return t('nettools.opExists', 'exists');
        default: return t('nettools.opEq', 'is');
        }
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
        } else if (c.type === 'dns') {
            const record = c.record || 'A';
            summary = fmt(t('nettools.explainDns', 'Looks up the {record} records of {host} with the system resolver.'), { record, host: hostText });
            lines.push(t('nettools.ruleDnsDown', 'Down when no record is found'));
            if (String(c.expect || '').trim()) lines.push(fmt(t('nettools.ruleDnsExpect', 'Down when none of the records is {value}'), { value: String(c.expect).trim() }));
            if (c.watchDrift) lines.push(t('nettools.ruleDnsDrift', 'A change in the set of records shows in the bell; the check stays up until you accept it'));
            if (Number(c.maxMs) > 0) lines.push(fmt(t('nettools.ruleSlow', 'Slow above {ms} ms (still counts as up)'), { ms: c.maxMs }));
        } else if (c.type === 'tls') {
            const days = Number(c.minDaysLeft) > 0 ? Number(c.minDaysLeft) : TLS_DEFAULT_MIN_DAYS;
            summary = fmt(t('nettools.explainTls', 'Reads the certificate that {host} presents on port {port}, and checks it against the trusted authorities.'), { host: hostText, port: port || '?' });
            lines.push(t('nettools.ruleTlsDown', 'Down when the certificate is expired, not trusted or for another name'));
            lines.push(fmt(t('nettools.ruleTlsWarn', 'Warning when {n} days or fewer are left (still counts as up)'), { n: days }));
            lines.push(t('nettools.ruleTlsNotify', 'One expiry notice each time the days left cross a mark'));
        } else if (c.type === 'http') {
            const path = String(c.endpoint || '').trim();
            summary = path
                ? fmt(t('nettools.explainHttpPath', 'Requests {path} on {host} and follows the redirects, step by step.'), { path, host: hostText })
                : fmt(t('nettools.explainHttp', 'Requests the address of this bookmark ({host}) and follows the redirects, step by step.'), { host: hostText });
            lines.push(fmt(t('nettools.ruleHttpStatus', 'Down unless the final status is {status}'), { status: String(c.expectStatus || '').trim() || HTTP_DEFAULT_STATUS }));
            if (String(c.expectHeader || '').trim()) lines.push(fmt(t('nettools.ruleHttpHeader', 'Down when the answer lacks the header: {header}'), { header: String(c.expectHeader).trim() }));
            lines.push(t('nettools.ruleHttpRedirects', 'Follows up to 10 redirects; one to a private address is shown, not followed'));
            if (Number(c.maxMs) > 0) lines.push(fmt(t('nettools.ruleHttpSlow', 'Slow when the first byte takes longer than {ms} ms (still counts as up)'), { ms: c.maxMs }));
            lines.push(t('nettools.ruleHttpSeparate', "Separate from the bookmark's own HTTP check: it keeps its own history"));
        } else if (c.type === 'json') {
            const endpoint = String(c.endpoint || '').trim();
            const where = endpoint ? `${hostText}${endpoint}` : hostText;
            summary = fmt(t('nettools.explainJson', 'Requests {where}, reads the answer as JSON and looks at the value at {path}.'), { where, path: String(c.path || '').trim() || '?' });
            lines.push(jsonRule(c, t));
            lines.push(t('nettools.ruleJsonDown', 'Down when the answer is not 2xx, not JSON (or over 1 MB), has nothing at the path, or the value does not fit'));
            if (JSON_SECRET_PATH.test(String(c.path || ''))) lines.push(t('nettools.ruleJsonHidden', 'The path names a secret, so the value is never shown or kept'));
            lines.push(t('nettools.ruleJsonCredential', "A stored credential goes only to this bookmark's own host, never after a redirect elsewhere, and never into a result"));
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
            if (r.type === 'http' && (r.redirectBlocked === true || /redirect blocked/.test(String(r.detail || '')))) {
                return {
                    cls: 'guard', tone: 'err',
                    title: t('nettools.errRedirectGuardTitle', 'Redirect blocked by the address guard'),
                    body: r.error || t('nettools.errRedirectGuardBody', 'The server redirects to a private address. nextDash shows the hop but does not follow it unless you allow local addresses.'),
                    actions: ['allowLocal'],
                };
            }
            return {
                cls: 'guard', tone: 'err',
                title: t('nettools.errGuardTitle', 'Host blocked by the address guard'),
                body: r.ip
                    ? fmt(t('nettools.errGuardBodyIp', '{host} resolves to {ip}, a private address. nextDash does not test addresses on your own network unless you allow it.'), { host, ip: r.ip })
                    : fmt(t('nettools.errGuardBody', '{host} is a private address. nextDash does not test addresses on your own network unless you allow it.'), { host }),
                actions: ['allowLocal'],
            };
        case 'timeout':
            if (r.type === 'http') {
                return {
                    cls: 'timeout', tone: 'err',
                    title: fmt(t('nettools.errTimeoutTitle', 'Time-out after {s} s'), { s: r.timeoutSec || 10 }),
                    body: fmt(t('nettools.errHttpTimeoutBody', '{host} did not finish answering in time. It may be slow, or something is dropping the request.'), { host }),
                    actions: [],
                };
            }
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
            if (r.type === 'dns') {
                return {
                    cls: 'dns', tone: 'err',
                    title: fmt(t('nettools.errDnsRecordTitle', 'No {record} records'), { record: r.record || 'A' }),
                    body: fmt(t('nettools.errDnsRecordBody', 'Nothing was found for {host}. Check the name, or ask for another record type.'), { host }),
                    actions: [],
                };
            }
            return {
                cls: 'dns', tone: 'err',
                title: t('nettools.errDnsTitle', 'Name does not exist'),
                body: fmt(t('nettools.errDnsBody', 'No address found for {host}. A typo in the bookmark address?'), { host }),
                actions: [],
            };
        case 'http':
            if (r.type === 'json') {
                return {
                    cls: 'http', tone: 'err',
                    title: t('nettools.errJsonStatusTitle', 'The answer is not a success'),
                    body: r.error || t('nettools.errJsonStatusBody', 'The server did not answer with a 2xx status, so there is nothing to look into.'),
                    actions: [],
                };
            }
            return {
                cls: 'http', tone: 'err',
                title: t('nettools.errHttpStatusTitle', 'Not the expected status'),
                body: r.error || fmt(t('nettools.errHttpStatusBody', 'The final answer was {status}. This check expects {expect}.'),
                    { status: (String(r.detail || '').match(/^\d{3}/) || ['?'])[0], expect: r.expectStatus || HTTP_DEFAULT_STATUS }),
                actions: [],
            };
        case 'tls':
            if (r.type === 'http') {
                return {
                    cls: 'tls', tone: 'err',
                    title: t('nettools.errHttpTlsTitle', 'Secure connection failed'),
                    body: r.error || fmt(t('nettools.errHttpTlsBody', "The certificate of {host} was not accepted. If you trust it, allow an untrusted certificate in the bookmark's health settings."), { host }),
                    actions: [],
                };
            }
            if (r.detail) {
                // The details the server writes for a failed certificate; any other is shown as it is.
                let body = fmt(t('nettools.errTlsBody', 'The certificate on {host} port {port} is not acceptable: {detail}.'), { host, port: r.port || '?', detail: r.detail });
                if (r.detail === 'not trusted') body = fmt(t('nettools.errTlsUntrusted', 'The certificate on {host} is not trusted: self-signed, or an intermediate certificate is missing.'), { host });
                else if (r.detail === 'wrong host name') body = fmt(t('nettools.errTlsWrongHost', 'The certificate on port {port} is not valid for {host}.'), { host, port: r.port || '?' });
                else if (/^expired/.test(r.detail)) body = fmt(t('nettools.errTlsExpiredBody', 'The certificate on {host} port {port} {detail}. Renew it.'), { host, port: r.port || '?', detail: r.detail });
                return {
                    cls: 'tls', tone: 'err',
                    title: /^expired/.test(r.detail) ? t('nettools.errTlsExpiredTitle', 'Certificate expired') : t('nettools.errTlsTitle', 'Certificate not accepted'),
                    body: r.error || body,
                    actions: [],
                };
            }
            return {
                cls: 'tls', tone: 'err',
                title: t('nettools.errTlsHandshakeTitle', 'No TLS handshake'),
                body: r.error || fmt(t('nettools.errTlsHandshakeBody', '{host} port {port} did not complete a TLS handshake. The port may not speak TLS; STARTTLS ports are not supported.'), { host, port: r.port || '?' }),
                actions: [],
            };
        case 'content':
            if (r.type === 'json') {
                const path = r.path || '?';
                let title = t('nettools.errJsonValueTitle', 'Not the expected value');
                let body = JSON_SECRET_PATH.test(String(r.path || ''))
                    ? fmt(t('nettools.errJsonValueSecretBody', 'The value at {path} is not what the check expects.'), { path })
                    : fmt(t('nettools.errJsonValueBody', 'The value at {path} is {found}, but the check expects it {op} {expect}.'),
                        { path, found: r.detail || '?', op: jsonOpText(r.op, t), expect: r.expect || '' }).replace(/\s+\./, '.');
                if (r.detail === 'not JSON') {
                    title = t('nettools.errJsonNotJsonTitle', 'The answer is not JSON');
                    body = t('nettools.errJsonNotJsonBody', 'The address did not answer with JSON. Check the path of the address.');
                } else if (r.detail === 'not found') {
                    title = t('nettools.errJsonMissingTitle', 'Nothing at that path');
                    body = fmt(t('nettools.errJsonMissingBody', 'The answer has nothing at {path}. Check the path.'), { path });
                } else if (r.detail === 'answer too large') {
                    title = t('nettools.errJsonLargeTitle', 'The answer is too large');
                    body = t('nettools.errJsonLargeBody', 'The answer is larger than 1 MB; this check reads at most 1 MB.');
                }
                return { cls: 'content', tone: 'err', title, body: r.error || body, actions: [] };
            }
            if (r.type === 'http') {
                return {
                    cls: 'content', tone: 'err',
                    title: t('nettools.errHttpHeaderTitle', 'Header not as expected'),
                    body: r.error || fmt(t('nettools.errHttpHeaderBody', 'The answer does not have the header this check expects: {header}.'), { header: r.expectHeader || '?' }),
                    actions: [],
                };
            }
            return {
                cls: 'content', tone: 'err',
                title: t('nettools.errContentTitle', 'Not the expected value'),
                body: r.expect
                    ? fmt(t('nettools.errContentBody', 'The records of {host} do not include {value}.'), { host, value: r.expect })
                    : fmt(t('nettools.errContentBodyAny', 'None of the records of {host} is the value this check expects.'), { host }),
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

        if (c.type === 'tls') {
            const days = intOr(c.minDaysLeft, 0);
            if (!Number.isInteger(days) || days < 0 || days > TLS_MAX_MIN_DAYS) {
                errors.minDaysLeft = fmt(t('nettools.errMinDays', 'The warning threshold must be between 1 and {max} days.'), { max: TLS_MAX_MIN_DAYS });
            }
        }

        if (c.type === 'http') {
            const endpoint = String(c.endpoint || '').trim();
            if (endpoint) {
                if (endpoint.length > HTTP_ENDPOINT_MAX) errors.endpoint = fmt(t('nettools.errPathLong', 'The path can be at most {max} characters.'), { max: HTTP_ENDPOINT_MAX });
                else if (endpoint[0] !== '/' || endpoint.startsWith('//') || /[\\\s#]/.test(endpoint)) errors.endpoint = t('nettools.errPath', 'Start the path with a single / and leave out spaces, backslashes and #.');
            }
            const status = String(c.expectStatus || '').trim();
            if (status && !validStatusRule(status)) errors.expectStatus = t('nettools.errExpectStatus', 'Use a status like 200, 200-299 or 200,301.');
            const header = String(c.expectHeader || '').trim();
            if (header) {
                if (Array.from(header).length > HTTP_EXPECT_HEADER_MAX) errors.expectHeader = fmt(t('nettools.errExpectHeaderLong', 'The expected header can be at most {max} characters.'), { max: HTTP_EXPECT_HEADER_MAX });
                else if (!/^[A-Za-z0-9_-]+\s*(:.*)?$/.test(header)) errors.expectHeader = t('nettools.errExpectHeader', 'Write a header name, or a name: text it must contain.');
            }
        }

        if (c.type === 'json') {
            const endpoint = String(c.endpoint || '').trim();
            if (endpoint) {
                if (endpoint.length > HTTP_ENDPOINT_MAX) errors.endpoint = fmt(t('nettools.errPathLong', 'The path can be at most {max} characters.'), { max: HTTP_ENDPOINT_MAX });
                else if (endpoint[0] !== '/' || endpoint.startsWith('//') || /[\\\s#]/.test(endpoint)) errors.endpoint = t('nettools.errPath', 'Start the path with a single / and leave out spaces, backslashes and #.');
            }
            const path = String(c.path || '').trim();
            if (!path) errors.path = t('nettools.errJsonPath', 'Enter the path of the value, such as status or db.state.');
            else if (Array.from(path).length > JSON_PATH_MAX) errors.path = fmt(t('nettools.errJsonPathLong', 'The path can be at most {max} characters.'), { max: JSON_PATH_MAX });
            // eslint-disable-next-line no-control-regex
            else if (/[\u0000-\u001f\u007f]/.test(path)) errors.path = t('nettools.errJsonPathControl', 'The path cannot contain control characters.');
            const op = String(c.op || '').toLowerCase();
            if (!JSON_OPS.includes(op)) errors.op = t('nettools.errJsonOp', 'Pick how the value is judged.');
            const expect = String(c.expect || '').trim();
            if (JSON_OPS.includes(op) && op !== 'exists') {
                if (!expect) errors.expect = t('nettools.errJsonExpect', 'Enter the value the answer should have.');
                else if (Array.from(expect).length > JSON_EXPECT_MAX) errors.expect = fmt(t('nettools.errJsonExpectLong', 'The expected value can be at most {max} characters.'), { max: JSON_EXPECT_MAX });
                // eslint-disable-next-line no-control-regex
                else if (/[\u0000-\u001f\u007f]/.test(expect)) errors.expect = t('nettools.errExpectControl', 'The expected value cannot contain control characters.');
                else if ((op === 'gt' || op === 'lt') && !Number.isFinite(Number(expect))) errors.expect = t('nettools.errJsonNumber', 'More than and less than compare numbers: enter a number.');
            }
        }

        if (c.type === 'dns') {
            if (!DNS_RECORDS.includes(String(c.record || '').toUpperCase())) errors.record = t('nettools.errRecord', 'Pick a record type.');
            const expect = String(c.expect || '').trim();
            if (Array.from(expect).length > 255) errors.expect = t('nettools.errExpectLong', 'The expected value can be at most 255 characters.');
            // eslint-disable-next-line no-control-regex
            else if (/[\u0000-\u001f\u007f]/.test(expect)) errors.expect = t('nettools.errExpectControl', 'The expected value cannot contain control characters.');
        }

        return { ok: Object.keys(errors).length === 0, errors };
    }

    /** "200", "200-299", "200,301": the status rule of an HTTP check (parts 100-599). */
    function validStatusRule(spec) {
        const parts = String(spec).split(',').map((p) => p.trim()).filter(Boolean);
        if (!parts.length) return false;
        return parts.every((p) => {
            const m = /^(\d{3})(?:\s*-\s*(\d{3}))?$/.exec(p);
            if (!m) return false;
            const lo = Number(m[1]);
            const hi = m[2] ? Number(m[2]) : lo;
            return lo >= 100 && hi <= 599 && lo <= hi;
        });
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
        const check = { id: '', type, enabled: true, label: '', host: '', port: 0, intervalMinutes: 0, timeoutSec: 0, muted: false, count: 0, maxLossPct: 0, maxMs: 0 };
        if (type === 'dns') Object.assign(check, { record: 'A', expect: '', watchDrift: driftDefault('A') });
        if (type === 'tls') check.minDaysLeft = 0;
        if (type === 'http') Object.assign(check, { endpoint: '', expectStatus: '', expectHeader: '' });
        if (type === 'json') Object.assign(check, { endpoint: '', path: '', op: 'eq', expect: '', credentialId: '' });
        return check;
    }

    /** Whether watching for changes starts on for a record type. */
    function driftDefault(record) {
        return DRIFT_DEFAULT_ON.includes(String(record || '').toUpperCase());
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
        } else if (check.type === 'tls') {
            if (Number(check.port) > 0) base.port = Number(check.port);
            if (Number(check.minDaysLeft) > 0) base.minDaysLeft = Number(check.minDaysLeft);
        } else if (check.type === 'http') {
            if (String(check.endpoint || '').trim()) base.endpoint = String(check.endpoint).trim();
            if (String(check.expectStatus || '').trim()) base.expectStatus = String(check.expectStatus).trim();
            if (String(check.expectHeader || '').trim()) base.expectHeader = String(check.expectHeader).trim();
            if (Number(check.maxMs) > 0) base.maxMs = Number(check.maxMs);
        } else if (check.type === 'json') {
            if (String(check.endpoint || '').trim()) base.endpoint = String(check.endpoint).trim();
            base.path = String(check.path || '').trim();
            base.op = String(check.op || 'eq').toLowerCase();
            if (base.op !== 'exists' && String(check.expect || '').trim()) base.expect = String(check.expect).trim();
            if (String(check.credentialId || '').trim()) base.credentialId = String(check.credentialId).trim();
        } else if (check.type === 'dns') {
            base.record = String(check.record || 'A').toUpperCase();
            if (String(check.expect || '').trim()) base.expect = String(check.expect).trim();
            if (check.watchDrift === true) base.watchDrift = true;
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
        const own = errorBlock({ class: r.class, host: r.host, port: r.port, ip: r.ip, timeoutSec: 10, type: r.type, record: r.dns && r.dns.record, error: r.error, detail: r.detail,
            redirectBlocked: Boolean(r.http && (r.http.redirects || []).some((h) => h.blocked)), expectStatus: r.http && r.http.expectStatus, expectHeader: r.http && r.http.expectHeader,
            path: r.json && r.json.path, op: r.json && r.json.op, expect: r.json && r.json.expect }, t);
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
        if (res.type === 'dns') {
            const n = (res.dns && res.dns.records ? res.dns.records.length : 0);
            const parts = [`${(res.dns && res.dns.record) || ''}`, n === 1 ? t('nettools.dnsOneRecord', '1 record') : fmt(t('nettools.dnsRecords', '{n} records'), { n })];
            if (ms) parts.push(`${ms} ms`);
            return parts.filter(Boolean).join(' \u00b7 ');
        }
        if (res.type === 'tls') {
            const tl = res.tls || {};
            return [tlsDaysText(tl.daysLeft, t), tl.version || ''].filter(Boolean).join(' \u00b7 ');
        }
        if (res.type === 'http') {
            const h = res.http || {};
            const n = (h.redirects || []).length;
            const parts = [String(h.status || '')];
            if (n) parts.push(n === 1 ? t('nettools.httpOneRedirect', '1 redirect') : fmt(t('nettools.httpRedirects', '{n} redirects'), { n }));
            if (ms) parts.push(`${ms} ms`);
            return parts.filter(Boolean).join(' \u00b7 ');
        }
        if (res.type === 'json') {
            const j = res.json || {};
            const what = j.path ? `${j.path} ${jsonOpText(j.op, t)}${j.op === 'exists' ? '' : ` ${j.expect || ''}`}`.trim() : '';
            return [what, ms ? `${ms} ms` : ''].filter(Boolean).join(' · ');
        }
        return ms ? `${ms} ms` : t('nettools.stateOk', 'Up');
    }

    /** "850 B", "34 KB", "1.2 MB": a size for a chip. */
    function sizeText(bytes) {
        const n = Number(bytes) || 0;
        if (n < 1000) return `${n} B`;
        if (n < 100 * 1000) return `${Math.round(n / 100) / 10} KB`;
        if (n < 1000 * 1000) return `${Math.round(n / 1000)} KB`;
        return `${Math.round(n / 100000) / 10} MB`;
    }

    /**
     * The timeline of an HTTP-detail result as bars (mockup a4): one row per
     * step that took time, with where it starts and how wide it is, as percents
     * of the whole timeline. Redirects (the lead time before the final request)
     * come first; DNS, connect and TLS only when they took time; the first byte
     * and the download are always there.
     */
    function httpSegments(timings, t) {
        const tl = timings || {};
        const rows = [
            ['redirects', t('nettools.wfRedirects', 'Redirects'), Number(tl.redirectMs) || 0, false],
            ['dns', t('nettools.wfDns', 'DNS'), Number(tl.dnsMs) || 0, false],
            ['connect', t('nettools.wfConnect', 'Connect'), Number(tl.connectMs) || 0, false],
            ['tls', t('nettools.wfTls', 'TLS'), Number(tl.tlsMs) || 0, false],
            ['wait', t('nettools.wfWait', 'First byte'), Number(tl.waitMs) || 0, true],
            ['transfer', t('nettools.wfDownload', 'Download'), Number(tl.transferMs) || 0, true],
        ].filter((r) => r[3] || r[2] > 0);
        const sum = Math.max(1, rows.reduce((total, r) => total + r[2], 0));
        let at = 0;
        return rows.map(([key, label, ms]) => {
            const seg = { key, label, ms, left: Math.round((at / sum) * 1000) / 10, width: Math.max(1.5, Math.round((ms / sum) * 1000) / 10) };
            at += ms;
            return seg;
        });
    }

    /** The headers a result shows first: the ones that say the most, then the rest in order. */
    const HEADER_FIRST = ['server', 'content-type', 'strict-transport-security', 'cache-control', 'location'];
    function httpHeaderSplit(headers, count) {
        const list = Array.isArray(headers) ? headers : [];
        const first = [];
        HEADER_FIRST.forEach((name) => {
            const found = list.find((h) => h.name === name);
            if (found && first.length < count) first.push(found);
        });
        for (const h of list) {
            if (first.length >= count) break;
            if (!first.includes(h)) first.push(h);
        }
        return { first, rest: list.filter((h) => !first.includes(h)) };
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
        if (type === 'tls' && Number(res.port) > 0 && Number(res.port) !== tlsPort(bm)) check.port = Number(res.port);
        if (type === 'dns' && res.dns && res.dns.record) {
            check.record = res.dns.record;
            check.watchDrift = driftDefault(check.record);
        }
        return check;
    }

    const api = {
        HTTP_DEFAULT_STATUS, validStatusRule, sizeText, httpSegments, httpHeaderSplit,
        JSON_OPS, JSON_SECRET_PATH, jsonOpText, jsonRule,
        DNS_RECORDS, TLS_DEFAULT_MIN_DAYS, tlsPort, tlsDaysText, driftDefault, toolTypes, testState, testErrorBlock, testSummary, checkFromTest,
        TYPES, TYPE_NAMES, MAX_CHECKS_PER_BOOKMARK,
        typeName, typeHint, hostOf, defaultPort, targetOf, labelFor, badgeState, stateLabel,
        intervalMinutes, intervalWords, explain, errorBlock, validate, blankCheck, pickForType,
        badgeSlice, railKeys,
    };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    global.NetChecksModel = api;
}(typeof window !== 'undefined' ? window : globalThis));
