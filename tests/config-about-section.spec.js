// @ts-check
const { test, expect } = require('./fixtures');
const { dismissOnboardingIfPresent, dismissBlockingOverlays, markWhatsNewSeen } = require('./e2e-helpers');

/**
 * About is a section of the config rail, under Help.
 *
 * It was a ninth tab inside Help, which is where a reader goes to find out how
 * something works — not what this thing is, who wrote it, or where the release
 * notes are. Moving it out is only half the job: a section is a deep link, a
 * settings-jump target and a set of bound buttons, and the panels brought their
 * buttons with them.
 */

async function openConfig(page, section) {
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.evaluate((s) => { const c = window.dashboardInstance.config; if (s === 'appearance' || s === 'behavior') c[`${s}Tab`] = c[`${s}Tab`] || 'general'; return c.openConfigView(s); }, section);
    await expect(page.locator(`.config-nav-item[data-config-section="${section}"]`)).toHaveAttribute('aria-selected', 'true');
}

test.describe('About in the rail', () => {
    /*
     * About stays last. What sits above it changed when Logs became a section of
     * its own and landed between Help and About, so this checks the order the
     * rail is built from rather than naming the neighbour by hand.
     */
    test('sits last in the rail, in the order SECTIONS gives', async ({ page }) => {
        await openConfig(page, 'overview');
        const { rail, declared } = await page.evaluate(() => ({
            rail: [...document.querySelectorAll('[data-config-section]')]
                .map((e) => e.getAttribute('data-config-section')),
            declared: window.DashboardConfig.SECTIONS,
        }));
        expect(rail[rail.length - 1]).toBe('about');
        expect(rail).toEqual(declared);
    });

    test('Help no longer carries it as a tab', async ({ page }) => {
        await openConfig(page, 'help');
        await expect(page.locator('[data-help-tab]').first()).toBeVisible();
        const tabs = await page.locator('[data-help-tab]').evaluateAll((els) =>
            els.map((e) => e.getAttribute('data-help-tab')));
        // The first group is on the row; the rest stands under More topics.
        expect(tabs.length).toBeGreaterThanOrEqual(4);
        expect(tabs).not.toContain('about');
    });

    test('holds the wordmark and all three addresses', async ({ page }) => {
        await openConfig(page, 'about');
        await expect(page.locator('.help-about-mark img')).toBeVisible();
        await expect(page.locator('.config-about-hero a[href="https://nextdash.cc"]')).toHaveCount(1);
        await expect(page.locator('.config-about-hero a[href="https://github.com/jordibrouwer/nextDash"]')).toHaveCount(1);
        await expect(page.locator('#config-section-panel a[href*="jordibrw.nl"]')).toHaveCount(1);
    });
});

test.describe('a section is more than a panel', () => {
    test('#config/about opens it directly', async ({ page }) => {
        await markWhatsNewSeen(page);
        await page.goto('/#config/about');
        await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
        await dismissOnboardingIfPresent(page);
        await dismissBlockingOverlays(page);

        // Both the module and the loader that parses the hash before it arrives
        // have to know the name, or the link lands on Overview.
        await expect.poll(() => page.evaluate(() => window.dashboardInstance.config?.section),
            { timeout: 15_000 }).toBe('about');
        await expect(page.locator('.help-about-mark')).toBeVisible();
    });

    test('the release notes are not repeated here', async ({ page }) => {
        await openConfig(page, 'about');
        // What's new lives in Help → Getting started and beside the onboarding
        // switches in Behavior. A third copy on the colophon was a panel, not a
        // way in.
        await expect(page.locator('[data-help-action="whats-new"]')).toHaveCount(0);
        // The section is still what it was for: the wordmark, the prose and the
        // addresses.
        await expect(page.locator('.help-about-mark img')).toBeVisible();
        await expect(page.locator('#config-section-panel .wn-kofi-btn')).toBeVisible();
    });

    test('the settings jump points at the section and at its own tabs', async ({ page }) => {
        await openConfig(page, 'overview');
        const { entries, aboutTabs } = await page.evaluate(() => ({
            entries: window.dashboardInstance.config.buildSettingsJumpNavEntries()
                .filter((e) => e.section === 'about')
                .map((e) => ({ title: e.title, subTab: e.subTab })),
            aboutTabs: window.DashboardConfig.ABOUT_TABS,
        }));

        expect(entries.length).toBeGreaterThanOrEqual(1);
        // The original rule was that no entry carried a subTab at all, because
        // About had just stopped being a help tab and a leftover one would try
        // to open a tab that no longer existed. About has tabs of its own now —
        // the colophon and News & features — so the rule is that a subTab is one
        // of those, never a help tab it cannot open.
        for (const e of entries) {
            if (e.subTab) expect(aboutTabs).toContain(e.subTab);
        }
        expect(entries.map((e) => e.title).join(' ')).toMatch(/About nextDash/);
    });
});

test.describe('About tabs: Project, Install, News', () => {
    async function gotoHash(page, hash) {
        await markWhatsNewSeen(page);
        await page.goto(hash);
        await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
        await dismissOnboardingIfPresent(page);
        await dismissBlockingOverlays(page);
    }
    const selected = (page) => page.locator('[data-about-tab][aria-selected="true"]');

    test('about opens Project by default', async ({ page }) => {
        await openConfig(page, 'about');
        await expect(selected(page)).toHaveAttribute('data-about-tab', 'project');
        const ids = await page.locator('[data-about-tab]').evaluateAll((els) => els.map((e) => e.getAttribute('data-about-tab')));
        expect(ids).toEqual(['project', 'install', 'news']);
    });

    test('#config/about/colophon opens Project', async ({ page }) => {
        await gotoHash(page, '/#config/about/colophon');
        await expect(selected(page)).toHaveAttribute('data-about-tab', 'project');
    });

    test('#config/about/install selects the Install tab and writes the hash back', async ({ page }) => {
        await gotoHash(page, '/#config/about/install');
        await expect(selected(page)).toHaveAttribute('data-about-tab', 'install');
        expect(await page.evaluate(() => location.hash)).toBe('#config/about/install');
    });

    test("a stored aboutTab of 'colophon' is read as project", async ({ page }) => {
        await openConfig(page, 'about');
        await page.evaluate(() => { window.dashboardInstance.config.aboutTab = 'colophon'; window.dashboardInstance.config.render(); });
        await expect(selected(page)).toHaveAttribute('data-about-tab', 'project');
        expect(await page.evaluate(() => window.dashboardInstance.config.aboutTab)).toBe('project');
    });
});

test.describe('About → Install', () => {
    async function openInstall(page, aboutInfo) {
        await page.route('**/api/about-info', (route) => aboutInfo === 500
            ? route.fulfill({ status: 500, body: '{}' })
            : route.fulfill({ json: aboutInfo }));
        await openConfig(page, 'about');
        await page.evaluate(() => { const c = window.dashboardInstance.config; c.aboutTab = 'install'; c.render(); });
        await expect(page.locator('[data-about-fact="pages"]')).toBeVisible();
    }
    const info = {
        release: 'v9.9.9', buildVersion: 'dev', buildCommit: 'abc1234', goVersion: 'go1.25',
        os: 'linux', arch: 'arm64', startedAt: 1, uptimeSeconds: 93784, dataBytes: 2048,
    };

    test('shows the running release, the facts and server figures', async ({ page }) => {
        await openInstall(page, info);
        await expect(page.locator('[data-about-fact="platform"]')).toContainText('linux/arm64');
        await expect(page.locator('[data-about-fact="uptime"]')).toContainText('1d 2h');
        await expect(page.locator('[data-about-fact="data"]')).toContainText('2');
        for (const id of ['pages', 'categories', 'bookmarks', 'widgets', 'tags']) {
            await expect(page.locator(`[data-about-fact="${id}"]`)).toBeVisible();
        }
    });

    test('says a newer release is out and links it', async ({ page }) => {
        await page.route('**/api/update-status*', (route) => route.fulfill({ json: {
            enabled: true, current: 'v1.0.0', latest: 'v9.9.9', updateAvailable: true,
            releaseUrl: 'https://github.com/jordibrouwer/nextdash/releases/tag/v9.9.9',
        } }));
        await openInstall(page, info);
        await expect(page.locator('[data-about-release]')).toHaveText('v1.0.0');
        await expect(page.locator('[data-about-update-status] a')).toHaveAttribute('href', /releases\/tag\/v9\.9\.9/);
    });

    test('keeps the release and counts when about-info fails', async ({ page }) => {
        await openInstall(page, 500);
        await expect(page.locator('[data-about-fact="platform"]')).toContainText('Unavailable');
        await expect(page.locator('[data-about-fact="bookmarks"]')).toBeVisible();
    });

    test('diagnostics are Markdown and carry no addresses, names or paths', async ({ page }) => {
        await openInstall(page, info);
        // The facts arrive from the server after the tab is drawn; the diagnostics
        // are built from them, so wait until the platform is on the page.
        await expect(page.locator('[data-about-fact="platform"]')).toContainText('linux/arm64');
        const text = await page.evaluate(() => window.dashboardInstance.config.buildDiagnostics());
        expect(text.startsWith('### nextDash')).toBe(true);
        for (const h of ['### Environment', '### Counts', '### Features on', '### Browser']) expect(text).toContain(h);
        expect(text).toContain('linux/arm64');
        const names = await page.evaluate(() => (window.dashboardInstance.allBookmarks || []).flatMap((b) => [b.name, b.url]).filter(Boolean));
        // A bookmark may legitimately be called "nextDash"; the fixed headings say so too.
        for (const n of names.filter((v) => v.length > 8).slice(0, 50)) expect(text).not.toContain(n);
        expect(text).not.toMatch(/\/data\b|localhost|127\.0\.0\.1/);
    });

    test('Copy diagnostics puts the Markdown on the clipboard', async ({ page, context }) => {
        await context.grantPermissions(['clipboard-read', 'clipboard-write']);
        await openInstall(page, info);
        await page.locator('[data-about-action="copy-diagnostics"]').click();
        await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toContain('### nextDash');
    });
});
