// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * The tag cloud, quieter.
 *
 * It was a 2008 cloud: a # before every word, a tilt, a drift that never
 * stopped, and one accent in five tints -- and with twenty-odd tags every word
 * came out nearly the same size, because the size followed the count in a
 * straight line. Now three sizes by rank, alphabetical inside each so a tag
 * keeps its place, the count beside every word, and once a filter is on, the
 * number each tag would add to it.
 *
 * A tag that is filtering is still the one filled pill in the cloud: size and
 * colour say how often a tag is used, and the pill says something else.
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

/** Through the key, the way it is opened. */
async function openCloudWithKey(page) {
    await openCloud(page);
    await page.evaluate(() => window.DashboardTagCloud?.closeModal?.({ animate: false }));
    await page.locator('body').click({ position: { x: 5, y: 5 } });
    await page.keyboard.press('/');
    await expect(page.locator('#tag-cloud-modal')).toBeVisible();
    await expect.poll(() => page.locator('.tag-cloud-word').count()).toBeGreaterThan(1);
}

const styleOf = (page, selector, props) => page.evaluate(([sel, list]) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const cs = window.getComputedStyle(el);
    return Object.fromEntries(list.map((p) => [p, cs[p]]));
}, [selector, props]);

const chips = (page) => page.evaluate(() => [...document.querySelectorAll('#tag-cloud-modal .tag-cloud-word')].map((el) => ({
    tag: el.dataset.tag,
    size: ['L', 'M', 'S'].find((c) => el.classList.contains(`is-${c}`)) || null,
    label: el.querySelector('.tag-cloud-word-label')?.textContent ?? '',
    count: el.querySelector('.tag-cloud-word-count')?.textContent ?? '',
    zero: el.classList.contains('is-zero'),
    selected: el.classList.contains('is-selected'),
    text: el.textContent,
})));

test.describe('the word cloud', () => {
    test('no #, no tilt, and nothing moving once it has opened', async ({ page }) => {
        await openCloudWithKey(page);
        const list = await chips(page);
        list.forEach((c) => expect(c.text.trim().startsWith('#'), `${c.tag} still wears a #`).toBe(false));

        await expect.poll(() => page.evaluate(() => document.getAnimations()
            .filter((a) => a.effect?.target?.closest?.('#tag-cloud-modal .tag-cloud-word')).length)).toBe(0);
        const transforms = await page.evaluate(() => [...document.querySelectorAll('#tag-cloud-modal .tag-cloud-word')]
            .map((el) => getComputedStyle(el).transform));
        transforms.forEach((tr) => expect(['none', 'matrix(1, 0, 0, 1, 0, 0)']).toContain(tr));
    });

    test('three sizes by rank, alphabetical inside each, a count beside every word', async ({ page }) => {
        await openCloudWithKey(page);
        const list = await chips(page);
        expect(list.every((c) => c.size), 'a chip without a size').toBe(true);
        expect(list.some((c) => c.size === 'L'), 'no large tag').toBe(true);

        // Large, then medium, then small; A-Z inside each.
        const order = { L: 0, M: 1, S: 2 };
        for (let i = 1; i < list.length; i++) {
            const a = list[i - 1]; const b = list[i];
            expect(order[a.size] <= order[b.size], `${b.tag} (${b.size}) after ${a.tag} (${a.size})`).toBe(true);
            if (a.size === b.size) expect(a.tag.localeCompare(b.tag), `${a.tag} before ${b.tag}`).toBeLessThan(0);
        }
        list.forEach((c) => {
            expect(c.label).toBe(c.tag);
            expect(c.count, `${c.tag} has no count`).toMatch(/^\d+$/);
        });
        await expect(page.locator('#tag-cloud-modal-count')).toHaveText(new RegExp(`·\\s*${list.length}$`));
    });

    test('with a filter on, each tag says what it would add', async ({ page }) => {
        await openCloudWithKey(page);
        const first = page.locator('#tag-cloud-modal .tag-cloud-word').first();
        await first.click({ modifiers: ['Shift'] });
        await expect(page.locator('#tag-cloud-modal .tag-cloud-word.is-selected')).toHaveCount(1);

        const list = await chips(page);
        const total = list.length;
        list.filter((c) => !c.selected).forEach((c) => {
            expect(c.count, `${c.tag}`).toMatch(/^\+\d+$/);
            expect(c.zero, `${c.tag}: +0 and not dimmed, or dimmed with more`).toBe(c.count === '+0');
        });
        await expect(page.locator('#tag-cloud-modal-count')).toHaveText(new RegExp(`·\\s*1 of ${total}$`));
    });

    test('a tag that is filtering is a filled pill', async ({ page }) => {
        await openCloudWithKey(page);
        await page.locator('#tag-cloud-modal .tag-cloud-word').first().click({ modifiers: ['Shift'] });
        await expect.poll(() => page.locator('.tag-cloud-word.is-selected').count()).toBe(1);

        const pill = await styleOf(page, '.tag-cloud-word.is-selected', ['backgroundColor', 'borderRadius', 'fontWeight']);
        expect(pill.backgroundColor, 'the pill has no fill').not.toBe('rgba(0, 0, 0, 0)');
        expect(pill.borderRadius, 'the pill is not round').toBe('999px');

        // On the accent, not in it.
        const label = await styleOf(page, '.tag-cloud-word.is-selected .tag-cloud-word-label', ['color']);
        const page_ = await styleOf(page, 'body', ['backgroundColor']);
        expect(label.color, 'the label is not the page colour on the fill').toBe(page_.backgroundColor);
    });

    test('closes with its keys, not with a tally', async ({ page }) => {
        await openCloudWithKey(page);
        await expect(page.locator('.tag-cloud-total')).toHaveCount(0);
        const legend = page.locator('#tag-cloud-modal .tag-cloud-legend');
        await expect(legend).toBeVisible();
        expect(await legend.locator('kbd').count()).toBeGreaterThanOrEqual(4);
        expect(await styleOf(page, '#tag-cloud-modal .tag-cloud-legend', ['display'])).toEqual({ display: 'flex' });
        // The clear button joins the row only while something is filtering.
        await expect(page.locator('#tag-cloud-clear-filter')).toBeHidden();
        await page.locator('#tag-cloud-modal .tag-cloud-word').first().click({ modifiers: ['Shift'] });
        await expect(page.locator('#tag-cloud-modal .tag-cloud-footer-row #tag-cloud-clear-filter')).toBeVisible();
    });
});

/** Waits until the open cloud has stopped animating and its box has held still. */
async function cloudSettled(page) {
    let last = '';
    let same = 0;
    await expect.poll(async () => {
        const cur = await page.evaluate(() => {
            const el = document.getElementById('tag-cloud-modal');
            const r = el.getBoundingClientRect();
            return { box: [r.x, r.y, r.width, r.height].join(',') };
        });
        same = cur.box === last ? same + 1 : 0;
        last = cur.box;
        return same >= 4;
    }).toBe(true);
}

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
        // placement. Let it settle first: no running animation, and the same
        // box on several reads in a row.
        await cloudSettled(page);
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
        await expect.poll(() => page.evaluate(
            () => document.getElementById('tag-cloud-modal').hidden,
        )).toBe(true);
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
        await expect(page.locator('#tag-cloud-toggle-btn')).toBeVisible();
        await page.locator('#tag-cloud-toggle-btn').click();
        await expect.poll(() => page.locator('.tag-cloud-word').count()).toBeGreaterThan(1);
        await cloudSettled(page);

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
    await expect.poll(() => page.evaluate(
        () => !!document.activeElement?.closest?.('.bookmark-link'))).toBe(true);

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
    await expect.poll(() => page.evaluate(
        () => document.querySelector('#tag-cloud-modal').hidden)).toBe(true);

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

/*
 * The close button is a ×, which is not a name. It carries one in the page as
 * served, before any translation has run, and keeps it once the cloud opens.
 */
test('the close button is named, from the first paint', async ({ page }) => {
    await page.setViewportSize({ width: 1500, height: 1000 });
    await markWhatsNewSeen(page);
    const response = await page.goto('/');
    const served = await response.text();
    expect(served, 'the served close button has no aria-label')
        .toMatch(/id="tag-cloud-modal-close"[^>]*aria-label="Close"/);

    await page.waitForSelector('.bookmark-link', { timeout: 20_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.evaluate(() => {
        window.dashboardInstance.settings.showTagCloudButton = true;
        window.dashboardInstance.setupDOM?.();
    });
    await page.locator('body').press('/');
    await expect.poll(() => page.locator('.tag-cloud-word').count()).toBeGreaterThan(1);
    await expect(page.locator('#tag-cloud-modal-close')).toHaveAccessibleName('Close');
});
