// @ts-check
const { test, expect } = require('@playwright/test');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * Health, Inbox and Config → Bookmarks show the same rows and should look it.
 *
 * They already did, by accident: the card rule was written out three times in
 * three stylesheets and the copies happened to be byte-identical. That is one
 * design with three places to change it. It lives in feed-row.css now, and each
 * view keeps only what genuinely differs — Health's checkbox column, and the
 * coloured edge each view uses for its own state.
 *
 * The two views also disagreed with each other on shape: Inbox rounded its
 * filter pills and buttons, Health squared them off. Rounded won.
 *
 * These tests compare the three against each other rather than against fixed
 * numbers, so the shared design can change without rewriting them — what must
 * not change is that the three agree.
 */

async function openDashboard(page) {
    await page.setViewportSize({ width: 1400, height: 1000 });
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForSelector('#dashboard-layout', { timeout: 20_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.waitForFunction(() => window.dashboardInstance?._bookmarksReady === true, null, { timeout: 20_000 });
}

/** The properties that make two surfaces read as the same component. */
const boxOf = (page, selector) => page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const c = getComputedStyle(el);
    return {
        radius: c.borderRadius,
        padding: c.padding,
        gap: c.gap,
        borderWidth: c.borderTopWidth,
        background: c.backgroundColor,
    };
}, selector);

const openHealth = async (page) => {
    await page.evaluate(() => window.dashboardInstance.health.openHealthView());
    await page.waitForFunction(
        () => document.querySelector('#dashboard-layout.health-layout'), null, { timeout: 15_000 });
    await page.waitForTimeout(400);
};

const openInbox = async (page) => {
    await page.evaluate(() => window.dashboardInstance.inbox.openInboxView());
    await page.waitForFunction(
        () => document.querySelector('#dashboard-layout.inbox-layout'), null, { timeout: 15_000 });
    await page.waitForTimeout(400);
};

const openConfigBookmarks = async (page) => {
    await page.evaluate(() => window.dashboardInstance.config.openConfigView('bookmarks'));
    await page.waitForSelector('.config-bm-feed', { timeout: 15_000 });
    await page.waitForTimeout(400);
};

test.describe('the three views share one row', () => {
    test('every feed row is built from the shared card', async ({ page }) => {
        await openDashboard(page);
        await openConfigBookmarks(page);

        const row = await page.evaluate(() => {
            const el = document.querySelector('.config-bm-item');
            return el ? { shared: el.classList.contains('feed-row'), own: el.classList.contains('config-bm-item') } : null;
        });
        expect(row).not.toBeNull();
        // Both: the shared card carries the look, the view class carries its own
        // additions and is what the tests and sibling modules select on.
        expect(row.shared).toBe(true);
        expect(row.own).toBe(true);

        await openInbox(page);
        expect(await page.evaluate(() => {
            const el = document.querySelector('.inbox-item');
            return el ? el.classList.contains('feed-row') : 'no rows';
        })).not.toBe(false);
    });

    test('the card rule is declared once, not once per view', async ({ page }) => {
        await openDashboard(page);

        // Counted across the stylesheets rather than on an element: three
        // identical rules render identically, which is exactly how this went
        // unnoticed. What is being asserted is that there is one source.
        const declarations = await page.evaluate(async () => {
            const files = ['css/health-view.css', 'css/dashboard-inbox.css', 'css/config-view.css'];
            const hits = {};
            for (const file of files) {
                const href = [...document.styleSheets]
                    .map((s) => s.href).filter(Boolean).find((h) => h.includes(file));
                const text = href ? await (await fetch(href)).text() : '';
                hits[file] = /grid-template-columns:\s*3rem 1fr/.test(text);
            }
            return hits;
        });

        expect(declarations['css/health-view.css']).toBe(false);
        expect(declarations['css/dashboard-inbox.css']).toBe(false);
        expect(declarations['css/config-view.css']).toBe(false);
    });

    test('Config → Bookmarks and Inbox render the same card', async ({ page }) => {
        await openDashboard(page);
        await openConfigBookmarks(page);
        const config = await boxOf(page, '.config-bm-item');

        await openInbox(page);
        const inbox = await boxOf(page, '.inbox-item');
        test.skip(inbox === null, 'the fixture inbox is empty');

        expect(config).toEqual(inbox);
    });
});

test.describe('the three views share one tile', () => {
    test('Config → Bookmarks uses the Health tile, without the stripe', async ({ page }) => {
        await openDashboard(page);
        await openConfigBookmarks(page);
        const config = await boxOf(page, '.config-tiles--bookmarks .config-tile');
        const stripe = await page.evaluate(() => getComputedStyle(
            document.querySelector('.config-tiles--bookmarks .config-tile'), '::before').content);

        await openHealth(page);
        const health = await boxOf(page, '.health-view-tile:not(.is-active)');

        expect(config).not.toBeNull();
        expect(health).not.toBeNull();
        expect(config.radius).toBe(health.radius);
        expect(config.padding).toBe(health.padding);
        expect(config.gap).toBe(health.gap);
        expect(config.background).toBe(health.background);
        // Health carries tone in the value's colour; the stripe was the one
        // thing that made this tile a different component.
        expect(stripe).toBe('none');
    });
});

test.describe('rounded is the shared shape', () => {
    test('Health and Inbox round their filter group the same way', async ({ page }) => {
        await openDashboard(page);

        await openHealth(page);
        const health = await boxOf(page, '.health-view-filter-group');
        await openInbox(page);
        const inbox = await boxOf(page, '.inbox-filter-group');

        expect(health).not.toBeNull();
        expect(inbox).not.toBeNull();
        expect(health.radius).toBe(inbox.radius);
        // Pills, not a squared-off block — Health was the one squaring them.
        expect(parseFloat(health.radius)).toBeGreaterThan(20);
    });

    test('nothing in the three views is squared off any more', async ({ page }) => {
        await openDashboard(page);

        const squared = await page.evaluate(async () => {
            const files = ['css/health-view.css', 'css/dashboard-inbox.css', 'css/view-explainers.css'];
            const out = {};
            for (const file of files) {
                const href = [...document.styleSheets]
                    .map((s) => s.href).filter(Boolean).find((h) => h.includes(file));
                const text = href ? await (await fetch(href)).text() : '';
                out[file] = (text.match(/border-radius:\s*0;/g) || []).length;
            }
            return out;
        });

        expect(squared).toEqual({
            'css/health-view.css': 0,
            'css/dashboard-inbox.css': 0,
            'css/view-explainers.css': 0,
        });
    });
});

test.describe('Config → Bookmarks opens like a view', () => {
    test('it has a header with a subtitle and a count, the way Health and Inbox do', async ({ page }) => {
        await openDashboard(page);
        await openConfigBookmarks(page);

        const header = await page.evaluate(() => {
            const h = document.querySelector('.config-bm-header');
            if (!h) return null;
            return {
                // The section shell already prints "Bookmarks" above the
                // breadcrumb, so the header carries no title of its own —
                // two of them one line apart read as a mistake.
                ownTitle: h.querySelector('h1, h2, h3') !== null,
                subtitle: Boolean(h.querySelector('.config-bm-subtitle')),
                badge: h.querySelector('.config-bm-header-badge')?.textContent?.trim() || '',
            };
        });

        expect(header).not.toBeNull();
        expect(header.ownTitle).toBe(false);
        expect(header.subtitle).toBe(true);
        // The count is the number of bookmarks, not a placeholder.
        expect(Number(header.badge)).toBe(await page.evaluate(
            () => (window.dashboardInstance.allBookmarks || []).length));
    });

    test('its search box matches the one in Health', async ({ page }) => {
        await openDashboard(page);
        await openConfigBookmarks(page);
        const config = await boxOf(page, '.config-crud-toolbar--view .config-text');

        await openHealth(page);
        const health = await boxOf(page, '.health-view-search-input');

        expect(config).not.toBeNull();
        expect(health).not.toBeNull();
        expect(config.radius).toBe(health.radius);
        expect(config.padding).toBe(health.padding);
        expect(config.background).toBe(health.background);
    });
});
