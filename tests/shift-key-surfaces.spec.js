// @ts-check
const { test, expect } = require('./fixtures');
const { dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * The places that quote a key say the keys of today: the cheat sheet registry
 * (what the sheet, the printable sheet and the dock list), the dashboard and
 * Inbox legends. Glances' own letters did not move; its legend is asserted in
 * dashboard-glances-view.spec.js.
 */
async function load(page) {
    await page.setViewportSize({ width: 1400, height: 900 });
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0 && window.KeyboardCheatSheetRegistry, null, { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
}

/** Every key string the registry's rows (and nested legend sources) carry. */
function registryKeys(page) {
    return page.evaluate(() => {
        const out = [];
        const take = (rows) => (rows || []).forEach((r) => { if (r.keys) out.push(String(r.keys)); });
        for (const section of window.KeyboardCheatSheetRegistry.SECTIONS) {
            take(section.rows);
        }
        return out;
    });
}

test('the cheat sheet lists the keys of today and none of the retired ones', async ({ page }) => {
    await load(page);
    const keys = await registryKeys(page);
    const has = (needle) => keys.some((k) => k.includes(needle));
    for (const now of ['Shift + B', 'Shift + C (no row selected)', 'Shift + E (no row selected)', 'Shift + N',
        'Shift + W (no block selected)', 'Shift + P (no row selected)', 'Shift + Q', 'Shift + S', 'Shift + H', 'Shift + X (no row selected)']) {
        expect(has(now), `missing ${now}`).toBe(true);
    }
    for (const gone of ['Shift + Y', 'Shift + J', 'Shift + L', 'Shift + Z']) {
        expect(keys.some((k) => k === gone || k.startsWith(`${gone} `)), `still lists ${gone}`).toBe(false);
    }
    // Shift + H is the key legend on the grid; in the Bookmarks view the row's own health keeps it.
    expect(keys.filter((k) => /^Shift \+ H\b/.test(k) && !k.startsWith('Shift + Home')).sort())
        .toEqual(['Shift + H', 'Shift + H (on a row)']);
});

test('the Inbox legend has t for tags and f for triage, and no l', async ({ page }) => {
    await load(page);
    const rows = await page.evaluate(() => window.KeyboardViewLegends.INBOX_VIEW.map((r) => [r.keys, r.fallback]));
    expect(rows.find(([, label]) => label === 'tags')?.[0]).toBe('t');
    expect(rows.find(([, label]) => label === 'triage')?.[0]).toBe('f');
    expect(rows.map(([k]) => k)).not.toContain('l');
});

test('the dashboard legend names the keys of today and no retired key', async ({ page }) => {
    await load(page);
    const keys = await page.evaluate(() => window.KeyboardViewLegends.DASHBOARD_VIEW.map((r) => r.keys));
    for (const now of ['Shift+W', 'Shift+N', 'Shift+B', 'Shift+I', ',', 'Shift+S', 'Shift+Q', 'Shift+H']) expect(keys).toContain(now);
    for (const gone of ['Shift+Y', 'Shift+J', 'Shift+L', 'Shift+Z']) expect(keys).not.toContain(gone);
});
