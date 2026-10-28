// @ts-check
const { test, expect } = require('./fixtures');
const { dismissOnboardingIfPresent, dismissBlockingOverlays, markWhatsNewSeen, openConfigPanel } = require('./e2e-helpers');

/**
 * Config → Appearance and Behavior open straight on a tab of settings.
 *
 * They opened on a start screen of tiles for a while, with each group split
 * into a few cards and "More settings" -- an extra click in, a second layer
 * inside, and settings that could not be found without guessing the tile.
 * What this pins is the way back to plain tabs: every setting of a tab on the
 * tab, the preview beside Appearance following the tab, and the filter saying
 * where else a setting lives.
 */

async function open(page, hash) {
    await markWhatsNewSeen(page);
    await page.goto(`/${hash}`);
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await expect.poll(() => page.evaluate(() => window.dashboardInstance.activeView)).toBe('config');
}

const hash = (page) => page.evaluate(() => window.location.hash);

test('Appearance opens on its first tab, with the settings already there', async ({ page }) => {
    await open(page, '#config/appearance');
    await expect(page.locator('[data-appearance-tab]')).toHaveText(
        ['Theme', 'Background', 'Surfaces', 'Layout', 'Rows', 'Previews', 'Header', 'Action bar', 'Date & weather']);
    await expect(page.locator('[data-appearance-tab="general"]')).toHaveAttribute('aria-selected', 'true');
    // The first panel is open; the rest fold until their header is clicked.
    await expect(page.locator('[data-appearance-select="theme"], [data-theme-picker-button]').first()).toBeVisible();
    await openConfigPanel(page, 'Type');
    await expect(page.locator('[data-appearance-select="fontPreset"]')).toBeVisible();
    await expect(page.locator('.config-preview')).toHaveAttribute('data-preview-focus', 'all');
});

test('Behavior has four tabs, and the moved settings are where the tabs say', async ({ page }) => {
    await open(page, '#config/behavior');
    await expect(page.locator('[data-behavior-tab]')).toHaveText(
        ['General', 'Keyboard & search', 'Fresh', 'Privacy & sync']);

    await page.locator('[data-behavior-tab="search"]').click();
    await expect(page.locator('[data-behavior-field="globalShortcuts"]')).toBeVisible();
    await page.locator('[data-behavior-tab="fresh"]').click();
    await expect(page.locator('[data-behavior-field="feedsEnabled"]')).toBeVisible();
    await page.locator('[data-behavior-tab="privacy"]').click();
    await expect(page.locator('[data-behavior-field="enableSessionTips"]')).toBeVisible();
    await expect(page.locator('[data-behavior-field="deviceSpecificSettings"]')).toBeVisible();
});

test('Monitoring has Checks, Notifications and Schedules, each with its settings', async ({ page }) => {
    await open(page, '#config/behavior');
    await page.locator('[data-config-section="monitoring"]').click();
    await expect(page.locator('[data-monitoring-tab]')).toHaveText(['Checks', 'Notifications', 'Schedules']);
    await expect(page.locator('[data-monitoring-tab="checks"]')).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('[data-behavior-field="skipFastPing"]')).toBeVisible();
    await expect.poll(() => hash(page)).toBe('#config/monitoring/checks');

    await page.locator('[data-monitoring-tab="notifications"]').click();
    await expect(page.locator('[data-behavior-field="pushNotifyEnabled"]')).toBeVisible();
    await expect(page.locator('[data-behavior-field="digestWeekday"]')).toBeVisible();
    await expect.poll(() => hash(page)).toBe('#config/monitoring/notifications');

    await page.locator('[data-monitoring-tab="schedules"]').click();
    await expect(page.locator('[data-behavior-field="quietHoursEnabled"]')).toBeVisible();
    await expect(page.locator('#config-monitoring-body .config-panel-title', { hasText: 'Maintenance windows' })).toBeVisible();
    await expect(page.locator('[data-behavior-field="skipFastPing"]')).toHaveCount(0);
});

test('an old tab link opens the tab that holds its settings now', async ({ page }) => {
    // Inbox & Fresh was the tab's name while it held the inbox's settings too.
    await open(page, '#config/behavior/inbox');
    await expect(page.locator('[data-behavior-tab="fresh"]')).toHaveAttribute('aria-selected', 'true');
    await expect.poll(() => hash(page)).toBe('#config/behavior/fresh');

    // Status & alerts was split in Behavior, then left for Monitoring: all
    // three of its old addresses land there, and the bar says where.
    for (const [old, tab] of [['status', 'checks'], ['checks', 'checks'], ['notifications', 'notifications']]) {
        await page.goto(`/#config/behavior/${old}`);
        await expect(page.locator(`[data-monitoring-tab="${tab}"]`)).toHaveAttribute('aria-selected', 'true');
        await expect.poll(() => hash(page)).toBe(`#config/monitoring/${tab}`);
    }

    await page.goto('/#config/appearance/grid');
    await expect(page.locator('[data-appearance-tab="layout"]')).toHaveAttribute('aria-selected', 'true');
});

test('a cold load of an old Status & alerts link lands on Monitoring', async ({ page }) => {
    await open(page, '#config/behavior/notifications');
    await expect.poll(() => page.evaluate(() => window.dashboardInstance.config.section)).toBe('monitoring');
    await expect(page.locator('[data-monitoring-tab="notifications"]')).toHaveAttribute('aria-selected', 'true');
});

test('setting an old Behavior tab and opening Behavior opens Monitoring', async ({ page }) => {
    // News entries and scripts do it in this order: the tab, then the section.
    await open(page, '#config/overview');
    await page.evaluate(() => {
        const c = window.dashboardInstance.config;
        c.behaviorTab = 'status';
        return c.openConfigView('behavior');
    });
    await expect(page.locator('[data-monitoring-tab="checks"]')).toHaveAttribute('aria-selected', 'true');
    // Once: Behavior itself still opens afterwards.
    await page.locator('[data-config-section="behavior"]').click();
    await expect(page.locator('[data-behavior-tab]').first()).toBeVisible();
});

test('the tab last looked at is where the section opens next time', async ({ page }) => {
    await open(page, '#config/appearance');
    await page.locator('[data-appearance-tab="display"]').click();
    await expect(page.locator('[data-appearance-tab="display"]')).toHaveAttribute('aria-selected', 'true');

    // A later visit, past the five minutes config remembers its location for:
    // that entry is gone before the page runs, so only the tab memory is left.
    const later = await page.context().newPage();
    await later.addInitScript(() => localStorage.removeItem('nextdash:config-last-location-v1'));
    await later.goto('/#config/appearance');
    await expect(later.locator('[data-appearance-tab="display"]')).toHaveAttribute('aria-selected', 'true');
});

test('a tab remembered more than five minutes ago opens on the first tab', async ({ page }) => {
    // Six minutes old on load, and a bare string from before the expiry:
    // both start the section from its first tab. Inbox, because Appearance
    // has a promo that steers to its first tab on its own.
    await page.addInitScript(() => {
        localStorage.removeItem('nextdash:config-last-location-v1');
        localStorage.setItem('nextdash:config-tab-v1', JSON.stringify({
            inbox: 'icon',
            behavior: { tab: 'privacy', savedAt: Date.now() - 6 * 60 * 1000 },
        }));
    });
    await open(page, '#config/inbox');
    await expect(page.locator('[data-inbox-tab="collecting"]')).toHaveAttribute('aria-selected', 'true');
    await page.locator('[data-config-section="behavior"]').click();
    await expect(page.locator('[data-behavior-tab="general"]')).toHaveAttribute('aria-selected', 'true');
});

test('a tab expires while the page stays open', async ({ page }) => {
    // Choose a tab, leave the section, let the memory age past five minutes,
    // come back without a reload. Inbox, because Appearance has a promo that
    // steers to its first tab on its own.
    await open(page, '#config/inbox');
    await page.locator('[data-inbox-tab="icon"]').click();
    await expect(page.locator('[data-inbox-tab="icon"]')).toHaveAttribute('aria-selected', 'true');
    await page.locator('[data-config-section="overview"]').click();
    await page.evaluate(() => {
        const stored = JSON.parse(localStorage.getItem('nextdash:config-tab-v1'));
        stored.inbox.savedAt = Date.now() - 6 * 60 * 1000;
        localStorage.setItem('nextdash:config-tab-v1', JSON.stringify(stored));
    });
    await page.locator('[data-config-section="inbox"]').click();
    await expect(page.locator('[data-inbox-tab="collecting"]')).toHaveAttribute('aria-selected', 'true');
});

test('the preview follows the tab and the setting', async ({ page }) => {
    await open(page, '#config/appearance/buttonbar');
    const preview = page.locator('.config-preview');
    await expect(preview).toHaveAttribute('data-preview-focus', 'actions');

    await page.locator('[data-appearance-tab="layout"]').click();
    await expect(preview).toHaveAttribute('data-preview-focus', 'grid');
    const columns = page.locator('input[data-behavior-field="columnsPerRow"]');
    await columns.fill('5');
    await columns.dispatchEvent('change');
    await expect(preview).toHaveAttribute('data-preview-cols', '5');

    // Behavior has no preview.
    await page.goto('/#config/behavior');
    await expect(page.locator('[data-behavior-tab]').first()).toBeVisible();
    await expect(page.locator('.config-preview')).toHaveCount(0);
});

test('every schema setting carries a short line saying what it does', async ({ page }) => {
    await open(page, '#config/appearance/header');
    const row = page.locator('[data-behavior-field="showPageTabs"]').locator('xpath=ancestor::div[contains(@class,"config-field-row")]');
    // In Appearance the line sits inside the row, beside the control, and
    // carries its whole sentence as a title for when the line is cut short.
    const hint = row.locator(':scope > .config-field-hint');
    await expect(hint).toHaveCount(1);
    await expect(hint).toHaveAttribute('title', /\S/);
});

test('the filter names the other tabs a setting is on, and goes there', async ({ page }) => {
    await open(page, '#config/behavior/general');
    const filter = page.locator('[data-settings-filter]');
    await filter.fill('keyboard');
    const elsewhere = page.locator('[data-filter-elsewhere="search"]');
    await expect(elsewhere).toBeVisible();
    await elsewhere.click();

    await expect(page.locator('[data-behavior-tab="search"]')).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('[data-behavior-field="globalShortcuts"]')).toBeVisible();
    await expect(page.locator('[data-settings-filter]')).toHaveValue('keyboard');
});

/**
 * The bar in the band takes input.
 *
 * The band is filled after the panels are bound, so the filter field and the
 * "Only changed" button were written into a head nobody came back to: both
 * looked alive and neither reached the config object. The filter's symptom was
 * a tab that said nothing matched while the word was in the box.
 */
test('the filter and the changed toggle in the band are wired up', async ({ page }) => {
    await open(page, '#config/behavior/general');

    await page.locator('[data-settings-filter]').fill('keyboard');
    await expect.poll(() => page.evaluate(() =>
        window.dashboardInstance.config.settingsFilter), { timeout: 5_000 }).toBe('keyboard');

    await page.locator('[data-settings-filter]').fill('');
    await expect.poll(() => page.evaluate(() =>
        window.dashboardInstance.config.settingsFilter), { timeout: 5_000 }).toBe('');

    const toggle = page.locator('[data-config-action="toggle-changed"]');
    if (await toggle.isEnabled()) {
        await toggle.click();
        await expect.poll(() => page.evaluate(() =>
            window.dashboardInstance.config.changedOnly === true), { timeout: 5_000 }).toBe(true);
    }
});

test.describe('a tab kept only for the page expires too', () => {
    // Bookmarks keeps its tab for the life of the page, not in the browser.
    // The clock runs on, so the five minutes are real time to the page.
    test('back after more than five minutes opens the first tab', async ({ page }) => {
        await page.clock.install();
        await open(page, '#config/bookmarks');
        await page.locator('[data-bm-tab="tags"]').click();
        await expect(page.locator('[data-bm-tab="tags"]')).toHaveAttribute('aria-selected', 'true');
        await page.locator('[data-config-section="overview"]').click();
        await page.clock.fastForward('06:00');
        await page.locator('[data-config-section="bookmarks"]').click();
        await expect(page.locator('[data-bm-tab="view"]')).toHaveAttribute('aria-selected', 'true');
    });

    test('reading one tab for a while does not count as gone', async ({ page }) => {
        await page.clock.install();
        await open(page, '#config/bookmarks');
        await page.locator('[data-bm-tab="tags"]').click();
        await page.clock.fastForward('10:00');
        await page.locator('[data-config-section="overview"]').click();
        await page.locator('[data-config-section="bookmarks"]').click();
        await expect(page.locator('[data-bm-tab="tags"]')).toHaveAttribute('aria-selected', 'true');
    });
});

test.describe('a tab strip too long for the window', () => {
    test.use({ viewport: { width: 800, height: 900 } });

    test('stays on one line, scrolls, and shows the open tab', async ({ page }) => {
        await open(page, '#config/behavior/privacy');
        await expect(page.locator('[data-behavior-tab="privacy"]')).toHaveAttribute('aria-selected', 'true');

        // Too long for the window is a property of the strip against its room, not of a
        // typeface: Inter sets the four tabs tighter than the mono did and they fit at
        // 800px. Give the strip less room than they need and let it settle.
        await page.evaluate(() => {
            document.querySelector('[data-behavior-tab]').parentElement.style.maxWidth = '260px';
            window.dashboardInstance.config.syncSubtabStrips();
        });

        const strip = await page.evaluate(() => {
            const el = document.querySelector('[data-behavior-tab]').parentElement;
            const box = el.getBoundingClientRect();
            const active = el.querySelector('[aria-selected="true"]').getBoundingClientRect();
            return {
                rows: new Set([...el.children].map((tab) => Math.round(tab.getBoundingClientRect().top))).size,
                scrollable: el.scrollWidth > el.clientWidth,
                activeInView: active.left >= box.left - 1 && active.right <= box.right + 1,
                fadeBefore: el.classList.contains('has-more-before'),
                pageScrollsSideways: document.documentElement.scrollWidth > window.innerWidth,
            };
        });
        expect(strip).toEqual({ rows: 1, scrollable: true, activeInView: true, fadeBefore: true, pageScrollsSideways: false });
    });
});

test('Health settings in the Bookmarks view open Monitoring → Checks', async ({ page }) => {
    const { openBookmarksWithHealth } = require('./helpers/bookmarks-health');
    await openBookmarksWithHealth(page);
    await page.locator('.config-view--library [data-bm-header-more]').click();
    await page.locator('[data-bm-header-menu] [data-bm-header-action="settings"]').click();
    await expect(page.locator('[data-monitoring-tab="checks"]')).toHaveAttribute('aria-selected', 'true');
    await expect.poll(() => hash(page)).toBe('#config/monitoring/checks');
});

test.describe('a saved place on an old Status & alerts tab', () => {
    const saved = (subTab) => JSON.stringify({ section: 'behavior', subTab, savedAt: Date.now() });

    test('a cold load of bare #config opens it on Monitoring', async ({ page }) => {
        await page.addInitScript((value) => {
            localStorage.setItem('nextdash:config-last-location-v1', value);
        }, saved('notifications'));
        await open(page, '#config');
        await expect(page.locator('[data-monitoring-tab="notifications"]')).toHaveAttribute('aria-selected', 'true');
        await expect.poll(() => hash(page)).toBe('#config/monitoring/notifications');
    });

    test('opening config from the dashboard opens it on Monitoring', async ({ page }) => {
        await markWhatsNewSeen(page);
        await page.goto('/');
        await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
        await dismissOnboardingIfPresent(page);
        await dismissBlockingOverlays(page);
        await page.evaluate((value) => localStorage.setItem('nextdash:config-last-location-v1', value), saved('status'));
        await page.locator('.config-link-anchor').click();
        await expect(page.locator('[data-monitoring-tab="checks"]')).toHaveAttribute('aria-selected', 'true');
        await expect.poll(() => hash(page)).toBe('#config/monitoring/checks');
    });
});
