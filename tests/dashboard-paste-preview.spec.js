// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissBlockingOverlays, dismissOnboardingIfPresent } = require('./e2e-helpers');

/**
 * The paste-choice modal shows what the pasted link is while the choice is
 * still open. The preview endpoint is stubbed so the answer, and how long it
 * takes, are the test's to decide.
 */

async function pasteUrl(page, url) {
    await page.focus('body');
    await page.evaluate((value) => {
        const event = new ClipboardEvent('paste', {
            bubbles: true,
            cancelable: true,
            clipboardData: new DataTransfer(),
        });
        event.clipboardData.setData('text/plain', value);
        document.dispatchEvent(event);
    }, url);
}

test.describe('paste choice preview', () => {
    test.beforeEach(async ({ page }) => {
        await markWhatsNewSeen(page);
        await page.goto('/');
        await page.waitForSelector('#dashboard-layout', { timeout: 15_000 });
        await dismissOnboardingIfPresent(page);
        await dismissBlockingOverlays(page);
        await page.waitForFunction(() => window.dashboardInstance?.pasteChoice != null, null, { timeout: 15_000 });
        await page.evaluate(() => {
            window.dashboardInstance.settings.inboxEnabled = true;
            window.dashboardInstance.settings.pasteDestination = 'ask';
            localStorage.removeItem('nextdash:paste-destination-v1');
        });
    });

    test('a pasted link shows its title and description in the modal', async ({ page }) => {
        let release;
        const gate = new Promise((resolve) => { release = resolve; });
        await page.route('**/api/bookmark-preview?*', async (route) => {
            await gate;
            await route.fulfill({
                json: {
                    url: 'https://paste-preview.example.com/',
                    title: 'Paste preview title',
                    description: 'What this page is about.',
                    domain: 'paste-preview.example.com',
                    image: '',
                    icon: '',
                },
            });
        });

        await pasteUrl(page, 'https://paste-preview.example.com/');
        const preview = page.locator('#paste-choice-modal.show #paste-choice-preview');
        await expect(preview).toHaveClass(/is-loading/);

        release();
        await expect(preview).not.toHaveClass(/is-loading/);
        await expect(preview.locator('.paste-choice-preview-title')).toHaveText('Paste preview title');
        await expect(preview.locator('.paste-choice-preview-desc')).toHaveText('What this page is about.');
    });

    test('a page with nothing to show leaves no empty card', async ({ page }) => {
        await page.route('**/api/bookmark-preview?*', (route) => route.fulfill({
            json: { url: 'https://bare.example.com/', title: '', description: '', image: '', domain: 'bare.example.com' },
        }));
        await pasteUrl(page, 'https://bare.example.com/');
        await expect(page.locator('#paste-choice-modal.show')).toBeVisible();
        await expect(page.locator('#paste-choice-preview')).toBeHidden();
    });

    test('an answer for a cancelled paste never lands in the next one', async ({ page }) => {
        const releases = new Map();
        await page.route('**/api/bookmark-preview?*', async (route) => {
            const target = new URL(route.request().url()).searchParams.get('url') || '';
            await new Promise((resolve) => releases.set(target, resolve));
            await route.fulfill({
                json: { url: target, title: `Title of ${new URL(target).host}`, description: '', image: '' },
            }).catch(() => { /* aborted by the page */ });
        });

        await pasteUrl(page, 'https://first.example.com/');
        await expect.poll(() => releases.has('https://first.example.com/')).toBe(true);
        await page.keyboard.press('Escape');
        await expect(page.locator('#paste-choice-modal.show')).toBeHidden();

        await pasteUrl(page, 'https://second.example.com/');
        await expect.poll(() => releases.has('https://second.example.com/')).toBe(true);
        // The current answer first, the stale one after it: the order in which
        // a slow first page would overwrite the second.
        releases.get('https://second.example.com/')();
        const title = page.locator('#paste-choice-preview .paste-choice-preview-title');
        await expect(title).toHaveText('Title of second.example.com');
        releases.get('https://first.example.com/')();
        await page.waitForTimeout(300);
        await expect(title).toHaveText('Title of second.example.com');
    });

    test('choosing while the preview loads goes straight to the form', async ({ page }) => {
        await page.route('**/api/bookmark-preview?*', () => { /* never answers */ });
        await pasteUrl(page, 'https://slow.example.com/');
        await expect(page.locator('#paste-choice-preview')).toHaveClass(/is-loading/);
        await page.keyboard.press('1');
        await expect(page.locator('#paste-choice-modal.show')).toBeHidden();
        await expect.poll(() => page.evaluate(() => {
            const field = [...document.querySelectorAll('input')]
                .find((el) => el.offsetParent && el.value === 'https://slow.example.com/');
            return !!field;
        })).toBe(true);
    });
});
