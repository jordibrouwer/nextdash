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

async function markWhatsNewSeen(page) {
    await page.addInitScript(() => {
        try {
            const release = '2026.06-dashboard-release-v72';
            localStorage.setItem('nextdash:last-whats-new-dashboard-release', release);
            localStorage.setItem('nextdash:whats-new-search-promo-release', release);
            localStorage.setItem('nextdash:whats-new-search-promo-start', '0');
        } catch {
            // ignore
        }
    });
}

test.describe('dashboard search filters', () => {
    test.describe.configure({ mode: 'serial' });

    test.beforeEach(async ({ page }) => {
        await markWhatsNewSeen(page);
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
        const seededUrl = await page.evaluate(async () => {
            const dash = window.dashboardInstance;
            const pageId = dash.currentPageId;
            const base = Date.now();
            const url = `https://example.com/status-checked-e2e-${base}`;
            const target = {
                name: 'Status checked e2e',
                url,
                shortcut: '',
                category: 'other',
                checkStatus: true,
                openCount: 0,
                createdAt: base,
            };

            for (let attempt = 0; attempt < 5; attempt += 1) {
                const response = await fetch(`/api/bookmarks?page=${pageId}`);
                const bookmarks = await response.json();
                const hasTarget = bookmarks.some((bm) => bm.url === url);
                const payload = hasTarget ? bookmarks : [...bookmarks, target];
                if (!hasTarget) {
                    const save = await fetch(`/api/bookmarks?page=${pageId}`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(payload),
                    });
                    if (!save.ok) {
                        await new Promise((resolve) => setTimeout(resolve, 100 * (attempt + 1)));
                        continue;
                    }
                }
                await dash.loadPageBookmarks(pageId);
                dash.updateSearchComponent?.();
                const found = (dash.bookmarks || []).find((bm) => bm.url === url);
                if (found?.checkStatus === true) {
                    return url;
                }
                await new Promise((resolve) => setTimeout(resolve, 100 * (attempt + 1)));
            }
            throw new Error('failed to seed status:checked bookmark');
        });

        await dismissBlockingOverlays(page);
        await page.keyboard.press('>');
        await page.evaluate(() => {
            const sc = window.dashboardInstance.searchComponent;
            sc.currentQuery = 'status:checked';
            sc.updateSearch();
        });

        await expect.poll(async () => page.evaluate((url) => {
            const sc = window.dashboardInstance?.searchComponent;
            const matches = sc?.searchMatches?.filter((m) => m.type === 'bookmark') || [];
            return matches.some((m) => m.bookmark?.url === url && m.bookmark?.checkStatus === true);
        }, seededUrl)).toBe(true);
    });

    test('expanding Filters then choosing status shows one Filters group', async ({ page }) => {
        await page.keyboard.press('>');
        await expect(page.locator('#shortcut-search.show')).toBeVisible({ timeout: 3000 });

        await page.evaluate(() => {
            const sc = window.dashboardInstance?.searchComponent;
            sc?.toggleEmptyStateGroup('filters');
            sc?.updateSearch();
        });

        await dismissBlockingOverlays(page);
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
            const targetTag = `e2e-auto-${base}`;
            const target = {
                name: 'Tag autocomplete e2e',
                url: `https://example.com/tag-auto-${base}`,
                shortcut: '',
                category: 'other',
                tags: [targetTag],
                openCount: 0,
                createdAt: base,
            };

            for (let attempt = 0; attempt < 5; attempt += 1) {
                const response = await fetch(`/api/bookmarks?page=${pageId}`);
                const bookmarks = await response.json();
                const hasTarget = bookmarks.some((bm) => bm.url === target.url);
                const payload = hasTarget ? bookmarks : [...bookmarks, target];
                if (!hasTarget) {
                    const save = await fetch(`/api/bookmarks?page=${pageId}`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(payload),
                    });
                    if (!save.ok) {
                        await new Promise((resolve) => setTimeout(resolve, 100 * (attempt + 1)));
                        continue;
                    }
                }
                await dash.loadPageBookmarks(pageId);
                dash.updateSearchComponent?.();
                const pool = dash.searchComponent?._collectFilterBookmarkPool?.() || [];
                const hasTag = pool.some((bm) => (
                    (bm.tags || []).some((entry) => String(entry).toLowerCase() === targetTag.toLowerCase())
                ));
                if (hasTag) {
                    return targetTag;
                }
                await new Promise((resolve) => setTimeout(resolve, 100 * (attempt + 1)));
            }
            throw new Error('failed to seed tag autocomplete bookmark');
        });

        await dismissBlockingOverlays(page);
        await page.keyboard.press('>');

        const hasMatch = await page.evaluate((targetTag) => {
            const sc = window.dashboardInstance.searchComponent;
            const prefix = targetTag.slice(0, Math.max(8, targetTag.length - 2));
            const matches = sc.getFilterAutocompleteMatches(`tag:${prefix}`);
            return matches.some((m) => (
                String(m.completion || '').toLowerCase().includes(`tag:${targetTag.toLowerCase()}`)
            ));
        }, tag);
        expect(hasMatch).toBe(true);
    });

    test('tag: shows at most 20 tags until a name prefix is typed', async ({ page }) => {
        const rareTag = await page.evaluate(async () => {
            const dash = window.dashboardInstance;
            const pageId = dash.currentPageId;
            const base = Date.now();
            const response = await fetch(`/api/bookmarks?page=${pageId}`);
            const bookmarks = await response.json();
            const additions = Array.from({ length: 25 }, (_, index) => ({
                name: `Top20 e2e ${index}`,
                url: `https://example.com/e2e-top20-${base}-${index}`,
                shortcut: '',
                category: 'other',
                tags: [`e2e-top20-${base}-${String(index).padStart(2, '0')}`],
                openCount: 0,
                createdAt: base + index,
            }));
            await fetch(`/api/bookmarks?page=${pageId}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify([...bookmarks, ...additions]),
            });
            await dash.loadPageBookmarks(pageId);
            dash.updateSearchComponent?.();
            return `e2e-top20-${base}-24`;
        });

        const summary = await page.evaluate((expectedRareTag) => {
            const sc = window.dashboardInstance.searchComponent;
            const emptyMatches = sc.getFilterAutocompleteMatches('tag:');
            const typedMatches = sc.getFilterAutocompleteMatches(`tag:${expectedRareTag}`);
            return {
                emptyCount: emptyMatches.length,
                emptyHasRare: emptyMatches.some((m) => String(m.completion || '').includes(expectedRareTag)),
                typedHasRare: typedMatches.some((m) => String(m.completion || '').includes(expectedRareTag)),
            };
        }, rareTag);

        expect(summary.emptyCount).toBeLessThanOrEqual(20);
        expect(summary.emptyHasRare).toBe(false);
        expect(summary.typedHasRare).toBe(true);
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

    test('typing tag name without colon suggests tag filter by usage', async ({ page }) => {
        const tag = await page.evaluate(async () => {
            const dash = window.dashboardInstance;
            const pageId = dash.currentPageId;
            const base = Date.now();
            const targetTag = `e2e-bare-${base}`;
            const target = {
                name: 'Bare tag hint e2e',
                url: `https://example.com/bare-tag-${base}`,
                shortcut: '',
                category: 'other',
                tags: [targetTag],
                openCount: 0,
                createdAt: base,
            };

            for (let attempt = 0; attempt < 5; attempt += 1) {
                const response = await fetch(`/api/bookmarks?page=${pageId}`);
                const bookmarks = await response.json();
                const hasTarget = bookmarks.some((bm) => bm.url === target.url);
                const payload = hasTarget ? bookmarks : [...bookmarks, target];
                if (!hasTarget) {
                    const save = await fetch(`/api/bookmarks?page=${pageId}`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(payload),
                    });
                    if (!save.ok) {
                        await new Promise((resolve) => setTimeout(resolve, 100 * (attempt + 1)));
                        continue;
                    }
                }
                await dash.loadPageBookmarks(pageId);
                dash.updateSearchComponent?.();
                const pool = dash.searchComponent?._collectFilterBookmarkPool?.() || [];
                const hasTag = pool.some((bm) => (
                    (bm.tags || []).some((entry) => String(entry).toLowerCase() === targetTag.toLowerCase())
                ));
                if (hasTag) {
                    return targetTag;
                }
                await new Promise((resolve) => setTimeout(resolve, 100 * (attempt + 1)));
            }
            throw new Error('failed to seed bare tag hint bookmark');
        });

        const prefix = tag.slice(0, Math.max(8, tag.length - 2));
        const hasMatch = await page.evaluate(({ targetTag, targetPrefix }) => {
            const sc = window.dashboardInstance.searchComponent;
            const matches = sc.getFilterAutocompleteMatches(targetPrefix);
            return matches.some((m) => (
                String(m.completion || '').toLowerCase().includes(`tag:${targetTag.toLowerCase()}`)
            ));
        }, { targetTag: tag, targetPrefix: prefix });
        expect(hasMatch).toBe(true);
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
