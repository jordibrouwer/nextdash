// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * The bar shows a handful of actions and folds the rest behind one control.
 *
 * It can hold nine buttons and most readers use three or four, so a reader who
 * switches several on gets a row of near-identical glyphs -- the thing this
 * header was rebuilt to stop being. Past the reader's own cap the rest stand
 * behind a control that says how many it holds, the same bargain the page tabs
 * make with their "+N" chip.
 *
 * The folded buttons are still there, hidden: the menu opens them by pressing
 * them, so what each action does is written once. And the keys never cared
 * where the button was.
 */

async function openWithActions(page, { cap = 4 } = {}) {
    await page.setViewportSize({ width: 1500, height: 900 });
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForSelector('.bookmark-link', { timeout: 20_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    // These specs measure the actions in the header; a fresh install docks
    // them at the bottom now.
    await page.evaluate(async () => {
        const d = window.dashboardInstance;
        d.settings.actionBarPosition = 'header';
        d.setupDOM?.();
        await d.saveSettings?.();
    });
    await page.evaluate(async (max) => {
        const d = window.dashboardInstance;
        Object.assign(d.settings, {
            showAddBookmarkButton: true,
            showSearchButton: true,
            showCommandsButton: true,
            showFindersButton: true,
            showRecentButton: true,
            showCheatSheetButton: true,
            showPagesButton: true,
            maxHeaderActions: max,
        });
        d.setupDOM?.();
        await d.saveSettings?.();
    }, cap);
    await page.waitForTimeout(400);
}

const bar = (page) => page.evaluate(() => {
    /*
     * What is on the bar is what is drawn, not what is unmarked: the fold is a
     * class, and a rule elsewhere can out-shout it. Asking the class would have
     * agreed with the fold about a button the reader could still see.
     */
    const drawn = (btn) => window.getComputedStyle(btn).display !== 'none';
    const buttons = [...document.querySelectorAll('.header-shortcuts button.search-button')]
        .filter((btn) => !btn.classList.contains('header-action-overflow'));
    const chip = document.querySelector('.header-action-overflow');
    return {
        shown: buttons.filter(drawn).length,
        folded: buttons.filter((btn) => btn.classList.contains('is-folded')).map((btn) => btn.id),
        chip: chip?.querySelector('.header-action-overflow-count')?.textContent?.trim() || null,
        // Last on the row: the buttons are placed with `order`, so being the
        // last child is not the same as standing last.
        chipIsLast: chip
            ? buttons.filter(drawn).every((btn) => btn.getBoundingClientRect().x < chip.getBoundingClientRect().x)
            : false,
    };
});

test('past the cap the rest fold behind a control that counts them', async ({ page }) => {
    await openWithActions(page, { cap: 4 });

    const seen = await bar(page);
    expect(seen.shown, `${seen.shown} actions on the bar`).toBe(4);
    expect(seen.folded.length, 'nothing was folded away').toBeGreaterThan(0);
    expect(seen.chip, 'the control does not say how many it holds').toBe(`+${seen.folded.length}`);
    expect(seen.chipIsLast, 'the control is not at the end of the row').toBe(true);

    // Raising the cap puts them back on the bar.
    await page.evaluate(async () => {
        const d = window.dashboardInstance;
        d.settings.maxHeaderActions = 8;
        d.setupDOM?.();
        await d.saveSettings?.();
    });
    await page.waitForTimeout(300);

    const wide = await bar(page);
    expect(wide.folded.length, 'the actions stayed folded with room for them').toBe(0);
    expect(wide.chip, 'the control is still there with nothing behind it').toBeNull();
});

test('two is a cap the reader may choose', async ({ page }) => {
    await openWithActions(page, { cap: 2 });

    const seen = await bar(page);
    expect(seen.shown, `${seen.shown} actions on the bar`).toBe(2);
    expect(seen.chip, 'nothing folded at a cap of two').toBe(`+${seen.folded.length}`);

    // Below zero it stops: the floor is an empty bar, not a negative one.
    await page.evaluate(async () => {
        const d = window.dashboardInstance;
        d.settings.maxHeaderActions = -1;
        d.setupDOM?.();
        await d.saveSettings?.();
    });
    await page.waitForTimeout(300);
    expect((await bar(page)).shown, 'the bar went below its floor').toBe(0);
});

/*
 * Zero is an answer.
 *
 * A reader who drives the dashboard by key has no use for the row at all, and
 * zero used to be read as "never set" and turned back into four. Set through
 * the field in Config, the way a reader does it.
 */
test('zero from Config puts every action behind the control', async ({ page }) => {
    await openWithActions(page, { cap: 2 });
    await page.keyboard.press('Shift+Comma');
    await page.click('[data-config-section="appearance"]');
    await page.click('[data-appearance-tab="header"]');
    const field = page.locator('xpath=//input[@type="number" and @data-behavior-field="maxHeaderActions"]');
    await expect(field).toHaveAttribute('min', '0');
    await field.fill('0');
    await field.press('Tab');
    await expect.poll(() => page.evaluate(() => window.dashboardInstance.settings.maxHeaderActions)).toBe(0);

    // The first Escape goes from the group back to the tiles.
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    const seen = await bar(page);
    expect(seen.shown, `${seen.shown} actions on the bar`).toBe(0);
    expect(seen.chip, 'the control does not hold every action').toBe(`+${seen.folded.length}`);
    expect(seen.folded.length).toBeGreaterThan(0);

    // And it survives a reload: the server keeps zero rather than the default.
    await page.reload();
    await page.waitForSelector('.bookmark-link', { timeout: 20_000 });
    await expect.poll(() => page.evaluate(() => window.dashboardInstance.settings.maxHeaderActions)).toBe(0);
});

/*
 * Whatever folds, the two that make something stay.
 *
 * Add comes first because it is the one that makes something, then search --
 * the order the bar has always drawn them in. The fold takes from the end, so
 * a cap of two leaves exactly those two: what a reader loses to the menu is
 * the tail of the row, never its head.
 */
test('add and search are the two that stay on the bar', async ({ page }) => {
    for (const cap of [2, 3, 4]) {
        await openWithActions(page, { cap });
        const first = await page.evaluate(() => [...document.querySelectorAll('.header-shortcuts button.search-button')]
            .filter((btn) => !btn.classList.contains('header-action-overflow'))
            .filter((btn) => !btn.classList.contains('is-folded')
                && window.getComputedStyle(btn).display !== 'none')
            .sort((a, b) => a.getBoundingClientRect().x - b.getBoundingClientRect().x)
            .slice(0, 2)
            .map((btn) => btn.querySelector('.search-button-icon')?.textContent?.trim()));
        expect(first, `at a cap of ${cap} the bar starts with ${first.join(' ')}`).toEqual(['+', '>']);
    }
});

/*
 * And the cap holds in a view as well.
 *
 * In config, health and the inbox the tag cloud has nothing to filter, so its
 * button keeps its place with `display: inline-flex !important` rather than
 * letting the row shift under the reader. That beat the fold's own rule: at a
 * cap of two the bar drew three buttons the moment you left the dashboard.
 */
test('a folded action stays folded in a view', async ({ page }) => {
    await openWithActions(page, { cap: 2 });
    await page.evaluate(async () => {
        const d = window.dashboardInstance;
        d.settings.showTagCloudButton = true;
        d.setupDOM?.();
        await d.saveSettings?.();
    });
    await page.waitForTimeout(300);

    expect((await bar(page)).shown, 'the cap does not hold on the dashboard').toBe(2);

    await page.evaluate(() => window.dashboardInstance.config.openConfigView());
    await page.waitForSelector('.config-view', { timeout: 20_000 });
    await page.waitForTimeout(600);

    const inView = await bar(page);
    expect(inView.shown, `${inView.shown} actions on the bar in config`).toBe(2);
    expect(inView.folded, 'the tag cloud button came back out of the fold')
        .toContain('tag-cloud-toggle-btn');
});

test('the menu presses the button it names', async ({ page }) => {
    await openWithActions(page, { cap: 3 });

    await page.locator('.header-action-overflow').click();
    await page.waitForSelector('.header-action-menu', { timeout: 10_000 });

    const menu = await page.evaluate(() => {
        const el = document.querySelector('.header-action-menu');
        const chip = document.querySelector('.header-action-overflow');
        return {
            role: el.getAttribute('role'),
            expanded: chip.getAttribute('aria-expanded'),
            below: Math.round(el.getBoundingClientRect().top) >= Math.round(chip.getBoundingClientRect().bottom),
            rows: [...el.querySelectorAll('.header-action-item')].map((row) => ({
                name: row.querySelector('.header-action-item-name')?.textContent?.trim(),
                key: row.querySelector('.header-action-item-key')?.textContent?.trim(),
            })),
            folded: [...document.querySelectorAll('.header-shortcuts .is-folded')].length,
        };
    });

    expect(menu.role, 'the folded actions are not a menu').toBe('menu');
    expect(menu.expanded, 'the control does not say it is open').toBe('true');
    expect(menu.below, 'the menu does not hang from the control').toBe(true);
    expect(menu.rows.length, 'the menu holds a different number than it folded').toBe(menu.folded);
    // Each row names the action and the key that does the same thing.
    expect(menu.rows.every((row) => row.name && row.key), 'a row is missing its name or its key').toBe(true);

    // Pressing a row does what the button does: the cheat sheet row opens the sheet.
    const cheat = page.locator('.header-action-item', { hasText: 'cheat' });
    await cheat.click();
    await expect(page.locator('.cheat-sheet-group').first(), 'the row did not press the button').toBeVisible();
    expect(await page.locator('.header-action-menu').count(), 'the menu stayed open').toBe(0);
});

test('a switched-off action is in neither place, and its key still works', async ({ page }) => {
    await openWithActions(page, { cap: 3 });

    await page.evaluate(async () => {
        const d = window.dashboardInstance;
        d.settings.showCheatSheetButton = false;
        d.setupDOM?.();
        await d.saveSettings?.();
    });
    await page.waitForTimeout(300);

    const gone = await page.evaluate(() => ({
        onBar: window.getComputedStyle(document.getElementById('help-button')).display,
        folded: document.getElementById('help-button')?.classList.contains('is-folded'),
    }));
    expect(gone.onBar, 'a switched-off action is still on the bar').toBe('none');
    expect(gone.folded, 'a switched-off action was folded instead of dropped').toBe(false);

    await page.locator('.header-action-overflow').click();
    await page.waitForSelector('.header-action-menu');
    const names = await page.evaluate(() => [...document.querySelectorAll('.header-action-item-name')]
        .map((el) => el.textContent.trim()));
    expect(names.join(' '), 'the switched-off action is in the menu').not.toContain('cheat');

    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);

    // The keys never cared where the button was, or whether there is one.
    await page.keyboard.press('!');
    await expect(page.locator('.cheat-sheet-group').first(), 'the key stopped working').toBeVisible();
});

test('the arrows walk the menu and escape hands the focus back', async ({ page }) => {
    await openWithActions(page, { cap: 3 });

    const chip = page.locator('.header-action-overflow');
    await chip.click();
    await page.waitForSelector('.header-action-menu');
    await expect.poll(() => page.evaluate(
        () => document.activeElement?.className || ''), { timeout: 5_000 })
        .toContain('header-action-item');

    await page.keyboard.press('ArrowDown');
    const second = await page.evaluate(() => document.activeElement?.textContent?.trim());
    await page.keyboard.press('ArrowUp');
    const first = await page.evaluate(() => document.activeElement?.textContent?.trim());
    expect(second, 'the arrows do not walk the menu').not.toBe(first);

    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
    const after = await page.evaluate(() => ({
        open: !!document.querySelector('.header-action-menu'),
        focused: document.activeElement?.className || '',
        expanded: document.querySelector('.header-action-overflow')?.getAttribute('aria-expanded'),
    }));
    expect(after.open, 'escape left the menu open').toBe(false);
    expect(after.focused, 'the focus was dropped somewhere else').toContain('header-action-overflow');
    expect(after.expanded, 'the control still says it is open').toBe('false');
});
