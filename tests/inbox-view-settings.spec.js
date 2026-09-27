// @ts-check
const { test, expect } = require('./fixtures');
const { openInboxWith, item } = require('./helpers/inbox-report');
const { markWhatsNewSeen, dismissBlockingOverlays, dismissOnboardingIfPresent } = require('./e2e-helpers');

/**
 * Config → Inbox: the section, and its settings taking effect in the Inbox view.
 *
 * The view settings are served as the server would send them (the GET answered
 * with them merged in) and a save is answered here, never stored: the stand-in
 * values must not reach the shared data dir.
 */
async function withSettings(page, values) {
    await page.route(/\/api\/settings(\?.*)?$/, async (route) => {
        if (route.request().method() === 'POST') {
            return route.fulfill({ json: JSON.parse(route.request().postData() || '{}') });
        }
        if (route.request().method() !== 'GET') return route.fallback();
        const res = await route.fetch();
        const body = await res.json();
        await route.fulfill({ response: res, json: { ...body, ...values } });
    });
}

async function open(page, values) {
    await page.setViewportSize({ width: 1400, height: 900 });
    if (values) await withSettings(page, values);
    await openInboxWith(page);
}

const drawer = (page) => page.locator('.lvs-drawer-host[data-lvs-drawer="inbox"] .lvs-drawer');

async function openConfigInbox(page, tab = '') {
    await page.setViewportSize({ width: 1400, height: 900 });
    await markWhatsNewSeen(page);
    await page.goto(`/#config/inbox${tab ? `/${tab}` : ''}`);
    await page.waitForSelector('#dashboard-layout', { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.waitForSelector('#config-inbox-body .config-panel', { timeout: 15_000 });
}

test.describe('Config → Inbox', () => {
    test('stands between Bookmarks and Structure, with the inbox\'s settings', async ({ page }) => {
        await openConfigInbox(page);
        const order = await page.locator('.config-nav-item').evaluateAll((els) => els.map((el) => el.getAttribute('data-config-section')));
        expect(order.indexOf('inbox')).toBe(order.indexOf('bookmarks') + 1);
        expect(order.indexOf('structure')).toBe(order.indexOf('inbox') + 1);
        const tabs = await page.locator('[data-inbox-tab]').evaluateAll((els) => els.map((el) => el.getAttribute('data-inbox-tab')));
        expect(tabs).toEqual(['collecting', 'list', 'panel', 'icon']);
        const onTab = {
            collecting: ['inboxEnabled', 'inboxShowInPageTabs', 'pasteDestination', 'inboxDeleteAfterPromote'],
            list: ['inboxViewFilter', 'inboxViewSort', 'inboxViewAddress', 'inboxViewKeyLegend'],
            panel: ['inboxViewRail', 'inboxViewPanelWidth', 'inboxViewClick', 'inboxViewDblClick'],
            icon: ['inboxViewBadge', 'inboxViewBadgeCounts'],
        };
        for (const [tab, fields] of Object.entries(onTab)) {
            await page.locator(`[data-inbox-tab="${tab}"]`).click();
            await expect(page.locator(`[data-inbox-tab="${tab}"]`)).toHaveAttribute('aria-selected', 'true');
            await expect(page).toHaveURL(new RegExp(`#config/inbox/${tab}$`));
            for (const field of fields) {
                await expect(page.locator(`#config-inbox-body [data-behavior-field="${field}"]`)).toHaveCount(1);
            }
            // Nothing from another tab.
            const others = Object.entries(onTab).filter(([t]) => t !== tab).flatMap(([, f]) => f);
            for (const field of others) {
                await expect(page.locator(`#config-inbox-body [data-behavior-field="${field}"]`)).toHaveCount(0);
            }
        }
    });

    test('the preview stands over the list and the panel only, and the tab is remembered', async ({ page }) => {
        await openConfigInbox(page);
        await expect(page.locator('[data-inbox-tab="collecting"]')).toHaveAttribute('aria-selected', 'true');
        await expect(page.locator('[data-inbox-view-preview]')).toHaveCount(0);
        await page.locator('[data-inbox-tab="panel"]').click();
        await expect(page.locator('[data-inbox-view-preview]')).toHaveCount(1);
        await page.locator('[data-inbox-tab="icon"]').click();
        await expect(page.locator('[data-inbox-view-preview]')).toHaveCount(0);
        // A fresh load past the five-minute config location: the tab comes
        // from this browser's remembered tab alone.
        await page.evaluate(() => localStorage.removeItem('nextdash:config-last-location-v1'));
        await page.goto('about:blank');
        await page.goto('/#config/inbox');
        await page.waitForSelector('[data-inbox-tab]', { timeout: 15_000 });
        await expect(page.locator('[data-inbox-tab="icon"]')).toHaveAttribute('aria-selected', 'true');
    });

    test('the filter names the tab a setting is on', async ({ page }) => {
        await openConfigInbox(page);
        await page.locator('[data-settings-filter]').fill('double click');
        const elsewhere = page.locator('[data-filter-elsewhere="panel"]');
        await expect(elsewhere).toBeVisible();
        await elsewhere.click();
        await expect(page.locator('[data-inbox-tab="panel"]')).toHaveAttribute('aria-selected', 'true');
        await expect(page.locator('#config-inbox-body [data-behavior-field="inboxViewDblClick"]')).toBeVisible();
    });

    test('Behavior keeps Fresh alone, and the old address still opens it', async ({ page }) => {
        await markWhatsNewSeen(page);
        await page.goto('/#config/behavior/inbox');
        await page.waitForSelector('[data-behavior-tab="fresh"]', { timeout: 15_000 });
        await expect(page.locator('[data-behavior-tab="fresh"]')).toHaveAttribute('aria-selected', 'true');
        await expect(page.locator('[data-behavior-tab="fresh"]')).toContainText('Fresh');
        await expect(page.locator('[data-behavior-field="feedsEnabled"]')).toHaveCount(1);
        await expect(page.locator('[data-behavior-field="inboxEnabled"]')).toHaveCount(0);
    });

    test('the preview shows two rows and follows a change', async ({ page }) => {
        await withSettings(page, {});
        await openConfigInbox(page, 'list');
        const rows = page.locator('[data-inbox-view-preview] .inbox-item');
        await expect(rows).toHaveCount(2);
        await expect(rows.first().locator('.inbox-item-domain')).toHaveCount(1);
        await page.locator('#config-inbox-body select[data-behavior-field="inboxViewAddress"]').selectOption('hidden');
        await expect(page.locator('[data-inbox-view-preview] .inbox-item')).toHaveCount(2);
        await expect(page.locator('[data-inbox-view-preview] .inbox-item-domain')).toHaveCount(0);
    });
});

test.describe('the Inbox view follows Config → Inbox', () => {
    test('it opens on the filter set there, whatever was used last', async ({ page }) => {
        await page.addInitScript(() => {
            try { localStorage.setItem('nextdash:inbox-view-state', JSON.stringify({ filter: 'all', sort: 'newest' })); } catch {}
        });
        await open(page, { inboxViewFilter: 'unread', inboxViewSort: 'title' });
        expect(await page.evaluate(() => {
            const inbox = window.dashboardInstance.inbox.instance;
            return [inbox.filter, inbox.sort];
        })).toEqual(['unread', 'title']);
    });

    test('the address can be the whole one, or none', async ({ page }) => {
        await open(page, { inboxViewAddress: 'full' });
        await expect(item(page, 'Read one').locator('.inbox-item-domain')).toHaveText(/example\.com\/read/);
    });

    test('a hidden address leaves no site button', async ({ page }) => {
        await open(page, { inboxViewAddress: 'hidden' });
        await expect(page.locator('.inbox-item .inbox-item-domain')).toHaveCount(0);
    });

    test('unread rows can go unmarked', async ({ page }) => {
        await open(page, { inboxViewUnreadMark: false });
        await expect(item(page, 'Unread one')).not.toHaveAttribute('data-lvs-status', 'info');
    });

    test('the key legend can sit above the list, or go', async ({ page }) => {
        await open(page, { inboxViewKeyLegend: 'above' });
        const above = await page.evaluate(() => {
            const legend = document.querySelector('.inbox-legend');
            const feed = document.querySelector('.inbox-feed');
            return Boolean(legend && feed) && Boolean(legend.compareDocumentPosition(feed) & Node.DOCUMENT_POSITION_FOLLOWING);
        });
        expect(above).toBe(true);
    });

    test('a legend set off is not drawn', async ({ page }) => {
        await open(page, { inboxViewKeyLegend: 'off' });
        await expect(page.locator('.inbox-legend')).toHaveCount(0);
    });

    test('a click can only select the row', async ({ page }) => {
        await open(page, { inboxViewClick: 'select' });
        await item(page, 'Read one').locator('.inbox-item-title').click();
        await page.waitForTimeout(300);
        await expect(drawer(page)).toHaveCount(0);
    });

    test('a double click can open the note, ready to type in', async ({ page }) => {
        await open(page, { inboxViewDblClick: 'note' });
        await page.evaluate(() => { window.open = () => null; });
        await item(page, 'Unread one').locator('.inbox-item-title').dblclick();
        await expect(drawer(page).locator('[data-inbox-note]')).toBeFocused();
    });

    test('a click beside the panel closes it, unless set to stay', async ({ page }) => {
        await open(page, {});
        await item(page, 'Read one').locator('.inbox-item-title').click();
        await expect(drawer(page)).toBeVisible();
        await page.locator('.lvs-header-text').first().click();
        await expect(drawer(page)).toHaveCount(0);
    });

    test('the panel can stay open on a click beside it', async ({ page }) => {
        await open(page, { inboxViewCloseOutside: false });
        await item(page, 'Read one').locator('.inbox-item-title').click();
        await expect(drawer(page)).toBeVisible();
        await page.locator('.lvs-header-text').first().click();
        await expect(drawer(page)).toBeVisible();
    });

    test('the wide panel is wider', async ({ page }) => {
        await open(page, { inboxViewPanelWidth: 'wide' });
        await item(page, 'Read one').locator('.inbox-item-title').click();
        const w = await page.locator('.lvs-drawer-host[data-lvs-drawer="inbox"] .lvs-drawer-frame')
            .evaluate((el) => Math.round(el.getBoundingClientRect().width));
        expect(w).toBe(512);
    });

    test('a folded rail waits behind the Filters button', async ({ page }) => {
        await open(page, { inboxViewRail: 'folded' });
        await expect(page.locator('.inbox-layout .lvs-rail')).toBeHidden();
        await page.locator('[data-inbox-rail-toggle]').click();
        await expect(page.locator('.inbox-layout .lvs-rail')).toBeVisible();
    });

    test('the header icon can count everything awake, or nothing', async ({ page }) => {
        await open(page, { inboxViewBadgeCounts: 'all' });
        // Two awake (unread and read), one snoozed.
        await expect(page.locator('#page-inbox-badge')).toHaveText('2');
    });

    test('a count set off is not shown', async ({ page }) => {
        await open(page, { inboxViewBadge: false });
        await expect(page.locator('#page-inbox-badge')).toBeHidden();
    });
});
