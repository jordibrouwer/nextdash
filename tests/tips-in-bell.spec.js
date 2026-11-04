// @ts-check
const { test, expect } = require('./fixtures');
const { dismissOnboardingIfPresent, dismissBlockingOverlays, markWhatsNewSeen } = require('./e2e-helpers');

/**
 * The keyboard tips and the home-screen hint wait in the bell (group Tips)
 * until they are read; neither is a toast any more.
 */

async function load(page) {
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0 && window.NotificationBell && window.DashboardKeyboardTip && window.PwaInstallHint, null, { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.evaluate(() => {
        // Marks written here must not reach the ./data the dev server shares.
        window.DiscoverabilityState.schedulePersist = () => {};
        window.DiscoverabilityState.clearSeenTips({ persist: false });
        try { localStorage.removeItem('nextdash-keyboard-tip-current'); localStorage.removeItem('nextdash-keyboard-tips-offered'); } catch { /* none */ }
        window.dashboardInstance.settings.enableSessionTips = true;
        window.__toasts = 0;
        window.dashboardInstance.showNotification = () => { window.__toasts += 1; };
        window.AppNotification?.show && (window.AppNotification.show = () => { window.__toasts += 1; });
    });
}

const tipRow = (page, id) => page.locator(`.notification-bell-row[data-bell-id="${id}"]`);
const tick = (page) => page.evaluate(() => window.DashboardKeyboardTip.tick());
const openBell = async (page) => {
    await page.evaluate(() => window.NotificationBell.refreshAll());
    await page.evaluate(() => window.NotificationBell.open());
};

const tipRows = (page) => page.locator('.notification-bell-row[data-bell-id^="keyboard-tip:"]');
test.describe('tips in the bell', () => {
    test('two tips wait in the group Tips, as plain text, with no toast', async ({ page }) => {
        await load(page);
        const ids = await tick(page);
        expect(ids).toHaveLength(2);
        expect(new Set(ids).size).toBe(2);
        await openBell(page);
        await expect(tipRows(page)).toHaveCount(2);
        const row = tipRow(page, `keyboard-tip:${ids[0]}`);
        await expect(row).toBeVisible();
        await expect(page.locator('.notification-bell-group[data-bell-group="tips"]')).toContainText('Mark read');
        await expect(row.locator('.notification-bell-row-label')).not.toContainText('<code>');
        expect(await page.evaluate(() => window.__toasts)).toBe(0);
        // A second look keeps the same two.
        expect(await tick(page)).toEqual(ids);
        // A reload of the page the same day does too: the day is remembered.
        const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('nextdash-keyboard-tip-current')));
        expect(saved.ids).toEqual(ids);
    });

    test('a read tip is gone and leaves its slot empty for today; the next day brings two others', async ({ page }) => {
        await load(page);
        const ids = await tick(page);
        await openBell(page);
        await tipRow(page, `keyboard-tip:${ids[0]}`).getByRole('button', { name: 'Mark read' }).click();
        await expect(tipRow(page, `keyboard-tip:${ids[0]}`)).toHaveCount(0);

        // Settled at the click, with no refresh or tick in between.
        expect(await page.evaluate((t) => window.DiscoverabilityState.hasSeenTip(t), ids[0])).toBe(true);
        // Same day: the other one stays, the read one does not come back, no third.
        expect(await tick(page)).toEqual([ids[1]]);
        await page.evaluate(() => window.NotificationBell.refreshAll());
        await expect(tipRows(page)).toHaveCount(1);

        // The next day: two different ones come.
        await page.evaluate((v) => localStorage.setItem('nextdash-keyboard-tip-current', v), JSON.stringify({ day: '2000-01-01', ids }));
        const next = await tick(page);
        expect(next).toHaveLength(2);
        expect(next).not.toContain(ids[0]);
        expect(next).not.toContain(ids[1]);
        await openBell(page);
        await expect(tipRows(page)).toHaveCount(2);
    });

    test('unread tips are replaced the next day, without counting as seen', async ({ page }) => {
        await load(page);
        const ids = await tick(page);
        await page.evaluate((v) => localStorage.setItem('nextdash-keyboard-tip-current', v), JSON.stringify({ day: '2000-01-01', ids }));
        const next = await tick(page);
        expect(next).toHaveLength(2);
        for (const id of ids) {
            expect(next).not.toContain(id);
            expect(await page.evaluate((t) => window.DiscoverabilityState.hasSeenTip(t), id)).toBe(false);
        }
        await openBell(page);
        await expect(tipRows(page)).toHaveCount(2);
    });

    test('the older single-tip shapes still read as an earlier day', async ({ page }) => {
        await load(page);
        const ids = await tick(page);
        await page.evaluate((t) => localStorage.setItem('nextdash-keyboard-tip-current', JSON.stringify({ id: t, day: '2000-01-01' })), ids[0]);
        expect(await tick(page)).toHaveLength(2);
        await page.evaluate((t) => localStorage.setItem('nextdash-keyboard-tip-current', t), ids[0]);
        expect(await tick(page)).toHaveLength(2);
    });

    test('tips never offered before come first', async ({ page }) => {
        await load(page);
        const three = await page.evaluate(() => {
            const all = window.ConfigHelpTips.TIP_GROUPS.flatMap((g) => g.tips);
            const keep = all.slice(10, 13);
            localStorage.setItem('nextdash-keyboard-tips-offered', JSON.stringify(all.filter((id) => !keep.includes(id))));
            return keep;
        });
        const ids = await tick(page);
        expect(ids).toHaveLength(2);
        for (const id of ids) expect(three).toContain(id);
        // Offering a tip puts it on the list.
        const offered = await page.evaluate(() => JSON.parse(localStorage.getItem('nextdash-keyboard-tips-offered')));
        for (const id of ids) expect(offered).toContain(id);
    });

    test('with everything offered before, two still appear and they repeat', async ({ page }) => {
        await load(page);
        const { all, yesterday } = await page.evaluate(() => {
            const every = window.ConfigHelpTips.TIP_GROUPS.flatMap((g) => g.tips);
            localStorage.setItem('nextdash-keyboard-tips-offered', JSON.stringify(every));
            localStorage.setItem('nextdash-keyboard-tip-current', JSON.stringify({ day: '2000-01-01', ids: [every[0], every[1]] }));
            return { all: every, yesterday: [every[0], every[1]] };
        });
        const ids = await tick(page);
        expect(ids).toHaveLength(2);
        expect(new Set(ids).size).toBe(2);
        for (const id of ids) expect(all).toContain(id);
        // Not yesterday's, when that can be avoided.
        for (const id of ids) expect(yesterday).not.toContain(id);
        await openBell(page);
        await expect(tipRows(page)).toHaveCount(2);

        // A tip read on an earlier day comes round again as a new, unread row.
        await page.evaluate((t) => {
            window.DiscoverabilityState.markBellRead(`keyboard-tip:${t}`, { count: 1, ids: ['2000-01-01'] }, { persist: false });
            window.NotificationBell.refreshAll();
        }, ids[0]);
        await expect(tipRow(page, `keyboard-tip:${ids[0]}`)).toHaveClass(/is-unread/);
    });

    test('a tip read earlier today does not come back today', async ({ page }) => {
        await load(page);
        const ids = await tick(page);
        await openBell(page);
        await tipRow(page, `keyboard-tip:${ids[1]}`).getByRole('button', { name: 'Mark read' }).click();
        // The read is written once the row has slid away.
        await expect(tipRow(page, `keyboard-tip:${ids[1]}`)).toHaveCount(0);
        // Even if the day's record is lost and read again, today's mark keeps it out.
        await page.evaluate(() => window.NotificationBell.refreshAll());
        expect(await tick(page)).not.toContain(ids[1]);
        await expect(tipRow(page, `keyboard-tip:${ids[1]}`)).toHaveCount(0);
        expect(await page.evaluate(() => JSON.parse(localStorage.getItem('nextdash-keyboard-tip-current')).day)).toBe(await page.evaluate(() => {
            const d = new Date();
            return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        }));
    });

    test('with the Config toggle off there is no row', async ({ page }) => {
        await load(page);
        await page.evaluate(() => { window.dashboardInstance.settings.enableSessionTips = false; });
        expect(await tick(page)).toBeNull();
        await openBell(page);
        await expect(tipRows(page)).toHaveCount(0);
    });
});

test.describe('where a tip\'s button leads', () => {
    // Puts the given tip in the bell as today's tip and opens the bell.
    async function offerTip(page, id) {
        await page.evaluate((t) => {
            const d = new Date();
            const day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
            localStorage.setItem('nextdash-keyboard-tip-current', JSON.stringify({ id: t, day }));
        }, id);
        expect(await tick(page)).toContain(id);
        await openBell(page);
        return tipRow(page, `keyboard-tip:${id}`);
    }

    test('every tip resolves to a destination whose opener exists', async ({ page }) => {
        await load(page);
        await page.evaluate(() => window.dashboardInstance.config.load());
        const result = await page.evaluate(() => {
            const ids = window.ConfigHelpTips.TIP_GROUPS.flatMap((g) => g.tips);
            const kinds = {};
            const problems = [];
            for (const id of ids) {
                const dest = window.DashboardKeyboardTip.destinationOf(id);
                kinds[dest.kind] = (kinds[dest.kind] || 0) + 1;
                const action = window.DashboardKeyboardTip.actionFor(id);
                if ((dest.kind === 'none') !== (action === null)) problems.push(`${id}: button and destination disagree`);
                if (dest.kind !== 'none' && !window.DashboardKeyboardTip.hasOpener(dest)) problems.push(`${id}: no opener for ${dest.kind} ${dest.target}`);
                if (dest.kind === 'config') {
                    const [section, tab] = dest.target.split('/');
                    const hash = `#config/${dest.target}`;
                    if (!DashboardConfig.SECTIONS.includes(section)) problems.push(`${id}: no config section ${section}`);
                    else if (DashboardConfig.sectionFromHash(hash) !== section) problems.push(`${id}: ${hash} does not route to ${section}`);
                    else if (tab && DashboardConfig.subTabFromHash(hash) !== tab) problems.push(`${id}: ${hash} names no tab ${tab}`);
                }
            }
            const stray = Object.keys(window.DashboardKeyboardTip.TIP_DESTINATIONS).filter((id) => !ids.includes(id));
            return { problems, kinds, stray, total: ids.length };
        });
        expect(result.problems).toEqual([]);
        expect(result.stray).toEqual([]);
        // The cheat sheet is for tips about keys only: well under half of them.
        expect(result.kinds['cheat-sheet'] || 0).toBeLessThan(result.total / 10);
    });

    test('a config tip opens its Config tab', async ({ page }) => {
        await load(page);
        await page.evaluate(() => window.dashboardInstance.config.load?.());
        const row = await offerTip(page, 'tipMaintTrash');
        await row.getByRole('button', { name: 'Open Data & backups' }).click();
        await expect(tipRow(page, 'keyboard-tip:tipMaintTrash')).toHaveCount(0);
        await expect.poll(() => page.evaluate(() => window.location.hash)).toBe('#config/data-backups/trash');
        await expect.poll(() => page.evaluate(() => window.dashboardInstance.activeView)).toBe('config');
    });

    test('a view tip opens that view', async ({ page }) => {
        await load(page);
        await page.evaluate(() => window.dashboardInstance.config.load?.());
        const row = await offerTip(page, 'tipEditKeep');
        await row.getByRole('button', { name: 'Open the Inbox' }).click();
        await expect.poll(() => page.evaluate(() => window.dashboardInstance.activeView)).toBe('inbox');
    });

    test('the backdrop tip opens the theme studio', async ({ page }) => {
        await load(page);
        await page.evaluate(() => {
            window.__studio = 0;
            window.dashboardInstance.config.openThemeBrowser = async () => { window.__studio += 1; };
        });
        const row = await offerTip(page, 'tipTuneBackdrop');
        await row.getByRole('button', { name: 'Theme studio (Shift+A)' }).click();
        // The coloured answer runs once its row has slid away and the panel is closing.
        await expect.poll(() => page.evaluate(() => window.__studio)).toBe(1);
    });

    test('the Bookmarks view tip opens the Bookmarks view', async ({ page }) => {
        await load(page);
        const row = await offerTip(page, 'tipEditPanel');
        await row.getByRole('button', { name: 'Open the Bookmarks view' }).click();
        await expect.poll(() => page.evaluate(() => window.dashboardInstance.activeView)).toBe('library');
    });

    test('a tip with no place behind it has only Mark read', async ({ page }) => {
        await load(page);
        const row = await offerTip(page, 'tipEverydayEsc');
        await expect(row.getByRole('button')).toHaveCount(1);
        await expect(row.getByRole('button', { name: 'Mark read' })).toBeVisible();
    });

    test('a tip about the list of keys keeps the cheat sheet', async ({ page }) => {
        await load(page);
        await page.evaluate(() => window.dashboardInstance.config.load?.());
        const row = await offerTip(page, 'tipEverydayCheatsheet');
        await expect(row.getByRole('button', { name: 'Cheat sheet' })).toBeVisible();
    });
});

test.describe('the home-screen hint in the bell', () => {
    async function onAPhone(page) {
        await page.evaluate(() => {
            window.MobileExperience.isMobileLayout = () => true;
            window.MobileExperience.shouldShowDiscoverabilityUi = () => true;
            window.dashboardInstance.settings.onboardingCompleted = true;
            try { localStorage.removeItem('nextdash-pwa-installed-v2'); } catch { /* none */ }
            // A read mark for today may come from an earlier test on this
            // worker's server; an old day makes today's tip new again.
            window.DiscoverabilityState.markBellRead('pwa-install-hint', { count: 1, ids: ['2000-01-01'] }, { persist: false });
            window.__prompted = 0;
            const event = new Event('beforeinstallprompt', { cancelable: true });
            Object.assign(event, { prompt: async () => { window.__prompted += 1; }, userChoice: Promise.resolve({ outcome: 'dismissed' }) });
            window.dispatchEvent(event);
        });
    }

    test('it is a tip row with an Install button and no toast', async ({ page }) => {
        await load(page);
        await onAPhone(page);
        await page.evaluate(() => window.PwaInstallHint.maybeShow());
        await openBell(page);
        const row = tipRow(page, 'pwa-install-hint');
        await expect(row).toBeVisible();
        await expect(row).toContainText('home screen');
        expect(await page.evaluate(() => window.__toasts)).toBe(0);
        await row.getByRole('button', { name: 'Install' }).click();
        await expect(row).toHaveCount(0);
        expect(await page.evaluate(() => window.__prompted)).toBe(1);
    });

    test('Mark read lets it go for today; it comes back the next day', async ({ page }) => {
        await load(page);
        await onAPhone(page);
        await page.evaluate(() => window.PwaInstallHint.maybeShow());
        await openBell(page);
        await tipRow(page, 'pwa-install-hint').getByRole('button', { name: 'Mark read' }).click();
        await expect(tipRow(page, 'pwa-install-hint')).toHaveCount(0);
        await page.evaluate(() => window.NotificationBell.refreshAll());
        await expect(tipRow(page, 'pwa-install-hint')).toHaveCount(0);
        // Tomorrow: the read mark is for another day, so the tip is back, unread.
        await page.evaluate(() => {
            const rec = window.DiscoverabilityState.getBellRecord('pwa-install-hint');
            window.DiscoverabilityState.markBellRead('pwa-install-hint', { count: 1, ids: ['2000-01-01'] }, { persist: false });
            return rec;
        });
        await page.evaluate(() => window.NotificationBell.refreshAll());
        await expect(tipRow(page, 'pwa-install-hint')).toBeVisible();
        await expect(tipRow(page, 'pwa-install-hint')).toHaveClass(/is-unread/);
    });

    test('not once the app is installed', async ({ page }) => {
        await load(page);
        await onAPhone(page);
        await page.evaluate(() => window.dispatchEvent(new Event('appinstalled')));
        await page.evaluate(() => window.PwaInstallHint.maybeShow());
        await openBell(page);
        await expect(tipRow(page, 'pwa-install-hint')).toHaveCount(0);
        await page.evaluate(() => localStorage.removeItem('nextdash-pwa-installed-v2'));
    });

    test('not on a desktop layout', async ({ page }) => {
        await load(page);
        await onAPhone(page);
        await page.evaluate(() => { window.MobileExperience.isMobileLayout = () => false; });
        await page.evaluate(() => window.PwaInstallHint.maybeShow());
        await openBell(page);
        await expect(tipRow(page, 'pwa-install-hint')).toHaveCount(0);
    });
});
