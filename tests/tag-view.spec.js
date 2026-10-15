// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * The tag view: a tag's bookmarks from every page, in a view of their own.
 *
 * Picking a tag used to turn the dashboard grid into a filter mode with a row
 * of buttons over it. Now it opens #tag/<tag> -- a header with what the set
 * adds up to, a rail of related tags, pages and health, and a table -- and
 * Escape, the home icon or Back return to the page you came from.
 */

const STAMP = Date.now();
const TAG = `tvalpha${STAMP}`;
const TAG_B = `tvbeta${STAMP}`;

async function openDashboard(page, path = '/') {
    await page.setViewportSize({ width: 1500, height: 950 });
    await markWhatsNewSeen(page);
    await page.addInitScript(() => {
        localStorage.setItem('nextdash:dashboard-tag-filter-bulk-promo-confirmed-v1', '1');
        localStorage.setItem('nextdash:dashboard-tag-cloud-promo-confirmed-v1', '1');
    });
    await page.goto(path);
    // A goto that only changes the hash is not a load; an address with a hash
    // is meant as an arrival, so make it one.
    if (path !== '/') await page.reload();
    await page.waitForSelector('#dashboard-layout', { timeout: 20_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.waitForFunction(() => window.dashboardInstance?._bookmarksReady === true, null, { timeout: 20_000 });
}

/**
 * Two pages: the current one and "Tag view other". Returns their ids. Every
 * bookmark is a { url, name?, tags, page: 'here' | 'other', openCount?, lastOpened? }.
 */
async function seed(page, bookmarks) {
    return page.evaluate(async (rows) => {
        const d = window.dashboardInstance;
        const api = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
        const list = await (await api('/api/pages')).json();
        let other = list.find((p) => p.name === 'Tag view other');
        if (!other) {
            other = { id: Math.max(...list.filter((p) => p.id < 999999).map((p) => p.id)) + 1, name: 'Tag view other' };
            await api('/api/pages', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify([...list, other]) });
        }
        const here = Number(d.currentPageId);
        for (const row of rows) {
            const { page: where, ...bookmark } = row;
            await api('/api/bookmarks/add', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ page: where === 'other' ? other.id : here, bookmark: { name: bookmark.name || bookmark.url, ...bookmark } }),
            });
        }
        Object.assign(d.settings, { showTagCloudButton: true, actionBarPosition: 'header', maxHeaderActions: 8 });
        await d.saveSettings?.();
        return { here, other: Number(other.id), otherName: other.name };
    }, bookmarks);
}

const view = (page) => page.locator('#dashboard-layout .lvs.tag-view');
const rowNames = (page) => page.locator('#dashboard-layout .tag-view-row .tag-view-name').allInnerTexts();
const hash = (page) => page.evaluate(() => decodeURIComponent(location.hash));
const currentPage = (page) => page.evaluate(() => Number(window.dashboardInstance.currentPageId));

async function pickInCloud(page, tag) {
    await page.locator('body').click({ position: { x: 5, y: 5 } });
    await page.keyboard.press('/');
    const chip = page.locator(`#tag-cloud-modal .tag-cloud-word[data-tag="${tag}"]`);
    await expect(chip).toBeVisible();
    await chip.click();
}

test.describe('getting there and back', () => {
    let ids;
    test.beforeEach(async ({ page }) => {
        await openDashboard(page);
        ids = await seed(page, [
            { url: `https://tv-a-${STAMP}.example.com/`, name: 'TV here', tags: [TAG], page: 'here' },
            { url: `https://tv-b-${STAMP}.example.com/`, name: 'TV elsewhere', tags: [TAG, TAG_B], page: 'other' },
        ]);
        await openDashboard(page);
    });

    test('a pick in the cloud opens the view at #tag/<tag>', async ({ page }) => {
        await pickInCloud(page, TAG);
        await expect(view(page)).toBeVisible();
        await expect.poll(() => hash(page)).toBe(`#tag/${TAG}`);
        await expect.poll(() => rowNames(page)).toEqual(expect.arrayContaining(['TV here', 'TV elsewhere']));
        await expect(page.locator('#dashboard-layout .category')).toHaveCount(0);
    });

    test('t on a selected row opens the view', async ({ page }) => {
        await page.evaluate((url) => {
            const kn = window.dashboardInstance.keyboardNavigation;
            kn.updateNavigableElements();
            const i = kn.navigableElements.findIndex((el) => el.querySelector?.(`a[href="${url}"]`) || el.getAttribute?.('href') === url);
            kn.currentIndex = i;
            kn.highlightCurrentElement();
        }, `https://tv-a-${STAMP}.example.com/`);
        await page.keyboard.press('t');
        await expect(view(page)).toBeVisible();
        await expect.poll(() => hash(page)).toBe(`#tag/${TAG}`);
    });

    test(':filter <tag> opens the view', async ({ page }) => {
        await page.locator('body').click({ position: { x: 5, y: 5 } });
        await page.keyboard.press(':');
        await page.keyboard.type(`filter ${TAG}`);
        await page.keyboard.press('Enter');
        await expect(view(page)).toBeVisible();
        await expect.poll(() => hash(page)).toBe(`#tag/${TAG}`);
    });

    test('Escape, the home icon and Back return to the page it was opened from', async ({ page }) => {
        // Opened from the other page, it goes back there -- not to page 1.
        await page.evaluate((id) => window.dashboardInstance.loadPageBookmarks(id), ids.other);
        await expect.poll(() => currentPage(page)).toBe(ids.other);

        await pickInCloud(page, TAG);
        await expect(view(page)).toBeVisible();
        await page.locator('body').click({ position: { x: 5, y: 5 } });
        await page.keyboard.press('Escape');
        await expect(view(page)).toHaveCount(0);
        await expect.poll(() => currentPage(page)).toBe(ids.other);
        await expect(page.locator('#dashboard-layout .category').first()).toBeVisible();

        await pickInCloud(page, TAG);
        await expect(view(page)).toBeVisible();
        await page.locator('#dashboard-home-link').click();
        await expect(view(page)).toHaveCount(0);
        await expect.poll(() => currentPage(page)).toBe(ids.other);

        await pickInCloud(page, TAG);
        await expect(view(page)).toBeVisible();
        await page.goBack();
        await expect(view(page)).toHaveCount(0);
        await expect.poll(() => currentPage(page)).toBe(ids.other);
    });

    /*
     * The pointer rests on a row and the view opens before the hover delay is
     * up. The row goes without a mouseleave, so its timer still fired and the
     * card of a bookmark no longer on screen opened over the tag view, and
     * stayed there.
     */
    test('a row hovered as the view opens leaves no preview card over it', async ({ page }) => {
        await page.evaluate(() => {
            const d = window.dashboardInstance;
            Object.assign(d.settings, { linkPreviewMode: 'hover', showLinkPreviewCards: true, linkPreviewHoverDelayMs: 250 });
            d.renderDashboard({ animate: false, forceFull: true });
        });
        const link = page.locator(`#dashboard-layout a.bookmark-open[href="https://tv-a-${STAMP}.example.com/"]`).first();
        await page.evaluate((url) => {
            const kn = window.dashboardInstance.keyboardNavigation;
            kn.updateNavigableElements();
            kn.currentIndex = kn.navigableElements.findIndex((el) => el.querySelector?.(`a[href="${url}"]`) || el.getAttribute?.('href') === url);
            kn.highlightCurrentElement();
        }, `https://tv-a-${STAMP}.example.com/`);
        await link.hover();
        await page.keyboard.press('t');
        await expect(view(page)).toBeVisible();
        // Past the hover delay and the preview fetch.
        await page.waitForTimeout(1_500);
        await expect(page.locator('#bookmark-preview-card.is-visible')).toHaveCount(0);
    });
});

test('a cold load on #tag/<tag> shows bookmarks from every page', async ({ page }) => {
    await openDashboard(page);
    await seed(page, [{ url: `https://tv-cold-${STAMP}.example.com/`, name: 'TV cold', tags: [`${TAG}cold`], page: 'other' }]);
    // Nothing that loads other pages at startup.
    await page.evaluate(async () => {
        const d = window.dashboardInstance;
        Object.assign(d.settings, {
            showTagCloudButton: false, globalShortcuts: false, showTagCollections: false,
            showSmartRecentCollection: false, showSmartStaleCollection: false,
            showSmartMostUsedCollection: false, showSmartTodayCollection: false,
        });
        await d.saveSettings?.();
    });
    await openDashboard(page, `/#tag/${TAG}cold`);
    await expect(view(page)).toBeVisible();
    await expect.poll(() => rowNames(page)).toContain('TV cold');
});

test('a tag holding + or / survives the address', async ({ page }) => {
    await openDashboard(page);
    await seed(page, [{ url: `https://tv-plus-${STAMP}.example.com/`, name: 'TV plus', tags: [`c++${STAMP}`, 'a/b'], page: 'here' }]);
    await openDashboard(page, `/#tag/${encodeURIComponent(`c++${STAMP}`)}+${encodeURIComponent('a/b')}`);
    await expect(view(page)).toBeVisible();
    await expect.poll(() => page.evaluate(() => [...window.dashboardInstance._tagFilters])).toEqual(['a/b', `c++${STAMP}`].sort());
    await expect.poll(() => rowNames(page)).toContain('TV plus');
});

async function openTagView(page, tags) {
    await page.evaluate((t) => window.dashboardInstance.setTagFilters(t), tags);
    await expect(view(page)).toBeVisible();
}

const tagsOn = (page, url) => page.evaluate(async (u) => {
    const all = await (await fetch('/api/bookmarks?all=true')).json();
    return (all.find((b) => b.url === u) || {}).tags || null;
}, url);

test.describe('the header', () => {
    // Fresh per test: the tests in a file share one data directory, and a
    // merge or remove in one left the next one's seed refused as duplicates.
    let H; let H2; let N;
    let ids;
    test.beforeEach(async ({ page }) => {
        N = `${STAMP}${Math.random().toString(36).slice(2, 7)}`;
        H = `tvhead${N}`;
        H2 = `tvhead2${N}`;
        await openDashboard(page);
        ids = await seed(page, [
            { url: `https://tvh-1-${N}.example.com/`, name: 'Head one', tags: [H], page: 'here', openCount: 9, lastOpened: Date.now() - 3600_000 },
            { url: `https://tvh-2-${N}.example.com/`, name: 'Head two', tags: [H, H2], page: 'other', openCount: 2 },
            { url: `https://tvh-3-${N}.example.com/`, name: 'Head three', tags: [H2], page: 'other' },
        ]);
        await openDashboard(page);
    });

    test('names the tag and says what the set adds up to', async ({ page }) => {
        await openTagView(page, [H]);
        await expect(page.locator('.tag-view .tag-view-title')).toHaveText(`#${H}`);
        const stats = page.locator('.tag-view .tag-view-stats');
        await expect(stats).toContainText('2 bookmarks');
        await expect(stats).toContainText('on 2 pages');
        await expect(stats).toContainText('Head one');
        await expect(page.locator('.tag-view .lvs-crumb')).toContainText('from');
    });

    test('several tags are pills; × takes one away', async ({ page }) => {
        await openTagView(page, [H, H2]);
        const pills = page.locator('.tag-view .tag-view-pill');
        await expect(pills).toHaveCount(2);
        await pills.filter({ hasText: H2 }).locator('.tag-view-pill-x').click();
        await expect.poll(() => hash(page)).toBe(`#tag/${H}`);
        await expect(page.locator('.tag-view .tag-view-title')).toHaveText(`#${H}`);
        await expect(pills).toHaveCount(0);
    });

    test('another tag is added from the header, without the cloud', async ({ page }) => {
        await openTagView(page, [H]);
        await page.locator('.tag-view [data-tag-view-add]').click();
        const input = page.locator('.tag-view input[data-tag-view-add-input]');
        await expect(input).toBeFocused();
        await input.fill(H2.slice(0, -3));
        // Suggestions are tags in use, minus the ones already on.
        const option = page.locator('.tag-view-add-suggestions [data-tag]', { hasText: H2 });
        await expect(option).toBeVisible();
        await expect(page.locator('.tag-view-add-suggestions [data-tag]', { hasText: new RegExp(`^${H}$`) })).toHaveCount(0);
        await input.press('Enter');
        await expect.poll(() => hash(page)).toBe(`#tag/${[H, H2].sort().join('+')}`);
        await expect.poll(async () => (await rowNames(page)).sort()).toEqual(['Head one', 'Head three', 'Head two']);
        await expect(page.locator('#tag-cloud-modal')).toBeHidden();
    });

    test('Open all over the tab limit offers the first ones or all of them', async ({ page }) => {
        const many = `tvmany${N}`;
        await seed(page, Array.from({ length: 16 }, (_, i) => ({ url: `https://tvm-${i}-${N}.example.com/`, tags: [many], page: 'here' })));
        await openDashboard(page);
        await openTagView(page, [many]);
        const actions = page.locator('.tag-view .lvs-header-actions');
        await expect(actions.getByRole('button', { name: 'Open first 15 of 16' })).toBeVisible();
        await expect(actions.getByRole('button', { name: 'Open all 16' })).toBeVisible();
    });

    test('Copy links copies the bookmarks shown', async ({ page }) => {
        await openTagView(page, [H]);
        await page.evaluate(() => {
            window.__copied = null;
            navigator.clipboard.writeText = async (text) => { window.__copied = text; };
        });
        await page.locator('.tag-view .lvs-header-actions').getByRole('button', { name: 'Copy links' }).click();
        await expect.poll(() => page.evaluate(() => (window.__copied || '').split('\n').sort())).toEqual(
            [`https://tvh-1-${N}.example.com/`, `https://tvh-2-${N}.example.com/`].sort()
        );
    });

    test('Manage tag: rename follows the new name, and undo brings the old one back', async ({ page }) => {
        await openTagView(page, [H]);
        await page.locator('.tag-view [data-tag-view-manage]').click();
        await page.locator('.tag-view-manage-menu [data-manage="rename"]').click();
        await page.locator('#app-modal input[data-tag-rename]').fill(`${H}new`);
        await page.locator('#modal-actions').getByRole('button', { name: 'Rename' }).click();
        await expect.poll(() => hash(page)).toBe(`#tag/${H}new`);
        await expect.poll(() => rowNames(page)).toEqual(expect.arrayContaining(['Head one', 'Head two']));
        expect(await tagsOn(page, `https://tvh-1-${N}.example.com/`)).toEqual([`${H}new`]);
        await page.locator('.app-notification', { hasText: 'Tag renamed' }).locator('.app-notification-action').click();
        await expect.poll(() => tagsOn(page, `https://tvh-1-${N}.example.com/`)).toEqual([H]);
    });

    test('Manage tag: merge moves the bookmarks onto the other tag', async ({ page }) => {
        await openTagView(page, [H]);
        await page.locator('.tag-view [data-tag-view-manage]').click();
        await page.locator('.tag-view-manage-menu [data-manage="merge"]').click();
        await page.locator('#app-modal select[data-tag-merge]').selectOption(H2);
        await page.locator('#modal-actions').getByRole('button', { name: 'Merge' }).click();
        await expect.poll(() => hash(page)).toBe(`#tag/${H2}`);
        await expect.poll(async () => (await rowNames(page)).sort()).toEqual(['Head one', 'Head three', 'Head two']);
    });

    test('Manage tag: remove takes it off every bookmark and leaves the view', async ({ page }) => {
        await openTagView(page, [H]);
        await page.locator('.tag-view [data-tag-view-manage]').click();
        await page.locator('.tag-view-manage-menu [data-manage="remove"]').click();
        await page.locator('#modal-actions').getByRole('button', { name: 'Remove' }).click();
        await expect(view(page)).toHaveCount(0);
        await expect.poll(() => tagsOn(page, `https://tvh-2-${N}.example.com/`)).toEqual([H2]);
        await expect.poll(() => currentPage(page)).toBe(ids.here);
    });

    test('a tag whose bookmarks are gone shows a way back, not an error', async ({ page }) => {
        const errors = [];
        page.on('pageerror', (e) => errors.push(e.message));
        const lone = `tvlone${N}`;
        await seed(page, [{ url: `https://tvl-${N}.example.com/`, tags: [lone], page: 'here' }]);
        await openDashboard(page);
        await openTagView(page, [lone]);
        await page.evaluate(async (u) => {
            const d = window.dashboardInstance;
            const api = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
            await api('/api/bookmarks', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ page: d.currentPageId, bookmark: { url: u } }) });
            await d.loadPageBookmarks(d.currentPageId, { forceFetch: true, skipRender: true });
            await d.loadAllBookmarks();
            d.renderDashboard();
        }, `https://tvl-${N}.example.com/`);
        await expect(page.locator('.tag-view .tag-view-empty')).toBeVisible();
        await page.locator('.tag-view .tag-view-empty button').click();
        await expect(view(page)).toHaveCount(0);
        expect(errors).toEqual([]);
    });
});

test.describe('the rail', () => {
    let R; let N; let ids;
    test.beforeEach(async ({ page }) => {
        N = `${STAMP}${Math.random().toString(36).slice(2, 7)}`;
        R = `tvrail${N}`;
        await openDashboard(page);
        ids = await seed(page, [
            { url: `https://tvr-1-${N}.example.com/`, name: 'Rail one', tags: [R, `docker${N}`, `net${N}`], page: 'here', openCount: 4 },
            { url: `https://tvr-2-${N}.example.com/`, name: 'Rail two', tags: [R, `docker${N}`], page: 'other', openCount: 1 },
            { url: `https://tvr-3-${N}.example.com/`, name: 'Rail three', tags: [R], page: 'other' },
            { url: `https://tvr-4-${N}.example.com/`, name: 'Docker only', tags: [`docker${N}`], page: 'here' },
        ]);
        await openDashboard(page);
        await openTagView(page, [R]);
    });

    const rail = (page) => page.locator('.tag-view .lvs-rail');

    test('related tags, most shared first; a click switches, Shift adds', async ({ page }) => {
        const related = rail(page).locator('[data-rail-tag]');
        await expect(related.first()).toHaveAttribute('data-rail-tag', `docker${N}`);
        await expect(related.first()).toContainText('2');
        await expect(rail(page).locator(`[data-rail-tag="net${N}"]`)).toContainText('1');

        await rail(page).locator(`[data-rail-tag="net${N}"]`).click({ modifiers: ['Shift'] });
        await expect.poll(() => hash(page)).toBe(`#tag/${[R, `net${N}`].sort().join('+')}`);

        await rail(page).locator(`[data-rail-tag="docker${N}"]`).click();
        await expect.poll(() => hash(page)).toBe(`#tag/docker${N}`);
        await expect.poll(async () => (await rowNames(page)).sort()).toEqual(['Docker only', 'Rail one', 'Rail two']);
    });

    test('a page narrows the list, a second click lifts it; the header stays', async ({ page }) => {
        // The count and the pages; health joins the line whenever its report lands.
        const stats = () => page.locator('.tag-view .tag-view-stat').evaluateAll((els) => els.slice(0, 2).map((e) => e.textContent));
        const before = await stats();
        const pageBtn = rail(page).locator(`[data-rail-page="${ids.other}"]`);
        await expect(pageBtn).toContainText('2');
        await pageBtn.click();
        await expect(pageBtn).toHaveClass(/is-active/);
        await expect.poll(async () => (await rowNames(page)).sort()).toEqual(['Rail three', 'Rail two']);
        expect(await stats()).toEqual(before);
        await pageBtn.click();
        await expect.poll(async () => (await rowNames(page)).length).toBe(3);
    });

    test('health: never opened, and broken', async ({ page }) => {
        await rail(page).locator('[data-rail-health="never"]').click();
        await expect.poll(() => rowNames(page)).toEqual(['Rail three']);
        await rail(page).locator('[data-rail-health="never"]').click();
        // A real report needs the checker; the view's own lookup is what the rail asks.
        await page.evaluate(() => {
            const v = window.dashboardInstance.tagView.instance;
            v.isBroken = (b) => b.name === 'Rail two';
            v.render();
        });
        await expect(rail(page).locator('[data-rail-health="broken"]')).toContainText('1');
        await rail(page).locator('[data-rail-health="broken"]').click();
        await expect.poll(() => rowNames(page)).toEqual(['Rail two']);
    });

    test('more than twelve related tags fold behind "+N more"', async ({ page }) => {
        const many = Array.from({ length: 15 }, (_, i) => `rel${i}${N}`);
        await seed(page, [{ url: `https://tvr-many-${N}.example.com/`, tags: [R, ...many], page: 'here' }]);
        await openDashboard(page);
        await openTagView(page, [R]);
        await expect(rail(page).locator('[data-rail-tag]:visible')).toHaveCount(12);
        const more = rail(page).locator('[data-rail-more]');
        await expect(more).toContainText('+5');
        await more.click();
        await expect(rail(page).locator('[data-rail-tag]:visible')).toHaveCount(17);
    });
});

test.describe('the table', () => {
    let T; let N; let ids;
    test.beforeEach(async ({ page }) => {
        N = `${STAMP}${Math.random().toString(36).slice(2, 7)}`;
        T = `tvtable${N}`;
        await openDashboard(page);
        ids = await seed(page, [
            { url: `https://bravo-${N}.example.com/`, name: 'Bravo', tags: [T, `extra${N}`], page: 'here', openCount: 7, lastOpened: Date.now() - 60_000 },
            { url: `https://alpha-${N}.example.com/`, name: 'Alpha', tags: [T], page: 'other', openCount: 2, lastOpened: Date.now() - 3_600_000 },
            { url: `https://charlie-${N}.example.com/`, name: 'Charlie', tags: [T], page: 'here' },
        ]);
        await openDashboard(page);
        await openTagView(page, [T]);
        await expect.poll(async () => (await rowNames(page)).length).toBe(3);
    });

    const heads = (page) => page.locator('.tag-view .tag-view-colhead [data-sort]');

    test('columns: name and host, other tags, page, opens, last opened, score', async ({ page }) => {
        expect(await page.locator('.tag-view .tag-view-colhead').textContent()).toMatch(/Name[\s\S]*Other tags[\s\S]*Page[\s\S]*Opens[\s\S]*Last opened[\s\S]*Score/);
        const bravo = page.locator('.tag-view-row', { hasText: 'Bravo' });
        await expect(bravo.locator('.tag-view-host')).toHaveText(`bravo-${N}.example.com`);
        await expect(bravo.locator('.tag-view-tags [data-tag]')).toHaveText([`extra${N}`]);
        await expect(bravo.locator('.tag-view-page')).toHaveText('main');
        await expect(page.locator('.tag-view-row', { hasText: 'Alpha' }).locator('.tag-view-page')).toHaveText('Tag view other');
        await expect(bravo.locator('.tag-view-opens')).toHaveText('7');
        // A time, not a template: "1m ago", never "{count}m ago".
        await expect(bravo.locator('.tag-view-last')).toHaveText(/\d/);
        await expect(bravo.locator('.tag-view-last')).not.toContainText('{');
        // Last opened leads: most recent first.
        await expect.poll(() => rowNames(page)).toEqual(['Bravo', 'Alpha', 'Charlie']);
    });

    test('/ searches; the count follows', async ({ page }) => {
        await page.locator('body').click({ position: { x: 5, y: 5 } });
        await page.keyboard.press('/');
        const search = page.locator('.tag-view input[data-tag-view-search]');
        await expect(search).toBeFocused();
        await page.keyboard.type('char');
        await expect.poll(() => rowNames(page)).toEqual(['Charlie']);
        await expect(page.locator('.tag-view .tag-view-count')).toHaveText('1 of 3');
    });

    test('the Name header sorts A–Z, then Z–A; the select does the same', async ({ page }) => {
        await heads(page).filter({ hasText: 'Name' }).click();
        await expect.poll(() => rowNames(page)).toEqual(['Alpha', 'Bravo', 'Charlie']);
        await heads(page).filter({ hasText: 'Name' }).click();
        await expect.poll(() => rowNames(page)).toEqual(['Charlie', 'Bravo', 'Alpha']);
        await page.locator('.tag-view select[data-tag-view-sort]').selectOption('opens');
        await expect.poll(() => rowNames(page)).toEqual(['Bravo', 'Alpha', 'Charlie']);
    });

    test('arrows, g and G move the focus row; Enter opens it', async ({ page }) => {
        await page.evaluate(() => {
            window.__opened = [];
            document.addEventListener('click', (e) => {
                const a = e.target.closest?.('a.tag-view-open');
                if (a) { window.__opened.push(a.getAttribute('href')); e.preventDefault(); }
            }, true);
        });
        await page.locator('body').click({ position: { x: 5, y: 5 } });
        const focused = () => page.locator('.tag-view-row.is-focused .tag-view-name').innerText();
        await page.keyboard.press('ArrowDown');
        await expect.poll(focused).toBe('Bravo');
        await page.keyboard.press('ArrowDown');
        await expect.poll(focused).toBe('Alpha');
        await page.keyboard.press('G');
        await expect.poll(focused).toBe('Charlie');
        await page.keyboard.press('g');
        await expect.poll(focused).toBe('Bravo');
        await page.keyboard.press('Enter');
        await expect.poll(() => page.evaluate(() => window.__opened)).toEqual([`https://bravo-${N}.example.com/`]);
    });

    test('a tag in a row switches the view; Shift adds it', async ({ page }) => {
        const chip = page.locator('.tag-view-row', { hasText: 'Bravo' }).locator(`.tag-view-tags [data-tag="extra${N}"]`);
        await chip.click({ modifiers: ['Shift'] });
        await expect.poll(() => hash(page)).toBe(`#tag/${[T, `extra${N}`].sort().join('+')}`);
        await openTagView(page, [T]);
        await page.locator('.tag-view-row', { hasText: 'Bravo' }).locator(`.tag-view-tags [data-tag="extra${N}"]`).click();
        await expect.poll(() => hash(page)).toBe(`#tag/extra${N}`);
    });

    test('filters and search that leave nothing say so, and clear in one click', async ({ page }) => {
        await page.locator(`.tag-view .lvs-rail [data-rail-page="${ids.other}"]`).click();
        await page.locator('.tag-view input[data-tag-view-search]').fill('bravo');
        await expect(page.locator('.tag-view .tag-view-nomatch')).toBeVisible();
        await page.locator('.tag-view .tag-view-nomatch button').click();
        await expect.poll(async () => (await rowNames(page)).length).toBe(3);
        await expect(page.locator('.tag-view input[data-tag-view-search]')).toHaveValue('');
    });

    test('the keys are a legend along the bottom', async ({ page }) => {
        const legend = page.locator('.tag-view .tag-view-legend');
        await expect(legend).toBeVisible();
        // Retried, not read once: the view redraws when its tag suggestions
        // land, and a legend read mid-redraw was a detached one with no style.
        await expect.poll(() => legend.locator('kbd').count()).toBeGreaterThanOrEqual(5);
        await expect(legend).toHaveCSS('display', 'flex');
    });
});

test.describe('selection, panel and edit', () => {
    let S; let N; let ids;
    test.beforeEach(async ({ page }) => {
        N = `${STAMP}${Math.random().toString(36).slice(2, 7)}`;
        S = `tvsel${N}`;
        await openDashboard(page);
        ids = await seed(page, [
            { url: `https://sel-a-${N}.example.com/`, name: 'Sel A', tags: [S], page: 'here', lastOpened: Date.now() - 1000 },
            { url: `https://sel-b-${N}.example.com/`, name: 'Sel B', tags: [S], page: 'other', lastOpened: Date.now() - 2000 },
            { url: `https://sel-c-${N}.example.com/`, name: 'Sel C', tags: [S], page: 'here', lastOpened: Date.now() - 3000 },
        ]);
        await openDashboard(page);
        await openTagView(page, [S]);
        await expect.poll(() => rowNames(page)).toEqual(['Sel A', 'Sel B', 'Sel C']);
        await page.evaluate(() => { window.AppModal.danger = async (opts) => { window.__confirm = opts?.message || ''; return true; }; });
    });

    const selbar = (page) => page.locator('.tag-view .tag-view-selbar');
    const row = (page, name) => page.locator('.tag-view-row', { hasText: name });

    test('x, Shift+click and the header tick select; the bar counts them', async ({ page }) => {
        await page.locator('body').click({ position: { x: 5, y: 5 } });
        await page.keyboard.press('ArrowDown');
        await page.keyboard.press('x');
        await expect(selbar(page)).toContainText('1 selected');
        await row(page, 'Sel C').locator('.tag-view-page').click({ modifiers: ['Shift'] });
        await expect(selbar(page)).toContainText('3 selected');
        await page.locator('.tag-view .tag-view-check-all').click();
        await expect(selbar(page)).toBeHidden();
        await page.locator('.tag-view .tag-view-check-all').click();
        await expect(selbar(page)).toContainText('3 selected');
        await row(page, 'Sel B').locator('.tag-view-check').click();
        await expect(selbar(page)).toContainText('2 selected');
    });

    test('Delete across two pages, and undo puts each back home', async ({ page }) => {
        await page.evaluate(() => {
            const d = window.dashboardInstance;
            const original = d.showGroupedNotification.bind(d);
            d.showGroupedNotification = (...args) => { window.__undo = args[4]?.undoCallback || null; return original(...args); };
        });
        await row(page, 'Sel A').locator('.tag-view-check').click();
        await row(page, 'Sel B').locator('.tag-view-check').click();
        await selbar(page).getByRole('button', { name: 'Delete' }).click();
        // Two pages' bookmarks: the question does not place them on this one.
        await expect.poll(() => page.evaluate(() => window.__confirm)).toMatch(/2/);
        expect(await page.evaluate(() => window.__confirm)).not.toMatch(/this page/i);
        await expect.poll(() => readUrls(page, ids.here)).not.toContain(`https://sel-a-${N}.example.com/`);
        await expect.poll(() => readUrls(page, ids.other)).not.toContain(`https://sel-b-${N}.example.com/`);
        await expect.poll(() => rowNames(page)).toEqual(['Sel C']);
        // The undo is offered once the trash has the rows.
        await expect.poll(() => page.evaluate(() => typeof window.__undo)).toBe('function');
        await page.evaluate(() => window.__undo());
        await expect.poll(() => readUrls(page, ids.here), { timeout: 10_000 }).toContain(`https://sel-a-${N}.example.com/`);
        await expect.poll(() => readUrls(page, ids.other), { timeout: 10_000 }).toContain(`https://sel-b-${N}.example.com/`);
    });

    test('Move to a page takes each from its own page', async ({ page }) => {
        await row(page, 'Sel B').locator('.tag-view-check').click();
        await selbar(page).getByRole('button', { name: 'Move to…' }).click();
        await page.locator(`#move-popover .move-popover-item[data-type="page"][data-id="${ids.here}"]`).click();
        await expect.poll(() => readUrls(page, ids.here), { timeout: 10_000 }).toContain(`https://sel-b-${N}.example.com/`);
        await expect.poll(() => readUrls(page, ids.other)).not.toContain(`https://sel-b-${N}.example.com/`);
    });

    test('i opens the panel; Edit there and e open the bookmark form', async ({ page }) => {
        await page.locator('body').click({ position: { x: 5, y: 5 } });
        await page.keyboard.press('ArrowDown');
        await page.keyboard.press('i');
        const panel = page.locator('[data-lvs-drawer="tag-view"] .lvs-drawer');
        await expect(panel).toBeVisible();
        await expect(panel.locator('.lvs-drawer-title')).toHaveText('Sel A');
        await expect(panel.locator('[data-lvs-section="details"]')).toBeAttached();
        await expect(panel.locator('[data-lvs-section="tags"]')).toBeAttached();
        await expect(panel.locator('[data-lvs-section="health"]')).toBeAttached();
        await panel.getByRole('button', { name: 'Edit' }).click();
        await expect(page.locator('#bookmark-form-modal.show')).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(page.locator('#bookmark-form-modal.show')).toHaveCount(0);

        await page.locator('body').click({ position: { x: 5, y: 5 } });
        await page.keyboard.press('ArrowDown');
        await page.keyboard.press('e');
        await expect(page.locator('#bookmark-form-modal.show')).toBeVisible();
    });

    test('Escape lets go of one thing at a time: selection, panel, search, then the view', async ({ page }) => {
        await page.locator('body').click({ position: { x: 5, y: 5 } });
        await page.keyboard.press('ArrowDown');
        await page.keyboard.press('x');
        await page.keyboard.press('i');
        await expect(selbar(page)).toBeVisible();
        await expect(page.locator('[data-lvs-drawer="tag-view"] .lvs-drawer')).toBeVisible();

        await page.keyboard.press('Escape');
        await expect(page.locator('[data-lvs-drawer="tag-view"] .lvs-drawer')).toHaveCount(0);
        await expect(selbar(page)).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(selbar(page)).toBeHidden();
        await expect(view(page)).toBeVisible();

        await page.keyboard.press('/');
        await page.keyboard.type('sel');
        await page.keyboard.press('Escape');
        await expect(page.locator('.tag-view input[data-tag-view-search]')).toHaveValue('');
        await expect(view(page)).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(view(page)).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(view(page)).toHaveCount(0);
    });

    test('right-click opens the dashboard row menu; its Tags… is the Tags popover', async ({ page }) => {
        await row(page, 'Sel B').locator('.tag-view-page').click({ button: 'right' });
        const menu = page.locator('#bookmark-context-menu');
        await expect(menu).toBeVisible();
        await expect(menu.locator('.move-popover-current-hint')).toHaveText('Sel B');
        for (const name of ['Open in new tab', 'Edit', 'Tags…', 'Move to…', 'Delete']) {
            await expect(menu.getByText(name, { exact: true }).first()).toBeVisible();
        }
        // The view ticks its own rows; the grid's Select would act on rows
        // that are not on screen.
        await expect(menu.getByText('Select', { exact: true })).toHaveCount(0);
        await menu.getByText('Tags…', { exact: true }).click();
        const popover = page.locator('#tag-popover');
        await expect(popover).toBeVisible();
        await expect(popover).toContainText('Suggested');
        await page.keyboard.press('Escape');
        await expect(popover).toHaveCount(0);
        await expect(view(page)).toBeVisible();
    });

    test('Shift+T on a row from another page changes that bookmark and no other', async ({ page }) => {
        await page.locator('body').click({ position: { x: 5, y: 5 } });
        await page.keyboard.press('ArrowDown');
        await page.keyboard.press('ArrowDown');
        await page.keyboard.press('Shift+T');
        const popover = page.locator('#tag-popover');
        await expect(popover).toContainText('Sel B');
        const namesByUrl = () => page.evaluate(() => window.dashboardInstance.allBookmarks
            .map((b) => `${b.pageId} ${b.url} ${b.name}`).sort());
        const before = await namesByUrl();
        await popover.locator(`[data-tag="${S}"]`).click();
        await expect.poll(() => readTags(page, ids.other, `https://sel-b-${N}.example.com/`), { timeout: 10_000 }).not.toContain(S);
        // The sync behind the popover asked a module the tag view never
        // loads, took its promise for a yes, and wrote this bookmark's name
        // and URL over every other one in memory.
        expect(await namesByUrl()).toEqual(before);
    });

    test('Shift+M on a row from another page offers pages, and moves it from its own', async ({ page }) => {
        await page.locator('body').click({ position: { x: 5, y: 5 } });
        await page.keyboard.press('ArrowDown');
        await page.keyboard.press('ArrowDown');
        await page.keyboard.press('Shift+M');
        const popover = page.locator('#move-popover');
        await expect(popover).toBeVisible();
        await expect(popover.locator('.move-popover-item[data-type="category"]')).toHaveCount(0);
        // Dispatched: the quick start card can come up over the popover's
        // corner, and what is under test is the move, not the pointer.
        await popover.locator(`.move-popover-item[data-type="page"][data-id="${ids.here}"]`).dispatchEvent('click');
        await expect.poll(() => readUrls(page, ids.here), { timeout: 10_000 }).toContain(`https://sel-b-${N}.example.com/`);
        await expect.poll(() => readUrls(page, ids.other)).not.toContain(`https://sel-b-${N}.example.com/`);
    });

    test('Shift+E opens the bookmark form, and Escape closes only that', async ({ page }) => {
        await page.locator('body').click({ position: { x: 5, y: 5 } });
        await page.keyboard.press('ArrowDown');
        await page.keyboard.press('Shift+E');
        await expect(page.locator('#bookmark-form-modal.show')).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(page.locator('#bookmark-form-modal.show')).toHaveCount(0);
        await expect(view(page)).toBeVisible();
    });
});

test.describe('tag suggestions in the rows', () => {
    let S; let N; let ids; let OFFER;
    const urlA = () => `https://sug-a-${N}.example.com/`;
    const urlB = () => `https://sug-b-${N}.example.com/`;
    const row = (page, name) => page.locator('.tag-view-row', { hasText: name });

    test.beforeEach(async ({ page }) => {
        N = `${STAMP}${Math.random().toString(36).slice(2, 7)}`;
        S = `tvsug${N}`;
        OFFER = `sugrule${N}`;
        await openDashboard(page);
        ids = await seed(page, [
            { url: urlA(), name: 'Sug A', tags: [S], page: 'here', lastOpened: Date.now() - 1000 },
            { url: urlB(), name: 'Sug B', tags: [S], page: 'other', lastOpened: Date.now() - 2000 },
        ]);
        // A rule per site: the one source that needs neither the catalogue
        // nor the network, so the offer is the same on every run.
        await page.evaluate(async (rules) => {
            const d = window.dashboardInstance;
            d.settings.tagRules = [...(d.settings.tagRules || []), ...rules];
            await d.saveSettings?.();
        }, [
            { pattern: `sug-a-${N}.example.com`, tag: OFFER },
            { pattern: `sug-b-${N}.example.com`, tag: OFFER },
        ]);
        await page.route('**/api/tags/lookup', (route) => route.fulfill({ json: { enabled: true, results: {} } }));
        await openDashboard(page);
        await openTagView(page, [S]);
        await expect.poll(() => rowNames(page)).toEqual(['Sug A', 'Sug B']);
    });

    test('each row shows its offer, with where it came from; the header counts them', async ({ page }) => {
        const offer = row(page, 'Sug B').locator(`.tag-view-offer[data-offer="${OFFER}"]`);
        await expect(offer).toBeVisible();
        await expect(offer).toContainText('your rule');
        await expect(page.locator('.tag-view .tag-view-offer-count')).toContainText('2 tag suggestions');
    });

    test('a click on an offer puts the tag on that bookmark, on its own page', async ({ page }) => {
        await row(page, 'Sug B').locator('.tag-view-chip--offer').click();
        await expect.poll(() => readTags(page, ids.other, urlB()), { timeout: 10_000 }).toContain(OFFER);
        expect(await readTags(page, ids.here, urlA())).not.toContain(OFFER);
        await expect(row(page, 'Sug B').locator('.tag-view-offer')).toHaveCount(0);
        await expect(row(page, 'Sug B').locator('.tag-view-chip', { hasText: OFFER })).toBeVisible();
    });

    test('× turns the offer down for good, in the shared refusal list', async ({ page }) => {
        await row(page, 'Sug A').locator('.tag-view-offer').hover();
        await row(page, 'Sug A').locator('.tag-view-offer-refuse').click();
        await expect(row(page, 'Sug A').locator('.tag-view-offer')).toHaveCount(0);
        await expect.poll(() => page.evaluate(async () => (await (await fetch('/api/settings')).json()).dismissedTagSuggestions || []))
            .toContain(`sug-a-${N}.example.com|${OFFER}`);
        expect(await readTags(page, ids.here, urlA())).not.toContain(OFFER);
    });

    test('Add all, and a on the focused row', async ({ page }) => {
        await page.locator('body').click({ position: { x: 5, y: 5 } });
        await page.keyboard.press('ArrowDown');
        await page.keyboard.press('a');
        await expect.poll(() => readTags(page, ids.here, urlA()), { timeout: 10_000 }).toContain(OFFER);
        await expect(page.locator('.tag-view .tag-view-offer-count')).toContainText('1 tag suggestion');
        await page.locator('.tag-view [data-tag-view-add-all]').click();
        await expect.poll(() => readTags(page, ids.other, urlB()), { timeout: 10_000 }).toContain(OFFER);
        // The offers are gone; the line may stay for "N turned down".
        await expect(page.locator('.tag-view [data-tag-view-add-all]')).toHaveCount(0);
    });

    test('Find tags ▾ runs the round for the rows, and adds what it finds when told to', async ({ page }) => {
        await page.evaluate(() => localStorage.setItem('nextdash.tagSearch.applyNow', 'true'));
        await page.locator('.tag-view [data-tag-view-find]').click();
        const menu = page.locator('.tag-view-find-menu');
        await expect(menu).toBeVisible();
        await expect(menu.locator('[data-find="apply-now"]')).toBeChecked();
        await menu.locator('[data-find="lookup"]').click();
        await expect.poll(() => readTags(page, ids.here, urlA()), { timeout: 10_000 }).toContain(OFFER);
        await expect.poll(() => readTags(page, ids.other, urlB()), { timeout: 10_000 }).toContain(OFFER);
    });

    test('with "add right away" off, a round leaves the offers in the rows', async ({ page }) => {
        await row(page, 'Sug A').locator('.tag-view-check').click();
        await page.locator('.tag-view [data-tag-view-find]').click();
        await page.locator('.tag-view-find-menu [data-find="apply-now"]').uncheck();
        await page.keyboard.press('Escape');
        await page.locator('.tag-view .tag-view-selbar').getByRole('button', { name: 'Find tags' }).click();
        await expect(page.locator('#app-notification.show')).toContainText('has a tag suggestion');
        expect(await readTags(page, ids.here, urlA())).not.toContain(OFFER);
        await expect(row(page, 'Sug A').locator('.tag-view-offer')).toBeVisible();
    });

    test('the panel offers the same, with Find tags and Read page', async ({ page }) => {
        await page.locator('body').click({ position: { x: 5, y: 5 } });
        await page.keyboard.press('ArrowDown');
        await page.keyboard.press('i');
        const tags = page.locator('[data-lvs-drawer="tag-view"] [data-lvs-section="tags"]');
        await expect(tags.locator(`.tag-view-offer[data-offer="${OFFER}"]`)).toBeVisible();
        await expect(tags.getByRole('button', { name: 'Find tags' })).toBeVisible();
        await expect(tags.getByRole('button', { name: 'Read page' })).toBeVisible();
        await tags.locator('.tag-view-chip--offer').click();
        await expect.poll(() => readTags(page, ids.here, urlA()), { timeout: 10_000 }).toContain(OFFER);
        // Drawn again with the tag on, the offer gone.
        await expect(tags.locator('.tag-view-offer')).toHaveCount(0);
    });
});

async function readTags(page, id, url) {
    return page.evaluate(async ({ pid, href }) => {
        const body = await (await fetch(`/api/bookmarks?page=${pid}`)).json();
        const hit = (Array.isArray(body) ? body : body.bookmarks || []).find((b) => b.url === href);
        return hit?.tags || [];
    }, { pid: id, href: url });
}

async function readUrls(page, id) {
    return page.evaluate(async (pid) => {
        const body = await (await fetch(`/api/bookmarks?page=${pid}`)).json();
        return (Array.isArray(body) ? body : body.bookmarks || []).map((b) => b.url);
    }, id);
}

test('a bookmark on two pages is one row', async ({ page }) => {
    const N = `${STAMP}${Math.random().toString(36).slice(2, 7)}`;
    const tag = `tvtwice${N}`;
    const url = `https://twice-${N}.example.com/`;
    await openDashboard(page);
    await seed(page, [
        { url, name: 'Twice', tags: [tag], page: 'here' },
        { url, name: 'Twice', tags: [tag], page: 'other' },
        { url: `https://once-${N}.example.com/`, name: 'Once', tags: [tag], page: 'other' },
    ]);
    await openDashboard(page);
    await openTagView(page, [tag]);
    await expect.poll(async () => (await rowNames(page)).sort()).toEqual(['Once', 'Twice']);
});

test('with the header button off, / still opens the cloud and reaches other pages', async ({ page }) => {
    const N = `${STAMP}${Math.random().toString(36).slice(2, 7)}`;
    const tag = `tvnobtn${N}`;
    await openDashboard(page);
    await seed(page, [{ url: `https://nobtn-${N}.example.com/`, name: 'No button', tags: [tag], page: 'other' }]);
    await page.evaluate(async () => {
        const d = window.dashboardInstance;
        Object.assign(d.settings, {
            showTagCloudButton: false, globalShortcuts: false, showTagCollections: false,
            showSmartRecentCollection: false, showSmartStaleCollection: false,
            showSmartMostUsedCollection: false, showSmartTodayCollection: false,
        });
        await d.saveSettings?.();
    });
    await openDashboard(page);
    await pickInCloud(page, tag);
    await expect(view(page)).toBeVisible();
    await expect.poll(() => rowNames(page)).toContain('No button');
});

test.describe('on a phone', () => {
    test('two-line rows, the rail as a strip, nothing wider than the screen', async ({ page }) => {
        const N = `${STAMP}${Math.random().toString(36).slice(2, 7)}`;
        const tag = `tvphone${N}`;
        await openDashboard(page);
        await seed(page, [
            { url: `https://phone-a-${N}.example.com/`, name: 'Phone A with a fairly long name', tags: [tag, `rel${N}`], page: 'here', openCount: 3, lastOpened: Date.now() - 60_000 },
            { url: `https://phone-b-${N}.example.com/`, name: 'Phone B', tags: [tag], page: 'other' },
        ]);
        await page.setViewportSize({ width: 375, height: 812 });
        await page.reload();
        await page.waitForFunction(() => window.dashboardInstance?._bookmarksReady === true, null, { timeout: 20_000 });
        await dismissBlockingOverlays(page);
        await page.evaluate((t) => window.dashboardInstance.setTagFilters([t]), tag);
        await expect(view(page)).toBeVisible();
        await expect.poll(async () => (await rowNames(page)).length).toBe(2);

        // Nothing sideways.
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);

        // The column heads go; a row keeps name and score on top, the rest under it.
        await expect(page.locator('.tag-view .tag-view-colhead')).toBeHidden();
        // Read in one go: a redraw (the health report landing) between two
        // separate lookups measured a row that had just been replaced.
        const boxes = await page.evaluate(() => {
            const row = [...document.querySelectorAll('.tag-view-row')].find((r) => r.textContent.includes('Phone A'));
            const box = (sel) => {
                const r = row.querySelector(sel).getBoundingClientRect();
                return { y: r.y, height: r.height };
            };
            return { name: box('.tag-view-open'), host: box('.tag-view-host'), page: box('.tag-view-page') };
        });
        expect(boxes.host.y, 'host not on the second line').toBeGreaterThan(boxes.name.y + boxes.name.height / 2);
        expect(Math.abs(boxes.page.y - boxes.host.y), 'page not beside the host').toBeLessThan(6);

        // The rail is one strip that scrolls on its own, not a column.
        const rail = await page.locator('.tag-view .tag-view-rail').boundingBox();
        expect(rail.height, 'the rail is still a column').toBeLessThan(80);
        await expect(page.locator(`.tag-view .lvs-rail [data-rail-tag="rel${N}"]`)).toBeAttached();

        // Every header action is on screen.
        for (const name of ['Open all 2', 'Copy links', 'Manage tag ▾']) {
            const b = await page.locator('.tag-view .lvs-header-actions').getByRole('button', { name }).boundingBox();
            expect(b, `${name} missing`).toBeTruthy();
            expect(b.x + b.width).toBeLessThanOrEqual(375);
        }
    });
});

test.describe('on a touch phone', () => {
    test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

    test('a #tag link opens the view; the cloud stays a desktop thing', async ({ page }) => {
        const N = `${STAMP}${Math.random().toString(36).slice(2, 7)}`;
        const tag = `tvtouch${N}`;
        await openDashboard(page);
        await seed(page, [{ url: `https://touch-${N}.example.com/`, name: 'Touch one', tags: [tag], page: 'other' }]);
        // openDashboard sizes the window for the desktop header; a phone again.
        await page.setViewportSize({ width: 390, height: 844 });
        await page.evaluate(() => window.MobileExperience?.isMobileLayout?.()).then((m) => expect(m, 'not the phone layout').toBe(true));
        await page.goto(`/#tag/${tag}`);
        await page.reload();
        await page.waitForFunction(() => window.dashboardInstance?._bookmarksReady === true, null, { timeout: 20_000 });
        await expect(view(page)).toBeVisible();
        await expect.poll(() => rowNames(page)).toContain('Touch one');
        expect(await page.evaluate(() => location.hash)).toBe(`#tag/${tag}`);
        await expect(page.locator('#tag-cloud-toggle-btn')).toBeHidden();
    });
});

// The rows carry the bookmark's own favicon, as the grid does; the letter is
// only for a bookmark without one, or one whose file will not load.
test('rows show the favicon, and the letter only without one', async ({ page }) => {
    const tag = `tvicon${STAMP}`;
    // One small PNG for any icon file, so the test does not depend on what
    // the shared data directory holds.
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
    await page.route('**/data/icons/tv-icon-ok.png', (route) => route.fulfill({ status: 200, contentType: 'image/png', body: png }));
    await page.route('**/data/icons/tv-icon-gone.png', (route) => route.fulfill({ status: 404, body: '' }));
    await openDashboard(page);
    await seed(page, [
        { url: `https://tv-icon-a-${STAMP}.example.com/`, name: 'Has icon', tags: [tag], icon: 'tv-icon-ok.png', page: 'here' },
        { url: `https://tv-icon-b-${STAMP}.example.com/`, name: 'Broken icon', tags: [tag], icon: 'tv-icon-gone.png', page: 'here' },
        { url: `https://tv-icon-c-${STAMP}.example.com/`, name: 'No icon', tags: [tag], iconMode: 'letter', page: 'here' },
    ]);
    await openDashboard(page, `/#tag/${tag}`);

    const row = (name) => page.locator('#dashboard-layout .tag-view-row', { hasText: name });
    await expect(row('Has icon').locator('img.tag-view-icon-img')).toHaveAttribute('src', /\/data\/icons\/tv-icon-ok\.png$/);
    await expect.poll(() => row('Has icon').locator('img.tag-view-icon-img').evaluate((img) => img.naturalWidth)).toBe(1);
    await expect(row('Broken icon').locator('img')).toHaveCount(0);
    await expect(row('Broken icon').locator('.tag-view-icon')).toHaveText('B');
    await expect(row('No icon').locator('img')).toHaveCount(0);
    await expect(row('No icon').locator('.tag-view-icon')).toHaveText('N');
});
