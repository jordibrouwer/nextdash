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
        const kofi = page.locator('.whats-new-modal .wn-kofi-btn');
        await expect(kofi).toHaveAttribute('href', 'https://ko-fi.com/jordibrw');
        await expect(kofi).toHaveAttribute('rel', /noopener/);
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
    test('a long explanation folds behind a button', async ({ page }) => {
        await loadDashboard(page);
        await openWhatsNew(page);

        const more = page.locator('.whats-new-modal [data-wn-entry-more]').first();
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

        const entry = page.locator('.whats-new-modal .wn-entry').first();
        await expect(entry.locator('.wn-dot')).toHaveCount(1);
        const spoken = await entry.locator('.wn-sr-only').textContent();
        expect((spoken || '').trim()).toMatch(/new|fix/i);

        // Visually hidden, not display:none — a screen reader still reaches it.
        const hidden = await entry.locator('.wn-sr-only').evaluate((el) => {
            const cs = getComputedStyle(el);
            return { display: cs.display, w: Math.round(el.getBoundingClientRect().width) };
        });
        expect(hidden.display).not.toBe('none');
        expect(hidden.w).toBeLessThan(3);
    });

    /*
     * The support request is at the end, where somebody who has read the notes
     * finds it — not above the first one they came to read.
     */
    test('the ko-fi link comes after the release, not before it', async ({ page }) => {
        await loadDashboard(page);
        await openWhatsNew(page);
        const order = await page.evaluate(() => {
            const hero = document.querySelector('.whats-new-modal .wn-hero');
            const kofi = document.querySelector('.whats-new-modal .wn-kofi-btn');
            if (!hero || !kofi) return null;
            return hero.compareDocumentPosition(kofi) & Node.DOCUMENT_POSITION_FOLLOWING ? 'after' : 'before';
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
