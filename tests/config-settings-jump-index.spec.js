// @ts-check
const { test, expect } = require('@playwright/test');
const { dismissOnboardingIfPresent, dismissBlockingOverlays, waitForConfigReady } = require('./e2e-helpers');

/**
 * The settings jump used to build its field index by scraping
 * `.config-field-label` out of the rendered DOM, so a setting only became
 * findable once you had opened the tab it lives on. On a fresh install that
 * left four entries — all from the Overview — and searching "webhook", the
 * case the feature exists for, found nothing.
 *
 * The index is declared now: behaviorSchema() for the 72 fields it describes,
 * MANUAL_JUMP_FIELDS for the hand-written Appearance and backup controls, and
 * FIELD_KEYWORDS for words that are matched but never shown.
 */

async function openConfig(page, section = 'overview') {
    await page.goto('/');
    await page.waitForSelector('#dashboard-layout', { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await waitForConfigReady(page);
    await page.evaluate((s) => window.dashboardInstance.config.openConfigView(s), section);
    await page.waitForSelector('.config-view', { timeout: 15_000 });
}

/** Field-kind hits for a query, without opening the overlay. */
function search(page, query) {
    return page.evaluate((q) => window.dashboardInstance.config
        .filterSettingsJumpEntries(q)
        .filter((e) => e.kind === 'field')
        .map((e) => ({ title: e.title, field: e.field, subtitle: e.subtitle })), query);
}

test.describe('the settings index does not depend on what you have visited', () => {
    /**
     * The regression in one number. Four field entries was the old behaviour:
     * only what the Overview happens to render.
     */
    test('a freshly opened config indexes every settings field', async ({ page }) => {
        await openConfig(page, 'overview');

        const fields = await page.evaluate(() => window.dashboardInstance.config
            .getSettingsJumpEntries().filter((e) => e.kind === 'field').length);

        expect(fields).toBeGreaterThan(80);
    });

    test('settings on tabs never opened are findable', async ({ page }) => {
        await openConfig(page, 'overview');

        // One per section that is not the Overview, so nothing here can have
        // been rendered yet.
        for (const [query, field] of [
            ['webhook', 'monitorNotifyUrl'],
            ['columns', 'columnsPerRow'],
            ['density', 'densityMode'],
            ['language', 'language'],
            ['retries', 'statusOfflineRetries'],
        ]) {
            const hits = await search(page, query);
            expect(hits.map((h) => h.field), `"${query}" did not find ${field}`).toContain(field);
        }
    });

    /**
     * The Downtime alerts panel is the one place in behaviorSchema() whose
     * control list actually depends on a setting's current value: Pushover's
     * two credential fields and Telegram's chat-ID field only render while
     * that service is picked. Without a dedicated index mode, monitorNotifyPushoverToken
     * and monitorNotifyTelegramChatId would only ever be findable after
     * switching to that exact preset once — precisely the bug this whole
     * describe block exists to prevent for every other setting.
     */
    test('preset-only alert fields are findable without ever picking that preset', async ({ page }) => {
        await openConfig(page, 'overview');

        const presetOnDisk = await page.evaluate(() => window.dashboardInstance.settings?.monitorNotifyPreset || '');
        expect(presetOnDisk, 'fixture assumption: default install has no preset picked').toBe('');

        for (const [query, field] of [
            ['token', 'monitorNotifyPushoverToken'],
            ['user key', 'monitorNotifyPushoverUserKey'],
            ['chat', 'monitorNotifyTelegramChatId'],
        ]) {
            const hits = await search(page, query);
            expect(hits.map((h) => h.field), `"${query}" did not find ${field}`).toContain(field);
        }
    });

    test('every rendered control is in the index', async ({ page }) => {
        await openConfig(page, 'behavior');

        // Walk the schema-driven tabs and confirm nothing on screen is missing
        // from the declared index.
        for (const tab of ['general', 'datetime', 'search', 'status', 'privacy']) {
            await page.evaluate((t) => {
                const c = window.dashboardInstance.config;
                c.behaviorTab = t;
                c.render();
            }, tab);
            const gap = await page.evaluate(() =>
                window.dashboardInstance.config.settingsJumpFieldCoverage());
            expect(gap.missingFromIndex, `${tab} has unindexed controls`).toEqual([]);
        }
    });
});

test.describe('keywords widen what a search matches', () => {
    /**
     * The filter matched the visible label only, so a setting could not be
     * found by the word people actually look for.
     */
    test('a setting is findable by a word that is not in its label', async ({ page }) => {
        await openConfig(page, 'overview');

        for (const [query, field] of [
            ['uptime', 'healthAutoRecheckEnabled'],
            ['wallpaper', 'backgroundType'],
            ['telemetry', 'analyticsOptIn'],
            ['discord', 'monitorNotifyUrl'],
            ['hotkey', 'globalShortcuts'],
        ]) {
            const hits = await search(page, query);
            expect(hits.map((h) => h.field), `"${query}" did not find ${field}`).toContain(field);
        }
    });

    test('keywords are matched but never displayed', async ({ page }) => {
        await openConfig(page, 'overview');
        const hit = (await search(page, 'discord'))[0];
        expect(hit).toBeTruthy();
        // The row shows the label and its location, not the words behind it.
        expect(hit.title.toLowerCase()).not.toContain('discord');
        expect(hit.subtitle.toLowerCase()).not.toContain('discord');
    });

    test('the overlay lists a keyword hit like any other', async ({ page }) => {
        await openConfig(page, 'overview');
        await page.locator('#config-section-panel').focus();
        await page.keyboard.press('Control+Shift+K');
        await expect(page.locator('.config-settings-jump-modal')).toBeVisible();
        await page.locator('#config-settings-jump-filter').fill('wallpaper');
        const first = page.locator('.config-settings-jump-result').first();
        await expect(first).toBeVisible();
        await expect(first.locator('.config-settings-jump-result-sub')).toContainText(/appearance/i);
    });
});

test.describe('activating an entry reaches the control', () => {
    /**
     * A declared entry carries no focusSelector — the control does not exist
     * until its tab is rendered — so activation has to switch there and then
     * resolve the control by field name.
     */
    test('jumping to an unvisited setting focuses that control', async ({ page }) => {
        await openConfig(page, 'overview');

        const landed = await page.evaluate(async () => {
            const c = window.dashboardInstance.config;
            const hit = c.filterSettingsJumpEntries('webhook').find((e) => e.kind === 'field');
            await c.activateSettingsJumpEntry(hit);
            await new Promise((r) => setTimeout(r, 400));
            return {
                section: c.section,
                active: document.activeElement?.getAttribute('data-behavior-field'),
            };
        });

        expect(landed.section).toBe('behavior');
        expect(landed.active).toBe('monitorNotifyUrl');
    });

    /**
     * The Status tab has two settings whose labels both begin "Re-check", so
     * this is where resolving by label rather than by field name would land on
     * the wrong control. Note that the label fallback happens to pick the right
     * one here too — this pins the outcome, not the mechanism; the mechanism is
     * what the hand-written-control test above depends on.
     */
    test('a setting whose label is not unique still lands on its own control', async ({ page }) => {
        await openConfig(page, 'overview');

        const landed = await page.evaluate(async () => {
            const c = window.dashboardInstance.config;
            const hit = c.getSettingsJumpEntries()
                .find((e) => e.field === 'healthAutoRecheckIntervalHours');
            await c.activateSettingsJumpEntry(hit);
            await new Promise((r) => setTimeout(r, 400));
            return document.activeElement?.getAttribute('data-behavior-field');
        });

        expect(landed).toBe('healthAutoRecheckIntervalHours');
    });

    /** The hand-written Appearance controls bind their own attributes. */
    test('jumping to a hand-written appearance control works too', async ({ page }) => {
        await openConfig(page, 'overview');

        const landed = await page.evaluate(async () => {
            const c = window.dashboardInstance.config;
            const hit = c.filterSettingsJumpEntries('favicon').find((e) => e.field === 'showIcons');
            await c.activateSettingsJumpEntry(hit);
            await new Promise((r) => setTimeout(r, 400));
            return {
                section: c.section,
                active: document.activeElement?.getAttribute('data-appearance-toggle'),
            };
        });

        expect(landed.section).toBe('appearance');
        expect(landed.active).toBe('showIcons');
    });

    /**
     * A rendered tab produces a DOM scrape as well as the declared entries, so
     * every field on it is described twice. They are merged by location and
     * label, and the scrape's selector wins because that control exists now.
     */
    test('a rendered setting is listed once, not once per source', async ({ page }) => {
        await openConfig(page, 'behavior');
        // Let the scrape run over the rendered tab.
        await page.waitForTimeout(400);

        const dupes = await page.evaluate(() => {
            const entries = window.dashboardInstance.config.getSettingsJumpEntries()
                .filter((e) => e.kind === 'field');
            const seen = new Map();
            entries.forEach((e) => {
                const key = `${e.section}|${e.subTab || ''}|${String(e.title).replace(/:$/, '').toLowerCase()}`;
                seen.set(key, (seen.get(key) || 0) + 1);
            });
            return [...seen.entries()].filter(([, n]) => n > 1).map(([k, n]) => `${k} ×${n}`);
        });

        expect(dupes, 'the same setting appears more than once in the index').toEqual([]);
    });

    /**
     * The merged entry must keep a usable selector: the scrape's, since the
     * declared one is null until the tab has been rendered.
     */
    test('a rendered setting keeps a focusable selector', async ({ page }) => {
        await openConfig(page, 'behavior');
        await page.waitForTimeout(400);

        const ok = await page.evaluate(() => {
            const hit = window.dashboardInstance.config.getSettingsJumpEntries()
                .find((e) => e.kind === 'field' && e.field === 'language');
            if (!hit?.focusSelector) return { found: !!hit, selector: null };
            return { found: true, selector: hit.focusSelector, resolves: !!document.querySelector(hit.focusSelector) };
        });

        expect(ok.found).toBe(true);
        expect(ok.selector, 'the merged entry lost its selector').toBeTruthy();
        expect(ok.resolves).toBe(true);
    });
});
