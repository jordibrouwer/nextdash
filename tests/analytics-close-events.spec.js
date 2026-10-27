// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * How a form or a modal goes away, as events with fixed words.
 *
 * One bookmark edit in three was never saved and nothing said why; the What's
 * New modal had an open event and no close. These pin the new events and that
 * an edit refused by its own checks no longer counts as an edit.
 */

async function ready(page) {
    await markWhatsNewSeen(page);
    await page.setViewportSize({ width: 1400, height: 900 });
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?._bookmarksReady === true, null, { timeout: 20_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.evaluate(() => {
        window.__tracks = [];
        window.nextdashTrack = (name, props) => window.__tracks.push({ name, props });
    });
}

const tracks = (page) => page.evaluate(() => window.__tracks || []);

async function openEdit(page) {
    await page.evaluate(() => {
        const dash = window.dashboardInstance;
        dash.openBookmarkFormModal({ mode: 'edit', bookmark: dash.bookmarks[0], source: 'dashboard' });
    });
    await expect(page.locator('#bookmark-form-modal')).toHaveClass(/show/);
}

test('closing an untouched edit form says how, and that nothing changed', async ({ page }) => {
    await ready(page);
    await openEdit(page);
    await page.locator('#bookmark-form-modal .bookmark-form-modal-close').click();
    await expect(page.locator('#bookmark-form-modal')).not.toHaveClass(/show/);

    const seen = (await tracks(page)).filter((t) => t.name === 'bookmark:edit-close');
    expect(seen).toHaveLength(1);
    expect(seen[0].props).toMatchObject({ result: 'untouched', via: 'x', source: 'dashboard', open: '<5s' });
});

test('an edit the form refuses is not counted as an edit', async ({ page }) => {
    await ready(page);
    // A shortcut another bookmark already holds: the form passes its own
    // required-field checks and is then turned down by the uniqueness check.
    const taken = await page.evaluate(() => {
        const list = window.dashboardInstance.bookmarks;
        const other = list.slice(1).find((b) => b.shortcut);
        return other ? other.shortcut : '';
    });
    test.skip(!taken, 'the seed has no second bookmark with a shortcut');
    await openEdit(page);
    const form = page.locator('#bookmark-form-modal .bookmark-inline-form');
    await form.locator('[data-field="shortcut"]').fill(taken);
    await form.locator('.bookmark-inline-actions .bookmark-inline-save').click();

    await expect.poll(async () => (await tracks(page)).some((t) => t.name === 'bookmark:edit-invalid')).toBe(true);
    const seen = await tracks(page);
    expect(seen.find((t) => t.name === 'bookmark:edit-invalid').props).toEqual({ reason: 'shortcut' });
    expect(seen.some((t) => t.name === 'bookmark:edit')).toBe(false);
});

test('the What’s New modal reports how it closed and whether it opened itself', async ({ page }) => {
    await ready(page);
    await page.evaluate(() => window.openWhatsNewModal({ force: true }));
    await expect(page.locator('#app-modal .whats-new-modal')).toBeVisible();
    await page.evaluate(() => window.AppModal.hide());

    await expect.poll(async () => (await tracks(page)).some((t) => t.name === 'whats-new:closed')).toBe(true);
    const seen = await tracks(page);
    expect(seen.find((t) => t.name === 'modal:whats-new').props).toEqual({ auto: false });
    const closed = seen.filter((t) => t.name === 'whats-new:closed');
    expect(closed).toHaveLength(1);
    expect(closed[0].props).toMatchObject({ via: 'dismiss', auto: false });
    expect(['<2s', '<10s', '<30s', '30s+']).toContain(closed[0].props.after);
});
