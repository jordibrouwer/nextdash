// @ts-check
const fs = require('fs');
const path = require('path');
const { test, expect } = require('@playwright/test');
const { dismissOnboardingIfPresent, dismissBlockingOverlays, waitForConfigReady } = require('./e2e-helpers');

/**
 * FIELD_META.def is what the ↺ button restores and what decides whether a
 * setting counts as changed. It is a hand-kept copy of the defaults in
 * models.go, and the two had drifted: six fields declared a default the server
 * never writes, so on an untouched install those settings already offered a
 * reset — to a value that was not the default — and any "differs from default"
 * count would have started at six.
 *
 * These read the server's own defaults out of models.go rather than restating
 * them, so the copy cannot drift again without failing here.
 */

/** The literal defaults from the `defaultSettings := Settings{...}` block. */
function serverDefaults() {
    const go = fs.readFileSync(path.join(__dirname, '..', 'models.go'), 'utf8');
    // `defaultSettings := Settings{...}` — the block used when no settings file
    // exists, which is what a fresh install actually gets. models.go has a
    // second `settings := Settings{...}` further down for the unreadable-file
    // fallback, and the two disagree on showRecentButton and
    // showCheatSheetButton; that is a server-side discrepancy of its own and
    // not something the client copy should try to average.
    const start = go.indexOf('defaultSettings := Settings{');
    expect(start, 'defaultSettings block not found in models.go').toBeGreaterThan(-1);
    const block = go.slice(start, go.indexOf('\n\t\t}', start));

    // Go field name -> json tag, so the block can be read in client terms.
    const tags = {};
    for (const m of go.matchAll(/^\s*(\w+)\s+[\w.[\]*]+\s+`json:"(\w+)"/gm)) {
        tags[m[1]] = m[2];
    }

    const named = { defaultThemeID: 'retro-crt-dark', defaultHealthAutoRecheckIntervalHours: 24 };
    const out = {};
    for (const m of block.matchAll(/^\s*(\w+):\s+(.+?),\s*$/gm)) {
        const key = tags[m[1]];
        if (!key) continue;
        const raw = m[2].trim();
        if (raw === 'true' || raw === 'false') out[key] = raw === 'true';
        else if (/^-?\d+$/.test(raw)) out[key] = Number(raw);
        else if (/^".*"$/.test(raw)) out[key] = raw.slice(1, -1);
        else if (raw in named) out[key] = named[raw];
        // Anything else (structs, slices) has no scalar default to compare.
    }
    return out;
}

async function openConfig(page) {
    await page.goto('/');
    await page.waitForSelector('#dashboard-layout', { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await waitForConfigReady(page);
    await page.evaluate(() => window.dashboardInstance.config.openConfigView('overview'));
    await page.waitForSelector('.config-view', { timeout: 15_000 });
}

test.describe('the declared defaults match the server', () => {
    test('models.go can be read for its defaults', () => {
        const srv = serverDefaults();
        // A sanity check on the parse itself, so a models.go reshuffle that
        // breaks it fails loudly instead of silently comparing nothing.
        expect(Object.keys(srv).length).toBeGreaterThan(80);
        expect(srv.columnsPerRow).toBe(3);
        expect(srv.statusOfflineRetries).toBe(3);
    });

    test('every FIELD_META default is the value the server actually writes', async ({ page }) => {
        await openConfig(page);
        const declared = await page.evaluate((fields) => {
            const c = window.dashboardInstance.config;
            const out = {};
            for (const f of fields) {
                const m = c.fieldMeta(f);
                if (m && m.def !== undefined) out[f] = m.def;
            }
            return out;
        }, Object.keys(serverDefaults()));

        const srv = serverDefaults();
        const mismatched = [];
        for (const [field, def] of Object.entries(declared)) {
            if (!(field in srv)) continue;
            if (srv[field] !== def) {
                mismatched.push(`${field}: FIELD_META=${JSON.stringify(def)} server=${JSON.stringify(srv[field])}`);
            }
        }
        expect(mismatched, `defaults drifted from models.go:\n${mismatched.join('\n')}`).toEqual([]);
    });

    /**
     * The reason the drift mattered: isFieldDefault is what shows the ↺ button
     * and what a "differs from default" count would be built on.
     *
     * Nothing is excused any more. backgroundType used to be: models.go
     * documented "none" but omitted it from the block that runs on a fresh
     * install, so the value was served as "" and could never equal its own
     * default. Fixed at the source rather than papered over here.
     */
    const SERVER_SIDE_BUGS = [];

    test('an untouched install reports nothing as changed', async ({ page }) => {
        await openConfig(page);

        // Settings persist between specs, so put everything back to its
        // declared default first. What this asserts is that the declared
        // defaults are self-consistent — reset a field and it must then read as
        // unchanged — which is exactly what was broken for six of them.
        await page.evaluate(async () => {
            const c = window.dashboardInstance.config;
            const s = window.dashboardInstance.settings || {};
            for (const e of c.settingsJumpFieldEntries()) {
                const m = c.fieldMeta(e.field);
                if (m && m.def !== undefined && !c.isFieldDefault(e.field, s[e.field])) {
                    await c.setBehavior(e.field, m.def, '');
                }
            }
        });

        const changed = await page.evaluate(() => {
            const c = window.dashboardInstance.config;
            const s = window.dashboardInstance.settings || {};
            return c.settingsJumpFieldEntries()
                .filter((e) => {
                    const m = c.fieldMeta(e.field);
                    return m && m.def !== undefined && !c.isFieldDefault(e.field, s[e.field]);
                })
                .map((e) => e.field);
        });

        const unexpected = changed.filter((f) => !SERVER_SIDE_BUGS.includes(f));
        expect(unexpected, `a fresh install claims these differ from their default:\n${unexpected.join('\n')}`).toEqual([]);

        // If an exception is ever added back, it has to still be needed.
        const stillBroken = SERVER_SIDE_BUGS.filter((f) => changed.includes(f));
        expect(stillBroken.sort(),
            'a known server-side default bug is fixed; remove it from SERVER_SIDE_BUGS')
            .toEqual([...SERVER_SIDE_BUGS].sort());
    });

    /**
     * A setting with no declared default can never be reported as changed and
     * offers no ↺. Every field the server gives a scalar default should have
     * one, so the gap does not quietly grow back.
     */
    test('fields the server gives a default declare one too', async ({ page }) => {
        await openConfig(page);
        const known = await page.evaluate(() => {
            const c = window.dashboardInstance.config;
            const indexed = [...new Set(c.settingsJumpFieldEntries().map((e) => e.field))];
            return {
                indexed,
                withDef: indexed.filter((f) => {
                    const m = c.fieldMeta(f);
                    return m && m.def !== undefined;
                }),
            };
        });

        const srv = serverDefaults();
        const withDef = new Set(known.withDef);
        const gap = [...new Set(known.indexed)]
            .filter((f) => f in srv && !withDef.has(f));

        expect(gap, `these have a server default but no FIELD_META.def:\n${gap.join('\n')}`).toEqual([]);
    });
});

test.describe('numeric inputs accept what the server accepts', () => {
    /**
     * The form allowed 0–60000 for the retry delay where the server clamps to
     * 100–3000, so a typed 5000 reported "Saved" and came back as 450.
     */
    test('the retry bounds match the server validation', async ({ page }) => {
        await openConfig(page);
        const bounds = await page.evaluate(() => {
            const out = {};
            for (const p of window.dashboardInstance.config.behaviorSchema()) {
                for (const c of p.controls || []) {
                    if (c.type === 'number') out[c.field] = { min: c.min, max: c.max };
                }
            }
            return out;
        });

        expect(bounds.statusOfflineRetries).toEqual({ min: 1, max: 10 });
        expect(bounds.statusOfflineRetryDelayMs).toEqual({ min: 100, max: 3000 });
    });

    test('a value inside the form bounds survives the round trip', async ({ page }) => {
        await openConfig(page);
        const result = await page.evaluate(async () => {
            const c = window.dashboardInstance.config;
            await c.setBehavior('statusOfflineRetryDelayMs', 2000, '');
            const res = await fetch('/api/settings', { cache: 'no-store' });
            const saved = await res.json();
            return saved.statusOfflineRetryDelayMs;
        });
        // The old max of 60000 let the form offer values the server rewrote.
        expect(result).toBe(2000);
    });
});

/**
 * The Status tab's "Background re-check interval" wrote
 * `healthRecheckIntervalMinutes`, which is not a field the server has: the save
 * returned 200, the value was dropped, and the background checks kept running
 * at whatever the real setting said. Verified against /api/settings — the key
 * was absent from the response.
 *
 * It binds `healthAutoRecheckIntervalHours` now, the same field the Data &
 * backups tab was already using correctly, so the two controls agree instead of
 * one of them being decorative.
 */
test.describe('the background re-check interval reaches the server', () => {
    async function openStatusTab(page) {
        await openConfig(page);
        await page.evaluate(() => window.dashboardInstance.config.openConfigView('behavior'));
        await page.locator('[data-behavior-tab="status"]').click();
        await expect(page.locator('[data-behavior-tab="status"]')).toHaveAttribute('aria-selected', 'true');
    }

    test('the control binds the field the server actually stores', async ({ page }) => {
        await openStatusTab(page);
        await expect(page.locator('[data-behavior-field="healthAutoRecheckIntervalHours"]')).toBeVisible();
        // The phantom field must be gone, not merely joined by a working one.
        await expect(page.locator('[data-behavior-field="healthRecheckIntervalMinutes"]')).toHaveCount(0);
    });

    test('a chosen interval survives a round trip to the server', async ({ page }) => {
        await openStatusTab(page);
        await page.locator('[data-behavior-field="healthAutoRecheckIntervalHours"]').selectOption('168');

        await expect.poll(async () => page.evaluate(async () => {
            const res = await fetch('/api/settings', { cache: 'no-store' });
            return (await res.json()).healthAutoRecheckIntervalHours;
        }), { timeout: 10_000 }).toBe(168);
    });

    test('both tabs show the same interval', async ({ page }) => {
        await openStatusTab(page);
        await page.locator('[data-behavior-field="healthAutoRecheckIntervalHours"]').selectOption('12');
        await expect.poll(async () => page.evaluate(async () => {
            const res = await fetch('/api/settings', { cache: 'no-store' });
            return (await res.json()).healthAutoRecheckIntervalHours;
        }), { timeout: 10_000 }).toBe(12);

        await page.evaluate(() => window.dashboardInstance.config.openConfigView('data-backups'));
        await expect(page.locator('[data-backup-select="healthAutoRecheckIntervalHours"]')).toHaveValue('12');
    });

    /** Every option offered must be inside the server's 1–168 hour clamp. */
    test('every offered interval is one the server accepts', async ({ page }) => {
        await openConfig(page);
        const values = await page.evaluate(() => {
            for (const p of window.dashboardInstance.config.panelsFor('behavior', 'status')) {
                for (const c of p.controls || []) {
                    if (c.field === 'healthAutoRecheckIntervalHours') {
                        return (c.options || []).map((o) => o.value);
                    }
                }
            }
            return null;
        });

        expect(values, 'the interval control is not in the status schema').not.toBeNull();
        expect(values.length).toBeGreaterThan(2);
        for (const v of values) {
            expect(v, `${v}h is outside the server clamp`).toBeGreaterThanOrEqual(1);
            expect(v, `${v}h is outside the server clamp`).toBeLessThanOrEqual(168);
        }
    });
});
