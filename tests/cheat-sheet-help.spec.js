// @ts-check
const { test, expect } = require('./fixtures');
const { mockDocker } = require('./helpers/docker-mock');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays, ensureBookmarksDashboardView } = require('./e2e-helpers');

/**
 * Keys and help: the cheat sheet opens on the page you are on, says what to do
 * first, offers the safe steps as "Try it", and keeps every key in All keys.
 */

async function load(page) {
    await page.setViewportSize({ width: 1400, height: 900 });
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForSelector('.bookmark-link', { timeout: 20_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await ensureBookmarksDashboardView(page);
}

const sheet = (page) => page.locator('#app-modal.show .keyboard-cheat-sheet');
const tab = (page, id) => page.locator(`[data-cs-tab="${id}"]`);

test('it opens on This page and says where you are and what to do first', async ({ page }) => {
    await load(page);
    await page.keyboard.press('?');
    await expect(sheet(page)).toBeVisible();
    await expect(tab(page, 'this')).toHaveAttribute('aria-selected', 'true');
    await expect(sheet(page).locator('.cs-now-title')).toContainText('You are in Your dashboard');
    await expect(sheet(page).locator('.cs-now-mode')).toContainText('Search');
    expect(await sheet(page).locator('.cs-step').count()).toBeGreaterThan(5);
    // The long list is not on show until you ask for it.
    await expect(sheet(page).locator('.cheat-sheet-group').first()).toBeHidden();
});

test('in the Inbox it leads with the Inbox', async ({ page }) => {
    await load(page);
    await page.keyboard.press('Shift+I');
    await expect.poll(() => page.evaluate(() => window.dashboardInstance.activeView)).toBe('inbox');
    await page.keyboard.press('?');
    await expect(sheet(page).locator('.cs-now-title')).toContainText('The Inbox');
    await expect(sheet(page).locator('.cs-now-mode')).toContainText('Browse');
});

test('All keys keeps every section; searching goes there and back', async ({ page }) => {
    await load(page);
    await page.keyboard.press('?');
    await tab(page, 'all').click();
    const groups = await sheet(page).locator('.cheat-sheet-group').count();
    expect(groups).toBeGreaterThan(10);
    await tab(page, 'this').click();
    await expect(sheet(page).locator('.cheat-sheet-group').first()).toBeHidden();
    await page.locator('#cheat-sheet-filter').fill('inbox');
    await expect(tab(page, 'all')).toHaveAttribute('aria-selected', 'true');
    await expect(sheet(page).locator('.cheat-sheet-row:not([hidden])').first()).toBeVisible();
    await page.locator('#cheat-sheet-filter').fill('');
    await expect(tab(page, 'this')).toHaveAttribute('aria-selected', 'true');
});

test('a step shows its explanation in the dock, and Try it does the safe thing on the page', async ({ page }) => {
    await load(page);
    await page.keyboard.press('?');
    await sheet(page).locator('#cs-panel-this .cs-step', { hasText: 'Run any command' }).locator('.cs-item').click();
    await expect(page.locator('#cheat-sheet-dock')).toContainText('palette holds every action');
    await sheet(page).locator('#cs-panel-this .cs-step', { hasText: 'Run any command' }).locator('.cs-try').click();
    await expect(sheet(page)).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => window.dashboardInstance.searchComponent?.currentQuery)).toBe(':');
});

test('only safe steps carry Try it: nothing that changes a bookmark', async ({ page }) => {
    await load(page);
    const unsafe = await page.evaluate(() => {
        const bad = [];
        const safe = new Set(['ArrowDown', 'j', ']', '/', ':', '>', '!', '#', '*', '=', '@', 'B', 'H', 'K', 'N']);
        Object.entries(window.KeyboardPageHelp.HELP).forEach(([id, h]) => h.steps.forEach((s) => {
            if (s.try && s.try.key && !safe.has(s.try.key)) bad.push(`${id}: ${s.keys}`);
        }));
        return bad;
    });
    expect(unsafe).toEqual([]);
});

test('Search modes lists the palette keys and Try it opens the mode; Learn offers the tours', async ({ page }) => {
    await load(page);
    await page.keyboard.press('?');
    await tab(page, 'modes').click();
    await expect(sheet(page).locator('#cs-panel-modes .cs-step')).toHaveCount(8);
    await sheet(page).locator('#cs-panel-modes .cs-step', { hasText: 'Tags' }).locator('.cs-try').click();
    await expect.poll(() => page.evaluate(() => window.dashboardInstance.searchComponent?.currentQuery), { timeout: 5_000 }).toBe('tag:');
    await page.keyboard.press('Escape');
    await page.keyboard.press('?');
    await tab(page, 'learn').click();
    // Every tour the app has, not a pick of them.
    const tours = await page.evaluate(() => window.KeyboardPageHelp.TOURS.length);
    expect(tours).toBeGreaterThanOrEqual(12);
    await expect(sheet(page).locator('#cs-panel-learn .cs-step', { hasText: 'Tour:' })).toHaveCount(tours);
    await expect(sheet(page).getByText('Read the help')).toBeVisible();
});

test('the tabs answer the arrow keys, and On this page folds the long list', async ({ page }) => {
    await load(page);
    await page.keyboard.press('?');
    // The sheet puts the focus in its filter once it is up; the tab is focused after that.
    await expect(page.locator('#cheat-sheet-filter')).toBeFocused();
    await tab(page, 'this').focus();
    await page.keyboard.press('ArrowRight');
    await expect(tab(page, 'all')).toHaveAttribute('aria-selected', 'true');
    await tab(page, 'this').click();
    const more = sheet(page).locator('[data-cs-more]');
    if (await more.count()) {
        await more.click();
        await expect(sheet(page).locator('.cs-step--extra').first()).toBeVisible();
    }
});

test('every key a page help names is on that page\'s own sheet section', async ({ page }) => {
    await load(page);
    const bad = await page.evaluate(() => {
        const norm = (s) => String(s).toLowerCase().replace(/ctrl\/cmd|cmd\/ctrl/g, 'ctrl').replace(/\s*\+\s*/g, '+');
        const tokens = (keys) => norm(keys).split(/\s*\/\s*|\s+/).filter(Boolean);
        // The sheet as it is for a dashboard that has everything switched on.
        const d = window.dashboardInstance;
        const secs = window.KeyboardCheatSheetRegistry.SECTIONS;
        // The page's own section, and the sections no page owns (search, the palette).
        const rowsOf = (ctx) => secs.filter((sec) => sec.contextId === ctx || !sec.contextId).flatMap((sec) => {
            if (sec.rows) return sec.rows.map((r) => r.keys);
            const legend = window.KeyboardViewLegends?.[sec.legend] || [];
            return legend.map((r) => r.keys);
        });
        const out = [];
        Object.entries(window.KeyboardPageHelp.HELP).forEach(([id, h]) => {
            const ctx = id.startsWith('config:') ? 'config' : id;
            const known = new Set(rowsOf(ctx).flatMap(tokens));
            h.steps.forEach((step) => {
                if (step.keys === 'Type') return;
                tokens(step.keys).forEach((t) => {
                    if (!known.has(t)) out.push(`${id}: "${t}" (${step.keys}) is not in the ${ctx} section`);
                });
            });
        });
        return out;
    });
    expect(bad).toEqual([]);
});

/*
 * Every key a view's legend shows is on the sheet, and the page's own section
 * carries the two aids (the legend and the strip) in every view that has them.
 */
test('every legend key is on the sheet, and each view lists Shift+H and Shift+S', async ({ page }) => {
    test.setTimeout(90_000);
    await mockDocker(page);
    await load(page);
    const tokens = (keys) => keys.flatMap((k) => k.toLowerCase().replace(/ctrl\/cmd|cmd\/ctrl|⌘\/ctrl/g, 'ctrl').replace(/\s*\+\s*/g, '+').split(/\s*\/\s*|\s+/)).filter(Boolean);
    const sheetFor = (ctx, whole) => page.evaluate(([c, all]) => {
        const d = window.dashboardInstance;
        const secs = window.KeyboardCheatSheetRegistry.buildSections(d, (k, f) => f);
        return secs.filter((s) => all || s.contextId === c).flatMap((s) => s.items.map((i) => i.keys));
    }, [ctx, whole]);
    const legend = (sel) => page.evaluate((q) => [...document.querySelectorAll(q)].map((k) => k.textContent.trim()), sel);
    const ctxNow = () => page.evaluate(() => window.KeyboardCheatSheetRegistry.activeContextId(window.KeyboardCheatSheetRegistry.buildContext(window.dashboardInstance)));
    const problems = [];
    async function check(name, sel) {
        await page.waitForTimeout(800);
        const ctx = await ctxNow();
        const whole = new Set(tokens(await sheetFor(ctx, true)));
        const own = new Set(tokens(await sheetFor(ctx, false)));
        for (const key of await legend(sel)) {
            // Shift+G (Glances) only has a row where Glances is switched on.
            if (key === 'Shift+G') continue;
            if (!tokens([key]).every((t) => whole.has(t))) problems.push(`${name}: ${key} is on no sheet section`);
        }
        for (const aid of ['shift+h', 'shift+s']) {
            if (!own.has(aid)) problems.push(`${name}: ${aid} is not in its own section`);
        }
    }
    await page.keyboard.press('ArrowDown');
    await check('dashboard', '.dashboard-legend-line kbd');
    await page.keyboard.press('Shift+B');
    await page.waitForSelector('#config-bm-list .config-bm-row', { timeout: 15_000 });
    await check('library', '.config-bm-keyboard-legend kbd');
    await page.keyboard.press('Escape');
    await page.keyboard.press('Shift+T');
    await page.waitForSelector('.tag-view-legend', { timeout: 15_000 });
    await check('tags', '.tag-view-legend kbd');
    await page.keyboard.press('Escape');
    await page.keyboard.press('Shift+C');
    await page.waitForSelector('.docker-legend', { timeout: 15_000 });
    await check('docker', '.docker-legend kbd');
    expect(problems).toEqual([]);
});

test('the Learn tab lists every guided tour Config knows', async ({ page }) => {
    await load(page);
    await page.evaluate(() => window.dashboardInstance.config.openConfigView('help'));
    await page.waitForFunction(() => window.dashboardInstance.config._module?.constructor?.GUIDED_TOURS, null, { timeout: 15_000 });
    const same = await page.evaluate(() => {
        const mine = window.KeyboardPageHelp.TOURS.map((t) => t.id).sort();
        const theirs = window.dashboardInstance.config._module.constructor.GUIDED_TOURS.map((t) => t.id).sort();
        return JSON.stringify(mine) === JSON.stringify(theirs) ? 'same' : `${mine} | ${theirs}`;
    });
    expect(same).toBe('same');
});

test('the filter also finds help texts, modes and tours, not only keys', async ({ page }) => {
    await load(page);
    await page.keyboard.press('?');
    await page.locator('#cheat-sheet-filter').fill('snooze');
    await expect(tab(page, 'all')).toHaveAttribute('aria-selected', 'true');
    const group = sheet(page).locator('.cs-help-group');
    await expect(group).toBeVisible();
    const hit = group.locator('.cs-step:not([hidden])', { hasText: 'Snooze it' });
    await expect(hit.first()).toContainText('Triage');
    // Selecting a hit shows what it says in the dock.
    await hit.first().locator('.cs-item').click();
    await expect(page.locator('#cheat-sheet-dock')).toContainText('comes back when you said it should');
    // A tour is found by its name and can be opened from here.
    await page.locator('#cheat-sheet-filter').fill('glances');
    await expect(group.locator('.cs-step:not([hidden])', { hasText: 'Tour: Glances' })).toBeVisible();
    await expect(group.locator('.cs-step:not([hidden]) .cs-try').first()).toBeVisible();
    // A word that is nowhere says so, and the group goes.
    await page.locator('#cheat-sheet-filter').fill('zzzzqq');
    await expect(group).toBeHidden();
    await expect(page.locator('#cheat-sheet-no-results')).toBeVisible();
    await page.locator('#cheat-sheet-filter').fill('');
    await expect(tab(page, 'this')).toHaveAttribute('aria-selected', 'true');
});

test('the Inbox page quotes the Help, links to the panel, and the panel links back', async ({ page }) => {
    await load(page);
    await page.keyboard.press('Shift+I');
    await expect.poll(() => page.evaluate(() => window.dashboardInstance.activeView)).toBe('inbox');
    await page.keyboard.press('?');
    const card = sheet(page).locator('.cs-card').first();
    await expect(card).toBeVisible();
    await expect(card.locator('.cs-card-title')).not.toBeEmpty();
    // The excerpt is the first paragraph of the very text Help renders.
    const same = await page.evaluate(() => {
        const d = window.dashboardInstance;
        const body = d.language.t('config.helpInboxWorkBody');
        const first = new DOMParser().parseFromString(`<div>${body}</div>`, 'text/html').body.querySelector('p').textContent.replace(/\s+/g, ' ').trim();
        const shown = document.querySelector('.cs-card .cs-card-body').textContent.replace(/\s+/g, ' ').trim();
        return first.startsWith(shown.replace(/…$/, '').slice(0, 80));
    });
    expect(same).toBe(true);
    await card.locator('.cs-card-more').click();
    await expect(sheet(page)).toHaveCount(0);
    await expect(page).toHaveURL(/#config\/help\/inbox\/inbox-work/);
    await expect(page.locator('#help-panel-inbox-work')).toBeVisible({ timeout: 15_000 });
    // And back: the panel's own button opens the sheet on the Inbox.
    await page.locator('#help-panel-inbox-work [data-help-keys]').click();
    await expect(sheet(page).locator('.cs-now-title')).toContainText('The Inbox');
});

test('a step with a longer answer has More, and the page shows one tip', async ({ page }) => {
    await load(page);
    await page.keyboard.press('Shift+I');
    await expect.poll(() => page.evaluate(() => window.dashboardInstance.activeView)).toBe('inbox');
    await page.keyboard.press('?');
    await expect(sheet(page).locator('#cs-panel-this .cs-more-link').first()).toBeVisible();
    await expect(sheet(page).locator('.cs-tip')).toHaveCount(1);
});

test('the filter finds words that are only in the Help text', async ({ page }) => {
    await load(page);
    await page.keyboard.press('?');
    // "weekend" is in the snoozing paragraph of the Inbox help, not on any key row or step.
    await page.locator('#cheat-sheet-filter').fill('weekend');
    const hit = sheet(page).locator('.cs-help-group .cs-step:not([hidden])');
    await expect(hit.first()).toBeVisible();
    await expect(hit.first().locator('.cs-more-link')).toBeVisible();
});

test('every Help panel the sheet links to exists', async ({ page }) => {
    test.setTimeout(120_000);
    await load(page);
    const links = await page.evaluate(() => {
        const out = new Set();
        const K = window.KeyboardPageHelp;
        Object.values(K.LINKS).flat().forEach((l) => out.add(`#config/help/${l.tab}/${K.panelId(l.title)}`));
        return [...out];
    });
    expect(links.length).toBeGreaterThanOrEqual(8);
    for (const hash of links) {
        await page.evaluate((h) => { window.location.hash = h; }, hash);
        const id = hash.split('/').pop();
        await expect(page.locator(`#help-panel-${id}`), hash).toBeVisible({ timeout: 15_000 });
    }
});

test('from Help the sheet shows another page without trying keys on Config, and Config pages keep their keys', async ({ page }) => {
    await load(page);
    await page.goto('/#config/help/inbox/inbox-work');
    await expect(page.locator('#help-panel-inbox-work')).toBeVisible({ timeout: 15_000 });
    await page.locator('#help-panel-inbox-work [data-help-keys]').click();
    await expect(sheet(page).locator('.cs-now-title')).toContainText('The Inbox');
    // The page is not the one on screen: its keys are listed, none can be tried, and the mode line says so.
    await expect(sheet(page).locator('#cs-panel-this .cs-step .cs-try')).toHaveCount(0);
    await expect(sheet(page).locator('.cs-now-mode')).toContainText('Open the page to use them');
    await page.keyboard.press('Escape');
    // A Config page's help leads with the Config keys, like ? on that page.
    await page.goto('/#config/help/organizing/workspace');
    await expect(page.locator('#help-panel-workspace')).toBeVisible({ timeout: 15_000 });
    await page.locator('#help-panel-workspace [data-help-keys]').click();
    await expect(sheet(page).locator('.cs-now-title')).toContainText('Config');
    expect(await sheet(page).locator('#cs-panel-this .cs-step').count()).toBeGreaterThan(5);
});

test('the Help rows show plain text, not escaped markup', async ({ page }) => {
    await load(page);
    await page.keyboard.press('?');
    await page.locator('#cheat-sheet-filter').fill('Panel');
    const rows = sheet(page).locator('.cs-help-group .cs-step:not([hidden]) .cs-item');
    await expect(rows.first()).toBeVisible();
    for (const i of [0, 1, 2]) {
        if (await rows.nth(i).count()) {
            await rows.nth(i).click();
            expect(await page.locator('#cheat-sheet-dock').innerText()).not.toMatch(/&amp;|&gt;|&lt;/);
        }
    }
});

test('pressing ? twice opens one sheet, and Read more on the panel you are on still goes there', async ({ page }) => {
    await load(page);
    await page.evaluate(() => { const d = window.dashboardInstance; d.showKeyboardCheatSheet(); d.showKeyboardCheatSheet(); });
    await expect(sheet(page)).toHaveCount(1);
    await page.keyboard.press('Escape');
    await page.goto('/#config/help/search/keyboard');
    await expect(page.locator('#help-panel-keyboard')).toBeVisible({ timeout: 15_000 });
    await page.locator('#help-panel-keyboard [data-help-keys]').click();
    await sheet(page).locator('.cs-card-more').first().click();
    await expect(sheet(page)).toHaveCount(0);
    await expect(page.locator('#help-panel-keyboard, #help-panel-search').first()).toBeVisible();
});

test('the bell has a ? that opens its keys and help, and its own Help topic', async ({ page }) => {
    await load(page);
    await page.keyboard.press('Shift+N');
    const help = page.locator('.notification-bell-help');
    await expect(help).toBeVisible({ timeout: 10_000 });
    await help.click();
    await expect(sheet(page).locator('.cs-now-title')).toContainText('The notifications bell');
    // The keys it names, with nothing to try from here.
    await expect(sheet(page).locator('#cs-panel-this .cs-step', { hasText: 'Open or close the bell' })).toBeVisible();
    await expect(sheet(page).locator('#cs-panel-this .cs-try')).toHaveCount(0);
    // It quotes the bell's own Help panel and goes there.
    await sheet(page).locator('.cs-card-more').first().click();
    await expect(page).toHaveURL(/#config\/help\/(start\/)?bell/);
    await expect(page.locator('#help-panel-bell')).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('#help-panel-bell')).toContainText('Shift + N');
});

test('the dashboard names the bell, with More to its Help topic', async ({ page }) => {
    await load(page);
    await page.keyboard.press('?');
    const step = sheet(page).locator('#cs-panel-this .cs-step', { hasText: 'Open the notifications bell' });
    await expect(step).toBeVisible();
    await expect(step.locator('.cs-more-link')).toBeVisible();
    expect(await step.locator('.cs-more-link').getAttribute('data-help-hash')).toMatch(/#config\/help\/start\/bell$/);
});

test('the English locale carries exactly the help texts the data holds (no shifted steps)', async ({ page }) => {
    await load(page);
    const bad = await page.evaluate(() => {
        const lang = window.dashboardInstance.language;
        const out = [];
        Object.entries(window.KeyboardPageHelp.HELP).forEach(([id, h]) => {
            if (lang.t(`pageHelp.${id}.title`) !== h.title) out.push(`${id} title`);
            if (lang.t(`pageHelp.${id}.intro`) !== h.intro) out.push(`${id} intro`);
            // No stale leftovers: the locale holds exactly as many steps as the data.
            const held = Object.keys(lang.translations.pageHelp?.[id] || {}).filter((k) => /^step\d+$/.test(k)).length;
            if (held !== h.steps.length) out.push(`${id} holds ${held} steps, the data ${h.steps.length}`);
            h.steps.forEach((s, i) => {
                if (lang.t(`pageHelp.${id}.step${i + 1}`) !== s.text) out.push(`${id} step${i + 1}`);
                if (s.explain && lang.t(`pageHelp.${id}.step${i + 1}Explain`) !== s.explain) out.push(`${id} step${i + 1}Explain`);
            });
        });
        return out;
    });
    expect(bad).toEqual([]);
});

test('the bell Help panel leads back to the bell, and its sheet says the keys work anywhere', async ({ page }) => {
    await load(page);
    await page.goto('/#config/help/bell');
    await expect(page.locator('#help-panel-bell')).toBeVisible({ timeout: 15_000 });
    await page.locator('#help-panel-bell [data-help-keys]').click();
    await expect(sheet(page).locator('.cs-now-title')).toContainText('The notifications bell');
    await expect(sheet(page).locator('.cs-now-mode')).toContainText('work from anywhere');
});
