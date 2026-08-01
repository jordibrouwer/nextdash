// @ts-check
const { test, expect } = require('@playwright/test');
const { dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

async function loadDashboard(page) {
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
}

async function openSection(page, section) {
    await page.evaluate((s) => window.dashboardInstance.config.openConfigView(s), section);
}

test.describe('config: sections restored from the old config', () => {
    test('the rail lists every section including bookmarks, stats and help', async ({ page }) => {
        await loadDashboard(page);
        await openSection(page, 'overview');
        for (const s of ['overview', 'bookmarks', 'pages-tags', 'appearance', 'behavior', 'data-backups', 'stats', 'help']) {
            await expect(page.locator(`[data-config-section="${s}"]`)).toBeVisible();
        }
    });

    test('the bookmarks section lists bookmarks and filters by search', async ({ page }) => {
        await loadDashboard(page);
        await openSection(page, 'bookmarks');
        await expect(page.locator('#config-bm-list')).toBeVisible();
        const rows = page.locator('#config-bm-list .config-bm-row');
        const before = await rows.count();
        expect(before).toBeGreaterThan(0);
        await page.fill('#config-bm-search', 'zzz-no-such-bookmark');
        await expect(page.locator('.config-panel-empty')).toBeVisible();
    });

    test('editing a bookmark opens the add-bookmark modal prefilled', async ({ page }) => {
        await loadDashboard(page);
        await openSection(page, 'bookmarks');
        await page.locator('[data-feed-action="edit"]').first().click();
        await expect(page.locator('#new-bookmark-modal.show')).toBeVisible();
        await expect(page.locator('#new-bookmark-name')).not.toHaveValue('');
        await expect(page.locator('#new-bookmark-url')).not.toHaveValue('');
    });

    test('bookmark rows keep a readable width', async ({ page }) => {
        await loadDashboard(page);
        await openSection(page, 'bookmarks');
        const title = page.locator('.health-view-item-title').first();
        expect(await title.evaluate((el) => el.getBoundingClientRect().width)).toBeGreaterThan(120);

        const overflow = await page.evaluate(() =>
            document.documentElement.scrollWidth - document.documentElement.clientWidth);
        expect(overflow).toBeLessThanOrEqual(0);
    });

    test('the stats section shows counts derived from the dashboard', async ({ page }) => {
        await loadDashboard(page);
        await openSection(page, 'stats');
        await expect(page.locator('.config-tiles')).toBeVisible();
        const expected = await page.evaluate(() => window.dashboardInstance.allBookmarks.length);
        await expect(page.locator('.config-tile').first()).toContainText(String(expected));
    });

    /**
     * The Ko-fi call to action carried over from the old config's help tab. Its
     * button styling comes from modal.css (shared with the what's-new modal),
     * which the dashboard loads for other reasons — so assert the animation
     * actually resolves rather than only that the markup is present.
     */
    test('the about tab carries the Ko-fi support button', async ({ page }) => {
        await loadDashboard(page);
        await openSection(page, 'help');
        await page.locator('[data-help-tab="about"]').click();

        const btn = page.locator('.wn-kofi-btn');
        await expect(btn).toBeVisible();
        await expect(btn).toHaveAttribute('href', 'https://ko-fi.com/jordibrw');
        // Opens in a new tab without handing the opener over.
        await expect(btn).toHaveAttribute('rel', /noopener/);
        await expect(page.locator('.wn-kofi-label')).toHaveText(/Ko-fi/);

        const styled = await page.evaluate(() => {
            const a = document.querySelector('.wn-kofi-btn');
            const star = document.querySelector('.wn-kofi-star');
            return {
                anim: getComputedStyle(a).animationName,
                starAnim: star ? getComputedStyle(star).animationName : 'none',
                stars: document.querySelectorAll('.wn-kofi-star').length,
            };
        });
        expect(styled.anim, 'the shared wn-kofi CSS did not apply').not.toBe('none');
        expect(styled.starAnim).not.toBe('none');
        expect(styled.stars).toBe(4);

        // It belongs to About, not to every help tab.
        await page.locator('[data-help-tab="start"]').click();
        await expect(page.locator('.wn-kofi-btn')).toHaveCount(0);
    });

    test('the help section offers whats-new and the cheat sheet', async ({ page }) => {
        await loadDashboard(page);
        await openSection(page, 'help');
        // Both actions now live on their topic's tab rather than one long page.
        await expect(page.locator('.config-help-tips li').first()).toBeVisible();
        await page.locator('[data-help-tab="search"]').click();
        await expect(page.locator('[data-help-action="cheatsheet"]')).toBeVisible();
        await page.locator('[data-help-tab="about"]').click();
        await expect(page.locator('[data-help-action="whats-new"]')).toBeVisible();
    });

    /**
     * Help is a set of horizontal tabs, each carrying real prose migrated from
     * the old config's help pages. Assert every tab renders content and that no
     * body falls through to a raw i18n key — the bodies are looked up by key, so
     * a missing translation would silently print "config.helpFooBody".
     */
    test('every help tab renders migrated prose', async ({ page }) => {
        await loadDashboard(page);
        await openSection(page, 'help');

        const tabs = await page.locator('[data-help-tab]')
            .evaluateAll((els) => els.map((e) => e.getAttribute('data-help-tab')));
        expect(tabs).toEqual(['start', 'config', 'organizing', 'search', 'health', 'data', 'about']);

        for (const tab of tabs) {
            await page.locator(`[data-help-tab="${tab}"]`).click();
            const info = await page.evaluate(() => {
                const body = document.getElementById('config-help-body');
                return { panels: body.querySelectorAll('.config-panel').length, text: body.innerText };
            });
            expect(info.panels, `${tab} rendered no panels`).toBeGreaterThan(0);
            expect(info.text.length, `${tab} is nearly empty`).toBeGreaterThan(250);
            expect(/config\.help|helpPage/.test(info.text), `${tab} shows a raw i18n key`).toBe(false);
        }
    });

    /**
     * The old help described the previous config: System/Dashboard/Extras tab
     * groups, Essentials/Advanced layers, and an explicit Save button. None of
     * that exists now, so the prose was rewritten rather than copied.
     */
    test('help does not describe the retired config UI', async ({ page }) => {
        await loadDashboard(page);
        await openSection(page, 'help');
        await page.locator('[data-help-tab="config"]').click();
        const text = await page.locator('#config-help-body').innerText();

        expect(text).not.toMatch(/Essentials|All sections|quick links sidebar/i);
        // It should say the opposite: saving is automatic.
        expect(text).toMatch(/no Save button|saves the moment/i);
    });

    test('behavior gained a status & health sub-tab with the webhook', async ({ page }) => {
        await loadDashboard(page);
        await openSection(page, 'behavior');
        await page.locator('[data-behavior-tab="status"]').click();
        await expect(page.locator('[data-behavior-field="statusRecheckIntervalMinutes"]')).toBeVisible();
        await expect(page.locator('[data-behavior-field="monitorNotifyUrl"]')).toBeVisible();
    });

    test('toolbar button toggles restored to the display tab', async ({ page }) => {
        await loadDashboard(page);
        await openSection(page, 'appearance');
        await page.locator('[data-appearance-tab="display"]').click();
        for (const f of ['showRecentButton', 'showCheatSheetButton', 'showConfigButton', 'showHealthDashboard']) {
            await expect(page.locator(`[data-behavior-field="${f}"]`)).toBeVisible();
        }
    });

    /**
     * Toolbar & tabs settings live on <body> as data-* attributes that setupDOM
     * writes at startup, not values read at render time — and while config is
     * open renderDashboard re-renders this view and returns without touching the
     * header. They must therefore be applied explicitly, or a toggle does nothing
     * visible until a reload.
     */
    /**
     * Layout preset and items-per-category were in the old config and the
     * dashboard still honours both, so leaving them out made working features
     * unreachable rather than merely unconfigurable.
     */
    /**
     * Every settings panel explains what it covers, so the page reads without
     * having to click each ℹ. Privacy is the exception: it carries a longer
     * inline hint on the control itself rather than a panel note.
     */
    test('every behavior panel carries explanatory text', async ({ page }) => {
        await loadDashboard(page);
        await openSection(page, 'behavior');

        for (const tab of ['general', 'datetime', 'search', 'status']) {
            await page.locator(`[data-behavior-tab="${tab}"]`).click();
            const panels = await page.locator('.config-panel').count();
            const notes = await page.locator('.config-panel-note').count();
            expect(notes, `${tab} has ${panels} panels but ${notes} notes`).toBeGreaterThanOrEqual(panels);
        }

        // Privacy explains itself through the control's own hint.
        await page.locator('[data-behavior-tab="privacy"]').click();
        await expect(page.locator('.config-field-hint').first()).toBeVisible();

        await openSection(page, 'appearance');
        for (const tab of ['layout', 'display']) {
            await page.locator(`[data-appearance-tab="${tab}"]`).click();
            const panels = await page.locator('.config-panel').count();
            const notes = await page.locator('.config-panel-note').count();
            expect(notes, `appearance/${tab} has ${panels} panels but ${notes} notes`).toBeGreaterThanOrEqual(panels);
        }
    });

    test('the smart-collection panels explain what they do', async ({ page }) => {
        await loadDashboard(page);
        await openSection(page, 'pages-tags');
        await page.locator('[data-pt-tab="collections"]').click();
        // Smart collections, tag collections, and the "Today" keyword boxes —
        // the last of which is three bare text fields without a note.
        await expect.poll(() => page.locator('.config-panel-note').count()).toBeGreaterThanOrEqual(3);
    });

    test('choosing the beta layout warns before you commit to it', async ({ page }) => {
        await loadDashboard(page);
        await openSection(page, 'appearance');
        await page.locator('[data-appearance-tab="layout"]').click();

        await page.locator('[data-appearance-layout="modern"]').click();
        await expect(page.locator('.config-field-warning')).toBeVisible();
        await expect(page.locator('.config-field-warning')).toContainText(/beta/i);

        await page.locator('[data-appearance-layout="classic"]').click();
        await expect(page.locator('.config-field-warning')).toHaveCount(0);
    });

    test('the layout tab offers the preset and per-category limit', async ({ page }) => {
        await loadDashboard(page);
        await openSection(page, 'appearance');
        await page.locator('[data-appearance-tab="layout"]').click();

        const preset = page.locator('[data-behavior-field="layoutPreset"]');
        const limit = page.locator('[data-behavior-field="categoryItemLimit"]');
        await expect(preset).toBeVisible();
        await expect(limit).toBeVisible();
        // All eight presets, named rather than shown as raw ids.
        expect(await preset.locator('option').count()).toBe(8);
        expect(await preset.locator('option').allTextContents()).toContain('Masonry');

        await preset.selectOption('masonry');
        await expect
            .poll(() => page.evaluate(() => document.body.getAttribute('data-layout-preset')))
            .toBe('masonry');

        // The grid class is not reapplied while config is up: renderDashboard
        // bails out unless the bookmarks view is active, so that re-rendering
        // does not strip the config view's own layout class and scatter its
        // children across grid columns. The preset therefore lands on the grid
        // when the user returns to the bookmarks view, which is what to assert.
        await page.evaluate(() => window.dashboardInstance.config.closeConfigView());
        await expect.poll(() => page.evaluate(() =>
            document.querySelector('.dashboard-grid')?.className || '')).toContain('layout-masonry');
    });

    /**
     * A <select> yields a string, but these fields are ints server-side — a
     * string fails to unmarshal and the API rejects the *entire* save with 400,
     * so an unrelated setting changed in the same breath is lost too.
     */
    test('numeric selects save as numbers, not strings', async ({ page }) => {
        const failures = [];
        page.on('response', (r) => {
            if (r.url().includes('/api/settings') && r.request().method() === 'POST' && r.status() >= 400) {
                failures.push(r.status());
            }
        });
        await loadDashboard(page);
        await openSection(page, 'behavior');
        await page.locator('[data-behavior-tab="layout"]').click();

        await page.locator('[data-behavior-field="categoryItemLimit"]').selectOption('25');
        await expect
            .poll(() => page.evaluate(() => window.dashboardInstance.settings.categoryItemLimit))
            .toBe(25);
        expect(failures).toEqual([]);

        // And it survives a round trip to the server.
        await page.reload();
        await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
        expect(await page.evaluate(() => window.dashboardInstance.settings.categoryItemLimit)).toBe(25);
    });

    test('toolbar toggles apply immediately, without a reload', async ({ page }) => {
        await loadDashboard(page);
        await openSection(page, 'behavior');
        await page.locator('[data-behavior-tab="display"]').click();

        const pairs = [
            ['showAddBookmarkButton', 'data-show-add-bookmark-button'],
            ['showSearchButton', 'data-show-search-button'],
            ['showFindersButton', 'data-show-finders-button'],
            ['showCommandsButton', 'data-show-commands-button'],
            ['showRecentButton', 'data-show-recent-button'],
            ['showCheatSheetButton', 'data-show-cheatsheet-button'],
            ['showConfigButton', 'data-show-config-button'],
            ['showHealthDashboard', 'data-show-health-dashboard'],
            ['showTitle', 'data-show-title'],
        ];
        for (const [field, attr] of pairs) {
            await page.locator(`[data-behavior-field="${field}"]`).click();
            await expect.poll(() => page.evaluate(({ field, attr }) => {
                const setting = window.dashboardInstance.settings[field];
                return String(document.body.getAttribute(attr)) === String(setting);
            }, { field, attr }), { message: `${field} did not reach ${attr}` }).toBe(true);
        }
    });

    test('hiding page tabs takes effect at once and can be undone', async ({ page }) => {
        await loadDashboard(page);
        await openSection(page, 'behavior');
        await page.locator('[data-behavior-tab="display"]').click();

        const display = () => page.evaluate(() =>
            getComputedStyle(document.getElementById('page-navigation')).display);
        const toggle = page.locator('[data-behavior-field="showPageTabs"]');

        expect(await display()).toBe('flex');
        await toggle.click();
        await expect.poll(display).toBe('none');
        await toggle.click();
        await expect.poll(display).toBe('flex');
    });

    /**
     * The server accepts exactly bottom / bottom-left / bottom-right / side-left
     * and silently rewrites anything else to 'bottom'. The view once offered
     * invented names (center/left/right), so the control looked fine, reported
     * "Saved", and changed nothing. Assert the values themselves, and that each
     * survives the round trip rather than only reaching the DOM.
     */
    test('every button bar position applies live and is accepted by the server', async ({ page }) => {
        const rejected = [];
        page.on('response', (r) => {
            if (r.url().includes('/api/settings') && r.request().method() === 'POST' && r.status() >= 400) {
                rejected.push(r.status());
            }
        });
        await loadDashboard(page);
        await openSection(page, 'behavior');
        await page.locator('[data-behavior-tab="display"]').click();

        const sel = page.locator('[data-behavior-field="buttonBarPosition"]');
        expect(await sel.locator('option').evaluateAll((els) => els.map((e) => e.value)))
            .toEqual(['bottom', 'bottom-left', 'bottom-right', 'side-left']);

        for (const value of ['bottom-left', 'bottom-right', 'side-left', 'bottom']) {
            await sel.selectOption(value);
            await expect.poll(() => page.evaluate(() =>
                document.body.getAttribute('data-button-position'))).toBe(value);
        }
        expect(rejected).toEqual([]);

        // The side rail is the one that restyles the whole page, so confirm it
        // is still set after a reload rather than reset to the default.
        await sel.selectOption('side-left');
        await expect.poll(() => page.evaluate(() =>
            window.dashboardInstance.settings.buttonBarPosition)).toBe('side-left');
        await page.reload();
        await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
        expect(await page.evaluate(() => document.body.getAttribute('data-button-position'))).toBe('side-left');
    });

    test('page names in tabs relabels the tabs at once', async ({ page }) => {
        await loadDashboard(page);
        await openSection(page, 'behavior');
        await page.locator('[data-behavior-tab="display"]').click();

        const label = () => page.evaluate(() =>
            document.querySelector('.page-nav-btn .page-tab-label')?.textContent);
        const before = await label();
        await page.locator('[data-behavior-field="showPageNamesInTabs"]').click();
        await expect.poll(label).not.toBe(before);
    });

    test('data & backups gained favicon policy and preview maintenance', async ({ page }) => {
        await loadDashboard(page);
        await openSection(page, 'data-backups');
        await expect(page.locator('[data-backup-select="faviconRefreshPolicy"]')).toBeVisible();
        await expect(page.locator('[data-backup-action="refresh-favicons"]')).toBeVisible();
        await expect(page.locator('[data-backup-action="clear-previews"]')).toBeVisible();
        // Delete-all moved to the Reset sub-tab — see config-data-reset.spec.js.
        await page.locator('[data-db-tab="reset"]').click();
        await expect(page.locator('[data-backup-action="delete-bookmarks"]')).toBeVisible();
    });

    test('collections expose the per-page scope pickers', async ({ page }) => {
        await loadDashboard(page);
        await openSection(page, 'pages-tags');
        await page.locator('[data-pt-tab="collections"]').click();
        await expect(page.locator('[data-scope-field="smartTodayPageIds"]').first()).toBeVisible();
    });
});

/**
 * The status settings are per-install, but what they do depends on each
 * bookmark's availability mode — the webhook is inert unless a bookmark is set
 * to Monitor. The tab has to say so, or the settings read as unconditional.
 */
test.describe('config: status & health explains the modes', () => {
    async function openStatus(page) {
        await loadDashboard(page);
        await openSection(page, 'behavior');
        await page.locator('[data-behavior-tab="status"]').click();
    }

    test('the tab opens with all three modes and what each does', async ({ page }) => {
        await openStatus(page);
        const legend = page.locator('.config-mode-legend');
        await expect(legend).toBeVisible();
        await expect(legend.locator('.config-mode-row')).toHaveCount(3);
        for (const m of ['off', 'periodic', 'monitor']) {
            await expect(legend.locator(`.config-mode-name--${m}`)).toBeVisible();
        }
        // Each mode is described, not just named.
        for (const i of [0, 1, 2]) {
            const hint = await legend.locator('.config-mode-hint').nth(i).textContent();
            expect((hint || '').trim().length).toBeGreaterThan(15);
        }
    });

    test('every settings panel says which modes it applies to', async ({ page }) => {
        await openStatus(page);
        const badges = page.locator('.config-applies-to');
        await expect(badges).toHaveCount(3);
        // The webhook panel is the one that is Monitor-only.
        const texts = await badges.allTextContents();
        expect(texts.some((t) => /monitor only/i.test(t))).toBe(true);
        expect(texts.filter((t) => /periodic/i.test(t)).length).toBe(2);
    });

    test('the alerts panel spells out that Periodic never notifies', async ({ page }) => {
        await openStatus(page);
        const panel = page.locator('.config-panel', { has: page.locator('[data-behavior-field="monitorNotifyUrl"]') });
        await expect(panel.locator('.config-panel-note')).toContainText(/Periodic/);
    });

    test('the legend is only on the status tab', async ({ page }) => {
        await loadDashboard(page);
        await openSection(page, 'behavior');
        await expect(page.locator('.config-mode-legend')).toHaveCount(0);
        await page.locator('[data-behavior-tab="status"]').click();
        await expect(page.locator('.config-mode-legend')).toHaveCount(1);
        await page.locator('[data-behavior-tab="layout"]').click();
        await expect(page.locator('.config-mode-legend')).toHaveCount(0);
    });
});

/**
 * The config view's CSS used fixed rem sizes, so the font-size setting swapped
 * the body class and changed nothing on screen. Measure real computed sizes:
 * the setting "applying" was never the part that was broken.
 */
test.describe('config: font size applies live', () => {
    const sizeOf = (page, sel) =>
        page.locator(sel).first().evaluate((el) => parseFloat(getComputedStyle(el).fontSize));

    test('choosing a larger font grows the config view without a reload', async ({ page }) => {
        await loadDashboard(page);
        await openSection(page, 'appearance');

        // Wait for the baseline to land before measuring — see the sibling test
        // below for why an unsynchronised read here races the class swap.
        await page.evaluate(() => window.dashboardInstance.config.setFontSize('m'));
        await expect.poll(() => page.evaluate(() =>
            document.body.classList.contains('font-size-m'))).toBe(true);
        const base = {
            title: await sizeOf(page, '.config-view-section-title'),
            nav: await sizeOf(page, '.config-nav-item'),
            panel: await sizeOf(page, '.config-panel-title'),
        };

        await page.locator('[data-appearance-font="xl"]').click();
        await expect.poll(() => page.evaluate(() =>
            document.body.classList.contains('font-size-xl'))).toBe(true);

        expect(await sizeOf(page, '.config-view-section-title')).toBeGreaterThan(base.title);
        expect(await sizeOf(page, '.config-nav-item')).toBeGreaterThan(base.nav);
        expect(await sizeOf(page, '.config-panel-title')).toBeGreaterThan(base.panel);
    });

    test('choosing a smaller font shrinks it again', async ({ page }) => {
        await loadDashboard(page);
        await openSection(page, 'appearance');
        // setFontSize swaps a body class and the size follows on the next style
        // recalc, so read the baseline only once that class has landed. Without
        // this the baseline could be measured at whatever size the view opened
        // at, which under parallel load was occasionally already smaller than
        // xs — making the shrink assertion fail on timing rather than behaviour.
        await page.evaluate(() => window.dashboardInstance.config.setFontSize('m'));
        await expect.poll(() => page.evaluate(() =>
            document.body.classList.contains('font-size-m'))).toBe(true);
        const base = await sizeOf(page, '.config-view-section-title');

        await page.locator('[data-appearance-font="xs"]').click();
        await expect.poll(() => page.evaluate(() =>
            document.body.classList.contains('font-size-xs'))).toBe(true);
        expect(await sizeOf(page, '.config-view-section-title')).toBeLessThan(base);
    });

    test('the size survives reopening the view', async ({ page }) => {
        await loadDashboard(page);
        await openSection(page, 'appearance');
        await page.locator('[data-appearance-font="l"]').click();
        const applied = await sizeOf(page, '.config-view-section-title');

        await openSection(page, 'overview');
        await openSection(page, 'appearance');
        expect(await sizeOf(page, '.config-view-section-title')).toBeCloseTo(applied, 0);
    });
});

/**
 * The help was carried over from the old config's help pages, which were far
 * more detailed than the first pass of the new one. These pin the parts that
 * were actually missing rather than the wording, which translators will edit.
 */
test.describe('config help coverage', () => {
    const TABS = ['start', 'config', 'organizing', 'search', 'health', 'data', 'about'];

    test('every tab renders prose with no unresolved locale keys', async ({ page }) => {
        const errors = [];
        page.on('pageerror', (e) => errors.push(String(e)));
        await loadDashboard(page);
        await openSection(page, 'help');
        for (const tab of TABS) {
            await page.locator(`[data-help-tab="${tab}"]`).click();
            const body = page.locator('#config-help-body');
            await expect(body.locator('.config-panel').first()).toBeVisible();
            // A missing key renders as "config.helpSomethingBody".
            await expect(body).not.toContainText(/config\.help/);
            // And no panel may be an empty shell.
            const empty = await body.locator('.config-help-prose').evaluateAll(
                (els) => els.filter((e) => !e.innerText.trim()).length);
            expect(empty).toBe(0);
        }
        expect(errors).toEqual([]);
    });

    test('search, finders and commands each get their own panel', async ({ page }) => {
        await loadDashboard(page);
        await openSection(page, 'help');
        await page.locator('[data-help-tab="search"]').click();
        // Finders and commands used to be one paragraph inside Search, which is
        // how they went unnoticed.
        await expect(page.locator('#config-help-body .config-panel')).toHaveCount(5);
        const body = page.locator('#config-help-body');
        // The filter syntax and the command examples are the substance here.
        await expect(body).toContainText('tag:');
        await expect(body).toContainText('category:');
        await expect(body).toContainText('%s');
        await expect(body).toContainText(':favicons fetch');
    });

    test('the help covers substantially more than a stub', async ({ page }) => {
        await loadDashboard(page);
        await openSection(page, 'help');
        let total = 0;
        for (const tab of TABS) {
            await page.locator(`[data-help-tab="${tab}"]`).click();
            total += await page.locator('#config-help-body').evaluate((e) => e.innerText.length);
        }
        // The first pass was ~9k characters rendered; the old config's help was
        // roughly three times that. This guards against a regression that
        // silently drops sections.
        expect(total).toBeGreaterThan(16000);
    });

    test('reusing the old prose did not repoint the old config’s own titles', async ({ page }) => {
        await loadDashboard(page);
        // templates/config.html still renders these keys; the new config uses
        // its own help*Title keys so retitling one page cannot degrade the other.
        const shared = await page.evaluate(() => {
            const t = window.dashboardInstance.language.t.bind(window.dashboardInstance.language);
            return {
                workspace: t('config.helpPageWorkspaceTitle'),
                organizing: t('config.helpPageOrganizingTitle'),
            };
        });
        expect(shared.workspace).toMatch(/bulk/i);
        expect(shared.organizing).toMatch(/organizing/i);
    });
});

test.describe('onboarding settings', () => {
    test('the tips toggle sits with the onboarding actions and explains itself', async ({ page }) => {
        await loadDashboard(page);
        await openSection(page, 'behavior');
        await page.locator('[data-behavior-tab="general"]').click();

        const toggle = page.locator('[data-behavior-field="enableSessionTips"]');
        await expect(toggle).toBeVisible();
        // It used to be a bare checkbox among unrelated General options, with no
        // explanation of what "occasional" means.
        await expect(page.locator('.config-field-hint').filter({ hasText: /keyboard tip/i }).first()).toBeVisible();
        // The quick-start and what's-new actions belong beside it, as in the old
        // config, rather than in the Data & backups danger panel.
        await expect(page.locator('[data-behavior-action="reset-onboarding"]')).toBeVisible();
        await expect(page.locator('[data-behavior-action="whats-new"]')).toBeVisible();
    });

    test('the tips toggle saves and its actions survive a tab switch', async ({ page }) => {
        await loadDashboard(page);
        await openSection(page, 'behavior');
        await page.locator('[data-behavior-tab="general"]').click();
        const toggle = page.locator('[data-behavior-field="enableSessionTips"]');
        const start = await toggle.isChecked();

        await toggle.setChecked(!start);
        await expect.poll(() => page.evaluate(async () =>
            (await (await fetch('/api/settings')).json()).enableSessionTips), { timeout: 10_000 }).toBe(!start);

        // The body is replaced wholesale on a tab switch, so the buttons have to
        // be rebound or they go dead.
        await page.locator('[data-behavior-tab="privacy"]').click();
        await page.locator('[data-behavior-tab="general"]').click();
        await expect(page.locator('[data-behavior-action]')).toHaveCount(2);

        await toggle.setChecked(start);
    });

    test('the onboarding reset is no longer in the danger panel', async ({ page }) => {
        await loadDashboard(page);
        await openSection(page, 'data-backups');
        // Replaying the quick-start card is harmless; sitting beside "delete all
        // bookmarks" made it read as destructive.
        await expect(page.locator('[data-backup-action="reset-onboarding"]')).toHaveCount(0);
    });
});

test.describe('statistics tabs', () => {
    const TABS = ['overview', 'activity', 'content', 'inbox', 'health'];

    test('the section is split into tabs instead of one long scroll', async ({ page }) => {
        const errors = [];
        page.on('pageerror', (e) => errors.push(String(e)));
        await loadDashboard(page);
        await openSection(page, 'stats');
        await expect(page.locator('[data-stats-tab]')).toHaveCount(TABS.length);

        for (const tab of TABS) {
            await page.locator(`[data-stats-tab="${tab}"]`).click();
            const body = page.locator('#config-stats-body');
            await expect(body.locator('.config-panel').first()).toBeVisible();
            // A missing key renders as "config.statsSomething".
            await expect(body).not.toContainText(/config\.stats/);
        }
        expect(errors).toEqual([]);
    });

    test('each tab shows its own panels and only those', async ({ page }) => {
        await loadDashboard(page);
        await openSection(page, 'stats');

        // The CSV export and headline tiles belong to Overview.
        await page.locator('[data-stats-tab="overview"]').click();
        await expect(page.locator('[data-stats-action="export"]')).toHaveCount(1);
        await expect(page.locator('.config-tiles')).toBeVisible();

        // The range picker drives the activity chart, so it lives there.
        await page.locator('[data-stats-tab="activity"]').click();
        await expect(page.locator('[data-stats-range]').first()).toBeVisible();
        await expect(page.locator('[data-stats-action="export"]')).toHaveCount(0);

        await page.locator('[data-stats-tab="health"]').click();
        await expect(page.locator('#config-stats-health')).toBeVisible();
        await expect(page.locator('[data-stats-range]')).toHaveCount(0);
    });

    test('overview leads with personal usage insights', async ({ page }) => {
        await loadDashboard(page);
        await page.evaluate(() => {
            window.dashboardInstance.allBookmarks.forEach((b, i) => {
                b.openCount = [12, 30, 5, 0, 8][i % 5];
                b.lastOpened = b.openCount ? Date.now() - i * 3600000 : 0;
            });
        });
        await openSection(page, 'stats');
        const body = page.locator('#config-stats-body');
        await expect(body.locator('.config-panel-title').first()).toContainText(/insights/i);
        // Each insight reads a number already on the page back as a sentence,
        // with somewhere to go next.
        await expect(body).toContainText(/Most activity happens on/);
        await expect(body).toContainText(/Status checks are enabled for/);
        await expect(page.locator('[data-stats-goto]').first()).toBeVisible();
    });

    test('an insight jumps to the tab that shows the detail', async ({ page }) => {
        await loadDashboard(page);
        await page.evaluate(() => {
            window.dashboardInstance.allBookmarks.forEach((b, i) => { b.openCount = 5 + i; });
        });
        await openSection(page, 'stats');
        const goto = page.locator('[data-stats-goto]').first();
        const target = await goto.getAttribute('data-stats-goto');
        await goto.click();
        await expect.poll(() => page.evaluate(() =>
            window.dashboardInstance.config.statsTab)).toBe(target);
    });

    test('activity carries shortcut and finder usage tables', async ({ page }) => {
        await page.route('**/api/finders', async (route) => {
            if (route.request().method() !== 'GET') return route.fallback();
            await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([
                { id: '1', name: 'Degoogle', searchUrl: 'https://x/?q=%s', shortcut: 'd', useCount: 10 },
                { id: '2', name: '4get', searchUrl: 'https://y/?q=%s', shortcut: 'g', useCount: 2 },
            ]) });
        });
        await loadDashboard(page);
        await page.evaluate(() => {
            window.dashboardInstance.allBookmarks.forEach((b, i) => {
                b.openCount = 30 - i;
                b.shortcut = `S${i}`;
            });
        });
        await openSection(page, 'stats');
        await page.locator('[data-stats-tab="activity"]').click();

        const body = page.locator('#config-stats-body');
        await expect(body.locator('.config-panel-title').filter({ hasText: /shortcuts/i })).toHaveCount(1);
        // Finders are their own resource, fetched separately from the bookmarks
        // the rest of the stats derive from.
        await expect.poll(() => body.locator('.config-stats-table').count(),
            { timeout: 10_000 }).toBe(2);
        await expect(body).toContainText('Degoogle');
        await expect(body).toContainText('12');
    });

    test('health carries rot, conflicts, search & status and link health', async ({ page }) => {
        await loadDashboard(page);
        await openSection(page, 'stats');
        await page.locator('[data-stats-tab="health"]').click();
        const titles = await page.locator('#config-stats-body .config-panel-title').allTextContents();
        // The old stats page had these as separate sections; folding conflicts
        // into the rot panel lost "conflicts & duplicates" and "search & status".
        expect(titles.length).toBe(4);
        expect(titles.join(' | ')).toMatch(/rot/i);
        expect(titles.join(' | ')).toMatch(/conflicts/i);
        expect(titles.join(' | ')).toMatch(/search/i);
        await expect(page.locator('#config-stats-health')).toBeVisible();
    });

    test('conflicts names what actually clashes, not just a count', async ({ page }) => {
        await loadDashboard(page);
        await page.evaluate(() => {
            const d = window.dashboardInstance;
            const url = d.allBookmarks[0].url;
            d.allBookmarks.push({ name: 'Dup A', url, pageId: 1, shortcut: 'zz' });
            d.allBookmarks.push({ name: 'Dup B', url: 'https://clash.example.com', pageId: 1, shortcut: 'zz' });
        });
        await openSection(page, 'stats');
        await page.locator('[data-stats-tab="health"]').click();

        const body = page.locator('#config-stats-body');
        // A count alone says there is a problem; the value says which.
        await expect(body).toContainText(/Duplicate URLs:/);
        await expect(body).toContainText(/Conflicting shortcuts:/);
        await expect(body).toContainText('zz (×2)');
        // Only offered when there is something to merge.
        await expect(page.locator('[data-stats-action="open-health"]')).toBeVisible();
    });

    test('inbox sits between content and health, with both its blocks', async ({ page }) => {
        await loadDashboard(page);
        await openSection(page, 'stats');
        const order = await page.locator('[data-stats-tab]')
            .evaluateAll((els) => els.map((e) => e.getAttribute('data-stats-tab')));
        expect(order).toEqual(['overview', 'activity', 'content', 'inbox', 'health']);

        await page.locator('[data-stats-tab="inbox"]').click();
        // The snapshot comes from /api/inbox and the lifetime counters from
        // /api/inbox-stats; neither can be derived from the other.
        const body = page.locator('#config-stats-body');
        await expect(body.locator('.config-panel').first()).toBeVisible();
        await expect(body).not.toContainText(/config\.stats/);
        await expect.poll(() => body.locator('.config-tile').count(),
            { timeout: 10_000 }).toBeGreaterThan(0);
    });

    test('changing the range keeps you on the activity tab', async ({ page }) => {
        await loadDashboard(page);
        await openSection(page, 'stats');
        await page.locator('[data-stats-tab="activity"]').click();
        // Only the body repaints: rebuilding the tab strip would replace the
        // button under the pointer that just clicked it.
        await page.locator('[data-stats-range]').nth(1).click();
        await expect.poll(() => page.evaluate(() =>
            window.dashboardInstance.config.statsTab)).toBe('activity');
        await expect(page.locator('[data-stats-range]').first()).toBeVisible();
    });

    test('the old config keeps its own lowercase quick-link labels', async ({ page }) => {
        await loadDashboard(page);
        // templates/config.html still renders statsNav*; the tabs use their own
        // keys so restyling one page cannot degrade the other.
        const labels = await page.evaluate(() => {
            const t = window.dashboardInstance.language.t.bind(window.dashboardInstance.language);
            return { nav: t('config.statsNavOverview'), tab: t('config.statsTabOverview') };
        });
        expect(labels.nav).toBe('overview');
        expect(labels.tab).toBe('Overview');
    });
});
