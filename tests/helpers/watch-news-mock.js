// @ts-check
/*
 * Watch feeds news for the manual's screenshots, without the internet.
 *
 * Six neutral news sites ("Northside Gazette", "Open Source Weekly", ...) sit
 * on the News category of the first page. A small server on this machine
 * answers as their feeds: first with an older entry or two (the baseline, so
 * nothing counts as new), then, once "armed", with the newer stories. The
 * pictures are generated landscapes and skylines under
 * tests/fixtures/manual-screenshots/news; nobody and nothing real is in them.
 *
 * Used by tests/manual-screenshots-v1-24.spec.js:
 *   - newsData(dir)           the bookmarks, their link previews and four
 *                             weeks of statistics, written into a data copy
 *   - startNewsStub()         the feed server, on a port of this worker's own
 *   - watchSites(server, stub) watch the six feeds, publish the news, poll
 *   - shiftFeedTimes(page)    the server's clock and the shot's clock differ
 *                             by the time since the seed was made; move the
 *                             times the page is told by that much
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { NOW, readJSON, writeJSON } = require('./manual-shot-kit');
const { WRITE_TOKEN } = require('../e2e-helpers');

const IMG = path.join(__dirname, '..', 'fixtures', 'manual-screenshots', 'news');
const MIN = 60e3;

/** [id, name, description, picture of the site's preview] */
const SITES = [
    ['northside', 'Northside Gazette', 'Local news from the north side of the river.', 'dusk-city'],
    ['osw', 'Open Source Weekly', 'A weekly look at the tools people build in the open.', 'lake-dawn'],
    ['harbor', 'Harbor Tech Review', 'Hardware and software reviews, without the hype.', 'alpine-blue'],
    ['fieldnotes', 'Field Notes', 'Trail reports and short walks.', 'hills-green'],
    ['compile', 'The Daily Compile', 'Small habits for people who write code.', 'night-city'],
    ['quiet', 'Quiet Hours', 'Essays about reading less and better.', 'pine-fog'],
];

/** The stories: `old` is there from the start, `fresh` arrives later; [title, picture, minutes ago, lead, second paragraph]. */
const FEEDS = {
    northside: {
        title: 'Northside Gazette',
        old: [['The tram line reopens after a week of repairs', 'coast', 2880], ['Library extends its evening hours through winter', 'pine-fog', 3600]],
        fresh: [
            ['Harbour footbridge to reopen on Friday after a month of repairs', 'dusk-city', 22, 'The pedestrian bridge across the old harbour will open again on Friday morning. Crews finished the last of the steel work on Sunday, and the final inspection is scheduled for Wednesday.', 'Residents on the north bank have walked a detour of almost two kilometres since the closure began, and local shops reported fewer visitors in the evenings.'],
            ['Council approves the new cycle route along the canal', 'hills-green', 190, 'The council voted on Monday to build a separated cycle path along the canal, joining two existing routes.', 'Work is expected to start in spring.'],
            ['Winter market adds a second weekend', 'night-city', 410, 'Organisers said the winter market will run for two weekends this year after record visitor numbers.', 'Opening hours stay the same.'],
        ],
    },
    osw: {
        title: 'Open Source Weekly',
        old: [['Release notes for the quarter, in plain words', 'alpine-blue', 5000]],
        fresh: [
            ['A small database that fits in one file, and why teams keep choosing it', 'lake-dawn', 35, 'Single-file databases are having a moment. This week we look at what they do well, where they stop, and what a backup looks like when the database is a single file on disk.', 'We also cover three tools that make restoring one painless.'],
            ['Maintainers ask for fewer, better bug reports', 'dunes', 260, 'Several large projects published guidance this week on writing reports that can be acted on.', 'The advice is short and mostly common sense.'],
        ],
    },
    harbor: {
        title: 'Harbor Tech Review',
        old: [['Review: a quiet mini PC for the home server shelf', 'night-city', 4300]],
        fresh: [
            ['Review: a fanless mini PC that runs a dozen containers without a sound', 'alpine-blue', 75, 'We ran twelve containers for a fortnight on a fanless box the size of a paperback. It stayed under 55 degrees and drew 9 watts at idle.', 'The only complaint is the single network port.'],
        ],
    },
    fieldnotes: {
        title: 'Field Notes',
        old: [['Trail report: the ridge path in early frost', 'pine-fog', 3000]],
        fresh: [
            ['Trail report: the lake loop is open, the ridge path is not', 'lake-dawn', 130, 'The lake loop is dry and well signed. The ridge path still has ice on the north side and is best left until the weekend.', 'Bring poles if you go.'],
            ['Where to see the first snow this season', 'hills-green', 700, 'Three easy viewpoints, all reachable by bus.', 'Start early for the light.'],
        ],
    },
    compile: {
        title: 'The Daily Compile',
        old: [['Why your build is slow, in five graphs', 'dunes', 4000]],
        fresh: [
            ['Ten small shell habits that save an hour a week', 'night-city', 300, 'Aliases, history search, a project-local scripts folder and six more habits that cost nothing to adopt.', 'None of them need a plugin.'],
        ],
    },
    quiet: {
        title: 'Quiet Hours',
        old: [['An essay on keeping a reading list short', 'coast', 6000]],
        fresh: [
            ['What a reading list looks like when it is allowed to be finished', 'pine-fog', 520, 'A short essay about deleting links you will never read.', 'The list ends up shorter and the reading goes up.'],
        ],
    },
};

/** This worker's own port for the feed server (8272-8279), so parallel shots never meet. */
const stubPort = () => 8272 + Number(process.env.TEST_PARALLEL_INDEX || 0) % 8;
const feedUrl = (id) => `http://127.0.0.1:${stubPort()}/${id}/feed.xml`;
const siteUrl = (id) => `https://${id}.example/`;

/** The six bookmarks, their link previews and four weeks of statistics, in a copy of the seed. */
function newsData(dir) {
    const file = path.join(dir, 'bookmarks-1.json');
    const data = readJSON(file);
    const at = NOW.getTime();
    SITES.forEach(([id, name], i) => {
        data.bookmarks.push({
            name, url: siteUrl(id), pageId: 1, category: 'news', shortcut: '', checkStatus: false,
            createdAt: at - (30 + i) * 86_400_000, updatedAt: at - (30 + i) * 86_400_000,
            openCount: 2 + i, lastOpened: at - (2 + i) * 86_400_000, tags: ['news'],
        });
    });
    writeJSON(file, data);

    // Link previews for the six sites: a title, a line and a picture each.
    const cacheFile = path.join(dir, 'preview-cache.json');
    const cache = fs.existsSync(cacheFile) ? readJSON(cacheFile) : { cache: {} };
    fs.mkdirSync(path.join(dir, 'preview-images'), { recursive: true });
    for (const [id, name, description, img] of SITES) {
        const stored = `pi-news-${id}.jpg`;
        fs.copyFileSync(path.join(IMG, `${img}.jpg`), path.join(dir, 'preview-images', stored));
        cache.cache[`https://${id}.example`] = {
            url: siteUrl(id), title: name, description, image: `/data/preview-images/${stored}`,
            domain: `${id}.example`, imageFetchedAt: at, keywords: [], keywordsAt: at, fetchedAt: at,
        };
    }
    writeJSON(cacheFile, cache);

    // Four weeks of history, so Statistics → Watch feeds has something to show.
    let seed = 11;
    const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    const rates = { northside: 1.6, osw: 0.5, harbor: 0.25, fieldnotes: 0.6, compile: 1.1, quiet: 0.2 };
    const key = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const stats = { since: at - 45 * 86_400_000, prunedOn: key(NOW), feeds: {}, days: {} };
    for (const [id] of SITES) {
        const feed = { days: {}, hours: Array.from({ length: 7 }, () => Array(24).fill(0)) };
        for (let n = 1; n <= 40; n += 1) {
            const d = new Date(NOW);
            d.setDate(d.getDate() - n);
            const wd = (d.getDay() + 6) % 7;
            const lam = rates[id] * (wd >= 5 ? 0.5 : 1);
            const limit = Math.exp(-lam);
            let p = 1;
            let k = 0;
            do { k += 1; p *= rnd(); } while (p > limit);
            const published = k - 1;
            const read = Math.min(published, Math.round(published * (0.55 + rnd() * 0.4)));
            const ms = 80 + Math.round(rnd() * 160) + (id === 'osw' ? 120 : 0);
            const failed = rnd() < 0.02 ? 1 : 0;
            feed.days[key(d)] = {
                ...(published ? { published } : {}), ...(read ? { read } : {}), ok: 24 - failed,
                ...(failed ? { failed, codes: { 503: 1 } } : {}), msSum: ms * 24, msCount: 24, unread: Math.max(0, published - read),
            };
            for (let i = 0; i < published; i += 1) {
                feed.hours[wd][Math.min(23, Math.floor(6 + rnd() * rnd() * 16 + (rnd() < 0.2 ? 8 : 0)))] += 1;
            }
        }
        stats.feeds[`${siteUrl(id).replace(/\/$/, '')}|${feedUrl(id)}`] = feed;
    }
    for (let n = 1; n <= 40; n += 1) {
        const d = new Date(NOW);
        d.setDate(d.getDate() - n);
        stats.days[key(d)] = { rounds: 24 + Math.round(rnd() * 3) };
    }
    writeJSON(path.join(dir, 'feed-stats.json'), stats);
}

/** The feed server: GET /<site>/feed.xml, GET /img/<name>.jpg, GET /__arm (adds the newer stories). */
async function startNewsStub() {
    const port = stubPort();
    const base = `http://127.0.0.1:${port}`;
    let armed = false;
    const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
    const feed = (id) => {
        const f = FEEDS[id];
        const now = Date.now();
        const entries = (armed ? f.fresh.map(([t, img, ago, p1, p2]) => ({ t, img, ago, p1, p2 })) : [])
            .concat(f.old.map(([t, img, ago]) => ({ t, img, ago, p1: 'Earlier story.', p2: '' })));
        return '<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel>'
            + `<title>${esc(f.title)}</title><link>${siteUrl(id)}</link><description>${esc(f.title)}</description>`
            + entries.map((e) => {
                const link = `${siteUrl(id)}${e.t.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 50)}`;
                return `<item><title>${esc(e.t)}</title><link>${link}</link><guid>${link}</guid>`
                    + `<pubDate>${new Date(now - e.ago * MIN).toUTCString()}</pubDate>`
                    + `<enclosure url="${base}/img/${e.img}.jpg" type="image/jpeg" length="60000"/>`
                    + `<description><![CDATA[<p>${e.p1}</p>\n${e.p2 ? `<p>${e.p2}</p>` : ''}]]></description></item>`;
            }).join('')
            + '</channel></rss>';
    };
    const server = http.createServer((req, res) => {
        const u = (req.url || '').split('?')[0];
        if (u === '/__arm') { armed = true; res.end('armed'); return; }
        let m = u.match(/^\/([a-z]+)\/feed\.xml$/);
        if (m && FEEDS[m[1]]) { res.writeHead(200, { 'Content-Type': 'application/rss+xml' }); res.end(feed(m[1])); return; }
        m = u.match(/^\/img\/([a-z-]+)\.jpg$/);
        const picture = m && path.join(IMG, `${m[1]}.jpg`);
        if (picture && fs.existsSync(picture)) { res.writeHead(200, { 'Content-Type': 'image/jpeg' }); fs.createReadStream(picture).pipe(res); return; }
        res.writeHead(404);
        res.end('nope');
    });
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', () => resolve(undefined)); });
    return {
        base,
        arm: () => fetch(`${base}/__arm`),
        close: () => new Promise((resolve) => server.close(() => resolve(undefined))),
    };
}

/**
 * Watch the six feeds (the older entries are the baseline), publish the newer
 * stories and poll once, the way a day on a real install would go.
 * Then one feed is muted, one paused and one given a word filter.
 */
async function watchSites(server, stub) {
    const headers = { 'Content-Type': 'application/json', 'X-NextDash-Token': WRITE_TOKEN };
    const post = async (url, body) => {
        const res = await fetch(`${server.baseURL}${url}`, { method: 'POST', headers, body: JSON.stringify(body) });
        if (!res.ok) throw new Error(`${url} answered ${res.status}: ${await res.text()}`);
        return res;
    };
    for (const [id] of SITES) {
        await post('/api/feeds/watch', { bookmarkUrl: siteUrl(id), feeds: [{ feedUrl: feedUrl(id), intervalMinutes: 60 }] });
    }
    await stub.arm();
    await post('/api/feeds/watch/poll', {});
    const deadline = Date.now() + 20_000;
    for (;;) {
        const state = await (await fetch(`${server.baseURL}/api/feeds/watch`)).json();
        const counts = Object.values(state.watches || {}).map((w) => /** @type {any} */ (w).newCount || 0);
        if (counts.length >= SITES.length && counts.every((n) => n > 0)) break;
        if (Date.now() > deadline) throw new Error('the stub news did not arrive');
        await new Promise((resolve) => setTimeout(resolve, 300));
    }
    // Config → Watch feeds shows what each feed's switches look like.
    await post('/api/feeds/watch/feed', { bookmarkUrl: siteUrl('quiet'), feedUrl: feedUrl('quiet'), muted: true });
    await post('/api/feeds/watch/feed', { bookmarkUrl: siteUrl('fieldnotes'), feedUrl: feedUrl('fieldnotes'), paused: true });
    await post('/api/feeds/watch/feed', { bookmarkUrl: siteUrl('compile'), feedUrl: feedUrl('compile'), include: ['shell', 'terminal'] });
}

const shift = (v, d) => {
    if (Array.isArray(v)) return v.map((x) => shift(x, d));
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, shift(x, d)]));
    if (typeof v === 'number' && v > 1.7e12 && v < 2.1e12) return v - d;
    return v;
};

/**
 * The server stamps news with its own clock, the page reads the shot's clock
 * (the moment the seed was made): the stamps are moved back by the difference,
 * and the feeds' addresses are written as the sites' own.
 */
async function shiftFeedTimes(page) {
    await page.route(/\/api\/feeds\/(watch|stats)/, async (route) => {
        if (route.request().method() !== 'GET') return route.fallback();
        try {
            const response = await route.fetch();
            if (!(response.headers()['content-type'] || '').includes('json')) return await route.fulfill({ response });
            const text = (await response.text()).replace(/http:\/\/127\.0\.0\.1:\d+\/([a-z]+)\/feed\.xml/g, 'https://$1.example/feed.xml');
            return await route.fulfill({ response, json: shift(JSON.parse(text), Math.max(0, Date.now() - NOW.getTime())) });
        } catch { /* page closed */ }
    });
    // The toast that announces news would sit over the corner of the frame.
    await page.addInitScript(() => document.addEventListener('DOMContentLoaded', () => {
        const style = document.createElement('style');
        style.textContent = '#app-notification{display:none !important}';
        document.head.appendChild(style);
    }));
}

module.exports = { SITES, newsData, startNewsStub, watchSites, shiftFeedTimes };
