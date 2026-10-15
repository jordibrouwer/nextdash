#!/usr/bin/env node
'use strict';

/**
 * App homepages from three official indexes, as raw catalogue entries.
 *
 *   node scripts/tag-catalogue/harvest-app-indexes.cjs
 *
 * An app's own homepage is a site people bookmark, and which platform the
 * app lives on says what the site is about. F-Droid gives `android`,
 * Flathub `desktop-apps` (plus `linux` for GNOME, KDE and system tools) and
 * Homebrew casks `macos`. Categories add one optional second subject, only
 * where it is unambiguous. Code hosts, app stores, IP addresses and link
 * shorteners say nothing about a site and are dropped. Hosts that hold many
 * apps on different paths (an organisation's site) keep host/first-segment.
 *
 * Writes cache/app-indexes-raw.tsv: entry, subject, source, app_id.
 * Downloads are cached in cache/app-indexes/, so a re-run is cheap.
 */

const fs = require('fs');
const path = require('path');

const AGENT = 'nextDash-catalogue-build/1.0 (https://github.com/jordibrouwer/nextDash)';
const cacheDir = path.join(__dirname, 'cache', 'app-indexes');
fs.mkdirSync(cacheDir, { recursive: true });
const outFile = path.join(__dirname, 'cache', 'app-indexes-raw.tsv');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const FDROID_CATEGORIES = {
    Development: 'dev',
    Games: 'games',
    Money: 'expenses',
    Navigation: 'maps',
    Reading: 'reading',
    'Science & Education': 'education',
    Security: 'security',
};
const FLATHUB_CATEGORIES = {
    Development: 'dev',
    Game: 'games',
    Office: 'productivity',
    Graphics: 'design-tools',
};
const LINUX_ID = /^(org\.gnome\.|org\.kde\.|org\.freedesktop\.|io\.elementary\.|org\.xfce\.|org\.mate_desktop\.|org\.cinnamon\.|org\.gtk\.|org\.gnome\.|com\.system76\.|org\.manjaro\.|org\.pantheon)/;
const LINUX_CATEGORIES = new Set(['GNOME', 'KDE', 'XFCE', 'LXQt', 'Settings', 'System', 'Monitor', 'PackageManager']);
const BREW_DEV = /\b(ide|code editor|source code editor|developers?|api client|git client|terminal emulator|database (client|tool|management)|sql|debugger|programming|text editor for (code|programmers)|http client|docker|kubernetes)\b/i;

const CODE_HOSTS = ['github.com', 'gitlab.com', 'codeberg.org', 'sr.ht', 'bitbucket.org', 'sourceforge.net', 'sourceforge.io',
    'launchpad.net', 'savannah.gnu.org', 'savannah.nongnu.org', 'gitea.com', 'gitee.com', 'notabug.org', 'pagure.io',
    'githubusercontent.com', 'gitlab.gnome.org', 'invent.kde.org', 'salsa.debian.org', 'framagit.org', 'git.sr.ht', 'gitgud.io', 'bitbucket.io'];
const STORES = ['play.google.com', 'apps.apple.com', 'itunes.apple.com', 'f-droid.org', 'flathub.org', 'snapcraft.io',
    'apps.microsoft.com', 'microsoft.com/store', 'store.steampowered.com', 'amazon.com', 'chrome.google.com',
    'chromewebstore.google.com', 'addons.mozilla.org', 'aur.archlinux.org', 'apkpure.com', 'uptodown.com', 'itch.io',
    'formulae.brew.sh', 'brew.sh', 'hub.docker.com', 'npmjs.com', 'pypi.org', 'crates.io'];
const SHORTENERS = ['bit.ly', 't.co', 'goo.gl', 'tinyurl.com', 'ow.ly', 'is.gd', 'buff.ly', 'cutt.ly', 'rebrand.ly', 'lnkd.in', 'shorturl.at', 'tiny.cc', 'rb.gy', 'youtu.be', 'amzn.to', 'fb.me', 'wp.me'];
const matches = (host, list) => list.some((p) => host === p || host.endsWith(`.${p}`));

/** { host, segment } for a usable homepage, or null. */
function parse(url) {
    let u;
    try {
        u = new URL(String(url || '').trim());
    } catch {
        return null;
    }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    const host = u.hostname.toLowerCase().replace(/^www\./, '').replace(/\.$/, '');
    if (!host.includes('.') || /^\d+\.\d+\.\d+\.\d+$/.test(host) || host.includes(':') || host.endsWith('.local')) return null;
    if (matches(host, CODE_HOSTS) && !/\.github\.io$/.test(host)) return null;
    if (matches(host, STORES) || matches(host, SHORTENERS)) return null;
    const segment = u.pathname.split('/').filter(Boolean)[0] || '';
    return { host, segment: /^[a-z0-9._~-]+$/i.test(segment) && !/^index\.|\.(html?|php|aspx?)$/i.test(segment) ? segment.toLowerCase() : '' };
}

async function getJson(url, file) {
    const cached = path.join(cacheDir, file);
    if (fs.existsSync(cached)) return JSON.parse(fs.readFileSync(cached, 'utf8'));
    for (let attempt = 1; ; attempt += 1) {
        try {
            const response = await fetch(url, { headers: { 'User-Agent': AGENT }, signal: AbortSignal.timeout(300_000) });
            if (!response.ok) throw new Error(`${url}: ${response.status}`);
            const text = await response.text();
            fs.writeFileSync(cached, text);
            return JSON.parse(text);
        } catch (error) {
            if (attempt >= 3) throw error;
            await sleep(2000 * attempt);
        }
    }
}

const localized = (value) => (value && typeof value === 'object' ? value['en-US'] || Object.values(value)[0] : value);

async function fdroid() {
    const index = await getJson('https://f-droid.org/repo/index-v2.json', 'fdroid-index-v2.json');
    const apps = [];
    for (const [id, pkg] of Object.entries(index.packages || {})) {
        const meta = pkg.metadata || {};
        let site = localized(meta.webSite);
        if (!parse(site)) site = localized(meta.sourceCode); // parse() drops code hosts
        const second = (meta.categories || []).map((c) => FDROID_CATEGORIES[c]).filter(Boolean)[0];
        apps.push({ id, url: site, subjects: ['android', ...(second ? [second] : [])] });
    }
    return apps;
}

async function flathub() {
    const ids = await getJson('https://flathub.org/api/v2/appstream', 'flathub-ids.json');
    const file = path.join(cacheDir, 'flathub-apps.json');
    const store = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
    let fetched = 0;
    for (const id of ids) {
        if (store[id]) continue;
        let entry = null;
        for (let attempt = 1; attempt <= 3 && !entry; attempt += 1) {
            try {
                const response = await fetch(`https://flathub.org/api/v2/appstream/${encodeURIComponent(id)}`, {
                    headers: { 'User-Agent': AGENT }, signal: AbortSignal.timeout(30_000),
                });
                if (response.status === 404) { entry = { gone: true }; break; }
                if (!response.ok) throw new Error(String(response.status));
                const data = await response.json();
                entry = { homepage: (data.urls && data.urls.homepage) || '', categories: data.categories || [], type: data.type || '' };
            } catch {
                await sleep(1500 * attempt);
            }
        }
        if (!entry) { console.warn(`  flathub: gave up on ${id}`); continue; }
        store[id] = entry;
        fetched += 1;
        if (fetched % 100 === 0) {
            fs.writeFileSync(file, JSON.stringify(store));
            console.log(`  flathub ${Object.keys(store).length}/${ids.length}`);
        }
        await sleep(210);
    }
    fs.writeFileSync(file, JSON.stringify(store));
    const apps = [];
    for (const id of ids) {
        const app = store[id];
        if (!app || app.gone) continue;
        const cats = app.categories;
        const second = cats.map((c) => FLATHUB_CATEGORIES[c]).filter(Boolean)[0];
        const linux = LINUX_ID.test(id) || cats.some((c) => LINUX_CATEGORIES.has(c));
        apps.push({ id, url: app.homepage, subjects: ['desktop-apps', ...(linux ? ['linux'] : []), ...(second ? [second] : [])] });
    }
    return apps;
}

async function homebrew() {
    const casks = await getJson('https://formulae.brew.sh/api/cask.json', 'homebrew-cask.json');
    return casks.map((cask) => ({
        id: cask.token,
        url: cask.homepage,
        subjects: ['macos', ...(BREW_DEV.test(`${cask.desc || ''}`) ? ['dev'] : [])],
    }));
}

async function main() {
    const sources = { fdroid: await fdroid(), flathub: await flathub(), homebrew: await homebrew() };

    // hosts that hold many apps on different first path segments keep the segment
    const segments = new Map();
    Object.values(sources).flat().forEach((app) => {
        const p = parse(app.url);
        if (p && p.segment) {
            if (!segments.has(p.host)) segments.set(p.host, new Set());
            segments.get(p.host).add(p.segment);
        }
    });
    const shared = new Set([...segments].filter(([host, set]) => set.size >= 5 && !host.endsWith('.github.io')).map(([host]) => host));

    const rows = new Set();
    const stats = {};
    for (const [source, apps] of Object.entries(sources)) {
        const entries = new Set();
        const perSubject = {};
        apps.forEach((app) => {
            const p = parse(app.url);
            if (!p) return;
            const entry = shared.has(p.host) && p.segment ? `${p.host}/${p.segment}` : p.host;
            entries.add(entry);
            app.subjects.forEach((subject) => {
                const row = [entry, subject, source, app.id].join('\t');
                const key = [entry, subject, source].join('\t');
                if (!perSubject[key]) { perSubject[key] = true; rows.add(row); }
            });
        });
        stats[source] = { apps: apps.length, entries: entries.size };
    }
    const lines = [...rows].sort();
    fs.writeFileSync(outFile, `entry\tsubject\tsource\tapp_id\n${lines.join('\n')}\n`);
    console.log(stats);
    console.log(`${lines.length} rows; shared hosts: ${shared.size}`);
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
