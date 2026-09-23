// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * The word cloud, drawn the way the overlays spec draws it.
 *
 * Two things separate the draft's cloud from what shipped. A tag that is
 * filtering the page is a filled pill there and was an underlined word here —
 * and in a cloud where size and colour already carry how often a tag is used,
 * an underline is a third quiet signal competing with two loud ones. A filled
 * pill is the only shape in the cloud, so it cannot be read as a heavier tag.
 *
 * And the draft closes its cloud with two figures on a rule: how many tags
 * there are, and how many are filtering. A cloud says which tags are big and
 * says nothing about either.
 */

async function openCloud(page) {
    await page.setViewportSize({ width: 1500, height: 1000 });
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForSelector('.bookmark-link', { timeout: 20_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    // The button in the header, and on the row: a fresh install docks the
    // actions at the bottom and folds all but two, and "under the button" is
    // the header's placement.
    await page.evaluate(() => {
        Object.assign(window.dashboardInstance.settings, { showTagCloudButton: true, actionBarPosition: 'header', maxHeaderActions: 8 });
        window.dashboardInstance.setupDOM?.();
    });
    await page.evaluate(() => window.DashboardTagCloud?.openModal?.());
    await expect.poll(() => page.locator('.tag-cloud-word').count()).toBeGreaterThan(1);
}

const styleOf = (page, selector, props) => page.evaluate(([sel, list]) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const cs = window.getComputedStyle(el);
    return Object.fromEntries(list.map((p) => [p, cs[p]]));
}, [selector, props]);

test.describe('the word cloud', () => {
    test('closes with what it adds up to', async ({ page }) => {
        await openCloud(page);

        const total = page.locator('.tag-cloud-total');
        await expect(total, 'the cloud does not say how much of it there is').toHaveCount(1);
        // Two figures at opposite ends of a rule.
        const shape = await styleOf(page, '.tag-cloud-total', ['justifyContent', 'borderTopWidth']);
        expect(shape.justifyContent).toBe('space-between');
        expect(parseFloat(shape.borderTopWidth), 'no rule under the cloud').toBeGreaterThan(0);
        await expect(total).toContainText(/\d/);
    });

    test('a tag that is filtering is a filled pill', async ({ page }) => {
        await openCloud(page);
        await page.evaluate(() => document.querySelector('.tag-cloud-word')?.click());
        await page.evaluate(() => window.DashboardTagCloud?.openModal?.());
        await expect.poll(() => page.locator('.tag-cloud-word.is-selected').count()).toBe(1);

        const pill = await styleOf(page, '.tag-cloud-word.is-selected',
            ['backgroundColor', 'borderRadius', 'fontWeight', 'boxShadow']);
        expect(pill.backgroundColor, 'the pill has no fill').not.toBe('rgba(0, 0, 0, 0)');
        expect(pill.borderRadius, 'the pill is not round').toBe('999px');
        expect(pill.fontWeight).toBe('700');
        expect(pill.boxShadow, 'the pill does not glow').not.toBe('none');

        // On the accent, not in it, and no underline left over.
        const label = await styleOf(page, '.tag-cloud-word.is-selected .tag-cloud-word-label',
            ['color', 'textDecorationLine']);
        const page_ = await styleOf(page, 'body', ['backgroundColor']);
        expect(label.textDecorationLine, 'the underline is still there').toBe('none');
        expect(label.color, 'the label is not the page colour on the fill').toBe(page_.backgroundColor);
    });

    test('and the count follows what is filtering', async ({ page }) => {
        await openCloud(page);
        const before = await page.locator('.tag-cloud-total').innerText();

        await page.evaluate(() => document.querySelector('.tag-cloud-word')?.click());
        await page.evaluate(() => window.DashboardTagCloud?.openModal?.());
        await expect.poll(() => page.locator('.tag-cloud-word.is-selected').count()).toBe(1);

        const after = await page.locator('.tag-cloud-total').innerText();
        expect(after, 'the figure did not move when a tag was switched on').not.toBe(before);
    });
});

/*
 * It hangs under the button, and stays inside the window.
 *
 * The cloud was anchored to a corner FAB: it pinned itself by its bottom edge
 * and worked out whether to open upward. From the header — the top of the
 * window — that threw it against the far corner, and the two ways in landed in
 * different places, because the key and the button reached the placement code
 * in different states. One dropdown now, from either.
 */
test.describe('where the cloud opens', () => {
    async function readCloud(page) {
        // The cloud scales in when it opens, and a box read mid-animation is a
        // smaller box in a different place -- which is a moving target, not a
        // placement. Let it settle first.
        await page.waitForTimeout(400);
        return page.evaluate(() => {
            const modal = document.getElementById('tag-cloud-modal');
            const button = document.getElementById('tag-cloud-toggle-btn');
            const m = modal.getBoundingClientRect();
            const b = button.getBoundingClientRect();
            return {
                top: Math.round(m.top), left: Math.round(m.left),
                right: Math.round(m.right), bottom: Math.round(m.bottom),
                buttonBottom: Math.round(b.bottom), buttonRight: Math.round(b.right),
                width: Math.round(document.documentElement.clientWidth),
                height: Math.round(window.innerHeight),
            };
        });
    }

    test('under the button, whole, whichever way it is opened', async ({ page }) => {
        await openCloud(page);
        const viaCode = await readCloud(page);

        // Under the button rather than over the page it belongs to.
        expect(viaCode.top, 'the cloud does not hang from the button')
            .toBeGreaterThanOrEqual(viaCode.buttonBottom);
        // Whole: nothing of it is outside the window on either axis.
        expect(viaCode.left, 'the cloud runs off the left edge').toBeGreaterThanOrEqual(0);
        expect(viaCode.right, 'the cloud runs off the right edge').toBeLessThanOrEqual(viaCode.width);
        expect(viaCode.bottom, 'the cloud runs off the bottom').toBeLessThanOrEqual(viaCode.height);

        // The key and the button put it in the same place.
        await page.keyboard.press('Escape');
        await expect.poll(() => page.evaluate(
            () => document.getElementById('tag-cloud-modal').classList.contains('is-open'),
        )).toBe(false);

        await page.locator('#tag-cloud-toggle-btn').click();
        await expect.poll(() => page.evaluate(
            () => document.getElementById('tag-cloud-modal').classList.contains('is-open'),
        )).toBe(true);
        const viaButton = await readCloud(page);

        await page.keyboard.press('Escape');
        await page.waitForTimeout(300);
        await page.keyboard.press('/');
        await expect.poll(() => page.evaluate(
            () => document.getElementById('tag-cloud-modal').classList.contains('is-open'),
        )).toBe(true);
        const viaKey = await readCloud(page);

        expect({ top: viaKey.top, left: viaKey.left },
            'the key and the button open the cloud in different places')
            .toEqual({ top: viaButton.top, left: viaButton.left });
    });
});

/*
 * From a docked bar the cloud opens away from the edge.
 *
 * The button stands in the same group wherever the bar is, and the cloud hung
 * under it every time -- which for a bar at the bottom put it under the window.
 */
for (const place of ['bottom', 'left', 'right']) {
    test(`from a bar docked ${place}, the cloud opens whole and clear of the button`, async ({ page }) => {
        await page.setViewportSize({ width: 1500, height: 1000 });
        await markWhatsNewSeen(page);
        await page.goto('/');
        await page.waitForSelector('.bookmark-link', { timeout: 20_000 });
        await dismissOnboardingIfPresent(page);
        await dismissBlockingOverlays(page);
        await page.evaluate((where) => {
            Object.assign(window.dashboardInstance.settings,
                { showTagCloudButton: true, actionBarPosition: where, actionBarAutoHideSeconds: 0 });
            window.dashboardInstance.setupDOM?.();
        }, place);
        await page.waitForTimeout(400);
        await page.locator('#tag-cloud-toggle-btn').click();
        await expect.poll(() => page.locator('.tag-cloud-word').count()).toBeGreaterThan(1);
        await page.waitForTimeout(400);

        const seen = await page.evaluate(() => {
            const m = document.getElementById('tag-cloud-modal').getBoundingClientRect();
            const b = document.getElementById('tag-cloud-toggle-btn').getBoundingClientRect();
            return {
                m: { top: m.top, left: m.left, right: m.right, bottom: m.bottom },
                b: { top: b.top, left: b.left, right: b.right, bottom: b.bottom },
                w: document.documentElement.clientWidth,
                h: window.innerHeight,
            };
        });
        const { m, b } = seen;
        expect(m.top, 'off the top').toBeGreaterThanOrEqual(0);
        expect(m.left, 'off the left').toBeGreaterThanOrEqual(0);
        expect(m.right, 'off the right').toBeLessThanOrEqual(seen.w);
        expect(m.bottom, 'off the bottom').toBeLessThanOrEqual(seen.h);
        const overlaps = !(m.right <= b.left || m.left >= b.right || m.bottom <= b.top || m.top >= b.bottom);
        expect(overlaps, 'the cloud covers its own button').toBe(false);
        if (place === 'bottom') expect(m.bottom).toBeLessThanOrEqual(b.top);
        if (place === 'left') expect(m.left).toBeGreaterThanOrEqual(b.right);
        if (place === 'right') expect(m.right).toBeLessThanOrEqual(b.left);
    });
}

/*
 * Closing the cloud puts the reader back on the grid.
 *
 * Escape sent the focus to the button in the action bar, which is the one
 * place the reader was not: the bar lit a control they were done with, and
 * every arrow key after it walked the bar instead of the bookmarks.
 */
test('escape leaves the cloud on the grid, not on the button', async ({ page }) => {
    await page.setViewportSize({ width: 1500, height: 1000 });
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForSelector('.bookmark-link', { timeout: 20_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.evaluate(() => {
        window.dashboardInstance.settings.showTagCloudButton = true;
        window.dashboardInstance.setupDOM?.();
    });

    // Through the key the reader presses, not through openModal().
    await page.locator('body').press('/');
    await expect.poll(() => page.locator('.tag-cloud-word').count()).toBeGreaterThan(1);
    await page.locator('body').press('Escape');
    await page.waitForTimeout(400);

    const landed = await page.evaluate(() => {
        const active = document.activeElement;
        const kn = window.dashboardInstance.keyboardNavigation;
        return {
            onToggle: !!active?.closest?.('#tag-cloud-toggle'),
            onRow: !!active?.closest?.('.bookmark-link'),
            lit: document.querySelectorAll('.bookmark-link.keyboard-focus, .bookmark-link.kbd-selected').length,
            index: kn.currentIndex,
        };
    });

    expect(landed.onToggle, 'the focus stayed on the button in the bar').toBe(false);
    expect(landed.onRow, 'the focus is not on a bookmark').toBe(true);
    expect(landed.index, 'there is no cursor to walk on from').toBeGreaterThanOrEqual(0);
});


/**
 * A closed cloud is out of the way, not merely invisible.
 *
 * closeModal() sets `hidden`, and for a while that did nothing: the stylesheet
 * gives .tag-cloud-modal `display: flex`, and a class rule outranks the
 * browser's own `[hidden] { display: none }`. So the modal stayed laid out at
 * opacity 0 with pointer-events on, and a 541 x 521 region of the grid -- four
 * columns wide on a 1440px screen -- quietly ate every click after the cloud
 * had been opened once. The bookmark underneath did not open and nothing said
 * why.
 *
 * Measured through the hit test rather than through the attribute, because the
 * attribute was set correctly the whole time.
 */
test('the closed cloud lets the grid have its clicks back', async ({ page }) => {
    await page.setViewportSize({ width: 1500, height: 1000 });
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForSelector('.bookmark-link', { timeout: 20_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.evaluate(() => {
        window.dashboardInstance.settings.showTagCloudButton = true;
        window.dashboardInstance.setupDOM?.();
    });

    // Through the key the reader presses, not through openModal().
    await page.locator('body').press('/');
    await expect.poll(() => page.locator('.tag-cloud-word').count()).toBeGreaterThan(1);

    // Where the cloud stood, remembered before it closes.
    const where = await page.evaluate(() => {
        const r = document.querySelector('#tag-cloud-modal').getBoundingClientRect();
        return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
    });

    await page.locator('body').press('Escape');
    await page.waitForTimeout(400);

    const after = await page.evaluate(({ x, y }) => {
        const modal = document.querySelector('#tag-cloud-modal');
        const hit = document.elementFromPoint(x, y);
        // Asked of the browser rather than counted: the modal is aria-hidden
        // while closed, so a control inside it that can still take focus is a
        // control a screen reader is told is not there. A display:none subtree
        // refuses focus, which is the whole point of the rule above.
        const inside = modal.querySelector('.tag-cloud-word, button');
        inside?.focus?.();
        return {
            display: window.getComputedStyle(modal).display,
            hitInsideModal: modal.contains(hit),
            focusLanded: modal.contains(document.activeElement),
        };
    }, where);

    expect(after.display, 'the closed cloud is still laid out').toBe('none');
    expect(after.hitInsideModal, 'a click where the cloud was lands on the closed cloud').toBe(false);
    expect(after.focusLanded, 'the keyboard can still reach into an aria-hidden cloud').toBe(false);
});
