// @ts-check
const fs = require('fs');
const path = require('path');
const { test, expect } = require('./fixtures');
const { dismissOnboardingIfPresent, dismissBlockingOverlays, markWhatsNewSeen } = require('./e2e-helpers');

/**
 * "Updated from vX to vY": the card that names both versions once the release
 * notes are closed, and the honest unread count in the notes' own header.
 */

const OLD_RELEASE = '2026.08-dashboard-release-v1.3.0';
const SEEN_KEY = 'nextdash:last-whats-new-dashboard-release';

async function load(page) {
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
}

/** A browser that last read `lastSeen` (a release token), onboarding done. */
async function visitAfterUpgrade(page, lastSeen = OLD_RELEASE) {
    await load(page);
    await page.evaluate((release) => {
        window.DiscoverabilityState?.setLastWhatsNewRelease?.(release);
        localStorage.setItem('nextdash:last-whats-new-dashboard-release', release);
        window.DiscoverabilityState?.resetSettingPromoSeen?.(`updated-${String(window.NEXTDASH_WHATS_NEW_RELEASE).replace(/^.*-(v)/, '$1')}`, { persist: false });
    }, lastSeen);
    await dismissOnboardingIfPresent(page);
    // The analytics invitation wants the same corner a second later; when it won
    // the race, this card waited behind it and never came. Answered here, so only
    // the card under test is in the queue (saved with the setting below).
    await page.evaluate(() => {
        const d = window.dashboardInstance;
        d.settings.quickStart = { ...(d.settings.quickStart || {}), analyticsChoiceMade: true };
    });
    await page.evaluate(() => window.dashboardInstance.config.setBehavior('onboardingCompleted', true, ''));
    await expect.poll(() => page.evaluate(async () =>
        (await (await fetch('/api/settings')).json()).onboardingCompleted)).toBe(true);
    await load(page);
}

const card = (page) => page.locator('.updated-notice-card');

test.describe('the updated notice', () => {
    test('appears after the notes are closed and names both versions', async ({ page }) => {
        await visitAfterUpgrade(page);
        const modal = page.locator('.whats-new-modal');
        await expect(modal).toBeVisible({ timeout: 20_000 });
        // Not on top of the notes.
        await expect(card(page)).toHaveCount(0);
        const to = await page.evaluate(() => String(window.NEXTDASH_WHATS_NEW_RELEASE).replace(/^.*-v/, 'v'));
        await page.keyboard.press('Escape');
        await expect(card(page)).toBeVisible({ timeout: 15_000 });
        await expect(card(page)).toContainText('Updated from v1.3.0 to ' + to);
        await expect(card(page)).not.toContainText('dashboard.updatedNotice');
        // Answering it once is final.
        await card(page).locator('[data-updated-notice-action="dismiss"]').click();
        await expect(card(page)).toHaveCount(0);
        expect(await page.evaluate(() => window.DashboardUpdatedNotice.shouldShow())).toBe(false);
    });

    test('"What\'s new" reopens the notes', async ({ page }) => {
        await visitAfterUpgrade(page);
        await expect(page.locator('.whats-new-modal')).toBeVisible({ timeout: 20_000 });
        // The notes have loaded: on a busy runner Escape could close them while they were still loading.
        await expect(page.locator('.whats-new-modal [data-wn-content]')).toBeVisible({ timeout: 20_000 });
        await page.keyboard.press('Escape');
        await expect(card(page)).toBeVisible({ timeout: 15_000 });
        await card(page).locator('[data-updated-notice-action="open"]').click();
        await expect(page.locator('.whats-new-modal [data-wn-content]')).toBeVisible();
        await expect(card(page)).toHaveCount(0);
    });

    test('is not shown to a fresh install, the same version or with the setting off', async ({ page }) => {
        // Same version: already read.
        await markWhatsNewSeen(page);
        await load(page);
        await dismissOnboardingIfPresent(page);
        expect(await page.evaluate(() => window.__nextdashUpdatedFrom || null)).toBeNull();
        expect(await page.evaluate(() => window.DashboardUpdatedNotice.shouldShow())).toBe(false);

        // Fresh install: nothing on record.
        const captured = await page.evaluate(() => {
            const p = window.dashboardInstance.promos || window.DashboardPromos;
            const probe = Object.create(window.DashboardPromos.prototype);
            probe.captureUpdatedFrom('', window.NEXTDASH_WHATS_NEW_RELEASE);
            return window.__nextdashUpdatedFrom || null;
        });
        expect(captured).toBeNull();

        // Setting off, though an update was captured.
        await page.evaluate(() => {
            window.__nextdashUpdatedFrom = { from: 'v1.0.0', to: 'v9.9.9' };
            window.DiscoverabilityState?.resetSettingPromoSeen?.('updated-v9.9.9', { persist: false });
        });
        expect(await page.evaluate(() => window.DashboardUpdatedNotice.shouldShow())).toBe(true);
        await page.evaluate(() => { window.dashboardInstance.settings.enableUpdatedNotice = false; });
        expect(await page.evaluate(() => window.DashboardUpdatedNotice.shouldShow())).toBe(false);
        await page.evaluate(() => { window.dashboardInstance.settings.enableUpdatedNotice = true; });
        // Answered.
        await page.evaluate(() => window.DiscoverabilityState.markSettingPromoSeen('updated-v9.9.9'));
        expect(await page.evaluate(() => window.DashboardUpdatedNotice.shouldShow())).toBe(false);
        await page.evaluate(() => window.DiscoverabilityState.resetSettingPromoSeen?.('updated-v9.9.9', { persist: false }));
    });

    test('capture ignores the demo, unparsable tokens and an unchanged version', async ({ page }) => {
        await markWhatsNewSeen(page);
        await load(page);
        const results = await page.evaluate(() => {
            const probe = Object.create(window.DashboardPromos.prototype);
            const out = [];
            const run = (a, b, demo) => {
                window.__nextdashUpdatedFrom = undefined;
                const saved = window.DemoLock;
                if (demo) window.DemoLock = { on: true };
                probe.captureUpdatedFrom(a, b);
                window.DemoLock = saved;
                out.push(window.__nextdashUpdatedFrom || null);
            };
            run('2026.08-dashboard-release-v1.3.0', '2026.10-dashboard-release-v1.22.0', false);
            run('2026.08-dashboard-release-v1.3.0', '2026.10-dashboard-release-v1.22.0', true);
            run('garbage', '2026.10-dashboard-release-v1.22.0', false);
            run('2026.10-dashboard-release-v1.22.0', '2026.10-dashboard-release-v1.22.0', false);
            window.__nextdashUpdatedFrom = undefined;
            return out;
        });
        expect(results).toEqual([{ from: 'v1.3.0', to: 'v1.22.0' }, null, null, null]);
    });
});

test.describe('the since-line counts every unread release', () => {
    test('more than six unread are all counted', async ({ page }) => {
        const tags = [];
        for (let i = 9; i >= 1; i -= 1) tags.push(`v9.${i}.0`);
        const releases = {};
        tags.forEach((tag, i) => {
            releases[tag] = { tag, date: '1 December 2026', releasedAt: `2026-12-${String(20 - i).padStart(2, '0')}`,
                sections: [{ title: 'Alpha', items: [{ badge: 'new', text: `<strong>${tag}.</strong> Words.` }] }] };
        });
        releases['v8.0.0'] = { tag: 'v8.0.0', date: '1 November 2026', releasedAt: '2026-11-01', sections: [] };
        const index = Object.values(releases).map(({ tag, date, releasedAt }) => ({ id: tag, tag, date, releasedAt }));
        await page.route('**/static/data/whats-new/**', (route) => {
            const file = new URL(route.request().url()).pathname.split('/static/data/whats-new/')[1];
            if (file === 'index.json') return route.fulfill({ json: index });
            const rel = releases[file.replace(/\.json$/, '')];
            return rel ? route.fulfill({ json: rel }) : route.fulfill({ status: 404, body: '' });
        });
        await markWhatsNewSeen(page);
        await load(page);
        await dismissOnboardingIfPresent(page);
        await dismissBlockingOverlays(page);
        await page.evaluate(async () => {
            window.DiscoverabilityState.getLastWhatsNewRelease = () => '2026.12-dashboard-release-v8.0.0';
            await window.ensureWhatsNewLoaded?.();
            await window.openWhatsNewModal({ force: true, markSeenOnConfirm: false });
        });
        const since = page.locator('.whats-new-modal [data-wn-since]');
        await expect(since).toContainText('9 releases');
        await expect(page.locator('.whats-new-modal .wn-rel')).toHaveCount(6);
    });
});
