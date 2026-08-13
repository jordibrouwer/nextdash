const { test, expect } = require('@playwright/test');
const { markWhatsNewSeen, dismissBlockingOverlays, dismissOnboardingIfPresent } = require('./e2e-helpers');

/**
 * guardUniqueName is the one gate every inline name edit goes through. It only
 * ever asked about duplicates and delegated emptiness to callers that never
 * picked it up, so a cleared name saved as "" and a pasted 500-character name
 * pushed buttons off the screen.
 */
async function openConfig(page) {
    await markWhatsNewSeen(page);
    await page.goto('/#config');
    await page.waitForSelector('#dashboard-layout', { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.waitForFunction(() => !!window.dashboardInstance?.config, null, { timeout: 20_000 });
}

test.describe('names are validated in one place', () => {
    test('an emptied name is refused and put back', async ({ page }) => {
        await openConfig(page);
        const result = await page.evaluate(() => {
            const c = window.dashboardInstance.config;
            let said = '';
            c.notify = (msg) => { said = msg; };
            const input = { value: '', focus() {}, select() {} };
            const ok = c.guardUniqueName(input, '   ', ['Other'], { previous: 'Alpha' });
            return { ok, said, restored: input.value };
        });
        expect(result.ok).toBe(false);
        expect(result.restored).toBe('Alpha');
        expect(result.said).toMatch(/name is required/i);
    });

    test('an over-long name is refused', async ({ page }) => {
        await openConfig(page);
        const result = await page.evaluate(() => {
            const c = window.dashboardInstance.config;
            let said = '';
            c.notify = (msg) => { said = msg; };
            const input = { value: 'x'.repeat(500), focus() {}, select() {} };
            const ok = c.guardUniqueName(input, 'x'.repeat(500), [], { previous: 'Alpha' });
            return { ok, said, restored: input.value };
        });
        expect(result.ok).toBe(false);
        expect(result.restored).toBe('Alpha');
        expect(result.said).toMatch(/too long/i);
    });

    test('a normal name still passes', async ({ page }) => {
        await openConfig(page);
        const ok = await page.evaluate(() => window.dashboardInstance.config
            .guardUniqueName({ value: 'Beta', focus() {}, select() {} }, 'Beta', ['Alpha'], { previous: 'Alpha' }));
        expect(ok).toBe(true);
    });

    // The server is reachable without the browser, so the cap lives there too.
    test('the server caps a name it is handed directly', async ({ page }) => {
        await openConfig(page);
        const saved = await page.evaluate(async () => {
            const c = window.dashboardInstance.config;
            const current = await (await fetch('/api/finders')).json();
            await c.writeFetch('/api/finders', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify([...current, { name: 'y'.repeat(300), searchUrl: 'https://e.example/?q=%s', shortcut: 'zz9' }]),
            });
            const after = await (await fetch('/api/finders')).json();
            const mine = after.find((f) => f.shortcut === 'zz9');
            // Put it back so the run stays clean.
            await c.writeFetch('/api/finders', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(current),
            });
            return mine?.name?.length ?? -1;
        });
        expect(saved).toBe(60);
    });
});
