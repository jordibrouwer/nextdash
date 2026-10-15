#!/usr/bin/env node
'use strict';

/**
 * Project sites from GitHub topics, as raw catalogue candidates.
 *
 *   node scripts/tag-catalogue/harvest-github-topics.cjs [--stars 200] [--pages 3]
 *
 * Repositories carry the topics their authors chose, and a popular repo's
 * homepage field is usually the project's own site. For every topic in TOPICS
 * (each one picked because its meaning matches a catalogue subject exactly)
 * the GitHub search API gives the most-starred repositories with at least
 * --stars stars, --pages pages of 100. Each repo's homepage is reduced to a
 * host (plus first path segment on shared hosts) and recorded under the
 * subject of every topic the repo was found under.
 *
 * Homepages are dropped when empty, when they point at a code host, app store,
 * package registry, social site, link shortener, readthedocs, an IP address,
 * localhost, an owner's github.io/<repo> page or a throwaway hosting subdomain.
 *
 * Needs an authenticated `gh`. The search API allows 30 requests a minute, so
 * calls are paced 2.5 s apart; a 403 or 429 waits and retries. Responses are
 * cached in cache/github-topics/, so a re-run costs nothing. Writes
 * cache/github-topics-raw.tsv: entry, subject, stars, repo.
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const args = process.argv.slice(2);
const opt = (name, fallback) => {
    const at = args.indexOf(name);
    return at >= 0 ? Number(args[at + 1]) : fallback;
};
const MIN_STARS = opt('--stars', 200);
const PAGES = opt('--pages', 3);
const PACE_MS = 2500;
const cacheRoot = path.join(__dirname, 'cache');
const cacheDir = path.join(cacheRoot, 'github-topics');
fs.mkdirSync(cacheDir, { recursive: true });
const outFile = path.join(cacheRoot, 'github-topics-raw.tsv');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// GitHub topic -> catalogue subject. Only clear one-to-one meanings.
const TOPICS = {
    // self-hosting and homelab
    'self-hosted': 'self-hosted',
    selfhosted: 'self-hosted',
    'self-hosting': 'self-hosted',
    homelab: 'homelab',
    'home-assistant': 'smart-home',
    homeassistant: 'smart-home',
    'home-automation': 'smart-home',
    smarthome: 'smart-home',
    nas: 'nas',
    'media-server': 'media-server',
    jellyfin: 'media-server',
    plex: 'media-server',
    backup: 'backup',
    'raspberry-pi': 'raspberrypi',
    esp32: 'esp32',
    arduino: 'arduino',
    // devops and infrastructure
    devops: 'devops',
    docker: 'containers',
    'docker-compose': 'containers',
    containers: 'containers',
    kubernetes: 'kubernetes',
    k8s: 'kubernetes',
    helm: 'kubernetes',
    terraform: 'terraform',
    ansible: 'ansible',
    'infrastructure-as-code': 'iac',
    'ci-cd': 'ci-cd',
    'continuous-integration': 'ci-cd',
    monitoring: 'monitoring',
    prometheus: 'monitoring',
    grafana: 'monitoring',
    observability: 'monitoring',
    logging: 'logging',
    networking: 'networking',
    'reverse-proxy': 'webserver',
    nginx: 'webserver',
    'load-testing': 'load-testing',
    'feature-flags': 'feature-flags',
    virtualization: 'virtualization',
    aws: 'aws',
    azure: 'azure',
    'google-cloud': 'gcp',
    cloudflare: 'cloudflare',
    'cloud-storage': 'cloud-storage',
    // operating systems and platforms
    linux: 'linux',
    android: 'android',
    ios: 'ios',
    macos: 'macos',
    windows: 'windows',
    osdev: 'osdev',
    nix: 'nix',
    nixos: 'nix',
    terminal: 'terminal',
    // privacy and security
    privacy: 'privacy',
    security: 'security',
    cybersecurity: 'cybersecurity',
    vpn: 'vpn',
    wireguard: 'vpn',
    ctf: 'ctf',
    osint: 'osint',
    'password-manager': 'passwords',
    encryption: 'encryption',
    authentication: 'auth',
    oauth2: 'auth',
    sso: 'auth',
    // ai and data
    llm: 'ai',
    'large-language-models': 'ai',
    'machine-learning': 'ai',
    'deep-learning': 'ai',
    'artificial-intelligence': 'ai',
    'data-science': 'data-science',
    'data-visualization': 'data-visualization',
    mcp: 'mcp',
    robotics: 'robotics',
    'quantum-computing': 'quantum-computing',
    // databases
    database: 'database',
    postgresql: 'postgres',
    mysql: 'mysql',
    sqlite: 'sqlite',
    mongodb: 'mongodb',
    redis: 'redis',
    elasticsearch: 'elasticsearch',
    kafka: 'kafka',
    graphql: 'graphql',
    // languages
    python: 'python',
    javascript: 'javascript',
    typescript: 'typescript',
    golang: 'golang',
    rust: 'rust',
    java: 'java',
    kotlin: 'kotlin',
    swift: 'swift',
    ruby: 'ruby',
    php: 'php',
    cpp: 'cpp',
    dotnet: 'dotnet',
    scala: 'scala',
    haskell: 'haskell',
    elixir: 'elixir',
    erlang: 'erlang',
    clojure: 'clojure',
    lua: 'lua',
    perl: 'perl',
    julia: 'julia',
    zig: 'zig',
    dart: 'dart',
    bash: 'shell',
    webassembly: 'webassembly',
    regex: 'regex',
    compiler: 'compilers',
    // frameworks and tools
    react: 'react',
    vue: 'vue',
    angular: 'angular',
    svelte: 'svelte',
    nextjs: 'nextjs',
    nodejs: 'nodejs',
    deno: 'deno',
    bun: 'bun',
    django: 'django',
    flask: 'flask',
    fastapi: 'fastapi',
    laravel: 'laravel',
    'ruby-on-rails': 'rails',
    'spring-boot': 'spring',
    flutter: 'flutter',
    tailwindcss: 'tailwind',
    'game-development': 'game-dev',
    unity: 'unity',
    godot: 'godot',
    'unreal-engine': 'unreal',
    vim: 'vim',
    neovim: 'vim',
    emacs: 'emacs',
    vscode: 'vscode',
    git: 'git',
    api: 'api',
    testing: 'testing',
    linter: 'linting',
    i18n: 'localization',
    // apps and everyday software
    rss: 'rss',
    'rss-reader': 'rss',
    bookmarks: 'bookmarks',
    'note-taking': 'notes',
    'project-management': 'project-management',
    crm: 'crm',
    erp: 'erp',
    ecommerce: 'ecommerce',
    cms: 'cms',
    'static-site-generator': 'static-site',
    email: 'email',
    pdf: 'pdf',
    torrent: 'torrent',
    emulator: 'emulation',
    '3d-printing': '3d-printing',
    accessibility: 'accessibility',
    'web-analytics': 'analytics',
    fediverse: 'fediverse',
    mastodon: 'fediverse',
    'open-data': 'open-data',
    gis: 'gis',
    chess: 'chess',
    'mechanical-keyboard': 'mechanical-keyboards',
};

// Hosts that say nothing about a project's own site.
const BLOCKED = [
    'github.com', 'githubusercontent.com', 'gitlab.com', 'bitbucket.org', 'codeberg.org', 'sr.ht', 'sourceforge.net', 'gitee.com',
    'play.google.com', 'apps.apple.com', 'itunes.apple.com', 'f-droid.org', 'flathub.org', 'snapcraft.io', 'apps.microsoft.com',
    'microsoft.com', 'chrome.google.com', 'chromewebstore.google.com', 'addons.mozilla.org', 'aur.archlinux.org', 'appgallery.huawei.com',
    'npmjs.com', 'pypi.org', 'crates.io', 'pkg.go.dev', 'rubygems.org', 'packagist.org', 'nuget.org', 'docs.rs', 'pub.dev', 'hex.pm',
    'mvnrepository.com', 'hub.docker.com', 'ghcr.io', 'quay.io', 'artifacthub.io', 'formulae.brew.sh',
    'twitter.com', 'x.com', 'facebook.com', 'linkedin.com', 'instagram.com', 'youtube.com', 'youtu.be', 'reddit.com', 'medium.com',
    'discord.com', 'discord.gg', 't.me', 'telegram.org', 'bsky.app', 'tiktok.com', 'twitch.tv', 'producthunt.com', 'news.ycombinator.com',
    'wikipedia.org', 'archive.org', 'web.archive.org', 'gist.github.com', 'stackoverflow.com', 'slack.com', 'gitter.im',
    'aka.ms', 'git.io', 'marketplace.visualstudio.com', 'open-vsx.org', 'marketplace.eclipse.org', 'plugins.jetbrains.com', 'extensions.gnome.org', 'bit.ly', 't.co', 'goo.gl', 'tinyurl.com', 'buff.ly', 'ow.ly', 'is.gd', 'rebrand.ly', 'lnkd.in', 'amzn.to', 'cutt.ly',
    'readthedocs.io', 'readthedocs.org', 'rtfd.io', 'readthedocs-hosted.com',
    'herokuapp.com', 'vercel.app', 'netlify.app', 'pages.dev', 'workers.dev', 'onrender.com', 'fly.dev', 'glitch.me', 'repl.co',
    'replit.app', 'web.app', 'firebaseapp.com', 'surge.sh', 'gitlab.io', 'azurewebsites.net', 'streamlit.app', 'huggingface.co',
    'localhost',
];
// Hosts where the path names the site, so the first segment is kept.
const SHARED = ['sites.google.com', 'docs.google.com', 'notion.site', 'wiki.archlinux.org', 'developer.apple.com', 'learn.microsoft.com'];

const matches = (host, list) => list.some((h) => host === h || host.endsWith(`.${h}`));

function reduce(homepage, owner, repoName) {
    if (!homepage) return '';
    let url;
    try {
        url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(homepage.trim()) ? homepage.trim() : `https://${homepage.trim()}`);
    } catch {
        return '';
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return '';
    const host = url.hostname.toLowerCase().replace(/^www\./, '').replace(/\.$/, '');
    if (!host.includes('.') || /^\d+\.\d+\.\d+\.\d+$/.test(host) || host.includes(':')) return '';
    const segments = url.pathname.split('/').filter(Boolean);
    if (host.endsWith('.github.io')) {
        // owner.github.io/<repo> is the owner's page for that repo; a bare project site is kept.
        if (segments.length) return '';
        return host;
    }
    if (matches(host, BLOCKED)) return '';
    if (matches(host, SHARED)) return segments.length ? `${host}/${segments[0].toLowerCase()}` : '';
    return host;
}

async function page(topic, n) {
    const file = path.join(cacheDir, `${topic}.${n}.json`);
    if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8'));
    const endpoint = `search/repositories?q=topic:${topic}+stars:>=${MIN_STARS}&sort=stars&per_page=100&page=${n}`;
    for (let attempt = 0; attempt < 8; attempt += 1) {
        await sleep(PACE_MS);
        const run = spawnSync('gh', ['api', endpoint], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
        if (run.status === 0) {
            const items = (JSON.parse(run.stdout).items || []).map((r) => ({
                repo: r.full_name,
                owner: r.owner && r.owner.login,
                name: r.name,
                stars: r.stargazers_count,
                homepage: r.homepage || '',
            }));
            fs.writeFileSync(file, JSON.stringify(items));
            return items;
        }
        const message = `${run.stderr} ${run.stdout}`;
        if (/403|429|rate limit|secondary/i.test(message)) {
            console.log(`  rate limited on ${topic} p${n}; waiting 65 s`);
            await sleep(65_000);
            continue;
        }
        if (/422|Validation Failed/i.test(message)) return [];
        if (/timeout|timed out|reset by peer|EOF|50[0-4]|no such host/i.test(message)) {
            console.log(`  network trouble on ${topic} p${n}; retrying in 15 s`);
            await sleep(15_000);
            continue;
        }
        throw new Error(`gh api ${endpoint}: ${message.trim()}`);
    }
    throw new Error(`gave up on ${topic} page ${n}`);
}

async function main() {
    const best = new Map(); // `${entry}\t${subject}` -> { stars, repo }
    const topics = Object.keys(TOPICS);
    for (const [i, topic] of topics.entries()) {
        let repos = 0;
        for (let n = 1; n <= PAGES; n += 1) {
            const items = await page(topic, n);
            repos += items.length;
            for (const item of items) {
                const entry = reduce(item.homepage, item.owner, item.name);
                if (!entry) continue;
                const key = `${entry}\t${TOPICS[topic]}`;
                const old = best.get(key);
                if (!old || item.stars > old.stars) best.set(key, { stars: item.stars, repo: item.repo });
            }
            if (items.length < 100) break;
        }
        console.log(`${i + 1}/${topics.length} ${topic} -> ${TOPICS[topic]}: ${repos} repos`);
    }
    const lines = [...best.entries()]
        .map(([key, v]) => `${key}\t${v.stars}\t${v.repo}`)
        .sort();
    fs.writeFileSync(outFile, `entry\tsubject\tstars\trepo\n${lines.join('\n')}\n`);
    console.log(`${best.size} entry/subject lines, ${new Set([...best.keys()].map((k) => k.split('\t')[0])).size} distinct entries`);
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
