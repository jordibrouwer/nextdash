// @ts-check
const { test, expect } = require('@playwright/test');
const { dismissOnboardingIfPresent, dismissBlockingOverlays, markWhatsNewSeen } = require('./e2e-helpers');

async function loadDashboard(page) {
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
}

async function openWhatsNew(page) {
    await page.evaluate(async () => {
        await window.ensureWhatsNewLoaded?.();
        await window.openWhatsNewModal({ force: true });
    });
    await expect(page.locator('.whats-new-modal')).toBeVisible();
    await page.waitForFunction(
        () => !document.querySelector('.whats-new-modal .wn-content--loading'),
        null,
        { timeout: 15_000 }
    );
}

test.describe("what's new modal", () => {
    // The modal reports what the daily check found but no longer triggers one:
    // reading release notes and polling GitHub are separate jobs, and the manual
    // trigger lives in Config → Overview.
    test('shows the update status bar but no check button', async ({ page }) => {
        await loadDashboard(page);
        await openWhatsNew(page);
        await expect(page.locator('.whats-new-modal [data-wn-update-check]')).toHaveCount(1);
        await expect(page.locator('.whats-new-modal [data-wn-update-check-btn]')).toHaveCount(0);
    });

    test('the ko-fi link is safe to open externally', async ({ page }) => {
        await loadDashboard(page);
        await openWhatsNew(page);
        const kofi = page.locator('.whats-new-modal .wn-kofi-btn');
        await expect(kofi).toHaveAttribute('href', 'https://ko-fi.com/jordibrw');
        await expect(kofi).toHaveAttribute('rel', /noopener/);
    });

    test('shows a scroll hint when older releases exist', async ({ page }) => {
        await loadDashboard(page);
        await openWhatsNew(page);
        await expect(page.locator('.whats-new-modal [data-wn-load-hint]')).toBeVisible();
    });

    test('the update status is announced politely', async ({ page }) => {
        await loadDashboard(page);
        await openWhatsNew(page);
        const status = page.locator('.whats-new-modal [data-wn-update-status]');
        await expect(status).toHaveCount(1);
        await expect(status).toHaveAttribute('aria-live', 'polite');
    });

    test('shows dismiss when an update is available', async ({ page }) => {
        await loadDashboard(page);
        await page.evaluate(async () => {
            const origFetch = window.fetch;
            window.fetch = function (input, init) {
                const url = typeof input === 'string' ? input : input?.url || '';
                if (url.includes('/api/update-status')) {
                    return Promise.resolve(new Response(JSON.stringify({
                        enabled: true,
                        current: 'v2026.08.04',
                        latest: 'v9999.99.99',
                        updateAvailable: true,
                        releaseUrl: 'https://github.com/jordibrouwer/nextdash/releases/tag/v9999.99.99',
                    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
                }
                return origFetch.apply(this, arguments);
            };
            await window.nextdashRefreshUpdateStatus(true);
        });
        await openWhatsNew(page);
        await expect(page.locator('.whats-new-modal [data-wn-update-dismiss]')).toBeVisible();
    });

    test('uses translated close label from locales', async ({ page }) => {
        await loadDashboard(page);
        await openWhatsNew(page);
        const closeBtn = page.locator('.whats-new-modal .modal-button-name').first();
        await expect(closeBtn).not.toBeEmpty();
        await expect(closeBtn).not.toHaveText('Confirm');
    });
});
