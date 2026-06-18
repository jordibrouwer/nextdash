// @ts-check
const { test, expect } = require('@playwright/test');

async function dismissOnboardingIfPresent(page) {
    const card = page.locator('.onboarding-card');
    if (await card.count()) {
        await page.locator('.onboarding-skip').click();
        await expect(card).toHaveCount(0, { timeout: 5000 });
    }
}

async function dismissBlockingOverlays(page) {
    const whatsNew = page.locator('#app-modal.show');
    if (await whatsNew.count()) {
        await page.keyboard.press('Escape');
        await expect(whatsNew).toHaveCount(0, { timeout: 3000 });
    }
    const searchPromo = page.locator('.dashboard-search-promo');
    if (await searchPromo.count()) {
        await searchPromo.locator('button').first().click();
        await expect(searchPromo).toHaveCount(0, { timeout: 3000 });
    }
}

test.describe('dashboard search filters', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('/');
        await page.waitForSelector('.bookmark-link', { timeout: 15_000 });
        await dismissOnboardingIfPresent(page);
        await dismissBlockingOverlays(page);
    });

    test('category: filter shows category completions', async ({ page }) => {
        const category = await page.evaluate(() => {
            const bm = window.dashboardInstance?.bookmarks?.find((b) => String(b.category || '').trim());
            return bm?.category || null;
        });
        test.skip(!category, 'No categorized bookmarks on first page');

        await page.keyboard.press('>');
        await page.keyboard.type(`category:`, { delay: 15 });
        await expect(page.locator('#shortcut-search.show')).toBeVisible({ timeout: 3000 });

        await expect.poll(async () => page.evaluate(() => {
            const sc = window.dashboardInstance?.searchComponent;
            return sc?.searchMatches?.some((m) => (
                m.type === 'filter-completion' && String(m.completion || '').toLowerCase().includes('category:')
            )) ?? false;
        })).toBe(true);
    });

    test('category filter lists bookmarks while typing', async ({ page }) => {
        const category = await page.evaluate(() => {
            const bm = window.dashboardInstance?.bookmarks?.find((b) => String(b.category || '').trim());
            return String(bm?.category || '').trim().toLowerCase() || null;
        });
        test.skip(!category, 'No categorized bookmarks on first page');

        await page.keyboard.press('>');
        await page.keyboard.type(`category:${category}`, { delay: 15 });

        await expect.poll(async () => page.evaluate(() => (
            window.dashboardInstance?.searchComponent?.searchMatches?.some((m) => m.type === 'bookmark') ?? false
        ))).toBe(true);
    });

    test('status:checked filter lists monitored bookmarks', async ({ page }) => {
        await page.evaluate(async () => {
            const dash = window.dashboardInstance;
            const pageId = dash.currentPageId;
            const response = await fetch(`/api/bookmarks?page=${pageId}`);
            const bookmarks = await response.json();
            if (!bookmarks.length) return;
            bookmarks[0] = { ...bookmarks[0], checkStatus: true };
            await fetch(`/api/bookmarks?page=${pageId}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(bookmarks),
            });
            await dash.loadPageBookmarks(pageId);
        });

        await page.keyboard.press('>');
        await page.keyboard.type('status:checked', { delay: 15 });

        await expect.poll(async () => page.evaluate(() => {
            const sc = window.dashboardInstance?.searchComponent;
            const matches = sc?.searchMatches?.filter((m) => m.type === 'bookmark') || [];
            return matches.length > 0 && matches.every((m) => m.bookmark?.checkStatus === true);
        })).toBe(true);
    });

    test('expanding Filters then choosing status shows one Filters group', async ({ page }) => {
        await page.keyboard.press('>');
        await expect(page.locator('#shortcut-search.show')).toBeVisible({ timeout: 3000 });

        await page.evaluate(() => {
            const sc = window.dashboardInstance?.searchComponent;
            sc?.toggleEmptyStateGroup('filters');
            sc?.updateSearch();
        });

        await page.locator('.search-match.filter-completion-entry').filter({ hasText: /status/i }).first().click();

        await expect.poll(async () => page.evaluate(() => {
            const sc = window.dashboardInstance?.searchComponent;
            const headers = sc?.searchMatches?.filter((m) => (
                m.type === 'command-group-header'
                && m.label?.toLowerCase().includes('filter')
            )) || [];
            return headers.length;
        })).toBe(1);
    });

    test('filter prefix shows a single Filters group', async ({ page }) => {
        await page.keyboard.press('>');
        await page.keyboard.type('status:', { delay: 15 });

        await expect.poll(async () => page.evaluate(() => {
            const sc = window.dashboardInstance?.searchComponent;
            const headers = sc?.searchMatches?.filter((m) => (
                m.type === 'command-group-header'
                && m.label?.toLowerCase().includes('filter')
            )) || [];
            return headers.length;
        })).toBe(1);
    });

    test('status hint completion shows status value autocomplete', async ({ page }) => {
        await page.keyboard.press('>');
        await page.evaluate(() => {
            window.dashboardInstance.searchComponent.currentQuery = 'status: ';
            window.dashboardInstance.searchComponent.updateSearch();
        });

        await expect.poll(async () => page.evaluate(() => {
            const sc = window.dashboardInstance?.searchComponent;
            return sc?.searchMatches?.some((m) => (
                m.type === 'filter-completion'
                && String(m.completion || '').toLowerCase().includes('status:online')
            )) ?? false;
        })).toBe(true);
    });

    test('page: shows page value autocomplete', async ({ page }) => {
        await page.keyboard.press('>');
        await page.evaluate(() => {
            window.dashboardInstance.searchComponent.currentQuery = 'page: ';
            window.dashboardInstance.searchComponent.updateSearch();
        });

        await expect.poll(async () => page.evaluate(() => {
            const sc = window.dashboardInstance?.searchComponent;
            return sc?.searchMatches?.some((m) => (
                m.type === 'filter-completion'
                && String(m.completion || '').toLowerCase().includes('page:current')
            )) ?? false;
        })).toBe(true);
    });

    test('tag filter lists bookmarks when tag exists', async ({ page }) => {
        const tag = await page.evaluate(async () => {
            const dash = window.dashboardInstance;
            const pageId = dash.currentPageId;
            const base = Date.now();
            const response = await fetch(`/api/bookmarks?page=${pageId}`);
            const bookmarks = await response.json();
            const targetTag = `e2e-tag-${base}`;
            const target = {
                name: 'Tag filter e2e',
                url: `https://example.com/tag-filter-${base}`,
                shortcut: '',
                category: 'other',
                tags: [targetTag],
                openCount: 0,
                createdAt: base,
            };
            await fetch(`/api/bookmarks?page=${pageId}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify([...bookmarks, target]),
            });
            await dash.loadPageBookmarks(pageId);
            dash.updateSearchComponent();
            return targetTag;
        });

        await page.keyboard.press('>');
        await page.keyboard.type(`tag:${tag}`, { delay: 15 });

        await expect.poll(async () => page.evaluate((expectedTag) => {
            const sc = window.dashboardInstance?.searchComponent;
            return sc?.searchMatches?.some((m) => (
                m.type === 'bookmark'
                && (m.bookmark?.tags || []).some((t) => String(t).toLowerCase() === expectedTag.toLowerCase())
            )) ?? false;
        }, tag)).toBe(true);
    });

    test('tag: shows tag autocomplete suggestions', async ({ page }) => {
        const tag = await page.evaluate(async () => {
            const dash = window.dashboardInstance;
            const pageId = dash.currentPageId;
            const base = Date.now();
            const response = await fetch(`/api/bookmarks?page=${pageId}`);
            const bookmarks = await response.json();
            const targetTag = `e2e-auto-${base}`;
            await fetch(`/api/bookmarks?page=${pageId}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify([
                    ...bookmarks,
                    {
                        name: 'Tag autocomplete e2e',
                        url: `https://example.com/tag-auto-${base}`,
                        shortcut: '',
                        category: 'other',
                        tags: [targetTag],
                        openCount: 0,
                        createdAt: base,
                    },
                ]),
            });
            await dash.loadPageBookmarks(pageId);
            dash.updateSearchComponent();
            return targetTag;
        });

        await page.keyboard.press('>');
        await page.evaluate((targetTag) => {
            const sc = window.dashboardInstance.searchComponent;
            sc.currentQuery = 'tag: ';
            sc.updateSearch();
        }, tag);

        await expect.poll(async () => page.evaluate((targetTag) => {
            const sc = window.dashboardInstance?.searchComponent;
            return sc?.searchMatches?.some((m) => (
                m.type === 'filter-completion'
                && String(m.completion || '').toLowerCase().includes(`tag:${targetTag.toLowerCase()}`)
            )) ?? false;
        }, tag)).toBe(true);
    });

    test('status:online uses persisted reachability not only live cache', async ({ page }) => {
        const seeded = await page.evaluate(async () => {
            const dash = window.dashboardInstance;
            const pageId = dash.currentPageId;
            const base = Date.now();
            const response = await fetch(`/api/bookmarks?page=${pageId}`);
            const bookmarks = await response.json();
            const target = {
                name: 'Status filter online e2e',
                url: `https://example.com/status-filter-online-${base}`,
                shortcut: '',
                category: 'other',
                checkStatus: true,
                lastChecked: base,
                lastError: '',
                openCount: 0,
                createdAt: base,
            };
            await fetch(`/api/bookmarks?page=${pageId}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify([...bookmarks, target]),
            });
            await dash.loadPageBookmarks(pageId);
            return target.url;
        });

        await page.keyboard.press('>');
        await page.keyboard.type('status:online', { delay: 15 });

        await expect.poll(async () => page.evaluate((url) => {
            const sc = window.dashboardInstance?.searchComponent;
            return sc?.searchMatches?.some((m) => (
                m.type === 'bookmark' && m.bookmark?.url === url
            )) ?? false;
        }, seeded)).toBe(true);
    });

    test('typing category name suggests category filter', async ({ page }) => {
        const category = await page.evaluate(() => {
            const bm = window.dashboardInstance?.bookmarks?.find((b) => String(b.category || '').trim());
            return String(bm?.category || '').trim().toLowerCase() || null;
        });
        test.skip(!category || category.length < 3, 'Need a category name with 3+ chars');

        const prefix = category.slice(0, 3);
        await page.keyboard.press('>');
        await page.keyboard.type(prefix, { delay: 15 });

        await expect.poll(async () => page.evaluate((catPrefix) => {
            const sc = window.dashboardInstance?.searchComponent;
            return sc?.searchMatches?.some((m) => (
                m.type === 'filter-completion'
                && String(m.completion || '').toLowerCase().startsWith(`category:${catPrefix}`)
            )) ?? false;
        }, prefix)).toBe(true);
    });
});
