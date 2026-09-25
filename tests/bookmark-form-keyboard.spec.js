// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * The bookmark form, with the keyboard alone.
 *
 * Shift+B opens it, Tab walks the column in order, the page › category field
 * opens and is driven with the keys, a suggested tag is taken with Enter, and
 * Ctrl+Enter saves -- answering the category question with Enter too.
 */
test('add a bookmark from start to finish without the mouse', async ({ page }) => {
    await page.setViewportSize({ width: 1400, height: 900 });
    await markWhatsNewSeen(page);
    await page.route('**/api/bookmark-preview*', (route) => route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({ title: 'Keyboard page', description: 'Typed, not clicked' }),
    }));
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?._bookmarksReady === true, null, { timeout: 20_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    const url = `https://keys.example/${Date.now()}`;
    const category = await page.evaluate(() => {
        const cats = (window.dashboardInstance?.categories || []).filter((c) => !c.isSmartCollection);
        return cats[0] ? { id: String(cats[0].id), name: String(cats[0].name) } : null;
    });
    test.skip(!category, 'page has no categories');

    await page.evaluate(() => document.activeElement?.blur?.());
    await page.keyboard.press('Shift+B');
    await expect(page.locator('#bookmark-form-modal')).toHaveClass(/show/);
    const form = page.locator('#bookmark-form-modal .bookmark-inline-form');
    await expect(form.locator('[data-field="url"]')).toBeFocused();

    await page.keyboard.type(url);
    await page.keyboard.press('Tab');
    await expect(form.locator('[data-field="name"]')).toBeFocused();
    await expect(form.locator('[data-field="name"]')).toHaveValue('Keyboard page');

    // Walk forward to the page › category field with Tab alone.
    for (let i = 0; i < 15; i += 1) {
        const onPlace = await page.evaluate(() => document.activeElement?.classList.contains('bookmark-form-place-value'));
        if (onPlace) break;
        await page.keyboard.press('Tab');
    }
    await expect(form.locator('.bookmark-form-place-value')).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.locator('.bookmark-form-place-pop')).toBeVisible();
    await page.keyboard.type(category.name);
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await expect(page.locator('.bookmark-form-place-pop')).toHaveCount(0);
    await expect(form.locator('.bookmark-form-place-value')).toBeFocused();
    await expect(form.locator('.bookmark-form-place-value')).toContainText(category.name);

    // The next stops are the shortcut and the check choices, reachable in order.
    await page.keyboard.press('Tab');
    await expect(form.locator('input[maxlength="5"]')).toBeFocused();

    await page.keyboard.press('Control+Enter');
    await expect(page.locator('#bookmark-form-modal')).not.toHaveClass(/show/, { timeout: 10_000 });
    await expect.poll(() => page.evaluate((u) => (window.dashboardInstance.allBookmarks || [])
        .find((b) => b.url === u)?.category || '', url)).toBe(category.id);
});

test('the category question, the pencil menu and a suggestion, by keyboard', async ({ page }) => {
    await page.setViewportSize({ width: 1400, height: 900 });
    await markWhatsNewSeen(page);
    await page.route('**/api/bookmark-preview*', (route) => route.fulfill({
        status: 200, contentType: 'application/json', body: JSON.stringify({ title: 'Keys two' }),
    }));
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?._bookmarksReady === true, null, { timeout: 20_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.evaluate(() => {
        const d = window.dashboardInstance;
        d.settings.tagRules = [{ pattern: 'keys2.example', tag: 'keyboard' }];
        window.TagSuggestLive.invalidate();
    });
    const url = `https://keys2.example/${Date.now()}`;
    await page.evaluate(() => document.activeElement?.blur?.());
    await page.keyboard.press('Shift+B');
    const form = page.locator('#bookmark-form-modal .bookmark-inline-form');
    await expect(form.locator('[data-field="url"]')).toBeFocused();
    await page.keyboard.type(url);
    await page.keyboard.press('Tab');
    await expect(form.locator('[data-field="name"]')).toHaveValue('Keys two');

    // The pencil: Enter opens its menu, Tab reaches the items, Escape closes
    // the menu and not the form.
    await form.locator('.bookmark-form-card-pencil').focus();
    await page.keyboard.press('Enter');
    await expect(form.locator('.bookmark-form-card-menu')).toBeVisible();
    await page.keyboard.press('Tab');
    await expect(form.getByRole('menuitem').first()).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(form.locator('.bookmark-form-card-menu')).toBeHidden();
    await expect(page.locator('#bookmark-form-modal')).toHaveClass(/show/);

    // A suggestion is a button: Enter takes it.
    const chip = form.locator('.bookmark-form-tags-suggest .tag-suggest-chip[data-tag="keyboard"] .tag-suggest-chip-add');
    await chip.focus();
    await page.keyboard.press('Enter');
    await expect(form.locator('[data-field="tags"]')).toHaveValue(/keyboard/);

    // No category: the question is answered with Enter.
    await page.keyboard.press('Control+Enter');
    await expect(page.locator('#modal-actions')).toBeVisible();
    // The dialog takes the focus, on the button that answers yes.
    await expect(page.locator('#modal-actions button').first()).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.locator('#bookmark-form-modal')).not.toHaveClass(/show/, { timeout: 10_000 });
    await expect.poll(() => page.evaluate((u) => (window.dashboardInstance.allBookmarks || [])
        .find((b) => b.url === u)?.tags || [], url)).toContain('keyboard');
});

/*
 * The innermost thing goes first, and a question is always on top.
 *
 * Escape with the tag dropdown open asked to discard the form, and the
 * question was drawn under the dropdown it was asking about.
 */
test('Escape closes the tag dropdown before anything else, and a question sits on top', async ({ page }) => {
    await page.setViewportSize({ width: 1400, height: 900 });
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?._bookmarksReady === true, null, { timeout: 20_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    const hasTags = await page.evaluate(() => (window.dashboardInstance.allBookmarks || []).some((b) => (b.tags || []).length));
    test.skip(!hasTags, 'no tags to complete');
    await page.evaluate(() => window.dashboardInstance.openBookmarkFormModal({ mode: 'create' }));
    const form = page.locator('#bookmark-form-modal .bookmark-inline-form');
    await form.locator('[data-field="name"]').fill('Something typed');
    const tags = form.locator('[data-field="tags"]');
    await tags.focus();
    await tags.press('ArrowDown');
    await expect(page.locator('.tag-ac-dropdown')).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(page.locator('.tag-ac-dropdown')).toHaveCount(0);
    await expect(page.locator('#app-modal.show')).toHaveCount(0);

    // Now the form asks, and the question is the topmost thing on screen.
    await tags.press('ArrowDown');
    await page.evaluate(() => { void window.dashboardInstance.inlineEdit?.confirmDiscardInlineEdit?.(); });
    await expect(page.locator('#app-modal.show')).toBeVisible();
    const onTop = await page.evaluate(() => {
        const box = document.querySelector('#app-modal.show .modal')?.getBoundingClientRect()
            || document.querySelector('#app-modal.show').getBoundingClientRect();
        const hit = document.elementFromPoint(box.left + box.width / 2, box.top + 20);
        return Boolean(hit && document.getElementById('app-modal').contains(hit));
    });
    expect(onTop).toBe(true);
});

/*
 * The dashboard stands still behind the form.
 *
 * The form took no scroll lock, so a wheel over it -- or over the page ›
 * category popover, which hangs outside it -- scrolled the dashboard
 * underneath, and the form ended up floating over a different part of it.
 */
test('scrolling over the form and its popover leaves the dashboard where it was', async ({ page }) => {
    await page.setViewportSize({ width: 1400, height: 700 });
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?._bookmarksReady === true, null, { timeout: 20_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    const scrollTop = () => page.evaluate(() => (document.scrollingElement || document.documentElement).scrollTop);
    await page.evaluate(() => window.dashboardInstance.openBookmarkFormModal({ mode: 'create' }));
    const form = page.locator('#bookmark-form-modal .bookmark-inline-form');
    await expect(form).toBeVisible();
    const before = await scrollTop();

    await form.locator('[data-field="url"]').hover();
    await page.mouse.wheel(0, 1200);
    await page.waitForTimeout(300);
    expect(await scrollTop()).toBe(before);

    await form.locator('.bookmark-form-place-value').click();
    await page.locator('.bookmark-form-place-pop').hover();
    await page.mouse.wheel(0, 1200);
    await page.waitForTimeout(300);
    expect(await scrollTop()).toBe(before);
});

/* The form opens on the address, whichever way it was opened. */
test('the form opens with the focus on the address field, adding and editing', async ({ page }) => {
    await page.setViewportSize({ width: 1400, height: 900 });
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?._bookmarksReady === true, null, { timeout: 20_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    const url = page.locator('#bookmark-form-modal [data-field="url"]');

    // The add button in the action bar.
    await page.locator('#quick-add-toolbar-btn').click();
    await expect(page.locator('#bookmark-form-modal')).toHaveClass(/show/);
    await expect(url).toBeFocused();
    await page.locator('#bookmark-form-modal .bookmark-inline-actions .bookmark-inline-action-btn', { hasText: /cancel/i }).click();
    await expect(page.locator('#bookmark-form-modal')).not.toHaveClass(/show/);

    // Editing a row with the keyboard.
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press(';');
    await expect(page.locator('#bookmark-form-modal')).toHaveClass(/show/);
    await expect(url).toBeFocused();
});

/*
 * Tab walks the form and stays in it.
 *
 * Tab in the tags field took the first autocomplete entry whether or not one
 * was chosen, so it filled in tag after tag instead of moving on; and past
 * the last button the focus left the sheet for the dashboard behind it.
 */
test('Tab moves through the tags field, and wraps inside the form', async ({ page }) => {
    await page.setViewportSize({ width: 1400, height: 900 });
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?._bookmarksReady === true, null, { timeout: 20_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    const hasTags = await page.evaluate(() => (window.dashboardInstance.allBookmarks || []).some((b) => (b.tags || []).length));
    test.skip(!hasTags, 'no tags to complete');
    await page.evaluate(() => window.dashboardInstance.openBookmarkFormModal({ mode: 'create' }));
    const form = page.locator('#bookmark-form-modal .bookmark-inline-form');
    const tags = form.locator('[data-field="tags"]');
    // Arriving with Tab opens the list with nothing chosen; the next Tab
    // moves on and fills in nothing.
    await form.locator('[data-field="name"]').focus();
    for (let i = 0; i < 6; i += 1) {
        if (await tags.evaluate((el) => el === document.activeElement)) break;
        await page.keyboard.press('Tab');
    }
    await expect(tags).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowUp');
    await page.keyboard.press('Escape');
    await tags.evaluate((el) => { el.blur(); el.focus(); el.dispatchEvent(new Event('input', { bubbles: true })); });
    await page.keyboard.press('Tab');
    await expect(tags).not.toBeFocused();
    await expect(tags).toHaveValue('');

    // From the last control, Tab comes back to the address, and Shift+Tab goes
    // the other way.
    const save = form.locator('.bookmark-inline-actions .bookmark-inline-save');
    await save.focus();
    await page.keyboard.press('Tab');
    await expect(form.locator('[data-field="url"]')).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(save).toBeFocused();
});

test('Tab from a typed address goes to the name, not to the page behind', async ({ page }) => {
    await page.setViewportSize({ width: 1400, height: 900 });
    await markWhatsNewSeen(page);
    // A slow page: the read is still running when the next Tab comes.
    await page.route('**/api/bookmark-preview*', async (route) => {
        await new Promise((r) => setTimeout(r, 1500));
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ title: 'Slow page' }) });
    });
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?._bookmarksReady === true, null, { timeout: 20_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.evaluate(() => document.activeElement?.blur?.());
    // The + key, the way the toolbar says to.
    await page.keyboard.press('+');
    await expect(page.locator('#bookmark-form-modal')).toHaveClass(/show/);
    const form = page.locator('#bookmark-form-modal .bookmark-inline-form');
    const url = form.locator('[data-field="url"]');
    await expect(url).toBeFocused();
    await page.keyboard.type(`https://slow.example/${Date.now()}`);
    await page.keyboard.press('Tab');
    await expect(form.locator('[data-field="name"]')).toBeFocused();
    // And every further Tab stays in the sheet.
    for (let i = 0; i < 20; i += 1) {
        await page.keyboard.press('Tab');
        const inside = await page.evaluate(() => Boolean(document.activeElement?.closest('#bookmark-form-modal')));
        expect(inside).toBe(true);
    }
});
