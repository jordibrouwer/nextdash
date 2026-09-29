// @ts-check
const { test, expect } = require('./fixtures');
const { mockDocker } = require('./helpers/docker-mock');

/**
 * Ticking containers and acting on the lot, the way Bookmarks and Inbox do it:
 * x or Space ticks the highlighted row, Shift-click and Shift+arrows tick a
 * run, Ctrl/Cmd+A ticks what the filter shows, Escape lets go. The bar under
 * the toolbar starts, stops, restarts, updates and mutes what is ticked, and
 * leaves the container that is nextDash alone.
 */

const mod = process.platform === 'darwin' ? 'Meta' : 'Control';
const bar = (page) => page.locator('[data-docker-bulk]');
const ticked = (page) => page.locator('[data-docker-row].is-checked').evaluateAll(
    (rows) => rows.map((r) => r.getAttribute('data-docker-row')));

async function openView(page, opts) {
    const state = await mockDocker(page, opts);
    // Settings writes (mute) are answered here, so the dev data dir is not.
    state.saved = [];
    await page.route('**/api/settings', async (route) => {
        if (route.request().method() !== 'POST') return route.fallback();
        state.saved.push(route.request().postDataJSON());
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) });
    });
    await page.goto('/#docker');
    await page.locator('[data-docker-group]').selectOption('none');
    await expect(page.locator('[data-docker-row]')).toHaveCount(4);
    return state;
}

test.describe('ticking containers', () => {
    test('x and Space tick the highlighted row, Ctrl/Cmd+A ticks all, Escape clears', async ({ page }) => {
        await openView(page);
        // Name order: bazarr, jellyfin, nextdash, sonarr.
        await page.keyboard.press('ArrowDown');
        await page.keyboard.press('x');
        await expect(bar(page)).toBeVisible();
        await expect(bar(page)).toContainText('1 selected');
        expect(await ticked(page)).toEqual(['bazarr']);

        await page.keyboard.press('ArrowDown');
        await page.keyboard.press(' ');
        expect(await ticked(page)).toEqual(['bazarr', 'jellyfin']);
        await page.keyboard.press(' ');
        expect(await ticked(page)).toEqual(['bazarr']);

        await page.keyboard.press(`${mod}+a`);
        await expect(bar(page)).toContainText('4 selected');
        // The same chord undoes itself.
        await page.keyboard.press(`${mod}+a`);
        await expect(bar(page)).toBeHidden();

        await page.keyboard.press('x');
        await expect(bar(page)).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(bar(page)).toBeHidden();
        expect(await ticked(page)).toEqual([]);
        // The first Escape let go of the selection, not of the view.
        await expect(page).toHaveURL(/#docker/);
    });

    test('a tick, then Shift-click on another, ticks the run between', async ({ page }) => {
        await openView(page);
        await page.locator('[data-docker-row="bazarr"]').hover();
        await page.locator('[data-docker-tick="bazarr"]').check();
        await page.locator('[data-docker-row="nextdash"]').hover();
        await page.locator('[data-docker-tick="nextdash"]').click({ modifiers: ['Shift'] });
        expect(await ticked(page)).toEqual(['bazarr', 'jellyfin', 'nextdash']);
        // Ticking does not open the drawer.
        await expect(page).not.toHaveURL(/#docker\//);
    });

    test('Shift+↓ ticks the rows it moves over', async ({ page }) => {
        await openView(page);
        await page.keyboard.press('ArrowDown');
        await page.keyboard.press('Shift+ArrowDown');
        await page.keyboard.press('Shift+ArrowDown');
        expect(await ticked(page)).toEqual(['bazarr', 'jellyfin', 'nextdash']);
    });
});

test.describe('the selection bar', () => {
    test('restart runs over the ticked rows, skips nextDash itself, and says how it went', async ({ page }) => {
        const state = await openView(page);
        await page.keyboard.press(`${mod}+a`);
        await bar(page).locator('[data-docker-bulk-action="restart"]').click();
        await expect.poll(() => state.calls.filter((c) => c.endsWith('/restart')).sort())
            .toEqual(['POST /containers/jellyfin/restart', 'POST /containers/sonarr/restart']);
        await expect(page.locator('#app-notification')).toContainText('2 restarted');
        expect(state.calls).not.toContain('POST /containers/nextdash/restart');
    });

    test('stop asks once, then counts what failed', async ({ page }) => {
        const state = await openView(page);
        // One stop that the daemon refuses.
        await page.route('**/api/docker/containers/jellyfin/stop', (route) => {
            state.calls.push('POST /containers/jellyfin/stop');
            return route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ reason: 'boom' }) });
        });
        await page.locator('[data-docker-row="jellyfin"]').hover();
        await page.locator('[data-docker-tick="jellyfin"]').check();
        await page.locator('[data-docker-row="sonarr"]').hover();
        await page.locator('[data-docker-tick="sonarr"]').check();
        await bar(page).locator('[data-docker-bulk-action="stop"]').click();
        const dialog = page.locator('.modal[role="dialog"]');
        await expect(dialog).toContainText('jellyfin');
        await dialog.getByRole('button', { name: /^stop$/i }).click();
        await expect(page.locator('#app-notification')).toContainText('1 stopped, 1 failed');
        await expect(page.locator('[data-docker-row="sonarr"]')).toHaveAttribute('data-state', 'exited');
    });

    test('mute mutes every ticked container but nextDash in one write, then offers unmute', async ({ page }) => {
        const state = await openView(page);
        await page.keyboard.press(`${mod}+a`);
        const mute = bar(page).locator('[data-docker-bulk-action="mute"]');
        await expect(mute).toHaveText(/^Mute/);
        // The page writes settings of its own on load; only the mute's count.
        const mutes = () => state.saved.filter((s) => (s.dockerNotifyMuted || []).length);
        await mute.click();
        await expect(mute).toHaveText(/^Unmute/);
        expect(mutes()).toHaveLength(1);
        expect([...mutes()[0].dockerNotifyMuted].sort()).toEqual(['bazarr', 'jellyfin', 'sonarr']);
        await mute.click();
        await expect.poll(() => state.saved.at(-1)?.dockerNotifyMuted).toEqual([]);
    });

    test('remove asks once, stops the running ones first, and leaves nextDash alone', async ({ page }) => {
        const state = await openView(page);
        await page.keyboard.press(`${mod}+a`);
        await bar(page).locator('[data-docker-bulk-action="remove"]').click();
        const dialog = page.locator('.modal[role="dialog"]');
        await expect(dialog).toContainText('bazarr');
        await expect(dialog).toContainText(/jellyfin, sonarr still run; they are stopped first/);
        await dialog.getByRole('button', { name: /^remove$/i }).click();
        await expect(page.locator('#app-notification')).toContainText('3 removed');
        expect(state.calls.filter((c) => /\/(stop|remove)$/.test(c))).toEqual([
            'POST /containers/bazarr/remove',
            'POST /containers/jellyfin/stop', 'POST /containers/jellyfin/remove',
            'POST /containers/sonarr/stop', 'POST /containers/sonarr/remove',
        ]);
    });

    // A Mac's delete key is Backspace; many keyboards have no Delete at all.
    test('Backspace with containers ticked removes the ticked ones', async ({ page }) => {
        const state = await openView(page);
        await page.keyboard.press('ArrowDown');
        await page.keyboard.press('x');
        // The highlight moves on to a running container: the ticked one is
        // what goes, not the one under the cursor.
        await page.keyboard.press('ArrowDown');
        await page.keyboard.press('Backspace');
        const dialog = page.locator('.modal[role="dialog"]');
        await expect(dialog).toContainText('bazarr');
        await dialog.getByRole('button', { name: /^remove$/i }).click();
        await expect.poll(() => state.calls.filter((c) => c.endsWith('/remove'))).toEqual(['POST /containers/bazarr/remove']);
    });

    test('Backspace on a running container asks, then stops and removes it', async ({ page }) => {
        const state = await openView(page);
        await page.keyboard.press('ArrowDown');
        await page.keyboard.press('ArrowDown');
        await page.keyboard.press('Backspace');
        const dialog = page.locator('.modal[role="dialog"]');
        await expect(dialog).toContainText('jellyfin still run');
        await dialog.getByRole('button', { name: /^remove$/i }).click();
        await expect.poll(() => state.calls.filter((c) => /\/(stop|remove)$/.test(c)))
            .toEqual(['POST /containers/jellyfin/stop', 'POST /containers/jellyfin/remove']);
    });

    test('a right-click on one of several ticked rows acts on all of them', async ({ page }) => {
        const state = await openView(page);
        for (const name of ['bazarr', 'sonarr']) {
            await page.locator(`[data-docker-row="${name}"]`).hover();
            await page.locator(`[data-docker-tick="${name}"]`).check();
        }
        await page.locator('[data-docker-row="sonarr"]').click({ button: 'right' });
        const menu = page.locator('#docker-row-menu');
        await expect(menu).toContainText('2 selected');
        await menu.locator('[data-docker-menu-action="remove"]').click();
        const dialog = page.locator('.modal[role="dialog"]');
        await expect(dialog).toContainText('bazarr, sonarr');
        await dialog.getByRole('button', { name: /^remove$/i }).click();
        await expect(page.locator('#app-notification')).toContainText('2 removed');
        expect(state.calls.filter((c) => c.endsWith('/remove')).sort())
            .toEqual(['POST /containers/bazarr/remove', 'POST /containers/sonarr/remove']);
    });

    test('read-only keeps mute and offers none of Docker\'s own actions', async ({ page }) => {
        await openView(page, { control: false });
        await page.keyboard.press('ArrowDown');
        await page.keyboard.press('x');
        await expect(bar(page).locator('[data-docker-bulk-action="mute"]')).toBeVisible();
        for (const action of ['start', 'stop', 'restart', 'update', 'remove']) {
            await expect(bar(page).locator(`[data-docker-bulk-action="${action}"]`)).toBeHidden();
        }
    });
});

test.describe('the column headings', () => {
    test('are the shared sortable heading, with the arrow on the sorted column', async ({ page }) => {
        await openView(page);
        const nameHead = page.locator('.docker-head--name');
        await expect(nameHead.locator('.lvs-colhead-sort')).toHaveCount(1);
        await expect(nameHead).toHaveAttribute('data-lvs-sort', 'ascending');
        await page.locator('[data-docker-sort-head="state"]').click();
        await expect(page.locator('.docker-head--state')).toHaveAttribute('data-lvs-sort', 'ascending');
        await expect(nameHead).not.toHaveAttribute('data-lvs-sort', /./);
    });
});
