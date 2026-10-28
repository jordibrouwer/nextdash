// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * Moving a widget to another page from its settings.
 *
 * A media widget's panel opens on the service's own kind of sign-in whether or
 * not a credential is filed, and that read as "unsaved changes" the moment the
 * panel was drawn. Choosing another page then asked to discard changes that
 * did not exist, and "Move anyway" moved the stored (empty) widget and dropped
 * what had been typed. Pins both halves: nothing to save, nothing asked; and
 * something typed is saved first, then travels.
 */

async function openWidgets(page) {
    await page.setViewportSize({ width: 1500, height: 1000 });
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForSelector('#dashboard-layout', { timeout: 20_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.waitForFunction(() => window.dashboardInstance?._bookmarksReady === true, null, { timeout: 20_000 });
    await page.evaluate(() => window.dashboardInstance.config.openConfigView('widgets'));
    await expect.poll(() => page.evaluate(() => {
        const cfg = window.dashboardInstance.config._module;
        return Boolean(cfg && cfg._widgetBlocks != null && cfg._widgetLoadedFor != null
            && cfg._widgetLoadedFor === cfg._widgetPageId);
    }), { timeout: 15_000 }).toBe(true);
}

/** Two pages, and the blocks of both as they were, to put back afterwards. */
async function twoPagesSnapshot(page) {
    return page.evaluate(async () => {
        const cfg = window.dashboardInstance.config._module;
        if ((window.dashboardInstance.pages || []).length < 2) {
            await cfg.addPage();
            await new Promise((r) => setTimeout(r, 1500));
        }
        const pages = window.dashboardInstance.pages || [];
        if (pages.length < 2) return null;
        const read = async (id) => (await (await fetch(`/api/pages/${id}/blocks`)).json());
        const from = Number(pages[0].id);
        const to = Number(pages[1].id);
        return { from, to, before: { from: await read(from), to: await read(to) } };
    });
}

async function restore(page, snap) {
    await page.evaluate(async ({ from, to, before }) => {
        const cfg = window.dashboardInstance.config._module;
        for (const [id, data] of [[from, before.from], [to, before.to]]) {
            await cfg.writeFetch(`/api/pages/${id}/blocks`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ widgets: data.widgets || [] }),
            });
        }
    }, snap);
}

/** Adding a widget opens its card; Settings on an open card closes it, so only press it when closed. */
async function openCard(page, index) {
    const button = page.locator(`[data-widget-settings="${index}"]`);
    if ((await button.getAttribute('aria-expanded')) !== 'true') await button.click();
    await expect(button).toHaveAttribute('aria-expanded', 'true');
}

/** A widget of a type on the first page, loaded in the tab, its panel drawn. */
async function addAndOpen(page, type, from) {
    return page.evaluate(async ({ widgetType, pageId }) => {
        const cfg = window.dashboardInstance.config._module;
        cfg._widgetPageId = pageId;
        cfg._widgetLoadedFor = null;
        await cfg.loadWidgetsEditor();
        await cfg.addWidget(widgetType);
        const index = cfg._widgetBlocks.findIndex((b) => b.isWidget && b.type === widgetType);
        return { index, id: cfg._widgetBlocks[index]?.id };
    }, { widgetType: type, pageId: from });
}

test.describe('moving a widget from its settings', () => {
    test('no media widget reads as changed just because its panel is open', async ({ page }) => {
        await openWidgets(page);
        const snap = await twoPagesSnapshot(page);
        test.skip(!snap, 'a second page could not be created here');
        try {
            const types = await page.evaluate(() => Object.keys(DashboardConfig.MEDIA_SERVICES || {}));
            expect(types).toContain('jellyfin');
            const dirty = [];
            for (const type of types) {
                const { index } = await addAndOpen(page, type, snap.from);
                if (index < 0) continue;
                await openCard(page, index);
                const state = await page.evaluate(({ i }) => {
                    const cfg = window.dashboardInstance.config._module;
                    return cfg.widgetDraftDirty(i);
                }, { i: index });
                if (state) dirty.push(type);
                await page.evaluate(({ i }) => {
                    const cfg = window.dashboardInstance.config._module;
                    delete (cfg._widgetDrafts || {})[cfg._widgetBlocks[i]?.id];
                    // Close the sheet, so the next widget's button is reachable.
                    cfg._widgetOpenId = null;
                    cfg.repaintWidgetsBody();
                }, { i: index });
            }
            expect(dirty, 'media widgets that read as changed with nothing typed').toEqual([]);
        } finally {
            await restore(page, snap);
        }
    });

    test('a widget with nothing typed moves without asking', async ({ page }) => {
        await openWidgets(page);
        const snap = await twoPagesSnapshot(page);
        test.skip(!snap, 'a second page could not be created here');
        try {
            const { index, id } = await addAndOpen(page, 'custom', snap.from);
            await openCard(page, index);
            await page.locator(`[data-widget-move-page="${index}"]`).selectOption(String(snap.to));

            await expect.poll(() => page.evaluate(async ({ to, wid }) => {
                const cfg = window.dashboardInstance.config._module;
                const target = (await (await cfg.writeFetch(`/api/pages/${to}/blocks`)).json()).widgets || [];
                return target.some((w) => w.id === wid);
            }, { to: snap.to, wid: id }), { timeout: 10_000 }).toBe(true);
            await expect(page.getByRole('button', { name: 'Save and move' })).toHaveCount(0);
        } finally {
            await restore(page, snap);
        }
    });

    test('a widget with something typed is saved first, then moved with its settings', async ({ page }) => {
        await openWidgets(page);
        const snap = await twoPagesSnapshot(page);
        test.skip(!snap, 'a second page could not be created here');
        try {
            const { index, id } = await addAndOpen(page, 'custom', snap.from);
            await openCard(page, index);
            await page.evaluate((i) => {
                const cfg = window.dashboardInstance.config._module;
                cfg.widgetDraft(i).config.url = 'http://192.168.0.10:8096';
            }, index);
            await page.locator(`[data-widget-move-page="${index}"]`).selectOption(String(snap.to));

            await page.getByRole('button', { name: 'Save and move' }).click();

            await expect.poll(() => page.evaluate(async ({ to, from, wid }) => {
                const cfg = window.dashboardInstance.config._module;
                const read = async (p) => ((await (await cfg.writeFetch(`/api/pages/${p}/blocks`)).json()).widgets || []);
                const moved = (await read(to)).find((w) => w.id === wid);
                const left = (await read(from)).some((w) => w.id === wid);
                return { onTarget: Boolean(moved), server: moved?.config?.url || '', left };
            }, { to: snap.to, from: snap.from, wid: id }), { timeout: 10_000 })
                .toEqual({ onTarget: true, server: 'http://192.168.0.10:8096', left: false });
        } finally {
            await restore(page, snap);
        }
    });

    test('refusing the question leaves the widget and its draft where they are', async ({ page }) => {
        await openWidgets(page);
        const snap = await twoPagesSnapshot(page);
        test.skip(!snap, 'a second page could not be created here');
        try {
            const { index, id } = await addAndOpen(page, 'custom', snap.from);
            await openCard(page, index);
            await page.evaluate((i) => {
                const cfg = window.dashboardInstance.config._module;
                cfg.widgetDraft(i).config.url = 'http://192.168.0.10:8096';
            }, index);
            const select = page.locator(`[data-widget-move-page="${index}"]`);
            await select.selectOption(String(snap.to));

            await expect(page.getByRole('button', { name: 'Save and move' })).toBeVisible();
            await page.keyboard.press('Escape');

            await expect(select).toHaveValue(String(snap.from));
            const kept = await page.evaluate((wid) => {
                const cfg = window.dashboardInstance.config._module;
                return cfg._widgetDrafts?.[wid]?.config?.url || '';
            }, id);
            expect(kept).toBe('http://192.168.0.10:8096');
        } finally {
            await restore(page, snap);
        }
    });
});
