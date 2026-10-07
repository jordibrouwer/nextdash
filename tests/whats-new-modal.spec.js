// @ts-check
const { test, expect } = require('./fixtures');
const { dismissOnboardingIfPresent, dismissBlockingOverlays, markWhatsNewSeen } = require('./e2e-helpers');

async function loadDashboard(page) {
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
}

async function openWhatsNew(page) {
    await page.evaluate(async () => {
        await window.ensureWhatsNewLoaded?.();
        await window.openWhatsNewModal({ force: true });
    });
    await expect(page.locator('.whats-new-modal')).toBeVisible();
    await page.waitForFunction(
        () => !document.querySelector('.whats-new-modal .wn-content--loading'),
        null,
        { timeout: 15_000 }
    );
}

test.describe("what's new modal", () => {
    // The footer was sticky inside the scrolling notes and needed a black band
    // of its own to hide them passing under it. It now sits beside the scroll
    // area, unpainted, and leaves with the modal.
    test('the footer sits under the notes without a background of its own', async ({ page }) => {
        await loadDashboard(page);
        await openWhatsNew(page);
        const foot = page.locator('.whats-new-modal > [data-wn-foot]');
        await expect(foot).toHaveCount(1);
        await expect(page.locator('.whats-new-modal .modal-body [data-wn-foot]')).toHaveCount(0);
        const bg = await foot.evaluate((el) => getComputedStyle(el).backgroundColor);
        expect(bg).toBe('rgba(0, 0, 0, 0)');
        await page.keyboard.press('Escape');
        await expect(page.locator('.whats-new-modal')).toHaveCount(0);
        await expect(page.locator('#app-modal [data-wn-foot]')).toHaveCount(0);
    });

    // The modal reports what the daily check found but no longer triggers one:
    // reading release notes and polling GitHub are separate jobs, and the manual
    // trigger lives in Config → Overview.
    test('shows the update status bar but no check button', async ({ page }) => {
        await loadDashboard(page);
        await openWhatsNew(page);
        await expect(page.locator('.whats-new-modal [data-wn-update-check]')).toHaveCount(1);
        await expect(page.locator('.whats-new-modal [data-wn-update-check-btn]')).toHaveCount(0);
    });

    test('the ko-fi link is safe to open externally', async ({ page }) => {
        await loadDashboard(page);
        await openWhatsNew(page);
        // Two ways to it: the header and the support card.
        const links = page.locator('.whats-new-modal .wn-kofi-btn, .whats-new-modal .wn-support-btn');
        await expect(links).toHaveCount(2);
        for (const link of await links.all()) {
            await expect(link).toHaveAttribute('href', 'https://ko-fi.com/jordibrw');
            await expect(link).toHaveAttribute('rel', /noopener/);
            await expect(link).toHaveAttribute('target', '_blank');
        }
    });

    /*
     * The modal opens on the release, not on three panels about other things.
     *
     * Measured before this changed: 283px of a 918px modal, and 32% of the
     * visible scroll area, went to an update bar, a boxed lead and a donation
     * request before the first word of a release. That is the whole reason the
     * redesign happened, so it is the thing pinned here.
     */
    test('the release is the first thing in the modal', async ({ page }) => {
        await loadDashboard(page);
        await openWhatsNew(page);

        const offset = await page.evaluate(() => {
            const body = document.querySelector('.whats-new-modal .modal-body');
            const hero = document.querySelector('.whats-new-modal .wn-hero');
            if (!body || !hero) return null;
            return Math.round(hero.getBoundingClientRect().top - body.getBoundingClientRect().top);
        });
        expect(offset).not.toBeNull();
        expect(offset).toBeLessThan(24);

        // The version is the headline, and it is bigger than the text under it
        // -- "which release am I reading" used to be answered by a small chip.
        const sizes = await page.evaluate(() => {
            const px = (sel) => {
                const el = document.querySelector(sel);
                return el ? parseFloat(getComputedStyle(el).fontSize) : 0;
            };
            return { version: px('.wn-hero-version'), lead: px('.wn-hero-lead') };
        });
        expect(sizes.version).toBeGreaterThan(sizes.lead * 1.4);
    });

    /*
     * Older releases are a list of rows, opened on request.
     *
     * They used to be appended in full as you scrolled, so reaching the release
     * before last meant scrolling through the last one.
     */
    test('older releases are rows that open one at a time', async ({ page }) => {
        await loadDashboard(page);
        await openWhatsNew(page);

        const rows = page.locator('.whats-new-modal [data-wn-earlier]');
        await expect(rows.first()).toBeVisible();
        const count = await rows.count();
        expect(count).toBeGreaterThan(5);

        // Nothing is fetched until it is asked for: a reader who came for the
        // release they just installed pays for one release, not for all of them.
        const first = rows.first();
        const id = await first.getAttribute('data-wn-earlier');
        const body = page.locator(`.whats-new-modal [data-wn-earlier-body="${id}"]`);
        await expect(body).toBeHidden();
        await expect(first).toHaveAttribute('aria-expanded', 'false');

        await first.click();
        await expect(first).toHaveAttribute('aria-expanded', 'true');
        await expect(body.locator('.wn-entry').first()).toBeVisible();

        // And it closes again without losing what it fetched.
        await first.click();
        await expect(body).toBeHidden();
    });

    /*
     * A long explanation is folded to three lines behind "more".
     *
     * The biggest release carries 110 items; unfolded they are a wall. Folded,
     * the scroll is a list of headlines with the detail on request.
     */
    // An item's bold part often carries on ("<strong>X</strong>, and Y."):
    // split at the bold, the explanation opened with a comma, a dash or a
    // lower-case word on a line of its own.
    test('no explanation starts in the middle of a sentence', async ({ page }) => {
        await loadDashboard(page);
        await openWhatsNew(page);
        const rows = page.locator('.whats-new-modal [data-wn-earlier]');
        const count = Math.min(await rows.count(), 12);
        for (let i = 0; i < count; i += 1) await rows.nth(i).click();
        await page.waitForTimeout(500);
        const starts = await page.$$eval('.whats-new-modal [data-wn-entry-body]',
            // A key name (<kbd>m</kbd>) may start a sentence; a word may not.
            (els) => els.map((el) => el.innerHTML.trim()).filter((t) => /^[,;:)\-—–]|^[a-z]/.test(t)));
        expect(starts).toEqual([]);
    });

    test('a long explanation folds behind a button', async ({ page }) => {
        await loadDashboard(page);
        await openWhatsNew(page);

        // Whether the release the modal leads with happens to carry a long item
        // is a property of its prose, not of the modal: a release of six short
        // lines folds nothing, and pinned to the lead this test failed on the
        // copy rather than on the fold. So walk the earlier releases open until
        // a folded body appears -- the 110-item release is down there.
        const more = page.locator('.whats-new-modal [data-wn-entry-more]').first();
        if (await more.count() === 0) {
            const rows = page.locator('.whats-new-modal [data-wn-earlier]');
            const count = await rows.count();
            for (let i = 0; i < count; i += 1) {
                await rows.nth(i).click();
                await page.waitForTimeout(400);
                if (await more.count() > 0) break;
            }
        }
        await expect(more).toBeVisible();
        const body = more.locator('xpath=preceding-sibling::div[@data-wn-entry-body]');
        await expect(body).toHaveClass(/is-folded/);

        await more.click();
        await expect(body).not.toHaveClass(/is-folded/);
        await expect(more).toHaveAttribute('aria-expanded', 'true');
    });

    /*
     * new and fix are a filled and a hollow dot, and still words for a reader
     * who cannot see the difference.
     *
     * The chips they replace cost about seven characters of a column kept
     * deliberately narrow, and drew their "new" tint from --accent-success --
     * which on a green accent is the same value as --accent-primary, so the
     * badge was literally the colour of the version tag beside it.
     */
    test('new and fix are readable without colour', async ({ page }) => {
        await loadDashboard(page);
        await openWhatsNew(page);

        // The word itself, on the face of the entry. A filled or hollow dot
        // stood here and carried the word only in a visually-hidden span, so
        // the distinction reached a screen reader and nobody else. Now that it
        // is printed, "readable without colour" is what the markup says rather
        // than something the stylesheet has to be trusted for.
        const entry = page.locator('.whats-new-modal .wn-entry').first();
        const badge = entry.locator('.wn-badge');
        await expect(badge).toHaveCount(1);
        await expect(badge).toBeVisible();
        expect((await badge.textContent() || '').trim()).toMatch(/^(new|fix)$/i);

        // Told apart by fill, not by a colour pair: new is a solid block, fix
        // is an outline. Either reads on a monochrome screen.
        const shape = await badge.evaluate((el) => {
            const cs = getComputedStyle(el);
            return { filled: cs.backgroundColor !== 'rgba(0, 0, 0, 0)', klass: el.className };
        });
        expect(shape.filled).toBe(shape.klass.includes('wn-badge--new'));
    });

    /*
     * The ask is made in full after the notes, where somebody who has read
     * them finds it; the header only carries the small button beside Esc.
     */
    test('the support card comes after the release, and the header carries the button', async ({ page }) => {
        await loadDashboard(page);
        await openWhatsNew(page);
        const order = await page.evaluate(() => {
            const groups = document.querySelector('.whats-new-modal .wn-groups');
            const card = document.querySelector('.whats-new-modal .wn-support');
            if (!groups || !card) return null;
            return groups.compareDocumentPosition(card) & Node.DOCUMENT_POSITION_FOLLOWING ? 'after' : 'before';
        });
        expect(order).toBe('after');
        await expect(page.locator('.whats-new-modal .modal-header .wn-kofi-btn--solid')).toBeVisible();
        // The footer does not repeat it: the card above has just asked.
        await expect(page.locator('.whats-new-modal > .wn-foot .wn-kofi-btn')).toHaveCount(0);
        // The card asks without counting: no tally of changes in it.
        await expect(page.locator('.whats-new-modal .wn-support')).not.toContainText(/\d+ changes/);
    });

    /*
     * New changes come first as cards, fixes after them as one line each, and
     * one menu narrows both to a section where a row of tabs ran off the edge.
     */
    test('the section menu narrows the release to one section', async ({ page }) => {
        await loadDashboard(page);
        await openWhatsNew(page);
        const select = page.locator('.whats-new-modal [data-wn-section-select]');
        test.skip(!(await select.count()), 'the newest release has one section');
        await expect(page.locator('.whats-new-modal [data-wn-tab]')).toHaveCount(0);

        const options = await select.locator('option').evaluateAll((els) => els.map((el) => el.value));
        const pick = options[options.length - 1];
        await select.selectOption(pick);
        const shown = await page.$$eval('.whats-new-modal .wn-groups [data-wn-sec]',
            (els) => els.filter((el) => el.offsetParent !== null).map((el) => el.getAttribute('data-wn-sec')));
        expect(shown.length).toBeGreaterThan(0);
        expect(new Set(shown)).toEqual(new Set([pick]));
        // The counts in the headings follow the menu.
        const counted = await page.$$eval('.whats-new-modal [data-wn-block]:not([hidden]) [data-wn-block-count]',
            (els) => els.reduce((n, el) => n + Number(el.textContent), 0));
        expect(counted).toBe(shown.length);

        await select.selectOption('');
        const all = await page.$$eval('.whats-new-modal .wn-groups [data-wn-sec]',
            (els) => els.filter((el) => el.offsetParent !== null).length);
        expect(all).toBeGreaterThan(shown.length);
    });

    test('a fix is one line that opens to its explanation', async ({ page }) => {
        await loadDashboard(page);
        await openWhatsNew(page);
        const row = page.locator('.whats-new-modal .wn-fix-list details.wn-fix').first();
        test.skip(!(await row.count()), 'the newest release has no fix with an explanation');
        const body = row.locator('[data-wn-entry-body]');
        await expect(body).toBeHidden();
        await row.locator('summary').click();
        await expect(body).toBeVisible();
        // New changes sit above the fixes.
        const order = await page.evaluate(() => {
            const added = document.querySelector('.whats-new-modal .wn-block--new');
            const fixed = document.querySelector('.whats-new-modal .wn-block--fix');
            if (!added || !fixed) return 'after';
            return added.compareDocumentPosition(fixed) & Node.DOCUMENT_POSITION_FOLLOWING ? 'after' : 'before';
        });
        expect(order).toBe('after');
    });

    test('the update status is announced politely', async ({ page }) => {
        await loadDashboard(page);
        await openWhatsNew(page);
        const status = page.locator('.whats-new-modal [data-wn-update-status]');
        await expect(status).toHaveCount(1);
        await expect(status).toHaveAttribute('aria-live', 'polite');
    });

    test('shows dismiss when an update is available', async ({ page }) => {
        await loadDashboard(page);
        await page.evaluate(async () => {
            const origFetch = window.fetch;
            window.fetch = function (input, init) {
                const url = typeof input === 'string' ? input : input?.url || '';
                if (url.includes('/api/update-status')) {
                    return Promise.resolve(new Response(JSON.stringify({
                        enabled: true,
                        current: 'v2026.08.04',
                        latest: 'v9999.99.99',
                        updateAvailable: true,
                        releaseUrl: 'https://github.com/jordibrouwer/nextdash/releases/tag/v9999.99.99',
                    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
                }
                return origFetch.apply(this, arguments);
            };
            await window.nextdashRefreshUpdateStatus(true);
        });
        await openWhatsNew(page);
        await expect(page.locator('.whats-new-modal [data-wn-update-dismiss]')).toBeVisible();
    });

    /*
     * Nothing scrolls sideways.
     *
     * The Ko-fi button draws four sparkles 0.75rem outside itself. In the panel
     * it used to sit in that overhang fell inside the padding; flush against
     * the right of the footer it became eight pixels of scrollable width, and a
     * horizontal scrollbar under a modal with nothing to reach sideways for.
     */
    test('the modal never scrolls sideways', async ({ page }) => {
        await loadDashboard(page);
        await openWhatsNew(page);
        const widths = await page.evaluate(() => {
            const body = document.querySelector('.whats-new-modal .modal-body');
            return { client: body.clientWidth, scroll: body.scrollWidth };
        });
        expect(widths.scroll).toBeLessThanOrEqual(widths.client);
    });

    /*
     * The window edge is not the modal edge, top or bottom.
     *
     * The overlay left 2rem under the modal and nothing over it while capping
     * the height at 100vh - 2rem, so a modal tall enough to reach that cap ran
     * into the top of the window and sat comfortably off the bottom.
     */
    test('there is room above the modal as well as below it', async ({ page }) => {
        await loadDashboard(page);
        await openWhatsNew(page);
        const gaps = await page.evaluate(() => {
            const r = document.querySelector('.whats-new-modal').getBoundingClientRect();
            return { top: Math.round(r.top), bottom: Math.round(window.innerHeight - r.bottom) };
        });
        // Not symmetry: with the button bar along the bottom the modal sits
        // deliberately above it, so the gap underneath is the height of that
        // bar. What is asserted is that neither edge is touched.
        expect(gaps.top).toBeGreaterThanOrEqual(24);
        expect(gaps.bottom).toBeGreaterThanOrEqual(24);
    });

    test('uses translated close label from locales', async ({ page }) => {
        await loadDashboard(page);
        await openWhatsNew(page);
        const closeBtn = page.locator('.whats-new-modal .modal-button-name').first();
        await expect(closeBtn).not.toBeEmpty();
        await expect(closeBtn).not.toHaveText('Confirm');
    });
});

/*
 * The star sits in the bottom-right corner, and the toast at the bottom edge.
 *
 * It was bottom-left, where the page's own content starts; the actions it
 * belongs beside are all at the right end of the bar. The notification host is
 * pinned to that same corner and stands at the bottom edge like the corner
 * cards; while a toast shows it may cover the star.
 */
test('the what\'s-new button is in the bottom-right corner, the toast at the bottom edge', async ({ page }) => {
    await page.setViewportSize({ width: 1400, height: 900 });
    await page.goto('/');
    await page.waitForSelector('#dashboard-layout', { timeout: 20_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);

    const fab = await page.evaluate(() => {
        const r = document.getElementById('whats-new-btn').getBoundingClientRect();
        return {
            fromRight: Math.round(document.body.clientWidth - r.right),
            fromBottom: Math.round(window.innerHeight - r.bottom),
            fromLeft: Math.round(r.left),
        };
    });
    expect(fab.fromRight, 'the star is not in the right corner').toBeLessThan(40);
    expect(fab.fromBottom, 'the star is not at the bottom').toBeLessThan(40);
    expect(fab.fromLeft, 'the star is still on the left').toBeGreaterThan(200);

    await page.evaluate(() => window.dashboardInstance.showNotification('Bookmark deleted.', 'success'));
    await expect.poll(() => page.evaluate(
        () => document.getElementById('app-notification')?.classList.contains('show') === true,
    )).toBe(true);
    await page.waitForTimeout(400);

    const toast = await page.evaluate(() => {
        const r = document.getElementById('app-notification').getBoundingClientRect();
        return {
            gap: Math.round(window.innerHeight - r.bottom),
            edge: Math.round(parseFloat(getComputedStyle(document.documentElement).fontSize) || 16),
        };
    });
    // At the bottom edge, the 1rem every corner card keeps -- not a row above it.
    expect(toast.gap).toBeLessThanOrEqual(toast.edge + 1);
});

test('Support and Esc sit in the header right corner, over the footer Esc', async ({ page }) => {
    await loadDashboard(page);
    await openWhatsNew(page);
    await page.waitForTimeout(100);
    const x = await page.evaluate(() => {
        const m = document.querySelector('.modal.whats-new-modal');
        const box = (sel) => m.querySelector(sel).getBoundingClientRect();
        const header = box('.modal-header');
        const pad = parseFloat(getComputedStyle(m.querySelector('.modal-header')).paddingRight) || 0;
        return {
            headEsc: Math.round(box('.modal-header .wn-modal-close').right),
            footEsc: Math.round(box(':scope > .wn-foot .wn-foot-esc').right),
            corner: Math.round(header.right - pad),
            kofiToEsc: Math.round(box('.modal-header .wn-modal-close').left - box('.modal-header .wn-kofi-btn--head').right),
        };
    });
    expect(Math.abs(x.headEsc - x.corner)).toBeLessThanOrEqual(2);
    expect(Math.abs(x.headEsc - x.footEsc)).toBeLessThanOrEqual(2);
    // Support right beside Esc, not pushed away by a stretched close button.
    expect(x.kofiToEsc).toBeLessThanOrEqual(24);
});
