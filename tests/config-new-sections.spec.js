// @ts-check
const { test, expect } = require('@playwright/test');
const { dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

async function loadDashboard(page) {
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
}

async function openSection(page, section) {
    await page.evaluate((s) => window.dashboardInstance.config.openConfigView(s), section);
}

test.describe('config: sections restored from the old config', () => {
    test('the rail lists every section including bookmarks, stats and help', async ({ page }) => {
        await loadDashboard(page);
        await openSection(page, 'overview');
        for (const s of ['overview', 'pages-tags', 'bookmarks', 'appearance', 'behavior', 'data-backups', 'stats', 'help']) {
            await expect(page.locator(`[data-config-section="${s}"]`)).toBeVisible();
        }
    });

    test('the bookmarks section lists bookmarks and filters by search', async ({ page }) => {
        await loadDashboard(page);
        await openSection(page, 'bookmarks');
        await expect(page.locator('#config-bm-list')).toBeVisible();
        const rows = page.locator('#config-bm-list .config-crud-row');
        const before = await rows.count();
        expect(before).toBeGreaterThan(0);
        await page.fill('#config-bm-search', 'zzz-no-such-bookmark');
        await expect(page.locator('.config-panel-empty')).toBeVisible();
    });

    test('editing a bookmark opens an inline editor', async ({ page }) => {
        await loadDashboard(page);
        await openSection(page, 'bookmarks');
        await page.locator('[data-bm-edit]').first().click();
        await expect(page.locator('.config-bm-editor')).toBeVisible();
        await expect(page.locator('[data-bm-field="name"]')).toBeVisible();
        await expect(page.locator('[data-bm-field="url"]')).toBeVisible();
    });

    /**
     * The row shared its flex container with the expanded editor, which had no
     * wrap, so the summary column collapsed to one character per line. Assert a
     * real width rather than mere visibility — the broken layout was "visible".
     */
    test('bookmark rows keep a readable width, open or closed', async ({ page }) => {
        await loadDashboard(page);
        await openSection(page, 'bookmarks');
        const name = page.locator('.config-bm-name').first();
        expect(await name.evaluate((el) => el.getBoundingClientRect().width)).toBeGreaterThan(120);

        await page.locator('[data-bm-edit]').first().click();
        await expect(page.locator('.config-bm-editor')).toBeVisible();
        expect(await name.evaluate((el) => el.getBoundingClientRect().width)).toBeGreaterThan(120);

        // And the page itself must never scroll sideways because of it.
        const overflow = await page.evaluate(() =>
            document.documentElement.scrollWidth - document.documentElement.clientWidth);
        expect(overflow).toBeLessThanOrEqual(0);
    });

    test('the stats section shows counts derived from the dashboard', async ({ page }) => {
        await loadDashboard(page);
        await openSection(page, 'stats');
        await expect(page.locator('.config-tiles')).toBeVisible();
        const expected = await page.evaluate(() => window.dashboardInstance.allBookmarks.length);
        await expect(page.locator('.config-tile').first()).toContainText(String(expected));
    });

    test('the help section offers whats-new and the cheat sheet', async ({ page }) => {
        await loadDashboard(page);
        await openSection(page, 'help');
        await expect(page.locator('[data-help-action="whats-new"]')).toBeVisible();
        await expect(page.locator('[data-help-action="cheatsheet"]')).toBeVisible();
        await expect(page.locator('.config-help-tips li').first()).toBeVisible();
    });

    test('behavior gained a status & health sub-tab with the webhook', async ({ page }) => {
        await loadDashboard(page);
        await openSection(page, 'behavior');
        await page.locator('[data-behavior-tab="status"]').click();
        await expect(page.locator('[data-behavior-field="statusRecheckIntervalMinutes"]')).toBeVisible();
        await expect(page.locator('[data-behavior-field="monitorNotifyUrl"]')).toBeVisible();
    });

    test('toolbar button toggles restored to the display tab', async ({ page }) => {
        await loadDashboard(page);
        await openSection(page, 'behavior');
        await page.locator('[data-behavior-tab="display"]').click();
        for (const f of ['showRecentButton', 'showCheatSheetButton', 'showConfigButton', 'showHealthDashboard']) {
            await expect(page.locator(`[data-behavior-field="${f}"]`)).toBeVisible();
        }
    });

    test('data & backups gained favicon policy and preview maintenance', async ({ page }) => {
        await loadDashboard(page);
        await openSection(page, 'data-backups');
        await expect(page.locator('[data-backup-select="faviconRefreshPolicy"]')).toBeVisible();
        await expect(page.locator('[data-backup-action="refresh-favicons"]')).toBeVisible();
        await expect(page.locator('[data-backup-action="clear-previews"]')).toBeVisible();
        await expect(page.locator('[data-backup-action="delete-bookmarks"]')).toBeVisible();
    });

    test('collections expose the per-page scope pickers', async ({ page }) => {
        await loadDashboard(page);
        await openSection(page, 'pages-tags');
        await page.locator('[data-pt-tab="collections"]').click();
        await expect(page.locator('[data-scope-field="smartTodayPageIds"]').first()).toBeVisible();
    });
});

/**
 * The status settings are per-install, but what they do depends on each
 * bookmark's availability mode — the webhook is inert unless a bookmark is set
 * to Monitor. The tab has to say so, or the settings read as unconditional.
 */
test.describe('config: status & health explains the modes', () => {
    async function openStatus(page) {
        await loadDashboard(page);
        await openSection(page, 'behavior');
        await page.locator('[data-behavior-tab="status"]').click();
    }

    test('the tab opens with all three modes and what each does', async ({ page }) => {
        await openStatus(page);
        const legend = page.locator('.config-mode-legend');
        await expect(legend).toBeVisible();
        await expect(legend.locator('.config-mode-row')).toHaveCount(3);
        for (const m of ['off', 'periodic', 'monitor']) {
            await expect(legend.locator(`.config-mode-name--${m}`)).toBeVisible();
        }
        // Each mode is described, not just named.
        for (const i of [0, 1, 2]) {
            const hint = await legend.locator('.config-mode-hint').nth(i).textContent();
            expect((hint || '').trim().length).toBeGreaterThan(15);
        }
    });

    test('every settings panel says which modes it applies to', async ({ page }) => {
        await openStatus(page);
        const badges = page.locator('.config-applies-to');
        await expect(badges).toHaveCount(3);
        // The webhook panel is the one that is Monitor-only.
        const texts = await badges.allTextContents();
        expect(texts.some((t) => /monitor only/i.test(t))).toBe(true);
        expect(texts.filter((t) => /periodic/i.test(t)).length).toBe(2);
    });

    test('the alerts panel spells out that Periodic never notifies', async ({ page }) => {
        await openStatus(page);
        const panel = page.locator('.config-panel', { has: page.locator('[data-behavior-field="monitorNotifyUrl"]') });
        await expect(panel.locator('.config-panel-note')).toContainText(/Periodic/);
    });

    test('the legend is only on the status tab', async ({ page }) => {
        await loadDashboard(page);
        await openSection(page, 'behavior');
        await expect(page.locator('.config-mode-legend')).toHaveCount(0);
        await page.locator('[data-behavior-tab="status"]').click();
        await expect(page.locator('.config-mode-legend')).toHaveCount(1);
        await page.locator('[data-behavior-tab="layout"]').click();
        await expect(page.locator('.config-mode-legend')).toHaveCount(0);
    });
});

/**
 * The config view's CSS used fixed rem sizes, so the font-size setting swapped
 * the body class and changed nothing on screen. Measure real computed sizes:
 * the setting "applying" was never the part that was broken.
 */
test.describe('config: font size applies live', () => {
    const sizeOf = (page, sel) =>
        page.locator(sel).first().evaluate((el) => parseFloat(getComputedStyle(el).fontSize));

    test('choosing a larger font grows the config view without a reload', async ({ page }) => {
        await loadDashboard(page);
        await openSection(page, 'appearance');

        await page.evaluate(() => window.dashboardInstance.config.setFontSize('m'));
        const base = {
            title: await sizeOf(page, '.config-view-section-title'),
            nav: await sizeOf(page, '.config-nav-item'),
            panel: await sizeOf(page, '.config-panel-title'),
        };

        await page.locator('[data-appearance-font="xl"]').click();
        await expect.poll(() => page.evaluate(() =>
            document.body.classList.contains('font-size-xl'))).toBe(true);

        expect(await sizeOf(page, '.config-view-section-title')).toBeGreaterThan(base.title);
        expect(await sizeOf(page, '.config-nav-item')).toBeGreaterThan(base.nav);
        expect(await sizeOf(page, '.config-panel-title')).toBeGreaterThan(base.panel);
    });

    test('choosing a smaller font shrinks it again', async ({ page }) => {
        await loadDashboard(page);
        await openSection(page, 'appearance');
        await page.evaluate(() => window.dashboardInstance.config.setFontSize('m'));
        const base = await sizeOf(page, '.config-view-section-title');

        await page.locator('[data-appearance-font="xs"]').click();
        await expect.poll(() => page.evaluate(() =>
            document.body.classList.contains('font-size-xs'))).toBe(true);
        expect(await sizeOf(page, '.config-view-section-title')).toBeLessThan(base);
    });

    test('the size survives reopening the view', async ({ page }) => {
        await loadDashboard(page);
        await openSection(page, 'appearance');
        await page.locator('[data-appearance-font="l"]').click();
        const applied = await sizeOf(page, '.config-view-section-title');

        await openSection(page, 'overview');
        await openSection(page, 'appearance');
        expect(await sizeOf(page, '.config-view-section-title')).toBeCloseTo(applied, 0);
    });
});
