// @ts-check
const { test, expect } = require('./fixtures');
const { dismissOnboardingIfPresent, dismissBlockingOverlays, waitForFaviconPrefetch, markWhatsNewSeen } = require('./e2e-helpers');

/**
 * The keyboard-shortcut popovers on the header links (pages, inbox, health,
 * config) and the button bar below (add, search, commands, finders, recent, tag
 * cloud, cheat sheet, what's new).
 *
 * One switch covers all of them: settings.showShortcutTooltips, reachable from
 * Config → Behavior → General and from `:shortcuts on|off` in the command
 * panel. They are default-on, since they are how the keys get discovered, so
 * only an explicit false switches them off.
 *
 * setupToolbarKbdTooltips() renders every one of them, which is why the gate
 * sits there rather than at each call site.
 */

// The popovers are suppressed on a coarse pointer, and isCoarsePointer() also
// treats anything under 769px as coarse — so the window has to be desktop-sized
// for any of this to exist at all.
test.use({ viewport: { width: 1400, height: 900 } });

async function loadDashboard(page) {
    // Before the navigation: this drives a real mouse, and the one-time tips
    // are fixed-position toasts that land on top of the very buttons being
    // hovered. The search-mode tip sat over #finders-button and swallowed the
    // pointer, so the popover never opened.
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
}

async function setTooltips(page, enabled) {
    await page.evaluate(async (v) => {
        const d = window.dashboardInstance;
        d.settings.showShortcutTooltips = v;
        await d.saveSettings();
        d.setupToolbarKbdTooltips();
    }, enabled);
}

/** Hovers a target with a real mouse move and reports the popover text. */
async function hoverAndRead(page, selector) {
    // The starter-icon prefetch covers the screen while it runs — fixed, inset
    // 0, z-index 12000 — so a real mouse move lands on it rather than on the
    // control. It comes and goes during the run, so it is waited out here
    // rather than once at load.
    await waitForFaviconPrefetch(page);
    const el = page.locator(selector).first();
    if (await el.count() === 0) return { skipped: true };
    const box = await el.boundingBox();
    if (!box) return { skipped: true };
    // Move away first so a re-entry always registers as a fresh hover.
    await page.mouse.move(5, 5);
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.waitForTimeout(120);
    return page.evaluate((q) => {
        const tip = document.getElementById('toolbar-kbd-tooltip');
        const el = document.querySelector(q);
        const b = el?.getBoundingClientRect();
        const at = b ? document.elementFromPoint(b.x + b.width/2, b.y + b.height/2) : null;
        return {
            skipped: false,
            visible: Boolean(tip?.classList.contains('is-visible')),
            text: tip?.textContent?.trim() || null,
            _top: at ? (at.id || at.className || at.tagName).toString().slice(0,30) : null,
        };
    }, selector);
}

// The two families the user sees as one feature: header links, and the button
// bar underneath.
const HEADER = ['#page-overview-header-btn', '.config-link-anchor'];
const TOOLBAR = ['#search-button', '#commands-button', '#finders-button'];

test.describe('dashboard shortcut popovers: one switch', () => {
    test('they are off unless asked for, and the host exists once switched on', async ({ page }) => {
        await loadDashboard(page);
        // Off for everyone, not only for new installs: the setting was on since
        // it existed and written into every stored file, so a default change
        // alone would have left every current dashboard as it was. A one-time
        // migration turned them off, and turning them back on sticks.
        expect(await page.evaluate(() => window.dashboardInstance.settings.showShortcutTooltips)).toBe(false);

        await setTooltips(page, true);
        expect(await page.evaluate(() => Boolean(document.getElementById('toolbar-kbd-tooltip')))).toBe(true);
    });

    test('switching off hides the header popovers', async ({ page }) => {
        await loadDashboard(page);
        await setTooltips(page, true);
        for (const sel of HEADER) {
            const on = await hoverAndRead(page, sel);
            if (on.skipped) continue;
            expect(on.visible, `${sel} should show a popover while on; top=${on._top}`).toBe(true);
        }

        await setTooltips(page, false);
        for (const sel of HEADER) {
            const off = await hoverAndRead(page, sel);
            if (off.skipped) continue;
            expect(off.visible, `${sel} should stay silent while off`).toBe(false);
        }
    });

    test('switching off hides the button-bar popovers too', async ({ page }) => {
        await loadDashboard(page);
        await setTooltips(page, true);
        for (const sel of TOOLBAR) {
            const on = await hoverAndRead(page, sel);
            if (on.skipped) continue;
            expect(on.visible, `${sel} should show a popover while on; top=${on._top}`).toBe(true);
        }

        await setTooltips(page, false);
        for (const sel of TOOLBAR) {
            const off = await hoverAndRead(page, sel);
            if (off.skipped) continue;
            expect(off.visible, `${sel} should stay silent while off`).toBe(false);
        }
    });

    test('switching off removes the popover element and its listeners', async ({ page }) => {
        await loadDashboard(page);
        await setTooltips(page, false);

        // Left bound, the pointermove handler keeps running on every mouse move
        // for a feature that is switched off.
        const state = await page.evaluate(() => ({
            el: Boolean(document.getElementById('toolbar-kbd-tooltip')),
            sync: Boolean(window.dashboardInstance._toolbarKbdTooltipSync),
        }));
        expect(state.el).toBe(false);
        expect(state.sync).toBe(false);
    });

    test('turning it back on restores them without a reload', async ({ page }) => {
        await loadDashboard(page);
        await setTooltips(page, false);
        await setTooltips(page, true);

        const back = await hoverAndRead(page, '#search-button');
        if (!back.skipped) expect(back.visible).toBe(true);
    });

    test('the choice survives a reload', async ({ page }) => {
        await loadDashboard(page);
        await setTooltips(page, false);

        await page.reload();
        await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
        await dismissOnboardingIfPresent(page);
        await dismissBlockingOverlays(page);

        expect(await page.evaluate(() => window.dashboardInstance.settings.showShortcutTooltips)).toBe(false);
        const after = await hoverAndRead(page, '#search-button');
        if (!after.skipped) expect(after.visible).toBe(false);
    });
});

test.describe('the switch is reachable from both places', () => {
    test('Config → Behavior → General has the toggle and it saves', async ({ page }) => {
        await loadDashboard(page);
        await page.evaluate(() => window.dashboardInstance.config.openConfigView('behavior'));
        await page.locator('[data-behavior-tab="general"]').click();

        const toggle = page.locator('[data-behavior-field="showShortcutTooltips"]');
        await expect(toggle).toBeVisible();
        const start = await toggle.isChecked();

        await toggle.setChecked(!start);
        await expect.poll(() => page.evaluate(async () =>
            (await (await fetch('/api/settings')).json()).showShortcutTooltips), { timeout: 10_000 }).toBe(!start);
    });

    test(':shortcuts off turns them off, :shortcuts on turns them back', async ({ page }) => {
        await loadDashboard(page);
        const run = (arg) => page.evaluate((a) => {
            const sc = window.dashboardInstance.searchComponent?.commandsComponent;
            const rows = sc.handleShortcutTooltipsCommand([a]);
            const row = rows.find((r) => r.stateId === `shortcuts:${a}`) || rows[0];
            return row?.action?.() ?? null;
        }, arg);

        await run('off');
        await expect.poll(() => page.evaluate(async () =>
            (await (await fetch('/api/settings')).json()).showShortcutTooltips), { timeout: 10_000 }).toBe(false);
        expect(await page.evaluate(() => Boolean(document.getElementById('toolbar-kbd-tooltip')))).toBe(false);

        await run('on');
        await expect.poll(() => page.evaluate(async () =>
            (await (await fetch('/api/settings')).json()).showShortcutTooltips), { timeout: 10_000 }).toBe(true);
        expect(await page.evaluate(() => Boolean(document.getElementById('toolbar-kbd-tooltip')))).toBe(true);
    });

    test('the info modal has a title and body, not just a button', async ({ page }) => {
        await loadDashboard(page);
        await page.evaluate(() => window.dashboardInstance.config.openConfigView('behavior'));
        await page.locator('[data-behavior-tab="general"]').click();

        // Both strings must resolve. An unresolved key renders as empty here,
        // which is how this surfaced: a modal with "Got it" and nothing above.
        const strings = await page.evaluate(() => {
            const c = window.dashboardInstance.config;
            const [titleKey, msgKey] = c.fieldMeta('showShortcutTooltips').info;
            return { title: c.t(`config.${titleKey}`, ''), msg: c.t(`config.${msgKey}`, '') };
        });
        expect(strings.title.trim().length).toBeGreaterThan(0);
        expect(strings.msg.trim().length).toBeGreaterThan(0);

        await page.locator('[data-info-field="showShortcutTooltips"]').click();
        const modal = page.locator('#app-modal, .app-modal').first();
        await expect(modal).toBeVisible();
        await expect(modal).toContainText(strings.title);
    });

    test('locales are fetched with the app-version token so a stale copy cannot stick', async ({ page }) => {
        const localeRequests = [];
        page.on('request', (req) => {
            if (req.url().includes('/locales/')) localeRequests.push(req.url());
        });
        await loadDashboard(page);

        expect(localeRequests.length).toBeGreaterThan(0);
        // Without a token the browser may serve its stored copy indefinitely,
        // which is what left a new key resolving to nothing.
        for (const url of localeRequests) {
            // `?v=` or `&v=`: the scoped fetch puts scope first, so the token is
            // the second parameter — a locale is now asked for as
            // `en.json?scope=core&v=<hash>`.
            expect(url, `${url} should carry a version token`).toMatch(/[?&]v=/);
        }
    });

    /**
     * The popovers are listeners bound to the toolbar buttons, not markup read
     * at render time, so the config toggle's default repaint did nothing to
     * them — the change only showed up after a full reload. `:shortcuts` in the
     * palette already re-ran the setup; config now does too.
     */
    test('the config toggle applies without a reload', async ({ page }) => {
        await loadDashboard(page);
        await setTooltips(page, true);

        await page.evaluate(() => window.dashboardInstance.config.openConfigView('behavior'));
        await page.evaluate(() => {
            window.dashboardInstance.config.behaviorTab = 'general';
            window.dashboardInstance.config.render();
        });
        const toggle = page.locator('[data-behavior-field="showShortcutTooltips"]');
        await expect(toggle).toBeVisible();

        await toggle.uncheck();
        await expect.poll(() => page.evaluate(() =>
            !!document.getElementById('toolbar-kbd-tooltip')), { timeout: 5000 }).toBe(false);

        await toggle.check();
        await expect.poll(() => page.evaluate(() =>
            !!document.getElementById('toolbar-kbd-tooltip')), { timeout: 5000 }).toBe(true);
    });

    test('the command is listed in the palette', async ({ page }) => {
        await loadDashboard(page);
        const known = await page.evaluate(() => {
            const sc = window.dashboardInstance.searchComponent?.commandsComponent;
            return {
                registered: typeof sc.availableCommands.shortcuts === 'function',
                grouped: sc.commandGroups.some((g) => g.commands.includes('shortcuts')),
            };
        });
        expect(known.registered).toBe(true);
        expect(known.grouped).toBe(true);
    });
});
