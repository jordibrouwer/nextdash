// @ts-check
/** Shared Playwright e2e settings (write token, webServer env). */

const fs = require('fs');
const path = require('path');
const { expect } = require('@playwright/test');

const WRITE_TOKEN = process.env.NEXTDASH_WRITE_TOKEN || 'playwright-e2e-write-token';

/** Matches `DASHBOARD_RELEASE` in static/js/whats-new-stub.js */
const DASHBOARD_WHATS_NEW_RELEASE = (() => {
    const stubPath = path.join(__dirname, '..', 'static', 'js', 'whats-new-stub.js');
    const src = fs.readFileSync(stubPath, 'utf8');
    const match = src.match(/const DASHBOARD_RELEASE = '([^']+)'/);
    if (!match) {
        throw new Error('Could not read DASHBOARD_RELEASE from whats-new-stub.js');
    }
    return match[1];
})();

/** Env vars for the Playwright-managed `go run .` server. */
const E2E_WEB_SERVER_ENV = {
    NEXTDASH_WRITE_TOKEN: WRITE_TOKEN,
    NEXTDASH_DISABLE_PREFETCH: '1',
    ...(process.env.NEXTDASH_DATA_DIR ? { NEXTDASH_DATA_DIR: process.env.NEXTDASH_DATA_DIR } : {}),
};

/**
 * Mark the current dashboard What's new release as seen before navigation.
 * @param {import('@playwright/test').Page} page
 * @param {{ confirmCheatsheetPromo?: boolean, extraPromoConfirmedKeys?: string[] }} [options]
 */
async function markWhatsNewSeen(page, options = {}) {
    const release = DASHBOARD_WHATS_NEW_RELEASE;
    const confirmCheatsheetPromo = options.confirmCheatsheetPromo === true;
    const extraPromoConfirmedKeys = Array.isArray(options.extraPromoConfirmedKeys)
        ? options.extraPromoConfirmedKeys
        : [];
    await page.addInitScript(({ rel, confirmCheatsheet, extraKeys }) => {
        try {
            localStorage.setItem('nextdash:last-whats-new-dashboard-release', rel);
            localStorage.setItem('nextdash:whats-new-search-promo-release', rel);
            localStorage.setItem('nextdash:whats-new-search-promo-start', '0');
            if (confirmCheatsheet) {
                localStorage.setItem('nextdash:dashboard-cheatsheet-promo-confirmed-v1', '1');
            }
            extraKeys.forEach((key) => localStorage.setItem(key, '1'));
        } catch {
            // ignore
        }
    }, { rel: release, confirmCheatsheet: confirmCheatsheetPromo, extraKeys: extraPromoConfirmedKeys });
}

/** @param {import('@playwright/test').Page} page */
async function dismissWhatsNewIfPresent(page) {
    const modal = page.locator('#app-modal.show');
    if (await modal.count()) {
        await page.keyboard.press('Escape');
        await expect(modal).toHaveCount(0, { timeout: 5000 });
    }
}

/**
 * Dismiss What's new, search promo, and grid keyboard promo when they block interaction.
 * @param {import('@playwright/test').Page} page
 */
async function dismissBlockingOverlays(page) {
    await dismissWhatsNewIfPresent(page);
    const searchPromo = page.locator('.dashboard-search-promo');
    if (await searchPromo.count()) {
        await searchPromo.locator('button').first().click();
        await expect(searchPromo).toHaveCount(0, { timeout: 3000 });
    }
    const gridPromoClose = page.locator('.dashboard-grid-kbd-promo-close');
    if (await gridPromoClose.count()) {
        await page.evaluate(() => window.DashboardGridKeyboardPromo?.confirmPromo?.());
        await expect(page.locator('.dashboard-grid-kbd-promo')).toHaveCount(0, { timeout: 3000 });
    }
}

/** @param {import('@playwright/test').Page} page */
async function resetOnboarding(page) {
    await page.evaluate(async () => {
        localStorage.removeItem('nextDashOnboardingSeenV2');
        localStorage.removeItem('nextDashOnboardingVersionV2');
        const response = await fetch('/api/settings');
        if (!response.ok) return;
        const settings = await response.json();
        settings.onboardingCompleted = false;
        const api = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
        await api('/api/settings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(settings),
        });
    });
}

/** @param {import('@playwright/test').Page} page */
async function openOnboarding(page) {
    await page.goto('/');
    await resetOnboarding(page);
    await page.reload();
    await page.waitForSelector('.onboarding-card', { timeout: 15_000 });
}

/**
 * @param {import('@playwright/test').Page} page
 * @returns {Promise<{ current: number, total: number }>}
 */
async function getOnboardingProgress(page) {
    const text = await page.locator('.onboarding-progress').textContent();
    const match = text?.trim().match(/^(\d+)\/(\d+)$/);
    if (!match) {
        throw new Error(`Unexpected onboarding progress text: ${text}`);
    }
    return { current: Number(match[1]), total: Number(match[2]) };
}

/**
 * Click Next until the onboarding wizard reaches `targetStep` (1-based).
 * @param {import('@playwright/test').Page} page
 * @param {number} targetStep
 */
async function advanceOnboardingToStep(page, targetStep) {
    const progress = page.locator('.onboarding-progress');
    const next = page.locator('.onboarding-next');
    let { current, total } = await getOnboardingProgress(page);
    if (targetStep > total) {
        throw new Error(`Cannot advance to step ${targetStep}; onboarding has ${total} steps`);
    }
    while (current < targetStep) {
        await next.click();
        current += 1;
        await progress.waitFor({ state: 'visible' });
        await page.waitForFunction(
            (expected) => document.querySelector('.onboarding-progress')?.textContent?.trim() === expected,
            `${current}/${total}`,
        );
    }
}

/** @param {import('@playwright/test').Page} page */
async function dismissOnboardingIfPresent(page) {
    const card = page.locator('.onboarding-card');
    if (await card.count()) {
        await page.locator('.onboarding-skip').click();
        await card.waitFor({ state: 'hidden', timeout: 5000 });
    }
}

module.exports = {
    WRITE_TOKEN,
    DASHBOARD_WHATS_NEW_RELEASE,
    E2E_WEB_SERVER_ENV,
    markWhatsNewSeen,
    dismissWhatsNewIfPresent,
    dismissBlockingOverlays,
    resetOnboarding,
    openOnboarding,
    getOnboardingProgress,
    advanceOnboardingToStep,
    dismissOnboardingIfPresent,
};
