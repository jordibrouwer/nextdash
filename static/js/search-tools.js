/**
 * Small homelab tools for the search panel, next to the calculator.
 *
 * Typing `192.168.1.0/24`, `base64 hello`, `sha256 hello`, `cron 30 3 * * *`
 * or `8096` answers on the spot as the top row of the list; Enter copies the
 * answer. Nothing leaves the browser.
 *
 * Every tool has a word or a shape of its own, and anything else is not a
 * question: a plain word, a name or an unknown number never becomes an answer
 * (so `pass` is a bookmark, `pass 20` is a password, and `1234` is a search).
 * The hashes are written out here rather than taken from crypto.subtle, which
 * is asynchronous, absent on a plain-http address (where this dashboard often
 * runs) and has no md5. The password and the uuid draw from
 * crypto.getRandomValues, which works everywhere.
 *
 * Same shape as SearchCalc.evaluate: { expression, result, copy } or null.
 */
(function (global) {
    'use strict';

    const MAX_QUERY = 500;
    const SEP = ' · ';

    /*
     * The words around an answer come from the language files (searchTools.*),
     * with the English kept here as the fallback; the commands themselves (cron,
     * sha256, mask) and the answers stay the same in every language. Day and
     * month names come from Intl, in the language of the dashboard.
     */
    const language = () => global.dashboardInstance?.language;
    function tr(key, fallback, vars = {}) {
        let text = fallback;
        const lang = language();
        if (lang?.t) {
            const value = lang.t(`searchTools.${key}`);
            if (value && value !== `searchTools.${key}`) text = value;
        }
        Object.entries(vars).forEach(([name, value]) => { text = text.split(`{${name}}`).join(String(value)); });
        return text;
    }
    const localeTag = () => language()?.currentLanguage || 'en';
    function nameOf(options, date) {
        try { return new Intl.DateTimeFormat(localeTag(), options).format(date); } catch (_error) { return new Intl.DateTimeFormat('en', options).format(date); }
    }
    // January 2001 starts on a Monday, so day n of it is weekday n (0 is Sunday: day 7).
    const dayName = (n) => nameOf({ weekday: 'long', timeZone: 'UTC' }, new Date(Date.UTC(2001, 0, n === 0 ? 7 : n)));
    const monthName = (n) => nameOf({ month: 'long', timeZone: 'UTC' }, new Date(Date.UTC(2001, n - 1, 1)));

    /* ---------- hashes ---------- */

    const utf8 = (text) => new TextEncoder().encode(text);
    const rotl = (x, n) => ((x << n) | (x >>> (32 - n))) >>> 0;
    const rotr = (x, n) => ((x >>> n) | (x << (32 - n))) >>> 0;
    const hex32 = (words) => words.map((w) => (w >>> 0).toString(16).padStart(8, '0')).join('');

    /* The message, one 0x80, zeros, and its length in bits, to a multiple of 64 bytes. */
    function padded(bytes, littleEndian) {
        const total = (((bytes.length + 8) >> 6) + 1) << 6;
        const out = new Uint8Array(total);
        out.set(bytes);
        out[bytes.length] = 0x80;
        const view = new DataView(out.buffer);
        const bits = bytes.length * 8;
        if (littleEndian) {
            view.setUint32(total - 8, bits >>> 0, true);
            view.setUint32(total - 4, Math.floor(bits / 4294967296), true);
        } else {
            view.setUint32(total - 8, Math.floor(bits / 4294967296), false);
            view.setUint32(total - 4, bits >>> 0, false);
        }
        return out;
    }

    const MD5_SHIFT = [7, 12, 17, 22, 5, 9, 14, 20, 4, 11, 16, 23, 6, 10, 15, 21];
    const MD5_K = Array.from({ length: 64 }, (_, i) => Math.floor(Math.abs(Math.sin(i + 1)) * 4294967296) >>> 0);

    function md5(bytes) {
        const data = padded(bytes, true);
        const view = new DataView(data.buffer);
        let a0 = 0x67452301, b0 = 0xefcdab89, c0 = 0x98badcfe, d0 = 0x10325476;
        for (let o = 0; o < data.length; o += 64) {
            const m = Array.from({ length: 16 }, (_, i) => view.getUint32(o + i * 4, true));
            let a = a0, b = b0, c = c0, d = d0;
            for (let i = 0; i < 64; i += 1) {
                let f, g;
                if (i < 16) { f = (b & c) | (~b & d); g = i; }
                else if (i < 32) { f = (d & b) | (~d & c); g = (5 * i + 1) % 16; }
                else if (i < 48) { f = b ^ c ^ d; g = (3 * i + 5) % 16; }
                else { f = c ^ (b | ~d); g = (7 * i) % 16; }
                f = (f + a + MD5_K[i] + m[g]) >>> 0;
                a = d; d = c; c = b;
                b = (b + rotl(f, MD5_SHIFT[(i >> 4) * 4 + (i % 4)])) >>> 0;
            }
            a0 = (a0 + a) >>> 0; b0 = (b0 + b) >>> 0; c0 = (c0 + c) >>> 0; d0 = (d0 + d) >>> 0;
        }
        // md5 writes its words little-endian.
        return [a0, b0, c0, d0].map((w) => {
            let s = '';
            for (let i = 0; i < 4; i += 1) s += ((w >>> (8 * i)) & 255).toString(16).padStart(2, '0');
            return s;
        }).join('');
    }

    function sha1(bytes) {
        const data = padded(bytes, false);
        const view = new DataView(data.buffer);
        const h = [0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476, 0xc3d2e1f0];
        const w = new Uint32Array(80);
        for (let o = 0; o < data.length; o += 64) {
            for (let i = 0; i < 16; i += 1) w[i] = view.getUint32(o + i * 4, false);
            for (let i = 16; i < 80; i += 1) w[i] = rotl(w[i - 3] ^ w[i - 8] ^ w[i - 14] ^ w[i - 16], 1);
            let [a, b, c, d, e] = h;
            for (let i = 0; i < 80; i += 1) {
                let f, k;
                if (i < 20) { f = (b & c) | (~b & d); k = 0x5a827999; }
                else if (i < 40) { f = b ^ c ^ d; k = 0x6ed9eba1; }
                else if (i < 60) { f = (b & c) | (b & d) | (c & d); k = 0x8f1bbcdc; }
                else { f = b ^ c ^ d; k = 0xca62c1d6; }
                const t = (rotl(a, 5) + f + e + k + w[i]) >>> 0;
                e = d; d = c; c = rotl(b, 30); b = a; a = t;
            }
            h[0] = (h[0] + a) >>> 0; h[1] = (h[1] + b) >>> 0; h[2] = (h[2] + c) >>> 0;
            h[3] = (h[3] + d) >>> 0; h[4] = (h[4] + e) >>> 0;
        }
        return hex32(h);
    }

    const SHA256_K = [
        0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
        0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
        0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
        0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
        0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
        0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
        0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
        0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
    ];

    function sha256(bytes) {
        const data = padded(bytes, false);
        const view = new DataView(data.buffer);
        const h = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
        const w = new Uint32Array(64);
        for (let o = 0; o < data.length; o += 64) {
            for (let i = 0; i < 16; i += 1) w[i] = view.getUint32(o + i * 4, false);
            for (let i = 16; i < 64; i += 1) {
                const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
                const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
                w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
            }
            let [a, b, c, d, e, f, g, hh] = h;
            for (let i = 0; i < 64; i += 1) {
                const t1 = (hh + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) + ((e & f) ^ (~e & g)) + SHA256_K[i] + w[i]) >>> 0;
                const t2 = ((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) >>> 0;
                hh = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
            }
            [a, b, c, d, e, f, g, hh].forEach((v, i) => { h[i] = (h[i] + v) >>> 0; });
        }
        return hex32(h);
    }

    const HASHES = { md5, sha1, 'sha-1': sha1, sha256, 'sha-256': sha256 };

    function hash(query) {
        const m = /^(md5|sha-?1|sha-?256)\s+([\s\S]+)$/i.exec(query);
        if (!m) return null;
        const name = m[1].toLowerCase();
        const out = HASHES[name](utf8(m[2]));
        return { expression: `${name} ${m[2]}`, result: out, copy: out };
    }

    /* ---------- base64, url encoding ---------- */

    function encodeBase64(text) {
        let binary = '';
        utf8(text).forEach((b) => { binary += String.fromCharCode(b); });
        return btoa(binary);
    }

    function decodeBase64(text) {
        const clean = text.trim().replace(/-/g, '+').replace(/_/g, '/').replace(/\s+/g, '');
        if (!/^[A-Za-z0-9+/]+={0,2}$/.test(clean)) return null;
        const padded64 = clean + '='.repeat((4 - (clean.length % 4)) % 4);
        const binary = atob(padded64);
        const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
        // Bytes that are not text are not an answer worth showing.
        return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    }

    function base64(query) {
        let m = /^base64\s+decode\s+([\s\S]+)$/i.exec(query);
        if (m) {
            const text = decodeBase64(m[1]);
            return text === null || !text ? null : { expression: `base64 decode ${m[1].trim()}`, result: text, copy: text };
        }
        m = /^base64\s+([\s\S]+)$/i.exec(query);
        if (!m) return null;
        const text = encodeBase64(m[1]);
        return { expression: `base64 ${m[1]}`, result: text, copy: text };
    }

    function urlCoding(query) {
        let m = /^urlencode\s+([\s\S]+)$/i.exec(query);
        if (m) {
            const text = encodeURIComponent(m[1]);
            return { expression: `urlencode ${m[1]}`, result: text, copy: text };
        }
        m = /^urldecode\s+([\s\S]+)$/i.exec(query);
        if (!m) return null;
        const text = decodeURIComponent(m[1].trim());
        return { expression: `urldecode ${m[1].trim()}`, result: text, copy: text };
    }

    /* ---------- random: uuid, password ---------- */

    function randomBytes(n) {
        const out = new Uint8Array(n);
        global.crypto.getRandomValues(out);
        return out;
    }

    function uuid(query) {
        if (!/^uuid(\s+v?4)?$/i.test(query)) return null;
        const b = randomBytes(16);
        b[6] = (b[6] & 0x0f) | 0x40;
        b[8] = (b[8] & 0x3f) | 0x80;
        const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
        const id = `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
        return { expression: 'uuid', result: id, copy: id };
    }

    const PASSWORD_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789-_.!@#$%&*';

    function password(query) {
        const m = /^pass(?:word)?\s+(\d{1,3})$/i.exec(query);
        if (!m) return null;
        const length = Number(m[1]);
        if (length < 8 || length > 128) return null;
        // Rejection sampling: no letter is likelier than another.
        const limit = 256 - (256 % PASSWORD_ALPHABET.length);
        let out = '';
        while (out.length < length) {
            randomBytes(length * 2).forEach((b) => {
                if (out.length < length && b < limit) out += PASSWORD_ALPHABET[b % PASSWORD_ALPHABET.length];
            });
        }
        return { expression: `password ${length}`, result: out, copy: out };
    }

    /* ---------- time ---------- */

    const pad2 = (n) => String(n).padStart(2, '0');
    const localStamp = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
    const EPOCH_MIN = Date.UTC(2001, 0, 1);
    const EPOCH_MAX = Date.UTC(2100, 0, 1);

    function timestamp(query) {
        let m = /^(?:epoch|timestamp)$/i.exec(query);
        if (m) {
            const now = new Date();
            const seconds = Math.floor(now.getTime() / 1000);
            return { expression: 'timestamp', result: `${seconds}${SEP}${now.toISOString()}`, copy: String(seconds) };
        }
        // A bare number is a time only when it is ten digits (seconds) or thirteen
        // (milliseconds) and lands between 2001 and 2100; any other number is a search.
        m = /^(?:(?:ts|epoch|timestamp)\s+)?(\d{10}|\d{13})$/i.exec(query);
        if (!m) return null;
        const ms = m[1].length === 13 ? Number(m[1]) : Number(m[1]) * 1000;
        if (ms < EPOCH_MIN || ms >= EPOCH_MAX) return null;
        const date = new Date(ms);
        return {
            expression: m[1],
            result: `${date.toISOString()}${SEP}${tr('local', '{time} local', { time: localStamp(date) })}`,
            copy: date.toISOString(),
        };
    }

    /* ---------- network: cidr, netmask, ports ---------- */

    function parseIPv4(text) {
        const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(text);
        if (!m) return null;
        const parts = m.slice(1).map(Number);
        if (parts.some((n) => n > 255)) return null;
        return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
    }

    const dotted = (n) => [n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.');
    const maskOf = (prefix) => (prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0);

    function cidr(query) {
        const m = /^(\d{1,3}(?:\.\d{1,3}){3})\/(\d{1,2})$/.exec(query);
        if (!m) return null;
        const ip = parseIPv4(m[1]);
        const prefix = Number(m[2]);
        if (ip === null || prefix > 32) return null;
        const mask = maskOf(prefix);
        const network = (ip & mask) >>> 0;
        const last = (network | (~mask >>> 0)) >>> 0;
        const count = 2 ** (32 - prefix);
        const usable = prefix >= 31 ? count : count - 2;
        const parts = [
            `${dotted(network)} – ${dotted(last)}`,
            count === 1 ? tr('address', '1 address') : tr('addresses', '{n} addresses', { n: count.toLocaleString(localeTag()) }),
        ];
        if (prefix < 31) parts.push(tr('usable', '{n} usable', { n: usable.toLocaleString(localeTag()) }));
        parts.push(tr('mask', 'mask {mask}', { mask: dotted(mask) }));
        return { expression: query, result: parts.join(SEP), copy: `${dotted(network)} – ${dotted(last)}` };
    }

    function netmask(query) {
        let m = /^mask\s+\/?(\d{1,2})$/i.exec(query);
        if (m) {
            const prefix = Number(m[1]);
            if (prefix > 32) return null;
            return { expression: `/${prefix}`, result: dotted(maskOf(prefix)), copy: dotted(maskOf(prefix)) };
        }
        // A dotted mask on its own: four numbers whose bits are ones and then zeros.
        m = /^(\d{1,3}(?:\.\d{1,3}){3})$/.exec(query);
        if (!m) return null;
        const value = parseIPv4(m[1]);
        if (value === null || value === 0) return null;
        const prefix = 32 - Math.log2((~value >>> 0) + 1);
        if (!Number.isInteger(prefix) || maskOf(prefix) !== value) return null;
        return { expression: m[1], result: `/${prefix}`, copy: `/${prefix}` };
    }

    const PORTS = {
        21: 'FTP', 22: 'SSH', 23: 'Telnet', 25: 'SMTP', 53: 'DNS', 67: 'DHCP', 80: 'HTTP', 81: 'Nginx Proxy Manager admin',
        110: 'POP3', 123: 'NTP', 143: 'IMAP', 161: 'SNMP', 389: 'LDAP', 443: 'HTTPS', 445: 'SMB', 465: 'SMTPS',
        514: 'Syslog', 587: 'SMTP submission', 631: 'CUPS', 636: 'LDAPS', 853: 'DNS over TLS', 873: 'rsync',
        993: 'IMAPS', 995: 'POP3S', 1194: 'OpenVPN', 1883: 'MQTT', 1900: 'UPnP', 2049: 'NFS', 2375: 'Docker (no TLS)',
        2376: 'Docker (TLS)', 3000: 'Grafana or Gitea', 3306: 'MySQL or MariaDB', 3389: 'RDP', 5000: 'Synology DSM',
        5001: 'Synology DSM (HTTPS)', 5055: 'Seerr', 5060: 'SIP', 5353: 'mDNS', 5432: 'PostgreSQL', 5900: 'VNC',
        5984: 'CouchDB', 6379: 'Redis', 6767: 'Bazarr', 6881: 'BitTorrent', 7878: 'Radarr', 8006: 'Proxmox',
        8080: 'HTTP alternative', 8086: 'InfluxDB', 8096: 'Jellyfin', 8112: 'Deluge', 8123: 'Home Assistant',
        8181: 'Tautulli', 8191: 'FlareSolverr', 8200: 'Duplicati', 8384: 'Syncthing', 8443: 'HTTPS alternative',
        8686: 'Lidarr', 8787: 'Readarr', 8888: 'Jupyter', 8920: 'Jellyfin (HTTPS)', 8989: 'Sonarr', 9000: 'Portainer',
        9090: 'Prometheus', 9091: 'Transmission', 9100: 'Node exporter', 9117: 'Jackett', 9443: 'Portainer (HTTPS)',
        9696: 'Prowlarr', 19999: 'Netdata', 25565: 'Minecraft', 27017: 'MongoDB', 32400: 'Plex', 51820: 'WireGuard',
        61208: 'Glances',
    };

    function port(query) {
        const m = /^(?:port\s+)?(\d{1,5})$/i.exec(query);
        if (!m) return null;
        const name = PORTS[Number(m[1])];
        return name ? { expression: `port ${Number(m[1])}`, result: name, copy: name } : null;
    }

    /* ---------- files: chmod ---------- */

    const RWX = ['---', '--x', '-w-', '-wx', 'r--', 'r-x', 'rw-', 'rwx'];

    function chmod(query) {
        let m = /^chmod\s+([0-7]{3,4})$/i.exec(query);
        if (m) {
            const digits = m[1].padStart(4, '0').split('').map(Number);
            const trio = digits.slice(1).map((d) => RWX[d].split(''));
            // setuid, setgid and sticky take the place of the execute bit.
            [[0, 4, 's'], [1, 2, 's'], [2, 1, 't']].forEach(([i, bit, letter]) => {
                if (digits[0] & bit) trio[i][2] = trio[i][2] === 'x' ? letter : letter.toUpperCase();
            });
            const text = trio.map((t) => t.join('')).join('');
            return { expression: `chmod ${m[1]}`, result: text, copy: text };
        }
        m = /^(?:chmod\s+)?([r-][w-][xsS-][r-][w-][xsS-][r-][w-][xtT-])$/.exec(query);
        if (!m) return null;
        const text = m[1];
        let special = 0;
        const digit = [0, 3, 6].map((i, n) => {
            const t = text.slice(i, i + 3);
            const exec = /[xst]/.test(t[2]);
            if (/[sSTt]/.test(t[2])) special |= [4, 2, 1][n];
            return (t[0] === 'r' ? 4 : 0) + (t[1] === 'w' ? 2 : 0) + (exec ? 1 : 0);
        }).join('');
        const octal = special ? `${special}${digit}` : digit;
        return { expression: text, result: octal, copy: octal };
    }

    /* ---------- cron ---------- */

    const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
    const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
    const CRON_SHORT = {
        '@hourly': '0 * * * *', '@daily': '0 0 * * *', '@midnight': '0 0 * * *',
        '@weekly': '0 0 * * 0', '@monthly': '0 0 1 * *', '@yearly': '0 0 1 1 *', '@annually': '0 0 1 1 *',
    };

    /* One field to the set of values it allows, or null when it is not valid. */
    function cronField(text, min, max, names) {
        const values = new Set();
        const number = (token) => {
            const named = names ? names.indexOf(token.toLowerCase()) : -1;
            if (named >= 0) return named + (names === MONTHS ? 1 : 0);
            return /^\d+$/.test(token) ? Number(token) : NaN;
        };
        for (const part of text.split(',')) {
            const [range, stepText, extra] = part.split('/');
            if (extra !== undefined || part === '') return null;
            const step = stepText === undefined ? 1 : Number(stepText);
            if (!Number.isInteger(step) || step < 1) return null;
            let from;
            let to;
            if (range === '*') { from = min; to = max; }
            else if (range.includes('-')) {
                const [a, b] = range.split('-');
                from = number(a); to = number(b);
            } else {
                from = number(range);
                to = stepText === undefined ? from : max;
            }
            // Day of week 7 is Sunday as well.
            if (names === DAYS) { if (from === 7) from = 0; if (to === 7 && range !== '*') to = 7; }
            if (!Number.isInteger(from) || !Number.isInteger(to) || from < min || to > (names === DAYS ? 7 : max) || from > to) return null;
            for (let v = from; v <= to; v += step) values.add(names === DAYS && v === 7 ? 0 : v);
        }
        return values;
    }

    const isAll = (text) => text === '*';

    function describeCron(f, weekdays, months) {
        const [min, hour, dom, , dow] = f;
        let when;
        // "Every minute" and "every 5 minutes" already say every day.
        const everyForm = isAll(hour) && (isAll(min) || /^\*\/\d+$/.test(min));
        if (isAll(min) && isAll(hour)) when = tr('cronEveryMinute', 'every minute');
        else if (/^\*\/\d+$/.test(min) && isAll(hour)) when = tr('cronEveryMinutes', 'every {n} minutes', { n: min.slice(2) });
        else if (/^\d+$/.test(min) && isAll(hour)) when = tr('cronMinuteOfHour', 'at minute {min} of every hour', { min });
        else if (/^\d+$/.test(min) && /^\d+$/.test(hour)) when = tr('cronAt', 'at {time}', { time: `${pad2(hour)}:${pad2(min)}` });
        else if (/^\d+$/.test(min) && /^\*\/\d+$/.test(hour)) when = tr('cronMinuteEveryHours', 'at minute {min}, every {n} hours', { min, n: hour.slice(2) });
        else when = tr('cronMinuteHour', 'minute {min}, hour {hour}', { min, hour });
        const days = [];
        if (!isAll(dom)) days.push(tr('cronDayOfMonth', 'on day {day} of the month', { day: dom }));
        if (!isAll(dow)) {
            // A run of three days or more reads as a range: Monday to Friday.
            const sorted = [...weekdays].sort((a, b) => a - b);
            const names = sorted.map(dayName);
            const run = sorted.length >= 3 && sorted[sorted.length - 1] - sorted[0] === sorted.length - 1;
            days.push(tr('cronOnDays', 'on {days}', {
                days: run ? tr('cronRange', '{from} to {to}', { from: names[0], to: names[names.length - 1] }) : names.join(', '),
            }));
        }
        if (!isAll(f[3])) days.push(tr('cronInMonths', 'in {months}', { months: [...months].sort((a, b) => a - b).map(monthName).join(', ') }));
        return `${when}${days.length ? ` ${days.join(' ')}` : (everyForm ? '' : ` ${tr('cronEveryDay', 'every day')}`)}`;
    }

    function cron(query, now = new Date()) {
        const m = /^cron\s+(.+)$/i.exec(query);
        if (!m) return null;
        const expression = CRON_SHORT[m[1].trim().toLowerCase()] || m[1].trim();
        const fields = expression.split(/\s+/);
        if (fields.length !== 5) return null;
        const sets = [
            cronField(fields[0], 0, 59), cronField(fields[1], 0, 23), cronField(fields[2], 1, 31),
            cronField(fields[3], 1, 12, MONTHS), cronField(fields[4], 0, 6, DAYS),
        ];
        if (sets.some((s) => !s || !s.size)) return null;
        // Both day fields restricted means either one may match, as cron does it.
        const bothDays = !isAll(fields[2]) && !isAll(fields[4]);
        const dayOk = (d) => {
            const inMonth = sets[2].has(d.getDate());
            const inWeek = sets[4].has(d.getDay());
            return bothDays ? inMonth || inWeek : inMonth && inWeek;
        };
        const runs = [];
        const t = new Date(now.getTime());
        t.setSeconds(0, 0);
        t.setMinutes(t.getMinutes() + 1);
        // A year of minutes at the most; a schedule that never comes (31 February) ends there.
        for (let i = 0; i < 366 * 24 * 60 && runs.length < 3; i += 1) {
            if (sets[3].has(t.getMonth() + 1) && dayOk(t) && sets[1].has(t.getHours()) && sets[0].has(t.getMinutes())) {
                runs.push(localStamp(t));
            }
            t.setMinutes(t.getMinutes() + 1);
        }
        if (!runs.length) return null;
        const text = describeCron(fields, sets[4], sets[3]);
        // What Enter copies is the schedule itself, the five fields to paste into a crontab
        // (an @daily comes out as 0 0 * * *), not the sentence that explains it.
        return { expression: `cron ${expression}`, result: `${text}${SEP}${tr('next', 'next {times}', { times: runs.join(', ') })}`, copy: fields.join(' ') };
    }

    /* ---------- the one entry ---------- */

    const TOOLS = [hash, base64, urlCoding, uuid, password, timestamp, cidr, netmask, port, chmod, cron];

    /**
     * What the query answers, or null. A tool that throws on odd input (a
     * malformed percent sequence, bytes that are not text) is not an answer.
     */
    function evaluate(query) {
        const text = String(query || '').trim();
        if (!text || text.length > MAX_QUERY) return null;
        for (const tool of TOOLS) {
            try {
                const out = tool(text);
                if (out) return out;
            } catch (_error) {
                // Not this tool's question.
            }
        }
        return null;
    }

    /* ---------- suggestions ---------- */

    /*
     * What a reader needs to know to use each tool: its word, the shape of what
     * follows it, a line saying what it does, and examples that work as typed.
     * `complete` is what picking the word fills in.
     */
    const GUIDE = [
        { key: 'cron', usage: 'cron <minute hour day month weekday>', meta: 'Explain a cron schedule', complete: 'cron ', examples: ['cron 0 9 * * 1-5', 'cron */15 * * * *', 'cron @daily'] },
        { key: 'sha256', usage: 'sha256 <text>', meta: 'Hash a text', complete: 'sha256 ', examples: ['sha256 hello'] },
        { key: 'sha1', usage: 'sha1 <text>', meta: 'Hash a text', complete: 'sha1 ', examples: ['sha1 hello'] },
        { key: 'md5', usage: 'md5 <text>', meta: 'Hash a text', complete: 'md5 ', examples: ['md5 hello'] },
        { key: 'base64', usage: 'base64 <text> | base64 decode <text>', meta: 'Encode or decode base64', complete: 'base64 ', examples: ['base64 hello', 'base64 decode aGVsbG8='] },
        { key: 'urlencode', usage: 'urlencode <text>', meta: 'Escape a text for a URL', complete: 'urlencode ', examples: ['urlencode a b&c'] },
        { key: 'urldecode', usage: 'urldecode <text>', meta: 'Read an escaped URL text', complete: 'urldecode ', examples: ['urldecode a%20b%26c'] },
        { key: 'uuid', usage: 'uuid', meta: 'Make a random UUID', complete: 'uuid', examples: ['uuid'] },
        { key: 'pass', usage: 'pass <length>', meta: 'Make a password', complete: 'pass 20', examples: ['pass 20', 'pass 32'] },
        { key: 'timestamp', usage: 'timestamp | <unix time>', meta: 'The time now, or what a Unix time is', complete: 'timestamp', examples: ['timestamp', '1700000000'] },
        { key: 'mask', usage: 'mask <bits>', meta: 'The netmask of a prefix length', complete: 'mask 24', examples: ['mask 24', '255.255.255.0'] },
        { key: 'chmod', usage: 'chmod <755> | chmod <rwxr-xr-x>', meta: 'File permissions, both ways', complete: 'chmod 755', examples: ['chmod 755', 'rwxr-xr-x'] },
        { key: 'port', usage: 'port <number>', meta: 'Which service uses a port', complete: 'port 8096', examples: ['port 8096', 'port 22'] },
    ];

    const row = (shortcut, name, completion, meta, top) => ({ shortcut, name, completion, meta, top, type: 'finder-completion' });
    // The line saying what a tool does is the one translated part of a hint.
    const aboutOf = (g) => tr(`hint${g.key[0].toUpperCase()}${g.key.slice(1)}`, g.meta);

    /**
     * Rows that help type a tool's command, or [] when the query already
     * answers or is no tool's. `top` rows belong above the list: the reader has
     * typed a tool's word and a space, or a wrong argument, and nothing else is
     * likely meant. The others are a nudge for the first letters of a word and
     * go under the bookmarks, which are likelier meant.
     */
    function suggest(query) {
        const raw = String(query || '');
        if (!raw.trim() || raw.length > MAX_QUERY || evaluate(raw)) return [];
        const text = raw.trim();
        // A whole address, and the slash it may be waiting for.
        if (parseIPv4(text) !== null) {
            return [row('CIDR', `${text}/24`, `${text}/24`, tr('hintCidr', 'Range and size of the subnet, add the bits after the /'), true)];
        }
        const m = /^([a-z0-9]+)(\s[\s\S]*)?$/i.exec(raw.replace(/^\s+/, ''));
        if (!m) return [];
        const word = m[1].toLowerCase();
        if (m[2] === undefined) {
            if (word.length < 2) return [];
            const exact = GUIDE.find((g) => g.key === word);
            if (exact) {
                // The word on its own: show what comes after it. Only once a space follows
                // does it go on top; a bare "pass" or "port" may as well be a bookmark, and
                // Enter must still open that.
                const spaced = raw !== raw.trim();
                return exact.examples.filter((e) => e !== raw.trim()).map((e) => row(exact.key, e, e, aboutOf(exact), spaced));
            }
            return GUIDE.filter((g) => g.key.startsWith(word)).slice(0, 3)
                .map((g) => row(g.key, g.usage, g.complete, aboutOf(g), false));
        }
        const guide = GUIDE.find((g) => g.key === word);
        if (!guide) return [];
        // The word and something that does not work yet: show the shape and examples.
        const meta = m[2].trim() ? tr('notQuite', 'Not quite. The shape is {usage}', { usage: guide.usage }) : guide.usage;
        return guide.examples.map((e) => row(guide.key, e, e, meta, true));
    }

    global.SearchTools = { evaluate, suggest, md5, sha1, sha256, cron };
}(typeof window !== 'undefined' ? window : globalThis));
