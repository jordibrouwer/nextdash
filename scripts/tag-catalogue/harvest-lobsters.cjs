#!/usr/bin/env node
'use strict';

/**
 * Sites the Lobsters community files under a tag, as catalogue hosts.
 *
 *   node scripts/tag-catalogue/harvest-lobsters.cjs [--pages 40]
 *   node scripts/tag-catalogue/apply.cjs
 *
 * Every story on lobste.rs carries tags (linux, rust, devops, security …).
 * Per tag the script reads the newest pages of stories, counts the domains
 * they link to, and gives a domain the subject its stories agree on: at
 * least three stories, and at least half of them under the one tag -- the
 * same rule the engine applies to a reader's own tags. A domain whose
 * stories spread over many tags but number five or more is taken as `dev`.
 * With cache/hn-domains.json (harvest-hn.cjs), two agreeing stories are
 * enough for a domain Hacker News has seen popular five times or more.
 *
 * Writes manual/lobsters.json, host -> tags, which apply.cjs writes in like
 * the other manual files. Hosts the handwork or two subjects already decide
 * are left alone, and so are the platforms everyone posts on (github.com,
 * medium.com …), where the domain says nothing about the post.
 * Fetched pages are cached in cache/lobsters.json; one request a second.
 */

const fs = require('fs');
const path = require('path');

const AGENT = 'nextDash-catalogue-build/1.0 (https://github.com/jordibrouwer/nextDash)';
const args = process.argv.slice(2);
const pagesAt = args.indexOf('--pages');
const PAGES = pagesAt >= 0 ? Number(args[pagesAt + 1]) : 40;

// Lobsters tag -> catalogue subject. Tags with no clear subject are left out.
const TAGS = {
    // unix stays out: its stories are Unix history, BSD and shells, not Linux.
    linux: 'linux', systemd: 'linux', nix: 'nix', virtualization: 'virtualization',
    programming: 'dev', practices: 'dev', debugging: 'debugging', testing: 'testing', vcs: 'git',
    compilers: 'compilers', performance: 'dev', api: 'api', osdev: 'osdev', plt: 'dev', formalmethods: 'formal-methods',
    rust: 'rust', go: 'golang', python: 'python', javascript: 'javascript', nodejs: 'nodejs', ruby: 'ruby',
    php: 'php', java: 'java', kotlin: 'kotlin', scala: 'scala', c: 'c', 'c++': 'cpp', haskell: 'haskell',
    elixir: 'elixir', erlang: 'erlang', clojure: 'clojure', lua: 'lua', zig: 'zig', swift: 'swift',
    dotnet: 'dotnet', perl: 'perl', wasm: 'webassembly',
    web: 'webdev', css: 'css', browsers: 'browser',
    devops: 'devops', scaling: 'devops', distributed: 'distributed-systems', databases: 'database', networking: 'networking',
    ipv6: 'networking',
    security: 'cybersecurity', reversing: 'cybersecurity', cryptography: 'encryption', privacy: 'privacy',
    ai: 'ai', ml: 'ai', vibecoding: 'ai',
    hardware: 'hardware', retrocomputing: 'retro-computing',
    android: 'android', ios: 'ios', mac: 'macos', windows: 'windows', mobile: 'mobile-dev',
    email: 'email', editors: 'editor', vim: 'vim', emacs: 'emacs', vscode: 'vscode', games: 'game-dev',
};
// Platforms anyone posts on: the domain says nothing about the post.
const PLATFORMS = new Set(['github.com', 'gitlab.com', 'codeberg.org', 'sr.ht', 'git.sr.ht', 'medium.com', 'substack.com',
    'youtube.com', 'youtu.be', 'vimeo.com', 'twitter.com', 'x.com', 'mastodon.social', 'bsky.app', 'reddit.com',
    'news.ycombinator.com', 'lobste.rs', 'web.archive.org', 'archive.org', 'arxiv.org', 'en.wikipedia.org',
    'docs.google.com', 'drive.google.com', 'gist.github.com', 'dev.to', 'hackernoon.com', 'linkedin.com',
    'blogspot.com', 'wordpress.com', 'notion.site', 'pdfs.semanticscholar.org', 'dl.acm.org', 'ieeexplore.ieee.org',
    'nytimes.com', 'theguardian.com', 'bbc.com', 'bbc.co.uk', 'washingtonpost.com', 'reuters.com', 'bloomberg.com',
    'ft.com', 'wsj.com', 'economist.com', 'theatlantic.com', 'newyorker.com']);

const root = path.join(__dirname, '..', '..');
const doc = JSON.parse(fs.readFileSync(path.join(root, 'internal', 'app', 'tag_catalogue.json'), 'utf8'));
const cacheDir = path.join(__dirname, 'cache');
fs.mkdirSync(cacheDir, { recursive: true });
const cacheFile = path.join(cacheDir, 'lobsters.json');
const cache = fs.existsSync(cacheFile) ? JSON.parse(fs.readFileSync(cacheFile, 'utf8')) : {};
const outFile = path.join(__dirname, 'manual', 'lobsters.json');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function hostOf(url) {
    try {
        const parsed = new URL(url);
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return '';
        return parsed.hostname.toLowerCase().replace(/^www\./, '');
    } catch {
        return '';
    }
}

async function page(tag, n, attempt = 1) {
    const key = `${tag}:${n}`;
    if (cache[key]) return cache[key];
    const response = await fetch(`https://lobste.rs/t/${encodeURIComponent(tag)}/page/${n}.json`, {
        headers: { 'User-Agent': AGENT, Accept: 'application/json' },
        signal: AbortSignal.timeout(30_000),
    }).catch(() => null);
    await sleep(3000);
    // Too many requests is a pause, not the end of the tag.
    if (response?.status === 429 && attempt < 5) {
        await sleep(60_000);
        return page(tag, n, attempt + 1);
    }
    if (!response?.ok) return null;
    const stories = (await response.json()).map((story) => [hostOf(story.url), story.tags, story.short_id]);
    cache[key] = stories;
    fs.writeFileSync(cacheFile, JSON.stringify(cache));
    return stories;
}

async function main() {
    const byDomain = new Map();
    const seen = new Set();
    for (const tag of Object.keys(TAGS)) {
        let read = 0;
        // Past the limit only where earlier runs already cached the pages.
        for (let n = 1; n <= PAGES || cache[`${tag}:${n}`]; n += 1) {
            const stories = await page(tag, n);
            if (!stories?.length) break;
            stories.forEach(([host, tags, id]) => {
                // A story under two tags is listed under both; count it once.
                if (!host || seen.has(id)) return;
                seen.add(id);
                const counts = byDomain.get(host) || { total: 0, subjects: new Map() };
                counts.total += 1;
                new Set(tags.map((t) => TAGS[t]).filter(Boolean))
                    .forEach((subject) => counts.subjects.set(subject, (counts.subjects.get(subject) || 0) + 1));
                byDomain.set(host, counts);
            });
            read += stories.length;
        }
        console.log(`  ${tag}: ${read} stories`);
    }

    const hand = new Set();
    const now = new Map();
    doc.tags.forEach((entry) => {
        entry.hosts.forEach((written) => hand.add(written.replace(/^[=~]/, '')));
        [...entry.hosts, ...(entry.derived || [])].forEach((written) => {
            const host = written.replace(/^[=~]/, '');
            now.set(host, [...(now.get(host) || []), entry.tag]);
        });
    });
    const known = new Set(doc.tags.map((entry) => entry.tag));
    const hnFile = path.join(cacheDir, 'hn-domains.json');
    const hn = fs.existsSync(hnFile) ? JSON.parse(fs.readFileSync(hnFile, 'utf8')) : {};
    const out = {};
    const counts = {};
    byDomain.forEach(({ total, subjects }, host) => {
        if (PLATFORMS.has(host) || [...PLATFORMS].some((p) => host.endsWith(`.${p}`) && !host.endsWith('.github.io'))) return;
        const labels = host.split('.');
        if (labels.slice(0, -1).some((_, i) => hand.has(labels.slice(i).join('.')))) return;
        const [best, n] = [...subjects.entries()].sort((a, b) => b[1] - a[1])[0] || [];
        let subject = null;
        // Two agreeing stories are enough for a domain Hacker News has seen
        // popular five times: it is an established site, not a one-off.
        const floor = (hn[host] || 0) >= 5 ? 2 : 3;
        if (best && n >= floor && n / total >= 0.5) subject = best;
        else if (total >= 5) subject = 'dev';
        if (!subject || !known.has(subject)) return;
        const current = now.get(host) || [];
        if (current.includes(subject) || current.length >= 2) return;
        out[host] = [...current, subject];
        counts[subject] = (counts[subject] || 0) + 1;
    });
    fs.writeFileSync(outFile, `${JSON.stringify(Object.fromEntries(Object.entries(out).sort()), null, 2)}\n`);
    Object.entries(counts).sort((a, b) => b[1] - a[1]).forEach(([subject, n]) => console.log(`${subject}: +${n}`));
    console.log(`${Object.keys(out).length} hosts`);
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
