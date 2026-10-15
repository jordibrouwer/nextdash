#!/usr/bin/env node
'use strict';

/**
 * Sites from curated lists on GitHub, as catalogue hosts.
 *
 *   node scripts/tag-catalogue/harvest-awesome.cjs
 *   node scripts/tag-catalogue/apply.cjs
 *
 * awesome.json names the lists: awesome-privacy, awesome-sysadmin, the
 * engineering-blogs OPML and more. Every link's host goes under the list's
 * subject, or the one its section heading names (Password Managers ->
 * passwords). Only the host is taken; nothing of the list's text.
 *
 * awesome-selfhosted-data is read file by file: each project with at least
 * minStars GitHub stars gives its homepage `self-hosted` plus the subject its
 * category names.
 *
 * Links to code hosts, app stores and other platforms say nothing about a
 * site and are dropped, as is any host a single list links ten times or more.
 * Hosts the handwork decides, and hosts already under two subjects, are left
 * alone. Writes manual/awesome.json, host -> tags. Downloads are cached in
 * cache/awesome/.
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const AGENT = 'nextDash-catalogue-build/1.0 (https://github.com/jordibrouwer/nextDash)';
const root = path.join(__dirname, '..', '..');
const doc = JSON.parse(fs.readFileSync(path.join(root, 'internal', 'app', 'tag_catalogue.json'), 'utf8'));
const config = JSON.parse(fs.readFileSync(path.join(__dirname, 'awesome.json'), 'utf8'));
const cacheDir = path.join(__dirname, 'cache', 'awesome');
fs.mkdirSync(cacheDir, { recursive: true });
const outFile = path.join(__dirname, 'manual', 'awesome.json');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const PLATFORMS = ['github.com', 'gitlab.com', 'codeberg.org', 'sr.ht', 'bitbucket.org', 'sourceforge.net', 'github.io.invalid',
    'shields.io', 'badgen.net', 'travis-ci.org', 'travis-ci.com', 'circleci.com', 'codecov.io', 'coveralls.io',
    'play.google.com', 'apps.apple.com', 'itunes.apple.com', 'f-droid.org', 'flathub.org', 'snapcraft.io', 'aur.archlinux.org',
    'chrome.google.com', 'chromewebstore.google.com', 'addons.mozilla.org', 'microsoft.com', 'apps.microsoft.com',
    'youtube.com', 'youtu.be', 'twitter.com', 'x.com', 'reddit.com', 'medium.com', 'wikipedia.org', 'archive.org',
    'docker.com', 'hub.docker.com', 'npmjs.com', 'pypi.org', 'crates.io', 'opensource.org', 'creativecommons.org',
    'spdx.org', 'gnu.org', 'img.shields.io', 'raw.githubusercontent.com', 'user-images.githubusercontent.com',
    'awesome.re', 'discord.gg', 'discord.com', 't.me', 'liberapay.com', 'opencollective.com', 'patreon.com', 'ko-fi.com'];

function hostOf(url) {
    try {
        const parsed = new URL(url);
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return '';
        return parsed.hostname.toLowerCase().replace(/^www\./, '').replace(/\.$/, '');
    } catch {
        return '';
    }
}

const isPlatform = (host) => PLATFORMS.some((p) => host === p || host.endsWith(`.${p}`));

async function fetchText(url, file) {
    const cached = path.join(cacheDir, file);
    if (fs.existsSync(cached)) return fs.readFileSync(cached, 'utf8');
    const response = await fetch(url, { headers: { 'User-Agent': AGENT }, signal: AbortSignal.timeout(60_000) });
    if (!response.ok) throw new Error(`${url}: ${response.status}`);
    const text = await response.text();
    fs.writeFileSync(cached, text);
    await sleep(500);
    return text;
}

/** [host, subject] per link, from a markdown list read by its headings. */
function fromMarkdown(text, list) {
    const out = [];
    let section = '';
    text.split('\n').forEach((line) => {
        const heading = line.match(/^#{2,4}\s+(.+?)\s*$/);
        if (heading) {
            section = heading[1].replace(/[*_`[\]]/g, '').replace(/\(.*?\)/g, '').trim();
            return;
        }
        if ((list.skip || []).some((s) => section.startsWith(s))) return;
        const key = Object.keys(list.headings || {}).find((h) => section.startsWith(h));
        const subject = key ? list.headings[key] : list.subject;
        if (!subject) return;
        for (const [, url] of line.matchAll(/\]\((https?:\/\/[^)\s]+)\)/g)) out.push([hostOf(url), subject]);
    });
    return out;
}

/*
 * A blog in a feed list is often a path on a company's site --
 * gocardless.com/blog -- and the company is not a blog. Such a blog is taken
 * as that section, host plus first segment; only a blog on a host of its own
 * is taken whole.
 */
const BLOG_PATHS = new Set(['blog', 'blogs', 'engineering', 'eng', 'tech', 'techblog', 'tech-blog', 'developers', 'developer', 'dev', 'code', 'devblog', 'engineering-blog']);

function fromOpml(text, list) {
    return [...text.matchAll(/htmlUrl="([^"]+)"/g)].map(([, raw]) => {
        const url = raw.replace(/&amp;/g, '&');
        const host = hostOf(url);
        let segment = '';
        try {
            segment = new URL(url).pathname.split('/').filter(Boolean)[0] || '';
        } catch { /* hostOf already said */ }
        if (!segment) return [host, list.subject];
        // Only a path that is a blog; theguardian.com/info is not one.
        return BLOG_PATHS.has(segment.toLowerCase()) ? [`${host}/${segment.toLowerCase()}`, list.subject] : ['', list.subject];
    });
}

async function selfhosted() {
    const { repo, minStars, categories } = config.selfhosted;
    // One tarball rather than a request per project; unpacked as data only.
    const dir = path.join(cacheDir, 'selfhosted');
    if (!fs.existsSync(dir)) {
        const response = await fetch(`https://codeload.github.com/${repo}/tar.gz/HEAD`, { headers: { 'User-Agent': AGENT } });
        if (!response.ok) throw new Error(`${repo}: ${response.status}`);
        const archive = path.join(cacheDir, 'selfhosted.tar.gz');
        fs.writeFileSync(archive, Buffer.from(await response.arrayBuffer()));
        fs.mkdirSync(dir, { recursive: true });
        execFileSync('/usr/bin/tar', ['-xzf', archive, '-C', dir, '--strip-components', '1', '*/software/*.yml']);
    }
    const files = fs.readdirSync(path.join(dir, 'software')).filter((name) => name.endsWith('.yml'));
    const out = [];
    for (const file of files) {
        const text = fs.readFileSync(path.join(dir, 'software', file), 'utf8');
        const site = (text.match(/^website_url:\s*['"]?(\S+?)['"]?\s*$/m) || [])[1];
        const stars = Number((text.match(/^stargazers_count:\s*(\d+)/m) || [])[1] || 0);
        if (text.match(/^archived:\s*true/m) || stars < minStars || !site) continue;
        const tags = [...text.matchAll(/^\s+-\s+(.+)$/gm)].map((m) => m[1].trim());
        const key = Object.keys(categories).find((c) => tags.some((t) => t.startsWith(c)));
        out.push([hostOf(site), 'self-hosted'], ...(key ? [[hostOf(site), categories[key]]] : []));
    }
    console.log(`  awesome-selfhosted: ${files.length} projects read`);
    return out;
}

async function main() {
    const known = new Set(doc.tags.map((entry) => entry.tag));
    const hand = new Set();
    const now = new Map();
    doc.tags.forEach((entry) => {
        entry.hosts.forEach((written) => hand.add(written.replace(/^[=~]/, '')));
        [...entry.hosts, ...(entry.derived || [])].forEach((written) => {
            const host = written.replace(/^[=~]/, '');
            now.set(host, [...(now.get(host) || []), entry.tag]);
        });
    });

    const pairs = [];
    for (const list of config.lists) {
        const text = await fetchText(`https://raw.githubusercontent.com/${list.repo}/HEAD/${list.file}`, `${list.repo.replace('/', '_')}-${list.file}`);
        const found = list.opml ? fromOpml(text, list) : fromMarkdown(text, list);
        // A host one list links ten times is a platform the list leans on.
        const perHost = new Map();
        found.forEach(([host]) => perHost.set(host, (perHost.get(host) || 0) + 1));
        const kept = found.filter(([host]) => host && perHost.get(host) < 10);
        console.log(`  ${list.repo}: ${found.length} links, ${new Set(kept.map(([h]) => h)).size} hosts`);
        pairs.push(...kept);
    }
    pairs.push(...await selfhosted());

    const wanted = new Map();
    pairs.forEach(([host, subject]) => {
        const site = host.split('/')[0];
        if (!site || !site.includes('.') || isPlatform(site) || /^\d+\.\d+\.\d+\.\d+$/.test(site)) return;
        if (!known.has(subject)) throw new Error(`awesome.json: unknown subject ${subject}`);
        const list = wanted.get(host) || [];
        if (!list.includes(subject)) list.push(subject);
        wanted.set(host, list);
    });

    const out = {};
    const counts = {};
    const skipped = { hand: 0, full: 0, has: 0 };
    wanted.forEach((subjects, host) => {
        const labels = host.split('.');
        if (labels.slice(0, -1).some((_, i) => hand.has(labels.slice(i).join('.')))) { skipped.hand += 1; return; }
        const current = now.get(host) || [];
        const fresh = subjects.filter((s) => !current.includes(s));
        if (!fresh.length) { skipped.has += 1; return; }
        if (current.length >= 2) { skipped.full += 1; return; }
        const tags = [...current, ...fresh].slice(0, 2);
        out[host] = tags;
        tags.filter((t) => !current.includes(t)).forEach((t) => { counts[t] = (counts[t] || 0) + 1; });
    });
    fs.writeFileSync(outFile, `${JSON.stringify(Object.fromEntries(Object.entries(out).sort()), null, 2)}\n`);
    Object.entries(counts).sort((a, b) => b[1] - a[1]).forEach(([subject, n]) => console.log(`${subject}: +${n}`));
    console.log(`${Object.keys(out).length} hosts; skipped`, skipped);
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
