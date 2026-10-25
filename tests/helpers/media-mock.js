/*
 * The media widgets' answers for the screenshots.
 *
 * Jellyfin is an outside service, so the two tiles on the dashboard are drawn
 * from made-up answers: the titles are invented and the posters are generated
 * gradients with the title on them, so no real artwork ends up in the manual.
 */
const HOUR = 3600_000;

/** A poster as a data URI: a gradient of one hue with the title set across it. */
function poster(title, hue) {
    const words = title.split(' ');
    const lines = [];
    let line = '';
    for (const word of words) {
        if ((line + ' ' + word).trim().length > 11) {
            lines.push(line.trim());
            line = word;
        } else {
            line = `${line} ${word}`;
        }
    }
    lines.push(line.trim());
    const text = lines.map((l, i) => `<text x="100" y="${150 + (i - (lines.length - 1) / 2) * 30}" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="24" font-weight="700" fill="#fff" fill-opacity=".92">${l}</text>`).join('');
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="300" viewBox="0 0 200 300">`
        + `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${hue},62%,38%)"/><stop offset="1" stop-color="hsl(${(hue + 50) % 360},58%,16%)"/></linearGradient></defs>`
        + `<rect width="200" height="300" fill="url(#g)"/>${text}</svg>`;
    return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

const NOW_PLAYING = [
    { id: 'np1', title: 'Neon Harbor', kind: 'movie', who: 'sam', device: 'Living room TV', method: 'direct',
      progress: 0.42, remaining: 4380, poster: poster('Neon Harbor', 200), openUrl: 'https://jellyfin.example/web/#/details?id=np1' },
    { id: 'np2', title: 'The Last Compile', subtitle: 'S02E04 · Linker Errors', kind: 'episode', who: 'alex', device: 'Jellyfin Web',
      method: 'transcode', paused: true, progress: 0.71, remaining: 1020, poster: poster('The Last Compile', 285), openUrl: 'https://jellyfin.example/web/#/details?id=np2' },
];

const LIBRARY = [
    ['m1', 'Neon Harbor', 'movie', 2031, 'Films', 'lib-movies', 3, 200],
    ['e1', 'The Last Compile', 'episode', 0, 'Series', 'lib-tv', 7, 285],
    ['m2', 'Midnight Kernel', 'movie', 2030, 'Films', 'lib-movies', 11, 15],
    ['m3', 'Packet Storm', 'movie', 2029, 'Films', 'lib-movies', 19, 340],
    ['s1', 'Rust and Rain', 'series', 0, 'Series', 'lib-tv', 26, 150],
    ['m4', 'Cold Boot', 'movie', 2028, 'Films', 'lib-movies', 34, 255],
    ['m5', 'Root Access', 'movie', 2027, 'Films', 'lib-movies', 41, 45],
    ['m6', 'Segfault', 'movie', 2026, 'Films', 'lib-movies', 52, 320],
];

/** What /api/widgets/jellyfin answers: the recently added row. */
function libraryAnswer(now) {
    return {
        fetchedAt: now,
        libraries: [{ id: 'lib-movies', name: 'Films' }, { id: 'lib-tv', name: 'Series' }],
        items: LIBRARY.map(([id, title, kind, year, library, libraryId, hoursAgo, hue]) => ({
            id, title, kind, ...(year ? { year } : {}), library, libraryId,
            ...(kind === 'episode' ? { subtitle: 'S02E05 · Stack Traces' } : {}),
            ...(kind === 'series' ? { newCount: 3 } : {}),
            addedAt: now - hoursAgo * HOUR,
            poster: poster(title, hue),
            openUrl: `https://jellyfin.example/web/#/details?id=${id}`,
        })),
    };
}

/** Answer the Jellyfin tiles with the made-up media above. */
async function mockMedia(page) {
    await page.route('**/api/widgets/jellyfin-playing?*', (route) => route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ fetchedAt: Date.now(), items: NOW_PLAYING }),
    }));
    await page.route('**/api/widgets/jellyfin?*', (route) => route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(libraryAnswer(Date.now())),
    }));
}

module.exports = { mockMedia, poster };
