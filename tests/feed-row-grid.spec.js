// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * The row anatomy is shared by inbox, health and config's bookmarks list.
 * `--grid` carries alignment and density; it must not dictate columns, because
 * `--with-select` needs a checkbox track and the two rules have equal weight.
 */
async function openDashboard(page) {
    await markWhatsNewSeen(page);
    await page.setViewportSize({ width: 1400, height: 900 });
    await page.goto('/');
    await page.waitForSelector('#dashboard-layout', { timeout: 20_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.waitForFunction(() => window.ViewStyles?.ensureViewStyles != null, null, { timeout: 15_000 });
    await page.evaluate(() => window.ViewStyles.ensureViewStyles());
}

const columnsOf = (page, classes) => page.evaluate((cls) => {
    const host = document.createElement('div');
    host.style.width = '900px';
    document.body.appendChild(host);
    const row = document.createElement('article');
    row.className = cls;
    row.innerHTML = '<span>a</span><span>b</span><span>c</span>';
    host.appendChild(row);
    const cols = getComputedStyle(row).gridTemplateColumns;
    host.remove();
    return cols;
}, classes);

test('--grid does not dictate columns', async ({ page }) => {
    await openDashboard(page);
    const plain = await columnsOf(page, 'feed-row');
    const grid = await columnsOf(page, 'feed-row feed-row--grid');
    expect(grid, '--grid changed the column track list').toBe(plain);
});

test('--grid keeps the checkbox column when combined with --with-select', async ({ page }) => {
    await openDashboard(page);
    const select = await columnsOf(page, 'feed-row feed-row--with-select');
    const both = await columnsOf(page, 'feed-row feed-row--with-select feed-row--grid');
    expect(both, 'the checkbox column disappeared under --grid').toBe(select);
    expect(both.split(' ').length, `expected three tracks, got "${both}"`).toBe(3);
});

test('--grid-3 adds a trailing track', async ({ page }) => {
    await openDashboard(page);
    const two = await columnsOf(page, 'feed-row feed-row--grid');
    const three = await columnsOf(page, 'feed-row feed-row--grid feed-row--grid-3');
    expect(three.split(' ').length).toBe(two.split(' ').length + 1);
});

test('--with-select and --grid-3 combine without losing the checkbox column', async ({ page }) => {
    await openDashboard(page);
    // Health's rows carry --with-select and will want --grid-3's trailing
    // column for a score or status pill — the exact pairing that would
    // otherwise repeat the collision --grid was split out to avoid.
    const both = await columnsOf(page, 'feed-row feed-row--with-select feed-row--grid-3');
    const tracks = both.split(' ');
    expect(tracks.length, `expected four tracks, got "${both}"`).toBe(4);
    expect(parseFloat(tracks[0]), `checkbox column should stay first and narrow in "${both}"`)
        .toBeLessThan(parseFloat(tracks[1]));
});

test('--grid-2 is gone from the stylesheet', async ({ page }) => {
    await openDashboard(page);
    const present = await page.evaluate(async () => {
        const href = [...document.styleSheets].map((s) => s.href).filter(Boolean)
            .find((h) => h.includes('feed-row.css') || h.includes('/bundle/'));
        const text = href ? await (await fetch(href)).text() : '';
        return /feed-row--grid-2/.test(text);
    });
    expect(present, '--grid-2 still exists').toBe(false);
});
