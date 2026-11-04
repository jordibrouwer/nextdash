// @ts-check
const { test, expect } = require('./fixtures');
const { dismissOnboardingIfPresent, dismissBlockingOverlays, markWhatsNewSeen } = require('./e2e-helpers');

/**
 * The bell in the navigation bar: its badges, its panel and the marks it keeps.
 * Sources are probes registered straight on NotificationBell.
 */


/**
 * `persist: false` keeps the marks of a probe in the page: the tests share ./data
 * with the dev server and a stored mark would outlive them. Only the reload test
 * needs the server to hold one, and it uses an id of its own.
 */
async function loadDashboard(page, { persist = false } = {}) {
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0 && window.NotificationBell, null, { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.evaluate((keep) => {
        if (!keep) window.DiscoverabilityState.schedulePersist = () => {};
        window.__probeState = {};
        window.__handles = {};
        const probe = (id, group, kind, no, extra = {}) => {
            window.__probeState[id] = { count: 3, text: `${id} text` };
            window.__handles[id] = window.NotificationBell.register({
                id, group, kind, icon: '*', no,
                state: async () => window.__probeState[id],
                ...extra,
            });
        };
        probe('probe-quiet', 'cleanup', 'quiet', 'state');
        probe('probe-urgent', 'system', 'urgent', 'state');
        probe('probe-health', 'health', 'health', 'state');
        probe('probe-state', 'privacy', 'quiet', 'state');
        probe('probe-tip', 'tips', 'tip', 'forever');
        window.__probeState['probe-urgent'] = { count: 1, text: 'urgent text' };
        window.__probeState['probe-health'] = { count: 2, text: 'health text' };
        window.__probeState['probe-tip'] = { count: 1, text: 'tip text' };
        window.__probeState['probe-state'] = null;
    }, persist);
}

const refresh = (page) => page.evaluate(() => window.NotificationBell.refreshAll());
const setState = (page, id, value) => page.evaluate(([i, v]) => { window.__probeState[i] = v; }, [id, value]);
const counts = (page) => page.evaluate(() => window.NotificationBell.counts());
const grey = (page) => page.locator('.notification-bell-grey');
const red = (page) => page.locator('.notification-bell-red');
const row = (page, id) => page.locator(`.notification-bell-row[data-bell-id="${id}"]`);

async function openPanel(page) {
    await page.locator('.notification-bell-button').click();
    await expect(page.locator('.notification-bell-panel')).toBeVisible();
    // Under the bell and fully on screen, not clipped by the header.
    const box = await page.locator('.notification-bell-panel').boundingBox();
    const bell = await page.locator('.notification-bell-button').boundingBox();
    const vp = page.viewportSize();
    expect(box.y).toBeGreaterThanOrEqual(bell.y + bell.height);
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(vp.width);
    expect(await page.evaluate(() => {
        const r = document.querySelector('.notification-bell-panel').getBoundingClientRect();
        return document.elementFromPoint(r.left + 10, r.top + 10)?.closest('.notification-bell-panel') !== null;
    })).toBe(true);
}

test('the bell is the last element of the navigation bar, with or without the config button', async ({ page }) => {
    await loadDashboard(page);
    const lastIsBell = () => page.evaluate(() => document.querySelector('.header-destinations').lastElementChild.id);
    expect(await lastIsBell()).toBe('page-nav-bell-host');
    // The config link is created later when the setting turns it on: it must
    // still land before the bell.
    await page.evaluate(() => {
        document.querySelector('.config-link')?.remove();
        const d = window.dashboardInstance;
        d.settings.showConfigButton = true;
        d.visual?.updateConfigButtonVisibility?.() || d.updateConfigButtonVisibility?.();
    });
    expect(await page.locator('.header-destinations .config-link').count()).toBe(1);
    expect(await lastIsBell()).toBe('page-nav-bell-host');
});

test('a quiet row counts grey; Mark all read clears the number but keeps the row; only worse brings it back', async ({ page }) => {
    await loadDashboard(page);
    await setState(page, 'probe-urgent', null);
    await setState(page, 'probe-health', null);
    await setState(page, 'probe-tip', null);
    await setState(page, 'probe-quiet', { count: 3, text: 'quiet text' });
    await refresh(page);
    await expect(grey(page)).toHaveText('1');

    await openPanel(page);
    await page.getByRole('button', { name: 'Mark all read' }).click();
    await expect(grey(page)).toBeHidden();
    await expect(row(page, 'probe-quiet')).toBeVisible();

    await setState(page, 'probe-quiet', { count: 2, text: 'quiet text' });
    await refresh(page);
    await expect(grey(page)).toBeHidden();

    await setState(page, 'probe-quiet', { count: 4, text: 'quiet text' });
    await refresh(page);
    await expect(grey(page)).toHaveText('1');
});

test('urgent shows red, health has a row but adds no badge', async ({ page }) => {
    await loadDashboard(page);
    await setState(page, 'probe-quiet', null);
    await setState(page, 'probe-tip', null);
    await refresh(page);
    await expect(red(page)).toHaveText('1');
    await expect(grey(page)).toBeHidden();
    expect(await counts(page)).toEqual({ red: 1, grey: 0 });
    await openPanel(page);
    await expect(row(page, 'probe-health')).toBeVisible();
});

test('No hides a state row until it gets worse', async ({ page }) => {
    await loadDashboard(page);
    await setState(page, 'probe-state', { count: 2, text: 'state text' });
    await refresh(page);
    await openPanel(page);
    await row(page, 'probe-state').getByRole('button', { name: 'No', exact: true }).click();
    await expect(row(page, 'probe-state')).toHaveCount(0);

    await setState(page, 'probe-state', { count: 3, text: 'state text' });
    await refresh(page);
    await expect(row(page, 'probe-state')).toBeVisible();
});

test('a tip goes after Mark read and stays gone after a reload', async ({ page }) => {
    // A new id per run: the mark is stored on the server and cannot be taken back.
    const tipId = `probe-tip-${Date.now()}`;
    const registerTip = () => page.evaluate((id) => {
        window.NotificationBell.register({
            id, group: 'tips', kind: 'tip', icon: '*', no: 'forever',
            state: async () => ({ count: 1, text: 'tip text' }),
        });
        return window.NotificationBell.refreshAll();
    }, tipId);
    await loadDashboard(page, { persist: true });
    await registerTip();
    await openPanel(page);
    await row(page, tipId).getByRole('button', { name: 'Mark read' }).click();
    await expect(row(page, tipId)).toHaveCount(0);

    // Let the mark reach the server before leaving the page.
    await page.evaluate(() => window.dashboardInstance.saveSettings({ keys: ['discoverabilityState'] }));
    await page.reload();
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0 && window.NotificationBell, null, { timeout: 15_000 });
    await registerTip();
    await openPanel(page);
    await expect(row(page, tipId)).toHaveCount(0);
});

test('a source whose state throws is nothing, and the others stay', async ({ page }) => {
    const errors = [];
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    await loadDashboard(page);
    await page.evaluate(() => {
        window.NotificationBell.register({
            id: 'probe-throws', group: 'system', kind: 'urgent', icon: '*', no: 'state',
            state: async () => { throw new Error('boom'); },
        });
        return window.NotificationBell.refreshAll();
    });
    await openPanel(page);
    await expect(row(page, 'probe-throws')).toHaveCount(0);
    await expect(row(page, 'probe-urgent')).toBeVisible();
    expect(errors.filter((e) => /bell|boom/i.test(e))).toEqual([]);
});

test('actions with marksRead set read first, and the bell shows in the containers view', async ({ page }) => {
    await loadDashboard(page);
    await page.evaluate(() => {
        window.__acted = 0;
        window.NotificationBell.register({
            id: 'probe-late', group: 'cleanup', kind: 'quiet', icon: '*', no: 'state',
            state: async () => ({ count: 5, text: 'late text' }),
            actions: [{ label: () => 'Fix it', marksRead: true, onClick: () => { window.__acted++; } }],
        });
        return window.NotificationBell.refreshAll();
    });
    await openPanel(page);
    await row(page, 'probe-late').getByRole('button', { name: 'Fix it' }).click();
    expect(await page.evaluate(() => window.__acted)).toBe(1);
    expect(await page.evaluate(() => window.DiscoverabilityState.getBellRecord('probe-late').read.count)).toBe(5);

    await page.evaluate(() => { window.dashboardInstance.activeView = 'docker'; });
    await expect(page.locator('.notification-bell-button')).toBeVisible();
});
