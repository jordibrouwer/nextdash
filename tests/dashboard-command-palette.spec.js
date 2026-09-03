// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissOnboardingIfPresent } = require('./e2e-helpers');

const COMMAND_PALETTE_PROMO_KEYS = [
    'nextdash:dashboard-quick-tag-promo-confirmed-v1',
    'nextdash:dashboard-search-promo-command-v1',
];

async function dismissBlockingOverlays(page) {
    const whatsNew = page.locator('#app-modal.show');
    if (await whatsNew.count()) {
        await page.keyboard.press('Escape');
        await expect(whatsNew).toHaveCount(0, { timeout: 3000 });
    }
    await page.evaluate(() => window.dashboardInstance?.searchComponent?.closeSearch?.());
    const searchPromo = page.locator('.dashboard-search-promo');
    if (await searchPromo.count()) {
        await searchPromo.locator('button').first().click();
        await expect(searchPromo).toHaveCount(0, { timeout: 3000 });
    }
}

/*
 * Wait until the palette has actually produced the match being aimed at.
 *
 * Typing is not the same as matching: the list is rebuilt as the query changes,
 * and every test here that went from `type()` straight to Enter -- or straight
 * to selectCommandMatch -- was racing that rebuild. Enter arriving early
 * completes the command instead of running it, which the "Enter after command
 * completion" test below pins as real behaviour, and selectCommandMatch threw
 * `command match not found`. Both are the same missed beat, so waiting for it
 * is the fix in one place.
 */
async function waitForCommandMatch(page, { stateId, shortcut, meta } = {}) {
    await expect(page.locator('#shortcut-search.show')).toBeVisible({ timeout: 5000 });
    await expect.poll(() => page.evaluate(({ stateId, shortcut, meta }) => {
        const sc = window.dashboardInstance?.searchComponent;
        return (sc?.selectableMatches || []).some((match) => {
            if (stateId && match?.stateId === stateId) return true;
            if (shortcut && String(match?.shortcut || '').toUpperCase() === String(shortcut).toUpperCase()) {
                if (meta == null) return match?.type === 'command';
                return String(match?.meta || '') === String(meta);
            }
            return false;
        });
    }, { stateId, shortcut, meta }), { timeout: 5000 }).toBe(true);
}

async function selectCommandMatch(page, { stateId, shortcut, meta } = {}) {
    await waitForCommandMatch(page, { stateId, shortcut, meta });
    await page.evaluate(({ stateId, shortcut, meta }) => {
        const sc = window.dashboardInstance?.searchComponent;
        const idx = sc?.selectableMatches?.findIndex((match) => {
            if (stateId && match?.stateId === stateId) return true;
            if (shortcut && String(match?.shortcut || '').toUpperCase() === String(shortcut).toUpperCase()) {
                if (meta == null) return match?.type === 'command';
                return String(match?.meta || '') === String(meta);
            }
            return false;
        }) ?? -1;
        if (idx < 0) {
            throw new Error(`command match not found (${stateId || shortcut || 'unknown'})`);
        }
        sc.selectedMatchIndex = idx;
        sc.updateSelectionHighlight();
    }, { stateId, shortcut, meta });
}

test.describe('dashboard command palette', () => {
    test.describe.configure({ mode: 'serial' });

    test.beforeEach(async ({ page }) => {
        await markWhatsNewSeen(page, { extraPromoConfirmedKeys: COMMAND_PALETTE_PROMO_KEYS });
        await page.goto('/');
        await page.waitForSelector('.bookmark-link', { timeout: 15_000 });
        await dismissOnboardingIfPresent(page);
        await page.evaluate(() => {
            document.dispatchEvent(new CustomEvent('nextdash:find', { detail: { query: '' } }));
            window.dashboardInstance?._tagPopoverCleanup?.();
            window.dashboardInstance?._movePopoverCleanup?.();
            window.dashboardInstance?._deletePopoverCleanup?.();
            window.dashboardInstance?.searchComponent?.closeSearch?.();
        });
        await dismissBlockingOverlays(page);
    });

    test(':buttons add toggles add button on Enter', async ({ page }) => {
        const visibleBefore = await page.locator('#quick-add-toolbar-btn').isVisible();

        await page.keyboard.press(':');
        await page.keyboard.type('buttons add', { delay: 20 });
        await expect(page.locator('#shortcut-search.show')).toBeVisible({ timeout: 5000 });
        await selectCommandMatch(page, { stateId: 'buttons:add' });
        await page.keyboard.press('Enter');

        await expect.poll(async () => page.locator('#quick-add-toolbar-btn').isVisible(), {
            timeout: 10_000,
        }).not.toBe(visibleBefore);
    });

    test('Enter after command completion executes on next press', async ({ page }) => {
        const visibleBefore = await page.locator('#quick-add-toolbar-btn').isVisible();

        await page.keyboard.press(':');
        await page.keyboard.type('button', { delay: 20 });
        /*
         * Deliberately not waited for beyond the palette being up: the first
         * Enter is supposed to arrive while `button` is still an incomplete
         * command, so that it completes rather than runs. Waiting for the match
         * makes the first press execute and the second toggle it straight back,
         * which is the one arrangement this test cannot use.
         */
        await expect(page.locator('#shortcut-search.show')).toBeVisible({ timeout: 3000 });
        await page.keyboard.press('Enter');
        await page.keyboard.press('Enter');

        await expect.poll(async () => page.locator('#quick-add-toolbar-btn').isVisible()).not.toBe(visibleBefore);
    });

    test('Enter works when match row has focus', async ({ page }) => {
        const visibleBefore = await page.locator('#quick-add-toolbar-btn').isVisible();

        await page.keyboard.press(':');
        await page.keyboard.type('buttons add', { delay: 20 });
        await waitForCommandMatch(page, { stateId: 'buttons:add' });
        await page.locator('.search-match.command-entry').first().focus();
        await page.keyboard.press('Enter');

        await expect.poll(async () => page.locator('#quick-add-toolbar-btn').isVisible()).not.toBe(visibleBefore);
    });

    test(':buttons cheatsheet stays open and label updates after toggle', async ({ page }) => {
        await page.keyboard.press(':');
        await page.keyboard.type('buttons cheatsheet', { delay: 20 });
        await waitForCommandMatch(page, { shortcut: ':buttons' });

        const row = page.locator('.search-match.command-entry').first();
        const before = await row.innerText();
        await page.keyboard.press('Enter');

        await expect(page.locator('#shortcut-search.show')).toBeVisible();
        await expect.poll(async () => row.innerText()).not.toBe(before);
    });

    test(':page switches page and keeps palette open', async ({ page }) => {
        const pageCount = await page.evaluate(() => window.dashboardInstance?.pages?.length || 0);
        test.skip(pageCount < 2, 'needs at least two pages');

        const targetName = await page.evaluate(() => {
            const dash = window.dashboardInstance;
            const other = dash.pages.find((p) => !dash.samePageId(p.id, dash.currentPageId));
            return other?.name || '';
        });
        test.skip(!targetName, 'no alternate page');

        await page.keyboard.press(':');
        await page.keyboard.type(`page ${targetName}`, { delay: 15 });
        await waitForCommandMatch(page, { shortcut: ':page' });
        await page.keyboard.press('Enter');

        await expect(page.locator('#shortcut-search.show')).toBeVisible();
        await expect.poll(async () => page.evaluate((name) => {
            const dash = window.dashboardInstance;
            const current = dash.pages.find((p) => dash.samePageId(p.id, dash.currentPageId));
            return current?.name === name;
        }, targetName)).toBe(true);
    });

    test(':cheat closes palette and opens cheat sheet', async ({ page }) => {
        await page.keyboard.press(':');
        await page.keyboard.type('cheat', { delay: 20 });
        await selectCommandMatch(page, { shortcut: ':cheat' });
        await page.keyboard.press('Enter');

        await expect(page.locator('#shortcut-search.show')).toHaveCount(0);
        await expect(page.locator('#app-modal.show .keyboard-cheat-sheet-modal')).toBeVisible({ timeout: 3000 });
    });

    test(':help is an alias for :cheat', async ({ page }) => {
        await page.keyboard.press(':');
        await page.keyboard.type('help', { delay: 20 });
        // Same command behind a second name, so the same match is waited for.
        await selectCommandMatch(page, { shortcut: ':cheat' });
        await page.keyboard.press('Enter');

        await expect(page.locator('#shortcut-search.show')).toHaveCount(0);
        await expect(page.locator('#app-modal.show .keyboard-cheat-sheet-modal')).toBeVisible({ timeout: 3000 });
    });

    test(':cheat sheet lists health and inbox view sections', async ({ page }) => {
        await page.keyboard.press(':');
        await page.keyboard.type('cheat', { delay: 20 });
        await selectCommandMatch(page, { shortcut: ':cheat' });
        await page.keyboard.press('Enter');
        const sheet = page.locator('#app-modal.show .keyboard-cheat-sheet-modal');
        await expect(sheet).toBeVisible({ timeout: 3000 });
        await expect(sheet.locator('summary', { hasText: /Health view/i })).toBeVisible();
        await expect(sheet.locator('summary', { hasText: /Inbox view/i })).toBeVisible();
        // Rows live inside collapsed <details>, so the health section has to be
        // opened before any of its lines can be visible.
        await sheet.locator('summary', { hasText: /Health view/i }).click();
        await expect(sheet.getByText(/refresh report|Refresh the cached/i).first()).toBeVisible();
    });

    test(':overview closes palette and opens page overview', async ({ page }) => {
        const pageCount = await page.evaluate(() => window.dashboardInstance?.pages?.length || 0);
        test.skip(pageCount < 1, 'needs at least one page');

        await page.keyboard.press(':');
        await page.keyboard.type('overview', { delay: 20 });
        await selectCommandMatch(page, { shortcut: ':overview' });
        await page.keyboard.press('Enter');

        await expect(page.locator('#shortcut-search.show')).toHaveCount(0);
        await expect(page.locator('#app-modal.show .page-overview-modal')).toBeVisible({ timeout: 5000 });
    });

    test(':find clear removes find-hidden tiles', async ({ page }) => {
        await page.keyboard.press(':');
        await page.keyboard.type('find test-filter-xyz', { delay: 15 });
        await waitForCommandMatch(page, { shortcut: ':find' });
        await page.keyboard.press('Enter');

        await page.waitForFunction(() => (
            document.querySelectorAll('#dashboard-layout .bookmark-link.find-hidden').length > 0
        ), null, { timeout: 3000 });

        await page.keyboard.press('Escape');
        await page.keyboard.press(':');
        await page.keyboard.type('find clear', { delay: 15 });
        await selectCommandMatch(page, { stateId: 'find:clear' });
        await page.keyboard.press('Enter');

        await expect.poll(async () => page.evaluate(() => (
            document.querySelectorAll('#dashboard-layout .bookmark-link.find-hidden').length
        ))).toBe(0);
    });

    test(':category jumps to first category', async ({ page }) => {
        const categoryCount = await page.evaluate(() => (
            document.querySelectorAll('.category[data-category-id]:not([data-collapsed="true"])').length
        ));
        test.skip(categoryCount < 1, 'needs at least one expanded category');

        await page.keyboard.press(':');
        await page.keyboard.type('category 1', { delay: 15 });
        await expect(page.locator('#shortcut-search.show')).toBeVisible({ timeout: 5000 });
        await selectCommandMatch(page, { shortcut: ':CATEGORY', meta: '1' });
        await page.keyboard.press('Enter');

        await expect(page.locator('#shortcut-search.show')).toHaveCount(0, { timeout: 5000 });
        await expect.poll(async () => {
            const index = await page.evaluate(() => (
                window.dashboardInstance?.keyboardNavigation?.currentIndex ?? -1
            ));
            return index >= 0;
        }, { timeout: 10_000 }).toBe(true);
    });

    test('lone colon shows five command groups', async ({ page }) => {
        await page.keyboard.press(':');
        await expect(page.locator('#shortcut-search.show')).toBeVisible({ timeout: 3000 });
        await expect(page.locator('.search-command-group-header')).toHaveCount(5);
    });

    test(':dark toggles auto dark mode', async ({ page }) => {
        const before = await page.evaluate(() => window.dashboardInstance?.settings?.autoDarkMode === true);

        await page.keyboard.press(':');
        await page.keyboard.type(before ? 'dark off' : 'dark on', { delay: 15 });
        await waitForCommandMatch(page, { shortcut: ':dark' });
        await page.keyboard.press('Enter');

        await expect.poll(async () => page.evaluate(() => (
            window.dashboardInstance?.settings?.autoDarkMode === true
        ))).toBe(!before);
    });

    test(':collections toggles start today collection', async ({ page }) => {
        const before = await page.evaluate(() => (
            window.dashboardInstance?.settings?.showSmartTodayCollection !== false
        ));

        await page.keyboard.press(':');
        await page.keyboard.type(before ? 'collections today off' : 'collections today on', { delay: 15 });
        await waitForCommandMatch(page, { shortcut: ':collections' });
        await page.keyboard.press('Enter');

        await expect.poll(async () => page.evaluate(() => (
            window.dashboardInstance?.settings?.showSmartTodayCollection !== false
        ))).toBe(!before);
    });
});
