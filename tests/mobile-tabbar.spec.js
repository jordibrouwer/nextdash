// @ts-check
const { test, expect } = require('./fixtures');
const { prepareDashboardInteraction, dismissWhatsNewIfPresent } = require('./e2e-helpers');
const { headers } = require('./helpers/feed-watch');

/**
 * The phone's tab bar, Status and More screens and the two start screens
 * (static/js/mobile-tabbar.js). Desktop must stay as it was.
 */

async function open(page) {
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
    await prepareDashboardInteraction(page);
    await dismissWhatsNewIfPresent(page);
    await page.waitForSelector('.bookmark-link', { timeout: 15_000 });
}

test.describe('phone', () => {
    test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

    test('the bar replaces the footer, with the five tabs', async ({ page }) => {
        await open(page);
        const bar = page.locator('#mobile-tabbar');
        await expect(bar).toBeVisible();
        await expect(bar.locator('button')).toHaveCount(5);
        await expect(bar.locator('[aria-current="page"]')).toHaveAttribute('data-tab', 'home');
        await expect(page.locator('.button-container')).toBeHidden();
    });

    test('start screen A is search first, B is status first, and the choice is in More', async ({ page }) => {
        await open(page);
        await expect(page.locator('#mobile-home')).toHaveAttribute('data-variant', 'search');
        await expect(page.locator('#mobile-home .mobile-search--big')).toBeVisible();
        await page.locator('#mobile-tabbar [data-tab="more"]').click();
        await expect(page.locator('#mobile-panel')).toContainText('Quick settings');
        await page.locator('#mobile-panel [data-home="status"]').click();
        await page.locator('#mobile-tabbar [data-tab="home"]').click();
        await expect(page.locator('#mobile-home')).toHaveAttribute('data-variant', 'status');
        expect(await page.evaluate(() => window.dashboardInstance.settings.mobileHome)).toBe('status');
        // Put it back: the data dir is shared.
        await page.locator('#mobile-tabbar [data-tab="more"]').click();
        await page.locator('#mobile-panel [data-home="search"]').click();
        await expect(page.locator('#mobile-panel [data-home="search"]')).toHaveAttribute('aria-pressed', 'true');
    });

    test('start screen A shows the recently opened bookmarks as chips, newest first', async ({ page }) => {
        await open(page);
        await page.evaluate(() => {
            const d = window.dashboardInstance;
            d.allBookmarks.slice(0, 2).forEach((b, i) => { b.lastOpened = Date.now() - i * 1000; });
            window.MobileTabbar.sync();
        });
        const chips = page.locator('#mobile-home .mobile-recent a.mobile-chip');
        await expect(chips).toHaveCount(2);
        const first = await page.evaluate(() => window.dashboardInstance.allBookmarks[0].url);
        expect(await chips.first().getAttribute('href')).toContain(new URL(first).host);
    });

    test('Status lists the pause buttons, and a pause is held on the server until resumed', async ({ page, request }) => {
        await open(page);
        await page.locator('#mobile-tabbar [data-tab="status"]').click();
        await expect(page.locator('#mobile-panel')).toContainText('Notifications');
        await page.locator('#mobile-panel [data-pause="hour"]').click();
        await expect(page.locator('#mobile-panel [data-pause="off"]')).toBeVisible();
        const paused = await (await request.get('/api/notify/quiet')).json();
        expect(paused.quiet).toBe(true);
        expect(paused.pausedUntil).toBeGreaterThan(Date.now());
        await page.locator('#mobile-panel [data-pause="off"]').click();
        await expect(page.locator('#mobile-panel [data-pause="hour"]')).toBeVisible();
        const after = await (await request.get('/api/notify/quiet')).json();
        expect(after.pausedUntil).toBeUndefined();
    });

    test('the search palette is a compact sheet: a visible field that types, a close button, no auto-open by shortcut', async ({ page }) => {
        await open(page);
        await page.locator('#mobile-tabbar [data-tab="search"]').click();
        const field = page.locator('#search-input-mobile');
        await expect(field).toBeVisible();
        const box = await field.boundingBox();
        expect(box.width).toBeGreaterThan(250);
        expect(box.height).toBeGreaterThanOrEqual(44);
        // Two letters that a bookmark's shortcut could match must stay a search word.
        await page.evaluate(() => {
            const sc = window.dashboardInstance.searchComponent;
            sc.shortcuts.set('gi', { url: 'https://example.org/should-not-open', shortcut: 'gi', title: 'x' });
        });
        await field.pressSequentially('gi', { delay: 50 });
        await expect(field).toHaveValue('gi');
        await expect(page.locator('#shortcut-search')).toHaveClass(/show/);
        await expect(page.locator('#search-close-mobile')).toBeVisible();
        await page.locator('#search-close-mobile').click();
        await expect(page.locator('#shortcut-search')).not.toHaveClass(/show/);
    });

    test('the page filter bar is not on a phone', async ({ page }) => {
        await open(page);
        await expect(page.locator('#grid-filter-bar')).toHaveCount(0);
    });

    test('More has a phone guide: what works here, and what needs a desktop', async ({ page }) => {
        await open(page);
        await page.locator('#mobile-tabbar [data-tab="more"]').click();
        await page.locator('#mobile-panel [data-open-guide]').click();
        await expect(page.locator('#mobile-panel')).toContainText('Needs a desktop');
        await expect(page.locator('#mobile-panel')).toContainText('On your phone');
        await expect(page.locator('#mobile-tabbar [data-tab="more"]')).toHaveAttribute('aria-current', 'page');
        await page.locator('#mobile-panel [data-back-more]').click();
        await expect(page.locator('#mobile-panel')).toContainText('Quick settings');
    });

    test('the cheat sheet, from any door, is the phone guide', async ({ page }) => {
        await open(page);
        await page.evaluate(() => window.dashboardInstance.showKeyboardCheatSheet());
        await expect(page.locator('#mobile-panel')).toContainText('Needs a desktop');
        await expect(page.locator('#app-modal.modal-overlay.active')).toHaveCount(0);
        await page.locator('#mobile-tabbar [data-tab="search"]').click();
        await page.locator('#search-input-mobile').pressSequentially(':cheat', { delay: 40 });
        await expect(page.locator('#search-matches')).toContainText('What works on a phone');
    });

    test('typing a bookmark name in the phone search finds the bookmark', async ({ page }) => {
        await open(page);
        const name = await page.evaluate(() => window.dashboardInstance.allBookmarks.find((b) => b.name && b.name.length > 4)?.name);
        await page.locator('#mobile-tabbar [data-tab="search"]').click();
        await page.locator('#search-input-mobile').pressSequentially(name.slice(0, 5), { delay: 40 });
        await expect(page.locator('#search-matches .search-match, #search-matches [data-match-index]').filter({ hasText: name }).first()).toBeVisible({ timeout: 5000 });
    });

    test('the assistant is not offered in the search sheet', async ({ page }) => {
        await open(page);
        await page.locator('#mobile-tabbar [data-tab="search"]').click();
        await expect(page.locator('#shortcut-search .search-mode-tab[data-mode="assistant"]')).toBeHidden();
        await page.locator('#search-input-mobile').pressSequentially(':ask', { delay: 40 });
        await expect(page.locator('#search-matches')).not.toContainText(/assistant/i);
    });

    test('the quick start does not open on a phone; Home says to do it on a desktop', async ({ page }) => {
        await page.route('**/api/settings', async (route) => {
            if (route.request().method() !== 'GET') return route.continue();
            const res = await route.fetch();
            const body = await res.json();
            body.onboardingCompleted = false;
            body.quickStart = { dismissed: false };
            await route.fulfill({ response: res, json: body });
        });
        await page.goto('/');
        await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
        await expect(page.locator('#mobile-home .mobile-notice')).toContainText('quick start on a desktop');
        await expect(page.locator('.start-guide-modal, #start-guide-modal, .start-guide')).toHaveCount(0);
    });

    test('with more than one page a one-time popover says a swipe changes page', async ({ page }) => {
        await page.addInitScript(() => { window.__noop = 1; });
        await open(page);
        await page.evaluate(() => {
            const d = window.dashboardInstance;
            if (!(d.pages.length > 1)) d.pages = [...d.pages, { id: 99, name: 'Second' }];
            window.DiscoverabilityState?.resetSettingPromoSeen?.('mobile-page-swipe-hint-v1', { persist: false });
            window.MobileTabbar.sync();
        });
        await expect(page.locator('#mobile-swipe-hint')).toContainText('Swipe to change page', { timeout: 6000 });
        await page.locator('#mobile-swipe-hint').click();
        await expect(page.locator('#mobile-swipe-hint')).toHaveCount(0);
        await page.evaluate(() => window.MobileTabbar.sync());
        await page.waitForTimeout(2200);
        await expect(page.locator('#mobile-swipe-hint')).toHaveCount(0);
    });

    test('Home leaves the panel and shows the grid again', async ({ page }) => {
        await open(page);
        await page.locator('#mobile-tabbar [data-tab="status"]').click();
        await expect(page.locator('#dashboard-layout')).toBeHidden();
        await page.locator('#mobile-tabbar [data-tab="home"]').click();
        await expect(page.locator('#dashboard-layout')).toBeVisible();
        await expect(page.locator('#mobile-panel')).toHaveCount(0);
    });
});

test.describe('desktop', () => {
    test('has no tab bar and keeps its own search', async ({ page }) => {
        await open(page);
        await expect(page.locator('#mobile-tabbar')).toHaveCount(0);
        await expect(page.locator('#mobile-home')).toHaveCount(0);
        expect(await page.evaluate(() => document.body.hasAttribute('data-mobile-tabbar'))).toBe(false);
        await expect(page.locator('#search-button')).toBeVisible();
    });
});

test.describe('phone: bookmark menu and watched feeds', () => {
    test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

    test('a long press on a bookmark opens a short menu, with Edit and Watch and no keyboard chips', async ({ page }) => {
        await open(page);
        const row = page.locator('#dashboard-layout .bookmark-link:not([data-category-id^="__smart"])').first();
        await row.scrollIntoViewIfNeeded();
        // A real long press: pointer down, hold, no move.
        await row.evaluate((el) => {
            const r = el.getBoundingClientRect();
            el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 7, pointerType: 'touch', isPrimary: true, clientX: r.x + 40, clientY: r.y + r.height / 2, button: 0 }));
        });
        const menu = page.locator('#bookmark-context-menu');
        await expect(menu.first()).toBeVisible({ timeout: 4000 });
        const names = await menu.first().locator('[role="menuitem"]').allTextContents();
        expect(names.join(' ')).toMatch(/Edit/);
        expect(names.join(' ')).toMatch(/Watch/);
        expect(names.join(' ')).not.toMatch(/QR code/);
        expect(names.join(' ')).not.toMatch(/Checking/);
        await expect(menu.first().locator('kbd')).toHaveCount(0);
    });

    test('a long press on an Inbox item and on a Status service opens the short menu too', async ({ page, request }) => {
        const url = `https://example.org/lp-${Date.now()}`;
        const added = await request.post('/api/inbox', { data: { url, title: 'Long press me', source: 'test' }, headers });
        expect(added.ok()).toBe(true);
        const id = (await added.json()).item?.id;
        await open(page);
        await page.evaluate(() => window.dashboardInstance.inbox.refreshBadge?.());
        await page.locator('#mobile-tabbar [data-tab="inbox"]').click();
        const card = page.locator('.inbox-item', { hasText: 'Long press me' }).first();
        await expect(card).toBeVisible({ timeout: 8000 });
        const press = (loc) => loc.evaluate((el) => {
            const r = el.getBoundingClientRect();
            el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 9, pointerType: 'touch', isPrimary: true, clientX: r.x + 30, clientY: r.y + r.height / 2, button: 0 }));
        });
        await press(card);
        await expect(page.locator('#bookmark-context-menu')).toBeVisible({ timeout: 4000 });
        await page.keyboard.press('Escape');
        await expect(page.locator('#bookmark-context-menu')).toHaveCount(0);
        if (id) await request.delete('/api/inbox', { data: { id }, headers }).catch(() => {});

        // Status: a monitored service, as the page would draw it.
        await page.locator('#mobile-tabbar [data-tab="home"]').click();
        await page.evaluate(() => {
            const d = window.dashboardInstance;
            d.allBookmarks[0].monitor = true;
            window.MobileTabbar.openPanel('status');
        });
        const service = page.locator('#mobile-panel .mobile-row[data-bookmark-url]').first();
        await expect(service).toBeVisible();
        await press(service);
        const menu = page.locator('#bookmark-context-menu');
        await expect(menu).toBeVisible({ timeout: 4000 });
        const names = (await menu.locator('[role="menuitem"]').allTextContents()).join(' ');
        expect(names).toMatch(/Watch/);
        expect(names).not.toMatch(/Edit|Delete/);
    });

    test('the edit form fits one screen with thumb-sized fields: Save stays in view, text is 16px', async ({ page }) => {
        await open(page);
        const row = page.locator('#dashboard-layout .bookmark-link:not([data-category-id^="__smart"])').first();
        await row.scrollIntoViewIfNeeded();
        await row.evaluate((el) => {
            const r = el.getBoundingClientRect();
            el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 7, pointerType: 'touch', isPrimary: true, clientX: r.x + 40, clientY: r.y + r.height / 2, button: 0 }));
        });
        await page.locator('#bookmark-context-menu [data-action="edit"]').click();
        const modal = page.locator('#bookmark-form-modal');
        await expect(modal.locator('.bookmark-inline-input').first()).toBeVisible();
        // The form rises in; measure once it has stopped moving.
        await expect.poll(async () => {
            const a = await page.locator('#bookmark-form-modal .bookmark-form-modal-dialog').boundingBox();
            await page.waitForTimeout(150);
            const b = await page.locator('#bookmark-form-modal .bookmark-form-modal-dialog').boundingBox();
            return Math.abs(a.y - b.y) < 0.5 && Math.abs(a.height - b.height) < 0.5;
        }).toBe(true);
        const geometry = await page.evaluate(() => {
            const m = document.querySelector('#bookmark-form-modal');
            const dialog = m.querySelector('.bookmark-form-modal-dialog').getBoundingClientRect();
            const fields = [...m.querySelectorAll('input.bookmark-inline-input, select.bookmark-inline-input')].filter((e) => e.offsetParent);
            const small = fields.filter((e) => e.getBoundingClientRect().height < 44 || parseFloat(getComputedStyle(e).fontSize) < 16).length;
            const save = m.querySelector('.bookmark-inline-save').getBoundingClientRect();
            const close = m.querySelector('.bookmark-form-modal-close').getBoundingClientRect();
            return { dialogH: dialog.height, vh: window.innerHeight, small, saveBottom: save.bottom, saveH: save.height, closeW: close.width, closeTop: close.top };
        });
        expect(geometry.dialogH).toBeLessThanOrEqual(geometry.vh + 1);
        expect(geometry.small).toBe(0);
        expect(geometry.saveBottom).toBeLessThanOrEqual(geometry.vh);
        expect(geometry.saveH).toBeGreaterThanOrEqual(44);
        expect(geometry.closeW).toBeGreaterThanOrEqual(44);
        expect(geometry.closeTop).toBeGreaterThanOrEqual(0);
        // Making pages and categories is for a desktop: no "New…" entries in the selects.
        await expect(modal.locator('option.bookmark-inline-new-option')).toHaveCount(0);
        // The bar is fixed: scrolled to the very end of the form, Save has not moved.
        const before = await page.locator('#bookmark-form-modal .bookmark-inline-save').boundingBox();
        await page.evaluate(() => { document.querySelector('#bookmark-form-modal .bookmark-form-modal-body').scrollTop = 99999; });
        const after = await page.locator('#bookmark-form-modal .bookmark-inline-save').boundingBox();
        expect(Math.round(after.y)).toBe(Math.round(before.y));
        expect(await page.evaluate(() => getComputedStyle(document.querySelector('#bookmark-form-modal .bookmark-inline-actions')).position)).toBe('fixed');
    });

    test('the add / edit form does not pan: nothing scrolls sideways, only the fields scroll, up and down', async ({ page }) => {
        await open(page);
        await page.locator('#mobile-fab').click();
        const modal = page.locator('#bookmark-form-modal');
        await expect(modal.locator('.bookmark-inline-save')).toBeVisible();
        const facts = await page.evaluate(() => {
            const m = document.querySelector('#bookmark-form-modal');
            const body = m.querySelector('.bookmark-form-modal-body');
            const cs = (e, p) => getComputedStyle(e)[p];
            return {
                modalOverflow: cs(m, 'overflowY'),
                modalTouch: cs(m, 'touchAction'),
                bodyTouch: cs(body, 'touchAction'),
                bodyX: cs(body, 'overflowX'),
                headerTouch: cs(m.querySelector('.bookmark-form-modal-header'), 'touchAction'),
                // A classic scrollbar (the test browser has one) takes width from clientWidth: not overflow.
                sideways: body.scrollWidth - body.offsetWidth,
                pageSideways: document.documentElement.scrollWidth - document.documentElement.clientWidth,
            };
        });
        expect(facts.modalOverflow).toBe('hidden');
        expect(facts.modalTouch).toBe('none');
        expect(facts.headerTouch).toBe('none');
        expect(facts.bodyTouch).toBe('pan-y');
        expect(facts.bodyX).toBe('hidden');
        expect(facts.pageSideways).toBeLessThanOrEqual(1);
        // The header and the bar do not move when the fields are scrolled.
        const bar = () => modal.locator('.bookmark-inline-actions').boundingBox();
        const head = () => modal.locator('.bookmark-form-modal-header').boundingBox();
        await page.waitForTimeout(800); // the form has stopped rising in
        const [b0, h0] = [await bar(), await head()];
        await page.evaluate(() => { document.querySelector('#bookmark-form-modal .bookmark-form-modal-body').scrollTop = 500; });
        const [b1, h1] = [await bar(), await head()];
        expect(Math.round(b1.y)).toBe(Math.round(b0.y));
        expect(Math.round(h1.y)).toBe(Math.round(h0.y));
    });

    test('the add form and the edit form have their buttons in the same place, size and style', async ({ page }) => {
        const bar = () => page.evaluate(() => {
            const m = document.querySelector('#bookmark-form-modal');
            const box = (e) => { const r = e.getBoundingClientRect(); return [r.x, r.y, r.width, r.height].map(Math.round); };
            const save = m.querySelector('.bookmark-inline-save');
            const cancel = [...m.querySelectorAll('.bookmark-inline-actions button')].find((b) => /cancel/i.test(b.textContent));
            const actions = m.querySelector('.bookmark-inline-actions');
            const cs = (e) => { const c = getComputedStyle(e); return [c.fontSize, c.borderRadius, c.backgroundColor, c.height].join('|'); };
            return { save: box(save), cancel: box(cancel), bar: box(actions), saveStyle: cs(save), cancelStyle: cs(cancel), label: save.textContent.trim() };
        });
        await open(page);
        await page.locator('#mobile-fab').click();
        await expect(page.locator('#bookmark-form-modal .bookmark-inline-save')).toBeVisible();
        await page.waitForTimeout(700);
        const add = await bar();
        await page.keyboard.press('Escape');
        await page.evaluate(() => document.querySelector('#bookmark-form-modal .bookmark-inline-actions button')?.click());
        await expect(page.locator('#bookmark-form-modal.show')).toHaveCount(0);
        const row = page.locator('#dashboard-layout .bookmark-link:not([data-category-id^="__smart"])').first();
        await row.scrollIntoViewIfNeeded();
        await row.evaluate((el) => {
            const r = el.getBoundingClientRect();
            el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 7, pointerType: 'touch', isPrimary: true, clientX: r.x + 40, clientY: r.y + r.height / 2, button: 0 }));
        });
        await page.locator('#bookmark-context-menu [data-action="edit"]').click();
        await expect(page.locator('#bookmark-form-modal .bookmark-inline-save')).toBeVisible();
        await page.waitForTimeout(700);
        const edit = await bar();
        expect(add.label).toBe(edit.label);
        expect(add.save).toEqual(edit.save);
        expect(add.cancel).toEqual(edit.cancel);
        expect(add.bar).toEqual(edit.bar);
        expect(add.saveStyle.split('|')[0]).toBe(edit.saveStyle.split('|')[0]);
        expect(add.cancelStyle).toBe(edit.cancelStyle);
    });

    test('the new-bookmark form on a phone has Cancel and Save only: no Create + New, no key hint, no New… entries', async ({ page }) => {
        await open(page);
        await page.locator('#mobile-fab').click();
        const modal = page.locator('#bookmark-form-modal');
        await expect(modal.locator('.bookmark-inline-save')).toBeVisible();
        await expect(modal.locator('.bookmark-inline-save')).toHaveText('Save');
        await expect(modal.locator('#bookmark-form-create-another')).toHaveCount(0);
        await expect(modal.locator('.bookmark-inline-hint')).toHaveCount(0);
        await expect(modal.locator('option.bookmark-inline-new-option')).toHaveCount(0);
        const bar = await modal.locator('.bookmark-inline-actions').boundingBox();
        const vh = await page.evaluate(() => window.innerHeight);
        expect(bar.y + bar.height).toBeLessThanOrEqual(vh + 1);
        expect(bar.height).toBeLessThan(90);
    });

    test('the Inbox on a phone: header controls are 44px with 16px fields, the tick box has a 44px target', async ({ page, request }) => {
        const added = await request.post('/api/inbox', { data: { url: `https://example.org/touch-${Date.now()}`, title: 'Touch me', source: 'test' }, headers });
        const id = (await added.json()).item?.id;
        await open(page);
        await page.locator('#mobile-tabbar [data-tab="inbox"]').click();
        await expect(page.locator('.inbox-item', { hasText: 'Touch me' }).first()).toBeVisible({ timeout: 8000 });
        const facts = await page.evaluate(() => {
            const h = (sel) => [...document.querySelectorAll(sel)].filter((e) => e.offsetParent).map((e) => Math.round(e.getBoundingClientRect().height));
            const fs = (sel) => [...document.querySelectorAll(sel)].filter((e) => e.offsetParent).map((e) => parseFloat(getComputedStyle(e).fontSize));
            const check = document.querySelector('.inbox-item-check');
            return {
                actions: h('.inbox-layout .lvs-action'), filters: h('.inbox-layout .lvs-filter'),
                fields: h('.inbox-layout .inbox-domain-select, .inbox-layout .inbox-sort-select, .inbox-layout .inbox-search-input'),
                fieldText: fs('.inbox-layout .inbox-domain-select, .inbox-layout .inbox-sort-select, .inbox-layout .inbox-search-input'),
                check: check && [Math.round(check.getBoundingClientRect().width), Math.round(check.getBoundingClientRect().height)],
                sideways: document.documentElement.scrollWidth - document.documentElement.clientWidth,
            };
        });
        for (const n of [...facts.actions, ...facts.filters, ...facts.fields]) expect(n).toBeGreaterThanOrEqual(44);
        for (const n of facts.fieldText) expect(n).toBeGreaterThanOrEqual(16);
        expect(facts.check).toEqual([44, 44]);
        expect(facts.sideways).toBeLessThanOrEqual(1);
        if (id) await request.delete('/api/inbox', { data: { id }, headers }).catch(() => {});
    });

    test('Status opens the news of the feeds you watch', async ({ page }) => {
        await open(page);
        await page.evaluate(() => {
            const w = window.dashboardInstance.feedWatch;
            w.byKey = new Map([['k', { feeds: [{ feedUrl: 'http://x/', paused: false }], newCount: 2 }]]);
            w.totalNew = () => 2;
            window.FeedWatchNews.__opened = 0;
            const real = window.FeedWatchNews.open;
            window.FeedWatchNews.open = () => { window.FeedWatchNews.__opened += 1; };
            window.FeedWatchNews.__real = real;
        });
        await page.locator('#mobile-tabbar [data-tab="status"]').click();
        await expect(page.locator('#mobile-panel')).toContainText('2 unread');
        await page.locator('#mobile-panel [data-open-news]').click();
        expect(await page.evaluate(() => window.FeedWatchNews.__opened)).toBe(1);
    });
});
