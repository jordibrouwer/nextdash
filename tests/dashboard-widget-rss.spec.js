// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissBlockingOverlays, dismissOnboardingIfPresent } = require('./e2e-helpers');

/**
 * The RSS widget: headlines from the feeds a tile names.
 *
 * Rows are buttons rather than anchors on purpose — keyboard navigation walks
 * the buttons inside a widget body, so an <a> would be a row the arrow keys
 * skip. data-widget-href is what gives back what an anchor was for.
 */

async function open(page) {
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
}

/** Draw the tile with a stubbed answer, and hand back the rendered body. */
async function drawWith(page, { items, error, config = {} }) {
    return page.evaluate(async ({ items, error, config }) => {
        const d = window.dashboardInstance;
        const realFetch = window.fetch;
        window.fetch = async (url, ...rest) => {
            if (String(url).includes('/api/widgets/rss')) {
                return new Response(JSON.stringify({ fetchedAt: Date.now(), items, error }),
                    { status: 200, headers: { 'Content-Type': 'application/json' } });
            }
            return realFetch(url, ...rest);
        };
        const body = document.createElement('div');
        document.body.appendChild(body);
        try {
            await window.DashboardWidgets.rss(body, { id: 'w_rss_1', type: 'rss', config }, d);
        } finally {
            window.fetch = realFetch;
            delete d._widgetRss;
        }
        const rows = [...body.querySelectorAll('.dashboard-widget-row')];
        const out = {
            text: body.textContent,
            tags: rows.map((row) => row.tagName),
            names: rows.map((row) => row.querySelector('.dashboard-widget-row-name')?.textContent),
            hrefs: rows.map((row) => row.dataset.widgetHref || null),
        };
        body.remove();
        return out;
    }, { items, error, config });
}

const threeItems = [
    { title: 'Newest headline', link: 'https://example.com/3', publishedAt: Date.now(), summary: 'Third summary', source: 'Example' },
    { title: 'Middle headline', link: 'https://example.com/2', publishedAt: Date.now() - 86400000 },
    { title: 'Oldest headline', link: 'https://example.com/1', publishedAt: Date.now() - 172800000 },
];

test.describe('the RSS widget', () => {
    test('it is offered and has a renderer', async ({ page }) => {
        await open(page);
        const state = await page.evaluate(async () => {
            await window.dashboardInstance.config?.load?.();
            const Config = window.DashboardConfig
                || window.dashboardInstance.config?.instance?.constructor;
            return {
                offered: [...(Config?.WIDGET_TYPES || [])],
                renderer: typeof window.DashboardWidgets?.rss,
                settings: (Config?.WIDGET_SETTINGS?.rss || []).map((f) => f.key),
            };
        });
        expect(state.offered).toContain('rss');
        expect(state.renderer).toBe('function');
        expect(state.settings).toEqual(['feedUrls', 'rows']);
    });

    test('with no feeds set, it says where to add one', async ({ page }) => {
        await open(page);
        const drawn = await drawWith(page, { items: [], error: 'no feeds set' });
        expect(drawn.text).toMatch(/settings/i);
    });

    test('rows are buttons carrying the article address', async ({ page }) => {
        await open(page);
        const drawn = await drawWith(page, { items: threeItems, config: { rows: 5 } });
        expect(drawn.names).toEqual(['Newest headline', 'Middle headline', 'Oldest headline']);
        // Buttons, not anchors: keyboard navigation only stops on buttons.
        expect(new Set(drawn.tags)).toEqual(new Set(['BUTTON']));
        expect(drawn.hrefs).toEqual([
            'https://example.com/3', 'https://example.com/2', 'https://example.com/1',
        ]);
    });

    test('the row count is what is shown, with the rest behind a more row', async ({ page }) => {
        await open(page);
        const drawn = await drawWith(page, { items: threeItems, config: { rows: 2 } });
        // Two headlines and the toggle.
        expect(drawn.names.slice(0, 2)).toEqual(['Newest headline', 'Middle headline']);
        expect(drawn.names[2]).toContain('1');
        expect(drawn.names).toHaveLength(3);
    });

    test('the more row expands in place and collapses again', async ({ page }) => {
        await open(page);
        const result = await page.evaluate(async (items) => {
            const d = window.dashboardInstance;
            try { localStorage.removeItem('expandedOverflowWidgets'); } catch (e) { /* ignore */ }
            const realFetch = window.fetch;
            window.fetch = async (url, ...rest) => {
                if (String(url).includes('/api/widgets/rss')) {
                    return new Response(JSON.stringify({ fetchedAt: Date.now(), items }),
                        { status: 200, headers: { 'Content-Type': 'application/json' } });
                }
                return realFetch(url, ...rest);
            };
            const body = document.createElement('div');
            document.body.appendChild(body);
            const widget = { id: 'w_rss_toggle', type: 'rss', config: { rows: 1 } };
            try {
                await window.DashboardWidgets.rss(body, widget, d);
                const collapsed = body.querySelectorAll('.dashboard-widget-row').length;

                body.querySelector('.dashboard-widget-row--more').click();
                const expanded = body.querySelectorAll('.dashboard-widget-row').length;
                const stored = JSON.parse(localStorage.getItem('expandedOverflowWidgets') || '[]');

                body.querySelector('.dashboard-widget-row--more').click();
                const recollapsed = body.querySelectorAll('.dashboard-widget-row').length;
                return { collapsed, expanded, recollapsed, stored };
            } finally {
                window.fetch = realFetch;
                body.remove();
                delete d._widgetRss;
                try { localStorage.removeItem('expandedOverflowWidgets'); } catch (e) { /* ignore */ }
            }
        }, threeItems);

        // One headline plus the toggle, then all three plus the toggle.
        expect(result.collapsed).toBe(2);
        expect(result.expanded).toBe(4);
        expect(result.recollapsed).toBe(2);
        // Remembered the way an expanded category is.
        expect(result.stored).toContain('w_rss_toggle');
    });

    test('a headline carries a hover preview of the entry', async ({ page }) => {
        await open(page);
        const shown = await page.evaluate(async (items) => {
            const d = window.dashboardInstance;
            const realFetch = window.fetch;
            window.fetch = async (url, ...rest) => {
                if (String(url).includes('/api/widgets/rss')) {
                    return new Response(JSON.stringify({ fetchedAt: Date.now(), items }),
                        { status: 200, headers: { 'Content-Type': 'application/json' } });
                }
                return realFetch(url, ...rest);
            };
            const body = document.createElement('div');
            document.body.appendChild(body);
            try {
                await window.DashboardWidgets.rss(body, { id: 'w_rss_hover', type: 'rss', config: {} }, d);
                const row = body.querySelector('.dashboard-widget-row');
                row.dispatchEvent(new MouseEvent('mouseenter'));
                const popover = document.querySelector('.smart-collection-why-popover');
                const text = popover?.textContent || '';
                row.dispatchEvent(new MouseEvent('mouseleave'));
                return { text, hiddenAfterLeave: await new Promise((resolve) => setTimeout(
                    () => resolve(!!document.querySelector('.smart-collection-why-popover')?.hidden), 200)) };
            } finally {
                window.fetch = realFetch;
                body.remove();
                delete d._widgetRss;
            }
        }, threeItems);

        expect(shown.text).toContain('Third summary');
        expect(shown.text).toContain('Example');
        // Gone again once the pointer leaves the row.
        expect(shown.hiddenAfterLeave).toBe(true);
    });
});
