// @ts-check
const { test, expect } = require('./fixtures');
const { openBookmarksWithHealth } = require('./helpers/bookmarks-health');
const { openInboxWith } = require('./helpers/inbox-report');
const { mockDocker } = require('./helpers/docker-mock');

/**
 * The Bookmarks, Inbox and Containers views name their columns in one style
 * (.lvs-colhead, in the theme's colours), and each heading stands over its
 * column. At phone width, where rows fold, the headings go.
 */

const box = async (loc) => {
    const b = await loc.boundingBox();
    return b ? { left: Math.round(b.x), right: Math.round(b.x + b.width) } : null;
};

/** The look a heading has, and the theme colours it is meant to take. */
const headStyle = (loc) => loc.evaluate((el) => {
    const cs = getComputedStyle(el);
    const probe = document.createElement('span');
    probe.style.color = 'var(--text-secondary)';
    probe.style.backgroundColor = 'var(--background-primary)';
    document.body.appendChild(probe);
    const theme = getComputedStyle(probe);
    const out = {
        color: cs.color, background: cs.backgroundColor, size: cs.fontSize, transform: cs.textTransform,
        weight: cs.fontWeight, sticky: cs.position,
        themeColor: theme.color, themeBackground: theme.backgroundColor,
    };
    probe.remove();
    return out;
});

test.describe('column headings over the list views', () => {
    test.beforeEach(async ({ page }) => { await page.setViewportSize({ width: 1400, height: 900 }); });

    test('Bookmarks: a heading over every column the row shows', async ({ page }) => {
        await openBookmarksWithHealth(page, undefined, { view: 'library' });
        const head = page.locator('[data-bm-colhead]');
        await expect(head).toBeVisible();
        await expect(head).toContainText(/Name/i);
        await expect(head).toContainText(/Opens/i);
        const row = page.locator('#config-bm-list .config-bm-row').first();
        const heads = head.locator(':scope > *');
        const cells = row.locator(':scope > *');
        expect(await heads.count()).toBe(await cells.count());
        for (let i = 0; i < await heads.count(); i++) {
            if (i < 2) continue; // tick and icon: blank headings
            const h = heads.nth(i);
            const c = cells.nth(i);
            // Displayed, not visible: an unpinned row's pin cell is empty.
            const displayed = (loc) => loc.evaluate((el) => getComputedStyle(el).display !== 'none');
            const shown = await displayed(c);
            expect(await displayed(h), `heading ${i} displayed like its cell`).toBe(shown);
            if (!shown) continue;
            const hb = await box(h);
            const cb = await box(c);
            const end = await h.evaluate((el) => el.classList.contains('config-bm-colhead-end'));
            if (end) expect(hb?.right, `heading ${i} right edge`).toBe(cb?.right);
            else expect(hb?.left, `heading ${i} left edge`).toBe(cb?.left);
        }
    });

    test('Inbox: title, site and added over their columns', async ({ page }) => {
        await openInboxWith(page);
        const head = page.locator('.inbox-colhead');
        await expect(head.locator(':scope > *')).toHaveText(['', '', 'Title', 'Site', 'Added']);
        const line = page.locator('.inbox-item .inbox-item-line1').first();
        expect((await box(head.locator('.inbox-colhead-title')))?.left)
            .toBe((await box(line.locator('.inbox-item-title')))?.left);
        expect((await box(head.locator('.inbox-colhead-when')))?.right)
            .toBe((await box(line.locator('.inbox-item-when')))?.right);
    });

    test('one style, in the theme colours, in all three views', async ({ page }) => {
        await openInboxWith(page);
        const inbox = await headStyle(page.locator('.inbox-colhead'));

        await openBookmarksWithHealth(page, undefined, { view: 'library' });
        const bm = await headStyle(page.locator('[data-bm-colhead]'));

        await mockDocker(page, { containers: [{ id: 'a'.repeat(64), shortId: 'a', name: 'web', image: 'img', tag: 'latest',
            state: 'running', status: 'Up', health: '', created: 1790000000, ports: [] }] });
        await page.goto('/#docker');
        const docker = await headStyle(page.locator('.docker-table thead th').first());

        for (const s of [bm, inbox, docker]) {
            expect(s.color).toBe(s.themeColor);
            expect(s.background).toBe(s.themeBackground);
            expect(s.transform).toBe('uppercase');
            expect(s.sticky).toBe('sticky');
        }
        expect(inbox.size).toBe(bm.size);
        expect(docker.size).toBe(bm.size);
        expect(inbox.weight).toBe(bm.weight);
        expect(docker.weight).toBe(bm.weight);
    });

    test('phone width goes without', async ({ page }) => {
        await openInboxWith(page);
        await expect(page.locator('.inbox-colhead')).toBeVisible();
        await page.setViewportSize({ width: 390, height: 800 });
        await expect(page.locator('.inbox-colhead')).toBeHidden();
    });

    // Inbox: Title sorts A to Z, a second click Z to A; Added switches
    // between newest and oldest first; the select follows; a reload keeps it.
    test('Inbox: a heading sorts, a second click turns it round', async ({ page }) => {
        const now = Date.now();
        await openInboxWith(page, [
            { id: 'b', url: 'https://b.lan/', domain: 'b.lan', title: 'Bravo', addedAt: now - 1000 },
            { id: 'a', url: 'https://c.lan/', domain: 'c.lan', title: 'Alpha', addedAt: now - 3000 },
            { id: 'c', url: 'https://a.lan/', domain: 'a.lan', title: 'Charlie', addedAt: now - 2000 },
        ]);
        const titles = () => page.locator('.inbox-item .inbox-item-title').allInnerTexts();
        const title = page.locator('[data-inbox-sort-head="title"]');

        await title.click();
        await expect(page.locator('.inbox-sort-select')).toHaveValue('title');
        await expect(page.locator('.inbox-colhead-title')).toHaveAttribute('data-lvs-sort', 'ascending');
        expect(await titles()).toEqual(['Alpha', 'Bravo', 'Charlie']);

        await page.locator('[data-inbox-sort-head="title"]').click();
        await expect(page.locator('.inbox-colhead-title')).toHaveAttribute('data-lvs-sort', 'descending');
        expect(await titles()).toEqual(['Charlie', 'Bravo', 'Alpha']);

        await page.locator('[data-inbox-sort-head="domain"]').click();
        await expect(page.locator('.inbox-colhead-title')).not.toHaveAttribute('data-lvs-sort', /./);
        expect(await titles()).toEqual(['Charlie', 'Bravo', 'Alpha']); // a.lan, b.lan, c.lan

        // Added: newest first, then oldest first.
        await page.locator('[data-inbox-sort-head="added"]').click();
        await expect(page.locator('.inbox-sort-select')).toHaveValue('newest');
        await expect(page.locator('.inbox-colhead-when')).toHaveAttribute('data-lvs-sort', 'descending');
        await page.locator('[data-inbox-sort-head="added"]').click();
        await expect(page.locator('.inbox-sort-select')).toHaveValue('oldest');
        expect(await titles()).toEqual(['Alpha', 'Charlie', 'Bravo']);

        // From the keyboard, and it keeps the focus on the heading.
        await page.locator('[data-inbox-sort-head="title"]').focus();
        await page.keyboard.press('Enter');
        await expect(page.locator('[data-inbox-sort-head="title"]')).toBeFocused();
        await page.keyboard.press('Enter');
        await expect(page.locator('.inbox-colhead-title')).toHaveAttribute('data-lvs-sort', 'descending');
        expect(await titles()).toEqual(['Charlie', 'Bravo', 'Alpha']);
        await expect(page.locator('.lvs-drawer-host[data-lvs-drawer="inbox"] .lvs-drawer')).toBeHidden();
    });

    test('Bookmarks: a heading sorts, a second click turns it round', async ({ page }) => {
        await openBookmarksWithHealth(page, undefined, { view: 'library' });
        await page.locator('#config-bm-group').selectOption('');
        const names = () => page.locator('#config-bm-list .config-bm-row .config-bm-title').allInnerTexts();
        const nameHead = () => page.locator('[data-bm-sort-head="name"]');

        await nameHead().click();
        await expect(page.locator('#config-bm-sort')).toHaveValue('name');
        await expect(page.locator('.config-bm-colhead-name')).toHaveAttribute('data-lvs-sort', 'ascending');
        const asc = await names();
        expect(asc).toEqual([...asc].sort((a, b) => a.localeCompare(b)));

        await nameHead().click();
        await expect(page.locator('.config-bm-colhead-name')).toHaveAttribute('data-lvs-sort', 'descending');
        expect(await names()).toEqual([...asc].reverse());
        await expect(page).toHaveURL(/rev=1/);

        // The toolbar picks a sort afresh, in its natural order.
        await page.locator('#config-bm-sort').selectOption('url');
        await page.locator('#config-bm-sort').selectOption('name');
        await expect(page.locator('.config-bm-colhead-name')).toHaveAttribute('data-lvs-sort', 'ascending');
        expect(await names()).toEqual(asc);

        // Keyboard: Enter on the heading sorts and stays on it.
        await nameHead().focus();
        await page.keyboard.press('Enter');
        await expect(nameHead()).toBeFocused();
        await expect(page.locator('.config-bm-colhead-name')).toHaveAttribute('data-lvs-sort', 'descending');
    });
});
