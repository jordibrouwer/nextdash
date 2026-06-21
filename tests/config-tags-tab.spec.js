// @ts-check
const { test, expect } = require('@playwright/test');

async function skipConfigTagsTour(page) {
    await page.addInitScript(() => {
        try {
            localStorage.setItem('nextdash:config-tags-tour-v1', '1');
        } catch {
            // ignore
        }
    });
}

async function waitForConfigReady(page) {
    await skipConfigTagsTour(page);
    await page.goto('/config#general');
    await page.waitForFunction(() => typeof window.configManager?.tags !== 'undefined');
    await page.waitForFunction(() => typeof window.configManager?.reloadTagsTabData === 'function');
    await page.waitForSelector('.general-layout', { timeout: 20_000 });
    await page.evaluate(() => {
        const cm = window.configManager;
        if (cm?.settingsData) {
            cm.settingsData.configTagsTourCompleted = true;
        }
        window.ConfigTagsTour?.teardownStaleDom?.();
        cm._configTagsTourActive = false;
        cm._configTagsTourStarting = false;
        cm.ui.switchToTab('general');
    });
}

/** @param {import('@playwright/test').Page} page @param {{ tag: string, count: number }[]} spec */
async function seedTagsOnFirstPage(page, spec) {
    return page.evaluate(async (tagSpec) => {
        const base = Date.now();
        const pageId = window.configManager?.pagesData?.[0]?.id ?? 1;
        const response = await fetch(`/api/bookmarks?page=${pageId}`);
        if (!response.ok) {
            throw new Error(`fetch bookmarks failed: ${response.status}`);
        }
        const bookmarks = await response.json();
        const additions = [];
        tagSpec.forEach(({ tag, count }, tagIndex) => {
            for (let i = 0; i < count; i += 1) {
                additions.push({
                    name: `E2E config tags ${tag} ${i}`,
                    url: `https://example.com/e2e-config-tags-${base}-${tagIndex}-${i}`,
                    shortcut: '',
                    category: 'other',
                    tags: [tag],
                    openCount: 0,
                    createdAt: base + tagIndex * 100 + i,
                });
            }
        });
        const save = await fetch(`/api/bookmarks?page=${pageId}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify([...bookmarks, ...additions]),
        });
        if (!save.ok) {
            throw new Error(`save bookmarks failed: ${save.status}`);
        }
        return tagSpec.map(({ tag }) => tag);
    }, spec);
}

async function openTagsTab(page) {
    await page.evaluate(async () => {
        window.configManager.ui.switchToTab('tags');
        await window.configManager.reloadTagsTabData();
    });
    await page.waitForSelector('[data-tab-content="tags"].active', { timeout: 10_000 });
    await expect(page.locator('.config-tags-tour-card')).toHaveCount(0);
}

test.describe('config tags tab UI', () => {
    test.beforeEach(async ({ page }) => {
        await page.setViewportSize({ width: 1280, height: 800 });
    });

    test('renders word cloud, column headers, and structured list', async ({ page }) => {
        const base = `e2e-cfg-ui-${Date.now()}`;
        const popular = `${base}-popular`;
        const rare = `${base}-rare`;

        await waitForConfigReady(page);
        await seedTagsOnFirstPage(page, [
            { tag: popular, count: 3 },
            { tag: rare, count: 1 },
        ]);
        await openTagsTab(page);

        await expect(page.locator('#tags-cloud')).toBeVisible();
        await expect(page.locator(`#tags-cloud .tag-cloud-word-label:has-text("${popular}")`)).toBeVisible();
        await expect(page.locator(`#tags-cloud .tag-cloud-word-label:has-text("${rare}")`)).toBeVisible();
        await expect(page.locator('.tags-list-header')).toBeVisible();
        await expect(page.locator('.tags-list-header-label')).toBeVisible();
        await expect(page.locator('.tags-list-header-count')).toBeVisible();
        await expect(page.locator('.tags-list-header-actions')).toBeVisible();
        await expect(page.locator(`#tags-list .tag-item[data-tag="${popular}"]`)).toBeVisible();
        await expect(page.locator(`#tags-list .tag-item[data-tag="${rare}"]`)).toBeVisible();
    });

    test('sorts list by bookmark usage and scales popularity tiers', async ({ page }) => {
        const base = `e2e-cfg-sort-${Date.now()}`;
        const popular = `${base}-popular`;
        const rare = `${base}-rare`;

        await waitForConfigReady(page);
        await seedTagsOnFirstPage(page, [
            { tag: popular, count: 4 },
            { tag: rare, count: 1 },
        ]);
        await openTagsTab(page);

        const order = await page.locator('#tags-list .tag-item-label').allTextContents();
        const popularIndex = order.indexOf(popular);
        const rareIndex = order.indexOf(rare);
        expect(popularIndex).toBeGreaterThanOrEqual(0);
        expect(rareIndex).toBeGreaterThanOrEqual(0);
        expect(popularIndex).toBeLessThan(rareIndex);

        const tiers = await page.evaluate(({ popularTag, rareTag }) => {
            const popularEl = document.querySelector(`.tag-item[data-tag="${popularTag}"]`);
            const rareEl = document.querySelector(`.tag-item[data-tag="${rareTag}"]`);
            const readFill = (el) => {
                const bar = el?.querySelector('.tag-popularity-bar');
                return bar ? Number.parseFloat(String(bar.style.getPropertyValue('--tag-fill') || '0')) : 0;
            };
            return {
                popularTier: [...(popularEl?.classList || [])].find((c) => c.startsWith('tag-item--tier-')),
                rareTier: [...(rareEl?.classList || [])].find((c) => c.startsWith('tag-item--tier-')),
                popularFill: readFill(popularEl),
                rareFill: readFill(rareEl),
            };
        }, { popularTag: popular, rareTag: rare });

        expect(tiers.popularFill).toBeGreaterThan(tiers.rareFill);
        expect(tiers.popularTier).not.toBe(tiers.rareTier);
    });

    test('filter input narrows cloud and list', async ({ page }) => {
        const base = `e2e-cfg-filter-${Date.now()}`;
        const alpha = `${base}-alpha`;
        const beta = `${base}-beta`;

        await waitForConfigReady(page);
        await seedTagsOnFirstPage(page, [
            { tag: alpha, count: 1 },
            { tag: beta, count: 1 },
        ]);
        await openTagsTab(page);

        await page.locator('#tags-filter-input').fill(base);

        await expect(page.locator(`#tags-cloud .tag-cloud-word-label:has-text("${alpha}")`)).toBeVisible();
        await expect(page.locator(`#tags-cloud .tag-cloud-word-label:has-text("${beta}")`)).toBeVisible();
        await expect(page.locator(`#tags-list .tag-item[data-tag="${alpha}"]`)).toBeVisible();
        await expect(page.locator(`#tags-list .tag-item[data-tag="${beta}"]`)).toBeVisible();

        await page.locator('#tags-filter-input').fill(`${base}-alpha`);

        await expect(page.locator(`#tags-cloud .tag-cloud-word-label:has-text("${alpha}")`)).toBeVisible();
        await expect(page.locator(`#tags-cloud .tag-cloud-word-label:has-text("${beta}")`)).toHaveCount(0);
        await expect(page.locator('#tags-list .tag-item')).toHaveCount(1);
        await expect(page.locator(`#tags-list .tag-item[data-tag="${alpha}"]`)).toBeVisible();

        await page.locator('#tags-filter-input').fill('no-such-tag-xyz');
        await expect(page.locator('#tags-list .tags-filter-empty-hint')).toBeVisible();
        await expect(page.locator('#tags-cloud')).toBeHidden();
    });

    test('cloud chip click scrolls to list row and opens drill-down', async ({ page }) => {
        const base = `e2e-cfg-cloud-${Date.now()}`;
        const target = `${base}-target`;

        await waitForConfigReady(page);
        await seedTagsOnFirstPage(page, [{ tag: target, count: 2 }]);
        await openTagsTab(page);

        await page.locator(`#tags-cloud .tag-cloud-word-label:has-text("${target}")`).click();

        const row = page.locator(`.tag-item[data-tag="${target}"]`);
        await expect(row.locator('.tag-drilldown.is-open')).toBeVisible();
        await expect(row.locator('.tag-drilldown .tag-drilldown-row')).toHaveCount(2);
    });
});
