// @ts-check
const { test, expect } = require('@playwright/test');
const { markWhatsNewSeen, dismissBlockingOverlays, dismissOnboardingIfPresent } = require('./e2e-helpers');

/**
 * Modern layout coverage for the inbox feed and the quickstart card.
 *
 * Same shape as layout-modern-health.spec.js and layout-modern-config.spec.js:
 * both layouts render identical markup, so every assertion compares a computed
 * style between them on the same element.
 */

async function loadDashboard(page) {
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForSelector('#dashboard-layout', { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.waitForFunction(() => window.dashboardInstance?.inbox != null, null, { timeout: 15_000 });
}

/** Seed one unread item so the feed has a row carrying the unread marker. */
async function openInbox(page) {
    await loadDashboard(page);
    await page.evaluate(() => {
        window.dashboardInstance.settings.inboxEnabled = true;
    });
    await page.evaluate(async (url) => {
        const api = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
        await api('/api/inbox', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url, title: 'Modern layout seed' }),
        });
    }, `https://modern-inbox-${Date.now()}.example.com`);

    await page.locator('#page-nav-inbox-btn').click();
    await expect(page.locator('.inbox-layout')).toBeVisible();
    await expect(page.locator('.inbox-feed .inbox-item').first()).toBeVisible();
}

/**
 * Switch layout in place. Transitions are killed first: modern animates
 * box-shadow, and a shadow still interpolating out of `none` computes as fully
 * transparent, which would make an assertion pass while nothing is drawn.
 */
async function setLayout(page, version) {
    await page.addStyleTag({
        content: '*, *::before, *::after { transition: none !important; animation: none !important; }',
    });
    await page.evaluate((v) => {
        document.documentElement.setAttribute('data-layout-version', v);
        document.body.setAttribute('data-layout-version', v);
    }, version);
    await page.evaluate(() => new Promise((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(resolve));
    }));
}

async function computed(page, selector, props) {
    return page.evaluate(({ sel, list }) => {
        const el = document.querySelector(sel);
        if (!el) throw new Error(`missing element: ${sel}`);
        const s = getComputedStyle(el);
        return Object.fromEntries(list.map((p) => [p, s[p]]));
    }, { sel: selector, list: props });
}

async function bothLayouts(page, selector, props) {
    await setLayout(page, 'classic');
    const classic = await computed(page, selector, props);
    await setLayout(page, 'modern');
    const modern = await computed(page, selector, props);
    return { classic, modern };
}

test.describe('modern layout — inbox', () => {
    test('restyles feed rows', async ({ page }) => {
        await openInbox(page);
        const { classic, modern } = await bothLayouts(
            page,
            '.inbox-item',
            ['borderRadius', 'boxShadow'],
        );

        expect(modern.borderRadius).not.toBe(classic.borderRadius);
        expect(classic.boxShadow).toBe('none');
        expect(modern.boxShadow).not.toBe('none');
    });

    test('redraws the unread marker as an inset bar', async ({ page }) => {
        await openInbox(page);

        // Classic draws unread as a 3px left border, which a rounded row clips
        // into a wedge; modern moves it into an inset shadow that follows the
        // corner. A freshly seeded item is unread.
        const { classic, modern } = await bothLayouts(
            page,
            '.inbox-item.is-unread',
            ['borderLeftWidth', 'boxShadow'],
        );

        expect(classic.borderLeftWidth).toBe('3px');
        expect(modern.borderLeftWidth).toBe('1px');

        // Not merely "an inset exists": the bar must be drawn at full opacity.
        // A shadow read mid-transition interpolates out of `none` and computes
        // as transparent, which would pass a bare contains('inset') check while
        // showing no marker at all.
        const insetLayer = modern.boxShadow.split(/,(?![^(]*\))/).find((l) => l.includes('inset'));
        expect(insetLayer).toBeDefined();
        expect(insetLayer).not.toMatch(/\/\s*0\s*\)|rgba\([^)]*,\s*0\)/);
    });

    test('restyles summary tiles and the filter group', async ({ page }) => {
        await openInbox(page);

        const tile = await bothLayouts(page, '.inbox-tile', ['borderRadius', 'boxShadow']);
        expect(tile.modern.borderRadius).not.toBe(tile.classic.borderRadius);
        expect(tile.modern.boxShadow).not.toBe('none');

        // The pill shape is already right in classic, so only depth changes.
        const group = await bothLayouts(page, '.inbox-filter-group', ['boxShadow']);
        expect(group.classic.boxShadow).toBe('none');
        expect(group.modern.boxShadow).not.toBe('none');
    });

    test('restyles row action buttons', async ({ page }) => {
        await openInbox(page);
        const { classic, modern } = await bothLayouts(page, '.inbox-action-btn', ['borderRadius']);
        expect(modern.borderRadius).not.toBe(classic.borderRadius);
    });

    test('leaves classic unchanged when the layout attribute is absent', async ({ page }) => {
        await openInbox(page);

        await setLayout(page, 'classic');
        const asClassic = await computed(page, '.inbox-item', ['borderRadius', 'boxShadow', 'borderLeftWidth']);

        await page.evaluate(() => {
            document.documentElement.removeAttribute('data-layout-version');
            document.body.removeAttribute('data-layout-version');
        });
        const noAttribute = await computed(page, '.inbox-item', ['borderRadius', 'boxShadow', 'borderLeftWidth']);

        expect(noAttribute).toEqual(asClassic);
    });
});

test.describe('modern layout — quickstart card', () => {
    /**
     * The e2e data dir is a fresh install, so the real setup card is already on
     * screen. Load without the onboarding dismissal the other specs use and
     * assert against the genuine markup rather than an injected copy.
     */
    async function showQuickstartCard(page) {
        await markWhatsNewSeen(page);
        await page.goto('/');
        await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
        await page.evaluate(() => {
            const d = window.dashboardInstance;
            d.settings.onboardingCompleted = false;
            d.settings.quickStart = {
                setupDone: false,
                dismissed: false,
                visitedConfig: false,
                seenCheatsheet: false,
            };
            d.onboardingStartedInSession = false;
            document.querySelectorAll('.quickstart-card').forEach((el) => el.remove());
            if (typeof window.QuickStart === 'function') {
                d.quickStart = new window.QuickStart(d);
                d.onboardingStartedInSession = d.quickStart.shouldStart();
                d.quickStart.start();
            }
        });
        await expect(page.locator('.quickstart-card')).toBeVisible({ timeout: 15_000 });
    }

    test('gives the floating card the overlay surface treatment', async ({ page }) => {
        await showQuickstartCard(page);

        // The card floats over the dashboard, so it follows the overlay grammar
        // (rounded, tinted, layered shadow) rather than the flat in-page panels.
        const card = await bothLayouts(page, '.quickstart-card', ['borderRadius', 'boxShadow']);
        expect(card.modern.borderRadius).not.toBe(card.classic.borderRadius);
        expect(card.modern.boxShadow).not.toBe(card.classic.boxShadow);

        // The stripe spans the card's top edge, so a rounded card clips its
        // upper corners unless the stripe rounds to match.
        const stripe = await bothLayouts(page, '.quickstart-stripe', ['borderRadius']);
        expect(stripe.classic.borderRadius).toBe('0px');
        expect(stripe.modern.borderRadius).not.toBe('0px');
    });

    test('rounds the close button', async ({ page }) => {
        await showQuickstartCard(page);

        // The card has two variants: this first-run one is the setup card, which
        // carries no .quickstart-item-action rows — those belong to the
        // checklist variant. The close button is on both.
        const { classic, modern } = await bothLayouts(page, '.quickstart-close', ['borderRadius']);
        expect(modern.borderRadius).not.toBe(classic.borderRadius);
    });
});
