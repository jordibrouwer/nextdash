// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * The Timer widget: a run is stored as the moment it ends, settles itself
 * without its widget on the page, rings once, and the three looks draw one state.
 * Time is the page clock, so a ten-minute timer takes no time to run.
 */

async function openDashboard(page) {
    await page.clock.install();
    await page.setViewportSize({ width: 1400, height: 900 });
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForSelector('#dashboard-layout', { timeout: 20_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.waitForFunction(() => window.dashboardInstance?._bookmarksReady === true && window.DashboardWidgets?.timer, null, { timeout: 20_000 });
    await page.evaluate(() => {
        localStorage.removeItem('nextdash-timer');
        localStorage.removeItem('nextdash-timer-rung');
        window.__rings = 0;
        window.__realPlaySound = window.NotificationBell.playSound;
        // The bell rings for its own rows too: count only the timer's.
        window.NotificationBell.playSound = (tone, keys) => { if ((keys || []).some((k) => String(k).startsWith('timer|'))) window.__rings += 1; };
    });
}

/** Draw a timer widget into a probe body; the settings are those of the widget. */
async function draw(page, config, id = 'probe') {
    await page.evaluate(({ config: cfg, id: wid }) => {
        let body = document.getElementById('probe-body');
        if (!body) {
            body = document.createElement('div');
            body.id = 'probe-body';
            document.body.appendChild(body);
        }
        window.__widget = { id: wid, type: 'timer', title: 'Pasta', config: cfg };
        window.DashboardWidgets.timer(body, window.__widget, window.dashboardInstance);
    }, { config, id });
}

const figure = (page) => page.locator('#probe-body .dashboard-timer-figure').innerText();
const primary = (page) => page.locator('#probe-body [data-timer-primary]');
const stateOf = (page) => page.locator('#probe-body .dashboard-timer').getAttribute('data-timer-state');

async function setHidden(page, hidden) {
    await page.evaluate((h) => {
        Object.defineProperty(document, 'hidden', { configurable: true, get: () => h });
        Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => (h ? 'hidden' : 'visible') });
        document.dispatchEvent(new Event('visibilitychange'));
    }, hidden);
}

test('a kitchen timer counts down, pauses, resumes and rings when done', async ({ page }) => {
    await openDashboard(page);
    await draw(page, { presets: ['1'] });
    expect(await stateOf(page)).toBe('idle');
    expect(await figure(page)).toBe('01:00');

    await primary(page).click();
    expect(await stateOf(page)).toBe('run');
    await page.clock.runFor(20_000);
    expect(await figure(page)).toBe('00:40');

    await primary(page).click(); // Pause
    expect(await stateOf(page)).toBe('pause');
    await page.clock.runFor(120_000);
    expect(await figure(page)).toBe('00:40');

    await primary(page).click(); // Resume
    await page.clock.runFor(41_000);
    expect(await stateOf(page)).toBe('done');
    expect(await page.evaluate(() => window.__rings)).toBe(1);

    await primary(page).click(); // Stop alarm
    expect(await stateOf(page)).toBe('idle');
    expect(await figure(page)).toBe('01:00');
});

test('a run survives a redraw and ends while its widget is not on the page', async ({ page }) => {
    await openDashboard(page);
    await draw(page, { presets: ['2'] });
    await primary(page).click();
    await page.clock.runFor(30_000);
    const endsAt = await page.evaluate(() => JSON.parse(localStorage.getItem('nextdash-timer')).probe.endsAt);

    // A real reload (the page clock keeps its time): same run, drawn again.
    await page.reload();
    await page.waitForFunction(() => window.dashboardInstance?._bookmarksReady === true && window.DashboardWidgets?.timer, null, { timeout: 20_000 });
    await page.evaluate(() => {
        window.__rings = 0;
        window.NotificationBell.playSound = (tone, keys) => { if ((keys || []).some((k) => String(k).startsWith('timer|'))) window.__rings += 1; };
    });
    await draw(page, { presets: ['2'] });
    expect(await stateOf(page)).toBe('run');
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('nextdash-timer')).probe.endsAt)).toBe(endsAt);

    // Gone from the page while it ends: it still settles and rings once.
    await page.evaluate(() => document.getElementById('probe-body').remove());
    await page.clock.runFor(100_000);
    const entry = await page.evaluate(() => JSON.parse(localStorage.getItem('nextdash-timer')).probe);
    expect(entry.finished).toBe(true);
    expect(await page.evaluate(() => window.__rings)).toBe(1);
});

test('a timer that ended in a hidden tab marks the title once and rings once', async ({ page }) => {
    await openDashboard(page);
    await draw(page, { presets: ['1'] });
    await primary(page).click();
    const running = await page.evaluate(() => localStorage.getItem('nextdash-timer'));
    await setHidden(page, true);
    await page.clock.runFor(90_000);
    expect(await page.evaluate(() => document.title)).toContain('⏰');
    // Another tab that read the run before it ended settles the same end: the claim keeps it quiet.
    await page.evaluate((before) => {
        localStorage.setItem('nextdash-timer', before);
        window.DashboardWidgetTimer.settleAll();
    }, running);
    expect(await page.evaluate(() => window.__rings)).toBe(1);

    await setHidden(page, false);
    expect(await page.evaluate(() => document.title)).not.toContain('⏰');
    expect(await stateOf(page)).toBe('done');
});

test('a pomodoro runs focus, short breaks and a long break in order', async ({ page }) => {
    await openDashboard(page);
    const phases = await page.evaluate(() => {
        const T = window.DashboardWidgetTimer;
        const cfg = T.cfgOf({ title: 'P', config: { mode: 'pomodoro', focusMinutes: 1, shortBreakMinutes: 1, longBreakMinutes: 1, rounds: 3, autoNext: false } });
        const entry = T.fresh(cfg, { day: '', count: 0 });
        const seen = [];
        let now = 1_000_000;
        for (let i = 0; i < 6; i += 1) {
            seen.push(entry.phase);
            T.start(entry, now);
            now = entry.endsAt + 1;
            T.settle(entry, now);
            T.acknowledge(entry);
        }
        return { seen, today: entry.today };
    });
    expect(phases.seen).toEqual(['focus', 'short', 'focus', 'short', 'focus', 'long']);
    expect(phases.today).toBe(3);
});

test('a pomodoro that goes on by itself walks every phase a sleeping laptop missed', async ({ page }) => {
    await openDashboard(page);
    const out = await page.evaluate(() => {
        const T = window.DashboardWidgetTimer;
        const cfg = T.cfgOf({ title: 'P', config: { mode: 'pomodoro', focusMinutes: 1, shortBreakMinutes: 1, longBreakMinutes: 1, rounds: 2, autoNext: true } });
        const entry = T.fresh(cfg, { day: '', count: 0 });
        T.start(entry, 0);
        // Focus, short, focus, long have ended (4 min); the next focus has run for 30 s.
        T.settle(entry, 4 * 60000 + 30000);
        return { phase: entry.phase, running: !!entry.endsAt, left: T.remaining(entry, 4 * 60000 + 30000), today: entry.today };
    });
    expect(out.phase).toBe('focus');
    expect(out.running).toBe(true);
    expect(out.left).toBe(30000);
    expect(out.today).toBe(2);
});

test('changing the settings does not touch a run that is going', async ({ page }) => {
    await openDashboard(page);
    await draw(page, { presets: ['5'] });
    await primary(page).click();
    await page.clock.runFor(60_000);
    await draw(page, { presets: ['30'], look: 'bar' });
    expect(await stateOf(page)).toBe('run');
    expect(await figure(page)).toBe('04:00');
});

test('each look draws the same state', async ({ page }) => {
    await openDashboard(page);
    for (const look of ['ring', 'bar', 'row']) {
        await draw(page, { look, presets: ['3'] }, `look-${look}`);
        await expect(page.locator(`#probe-body .dashboard-timer.is-${look}`)).toHaveCount(1);
        expect(await figure(page)).toBe('03:00');
        await expect(primary(page)).toHaveCount(1);
    }
});

test('a clock set back does not leave an impossible run', async ({ page }) => {
    await openDashboard(page);
    await page.evaluate(() => {
        const T = window.DashboardWidgetTimer;
        const cfg = T.cfgOf({ config: {} });
        const entry = T.fresh(cfg, { day: '', count: 0 });
        entry.endsAt = Date.now() + entry.total + 3_600_000;
        localStorage.setItem('nextdash-timer', JSON.stringify({ probe: entry }));
    });
    await draw(page, {});
    expect(await stateOf(page)).toBe('idle');
});

/* ---------- Review fixes ---------- */

test('a long break shows every round done, and the next focus starts the count again', async ({ page }) => {
    await openDashboard(page);
    await draw(page, { mode: 'pomodoro', focusMinutes: 1, shortBreakMinutes: 1, longBreakMinutes: 1, rounds: 2 });
    const line = () => page.locator('#probe-body .dashboard-timer-count').innerText();
    const dotsOn = () => page.locator('#probe-body .dashboard-timer-dot.is-on').count();
    expect(await line()).toContain('round 1 of 2');
    await primary(page).click();
    await page.clock.runFor(61_000);
    await primary(page).click(); // stop alarm -> short break
    expect(await dotsOn()).toBe(1);
    await primary(page).click();
    await page.clock.runFor(61_000);
    await primary(page).click(); // -> focus 2
    expect(await line()).toContain('round 2 of 2');
    await primary(page).click();
    await page.clock.runFor(61_000);
    await primary(page).click(); // -> long break
    expect(await page.locator('#probe-body .dashboard-timer').getAttribute('data-timer-phase')).toBe('long');
    expect(await line()).toContain('round 2 of 2');
    expect(await dotsOn()).toBe(2);
    await primary(page).click();
    await page.clock.runFor(61_000);
    await primary(page).click(); // -> focus, count starts again
    expect(await dotsOn()).toBe(0);
    expect(await line()).toContain('round 1 of 2');
});

test('skipping a focus phase does not count it', async ({ page }) => {
    await openDashboard(page);
    await draw(page, { mode: 'pomodoro', focusMinutes: 1, rounds: 2 });
    await page.locator('#probe-body .dashboard-timer-btn', { hasText: 'Skip' }).click();
    expect(await page.locator('#probe-body .dashboard-timer').getAttribute('data-timer-phase')).toBe('short');
    expect(await page.locator('#probe-body .dashboard-timer-dot.is-on').count()).toBe(0);
    expect(await page.locator('#probe-body .dashboard-timer-count').innerText()).toContain('0 today');
});

test('typing your own minutes and clicking Start starts at once', async ({ page }) => {
    await openDashboard(page);
    await draw(page, { presets: ['1'] });
    await page.locator('#probe-body .dashboard-timer-custom').fill('7');
    await primary(page).click();
    expect(await stateOf(page)).toBe('run');
    expect(await figure(page)).toBe('07:00');
});

test('the bell is asked once when a run ends, not every second while one runs', async ({ page }) => {
    await openDashboard(page);
    await draw(page, { presets: ['1'] });
    await page.evaluate(() => {
        window.__bellAsks = 0;
        const real = window.TimerBellSource.refresh;
        window.TimerBellSource.refresh = () => { window.__bellAsks += 1; return real(); };
    });
    await primary(page).click();
    await page.clock.runFor(30_000);
    expect(await page.evaluate(() => window.__bellAsks)).toBe(0);
    await page.clock.runFor(40_000);
    expect(await page.evaluate(() => window.__bellAsks)).toBe(1);
});

test('a pomodoro that goes on by itself still leaves a row to answer, until it is seen', async ({ page }) => {
    await openDashboard(page);
    await draw(page, { mode: 'pomodoro', focusMinutes: 1, shortBreakMinutes: 1, autoNext: true });
    await primary(page).click();
    await setHidden(page, true);
    await page.clock.runFor(70_000);
    const waiting = await page.evaluate(() => window.DashboardWidgetTimer.finished().map((f) => f.phase));
    expect(waiting).toEqual(['focus']);
    expect(await page.evaluate(() => document.title)).toContain('⏰');
    await setHidden(page, false);
    expect(await page.evaluate(() => window.DashboardWidgetTimer.finished().length)).toBe(0);
});

test('a settings change reaches a chain that runs by itself, at its next phase', async ({ page }) => {
    await openDashboard(page);
    await draw(page, { mode: 'pomodoro', focusMinutes: 1, shortBreakMinutes: 1, autoNext: true });
    await primary(page).click();
    await page.clock.runFor(10_000);
    // Saved with auto-next off and a 3 minute break while the focus phase is going.
    await draw(page, { mode: 'pomodoro', focusMinutes: 1, shortBreakMinutes: 3, autoNext: false });
    expect(await figure(page)).toBe('00:50');
    await page.clock.runFor(51_000);
    // The focus phase ended and, with auto-next off now, waits for an answer.
    expect(await stateOf(page)).toBe('done');
    await primary(page).click();
    expect(await figure(page)).toBe('03:00');
});

test('changing the kind of timer keeps a run that is going and switches when idle', async ({ page }) => {
    await openDashboard(page);
    await draw(page, { presets: ['5'] });
    await primary(page).click();
    await page.clock.runFor(10_000);
    await draw(page, { mode: 'pomodoro' });
    expect(await stateOf(page)).toBe('run');
    expect(await page.locator('#probe-body .dashboard-timer-count').count()).toBe(0);
    await primary(page).click(); // pause
    await page.locator('#probe-body .dashboard-timer-btn', { hasText: 'Reset' }).click();
    await draw(page, { mode: 'pomodoro' });
    expect(await page.locator('#probe-body .dashboard-timer-count').count()).toBe(1);
});

test('a deleted widget takes its run along, and no alarm follows it', async ({ page }) => {
    await openDashboard(page);
    await draw(page, { presets: ['1'] });
    await primary(page).click();
    await page.evaluate(() => window.DashboardWidgetTimer.forget('probe'));
    await page.clock.runFor(90_000);
    expect(await page.evaluate(() => window.__rings)).toBe(0);
    expect(await page.evaluate(() => localStorage.getItem('nextdash-timer'))).not.toContain('probe');
});

test('a stale idle run is dropped and a finished one is not', async ({ page }) => {
    await openDashboard(page);
    await page.evaluate(() => {
        const T = window.DashboardWidgetTimer;
        const old = T.fresh(T.cfgOf({ config: {} }), { day: '', count: 0 }, Date.now() - 40 * 86400000);
        const done = T.fresh(T.cfgOf({ config: {} }), { day: '', count: 0 }, Date.now() - 40 * 86400000);
        done.finished = true; done.left = 0; done.endedAt = Date.now() - 1000;
        localStorage.setItem('nextdash-timer', JSON.stringify({ old, done }));
        T.settleAll();
    });
    const ids = await page.evaluate(() => Object.keys(JSON.parse(localStorage.getItem('nextdash-timer'))));
    expect(ids).toEqual(['done']);
});

test('a free chime leaves the bell tone slot alone, a plain urgent tone does not', async ({ page }) => {
    await openDashboard(page);
    const out = await page.evaluate(async () => {
        const play = window.__realPlaySound;
        const slot = () => localStorage.getItem('nextdash-bell-sound-at');
        localStorage.removeItem('nextdash-bell-sound-at');
        await play('chime', ['free-key'], { free: true });
        const afterFree = slot();
        await play('chime', ['plain-key']);
        return { afterFree, afterPlain: slot() };
    });
    expect(out.afterFree).toBeNull();
    expect(out.afterPlain).not.toBeNull();
});

test('the settings tell about the timer, and the presets field has its own placeholder', async ({ page }) => {
    await openDashboard(page);
    const out = await page.evaluate(async () => {
        await window.dashboardInstance.config?.load?.();
        await (window.dashboardInstance.config?._module || window.dashboardInstance.config)?.ensureSection?.('widgets');
        const Config = window.DashboardConfig || window.dashboardInstance.config?.instance?.constructor;
        const cfg = Object.assign(Object.create(Config.prototype), {
            dash: window.dashboardInstance, t: (k, f) => f,
        });
        const fields = Config.WIDGET_SETTINGS.timer;
        const html = (key) => cfg.renderWidgetField(fields.find((f) => f.key === key), { config: {} }, 0);
        return { sound: html('sound'), presets: html('presets') };
    });
    expect(out.sound).toContain('lives in this browser only');
    expect(out.presets).toContain('Comma separated whole minutes');
    expect(out.presets).toContain('placeholder="1, 5, 10, 15"');
});
