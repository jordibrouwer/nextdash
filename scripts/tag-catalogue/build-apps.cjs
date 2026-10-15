#!/usr/bin/env node
'use strict';

/**
 * Self-hosted apps known by name, beyond the hand list.
 *
 *   node scripts/tag-catalogue/harvest-awesome.cjs   (downloads the data once)
 *   node scripts/tag-catalogue/build-apps.cjs
 *
 * internal/app/tag_apps.json is written by hand: names, labels, ports and
 * which words are everyday ones. This adds the long tail it cannot keep up
 * with, from two places:
 *
 *   - awesome-selfhosted-data: every project's name, its repository's name
 *     and its homepage's name, with a second subject where the category says
 *     one thing.
 *   - the catalogue's own self-hosted sites (tracearr.com, phpmyadmin.net):
 *     the site's name is the app's name.
 *
 * Every app found this way is marked common, so its name and label only count
 * on a private host -- a public page called Ghost is not the blog engine. An
 * ordinary word, or two of them run together, is never a name or a label, so
 * an app called only that is left out, as is a label two apps with different subjects would share. Anything the hand list
 * already knows by id, name or label stays the hand list's.
 *
 * Writes internal/app/tag_apps_found.json.
 */

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..', '..');
const hand = JSON.parse(fs.readFileSync(path.join(root, 'internal', 'app', 'tag_apps.json'), 'utf8'));
const doc = JSON.parse(fs.readFileSync(path.join(root, 'internal', 'app', 'tag_catalogue.json'), 'utf8'));
const softwareDir = path.join(__dirname, 'cache', 'awesome', 'selfhosted', 'software');
const outFile = path.join(root, 'internal', 'app', 'tag_apps_found.json');

// Category prefix -> second subject. Only categories that say one thing.
const CATEGORIES = {
    'Media Streaming': 'media-server',
    'Media Management': 'media-server',
    'Monitoring': 'monitoring',
    'Status / Uptime': 'monitoring',
    'Password Managers': 'passwords',
    'Photo Galleries': 'photography',
    'Games': 'games',
    'Bookmarks': 'bookmarks',
    'Feed Readers': 'reading',
    'Document Management - E-books': 'reading',
    'Recipe Management': 'recipes',
    'Money, Budgeting': 'expenses',
    'DNS': 'networking',
    'Network Utilities': 'networking',
    'Proxy': 'networking',
    'VPN': 'vpn',
    'Search Engines': 'search',
    'Internet of Things': 'smart-home',
    'Video Surveillance': 'smart-home',
    'Backup': 'backup',
    'Calendar & Contacts': 'calendar',
    'Content Management Systems': 'cms',
    'Blogging Platforms': 'blog',
    'Web Servers': 'webserver',
    'Database Management': 'database',
    'Generative Artificial Intelligence': 'ai',
    'File Transfer & Synchronization': 'files',
    'File Transfer - Web-based File Managers': 'files',
    'Automation': 'automation',
    'Software Development - Continuous Integration': 'ci-cd',
    'Software Development - Project Management': 'git',
    'Personal Dashboards': 'self-hosted',
};

// Hosts that name a platform, not the app on it.
const PLATFORM_SUFFIXES = ['github.io', 'gitlab.io', 'codeberg.page', 'readthedocs.io', 'netlify.app', 'vercel.app', 'pages.dev', 'sourceforge.io'];
const CODE_HOSTS = ['github.com', 'gitlab.com', 'codeberg.org', 'sr.ht', 'git.sr.ht', 'bitbucket.org', 'framagit.org', 'gitea.com'];
const PREFIXES = new Set(['www', 'docs', 'wiki', 'about', 'app', 'get', 'try', 'my', 'demo', 'blog', 'web', 'home', 'en']);

// Subjects that say where an app runs or who wrote about it, not what it does.
const LOOSE = new Set(['self-hosted', 'dev-blogs', 'open-source', 'desktop-apps', 'mobile-apps', 'android', 'ios', 'macos', 'linux', 'windows', 'dev']);

const subjects = new Set(doc.tags.map((entry) => entry.tag));
const words = new Set(fs.readFileSync('/usr/share/dict/words', 'utf8').split('\n').map((w) => w.trim().toLowerCase()).filter(Boolean));
// Words a home network uses for anything, dictionary or not.
const GENERIC = new Set(['homepage', 'homelab', 'selfhosted', 'selfhosting', 'nginx', 'docs', 'admin', 'dashboard', 'webui', 'wiki', 'helpdesk', 'wishlist', 'filesync']);
const plain = (word) => GENERIC.has(word) || words.has(word) || words.has(word.replace(/e?s$/, ''))
    || words.has(word.replace(/ies$/, 'y'));

/*
 * Only ordinary words: `feeds`, `Home Gallery`. A name made of those says what
 * an app does, not which app it is. Run together they are left alone --
 * crosswatch and lazylibrarian are names.
 */
function ordinary(text) {
    const parts = String(text || '').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
    return parts.length > 0 && parts.every(plain);
}
const slug = (text) => String(text || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
const dashed = (text) => String(text || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const asName = (text) => String(text || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

function hostOf(url) {
    try {
        return new URL(url).hostname.toLowerCase().replace(/^www\./, '');
    } catch {
        return '';
    }
}

/** The app's own name in a homepage host: tracearr.com, lazylibrarian.gitlab.io, wiki.crosswatch.app. */
function siteName(host) {
    if (!host || /^\d+\.\d+\.\d+\.\d+$/.test(host)) return '';
    const labels = host.split('.');
    // user.github.io names the owner, not the app; the repository says more.
    if (PLATFORM_SUFFIXES.some((s) => host.endsWith(`.${s}`)) || CODE_HOSTS.includes(host)) return '';
    const rest = labels.slice(0, -1).filter((label, i, all) => !(i < all.length - 1 && PREFIXES.has(label)));
    // relate.tician.de: the app is the subdomain, the domain its maker. Unsure, so neither.
    return rest.length === 1 ? rest[0] : '';
}

/** The repository's name: github.com/owner/houndarr -> houndarr. */
function repoName(url) {
    try {
        const parsed = new URL(url);
        if (!CODE_HOSTS.includes(parsed.hostname.replace(/^www\./, ''))) return '';
        return (parsed.pathname.split('/').filter(Boolean)[1] || '').replace(/\.git$/, '');
    } catch {
        return '';
    }
}

const handIds = new Set(hand.apps.map((app) => app.id));
const handLabels = new Set(hand.apps.flatMap((app) => app.labels || []));
const handNames = new Set(hand.apps.flatMap((app) => (app.names || []).map(asName)));
const taken = (label) => handLabels.has(label) || handNames.has(label) || handIds.has(label);

const found = new Map(); // id -> { id, app, tags, names:Set, labels:Set }
function add(app, subject, candidates) {
    const labels = new Set();
    candidates.filter((candidate) => !ordinary(candidate)).forEach((candidate) => {
        [slug(candidate), dashed(candidate)].forEach((label) => {
            if (label.length >= 4 && /[a-z]/.test(label) && !ordinary(label)) labels.add(label);
        });
    });
    const name = asName(app);
    const id = dashed(app);
    if (!id || handIds.has(id) || [...labels].some(taken) || handNames.has(name)) return;
    if (!labels.size) return;
    const second = subject && subjects.has(subject) && !LOOSE.has(subject) ? [subject] : [];
    const tags = ['self-hosted', ...second];
    const prior = found.get(id);
    if (prior) {
        labels.forEach((label) => prior.labels.add(label));
        if (prior.tags.length < 2 && tags[1]) prior.tags.push(tags[1]);
        return;
    }
    found.set(id, { id, app, tags, names: new Set(name.length >= 4 && !ordinary(name) ? [name] : []), labels });
}

let read = 0;
if (fs.existsSync(softwareDir)) {
    fs.readdirSync(softwareDir).filter((file) => file.endsWith('.yml')).forEach((file) => {
        const text = fs.readFileSync(path.join(softwareDir, file), 'utf8');
        if (/^archived:\s*true/m.test(text)) return;
        const field = (key) => ((text.match(new RegExp(`^${key}:\\s*['"]?(.+?)['"]?\\s*$`, 'm')) || [])[1] || '');
        const name = field('name');
        if (!name) return;
        const tags = [...text.matchAll(/^\s+-\s+(.+)$/gm)].map((m) => m[1].trim());
        const key = Object.keys(CATEGORIES).find((c) => tags.some((t) => t.startsWith(c)));
        add(name, key ? CATEGORIES[key] : '', [name, repoName(field('source_code_url')), siteName(hostOf(field('website_url')))]);
        read += 1;
    });
}

// The catalogue's self-hosted sites, with the other subject the site has.
const subjectsOf = new Map();
doc.tags.forEach((entry) => [...entry.hosts, ...(entry.derived || [])].forEach((written) => {
    const host = written.replace(/^[=~]/, '');
    subjectsOf.set(host, [...(subjectsOf.get(host) || []), entry.tag]);
}));
let sites = 0;
subjectsOf.forEach((tags, host) => {
    if (!tags.includes('self-hosted') || host.includes('/')) return;
    const name = siteName(host);
    if (!name) return;
    add(name.charAt(0).toUpperCase() + name.slice(1), tags.find((t) => t !== 'self-hosted') || '', [name]);
    sites += 1;
});

// A label two apps with different subjects share says nothing.
const owners = new Map();
found.forEach((app) => app.labels.forEach((label) => owners.set(label, [...(owners.get(label) || []), app])));
owners.forEach((apps, label) => {
    if (apps.length > 1 && new Set(apps.map((a) => a.tags.join('|'))).size > 1) apps.forEach((a) => a.labels.delete(label));
});

const apps = [...found.values()]
    .filter((app) => app.labels.size || app.names.size)
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((app) => ({ id: app.id, app: app.app, tags: app.tags, names: [...app.names].sort(), labels: [...app.labels].sort() }));

const out = {
    version: 1,
    note: 'Generated by scripts/tag-catalogue/build-apps.cjs from awesome-selfhosted-data (CC-BY-SA 3.0) and the catalogue\'s self-hosted sites. The server marks every entry common: name and label count only on a private host. tag_apps.json, written by hand, wins over anything here.',
    apps,
};
fs.writeFileSync(outFile, `{\n  "version": 1,\n  "note": ${JSON.stringify(out.note)},\n  "apps": [\n${apps.map((a) => `    ${JSON.stringify(a)}`).join(',\n')}\n  ]\n}\n`);
console.log(`${read} awesome-selfhosted projects, ${sites} catalogue sites -> ${apps.length} apps`);
