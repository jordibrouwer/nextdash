#!/usr/bin/env node
'use strict';

/**
 * Developer blogs, and what they write about, from DEV.to (Forem).
 *
 *   node scripts/tag-catalogue/harvest-devto.cjs [--max 3000]
 *
 * DEV.to authors who cross-post from their own blog set a canonical_url that
 * points home. Per tag the script reads articles from the public API, keeps
 * those whose canonical_url is off dev.to, and counts per blog (host, or host
 * plus first path segment on shared hosts) how many articles fall under each
 * catalogue subject. Same rule as harvest-lobsters.cjs: a blog gets a subject
 * when it has at least three articles and at least half of them agree. Every
 * blog with a subject, or with five or more articles spread over subjects,
 * also gets `dev-blogs`.
 *
 * Writes cache/devto-raw.tsv: entry, subject, articles. Fetched pages are
 * cached in cache/devto.json; one request a second.
 */

const fs = require('fs');
const path = require('path');

const AGENT = 'nextDash-catalogue-build/1.0 (https://github.com/jordibrouwer/nextDash)';
const args = process.argv.slice(2);
const maxAt = args.indexOf('--max');
const MAX = maxAt >= 0 ? Number(args[maxAt + 1]) : 3000;
const PER_PAGE = 1000;

// DEV.to tag -> catalogue subject. Tags with no clear subject are left out.
const TAGS = {
    javascript: 'javascript', typescript: 'typescript', node: 'nodejs', python: 'python', rust: 'rust', go: 'golang',
    java: 'java', php: 'php', ruby: 'ruby', rails: 'rails', django: 'django', flask: 'flask', fastapi: 'fastapi',
    laravel: 'laravel', spring: 'spring', kotlin: 'kotlin', swift: 'swift', csharp: 'dotnet', dotnet: 'dotnet',
    cpp: 'cpp', c: 'c', haskell: 'haskell', elixir: 'elixir', scala: 'scala', lua: 'lua', zig: 'zig', bash: 'shell',
    react: 'react', vue: 'vue', angular: 'angular', svelte: 'svelte', nextjs: 'nextjs', tailwindcss: 'tailwind',
    css: 'css', webdev: 'webdev', frontend: 'frontend', webassembly: 'webassembly',
    devops: 'devops', docker: 'containers', kubernetes: 'kubernetes', terraform: 'terraform', ansible: 'ansible',
    cicd: 'ci-cd', linux: 'linux', aws: 'aws', azure: 'azure', googlecloud: 'gcp', cloud: 'cloud', monitoring: 'monitoring',
    networking: 'networking', git: 'git', testing: 'testing', api: 'api', graphql: 'graphql', algorithms: 'algorithms',
    database: 'database', postgres: 'postgres', mysql: 'mysql', mongodb: 'mongodb', redis: 'redis', sqlite: 'sqlite',
    sql: 'sql', elasticsearch: 'elasticsearch', kafka: 'kafka',
    security: 'cybersecurity', cybersecurity: 'cybersecurity', privacy: 'privacy', encryption: 'encryption',
    ai: 'ai', machinelearning: 'ai', llm: 'ai', datascience: 'data-science',
    selfhosted: 'self-hosted', homelab: 'homelab', raspberrypi: 'raspberrypi', arduino: 'arduino', hardware: 'hardware',
    android: 'android', ios: 'ios', flutter: 'flutter', mobile: 'mobile-dev',
    opensource: 'open-source', gamedev: 'game-dev', godot: 'godot', unity3d: 'unity', a11y: 'accessibility',
    performance: 'performance', vim: 'vim', vscode: 'vscode', blockchain: 'crypto',
};
const BLOG = 'dev-blogs';

// Hosts and domains that are not an author's own blog.
const SKIP = new Set(['dev.to', 'forem.com', 'medium.com', 'github.com', 'gist.github.com', 'gitlab.com', 'codeberg.org',
    'bitbucket.org', 'sr.ht', 'git.sr.ht', 'codepen.io', 'codesandbox.io', 'stackblitz.com', 'replit.com', 'glitch.com',
    'youtube.com', 'youtu.be', 'vimeo.com', 'twitter.com', 'x.com', 'facebook.com', 'instagram.com', 'linkedin.com',
    'reddit.com', 'mastodon.social', 'bsky.app', 'threads.net', 't.me', 'discord.com', 'discord.gg', 'news.ycombinator.com',
    'lobste.rs', 'docs.google.com', 'drive.google.com', 'notion.so', 'notion.site', 'figma.com', 'npmjs.com',
    'pypi.org', 'crates.io', 'play.google.com', 'apps.apple.com', 'hackernoon.com', 'web.archive.org', 'archive.org',
    'wikipedia.org', 'en.wikipedia.org', 'producthunt.com', 'kaggle.com', 'dzone.com', 'freecodecamp.org', 'infoq.com',
    'trycloudflare.com', 'ngrok.io', 'ngrok-free.app', 'bit.ly', 't.co', 'tinyurl.com', 'goo.gl', 'ow.ly', 'buff.ly', 'is.gd', 'lnkd.in', 'rebrand.ly', 'cutt.ly']);
const SKIP_SUFFIX = ['.medium.com', '.github.com', '.gitlab.com'];
// Multi-author sites: the first path segment tells the blog (author, team).
const SHARED = new Set(['aws.amazon.com', 'cloud.google.com', 'learn.microsoft.com', 'techcommunity.microsoft.com',
    'developers.redhat.com', 'www.redhat.com', 'developer.ibm.com', 'ibm.com', 'towardsdatascience.com', 'blog.logrocket.com',
    'digitalocean.com', 'community.nasscom.in', 'tech.io', 'substack.com', 'blogspot.com', 'wordpress.com', 'hashnode.com',
    'linkedin.com', 'community.aws', 'builder.aws.com', 'openai.com', 'blogs.oracle.com', 'blogs.sap.com', 'sap.com',
    'zenn.dev', 'qiita.com', 'velog.io', 'note.com', 'juejin.cn', 'cnblogs.com', 'tistory.com']);
const GENERIC = new Set(['blog', 'blogs', 'content', 'articles', 'developers', 'posts', 'news', 'community', 'en']);

const cacheDir = path.join(__dirname, 'cache');
fs.mkdirSync(cacheDir, { recursive: true });
const cacheFile = path.join(cacheDir, 'devto.json');
const cache = fs.existsSync(cacheFile) ? JSON.parse(fs.readFileSync(cacheFile, 'utf8')) : {};
const outFile = path.join(cacheDir, 'devto-raw.tsv');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Blog entry for a canonical URL, or '' when it is not an author's own site.
function entryOf(url) {
    let parsed;
    try {
        parsed = new URL(url);
    } catch {
        return '';
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return '';
    const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
    if (!host.includes('.') || /^\d+\.\d+\.\d+\.\d+$/.test(host) || host.includes(':')) return '';
    const parts = host.split('.');
    const base = parts.slice(-2).join('.');
    if (SKIP.has(host) || SKIP.has(base) && !['hashnode.dev', 'substack.com'].includes(base)) return '';
    if (SKIP_SUFFIX.some((suffix) => host.endsWith(suffix))) return '';
    const first = parsed.pathname.split('/').filter(Boolean)[0] || '';
    if (SHARED.has(host) || SHARED.has(base) && !['hashnode.dev', 'substack.com'].includes(base)
        || first.startsWith('@') || first.startsWith('~')) {
        return first && !/^\d+$/.test(first) && !GENERIC.has(first.toLowerCase()) ? `${host}/${first.toLowerCase()}` : '';
    }
    return host;
}

async function page(tag, n, attempt = 1) {
    const key = `${tag}:${n}`;
    if (cache[key]) return cache[key];
    const response = await fetch(`https://dev.to/api/articles?tag=${encodeURIComponent(tag)}&per_page=${PER_PAGE}&page=${n}`, {
        headers: { 'User-Agent': AGENT, Accept: 'application/json' },
        signal: AbortSignal.timeout(60_000),
    }).catch(() => null);
    await sleep(1000);
    // Too many requests is a pause, not the end of the tag.
    if (response?.status === 429 && attempt <= 5) {
        console.log(`  ${tag}:${n} 429, waiting 60s (${attempt}/5)`);
        await sleep(60_000);
        return page(tag, n, attempt + 1);
    }
    if (!response?.ok) {
        console.log(`  ${tag}:${n} failed: ${response ? response.status : 'network'}`);
        return null;
    }
    const articles = (await response.json()).map((a) => [
        a.id,
        a.canonical_url || '',
        Array.isArray(a.tag_list) ? a.tag_list : String(a.tag_list || '').split(/,\s*/),
    ]);
    // Only the off-dev.to ones matter later; keep the count for statistics.
    const slim = { total: articles.length, off: articles.filter(([, url]) => entryOf(url)) };
    cache[key] = slim;
    fs.writeFileSync(cacheFile, JSON.stringify(cache));
    return slim;
}

async function main() {
    const byEntry = new Map();
    const seen = new Set();
    const read = new Set();
    for (const tag of Object.keys(TAGS)) {
        let got = 0;
        for (let n = 1; got < MAX; n += 1) {
            const result = await page(tag, n);
            if (!result?.total) break;
            got += result.total;
            const ids = result.total;
            result.off.forEach(([id, url, tags]) => {
                if (seen.has(id)) return;
                seen.add(id);
                const entry = entryOf(url);
                if (!entry) return;
                const counts = byEntry.get(entry) || { total: 0, subjects: new Map() };
                counts.total += 1;
                new Set(tags.map((t) => TAGS[t]).filter(Boolean))
                    .forEach((subject) => counts.subjects.set(subject, (counts.subjects.get(subject) || 0) + 1));
                byEntry.set(entry, counts);
            });
            read.add(`${tag}:${n}:${ids}`);
            if (result.total < PER_PAGE) break;
        }
        console.log(`  ${tag}: ${got} articles`);
    }
    const articlesRead = [...read].reduce((sum, key) => sum + Number(key.split(':')[2]), 0);

    const rows = [];
    byEntry.forEach((counts, entry) => {
        if (counts.total < 3) return;
        const [best, n] = [...counts.subjects.entries()].sort((a, b) => b[1] - a[1])[0] || [];
        const voted = best && n >= 3 && n / counts.total >= 0.5;
        if (!voted && counts.total < 5) return;
        rows.push([entry, BLOG, counts.total]);
        if (voted) rows.push([entry, best, n]);
    });
    rows.sort((a, b) => a[0].localeCompare(b[0]) || a[1].localeCompare(b[1]));
    fs.writeFileSync(outFile, `entry\tsubject\tarticles\n${rows.map((r) => r.join('\t')).join('\n')}\n`);

    const perSubject = {};
    rows.forEach(([, subject]) => { perSubject[subject] = (perSubject[subject] || 0) + 1; });
    Object.entries(perSubject).sort((a, b) => b[1] - a[1]).forEach(([subject, n]) => console.log(`${subject}: ${n}`));
    console.log(`${articlesRead} article reads (with overlap), ${seen.size} distinct articles, ${byEntry.size} off-dev.to entries, `
        + `${new Set(rows.map((r) => r[0])).size} entries passed`);
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
