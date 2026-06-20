// @ts-check
const { test, expect } = require('@playwright/test');

async function dismissBlockingUi(page) {
    await page.evaluate(() => {
        document.getElementById('app-modal')?.classList.remove('show');
        document.querySelectorAll('.dashboard-feature-promo').forEach((el) => el.remove());
        localStorage.setItem('nextdash:dashboard-tag-filter-bulk-promo-confirmed-v1', '1');
        localStorage.setItem('nextdash:dashboard-tag-cloud-promo-confirmed-v1', '1');
    });
}

async function ensureLintgrasFilter(page) {
    await page.evaluate(async () => {
        const dash = window.dashboardInstance;
        const pageId = dash.currentPageId;
        const base = Date.now();
        const response = await fetch(`/api/bookmarks?page=${pageId}`);
        const bookmarks = await response.json();
        const tag = 'lintgras';
        const hasTagged = bookmarks.some((bookmark) => (
            (bookmark.tags || []).some((entry) => String(entry).toLowerCase() === tag)
        ));
        if (!hasTagged) {
            await fetch(`/api/bookmarks?page=${pageId}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify([
                    ...bookmarks,
                    {
                        name: 'Tag filter fixture',
                        url: `https://example.com/tag-filter-${base}`,
                        shortcut: '',
                        category: 'other',
                        tags: [tag],
                        openCount: 0,
                        createdAt: base,
                    },
                ]),
            });
            await dash.loadPageBookmarks(pageId);
        }
        await dash.setTagFilters([tag], { animate: false });
    });
}

test.describe('tag filter view', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('/', { waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => window.dashboardInstance && !document.body.classList.contains('loading'));
        await dismissBlockingUi(page);
    });

    test('bulk toolbar stays clickable while tag cloud modal is open', async ({ page }) => {
        await ensureLintgrasFilter(page);
        await page.evaluate(() => {
            window.__tagFilterToolbarClicks = 0;
            const tf = window.dashboardInstance.tagFilter;
            const orig = tf.copyTagFilterLinksToClipboard.bind(tf);
            tf.copyTagFilterLinksToClipboard = () => {
                window.__tagFilterToolbarClicks += 1;
                return orig();
            };
            window.DashboardTagCloud.openModal();
        });

        await expect.poll(async () => page.evaluate(() => window.DashboardTagCloud.modalOpen)).toBe(true);

        const copyBtn = page.locator('.tag-filter-copy-btn');
        await expect(copyBtn).toBeVisible();
        await copyBtn.click();

        await expect.poll(async () => page.evaluate(() => window.__tagFilterToolbarClicks)).toBe(1);
        await expect.poll(async () => page.evaluate(() => (
            document.getElementById('dashboard-layout')?.hasAttribute('inert')
        ))).toBe(false);
    });

    test('tag filter keeps only matched bookmark rows in the grid', async ({ page }) => {
        await ensureLintgrasFilter(page);

        await expect.poll(async () => page.evaluate(() => (
            document.querySelectorAll('#dashboard-layout .bookmark-link').length
        ))).toBeGreaterThan(0);

        const counts = await page.evaluate(() => ({
            dom: document.querySelectorAll('#dashboard-layout .bookmark-link').length,
            matched: window.dashboardInstance.getBookmarksForTagFilters().length,
        }));
        expect(counts.dom).toBe(counts.matched);
    });

    test('tag filter bookmark shortcuts do not overlap open count', async ({ page }) => {
        await page.evaluate(() => {
            window.dashboardInstance.settings.layoutPreset = 'launcher';
            window.dashboardInstance.renderDashboard({ animate: false });
        });
        await ensureLintgrasFilter(page);

        const overlap = await page.evaluate(() => {
            const row = document.querySelector('.tag-filter-chunk .bookmark-link:not(:has(.bookmark-shortcut.is-empty))');
            if (!row) return null;
            const shortcut = row.querySelector('.bookmark-shortcut');
            const openCount = row.querySelector('.bookmark-open-count');
            const shortcutRect = shortcut?.getBoundingClientRect();
            const openCountRect = openCount?.getBoundingClientRect();
            const openCountStyle = openCount ? getComputedStyle(openCount).display : null;
            const intersects = shortcutRect && openCountRect
                && openCountStyle !== 'none'
                && !(openCountRect.right < shortcutRect.left
                    || openCountRect.left > shortcutRect.right
                    || openCountRect.bottom < shortcutRect.top
                    || openCountRect.top > shortcutRect.bottom);
            return {
                openCountDisplay: openCountStyle,
                intersects,
                shortcutText: shortcut?.textContent?.trim() || '',
            };
        });

        expect(overlap).not.toBeNull();
        expect(overlap.openCountDisplay).toBe('none');
        expect(overlap.intersects).toBe(false);
    });

    test('tag cloud modal anchors near FAB instead of centering over bookmarks', async ({ page }) => {
        await ensureLintgrasFilter(page);
        await page.evaluate(() => {
            window.DashboardTagCloud.openModal();
        });
        await page.waitForTimeout(500);

        const placement = await page.evaluate(() => {
            const toggle = document.getElementById('tag-cloud-toggle-btn');
            const modal = document.getElementById('tag-cloud-modal');
            const toggleRect = toggle?.getBoundingClientRect();
            const modalRect = modal?.getBoundingClientRect();
            const viewportCenterX = window.innerWidth / 2;
            return {
                toggleLeft: toggleRect?.left ?? 0,
                modalLeft: modalRect?.left ?? 0,
                modalTop: modalRect?.top ?? 0,
                modalCenterX: modalRect ? modalRect.left + (modalRect.width / 2) : 0,
                viewportCenterX,
                tooltip: toggle?.getAttribute('data-tooltip'),
            };
        });

        expect(Math.abs(placement.modalLeft - placement.toggleLeft)).toBeLessThan(120);
        expect(Math.abs(placement.modalCenterX - placement.viewportCenterX)).toBeGreaterThan(80);
        expect(placement.tooltip).toBeNull();
        expect(placement.modalTop).toBeGreaterThan(200);
    });

    test('tag filter bookmarks stack vertically', async ({ page }) => {
        await page.evaluate(() => {
            window.dashboardInstance.settings.layoutPreset = 'launcher';
            window.dashboardInstance.renderDashboard({ animate: false });
        });
        await ensureLintgrasFilter(page);

        const layout = await page.evaluate(() => {
            const list = document.querySelector('.tag-filter-chunk .bookmarks-list');
            const links = [...document.querySelectorAll('.tag-filter-chunk .bookmark-link')];
            const ys = links.map((el) => Math.round(el.getBoundingClientRect().y));
            return {
                listDisplay: list ? getComputedStyle(list).display : null,
                uniqueRows: new Set(ys).size,
                count: links.length,
            };
        });

        expect(layout.listDisplay).toBe('grid');
        expect(layout.count).toBeGreaterThan(0);
        expect(layout.uniqueRows).toBe(layout.count);
    });
});
