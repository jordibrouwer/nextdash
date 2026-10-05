// @ts-check
const fs = require('fs');
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * Config -> Pages: a page saved as a template file, and that file read back
 * in as a new page with the receiver's own address in place of the sender's.
 * Driven through the buttons and the dialogs, not the routes.
 */

async function openPages(page) {
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.evaluate(() => window.dashboardInstance.config.openConfigView('structure'));
    await page.locator('[data-pt-tab="pages"]').click();
    await expect(page.locator('[data-page-row]').first()).toBeVisible();
}

test('export a page with a LAN link, import it with another address', async ({ page }) => {
    const stamp = Date.now();
    const pageId = 1;
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?._bookmarksReady === true, null, { timeout: 20_000 });
    await page.evaluate(async ({ id, s }) => {
        const api = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
        for (const [name, url] of [[`Jelly ${s}`, `http://192.168.77.10:8096/web/${s}`], [`Docs ${s}`, `https://docs-${s}.example/`]]) {
            await api('/api/bookmarks/add', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ page: id, allowDuplicate: true, bookmark: { name, url, category: '', createdAt: Date.now(), tags: [] } }),
            });
        }
    }, { id: pageId, s: stamp });

    await openPages(page);
    await page.locator(`[data-page-template="${pageId}"]`).click();
    const exportDialog = page.locator('#config-template-export');
    const lanRow = exportDialog.locator('[data-tpl-host]', { hasText: 'http://192.168.77.10:8096' });
    await expect(lanRow.locator('[data-tpl-var]')).toBeChecked();
    await lanRow.locator('[data-tpl-key]').fill('jelly');
    const publicRow = exportDialog.locator('[data-tpl-host]', { hasText: `https://docs-${stamp}.example` });
    await expect(publicRow.locator('[data-tpl-var]')).not.toBeChecked();

    const [download] = await Promise.all([
        page.waitForEvent('download'),
        exportDialog.locator('[data-form-dialog="ok"]').click(),
    ]);
    expect(download.suggestedFilename()).toMatch(/\.nextdash-page\.json$/);
    const file = fs.readFileSync(await download.path(), 'utf8');
    expect(file).not.toContain('192.168.77.10');
    expect(file).toContain(`{{jelly}}/web/${stamp}`);

    await page.locator('[data-page-template-import]').click();
    const importDialog = page.locator('#config-template-import');
    const create = importDialog.locator('[data-form-dialog="ok"]');
    await expect(create).toBeDisabled();
    await importDialog.locator('[data-tpl-text]').fill('{"not":"a template"}');
    await expect(importDialog.locator('.config-tpl-error')).toBeVisible();
    await expect(create).toBeDisabled();

    await importDialog.locator('[data-tpl-file]').setInputFiles({ name: 'home.nextdash-page.json', mimeType: 'application/json', buffer: Buffer.from(file) });
    const value = importDialog.locator('[data-tpl-value="jelly"]');
    await expect(value).toBeVisible();
    await value.fill('https://media.example.net');
    const pagesBefore = await page.evaluate(() => window.dashboardInstance.pages.length);
    await create.click();
    await expect(importDialog).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => window.dashboardInstance.pages.length)).toBe(pagesBefore + 1);

    const imported = await page.evaluate(async (s) => {
        const pages = window.dashboardInstance.pages;
        const last = pages[pages.length - 1];
        const res = await fetch(`/api/bookmarks?page=${last.id}`);
        return (await res.json()).map((b) => b.url).filter((u) => u.includes(String(s)));
    }, stamp);
    expect(imported.sort()).toEqual([`https://docs-${stamp}.example/`, `https://media.example.net/web/${stamp}`].sort());
});

test('both dialogs close on Escape from a field and on a press outside them', async ({ page }) => {
    await openPages(page);
    for (const kind of ['export', 'import']) {
        const open = () => (kind === 'export'
            ? page.locator('[data-page-template]').first().click()
            : page.locator('[data-page-template-import]').click());
        const dialog = page.locator(`#config-template-${kind}`);
        await open();
        await expect(dialog.locator('.modal')).toBeVisible();
        const field = dialog.locator('input[type=text], textarea').first();
        if (await field.count()) await field.focus();
        await page.keyboard.press('Escape');
        await expect(dialog, `${kind}: Escape`).toHaveCount(0);

        await open();
        await expect(dialog.locator('.modal')).toBeVisible();
        await page.mouse.click(12, 450);
        await expect(dialog, `${kind}: press outside`).toHaveCount(0);
    }
});

/** A template of the first page, built by the route the dialog uses. */
async function templateText(page) {
    return page.evaluate(async () => {
        const api = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
        const res = await api('/api/pages/1/template', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
        return res.text();
    });
}

async function openDashboard(page) {
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?._bookmarksReady === true, null, { timeout: 20_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
}

test('the page overview offers sharing this page and importing one', async ({ page }) => {
    await openDashboard(page);
    await page.getByRole('button', { name: 'Choose a page' }).click();
    await page.locator('#page-overview-share').click();
    await expect(page.locator('#config-template-export .modal')).toBeVisible();
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Choose a page' }).click();
    await page.locator('#page-overview-import').click();
    await expect(page.locator('#config-template-import .modal')).toBeVisible();
});

test('the compact page switcher offers them too', async ({ page }) => {
    await openDashboard(page);
    await page.evaluate((anchor) => {
        const d = window.dashboardInstance;
        const btn = document.createElement('button');
        btn.id = anchor;
        document.body.appendChild(btn);
        d.pageNav.openPageSwitcherMenu(btn);
    }, 'tpl-switcher-anchor');
    await page.locator('.page-switcher-share').click();
    await expect(page.locator('#config-template-export .modal')).toBeVisible();
});

test(':share and :import in the command bar open the dialogs', async ({ page }) => {
    await openDashboard(page);
    await page.keyboard.type(':share');
    await expect(page.locator('.search-match-name', { hasText: /Share “.*” as a template file/ })).toBeVisible();
    await page.keyboard.press('Enter');
    await expect(page.locator('#config-template-export .modal')).toBeVisible();
    await page.keyboard.press('Escape');
    await page.keyboard.type(':import');
    const importRow = page.locator('.search-match-name', { hasText: 'Import a page from a template file' });
    await expect(importRow).toBeVisible();
    await importRow.click();
    await expect(page.locator('#config-template-import .modal')).toBeVisible();
});

test('a template file dropped on the dashboard opens the import with it, other files do nothing', async ({ page }) => {
    await openDashboard(page);
    const file = await templateText(page);
    const drop = async (name, text) => {
        const dt = await page.evaluateHandle(([n, t]) => {
            const d = new DataTransfer();
            d.items.add(new File([t], n, { type: 'application/json' }));
            return d;
        }, [name, text]);
        await page.dispatchEvent('#dashboard-layout', 'dragover', { dataTransfer: dt });
        await page.dispatchEvent('#dashboard-layout', 'drop', { dataTransfer: dt });
    };
    await drop('notes.json', '{"hello":"world"}');
    await page.waitForTimeout(500);
    await expect(page.locator('#config-template-import')).toHaveCount(0);

    await drop('home.nextdash-page.json', file);
    const dialog = page.locator('#config-template-import');
    await expect(dialog.locator('.config-tpl-summary')).toBeVisible();
    await expect(dialog.locator('[data-form-dialog="ok"]')).toBeEnabled();
});

test('an empty page starts from a template in place', async ({ page, browserName }) => {
    // WebKit keeps drawing the previous page after a switch to an empty one --
    // already so before templates (HEAD dba887a9), reported, not fixed here.
    test.skip(browserName === 'webkit', 'WebKit does not draw the empty state after a page switch');
    await openDashboard(page);
    const file = await templateText(page);
    const emptyId = await page.evaluate(async () => {
        const api = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
        const list = await (await api('/api/pages')).json();
        const id = Math.max(...list.filter((p) => p.id < 999999).map((p) => p.id)) + 1;
        await api('/api/pages', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify([...list, { id, name: 'Empty one' }]) });
        return id;
    });
    await page.reload();
    await page.waitForFunction(() => window.dashboardInstance?._bookmarksReady === true, null, { timeout: 20_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.getByRole('tab', { name: /^Empty one/ }).click();
    const pagesBefore = await page.evaluate(() => window.dashboardInstance.pages.length);
    await page.locator('#empty-state-template').click();
    const dialog = page.locator('#config-template-import');
    await expect(dialog.locator('.modal-title')).toContainText('Empty one');
    await dialog.locator('[data-tpl-text]').fill(file);
    await expect(dialog.locator('.config-tpl-summary')).toBeVisible();
    await dialog.locator('[data-form-dialog="ok"]').click();
    await expect(dialog).toHaveCount(0);
    await expect.poll(() => page.evaluate(async (id) => (await (await fetch(`/api/bookmarks?page=${id}`)).json()).length, emptyId))
        .toBeGreaterThan(0);
    expect(await page.evaluate(() => window.dashboardInstance.pages.length)).toBe(pagesBefore);
    await expect(page.locator('#empty-state-template')).toHaveCount(0);
});
