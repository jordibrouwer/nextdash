// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen } = require('./e2e-helpers');

/**
 * The bell's read and No marks live in settings.discoverabilityState.bell, so
 * they follow the person across reloads and browsers.
 */

async function openDashboard(page) {
    await page.goto('/');
    await page.waitForFunction(() => !!window.DiscoverabilityState?.init, null, { timeout: 15_000 });
}

async function serverBell(page) {
    return page.evaluate(async () => {
        const res = await fetch('/api/settings', { cache: 'no-store' });
        return (await res.json()).discoverabilityState?.bell || {};
    });
}

// The shared dev data dir keeps whatever a spec writes, so the probe row is
// removed afterwards: a record sent as {} is dropped by the server.
async function dropProbe(page) {
    await page.evaluate(async () => {
        const res = await fetch('/api/settings', { cache: 'no-store' });
        const ds = (await res.json()).discoverabilityState || {};
        ds.bell = { ...(ds.bell || {}), probe: {} };
        await window.nextDashFetch('/api/settings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ discoverabilityState: ds }),
        });
    });
}

test.describe('notification bell state', () => {
    test.beforeEach(async ({ page }) => {
        await markWhatsNewSeen(page);
    });

    test('a read mark survives a reload', async ({ page }) => {
        await openDashboard(page);
        try {
            await page.evaluate(() => window.DiscoverabilityState.markBellRead('probe', { count: 2 }));
            await expect.poll(async () => (await serverBell(page)).probe?.read?.count, { timeout: 10_000 }).toBe(2);
            await page.reload();
            await page.waitForFunction(() => !!window.DiscoverabilityState?.init, null, { timeout: 15_000 });
            const count = await page.evaluate(() => window.DiscoverabilityState.getBellRecord('probe').read?.count);
            expect(count).toBe(2);
            expect(await page.evaluate(() => window.DiscoverabilityState.getBellRecord('nothing-here'))).toEqual({});
        } finally {
            await dropProbe(page);
        }
    });

    test('a mark from one tab is not undone by another tab that reads', async ({ page, context }) => {
        await openDashboard(page);
        const other = await context.newPage();
        try {
            await markWhatsNewSeen(other);
            await openDashboard(other);
            await page.evaluate(() => window.DiscoverabilityState.markBellRead('probe', { count: 2 }));
            await expect.poll(async () => (await serverBell(page)).probe?.read?.count, { timeout: 10_000 }).toBe(2);
            // Tab B reads settings afterwards and marks nothing.
            await other.evaluate(async () => {
                await fetch('/api/settings', { cache: 'no-store' });
            });
            const fresh = await context.newPage();
            await markWhatsNewSeen(fresh);
            await openDashboard(fresh);
            expect(await fresh.evaluate(() => window.DiscoverabilityState.getBellRecord('probe').read?.count)).toBe(2);
            await fresh.close();

            // Tab B still holds the state from before the mark (the app's own
            // re-read on save would repair it, so the write goes out directly)
            // and saves a mark on another row: the server keeps A's row.
            await other.evaluate(async () => {
                await window.nextDashFetch('/api/settings', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ discoverabilityState: { bell: { 'probe-b': { read: { count: 1 } } } } }),
                });
            });
            expect((await serverBell(other))['probe-b']?.read?.count).toBe(1);
            expect((await serverBell(other)).probe?.read?.count).toBe(2);
        } finally {
            await other.evaluate(async () => {
                const res = await fetch('/api/settings', { cache: 'no-store' });
                const ds = (await res.json()).discoverabilityState || {};
                ds.bell = { ...(ds.bell || {}), 'probe-b': {} };
                await window.nextDashFetch('/api/settings', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ discoverabilityState: ds }),
                });
            });
            await other.close();
            await dropProbe(page);
        }
    });

    test('resetting the No answers clears only the forever ones, and it sticks', async ({ page }) => {
        await openDashboard(page);
        try {
            await page.evaluate(() => {
                const ds = window.DiscoverabilityState;
                ds.markBellRead('probe', { count: 4 });
                ds.markBellNo('probe', { count: 1, forever: true });
                ds.markBellNo('probe-soon', { count: 1 });
                ds.resetBellNo();
            });
            await expect.poll(async () => (await serverBell(page))['probe-soon']?.no?.count, { timeout: 10_000 }).toBe(1);
            expect((await serverBell(page)).probe?.no).toBeUndefined();
            await page.reload();
            await page.waitForFunction(() => !!window.DiscoverabilityState?.init, null, { timeout: 15_000 });
            const out = await page.evaluate(() => ({
                probe: window.DiscoverabilityState.getBellRecord('probe'),
                soon: window.DiscoverabilityState.getBellRecord('probe-soon'),
            }));
            expect(out.probe).toEqual({ read: { count: 4 } });
            expect(out.soon.no).toEqual({ count: 1 });
        } finally {
            await page.evaluate(async () => {
                const res = await fetch('/api/settings', { cache: 'no-store' });
                const ds = (await res.json()).discoverabilityState || {};
                ds.bell = { ...(ds.bell || {}), 'probe-soon': {} };
                await window.nextDashFetch('/api/settings', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ discoverabilityState: ds }),
                });
            });
            await dropProbe(page);
        }
    });
});
