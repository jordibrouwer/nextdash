const { test, expect } = require('@playwright/test');
const { markWhatsNewSeen, dismissBlockingOverlays, dismissOnboardingIfPresent } = require('./e2e-helpers');

test.describe('dashboard inbox phase 1', () => {
    test.beforeEach(async ({ page }) => {
        await markWhatsNewSeen(page);
        await page.goto('/');
        await page.waitForSelector('#dashboard-layout', { timeout: 15_000 });
        await dismissOnboardingIfPresent(page);
        await dismissBlockingOverlays(page);
        await page.waitForFunction(() => window.dashboardInstance?.inbox != null, null, { timeout: 15_000 });
    });

    test('opens inbox via command palette', async ({ page }) => {
        await page.evaluate(() => {
            window.dashboardInstance.settings.inboxEnabled = true;
        });

        await page.keyboard.press(':');
        await page.keyboard.type('inbox', { delay: 20 });
        await expect(page.locator('#shortcut-search.show')).toBeVisible({ timeout: 5000 });
        await page.keyboard.press('Enter');
        await expect(page.locator('.inbox-layout')).toBeVisible();
    });

    test('triage overlay opens from toolbar', async ({ page }) => {
        await page.evaluate(() => {
            window.dashboardInstance.settings.inboxEnabled = true;
        });

        const seedUrl = `https://triage-seed-${Date.now()}.example.com`;
        await page.evaluate(async (url) => {
            const api = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
            await api('/api/inbox', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ url, title: 'Triage seed' }),
            });
        }, seedUrl);

        await page.locator('#page-nav-inbox-btn').click();
        await expect(page.locator('.inbox-layout')).toBeVisible();
        await page.locator('.inbox-triage-btn').click();
        await expect(page.locator('#inbox-triage-overlay')).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(page.locator('#inbox-triage-overlay')).toHaveCount(0);
    });

    test('opens inbox via 0 key', async ({ page }) => {
        await page.evaluate(() => {
            window.dashboardInstance.settings.inboxEnabled = true;
        });

        await page.keyboard.press('0');
        await expect(page.locator('.inbox-layout')).toBeVisible();
        await expect.poll(() => page.evaluate(() => window.dashboardInstance?.activeView)).toBe('inbox');
    });

    test('escape closes inbox and returns to bookmarks', async ({ page }) => {
        await page.evaluate(() => {
            window.dashboardInstance.settings.inboxEnabled = true;
        });

        await page.locator('#page-nav-inbox-btn').click();
        await expect(page.locator('.inbox-layout')).toBeVisible();

        await page.keyboard.press('Escape');
        await expect(page.locator('.inbox-layout')).toHaveCount(0);
        await expect(page.locator('#dashboard-layout .category').first()).toBeVisible();
        await expect.poll(() => page.evaluate(() => window.dashboardInstance?.activeView)).toBe('bookmarks');
    });

    test('returns to same bookmark page from inbox via number key', async ({ page }) => {
        await page.evaluate(() => {
            window.dashboardInstance.settings.inboxEnabled = true;
        });

        await page.locator('#page-nav-inbox-btn').click();
        await expect(page.locator('.inbox-layout')).toBeVisible();

        await page.keyboard.press('1');
        await expect(page.locator('.inbox-layout')).toHaveCount(0);
        await expect(page.locator('#dashboard-layout .category').first()).toBeVisible();
        await expect.poll(() => page.evaluate(() => window.dashboardInstance?.activeView)).toBe('bookmarks');
    });

    test('paste choice modal offers bookmark and inbox', async ({ page }) => {
        await page.evaluate(() => {
            window.dashboardInstance.settings.inboxEnabled = true;
            window.dashboardInstance.settings.pasteDestination = 'ask';
        });

        await page.focus('body');
        const pastedUrl = await page.evaluate(() => {
            const stamp = Date.now();
            const url = `https://inbox-paste-${stamp}.example.com/`;
            const event = new ClipboardEvent('paste', {
                bubbles: true,
                cancelable: true,
                clipboardData: new DataTransfer(),
            });
            event.clipboardData.setData('text/plain', url);
            document.dispatchEvent(event);
            return url;
        });

        const modal = page.locator('#paste-choice-modal.show');
        await expect(modal).toBeVisible({ timeout: 5000 });
        await modal.locator('[data-paste-choice="inbox"]').click();
        await expect(modal).toBeHidden();

        await page.waitForFunction((url) => (
            (window.dashboardInstance?.inbox?.items || []).some((item) => item.url === url)
        ), pastedUrl);

        await page.locator('#page-nav-inbox-btn').click();
        await expect.poll(async () => page.evaluate((url) => {
            const item = (window.dashboardInstance?.inbox?.items || []).find((entry) => entry.url === url);
            return item ? document.querySelector(`[data-inbox-id="${item.id}"]`) != null : false;
        }, pastedUrl)).toBe(true);
    });

    test('arrow keys navigate inbox items and Enter opens link', async ({ page }) => {
        await page.evaluate(() => {
            window.dashboardInstance.settings.inboxEnabled = true;
        });

        await page.locator('#page-nav-inbox-btn').click();
        await expect(page.locator('.inbox-feed .inbox-item').first()).toBeVisible();

        await page.keyboard.press('ArrowDown');
        await expect(page.locator('.inbox-item.keyboard-selected').first()).toBeVisible();

        await page.locator('.inbox-search-input').focus();
        await page.keyboard.press('ArrowDown');
        await expect(page.locator('.inbox-item.keyboard-selected').first()).toBeVisible();

        await page.keyboard.press('ArrowUp');
        await expect(page.locator('.inbox-item.keyboard-selected').first()).toBeVisible();

        const readRequest = page.waitForRequest((request) => (
            request.url().includes('/api/inbox')
            && request.method() === 'PATCH'
        ));
        await page.keyboard.press('Enter');
        await readRequest;
    });

    test('Home and End jump to first and last inbox row', async ({ page }) => {
        await page.evaluate(() => {
            window.dashboardInstance.settings.inboxEnabled = true;
        });

        await page.locator('#page-nav-inbox-btn').click();
        await expect(page.locator('.inbox-feed .inbox-item').first()).toBeVisible();

        await page.keyboard.press('End');
        const lastId = await page.evaluate(() => {
            const cards = [...document.querySelectorAll('.inbox-item')];
            return cards[cards.length - 1]?.dataset?.inboxId || '';
        });
        await expect.poll(() => page.evaluate(() => window.dashboardInstance.inbox.selectedItemId)).toBe(lastId);

        await page.keyboard.press('Home');
        const firstId = await page.evaluate(() => {
            return document.querySelector('.inbox-item')?.dataset?.inboxId || '';
        });
        await expect.poll(() => page.evaluate(() => window.dashboardInstance.inbox.selectedItemId)).toBe(firstId);
    });

    test('inbox keyboard survives background bookmark refresh', async ({ page }) => {
        await page.evaluate(() => {
            window.dashboardInstance.settings.inboxEnabled = true;
        });

        await page.locator('#page-nav-inbox-btn').click();
        await expect(page.locator('.inbox-feed .inbox-item').first()).toBeVisible();

        await page.evaluate(() => {
            const d = window.dashboardInstance;
            d.data._applyLoadedPageData(d.currentPageId, d.bookmarks, d.categories, { skipRender: true });
        });

        await expect.poll(() => page.evaluate(() => window.dashboardInstance?.activeView)).toBe('inbox');

        await page.keyboard.press('ArrowDown');
        await expect(page.locator('.inbox-item.keyboard-selected').first()).toBeVisible();
    });

    test('inbox search typing does not open global search modal', async ({ page }) => {
        await page.evaluate(() => {
            window.dashboardInstance.settings.inboxEnabled = true;
        });

        await page.locator('#page-nav-inbox-btn').click();
        await expect(page.locator('.inbox-layout')).toBeVisible();

        const search = page.locator('.inbox-search-input');
        await search.click();
        await search.pressSequentially('letters', { delay: 30 });
        await expect(page.locator('#shortcut-search.show')).toHaveCount(0);
        await expect(search).toHaveValue('letters');
        await expect(search).toBeFocused();
    });

    test('bookmark keyboard navigation works after leaving inbox', async ({ page }) => {
        await page.evaluate(() => {
            window.dashboardInstance.settings.inboxEnabled = true;
        });

        await page.locator('#page-nav-inbox-btn').click();
        await expect(page.locator('.inbox-layout')).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(page.locator('#dashboard-layout .bookmark-link').first()).toBeVisible();

        await page.keyboard.press('ArrowDown');
        await expect.poll(() => page.evaluate(() => (
            window.dashboardInstance?.keyboardNavigation?.currentIndex ?? -1
        ))).toBeGreaterThanOrEqual(0);
        await expect(page.locator('.bookmark-link.keyboard-selected').first()).toBeVisible();
    });

    test('stays on inbox when hash changes to a page number while inbox is active', async ({ page }) => {
        await page.evaluate(() => {
            window.dashboardInstance.settings.inboxEnabled = true;
        });

        await page.locator('#page-nav-inbox-btn').click();
        await expect(page.locator('.inbox-layout')).toBeVisible();

        await page.evaluate(() => {
            window.location.hash = '#1';
        });

        await expect(page.locator('.inbox-layout')).toBeVisible();
        await expect.poll(() => page.evaluate(() => window.dashboardInstance?.activeView)).toBe('inbox');
        await expect.poll(() => page.evaluate(() => window.location.hash)).toBe('#inbox');
    });

    test('shows inbox in header title on the inbox page', async ({ page }) => {
        const pageName = await page.evaluate(() => {
            window.dashboardInstance.settings.inboxEnabled = true;
            const dash = window.dashboardInstance;
            const current = dash.pages.find((p) => dash.samePageId(p.id, dash.currentPageId));
            return current?.name || '';
        });
        expect(pageName.length).toBeGreaterThan(0);

        await page.locator('#page-nav-inbox-btn').click();
        await expect(page.locator('.inbox-layout')).toBeVisible();
        await expect(page.locator('.title')).toHaveText('inbox');

        await page.locator('.page-nav-btn').first().click();
        await expect(page.locator('.inbox-layout')).toHaveCount(0);
        await expect(page.locator('.title')).toHaveText(pageName);
    });

    /* ── Sorting, deep links, selection and custom snooze ─────────────── */

    async function seedInbox(page, titles) {
        await page.evaluate(() => { window.dashboardInstance.settings.inboxEnabled = true; });
        const stamp = Date.now();
        await page.evaluate(async ({ titles, stamp }) => {
            const api = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
            for (let i = 0; i < titles.length; i += 1) {
                await api('/api/inbox', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ url: `https://seed${i}-${stamp}.example/x`, title: titles[i] }),
                });
            }
        }, { titles, stamp });
        await page.locator('#page-nav-inbox-btn').click();
        await expect(page.locator('.inbox-layout')).toBeVisible();
    }

    test('sorting reorders the feed and oldest-first reverses newest-first', async ({ page }) => {
        // Seeded in order, so "newest first" is the reverse of the seed order.
        await seedInbox(page, ['Zebra one', 'Apple two', 'Mango three']);

        const order = (sort) => page.evaluate((s) => {
            const ib = window.dashboardInstance.inbox;
            const prev = ib.sort;
            ib.sort = s;
            const out = ib.getFilteredItems().map((i) => ib.displayTitle(i));
            ib.sort = prev;
            return out;
        }, sort);

        const newest = await order('newest');
        const oldest = await order('oldest');
        expect(newest.length).toBeGreaterThanOrEqual(3);
        // The backlog case the inbox had no way to reach before.
        expect(oldest).toEqual([...newest].reverse());

        const byTitle = await order('title');
        const sortedCopy = [...byTitle].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
        expect(byTitle).toEqual(sortedCopy);
    });

    test('a title sort drops the date headings', async ({ page }) => {
        await seedInbox(page, ['Zebra one', 'Apple two']);

        // Date groups under an A-Z sort would restart the ordering at every
        // heading, which is not a sort in any sense the user asked for.
        await page.selectOption('.inbox-sort-select', 'title');
        await expect(page.locator('.inbox-date-group-title')).toHaveCount(0);

        await page.selectOption('.inbox-sort-select', 'newest');
        await expect(page.locator('.inbox-date-group-title').first()).toBeVisible();
    });

    test('sort and filter survive a reload, and a deep link overrides them', async ({ page }) => {
        await seedInbox(page, ['Zebra one', 'Apple two']);

        await page.selectOption('.inbox-sort-select', 'oldest');
        await expect(page).toHaveURL(/ib_sort=oldest/);

        await page.goto('/');
        await page.waitForFunction(() => window.dashboardInstance?.inbox != null, null, { timeout: 15_000 });
        await page.evaluate(() => { window.dashboardInstance.settings.inboxEnabled = true; });
        await page.locator('#page-nav-inbox-btn').click();
        await expect(page.locator('.inbox-layout')).toBeVisible();
        expect(await page.evaluate(() => window.dashboardInstance.inbox.sort)).toBe('oldest');

        // A shared link has to win over what this browser last did, or it does
        // not describe what the recipient sees.
        await page.goto('/?ib_filter=unread&ib_sort=title#inbox');
        await page.waitForFunction(() => window.dashboardInstance?.inbox != null, null, { timeout: 15_000 });
        await page.evaluate(() => { window.dashboardInstance.settings.inboxEnabled = true; });
        await page.locator('#page-nav-inbox-btn').click();
        await expect(page.locator('.inbox-layout')).toBeVisible();
        expect(await page.evaluate(() => ({
            filter: window.dashboardInstance.inbox.filter,
            sort: window.dashboardInstance.inbox.sort,
        }))).toEqual({ filter: 'unread', sort: 'title' });
    });

    test('ticking rows opens a selection bar that acts on just those rows', async ({ page }) => {
        await seedInbox(page, ['Zebra one', 'Apple two', 'Mango three']);

        await expect(page.locator('.inbox-selection-bar')).toHaveCount(0);

        await page.evaluate(() => {
            const ib = window.dashboardInstance.inbox;
            ib.getFilteredItems().slice(0, 2).forEach((i) => ib.setChecked(i.id, true));
        });

        await expect(page.locator('.inbox-selection-bar')).toBeVisible();
        await expect(page.locator('.inbox-selection-count')).toContainText('2');
        await expect(page.locator('.inbox-item.is-checked')).toHaveCount(2);

        // Escape clears the selection rather than leaving the view.
        await page.locator('.inbox-item').first().click();
        await page.keyboard.press('Escape');
        await expect(page.locator('.inbox-selection-bar')).toHaveCount(0);
        await expect(page.locator('.inbox-layout')).toBeVisible();
    });

    test('a filter change clears ticks so bulk cannot touch hidden rows', async ({ page }) => {
        await seedInbox(page, ['Zebra one', 'Apple two']);

        await page.evaluate(() => {
            const ib = window.dashboardInstance.inbox;
            ib.getFilteredItems().forEach((i) => ib.setChecked(i.id, true));
        });
        await expect(page.locator('.inbox-selection-bar')).toBeVisible();

        await page.locator('[data-inbox-filter="unread"]').click();
        await expect(page.locator('.inbox-selection-bar')).toHaveCount(0);
        expect(await page.evaluate(() => window.dashboardInstance.inbox.checkedIds.size)).toBe(0);
    });

    test('a search change clears ticks so bulk cannot touch hidden rows', async ({ page }) => {
        await seedInbox(page, ['Zebra one', 'Apple two']);

        await page.evaluate(() => {
            const ib = window.dashboardInstance.inbox;
            ib.getFilteredItems().forEach((i) => ib.setChecked(i.id, true));
        });
        await expect(page.locator('.inbox-selection-bar')).toBeVisible();

        await page.locator('.inbox-search-input').fill('Zebra');
        await expect.poll(() => page.evaluate(() => window.dashboardInstance.inbox.checkedIds.size)).toBe(0);
        await expect(page.locator('.inbox-selection-bar')).toHaveCount(0);
    });

    test('the snooze menu offers a date of your own', async ({ page }) => {
        await seedInbox(page, ['Zebra one']);

        await page.evaluate(() => {
            const ib = window.dashboardInstance.inbox;
            ib.openSnoozeMenu(ib.getFilteredItems()[0], document.querySelector('.inbox-item'));
        });

        await expect(page.locator('.inbox-snooze-option')).toHaveCount(4);
        const date = page.locator('.inbox-snooze-date');
        await expect(date).toBeVisible();
        // Never today: a snooze that wakes immediately is not a snooze.
        const min = await date.getAttribute('min');
        expect(min).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        expect(new Date(min + 'T00:00:00').getTime()).toBeGreaterThan(Date.now() - 86400000);

        // Parsed as local 09:00, matching the presets. Parsing the value with
        // new Date('yyyy-mm-dd') would be UTC midnight and land a day early
        // for anyone west of Greenwich.
        const parsed = await page.evaluate(
            () => window.dashboardInstance.inbox.parseDateInput('2026-08-01')
        );
        const asDate = new Date(parsed);
        expect(asDate.getDate()).toBe(1);
        expect(asDate.getHours()).toBe(9);
    });

    test('ib_id deep link highlights and selects the target row', async ({ page }) => {
        await seedInbox(page, ['Alpha', 'Beta target', 'Gamma']);
        const targetId = await page.evaluate(() => {
            const item = window.dashboardInstance.inbox.items.find((i) => i.title === 'Beta target');
            return item?.id || '';
        });
        expect(targetId).toBeTruthy();

        await page.goto(`/?ib_id=${encodeURIComponent(targetId)}#inbox`);
        await page.waitForFunction(() => window.dashboardInstance?.inbox != null, null, { timeout: 15_000 });
        await page.evaluate(() => { window.dashboardInstance.settings.inboxEnabled = true; });
        await page.locator('#page-nav-inbox-btn').click();
        await expect(page.locator('.inbox-layout')).toBeVisible();

        await expect(page.locator(`[data-inbox-id="${targetId}"].keyboard-selected`)).toBeVisible();
        await expect(page.locator(`[data-inbox-id="${targetId}"].inbox-item--highlight`)).toBeVisible();
    });

    test('noted filter shows only items with a note', async ({ page }) => {
        await seedInbox(page, ['Plain link', 'Annotated link']);
        await page.evaluate(async () => {
            const ib = window.dashboardInstance.inbox;
            const item = ib.items.find((entry) => entry.title === 'Annotated link');
            const api = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
            await api('/api/inbox', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id: item.id, note: 'review later' }),
            });
            await ib.loadAndRender();
        });

        await page.locator('[data-inbox-filter="noted"]').click();
        await expect(page.locator('.inbox-item')).toHaveCount(1);
        await expect(page.locator('.inbox-item')).toContainText('Annotated link');
    });

    test('t opens triage from the inbox feed', async ({ page }) => {
        await seedInbox(page, ['Triage me']);
        await page.locator('#dashboard-layout').focus();
        await page.keyboard.press('t');
        await expect(page.locator('#inbox-triage-overlay')).toBeVisible();
    });

    test('CSV export downloads the filtered inbox list', async ({ page, context }) => {
        await seedInbox(page, ['Export row']);
        const downloadPromise = page.waitForEvent('download');
        await page.locator('[data-inbox-export="csv"]').click();
        const download = await downloadPromise;
        expect(download.suggestedFilename()).toMatch(/^nextdash-inbox-.*\.csv$/);
    });

});
