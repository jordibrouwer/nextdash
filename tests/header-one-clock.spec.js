// @ts-check
const { test, expect } = require('./fixtures');
const { prepareDashboardInteraction, dismissWhatsNewIfPresent } = require('./e2e-helpers');

/**
 * The header says the time once.
 *
 * Three things in the header can carry it: the clock line (.date), the mini
 * status under it and the compact chip of the narrow layout. On a tablet --
 * a coarse pointer at 820px -- the coarse-pointer rule showed the mini status,
 * which copied the clock's text, while the clock itself was still there, and
 * the time was drawn twice, one line under the other.
 *
 * The phone layout drops the clock altogether (name and switcher only), so
 * there the bound is at most one rather than exactly one.
 */

async function visibleClocks(page) {
    return page.evaluate(() => {
        const time = document.querySelector('.date-time-line')?.textContent?.match(/\d{1,2}[:.]\d{2}/)?.[0];
        if (!time) return { time: null, shown: [] };
        const candidates = ['#date-element', '#dashboard-mini-status', '#date-badge-mobile'];
        const shown = candidates.filter((sel) => {
            const el = document.querySelector(sel);
            if (!el || !el.textContent.includes(time)) return false;
            const r = el.getBoundingClientRect();
            return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden';
        });
        return { time, shown };
    });
}

async function openDashboard(page) {
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
    await prepareDashboardInteraction(page);
    await dismissWhatsNewIfPresent(page);
    await page.waitForSelector('.date-time-line', { state: 'attached' });
    // The mini status is filled once settings land; wait for it so a late
    // write cannot slip in after the count.
    await page.waitForFunction(() => document.getElementById('dashboard-mini-status')?.textContent.trim());
}

test.describe('tablet, coarse pointer at 820px', () => {
    test.use({ viewport: { width: 820, height: 1180 }, hasTouch: true, isMobile: true });

    test('shows one clock', async ({ page }) => {
        await openDashboard(page);
        expect(await page.evaluate(() => matchMedia('(pointer: coarse)').matches),
            'expected a coarse pointer').toBe(true);
        const { time, shown } = await visibleClocks(page);
        expect(time).not.toBeNull();
        expect(shown).toHaveLength(1);
    });
});

test.describe('phone at 390px', () => {
    test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

    test('shows no more than one clock', async ({ page }) => {
        await openDashboard(page);
        const { shown } = await visibleClocks(page);
        expect(shown.length).toBeLessThanOrEqual(1);
    });
});

test.describe('desktop at 1440px', () => {
    test.use({ viewport: { width: 1440, height: 900 } });

    test('shows one clock', async ({ page }) => {
        await openDashboard(page);
        const { time, shown } = await visibleClocks(page);
        expect(time).not.toBeNull();
        expect(shown).toHaveLength(1);
    });
});
