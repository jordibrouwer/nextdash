// @ts-check
const { test, expect } = require('./fixtures');
const { dismissOnboardingIfPresent, dismissBlockingOverlays, markWhatsNewSeen } = require('./e2e-helpers');

/**
 * The one-time coach notes: a balloon that points at a place on the dashboard.
 * Two of them exist, the bell's and the action bar's; they share one helper
 * (coach-note.js), show one at a time, and the action bar's waits for the bell's.
 * The test setup marks both seen before every load (they cover corners other
 * tests click), so each test asks for them again as a fresh install would.
 */

const BELL = 'nextdash:bell-intro-seen';
const BAR = 'nextdash:action-bar-intro-seen';

async function load(page) {
    await page.setViewportSize({ width: 1500, height: 900 });
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0 && window.CoachNote, null, { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.evaluate(() => {
        // Marks stay in the page: the tests share ./data with the dev server.
        window.DiscoverabilityState.schedulePersist = () => {};
        window.dashboardInstance.settings.enableSessionTips = false;
    });
}

/** Forget what the setup marked, for the given notes, and ask for them in this order. */
async function ask(page, ids) {
    await page.evaluate((list) => {
        const keys = { 'bell-intro': 'nextdash:bell-intro-seen', 'action-bar-intro': 'nextdash:action-bar-intro-seen' };
        list.forEach((id) => {
            localStorage.removeItem(keys[id]);
            window.DiscoverabilityState.resetSettingPromoSeen(id, { persist: false });
        });
        list.forEach((id) => window.CoachNote.schedule(id));
    }, ids);
}

/** Where the bar stands, the way the "Action bar" commands put it. */
async function placeBar(page, position, enabled = true, seconds = 0) {
    await page.evaluate(({ position: p, enabled: e, seconds: sec }) => {
        const d = window.dashboardInstance;
        d.settings.actionBarPosition = p;
        d.settings.actionBarEnabled = e;
        d.settings.actionBarAutoHideSeconds = sec;
        d.setupDOM();
    }, { position, enabled, seconds });
}

const note = (page, id) => page.locator(`.coach-note[data-coach-note="${id}"]`);

/** Waits out the grow animation, then returns the note's box, its side and where the arrow lands. */
async function arrowOf(page, id) {
    const n = note(page, id);
    await expect(n).toHaveClass(/is-placed/);
    await page.waitForFunction((sel) => {
        const node = document.querySelector(sel);
        return node && node.getAnimations().every((a) => a.playState === 'finished');
    }, `.coach-note[data-coach-note="${id}"]`);
    return n.evaluate((node) => {
        const r = node.getBoundingClientRect();
        const along = parseFloat(getComputedStyle(node).getPropertyValue('--coach-arrow'));
        const side = node.dataset.side;
        return { rect: { left: r.left, top: r.top, right: r.right, bottom: r.bottom }, side, x: r.left + along, y: r.top + along };
    });
}

test.describe('coach notes', () => {
    test('the bell note comes first; the action bar note only after Got it', async ({ page }) => {
        await load(page);
        await placeBar(page, 'right');
        await ask(page, ['bell-intro', 'action-bar-intro']);
        await expect(note(page, 'bell-intro')).toBeVisible({ timeout: 8000 });
        await expect(note(page, 'bell-intro')).toContainText('Your notifications');
        // Not in the same moment, nor a little later while the first is up.
        await page.waitForTimeout(4500);
        await expect(note(page, 'action-bar-intro')).toHaveCount(0);
        await note(page, 'bell-intro').getByRole('button', { name: 'Got it' }).click();
        await expect(note(page, 'bell-intro')).toHaveCount(0);
        await expect(note(page, 'action-bar-intro')).toBeVisible({ timeout: 8000 });
        await expect(note(page, 'action-bar-intro')).toContainText('Your action bar');
        await expect(page.locator('.header-shortcuts')).toHaveClass(/coach-note-anchor-frame/);
        await note(page, 'action-bar-intro').getByRole('button', { name: 'Got it' }).click();
        await expect(note(page, 'action-bar-intro')).toHaveCount(0);
        await expect(page.locator('.header-shortcuts')).not.toHaveClass(/coach-note-anchor-(ring|frame)/);
        expect(await page.evaluate(() => window.DiscoverabilityState.hasSeenSettingPromo('action-bar-intro'))).toBe(true);
        expect(await page.evaluate((k) => localStorage.getItem(k), BAR)).toBe('1');
    });

    for (const [position, side] of [['right', 'left'], ['left', 'right'], ['bottom', 'above'], ['header', 'below']]) {
        test(`with the bar ${position === 'header' ? 'in the header' : `docked ${position}`} the note stands ${side} of it, outlining the whole bar`, async ({ page }) => {
            await load(page);
            await placeBar(page, position);
            await ask(page, ['action-bar-intro']);
            await expect(note(page, 'action-bar-intro')).toBeVisible({ timeout: 8000 });
            const bar = await page.locator('.header-shortcuts').boundingBox();
            const got = await arrowOf(page, 'action-bar-intro');
            expect(got.side).toBe(side);
            if (side === 'left') expect(got.rect.right).toBeLessThanOrEqual(bar.x);
            if (side === 'right') expect(got.rect.left).toBeGreaterThanOrEqual(bar.x + bar.width);
            if (side === 'above') expect(got.rect.bottom).toBeLessThanOrEqual(bar.y);
            if (side === 'below') expect(got.rect.top).toBeGreaterThanOrEqual(bar.y + bar.height);
            // Next to the bar, a small gap, and no arrow: the whole bar is outlined.
            const gap = side === 'left' ? bar.x - got.rect.right
                : side === 'right' ? got.rect.left - (bar.x + bar.width)
                    : side === 'above' ? bar.y - got.rect.bottom : got.rect.top - (bar.y + bar.height);
            expect(gap).toBeGreaterThan(4);
            expect(gap).toBeLessThan(30);
            await expect(page.locator('.header-shortcuts')).toHaveClass(/coach-note-anchor-frame/);
            expect(await note(page, 'action-bar-intro').evaluate((n) => ({
                none: n.dataset.arrow, shown: getComputedStyle(n, '::before').display,
            }))).toEqual({ none: 'none', shown: 'none' });
            const outline = await page.locator('.header-shortcuts').evaluate((n) => getComputedStyle(n).outlineStyle);
            expect(outline).toBe('solid');
            // The balloon is centred on the bar where it fits.
            if (side === 'above' || side === 'below') {
                const mid = (got.rect.left + got.rect.right) / 2;
                expect(Math.abs(mid - (bar.x + bar.width / 2))).toBeLessThan(4);
            } else {
                const mid = (got.rect.top + got.rect.bottom) / 2;
                expect(Math.abs(mid - (bar.y + bar.height / 2))).toBeLessThan(4);
            }
            // Eight pixels inside the window at least.
            expect(got.rect.left).toBeGreaterThanOrEqual(8);
            expect(got.rect.right).toBeLessThanOrEqual(1500 - 8);
            expect(got.rect.top).toBeGreaterThanOrEqual(8);
            expect(got.rect.bottom).toBeLessThanOrEqual(900 - 8);
        });
    }

    test('behind the menu the note outlines the bar with the menu in it', async ({ page }) => {
        await load(page);
        await placeBar(page, 'menu');
        await expect(page.locator('.header-action-overflow')).toBeVisible();
        await ask(page, ['action-bar-intro']);
        await expect(note(page, 'action-bar-intro')).toBeVisible({ timeout: 8000 });
        await expect(page.locator('.header-shortcuts')).toHaveClass(/coach-note-anchor-frame/);
        const bar = await page.locator('.header-shortcuts').boundingBox();
        const got = await arrowOf(page, 'action-bar-intro');
        expect(got.side).toBe('below');
        expect(got.rect.top).toBeGreaterThanOrEqual(bar.y + bar.height);
    });

    test('a bar that is switched off shows no note and is not counted as seen', async ({ page }) => {
        await load(page);
        await placeBar(page, 'right', false);
        await ask(page, ['action-bar-intro']);
        // Checks that nothing shows: the note is not due before onboarding, so give it time to wrongly appear.
        await page.waitForTimeout(5000);
        await expect(note(page, 'action-bar-intro')).toHaveCount(0);
        expect(await page.evaluate(() => window.DiscoverabilityState.hasSeenSettingPromo('action-bar-intro'))).toBe(false);
        expect(await page.evaluate((k) => localStorage.getItem(k), BAR)).toBeNull();
        // Switched on again, the note comes.
        await placeBar(page, 'right', true);
        await expect(note(page, 'action-bar-intro')).toBeVisible({ timeout: 8000 });
    });

    test('a dock that slid into its edge is brought out and framed while the note is up', async ({ page }) => {
        await load(page);
        await placeBar(page, 'right', true, 1);
        const hidden = () => page.evaluate(() => document.body.hasAttribute('data-action-bar-hidden'));
        await expect.poll(hidden, { timeout: 5000 }).toBe(true);
        await ask(page, ['action-bar-intro']);
        await expect(note(page, 'action-bar-intro')).toBeVisible({ timeout: 8000 });
        expect(await hidden()).toBe(false);
        await expect(page.locator('.header-shortcuts')).toHaveClass(/coach-note-anchor-frame/);
        // Well past its delay of one second, the bar is still out.
        await page.waitForTimeout(3000);
        expect(await hidden()).toBe(false);
        const bar = await page.locator('.header-shortcuts').boundingBox();
        const got = await arrowOf(page, 'action-bar-intro');
        expect(got.side).toBe('left');
        expect(got.rect.right).toBeLessThanOrEqual(bar.x);
        // Put away, it goes again on its normal delay.
        await note(page, 'action-bar-intro').getByRole('button', { name: 'Got it' }).click();
        await expect.poll(hidden, { timeout: 5000 }).toBe(true);
    });

    test('Escape puts it away', async ({ page }) => {
        await load(page);
        await ask(page, ['bell-intro']);
        await expect(note(page, 'bell-intro')).toBeVisible({ timeout: 8000 });
        await page.keyboard.press('Escape');
        await expect(note(page, 'bell-intro')).toHaveCount(0);
        expect(await page.evaluate((k) => localStorage.getItem(k), BELL)).toBe('1');
    });
});

test('seen survives a reload', async ({ page }) => {
    // The setup writes both keys on every load, which would make a reload
    // look seen whatever happened. Hold those writes back, except the note's own.
    await page.addInitScript(() => {
        const set = Storage.prototype.setItem;
        Storage.prototype.setItem = function (key, value) {
            if (/-intro-seen$/.test(key) && !window.__noteMayWrite) return;
            return set.call(this, key, value);
        };
    });
    await load(page);
    await page.evaluate(() => { window.__noteMayWrite = true; });
    await ask(page, ['bell-intro', 'action-bar-intro']);
    await note(page, 'bell-intro').waitFor({ timeout: 8000 });
    await page.keyboard.press('Escape');
    await note(page, 'action-bar-intro').waitFor({ timeout: 8000 });
    await page.keyboard.press('Escape');
    expect(await page.evaluate((k) => localStorage.getItem(k), BAR)).toBe('1');
    await page.reload();
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0 && window.CoachNote, null, { timeout: 15_000 });
    // The promo marks are not persisted here, so only this browser remembers.
    await page.evaluate(() => { window.CoachNote.schedule('bell-intro'); window.CoachNote.schedule('action-bar-intro'); });
    // Checks that nothing shows: give the notes time to wrongly appear.
    await page.waitForTimeout(5000);
    // Those two only: the strip's note has its own mark, held back above too.
    await expect(page.locator('.coach-note[data-coach-note="bell-intro"], .coach-note[data-coach-note="action-bar-intro"]')).toHaveCount(0);
});
