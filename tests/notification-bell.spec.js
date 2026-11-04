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
        // The real quiet sources (maintenance, privacy) report on their own data;
        // these tests count only their probes, so put the real rows away.
        // (Not when the test persists: those marks would reach the shared ./data.)
        if (!keep) ['tag-suggestions-notice', 'health-review-notice', 'health-recheck-offer', 'kept-pile',
            'install-count-notice', 'analytics-notice', 'theme-studio-notice', 'docker-update-notice',
            'inbox-extension-notice', 'pwa-install-hint']
            .forEach((id) => window.DiscoverabilityState.markBellNo(id, { count: 1, ids: [], forever: true }, { persist: false }));
        // Keyboard tips are chosen on a timer, so switch them off rather than name them.
        window.dashboardInstance.settings.enableSessionTips = false;
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

test('No on a forever source stays hidden when its count rises, and the record says forever', async ({ page }) => {
    await loadDashboard(page);
    await page.evaluate(() => {
        window.__probeState['probe-forever'] = { count: 2, text: 'forever text' };
        window.NotificationBell.register({
            id: 'probe-forever', group: 'privacy', kind: 'quiet', icon: '*', no: 'forever',
            state: async () => window.__probeState['probe-forever'],
        });
        return window.NotificationBell.refreshAll();
    });
    await openPanel(page);
    await row(page, 'probe-forever').getByRole('button', { name: 'No', exact: true }).click();
    await expect(row(page, 'probe-forever')).toHaveCount(0);
    expect(await page.evaluate(() => window.DiscoverabilityState.getBellRecord('probe-forever').no.forever)).toBe(true);

    await setState(page, 'probe-forever', { count: 9, text: 'forever text' });
    await refresh(page);
    await expect(row(page, 'probe-forever')).toHaveCount(0);
});

test('the bell stays reachable on a phone, with a panel that fits the screen', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await loadDashboard(page);
    await refresh(page);
    const rect = await page.locator('.notification-bell-button').boundingBox();
    expect(rect).not.toBeNull();
    expect(rect.width).toBeGreaterThan(0);
    expect(rect.height).toBeGreaterThan(0);
    expect(rect.x).toBeGreaterThanOrEqual(0);
    expect(rect.x + rect.width).toBeLessThanOrEqual(390);
    await openPanel(page);
    const panel = await page.locator('.notification-bell-panel').boundingBox();
    expect(panel.x).toBeGreaterThanOrEqual(0);
    expect(panel.x + panel.width).toBeLessThanOrEqual(390);
    expect(panel.width).toBeLessThanOrEqual(360);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('a folded header keeps the bell while the other destinations go', async ({ page }) => {
    await page.setViewportSize({ width: 1000, height: 800 });
    await loadDashboard(page);
    // A zone that takes most of the row stands in for a long page name: the
    // measurement then has no room for the destinations and folds them.
    await page.evaluate(() => {
        const filler = document.createElement('div');
        filler.id = 'probe-filler';
        filler.innerHTML = '<span style="display:block;width:640px;height:10px"></span>';
        document.querySelector('.dashboard-section.section-controls .header-top').appendChild(filler);
        window.dashboardInstance.pageNav.fitHeaderZones();
    });
    expect(await page.evaluate(() => Number(document.body.getAttribute('data-header-fit')))).toBeGreaterThanOrEqual(1);
    await expect(page.locator('.notification-bell-button')).toBeVisible();
    await expect(page.locator('.library-link').first()).toBeHidden();
    expect(await page.evaluate(() => document.querySelector('.header-destinations').lastElementChild.id)).toBe('page-nav-bell-host');
    const rect = await page.locator('.notification-bell-button').boundingBox();
    expect(rect.x + rect.width).toBeLessThanOrEqual(1000);
});

test('onNo is called once with the row when No is pressed', async ({ page }) => {
    await loadDashboard(page);
    await page.evaluate(() => {
        window.__noCalls = [];
        window.NotificationBell.register({
            id: 'probe-onno', group: 'privacy', kind: 'quiet', icon: '*', no: 'forever',
            state: async () => ({ count: 1, text: 'onno text' }),
            onNo: (r) => window.__noCalls.push({ id: r.source.id, count: r.entry.count }),
        });
    });
    await refresh(page);
    await openPanel(page);
    await row(page, 'probe-onno').getByRole('button', { name: 'No', exact: true }).click();
    await expect(row(page, 'probe-onno')).toHaveCount(0);
    expect(await page.evaluate(() => window.__noCalls)).toEqual([{ id: 'probe-onno', count: 1 }]);
});

test('onRead is called once per read path, and not for a row that was already read', async ({ page }) => {
    await loadDashboard(page);
    await page.evaluate(() => {
        window.__reads = [];
        ['a', 'b', 'c'].forEach((n) => window.NotificationBell.register({
            id: `probe-read-${n}`, group: 'tips', kind: 'tip', icon: '*', no: 'forever',
            state: async () => ({ count: 1, text: `read ${n}` }),
            actions: n === 'b' ? [{ label: 'Do it', marksRead: true, onClick: () => {} }] : [],
            onRead: (r) => window.__reads.push(r.source.id),
        }));
    });
    await refresh(page);
    await openPanel(page);
    await row(page, 'probe-read-a').getByRole('button', { name: 'Mark read' }).click();
    await row(page, 'probe-read-b').getByRole('button', { name: 'Do it' }).click();
    expect(await page.evaluate(() => window.__reads)).toEqual(['probe-read-a', 'probe-read-b']);
    // Mark all read reaches the one row that is still unread, once; the read ones are gone.
    await page.locator('.notification-bell-markall').click();
    expect((await page.evaluate(() => window.__reads)).filter((id) => id === 'probe-read-c')).toEqual(['probe-read-c']);
    expect(await page.evaluate(() => window.__reads.filter((id) => id !== 'probe-read-c'))).toEqual(['probe-read-a', 'probe-read-b']);
    // Reading an already-read row again (the panel is closed over it) does not call it.
    await page.evaluate(() => window.NotificationBell.refreshAll());
    expect(await page.evaluate(() => window.__reads.length)).toBe(3);
});

test.describe('bringing dismissed rows back', () => {
    test('resetDismissed calls onReset only for sources whose forever No was cleared', async ({ page }) => {
        await loadDashboard(page);
        await page.evaluate(() => {
            window.__resets = [];
            const mk = (id, no) => window.NotificationBell.register({
                id, group: 'cleanup', kind: 'quiet', icon: '*', no,
                state: async () => ({ count: 1, text: `${id} text` }),
                onReset: () => window.__resets.push(id),
            });
            mk('reset-forever', 'forever');
            mk('reset-state', 'state');
            mk('reset-untouched', 'forever');
            const ds = window.DiscoverabilityState;
            ds.markBellNo('reset-forever', { count: 1, ids: [], forever: true }, { persist: false });
            ds.markBellNo('reset-state', { count: 1, ids: [] }, { persist: false });
        });
        const cleared = await page.evaluate(() => window.NotificationBell.resetDismissed());
        expect(cleared).toContain('reset-forever');
        expect(cleared).not.toContain('reset-state');
        expect(await page.evaluate(() => window.__resets)).toEqual(['reset-forever']);
    });
});

/**
 * The bell draws the eye. The classes come and go with the animations, so a
 * MutationObserver records every time one is added; playSound is stubbed to
 * count calls (the real one needs a user gesture).
 */
async function watchAttention(page) {
    await page.evaluate(() => {
        window.__seen = { shake: 0, pulse: 0, sound: 0 };
        window.NotificationBell.playSound = () => { window.__seen.sound++; };
        // A remove-then-add in one tick yields two records for one animation, so
        // count a class only when it was absent at the previous record.
        const on = new WeakMap();
        const obs = new MutationObserver((list) => list.forEach((m) => {
            if (m.attributeName !== 'class') return;
            const isBtn = m.target.classList.contains('notification-bell-button');
            const cls = isBtn ? 'is-shaking' : 'is-pulsing';
            if (!isBtn && !m.target.classList.contains('notification-bell-badge')) return;
            const was = (m.oldValue || '').split(/\s+/).includes(cls);
            if (!was && m.target.classList.contains(cls) && !on.get(m.target)) {
                window.__seen[isBtn ? 'shake' : 'pulse']++;
                on.set(m.target, true);
            }
            if (was) on.set(m.target, true); else if (!m.target.classList.contains(cls)) on.set(m.target, false);
        }));
        obs.observe(document.querySelector('.notification-bell-button'), { attributes: true, attributeOldValue: true, subtree: true });
    });
}
const seen = (page) => page.evaluate(() => window.__seen);

test('the bell shakes and pulses once on load when something is unread, without a sound', async ({ page }) => {
    // The clock holds the bell's own first refresh back until the watcher is in place.
    await page.clock.install();
    await loadDashboard(page);
    await page.evaluate(() => {
        window.__early = { shake: false, sound: 0 };
        window.NotificationBell.playSound = () => { window.__early.sound++; };
        new MutationObserver(() => {
            if (document.querySelector('.notification-bell-button.is-shaking') && document.querySelector('.notification-bell-badge.is-pulsing')) window.__early.shake = true;
        }).observe(document.querySelector('.notification-bell-button'), { attributes: true, subtree: true });
    });
    // The first refresh is the one the bell makes itself, a few seconds after load.
    await page.clock.runFor(4000);
    await page.waitForFunction(() => window.__early.shake, null, { timeout: 10_000 });
    // (Other notices call refreshAll as they load, before these probes exist, so a
    // sound may follow when the probes first show; that is a rise, not "on load".)
});

test('a refresh that finds more unread shakes, pulses and rings; the same or fewer does nothing', async ({ page }) => {
    await loadDashboard(page);
    await refresh(page);
    await page.waitForTimeout(1200); // let the load animation finish
    await watchAttention(page);

    // The badges count rows, so a new row is what raises the number.
    await setState(page, 'probe-state', { count: 1, text: 'new row' });
    await refresh(page);
    expect(await seen(page)).toMatchObject({ shake: 1, sound: 1 });
    expect((await seen(page)).pulse).toBeGreaterThan(0);

    await page.waitForTimeout(1200);
    await refresh(page); // same count
    await setState(page, 'probe-state', null);
    await refresh(page); // lower
    expect(await seen(page)).toMatchObject({ shake: 1, sound: 1 });
});

test('with bellSound off the bell still moves but stays silent', async ({ page }) => {
    await loadDashboard(page);
    await refresh(page);
    await page.waitForTimeout(1200);
    await watchAttention(page);
    await page.evaluate(() => { window.dashboardInstance.settings.bellSound = false; });
    await setState(page, 'probe-state', { count: 1, text: 'new row' });
    await refresh(page);
    expect(await seen(page)).toMatchObject({ shake: 1, sound: 0 });
});

test('a reminder pulses every minute without shaking, until the panel is opened', async ({ page }) => {
    await page.clock.install();
    await loadDashboard(page);
    await page.clock.runFor(4000); // the first refresh
    // It shakes and pulses on load; let that finish so only the reminder is seen.
    await page.locator('.notification-bell-button.is-shaking').waitFor({ timeout: 10_000 });
    await expect(page.locator('.notification-bell-badge.is-pulsing')).toHaveCount(0, { timeout: 5000 });
    await expect(page.locator('.notification-bell-button.is-shaking')).toHaveCount(0, { timeout: 5000 });
    await watchAttention(page);
    await page.clock.runFor(60_000);
    let now = await seen(page);
    expect(now.pulse).toBeGreaterThan(0);
    expect(now.shake).toBe(0);
    expect(now.sound).toBe(0);

    await page.locator('.notification-bell-button').click();
    await page.keyboard.press('Escape');
    const before = (await seen(page)).pulse;
    await page.clock.runFor(120_000);
    now = await seen(page);
    expect(now.pulse).toBe(before);
});

/** Enough extra quiet rows that the panel body has to scroll. */
async function addRows(page, n) {
    await page.evaluate((count) => {
        for (let i = 0; i < count; i++) {
            const id = `probe-extra-${i}`;
            window.__probeState[id] = { count: 1, text: `${id} text` };
            window.NotificationBell.register({ id, group: 'cleanup', kind: 'quiet', icon: '*', no: 'state', state: async () => window.__probeState[id] });
        }
    }, n);
    await refresh(page);
}

test('the panel head stays put while the body scrolls, with no scrollbar', async ({ page }) => {
    await loadDashboard(page);
    await addRows(page, 12);
    await openPanel(page);
    const body = page.locator('.notification-bell-body');
    const head = page.locator('.notification-bell-head');
    const offset = async () => (await head.boundingBox()).y - (await page.locator('.notification-bell-panel').boundingBox()).y;
    const before = await offset();
    expect(await body.evaluate((n) => n.scrollHeight > n.clientHeight)).toBe(true);
    expect(await body.evaluate((n) => getComputedStyle(n).scrollbarWidth)).toBe('none');
    await body.evaluate((n) => { n.scrollTop = n.scrollHeight; });
    // Measured from the panel's own top, so a page that settles by a pixel does not count.
    expect(await offset()).toBeCloseTo(before, 1);
    const after = await head.boundingBox();
    const panelBox = await page.locator('.notification-bell-panel').boundingBox();
    expect(after.y).toBeGreaterThanOrEqual(panelBox.y);
    expect(after.y + after.height).toBeLessThanOrEqual(panelBox.y + panelBox.height);
});

test('an arrow says there is more below, until the end, and scrolls on click', async ({ page }) => {
    await loadDashboard(page);
    await addRows(page, 12);
    await openPanel(page);
    const more = page.locator('.notification-bell-more');
    const body = page.locator('.notification-bell-body');
    await expect(more).toBeVisible();
    const top = await body.evaluate((n) => n.scrollTop);
    await more.click();
    await expect.poll(() => body.evaluate((n) => n.scrollTop)).toBeGreaterThan(top);
    await body.evaluate((n) => { n.scrollTop = n.scrollHeight; });
    await expect(more).toBeHidden();
});

test('no arrow when everything fits', async ({ page }) => {
    await loadDashboard(page);
    await setState(page, 'probe-quiet', null);
    await setState(page, 'probe-health', null);
    await setState(page, 'probe-tip', null);
    await refresh(page);
    await openPanel(page);
    await expect(page.locator('.notification-bell-more')).toBeHidden();
});
