// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissBlockingOverlays, dismissOnboardingIfPresent } = require('./e2e-helpers');

/**
 * A bare : opens the palette with the commands already listed: what was run
 * lately and what is run most on top, then every group open.
 */

async function dashboard(page, seed) {
    await page.setViewportSize({ width: 1400, height: 900 });
    await markWhatsNewSeen(page);
    await page.addInitScript((s) => {
        try {
            localStorage.setItem('dashboardRecentCommands', JSON.stringify(s.recent));
            localStorage.setItem('dashboardCommandUses', JSON.stringify(s.uses));
        } catch (_e) { /* ignore */ }
    }, seed || { recent: [], uses: {} });
    await page.goto('/');
    await page.waitForSelector('#dashboard-layout', { timeout: 20_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.waitForFunction(() => window.dashboardInstance?.searchComponent?.commandsComponent != null, null, { timeout: 20_000 });
}

const rows = (page) => page.evaluate(() => window.dashboardInstance.searchComponent.searchMatches.map((m) => ({
    type: m.type, groupId: m.groupId || '', expanded: m.expanded, queries: m.queries || null, sections: m.sections || null,
})));

test('a lone : lists the commands, every group open', async ({ page }) => {
    await dashboard(page);
    await page.keyboard.type(':');
    await expect.poll(async () => (await rows(page)).filter((r) => r.type === 'command-completion').length, { timeout: 10_000 }).toBeGreaterThan(20);
    const headers = (await rows(page)).filter((r) => r.type === 'command-group-header');
    expect(headers.length).toBeGreaterThan(2);
    expect(headers.every((h) => h.expanded === true)).toBe(true);
});

test('the recent and the most used commands lead the list', async ({ page }) => {
    await dashboard(page, { recent: [':theme', ':backup'], uses: { theme: 5, health: 3, backup: 1 } });
    await page.keyboard.type(':');
    await expect.poll(async () => (await rows(page)).length, { timeout: 10_000 }).toBeGreaterThan(5);
    const list = await rows(page);
    const chips = list.filter((r) => r.type === 'command-chips');
    // One row: recent first, then most used (run twice or more; backup once does not count).
    expect(chips).toHaveLength(1);
    expect(chips[0].queries).toEqual([':theme', ':backup', ':theme', ':health']);
    expect(chips[0].sections.map((s) => s.count)).toEqual([2, 2]);
    const first = list.findIndex((r) => r.type === 'command-completion');
    expect(list.findIndex((r) => r.type === 'command-chips')).toBeLessThan(first);
});

test('running a command counts toward the most used', async ({ page }) => {
    await dashboard(page);
    const uses = await page.evaluate(() => {
        const s = window.dashboardInstance.searchComponent;
        s.recordRecentCommand(':theme dark');
        s.recordRecentCommand(':theme light');
        return { stored: JSON.parse(localStorage.getItem('dashboardCommandUses')), most: s.mostUsedCommands() };
    });
    expect(uses.stored.theme).toBe(2);
    expect(JSON.stringify(uses.stored)).not.toContain('dark');
    expect(uses.most).toContain(':theme');
});

test('a group the reader closes stays closed until the next key', async ({ page }) => {
    await dashboard(page);
    await page.keyboard.type(':');
    await expect.poll(async () => (await rows(page)).filter((r) => r.type === 'command-completion').length, { timeout: 10_000 }).toBeGreaterThan(20);
    const before = (await rows(page)).filter((r) => r.type === 'command-completion').length;
    const gid = (await rows(page)).find((r) => r.type === 'command-group-header' && r.expanded && !r.groupId.startsWith('palette_')).groupId;
    await page.evaluate((id) => { const s = window.dashboardInstance.searchComponent; s.commandsComponent.toggleGroup(id); s.updateSearch(); }, gid);
    await expect.poll(async () => (await rows(page)).filter((r) => r.type === 'command-completion').length).toBeLessThan(before);
});

test('an empty > shows the recent and the most used commands as open badge lists', async ({ page }) => {
    await dashboard(page, { recent: [':theme', ':backup'], uses: { theme: 5, health: 3 } });
    await page.keyboard.type('>');
    await expect(page.locator('#shortcut-search.show')).toBeVisible({ timeout: 10_000 });
    const chips = page.locator('#shortcut-search .search-command-chip, #shortcut-search [class*="chip"]');
    await expect.poll(() => chips.count(), { timeout: 10_000 }).toBeGreaterThanOrEqual(4);
    const texts = (await chips.allInnerTexts()).map((s) => s.trim());
    expect(texts).toEqual(expect.arrayContaining([':theme', ':backup', ':health']));
    const labels = (await page.locator('#shortcut-search .search-chip-col-label').allInnerTexts()).join(' | ');
    expect(labels).toMatch(/Recent commands/i);
    expect(labels).toMatch(/Most used/i);
});

test('the two lists stand side by side on one line', async ({ page }) => {
    await dashboard(page, { recent: [':theme', ':backup'], uses: { theme: 5, health: 3 } });
    await page.keyboard.type(':');
    const cols = page.locator('#shortcut-search .search-chip-col');
    await expect(cols).toHaveCount(2, { timeout: 10_000 });
    const [a, b] = await Promise.all([cols.nth(0).boundingBox(), cols.nth(1).boundingBox()]);
    expect(Math.abs(a.y - b.y), 'the lists are not on one line').toBeLessThan(4);
    expect(b.x).toBeGreaterThan(a.x + a.width - 2);
    await expect(cols.nth(0).locator('.search-chip-col-label')).toHaveText(/Recent commands/i);
    await expect(cols.nth(1).locator('.search-chip-col-label')).toHaveText(/Most used/i);
    // And the same in the empty > search.
    await page.keyboard.press('Backspace');
    await page.keyboard.type('>');
    await expect(page.locator('#shortcut-search .search-chip-col')).toHaveCount(2, { timeout: 10_000 });
});
