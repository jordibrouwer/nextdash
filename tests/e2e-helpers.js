// @ts-check
/** Shared Playwright e2e settings (write token, webServer env). */

const WRITE_TOKEN = process.env.NEXTDASH_WRITE_TOKEN || 'playwright-e2e-write-token';

/** Env vars for the Playwright-managed `go run .` server. */
const E2E_WEB_SERVER_ENV = {
    NEXTDASH_WRITE_TOKEN: WRITE_TOKEN,
};

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
    E2E_WEB_SERVER_ENV,
    resetOnboarding,
    openOnboarding,
    getOnboardingProgress,
    advanceOnboardingToStep,
    dismissOnboardingIfPresent,
};
