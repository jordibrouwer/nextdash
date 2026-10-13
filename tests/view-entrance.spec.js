const { test, expect } = require('./fixtures');
const { mockDocker } = require('./helpers/docker-mock');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * The list views arrive the way the tag view does: the header, rail and
 * toolbar rise in, then the rows one after another, and then hold still.
 */

async function openDashboard(page) {
    await page.setViewportSize({ width: 1400, height: 900 });
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?._bookmarksReady === true, null, { timeout: 20_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
}

/** The elements matching `selector` that a running lvsRise animation is moving. */
function risingCount(page, selector) {
    return page.evaluate((sel) => document.getAnimations()
        .filter((a) => a.animationName === 'lvsRise' && a.effect?.target?.matches?.(sel))
        .length, selector);
}

const VIEWS = [
    {
        name: 'Bookmarks view',
        open: (page) => page.locator('.library-link-anchor').first().click(),
        header: '.config-view--library .lvs-header',
        row: '.config-bm-row',
    },
    {
        name: 'Inbox view',
        // Three items, so there are rows to come in one after another.
        prepare: (page) => page.evaluate(async () => {
            const api = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
            const stamp = Date.now();
            for (let i = 0; i < 3; i += 1) {
                await api('/api/inbox', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ url: `https://rise${i}-${stamp}.example/x`, title: `Rise ${i}` }),
                });
            }
        }),
        // The tests share the dev data directory: take the items out again.
        cleanup: (page) => page.evaluate(async () => {
            const api = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
            const items = await (await api('/api/inbox')).json();
            const list = Array.isArray(items) ? items : (items.items || []);
            for (const item of list.filter((i) => /^https:\/\/rise\d-/.test(i.url || ''))) {
                await api(`/api/inbox?id=${encodeURIComponent(item.id)}`, { method: 'DELETE' });
            }
        }),
        open: (page) => page.locator('#page-nav-inbox-btn').click(),
        header: '.lvs-header',
        row: '.inbox-item',
    },
    {
        name: 'Containers view',
        setup: (page) => mockDocker(page),
        open: (page) => page.locator('#page-nav-docker-host a').click(),
        header: '.lvs-header',
        row: '.docker-row',
    },
];

for (const view of VIEWS) {
    test(`the ${view.name} rises in, then holds still`, async ({ page }) => {
        if (view.setup) await view.setup(page);
        await openDashboard(page);
        if (view.prepare) {
            await view.prepare(page);
            // The inbox reads its list at startup; a fresh load sees the seed.
            await openDashboard(page);
        }
        await view.open(page);

        await expect.poll(() => risingCount(page, view.row), { timeout: 3000, intervals: [20] }).toBeGreaterThan(1);
        expect(await risingCount(page, view.header)).toBeGreaterThan(0);
        // It is an arrival, not a state: the rows settle and stay put.
        await expect.poll(() => risingCount(page, `${view.header}, ${view.row}`), { timeout: 3000 }).toBe(0);
        await expect(page.locator('body')).not.toHaveAttribute('data-view-entering', /.+/);
        if (view.cleanup) await view.cleanup(page);
    });
}

test('with animations off a view arrives without moving', async ({ page }) => {
    await mockDocker(page);
    await openDashboard(page);
    await page.evaluate(() => document.body.classList.add('no-animations'));
    await page.locator('#page-nav-docker-host a').click();
    await expect(page.locator('.docker-row').first()).toBeVisible();
    expect(await risingCount(page, '.lvs-header, .docker-row')).toBe(0);
});
