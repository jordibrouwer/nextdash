// @ts-check
const { test, expect } = require('./fixtures');
const {
    markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays, waitForFaviconPrefetch,
    markWidgetsTutorialSeen,
} = require('./e2e-helpers');

/**
 * Every widget's settings panel is the same three folding sections:
 * Connection, Display and Advanced, in that order, with an empty one left out.
 * Learning where a setting lives on one widget then teaches it for all of them.
 */
async function openWidget(page, widget) {
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await waitForFaviconPrefetch(page);
    await markWidgetsTutorialSeen(page);
    await page.evaluate(async (list) => {
        const f = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
        const headers = { 'Content-Type': 'application/json',
            ...(typeof nextDashWriteHeaders === 'function' ? nextDashWriteHeaders() : {}) };
        const dash = window.dashboardInstance;
        await f(`/api/pages/${dash.pages[0].id}/blocks`, { method: 'PUT', headers, body: JSON.stringify({ widgets: list }) });
        await dash.config.openConfigView('widgets');
    }, [widget]);
    await expect(page.locator('#config-widgets-body')).toBeVisible();
    const toggle = page.locator('[data-widget-settings]').first();
    await expect(toggle).toBeVisible();
    if (await toggle.getAttribute('aria-expanded') !== 'true') await toggle.click();
    const detail = page.locator('.config-widget-detail').first();
    await expect(detail).toBeVisible();
    return detail;
}

// RSS has no refresh of its own (its feeds are fetched by the server), so the
// kind with all three sections is Glances: a host, a look and a refresh.
const rss = { type: 'rss', title: 'News', config: {} };
const glances = { type: 'glances', title: 'Glances', config: {} };
const section = (detail, name) => detail.locator(`[data-widget-section="${name}"]`);
const names = (detail) => detail.locator('[data-widget-section]')
    .evaluateAll((els) => els.map((el) => el.getAttribute('data-widget-section')));
const repaint = (page) => page.evaluate(() => {
    const c = window.dashboardInstance.config.instance || window.dashboardInstance.config;
    c.repaintWidgetsKeepingFocus();
});

test.describe('widget settings in three sections', () => {
    test('Glances shows Connection, Display and Advanced in that order', async ({ page }) => {
        const detail = await openWidget(page, glances);
        expect(await names(detail)).toEqual(['connection', 'display', 'advanced']);
        await expect(section(detail, 'connection').locator('[data-widget-setting="host"]')).toHaveCount(1);
        await expect(section(detail, 'display').locator('[data-widget-setting="style"]')).toHaveCount(1);
        await expect(section(detail, 'advanced').locator('[data-widget-setting="refreshSeconds"]')).toHaveCount(1);
        await expect(section(detail, 'connection').locator('summary')).toHaveText('Connection');
        await expect(section(detail, 'display').locator('summary')).toHaveText('Display');
        await expect(section(detail, 'advanced').locator('summary')).toHaveText('Advanced');
    });

    test('RSS keeps its feeds in Connection and its rows in Display', async ({ page }) => {
        const detail = await openWidget(page, rss);
        expect(await names(detail)).toEqual(['connection', 'display']);
        await expect(section(detail, 'connection').locator('[data-widget-setting="feedUrls"]')).toHaveCount(1);
        await expect(section(detail, 'display').locator('[data-widget-setting="rows"]')).toHaveCount(1);
        await expect(section(detail, 'display').locator('[data-widget-setting="columns"]')).toHaveCount(1);
    });

    test('Display is open, Advanced is collapsed, Connection is open for an unconnected widget', async ({ page }) => {
        const detail = await openWidget(page, glances);
        await expect(section(detail, 'connection')).toHaveAttribute('open', '');
        await expect(section(detail, 'display')).toHaveAttribute('open', '');
        await expect(section(detail, 'advanced')).not.toHaveAttribute('open', /.*/);
    });

    test('Connection is collapsed for a widget that already has its feeds', async ({ page }) => {
        const detail = await openWidget(page, { ...rss, config: { feedUrls: ['https://example.com/feed.xml'] } });
        await expect(section(detail, 'connection')).not.toHaveAttribute('open', /.*/);
        await expect(section(detail, 'display')).toHaveAttribute('open', '');
    });

    test('Notes shows only Display', async ({ page }) => {
        const detail = await openWidget(page, { type: 'notes', title: 'Notes', config: {} });
        await expect(detail.locator('[data-widget-section]')).toHaveCount(1);
        expect(await names(detail)).toEqual(['display']);
    });

    test('a repaint keeps an opened section open', async ({ page }) => {
        const detail = await openWidget(page, glances);
        await section(detail, 'advanced').locator('summary').click();
        await expect(section(detail, 'advanced')).toHaveAttribute('open', '');
        await detail.locator('[data-widget-setting="refreshSeconds"]').click();
        await page.keyboard.type('45');
        await repaint(page);
        const after = page.locator('.config-widget-detail').first();
        await expect(section(after, 'advanced')).toHaveAttribute('open', '');
        await expect(after.locator('[data-widget-setting="refreshSeconds"]')).toBeFocused();
        await expect(after.locator('[data-widget-setting="refreshSeconds"]')).toHaveValue('45');
    });

    test('typing a feed address and a repaint keep Connection open with the caret in it', async ({ page }) => {
        const detail = await openWidget(page, rss);
        // A reader's own toggle survives too: Display folded stays folded.
        await section(detail, 'display').locator('summary').click();
        await expect(section(detail, 'display')).not.toHaveAttribute('open', /.*/);
        await detail.locator('[data-widget-setting="feedUrls"]').click();
        await page.keyboard.type('https://example.com/feed.xml');
        await repaint(page);
        const after = page.locator('.config-widget-detail').first();
        await expect(section(after, 'connection')).toHaveAttribute('open', '');
        await expect(section(after, 'display')).not.toHaveAttribute('open', /.*/);
        await expect(after.locator('[data-widget-setting="feedUrls"]')).toBeFocused();
        await expect(after.locator('[data-widget-setting="feedUrls"]')).toHaveValue('https://example.com/feed.xml');
    });

    test('a change made in a collapsed section still marks the draft dirty', async ({ page }) => {
        const detail = await openWidget(page, rss);
        await section(detail, 'display').locator('summary').click();
        await expect(section(detail, 'display')).not.toHaveAttribute('open', /.*/);
        // The block index, not 0: the list holds the page's categories too.
        const index = Number(await detail.getAttribute('data-widget-detail'));
        await page.evaluate((i) => {
            const c = window.dashboardInstance.config.instance || window.dashboardInstance.config;
            c.widgetDraft(i).config.rows = 7;
            c.refreshWidgetSaveBar(i);
        }, index);
        await expect(detail.locator('[data-widget-save]')).toBeEnabled();
        await expect(section(detail, 'display')).not.toHaveAttribute('open', /.*/);
    });

    test('the summary toggles with the keyboard', async ({ page }) => {
        const detail = await openWidget(page, glances);
        const summary = section(detail, 'advanced').locator('summary');
        await summary.focus();
        await page.keyboard.press('Enter');
        await expect(section(detail, 'advanced')).toHaveAttribute('open', '');
        await expect(detail.locator('[data-widget-setting="refreshSeconds"]')).toBeVisible();
        await page.keyboard.press('Enter');
        await expect(section(detail, 'advanced')).not.toHaveAttribute('open', /.*/);
        await expect(detail.locator('[data-widget-setting="refreshSeconds"]')).toBeHidden();
    });

    test('an opened section is forgotten once Config is closed', async ({ page }) => {
        const detail = await openWidget(page, glances);
        await section(detail, 'advanced').locator('summary').click();
        await expect(section(detail, 'advanced')).toHaveAttribute('open', '');
        await page.evaluate(() => {
            const c = window.dashboardInstance.config.instance || window.dashboardInstance.config;
            c.closeConfigView();
        });
        await expect.poll(() => page.evaluate(() => window.dashboardInstance.activeView)).not.toBe('config');
        await expect(page.locator('#config-widgets-body')).toHaveCount(0);
        await page.evaluate(() => window.dashboardInstance.config.openConfigView('widgets'));
        await expect(page.locator('#config-widgets-body')).toBeVisible();
        const toggle = page.locator('[data-widget-settings]').first();
        if (await toggle.getAttribute('aria-expanded') !== 'true') await toggle.click();
        const again = page.locator('.config-widget-detail').first();
        await expect(section(again, 'advanced')).toHaveCount(1);
        await expect(section(again, 'advanced')).not.toHaveAttribute('open', /.*/);
    });

    test('the Save bar stays outside the sections', async ({ page }) => {
        const detail = await openWidget(page, rss);
        await expect(detail.locator('[data-widget-section] [data-widget-save]')).toHaveCount(0);
        await expect(detail.locator('[data-widget-save]')).toHaveCount(1);
    });

    test('at 390px wide the sections stack with no horizontal scroll', async ({ page }) => {
        await page.setViewportSize({ width: 390, height: 844 });
        const custom = { type: 'custom', title: 'Mine', config: { url: 'http://127.0.0.1:9/x', fields: [{ path: 'a.b', label: 'A' }] } };
        for (const widget of [custom, rss]) {
            const detail = await openWidget(page, widget);
            for (const name of ['connection', 'display', 'advanced']) {
                const el = section(detail, name);
                if (await el.count() === 0) continue;
                if (name === 'advanced') await el.locator('summary').click();
                const box = await el.boundingBox();
                expect(box.width).toBeLessThanOrEqual(390);
                expect(box.x + box.width).toBeLessThanOrEqual(390);
            }
            expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
            expect(await page.evaluate(() => window.scrollX)).toBe(0);
        }
    });

    // The default can move after a paint: a widget whose only connection is a
    // stored key is drawn with Connection open until the credential list lands.
    const fileKey = (page) => page.evaluate(() => {
        const dash = window.dashboardInstance;
        const c = dash.config.instance || dash.config;
        const id = document.querySelector('.config-widget-detail [data-widget-section-of]').getAttribute('data-widget-section-of');
        dash.healthCredentialDetails = { ...(dash.healthCredentialDetails || {}), [`widget:${id}`]: { headers: ['X-Api-Key'] } };
        c.repaintWidgetsBody();
    });

    test('a default drawn before the credential list arrives is not kept as a choice', async ({ page }) => {
        const detail = await openWidget(page, glances);
        await expect(section(detail, 'connection')).toHaveAttribute('open', '');
        await expect(section(detail, 'connection')).toHaveAttribute('data-widget-section-default', 'open');
        await fileKey(page);
        await expect(section(detail, 'connection')).not.toHaveAttribute('open', /.*/);
        await expect(section(detail, 'connection')).toHaveAttribute('data-widget-section-default', 'closed');
    });

    test('a reader\'s own toggle still wins across repaints, also when the default moves', async ({ page }) => {
        const detail = await openWidget(page, glances);
        await section(detail, 'advanced').locator('summary').click();
        await section(detail, 'display').locator('summary').click();
        await expect(section(detail, 'advanced')).toHaveAttribute('open', '');
        await expect(section(detail, 'display')).not.toHaveAttribute('open', /.*/);
        await fileKey(page);
        await expect(section(detail, 'connection')).not.toHaveAttribute('open', /.*/);
        await expect(section(detail, 'advanced')).toHaveAttribute('open', '');
        await expect(section(detail, 'display')).not.toHaveAttribute('open', /.*/);
        // Opened Connection after it folded: that is a choice and sticks.
        await section(detail, 'connection').locator('summary').click();
        await repaint(page);
        await expect(section(detail, 'connection')).toHaveAttribute('open', '');
        // Closing what was opened goes back to the default again.
        await section(detail, 'advanced').locator('summary').click();
        await repaint(page);
        await expect(section(detail, 'advanced')).not.toHaveAttribute('open', /.*/);
    });

    test('a repaint keeps the focus on a section title', async ({ page }) => {
        const detail = await openWidget(page, glances);
        await section(detail, 'advanced').locator('summary').focus();
        await repaint(page);
        await expect(section(page.locator('.config-widget-detail').first(), 'advanced').locator('summary')).toBeFocused();
    });

    test('Glances with a host is connected: Connection starts folded', async ({ page }) => {
        const detail = await openWidget(page, { ...glances, config: { host: 'http://glances.lan:61208' } });
        await expect(section(detail, 'connection')).toHaveAttribute('data-widget-section-default', 'closed');
        await expect(section(detail, 'connection')).not.toHaveAttribute('open', /.*/);
    });

    test('a kind with only a setup note in Connection starts with it folded', async ({ page }) => {
        const detail = await openWidget(page, { type: 'cpu', title: 'CPU', config: {} });
        await expect(section(detail, 'connection').locator('.config-widget-setup')).toHaveCount(1);
        await expect(section(detail, 'connection')).toHaveAttribute('data-widget-section-default', 'closed');
        await expect(section(detail, 'connection')).not.toHaveAttribute('open', /.*/);
        await expect(section(detail, 'display')).toHaveAttribute('open', '');
    });
});
