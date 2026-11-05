// @ts-check
const { test, expect } = require('./fixtures');
const { dismissOnboardingIfPresent, dismissBlockingOverlays, markWhatsNewSeen } = require('./e2e-helpers');

/**
 * The `bell` and `tipSlot` options of NoticeCard.define: a card that reports to
 * the bell instead of (quiet) or as well as (urgent) the corner, and the one
 * tip slot per week. Cards are probes defined on the page.
 */

async function loadDashboard(page) {
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0 && window.NotificationBell, null, { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.evaluate(() => {
        // Marks and the tip time of a probe must not reach the shared ./data.
        window.DiscoverabilityState.schedulePersist = () => {};
        document.querySelectorAll('.quickstart-card').forEach((el) => el.remove());
        ['side-rail-try-v1', 'category-spread-v1']
            .forEach((id) => window.DiscoverabilityState?.markSettingPromoSeen?.(id, { persist: false }));
        const d = window.dashboardInstance;
        d.settings.quickStart = { ...(d.settings.quickStart || {}), analyticsChoiceMade: true };
        window.DiscoverabilityState.noteTipCardShown(0, { persist: false });
    });
}

const row = (page, id) => page.locator(`.notification-bell-row[data-bell-id="${id}"]`);

async function define(page, id, extra) {
    await page.evaluate(([i, e]) => {
        const spec = {
            id: i, showDelayMs: 50, title: () => `probe ${i}`, body: () => 'probe body',
            canShow: () => true,
            actions: [{ name: 'ok', label: () => 'ok', onClick: (card) => card.close() }],
        };
        const bell = { group: 'system', icon: '*', no: 'state', state: async () => ({ count: 1, text: `${i} text` }) };
        spec.bell = { ...bell, ...e.bell };
        if (e.tipSlot) spec.tipSlot = true;
        window[`__${i}`] = window.NoticeCard.define(spec);
        window[`__${i}`].autoStart();
    }, [id, extra]);
}

async function openBell(page) {
    await page.evaluate(() => window.NotificationBell.refreshAll());
    await page.evaluate(() => window.NotificationBell.open());
}

test.describe('NoticeCard bell option', () => {
    test('a quiet card is a bell row and never a corner card or toast', async ({ page }) => {
        await loadDashboard(page);
        await page.evaluate(() => {
            window.__toasts = 0;
            window.dashboardInstance.showNotification = () => { window.__toasts += 1; };
        });
        await define(page, 'probe-quiet', { bell: { kind: 'quiet' } });
        // Checks that nothing happens: a quiet notice must raise no toast, so give one a chance to appear.
        await page.waitForTimeout(1500);
        expect(await page.evaluate(() => window.__toasts)).toBe(0);
        await expect(page.locator('.probe-quiet-card')).toHaveCount(0);
        expect(await page.evaluate(() => window['__probe-quiet'].shouldShowSync())).toBe(false);
        expect(await page.evaluate(() => window['__probe-quiet'].shouldShow())).toBe(false);
        await openBell(page);
        await expect(row(page, 'probe-quiet')).toBeVisible();
    });

    test('an urgent card is in the corner and in the bell', async ({ page }) => {
        await loadDashboard(page);
        await define(page, 'probe-urgent', { bell: { kind: 'urgent' } });
        await expect(page.locator('.probe-urgent-card.show')).toBeVisible({ timeout: 15_000 });
        await openBell(page);
        await expect(row(page, 'probe-urgent')).toBeVisible();
    });

    test('registering twice does not double the row, and spec actions map to the bell', async ({ page }) => {
        await loadDashboard(page);
        await define(page, 'probe-twice', { bell: { kind: 'quiet' } });
        await page.evaluate(() => window['__probe-twice'].autoStart());
        await openBell(page);
        await expect(row(page, 'probe-twice')).toHaveCount(1);
        await expect(row(page, 'probe-twice').getByRole('button', { name: 'ok' })).toBeVisible();
        // close() with no corner card up is harmless.
        await row(page, 'probe-twice').getByRole('button', { name: 'ok' }).click();
    });

    test('without bell.state the row falls back to canShow with title and body', async ({ page }) => {
        await loadDashboard(page);
        await page.evaluate(() => {
            window.NoticeCard.define({
                id: 'probe-fallback', title: () => 'Fallback title', body: () => 'Fallback body',
                canShow: () => true,
                bell: { kind: 'quiet', group: 'cleanup', icon: '*', no: 'state' },
            }).autoStart();
        });
        await openBell(page);
        await expect(row(page, 'probe-fallback')).toContainText('Fallback title');
    });

    test('a quiet row stays on a phone with corner cards hidden', async ({ page }) => {
        await page.setViewportSize({ width: 390, height: 800 });
        await loadDashboard(page);
        await page.evaluate(() => {
            window.dashboardInstance.settings.hideCornerCardsMobile = true;
            window.isPhoneDevice = () => true;
        });
        await define(page, 'probe-phone', { bell: { kind: 'quiet' } });
        await openBell(page);
        // The bell stays in the narrow header, so the row is there to be seen.
        await expect(row(page, 'probe-phone')).toBeVisible();
        expect(await page.evaluate(() => window.NoticeCard.cornerIsFree('x'))).toBe(false);
    });
});

test.describe('NoticeCard tipSlot', () => {
    test('a drawn tip card holds the slot for seven days', async ({ page }) => {
        await loadDashboard(page);
        const result = await page.evaluate(async () => {
            const make = (id) => window.NoticeCard.define({
                id, tipSlot: true, title: () => id, body: () => 'b', canShow: () => true,
            });
            const a = make('tip-a');
            const b = make('tip-b');
            const before = await b.shouldShow();
            const drawn = await a.render();
            const DS = window.DiscoverabilityState;
            const stamped = DS.getTipCardShownAt() > 0;
            const during = await b.shouldShow();
            const duringSync = b.shouldShowSync();
            DS.noteTipCardShown(Date.now() - 8 * 24 * 3600 * 1000, { persist: false });
            a.close();
            await new Promise((r) => setTimeout(r, 400));
            const after = await b.shouldShow();
            return { before, drawn, stamped, during, duringSync, after };
        });
        expect(result).toEqual({ before: true, drawn: true, stamped: true, during: false, duringSync: false, after: true });
    });
});
