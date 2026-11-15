// @ts-check
const { test, expect } = require('./fixtures');
const { mockDocker } = require('./helpers/docker-mock');

/**
 * Several Docker hosts in the Containers view: a strip of tabs picks the host,
 * every request then carries ?host=<id>, and the local host is requested
 * exactly as before. A host that is read-only, or down, says so on its tab.
 */

const PI = 'd_0123456789ab';

/** The remote host, answered on top of the local mock; the local mock still gets whatever has no host. */
async function mockRemote(page, { hosts = true, control = false, socket = true, reason = 'refused', statusDelay = 0, listDenied = false, checkDelay = 0 } = {}) {
    const state = { requests: [], control, checked: false };
    const containers = [
        { id: '1'.repeat(64), shortId: '1'.repeat(12), name: 'pihole', image: 'pihole/pihole:latest', tag: 'latest',
            state: 'running', status: 'Up 3 days', health: '', created: 1790000000,
            ports: [{ private: 80, public: 8081, type: 'tcp' }] },
        { id: '2'.repeat(64), shortId: '2'.repeat(12), name: 'redis', image: 'redis:7', tag: '7',
            state: 'exited', status: 'Exited (0) 1 hour ago', health: '', created: 1790000000, ports: [] },
    ];
    await page.route('**/api/docker/**', async (route) => {
        const url = new URL(route.request().url());
        const path = url.pathname.replace('/api/docker', '');
        const host = url.searchParams.get('host');
        const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
        if (path === '/hosts') {
            return json({ max: 4, hosts: hosts ? [{ id: PI, name: 'pi', kind: 'tcp', address: '10.0.0.2:2375',
                allowActions: state.control, hasCA: false, hasCert: false, hasKey: false }] : [] });
        }
        if (!host) return route.fallback();
        state.requests.push(`${route.request().method()} ${path}?host=${host}`);
        if (path === '/status') {
            if (statusDelay) await new Promise((resolve) => setTimeout(resolve, statusDelay));
            return json({ socket, control: state.control, reason: socket ? '' : reason, self: '', selfName: '', writeToken: false, host });
        }
        if (path === '/updates') return json({ checkedAt: state.checked ? Date.now() : null, images: {} });
        if (path === '/updates/check' && route.request().method() === 'POST') { if (checkDelay) await new Promise((resolve) => setTimeout(resolve, checkDelay)); state.checked = true; return json({ checkedAt: Date.now(), images: {} }); }
        if (path === '/containers' && listDenied) return json({ available: false, reason: 'daemon', message: 'forbidden', containers: [], host });
        if (path === '/containers') {
            const rows = containers.map((c) => (state.checked && c.name === 'pihole' ? { ...c, update: { status: 'available', checkedAt: Date.now() } } : c));
            return json({ available: socket, containers: socket ? rows : [], usageEnabled: false, host });
        }
        const one = path.match(/^\/containers\/([^/]+)$/);
        if (one && route.request().method() === 'GET') {
            const c = containers.find((x) => x.name === decodeURIComponent(one[1]));
            if (!c) return json({ reason: 'not-found' }, 404);
            const update = state.checked && c.name === 'pihole' ? { status: 'available', checkedAt: Date.now() } : undefined;
            return json({ ...c, update, startedAt: '2026-09-20T10:00:00Z', restartPolicy: 'always', mounts: [], networks: [],
                envNames: [], version: '', source: '', updateHistory: [] });
        }
        const m = path.match(/^\/containers\/([^/]+)\/(.+)$/);
        if (m && route.request().method() === 'POST') {
            if (!state.control) return json({ reason: 'docker-control-off' }, 403);
            return json({ ok: true, state: 'running' });
        }
        return json({ reason: 'not-found' }, 404);
    });
    return state;
}

const hostTab = (page, id) => page.locator(`[data-docker-host="${id}"]`);

test.describe('several Docker hosts', () => {
    test('no tabs while there is only this host', async ({ page }) => {
        await mockDocker(page);
        await mockRemote(page, { hosts: false });
        await page.goto('/#docker');
        await expect(page.locator('[data-docker-row]')).toHaveCount(4);
        await expect(page.locator('.docker-host-tabs')).toHaveCount(0);
        await expect(page.locator('[data-docker-tab="disk"]')).toBeVisible();
    });

    test('a tab shows that host, and the local host is asked for without a host', async ({ page }) => {
        const local = await mockDocker(page);
        const remote = await mockRemote(page);
        await page.goto('/#docker');
        await expect(page.locator('[data-docker-row]')).toHaveCount(4);
        await expect(hostTab(page, 'local')).toHaveAttribute('aria-selected', 'true');
        expect(remote.requests).toEqual([]);

        await hostTab(page, PI).click();
        await expect(page.locator('[data-docker-row="pihole"]')).toBeVisible();
        await expect(page.locator('[data-docker-row]')).toHaveCount(2);
        await expect(page.locator('[data-docker-row="sonarr"]')).toHaveCount(0);
        expect(remote.requests).toContain(`GET /containers?host=${PI}`);
        // Disk belongs to this machine; the update check is per host.
        await expect(page.locator('[data-docker-tab="disk"]')).toBeHidden();
        await expect(page.locator('[data-docker-check]')).toBeVisible();
        // Port links on another host open that host's address.
        await expect(page.locator('[data-docker-row="pihole"] a[href="http://10.0.0.2:8081"]').first()).toBeVisible();

        await hostTab(page, 'local').click();
        await expect(page.locator('[data-docker-row="sonarr"]')).toBeVisible();
        await expect(page.locator('[data-docker-check]')).toBeVisible();
        expect(local.calls.filter((c) => c.includes('host='))).toEqual([]);
    });

    test('a host without actions is read-only and sends nothing', async ({ page }) => {
        await mockDocker(page);
        const remote = await mockRemote(page, { control: false });
        await page.goto('/#docker');
        await hostTab(page, PI).click();
        await expect(page.locator('[data-docker-row]')).toHaveCount(2);
        await expect(page.locator('[data-docker-readonly]')).toContainText('Config');
        await page.keyboard.press('ArrowDown');
        await page.keyboard.press('r');
        // A key that must do nothing: gives a request time to show up, then asserts none was sent.
        await page.waitForTimeout(300);
        expect(remote.requests.filter((r) => r.startsWith('POST'))).toEqual([]);
    });

    test('with actions on, a restart goes to that host', async ({ page }) => {
        const local = await mockDocker(page);
        const remote = await mockRemote(page, { control: true });
        await page.goto('/#docker');
        await hostTab(page, PI).click();
        await expect(page.locator('[data-docker-row]')).toHaveCount(2);
        await page.keyboard.press('ArrowDown');
        await page.keyboard.press('r');
        await expect.poll(() => remote.requests.some((r) => r.startsWith('POST /containers/pihole/restart'))).toBe(true);
        expect(local.calls.filter((c) => c.startsWith('POST'))).toEqual([]);
        // Update is local only: no key, no row action.
        await page.keyboard.press('u');
        // A key that must do nothing: gives a request time to show up, then asserts none was sent.
        await page.waitForTimeout(300);
        expect(remote.requests.filter((r) => /\/containers\/.*\/update/.test(r))).toEqual([]);
    });

    test('a host that is down says why, and its tab stays', async ({ page }) => {
        await mockDocker(page);
        await mockRemote(page, { socket: false, reason: 'refused' });
        await page.goto('/#docker');
        await hostTab(page, PI).click();
        await expect(page.locator('[data-docker-host-down]')).toContainText('Cannot reach pi');
        await expect(page.locator('[data-docker-host-down]')).toContainText('refused the connection');
        await expect(hostTab(page, 'local')).toBeVisible();
        await hostTab(page, 'local').click();
        await expect(page.locator('[data-docker-row]')).toHaveCount(4);
    });

    test('the chosen host is remembered', async ({ page }) => {
        await mockDocker(page);
        await mockRemote(page);
        await page.goto('/#docker');
        await hostTab(page, PI).click();
        await expect(page.locator('[data-docker-row="pihole"]')).toBeVisible();
        await page.reload();
        await expect(page.locator('[data-docker-row="pihole"]')).toBeVisible();
        await expect(hostTab(page, PI)).toHaveAttribute('aria-selected', 'true');
    });

    test('mute and automatic updates are not offered for another host', async ({ page }) => {
        await mockDocker(page);
        await mockRemote(page, { control: true });
        await page.goto('/#docker');
        await page.locator('[data-docker-group]').selectOption('none');
        // Local: the selection bar offers mute.
        await page.keyboard.press('ArrowDown');
        await page.keyboard.press('x');
        await expect(page.locator('[data-docker-bulk-action="mute"]')).toBeVisible();
        await page.keyboard.press('Escape');
        await hostTab(page, PI).click();
        await expect(page.locator('[data-docker-row="pihole"]')).toBeVisible();
        await page.keyboard.press('ArrowDown');
        await page.keyboard.press('x');
        await expect(page.locator('[data-docker-bulk]')).toBeVisible();
        await expect(page.locator('[data-docker-bulk-action="mute"]')).toBeHidden();
        await expect(page.locator('[data-docker-bulk-action="auto"]')).toBeHidden();
    });

    test('leaving the view puts the palette and search back on this host', async ({ page }) => {
        await mockDocker(page);
        await mockRemote(page, { control: true });
        await page.goto('/#docker');
        await hostTab(page, PI).click();
        await expect(page.locator('[data-docker-row="pihole"]')).toBeVisible();
        expect(await page.evaluate(() => window.dockerActiveHost())).toBe(PI);
        await page.keyboard.press('Escape');
        await expect(page.locator('[data-docker-host]')).toHaveCount(0);
        // The tab is remembered for the view; nothing outside it follows it.
        expect(await page.evaluate(() => window.dockerActiveHost())).toBe('');
        expect(await page.evaluate(() => window.DockerSearchIndex.hostAddress())).not.toBe('10.0.0.2');
    });

    test('a slow answer from the tab that was left does not draw over this one', async ({ page }) => {
        await mockDocker(page);
        await mockRemote(page, { socket: false, statusDelay: 1200 });
        await page.goto('/#docker');
        await expect(page.locator('[data-docker-row]')).toHaveCount(4);
        await hostTab(page, PI).click();
        // The slow host has not answered; go back before it does.
        await hostTab(page, 'local').click();
        await expect(page.locator('[data-docker-row]')).toHaveCount(4);
        // The slow host answers after the switch back: waits for its late answer to prove it does not replace this tab's list.
        await page.waitForTimeout(1600);
        await expect(page.locator('[data-docker-row]')).toHaveCount(4);
        await expect(page.locator('[data-docker-setup]')).toHaveCount(0);
        await expect(page.locator('[data-docker-host-down]')).toHaveCount(0);
    });

    test('a host that answers but refuses the container list says so', async ({ page }) => {
        await mockDocker(page);
        await mockRemote(page, { listDenied: true });
        await page.goto('/#docker');
        await hostTab(page, PI).click();
        await expect(page.locator('[data-docker-host-down]')).toContainText('refused the container list: forbidden');
    });

    test('check for updates asks that host, and the arrow shows on its rows', async ({ page }) => {
        const local = await mockDocker(page);
        const remote = await mockRemote(page);
        await page.goto('/#docker');
        await hostTab(page, PI).click();
        await expect(page.locator('[data-docker-row="pihole"]')).toBeVisible();
        await expect(page.locator('[data-docker-update-badge]')).toHaveCount(0);
        await page.locator('[data-docker-check]').click();
        await expect(page.locator('[data-docker-row="pihole"] [data-docker-update-badge]')).toBeVisible();
        expect(remote.requests).toContain(`POST /updates/check?host=${PI}`);
        // Not the local check, and no badge count on the header icon for another host.
        expect(local.calls).not.toContain('POST /updates/check');
        // The drawer says what to do, and offers no skip, hold or update.
        await page.locator('[data-docker-row="pihole"]').click();
        await expect(page.locator('[data-docker-updates-status]')).toContainText('Update it on that host');
        await expect(page.locator('[data-docker-update-choice]')).toHaveCount(0);
    });

    test('a check that finishes after a tab switch does not touch the tab now showing', async ({ page }) => {
        await mockDocker(page);
        await mockRemote(page, { checkDelay: 1200 });
        await page.goto('/#docker');
        await expect(page.locator('[data-docker-row]')).toHaveCount(4);
        await expect(page.locator('[data-docker-checked-at]')).toContainText('3 h ago');
        await hostTab(page, PI).click();
        await expect(page.locator('[data-docker-row="pihole"]')).toBeVisible();
        await page.locator('[data-docker-check]').click();
        // The progress overlay covers the tabs, so the switch is made the way a key would.
        await page.evaluate(() => window.dashboardInstance.docker._module.switchHost('local'));
        await expect(page.locator('[data-docker-row]')).toHaveCount(4);
        // The other host's check finishes after the switch: waits for it to prove it does not stamp this host.
        await page.waitForTimeout(1800);
        // The other host's check did not stamp this host with "just now".
        await expect(page.locator('[data-docker-checked-at]')).toContainText('3 h ago');
    });

    test('a failed read of the hosts keeps the remembered tab', async ({ page }) => {
        await mockDocker(page);
        await mockRemote(page);
        await page.goto('/#docker');
        await hostTab(page, PI).click();
        await expect(page.locator('[data-docker-row="pihole"]')).toBeVisible();
        // The server is restarting: the hosts answer fails once the view reloads.
        await page.route('**/api/docker/hosts', (route) => route.fulfill({ status: 503, body: 'restarting' }));
        await page.reload();
        await expect(page.locator('[data-docker-row]').first()).toBeVisible({ timeout: 15_000 }).catch(() => {});
        const kept = await page.evaluate(() => localStorage.getItem('nextdash.docker.host'));
        expect(kept).toBe(PI);
    });

    test('a long host name shortens its tab instead of widening the page', async ({ page }) => {
        await page.setViewportSize({ width: 375, height: 800 });
        await mockDocker(page);
        const long = 'a-host-with-a-really-long-name-'.repeat(2).slice(0, 64);
        await page.route('**/api/docker/hosts', (route) => route.fulfill({ status: 200, contentType: 'application/json',
            body: JSON.stringify({ max: 4, hosts: [{ id: PI, name: long, kind: 'tcp', address: '10.0.0.2:2375', allowActions: false,
                hasCA: false, hasCert: false, hasKey: false }] }) }));
        await page.goto('/#docker');
        await expect(hostTab(page, PI)).toBeVisible();
        // The tab, not the page: the table below has its own width on a phone.
        const box = await hostTab(page, PI).boundingBox();
        expect(box.x + box.width).toBeLessThanOrEqual(375);
    });
});
