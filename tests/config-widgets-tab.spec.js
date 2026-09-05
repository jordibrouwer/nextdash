// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * The widgets tab, rebuilt to work like the bookmarks tab beside it.
 *
 * Two lists in one config view that arrange their controls differently make
 * the second one feel like somewhere else in the app, so this pins the shape:
 * a search, a sort that defaults to grouped, and a bulk bar that only exists
 * while something is ticked.
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
    await page.waitForTimeout(1500);
}

/*
 * Make sure a second page exists, and put a widget on it.
 *
 * The e2e fixture starts with one page, and "every page at once" cannot be
 * tested against one -- the test would skip on exactly the machine it was
 * written to reassure.
 */
async function ensureSecondPage(page) {
    return page.evaluate(async () => {
        const cfg = window.dashboardInstance.config._module;
        if ((window.dashboardInstance.pages || []).length < 2) {
            await cfg.addPage();
            await new Promise((r) => setTimeout(r, 1500));
        }
        const pages = window.dashboardInstance.pages || [];
        if (pages.length < 2) return 0;

        const second = pages[1].id;
        const res = await fetch(`/api/pages/${second}/blocks`);
        const data = res.ok ? await res.json() : { widgets: [] };
        if (!(data.widgets || []).length) {
            await fetch(`/api/pages/${second}/blocks`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    widgets: [{ type: 'health', title: 'On the second page', config: {} }],
                }),
            });
            await new Promise((r) => setTimeout(r, 800));
        }
        return pages.length;
    });
}

/** Add one widget of a type, so the tab has something to show. */
async function ensureWidget(page, type) {
    return page.evaluate(async (widgetType) => {
        const cfg = window.dashboardInstance.config._module;
        const has = (cfg._widgetBlocks || []).some((b) => b.isWidget && b.type === widgetType);
        if (!has) {
            await cfg.addWidget(widgetType);
            await new Promise((r) => setTimeout(r, 1800));
        }
        return (cfg._widgetBlocks || []).filter((b) => b.isWidget).length;
    }, type);
}

test.describe('the widgets tab', () => {
    test('carries the same toolbar shape as bookmarks', async ({ page }) => {
        await openWidgets(page);
        await ensureWidget(page, 'health');

        const shape = await page.evaluate(() => ({
            toolbar: Boolean(document.querySelector('.config-crud-toolbar--view')),
            search: Boolean(document.getElementById('config-widget-search')),
            sort: document.querySelector('[data-widget-sort]')?.value,
            add: Boolean(document.querySelector('[data-widget-catalogue]')),
        }));

        expect(shape.toolbar).toBe(true);
        expect(shape.search).toBe(true);
        expect(shape.add).toBe(true);
        // Grouped is the default: a long list arrives already sorted into the
        // questions each type answers.
        expect(shape.sort).toBe('group');
    });

    /*
     * A widget with no title of its own is drawn under its type, so searching
     * for the type has to find it -- looking for "health" and finding nothing
     * on a page that plainly shows one is the kind of small lie a search
     * should not tell.
     */
    test('search matches the type as well as the title', async ({ page }) => {
        await openWidgets(page);
        const total = await ensureWidget(page, 'health');
        test.skip(total < 1, 'needs at least one widget');

        const shown = await page.evaluate(() => {
            const cfg = window.dashboardInstance.config._module;
            cfg.widgetQuery = 'health';
            const groups = cfg.widgetRowsForDisplay();
            const rows = groups.reduce((all, g) => all.concat(g.rows), []);
            cfg.widgetQuery = '';
            return rows.map(({ block }) => block.type);
        });

        expect(shown.length).toBeGreaterThan(0);
        expect(shown).toContain('health');
    });

    test('nothing matching says so rather than showing an empty page', async ({ page }) => {
        await openWidgets(page);
        await ensureWidget(page, 'health');

        await page.fill('#config-widget-search', 'zzzznomatchzzzz');
        await page.waitForTimeout(600);

        const text = await page.evaluate(() =>
            document.querySelector('.config-widget-none')?.textContent?.trim() || '');
        expect(text.length).toBeGreaterThan(0);

        await page.fill('#config-widget-search', '');
        await page.waitForTimeout(500);
    });

    test('grouped puts headings above the rows, and the other sorts do not', async ({ page }) => {
        await openWidgets(page);
        await ensureWidget(page, 'health');

        const grouped = await page.evaluate(() =>
            document.querySelectorAll('.config-widget-group-title').length);
        expect(grouped).toBeGreaterThan(0);

        await page.selectOption('[data-widget-sort]', 'name');
        await page.waitForTimeout(700);
        const flat = await page.evaluate(() =>
            document.querySelectorAll('.config-widget-group-title').length);
        expect(flat).toBe(0);

        await page.selectOption('[data-widget-sort]', 'group');
        await page.waitForTimeout(700);
    });

    /*
     * The bar is the answer to "what now" and there is no question until
     * something is ticked. A permanent row of buttons that usually refuse
     * teaches people to ignore it.
     */
    test('the bulk bar appears only while something is ticked', async ({ page }) => {
        await openWidgets(page);
        await ensureWidget(page, 'health');

        expect(await page.locator('.config-widget-bulk').count()).toBe(0);

        await page.locator('[data-widget-pick]').first().check();
        await page.waitForTimeout(600);
        await expect(page.locator('.config-widget-bulk')).toBeVisible();
        await expect(page.locator('.config-widget-bulk-count')).toContainText('1');

        await page.locator('[data-widget-bulk="clear"]').click();
        await page.waitForTimeout(600);
        expect(await page.locator('.config-widget-bulk').count()).toBe(0);
    });

    /*
     * Ticks are held by widget id, not by row index: sorting reorders the list
     * and an index would then point at somebody else's widget.
     */
    test('a tick survives re-sorting the list', async ({ page }) => {
        await openWidgets(page);
        await ensureWidget(page, 'health');

        await page.locator('[data-widget-pick]').first().check();
        await page.waitForTimeout(500);
        const picked = await page.evaluate(() =>
            [...window.dashboardInstance.config._module.widgetSelection]);

        await page.selectOption('[data-widget-sort]', 'name');
        await page.waitForTimeout(700);

        const after = await page.evaluate(() =>
            [...window.dashboardInstance.config._module.widgetSelection]);
        expect(after).toEqual(picked);
        // And the box is still drawn ticked, not merely remembered.
        expect(await page.locator('[data-widget-pick]:checked').count()).toBe(1);

        await page.selectOption('[data-widget-sort]', 'group');
        await page.waitForTimeout(500);
        await page.evaluate(() => {
            window.dashboardInstance.config._module.widgetSelection.clear();
            window.dashboardInstance.config._module.repaintWidgetsBody();
        });
    });
});

test.describe('every page at once', () => {
    /*
     * A reader with four pages had to visit four tabs to answer "what have I
     * actually got", and a widget on the page you are not looking at is the
     * one you forget you are paying for.
     */
    test('shows the widgets of every page, each saying where it lives', async ({ page }) => {
        await openWidgets(page);
        await ensureWidget(page, 'health');
        const pages = await ensureSecondPage(page);
        test.skip(pages < 2, 'a second page could not be created here');
        // The tab was loaded before the page existed, so it reloads.
        await page.evaluate(() => {
            const cfg = window.dashboardInstance.config._module;
            cfg._widgetLoadedFor = null;
            return cfg.loadWidgetsEditor();
        });
        await page.waitForTimeout(1200);

        const before = await page.evaluate(() =>
            (window.dashboardInstance.config._module._widgetBlocks || [])
                .filter((b) => b.isWidget).length);

        await page.selectOption('[data-widget-page]', 'all');
        await page.waitForTimeout(2500);

        const view = await page.evaluate(() => {
            const cfg = window.dashboardInstance.config._module;
            const blocks = (cfg._widgetBlocks || []).filter((b) => b.isWidget);
            return {
                all: cfg.isAllPagesView(),
                count: blocks.length,
                // Every row knows its page, because a save writes one page at a
                // time and this list spans them.
                allTagged: blocks.every((b) => Number.isFinite(Number(b.pageId))),
                pages: [...new Set(blocks.map((b) => b.pageId))].length,
                // Adding needs one page to add to, so it is not offered here.
                canAdd: Boolean(document.querySelector('[data-widget-catalogue]')),
            };
        });

        expect(view.all).toBe(true);
        expect(view.count).toBeGreaterThanOrEqual(before);
        expect(view.allTagged).toBe(true);
        expect(view.canAdd).toBe(false);
    });

    /*
     * The edit has to land on the widget's own page, not on whichever page the
     * tab happened to be showing before.
     */
    test('an edit is written back to the page the widget lives on', async ({ page }) => {
        await openWidgets(page);
        await ensureWidget(page, 'health');
        const pages = await ensureSecondPage(page);
        test.skip(pages < 2, 'a second page could not be created here');
        await page.evaluate(() => {
            const cfg = window.dashboardInstance.config._module;
            cfg._widgetLoadedFor = null;
            return cfg.loadWidgetsEditor();
        });
        await page.waitForTimeout(1200);

        await page.selectOption('[data-widget-page]', 'all');
        await page.waitForTimeout(2500);

        const outcome = await page.evaluate(async () => {
            const cfg = window.dashboardInstance.config._module;
            const blocks = (cfg._widgetBlocks || []).filter((b) => b.isWidget);
            const home = blocks.find((b) => b.pageId != null);
            if (!home) return null;

            const index = cfg._widgetBlocks.indexOf(home);
            const was = home.title;
            const mark = `probe-${Date.now()}`;
            await cfg.renameWidget(index, mark);
            await new Promise((r) => setTimeout(r, 1500));

            const res = await fetch(`/api/pages/${home.pageId}/blocks`);
            const data = await res.json();
            const stored = (data.widgets || []).find((w) => w.id === home.id)?.title;

            // Put the name back, so the fixture is left as it was found.
            const again = cfg._widgetBlocks.findIndex((b) => b.id === home.id);
            if (again >= 0) await cfg.renameWidget(again, was || '');
            await new Promise((r) => setTimeout(r, 1200));

            return { pageId: home.pageId, stored, mark };
        });

        test.skip(outcome === null, 'no widget with a page to check');
        expect(outcome.stored).toBe(outcome.mark);
    });
});

test.describe('widget settings', () => {
    /*
     * Offered only when something is off its default -- the rule the reset
     * follows everywhere else in config, so it is not a permanent button that
     * usually does nothing.
     */
    test('the reset appears once a setting is off its default', async ({ page }) => {
        await openWidgets(page);
        await ensureWidget(page, 'cpu');

        const shape = await page.evaluate(() => {
            const cfg = window.dashboardInstance.config._module;
            const index = (cfg._widgetBlocks || []).findIndex((b) => b.isWidget && b.type === 'cpu');
            if (index < 0) return null;

            const before = cfg.renderWidgetResetButton(index);
            // A setting off its default, in the draft the panel edits.
            const draft = cfg.widgetDraft(index, { create: true });
            draft.config = { ...(draft.config || {}), refreshSeconds: 30 };
            const after = cfg.renderWidgetResetButton(index);

            cfg.resetWidgetToDefaults(index);
            const cleared = cfg.widgetDraft(index, { create: false })?.config || {};
            delete (cfg._widgetDrafts || {})[cfg._widgetBlocks[index].id];

            return {
                hiddenAtDefault: before === '',
                shownWhenChanged: after.includes('data-widget-reset'),
                clearedKeys: Object.keys(cleared).filter((k) => k !== 'enabled'),
            };
        });

        test.skip(shape === null, 'no processor widget could be added here');
        expect(shape.hiddenAtDefault).toBe(true);
        expect(shape.shownWhenChanged).toBe(true);
        // Absent is how the server stores a default, so clearing is the whole
        // operation -- and the Shown box is deliberately left alone.
        expect(shape.clearedKeys).toEqual([]);
    });

    /*
     * The ℹ was built for number fields alone, so a tickbox or a choice that
     * needed a paragraph had nowhere to put one.
     */
    test('the info button is offered on every kind of field', async ({ page }) => {
        await openWidgets(page);

        const kinds = await page.evaluate(() => {
            const cfg = window.dashboardInstance.config._module;
            const withInfo = { key: 'x', info: ['widgetRefreshInfoTitle', 'widgetRefreshInfoBody'] };
            const without = { key: 'y' };
            return {
                drawn: cfg.widgetFieldInfoButton(withInfo, 0).includes('data-widget-info'),
                // Only where there is text behind it: a row of buttons opening
                // empty dialogs is a mistake this codebase already made once.
                silent: cfg.widgetFieldInfoButton(without, 0),
                missingText: cfg.widgetFieldInfoButton(
                    { key: 'z', info: ['nothingHere', 'nothingHereEither'] }, 0),
            };
        });

        expect(kinds.drawn).toBe(true);
        expect(kinds.silent).toBe('');
        expect(kinds.missingText).toBe('');
    });
});
