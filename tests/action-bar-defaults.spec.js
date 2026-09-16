// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays, waitForConfigReady } = require('./e2e-helpers');

/**
 * The action bar and the header panel, each setting explained and each one
 * undoable.
 *
 * Both panels were built from toggles the code called self-describing: "Show
 * the recent button" says what the button is, not what it does or which key
 * does the same thing without it. Every control in the two panels carries an ℹ
 * now, and every one has a default recorded — which is what draws the ↺.
 */
/*
 * Add and search are the two verbs the bar keeps.
 *
 * Tags, recents, the cheat sheet and pages each open a panel, and the search
 * panel names all four along its foot -- so none of them ships as a button.
 * Every one keeps its key and its toggle; see launcher-header.spec.js.
 */
const ACTION_BAR = [
    ['showAddBookmarkButton', true],
    ['showSearchButton', true],
    ['showCommandsButton', false],
    ['showFindersButton', false],
    ['showTagCloudButton', false],
    ['showRecentButton', false],
    ['showPagesButton', false],
    ['showCollapseAllButton', false],
    ['showCheatSheetButton', false],
];

const HEADER_PANEL = [
    ['showPageTabs', true],
    ['showPageNamesInTabs', false],
    ['pageSwitcherStyle', 'text'],
    ['maxPageTabs', 4],
    ['showTitle', true],
    ['showDashboardButton', true],
    ['showInboxButton', true],
    ['showHealthDashboard', true],
    ['showConfigButton', true],
];

async function openTab(page, tab) {
    await page.setViewportSize({ width: 1500, height: 900 });
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForSelector('.bookmark-link', { timeout: 20_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await waitForConfigReady(page);
    await page.evaluate(() => window.dashboardInstance.config.openConfigView('appearance'));
    await page.waitForSelector('.config-view', { timeout: 20_000 });
    await page.locator(`[data-appearance-tab="${tab}"]`).click();
    await expect(page.locator(`[data-appearance-tab="${tab}"]`)).toHaveAttribute('aria-selected', 'true');
    await page.waitForTimeout(200);
}

const affordances = (page, fields) => page.evaluate((names) => names.map((field) => ({
    field,
    info: Boolean(document.querySelector(`[data-info-field="${field}"]`)),
    reset: Boolean(document.querySelector(`[data-reset-field="${field}"]`)),
})), fields);

test('every action-bar setting explains itself and can be put back', async ({ page }) => {
    await openTab(page, 'buttonbar');

    const seen = await affordances(page, ACTION_BAR.map(([field]) => field));
    expect(seen.filter((f) => !f.info).map((f) => f.field), 'no ℹ for these').toEqual([]);
    expect(seen.filter((f) => !f.reset).map((f) => f.field), 'no ↺ for these').toEqual([]);
});

test('every header setting explains itself and can be put back', async ({ page }) => {
    await openTab(page, 'header');

    const seen = await affordances(page, HEADER_PANEL.map(([field]) => field));
    expect(seen.filter((f) => !f.info).map((f) => f.field), 'no ℹ for these').toEqual([]);
    expect(seen.filter((f) => !f.reset).map((f) => f.field), 'no ↺ for these').toEqual([]);
});

test('the ℹ opens something with words in it', async ({ page }) => {
    await openTab(page, 'buttonbar');

    await page.locator('[data-info-field="showRecentButton"]').click();
    await expect(page.locator('#app-modal .modal-text')).toContainText(/\*/);
    await page.keyboard.press('Escape');
});

test('the defaults are the ones the two panels are drawn from', async ({ page }) => {
    await openTab(page, 'buttonbar');

    const defs = await page.evaluate((fields) => {
        const meta = window.DashboardConfig.FIELD_META;
        return fields.map((field) => [field, meta[field]?.def]);
    }, [...ACTION_BAR, ...HEADER_PANEL].map(([field]) => field));

    expect(Object.fromEntries(defs)).toEqual(
        Object.fromEntries([...ACTION_BAR, ...HEADER_PANEL]),
    );
});

test('a fresh install is already on those defaults', async ({ page }) => {
    await openTab(page, 'buttonbar');

    const stored = await page.evaluate(async () => {
        const api = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
        return (await api('/api/settings')).json();
    });

    const wrong = [...ACTION_BAR, ...HEADER_PANEL]
        .filter(([field, def]) => stored[field] !== def)
        .map(([field, def]) => `${field}: ${stored[field]} (want ${def})`);
    expect(wrong, 'the server ships something else').toEqual([]);
});
