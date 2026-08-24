// @ts-check
const { test, expect } = require('@playwright/test');
const { prepareDashboardInteraction } = require('./e2e-helpers');

/**
 * The Health tab of config help.
 *
 * The prose is translator-supplied HTML dropped into the page unescaped, so the
 * risks are a missing key rendering as `config.helpFoo` and markup that never
 * closes. Both are invisible until someone opens the tab, which is why they are
 * asserted here rather than trusted.
 */

async function openHelpTab(page, tab) {
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
    await prepareDashboardInteraction(page);
    await page.evaluate(() => window.dashboardInstance.config.openConfigView('help'));
    await page.waitForSelector(`[data-help-tab="${tab}"]`, { timeout: 15_000 });
    await page.locator(`[data-help-tab="${tab}"]`).click();
    await page.waitForSelector('#config-help-body .config-panel', { timeout: 15_000 });
}

async function openHealthHelp(page) {
    await openHelpTab(page, 'health');
}

async function openMonitoringHelp(page) {
    await openHelpTab(page, 'monitoring');
}

async function openInboxHelp(page) {
    await openHelpTab(page, 'inbox');
}

test.describe('config help — health', () => {
    test('splits into three panels, each with real prose', async ({ page }) => {
        await openHealthHelp(page);

        const body = page.locator('#config-help-body');
        // Availability, working the list, and the walkthrough. The monitoring
        // half — uptime, expectations, certificates, drift, maintenance windows
        // and alerts — is its own tab, asserted below.
        await expect(body.locator('.config-panel')).toHaveCount(3);

        // A missing key renders as the key itself; nothing here may look like one.
        await expect(body).not.toContainText('config.help');

        for (const prose of await body.locator('.config-help-prose').all()) {
            // Rendered as markup, not shown as escaped tags.
            await expect(prose.locator('p').first()).toBeVisible();
            expect((await prose.textContent())?.trim().length).toBeGreaterThan(200);
            await expect(prose).not.toContainText('<p>');
        }
    });

    // Split with the tabs: the fleet numbers and the trend are the monitoring
    // half, while the interval picker and the tiles belong to the row and the
    // list — which is what Health still covers.
    test('covers the collection-wide statistics, not just per-row ones', async ({ page }) => {
        await openMonitoringHelp(page);
        const body = page.locator('#config-help-body');

        // The panel above the Monitored list.
        await expect(body).toContainText(/All monitors/i);
        await expect(body).toContainText(/Least available/i);
        await expect(body).toContainText(/Slower than last week/i);
        await expect(body).toContainText(/Outages/i);

        // The trend, and the reason its axis is fixed.
        await expect(body).toContainText(/0–100/);
        await expect(body).toContainText(/90 days/i);
    });

    test('covers the interval picker and the tiles that sound alike', async ({ page }) => {
        await openHealthHelp(page);
        const body = page.locator('#config-help-body');

        await expect(body).toContainText(/Check interval/i);
        await expect(body).toContainText(/Stale/i);
        await expect(body).toContainText(/Unused/i);
    });

    test('covers drift detection: all three kinds, and how a baseline is set', async ({ page }) => {
        await openMonitoringHelp(page);
        const body = page.locator('#config-help-body');

        await expect(body).toContainText(/Watch for redirects, retitling and rewrites/i);
        await expect(body).toContainText(/baseline/i);
        await expect(body).toContainText(/Redirect drift/i);
        await expect(body).toContainText(/Title drift/i);
        await expect(body).toContainText(/Content drift/i);
        // The row badges the prose says to expect.
        await expect(body).toContainText(/Moved/);
        await expect(body).toContainText(/Retitled/);
        await expect(body).toContainText(/Changed/);
    });

    test('covers focus mode, including the key and where it starts', async ({ page }) => {
        await openHealthHelp(page);
        const body = page.locator('#config-help-body');

        await expect(body).toContainText(/Work through/);
        // The key is the part someone comes back to the help for.
        await expect(body.locator('code', { hasText: /^f$/ }).first()).toBeVisible();
        // The two behaviours that are not guessable from the button.
        await expect(body).toContainText(/starts at the row your cursor is on/i);
        await expect(body).toContainText(/rather than quietly wrapping/i);
    });

    test('covers accepting drift: what it clears and what it asserts', async ({ page }) => {
        await openMonitoringHelp(page);
        const body = page.locator('#config-help-body');

        await expect(body).toContainText(/Accept drift/);
        // Clearing the baseline as well as the finding is the whole mechanism.
        await expect(body).toContainText(/drops the baseline/i);
        // And the consequence a user has to understand before clicking it.
        await expect(body).toContainText(/would be marked healthy/i);
    });

    test('covers per-bookmark muting and the burst digest', async ({ page }) => {
        await openMonitoringHelp(page);
        const body = page.locator('#config-help-body');

        await expect(body).toContainText(/Do not alert me about this bookmark/);
        await expect(body).toContainText(/Muted/);
        // Muting withholds the message, not the check — the distinction the
        // badge exists for.
        await expect(body).toContainText(/still checked/i);
        // And that un-muting mid-outage is not silently swallowed.
        await expect(body).toContainText(/Un-muting during an outage still alerts/i);

        // The digest, and the reason it exists rather than just its behaviour.
        await expect(body).toContainText(/collapsed into one message/i);
        await expect(body).toContainText(/rate-limit/i);
    });

    test('covers maintenance windows: what they exclude and what they do not', async ({ page }) => {
        await openMonitoringHelp(page);
        const body = page.locator('#config-help-body');

        await expect(body).toContainText(/Maintenance windows/i);
        await expect(body).toContainText(/past midnight/i);
        // The nuance that matters: checks still run, only the alerting is held back.
        await expect(body).toContainText(/heartbeat still records/i);
    });

    test('covers every notification preset and the test-send button', async ({ page }) => {
        await openMonitoringHelp(page);
        const body = page.locator('#config-help-body');

        for (const service of ['Slack', 'Discord', 'Telegram', 'Pushover', 'ntfy', 'Raw JSON']) {
            await expect(body, `mentions ${service}`).toContainText(service);
        }
        await expect(body).toContainText(/Chat ID/i);
        await expect(body).toContainText(/application token/i);
        await expect(body).toContainText(/user key/i);
        await expect(body).toContainText(/Send test alert/i);
    });

    test('the walkthrough ties every setting to one worked example', async ({ page }) => {
        await openHealthHelp(page);
        const body = page.locator('#config-help-body');

        const walkthrough = body.locator('.config-panel', {
            has: page.locator('.config-panel-title', { hasText: 'Setting up one monitored bookmark' }),
        });
        await expect(walkthrough).toBeVisible();
        const text = (await walkthrough.textContent()) || '';
        // Every setting introduced earlier in the tab shows up again here, tied
        // to a concrete reason rather than repeated in the abstract.
        expect(text).toMatch(/Monitor/);
        expect(text).toMatch(/interval/i);
        expect(text).toMatch(/Status codes/i);
        expect(text).toMatch(/must contain/i);
        expect(text).toMatch(/drift/i);
        expect(text).toMatch(/[Mm]aintenance/);
        expect(text).toMatch(/[Aa]lert after/);
        expect(text).toMatch(/[Tt]est alert/);
        expect(text.trim().length).toBeGreaterThan(1500);
    });
});

test.describe('config help — inbox', () => {
    test('splits into six panels, each with real prose', async ({ page }) => {
        await openInboxHelp(page);

        const body = page.locator('#config-help-body');
        // Inbox, working the backlog, triage mode, the settings with no UI,
        // saving a link from anywhere, and the one-time tour.
        await expect(body.locator('.config-panel')).toHaveCount(6);

        await expect(body).not.toContainText('config.help');

        for (const prose of await body.locator('.config-help-prose').all()) {
            await expect(prose.locator('p').first()).toBeVisible();
            expect((await prose.textContent())?.trim().length).toBeGreaterThan(200);
            await expect(prose).not.toContainText('<p>');
        }
    });

    test('covers capture: paste, the extension, dedup, and the unread badge', async ({ page }) => {
        await openInboxHelp(page);
        const body = page.locator('#config-help-body');

        await expect(body).toContainText(/Already in Inbox/);
        await expect(body).toContainText(/Save to Inbox/i);
        await expect(body).toContainText(/extension/i);
        await expect(body).toContainText(/pulses/i);
        await expect(body).toContainText(/plain text, not markdown/i);
    });

    test('covers triage mode as its own keyboard-only workflow', async ({ page }) => {
        await openInboxHelp(page);
        const body = page.locator('#config-help-body');

        const triage = body.locator('.config-panel', {
            has: page.locator('.config-panel-title', { hasText: 'Triage mode' }),
        });
        await expect(triage).toBeVisible();
        const text = (await triage.textContent()) || '';
        expect(text).toMatch(/:inbox triage/);
        for (const key of ['j', 'k', 'o', 'Enter', 'p', 'r', 'd', 'Escape']) {
            expect(text, `mentions key ${key}`).toContain(key);
        }
    });

    test('covers the config-only settings with no UI control', async ({ page }) => {
        await openInboxHelp(page);
        const body = page.locator('#config-help-body');

        await expect(body).toContainText(/Enable the inbox/i);
        await expect(body).toContainText(/500/);
        await expect(body).toContainText(/silently dropped/i);
        await expect(body).toContainText(/[Dd]eduplicat/);
    });

    // The cap and undo interact in a way that is not guessable: a restored link
    // carries its original timestamp, which is exactly what the cap trims by.
    test('explains that undo still works at the cap', async ({ page }) => {
        await openInboxHelp(page);
        const body = page.locator('#config-help-body');

        await expect(body).toContainText(/undo still works/i);
        await expect(body).toContainText(/oldest of the others makes way/i);
        // And that a genuine refusal is reported rather than faked.
        await expect(body).toContainText(/says the inbox is full/i);
    });
});

test.describe('config help — translations', () => {
    test('every language renders translated prose rather than keys', async ({ page }) => {
        await page.goto('/');
        await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
        await prepareDashboardInteraction(page);

        // The English titles, so a language that silently failed to load — and
        // therefore still shows English — is caught rather than passing.
        // "Inbox" is deliberately absent: it is the same word in English and
        // Dutch, so asserting it is gone would fail on a correct nl translation.
        const tabs = {
            health: {
                count: 3,
                english: ['Availability & health', 'Working through the list'],
            },
            monitoring: {
                // Seven since Fresh was given a panel of its own here: stats,
                // expectations, certificates, drift, maintenance, Fresh, alerts.
                count: 7,
                english: ['Uptime, trends & statistics', 'Certificate expiry', 'Maintenance windows'],
            },
            inbox: {
                count: 6,
                english: ['Working through the inbox', 'Triage mode', 'Settings behind the scenes',
                    'The one-time tour'],
            },
        };

        for (const lang of ['nl', 'de', 'fr']) {
            await page.evaluate(async (code) => {
                const d = window.dashboardInstance;
                await d.language.loadTranslations(code);
                d.config.openConfigView('help');
            }, lang);
            // Help's own strings load in a second, scoped fetch
            // (ensureHelpTranslations), so loadTranslations resolving is not the
            // same as the help panels being translatable — render before that
            // lands and every title falls back to its English wording, which is
            // what this test used to flake on. Wait for the fold-in.
            await page.evaluate((code) =>
                window.dashboardInstance.language.ensureHelpTranslations?.(code), lang);
            await page.waitForFunction((code) => {
                const language = window.dashboardInstance?.language;
                return language?.currentLanguage === code && language?._helpLoadedFor === code;
            }, lang, { timeout: 10_000 });
            await page.evaluate(() => window.dashboardInstance.config.render?.());

            for (const [tab, { count, english }] of Object.entries(tabs)) {
                await page.evaluate((t) => {
                    const d = window.dashboardInstance;
                    d.config.helpTab = t;
                    d.config.render?.();
                }, tab);
                await page.waitForSelector('#config-help-body .config-panel', { timeout: 15_000 });

                const body = page.locator('#config-help-body');
                await expect(body.locator('.config-panel'), `${lang}/${tab} panel count`).toHaveCount(count);
                await expect(body, `${lang}/${tab} has no untranslated keys`).not.toContainText('config.help');

                const titles = (await body.locator('.config-panel-title').allTextContents())
                    .map((t2) => t2.trim());
                expect(titles, `${lang}/${tab} titles are translated`).not.toEqual(english);
                // Every English title must be gone, not just the list as a whole
                // differing — one title left in English would otherwise pass.
                for (const title of english) {
                    expect(titles, `${lang}/${tab} still shows the English "${title}"`).not.toContain(title);
                }

                // Each body carries real prose, not an empty string falling back to
                // the (deliberately blank) English default.
                for (const prose of await body.locator('.config-help-prose').all()) {
                    expect((await prose.textContent())?.trim().length,
                        `${lang}/${tab} prose length`).toBeGreaterThan(200);
                }
            }
        }
    });
});
