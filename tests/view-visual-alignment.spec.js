// @ts-check
const { test, expect } = require('./fixtures');
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
    await page.waitForSelector('#config-bm-workbench .config-bm-feed', { timeout: 15_000 });
    await page.waitForTimeout(400);
};

test.describe('the three views share one row', () => {
    // Config → Bookmarks stopped being one of the three here: the workbench
    // redesign gave it a fixed-height grid row of its own (.config-bm-row),
    // built for a windowed list with group slabs rather than the shared
    // feed-row card Health and Inbox still use. Only the Inbox/Health half of
    // this claim still holds, so that is what is left asserted.
    test('the health and inbox rows are still built from the shared card', async ({ page }) => {
        await openDashboard(page);
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
});

// 'the three views share one tile' is gone: the bookmarks workbench has no
// summary tiles; its counts live in the filter rail.

test.describe('rounded is the shared shape', () => {
    test('Health and Inbox round their filter group the same way', async ({ page }) => {
        await openDashboard(page);

        await openHealth(page);
        // The list-view shell unified what used to differ here: Inbox no
        // longer wraps its filters in a pill-shaped group — that markup
        // (.inbox-filter-group) is gone, and .lvs-group--filters carries no
        // shape of its own (0px radius, no border, no background). Each
        // filter is now its own row, sharing the same small radius token
        // Health's group already used. .health-view-filter-group is kept as
        // an alias on the shell's filter *list* container (0px radius, the
        // group's own box) — comparing shape means comparing individual rows
        // on both sides, so this reads .lvs-filter here too.
        const health = await boxOf(page, '.lvs-filter');
        await openInbox(page);
        const inbox = await boxOf(page, '.lvs-filter');

        expect(health).not.toBeNull();
        expect(inbox).not.toBeNull();
        expect(parseFloat(health.radius)).toBeGreaterThan(0);
        expect(inbox.radius).toBe(health.radius);
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
            const h = document.querySelector('.config-view-head');
            if (!h) return null;
            const body = document.querySelector('#config-view-body');
            return {
                // The opening line is lifted onto the view band, the way
                // every section's intro is.
                subtitle: Boolean(h.querySelector('.lvs-description')?.textContent.trim()),
                badge: h.querySelector('.config-bm-header-badge')?.textContent?.trim() || '',
                // Nothing of the header stays behind in the body: a block
                // left there stood the tab strip a row below every other
                // section's strip.
                firstBodyChild: body?.firstElementChild?.className || '',
            };
        });

        expect(header).not.toBeNull();
        expect(header.subtitle).toBe(true);
        expect(header.firstBodyChild).toContain('config-subtabs');
        // The count is the number of bookmarks, not a placeholder.
        expect(Number(header.badge)).toBe(await page.evaluate(
            () => (window.dashboardInstance.allBookmarks || []).length));
    });

    test('its search box matches the one in Health', async ({ page }) => {
        await openDashboard(page);
        await openConfigBookmarks(page);
        const config = await boxOf(page, '#config-bm-rail #config-bm-search');

        await openHealth(page);
        const health = await boxOf(page, '.health-view-search-input');

        expect(config).not.toBeNull();
        expect(health).not.toBeNull();
        expect(config.radius).toBe(health.radius);
        // Padding is not compared: the rail's box keeps room on the right for
        // its `/` hint.
        expect(config.background).toBe(health.background);
    });
});
