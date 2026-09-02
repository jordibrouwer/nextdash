// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissBlockingOverlays, dismissOnboardingIfPresent } = require('./e2e-helpers');

/**
 * The native tooltip and the preview card are two answers to the same hover,
 * and only one of them should arrive.
 *
 * The card already removes the tooltip — but from the anchor, and since
 * "Show usage on hover" the text also sits on the `.bookmark-text` span inside
 * it. A title on a descendant wins over an absent one on its parent, so both
 * showed: the grey box on top of the card it was meant to make way for.
 *
 * The text is not lost when the card is on. applyPreviewDescription puts it in
 * the hidden element the row points at with aria-describedby, which is where
 * assistive tech reads it from either way.
 */

async function openDashboard(page, mode) {
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.evaluate((m) => {
        const d = window.dashboardInstance;
        d.settings.linkPreviewMode = m;
        d.settings.showLinkPreviewCards = m !== 'off';
        d.renderDashboard({ animate: false, forceFull: true });
    }, mode);
}

test('the row tooltip yields to the preview card', async ({ page }) => {
    await openDashboard(page, 'hover');

    const text = page.locator('.bookmark-link .bookmark-open .bookmark-text').first();
    await expect(text).toBeVisible();
    expect(
        await text.getAttribute('title'),
        'the tooltip would sit on top of the card it was meant to make way for',
    ).toBeNull();

    // The description assistive tech reads is still there.
    const described = await page.locator('.bookmark-link .bookmark-open').first().getAttribute('aria-describedby');
    expect(described, 'the row lost its description as well as its tooltip').toBeTruthy();
});

test('with cards off the tooltip is the only answer, so it stays', async ({ page }) => {
    await openDashboard(page, 'off');

    const text = page.locator('.bookmark-link .bookmark-open .bookmark-text').first();
    await expect(text).toBeVisible();
    const title = await text.getAttribute('title');
    expect(title, 'with no card, hovering a row would say nothing at all').toBeTruthy();
});

test('keyboard-only counts as cards on, the way the anchor already treats it', async ({ page }) => {
    await openDashboard(page, 'keyboard');

    const text = page.locator('.bookmark-link .bookmark-open .bookmark-text').first();
    await expect(text).toBeVisible();
    expect(await text.getAttribute('title')).toBeNull();
});

/**
 * A title on the category list is a tooltip on every row inside it.
 *
 * The browser walks up to the nearest ancestor carrying one, so the
 * sort-locked drag hint — set on the whole list — reached rows that had
 * carefully removed their own, and the grey box landed on top of the card.
 * Only some categories showed it, which is what made it look intermittent:
 * the hint is only attached where a sort order locks dragging.
 *
 * The hint is not lost. Dragging one of these rows raises it as a
 * notification, which is when the question is actually asked.
 */
test('the sort-locked drag hint does not blanket the rows', async ({ page }) => {
    await openDashboard(page, 'hover');

    const withCards = await page.evaluate(() => {
        const d = window.dashboardInstance;
        const list = document.querySelector('[data-category-id]');
        // Asserted, not assumed: a missing list would make both halves of this
        // test pass by returning null.
        if (!list) return { missing: true };
        list._sortLockedHintBound = false;
        d.renderCore.attachSortLockedDragHint(list, 'az');
        return { missing: false, title: list.getAttribute('title') };
    });
    expect(withCards.missing, 'no category list on the page to test against').toBe(false);
    expect(withCards.title, 'the list tooltip would sit over every card opened inside it').toBeNull();

    await openDashboard(page, 'off');
    const withoutCards = await page.evaluate(() => {
        const d = window.dashboardInstance;
        const list = document.querySelector('[data-category-id]');
        // Asserted, not assumed: a missing list would make both halves of this
        // test pass by returning null.
        if (!list) return { missing: true };
        list._sortLockedHintBound = false;
        d.renderCore.attachSortLockedDragHint(list, 'az');
        return { missing: false, title: list.getAttribute('title') };
    });
    expect(withoutCards.missing).toBe(false);
    expect(withoutCards.title, 'with no card coming the hint is the only explanation there is').toBeTruthy();
});
