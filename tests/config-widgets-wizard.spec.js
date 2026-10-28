// @ts-check
const { test, expect } = require('./fixtures');
const { dismissOnboardingIfPresent, dismissBlockingOverlays, waitForFaviconPrefetch } = require('./e2e-helpers');

/**
 * The Add wizard: the picker names the page a widget lands on.
 *
 * Adding used to mean "the page the list happens to show", which on the
 * all-pages view was no page at all. The picker now carries the choice
 * itself, and only when there is a choice to make.
 */

async function openWidgets(page) {
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.waitForFunction(() => !!window.dashboardInstance?.config, null, { timeout: 15_000 });
    await waitForFaviconPrefetch(page);
    // Opens the module arrange() needs; it reopens the list once it is done.
    await openList(page);
}

/** (Re)open Config → Widgets so the list loads what is stored now. */
async function openList(page) {
    await page.evaluate(async () => { await window.dashboardInstance.config.openConfigView('widgets'); });
    await expect(page.locator('[data-widget-catalogue]')).toBeVisible();
}

/** Empty every page's widgets, and return the ids of the pages. */
async function clearWidgets(page) {
    return page.evaluate(async () => {
        const f = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
        const headers = {
            'Content-Type': 'application/json',
            ...(typeof nextDashWriteHeaders === 'function' ? nextDashWriteHeaders() : {}),
        };
        const pages = window.dashboardInstance.pages || [];
        for (const p of pages) {
            await f(`/api/pages/${p.id}/blocks`, { method: 'PUT', headers, body: JSON.stringify({ widgets: [] }) });
        }
        return pages.map((p) => p.id);
    });
}

async function widgetTypes(page, pageId) {
    return page.evaluate(async (id) => {
        const res = await fetch(`/api/pages/${id}/blocks`);
        const data = await res.json();
        return (data.widgets || []).map((w) => w.type);
    }, pageId);
}

/**
 * Leave the install with exactly `count` pages and no widgets on any of
 * them, whatever an earlier test (or an earlier run of this one) left behind.
 * Pages are trimmed through the route that removes one and grown through the
 * Config button that adds one, then waited for by asking.
 */
async function arrange(page, count) {
    await page.evaluate(async (want) => {
        const f = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
        const headers = {
            'Content-Type': 'application/json',
            ...(typeof nextDashWriteHeaders === 'function' ? nextDashWriteHeaders() : {}),
        };
        const d = window.dashboardInstance;
        for (const p of d.pages.slice(want)) {
            await f(`/api/pages/${p.id}`, { method: 'DELETE', headers });
        }
        await d.loadData();
        const cfg = d.config._module;
        while (d.pages.length < want) {
            const had = d.pages.length;
            await cfg.addPage();
            const until = Date.now() + 10_000;
            while (d.pages.length <= had && Date.now() < until) await new Promise((r) => setTimeout(r, 50));
            if (d.pages.length <= had) throw new Error('a page was not added');
        }
    }, count);
    await expect.poll(() => page.evaluate(() => window.dashboardInstance.pages.length)).toBe(count);
    const ids = await clearWidgets(page);
    // Reload the list so it reads what is stored now, not what it held.
    await page.evaluate(async (first) => {
        const cfg = window.dashboardInstance.config._module;
        cfg._widgetBlocks = null;
        cfg._widgetLoadedFor = null;
        cfg._widgetPageId = first;
        await cfg.loadWidgetsEditor();
    }, ids[0]);
    await openList(page);
    return ids;
}

test.describe('the add picker names a page', () => {
    test('a one-page install shows no page select', async ({ page }) => {
        await openWidgets(page);
        const [only] = await arrange(page, 1);

        await page.locator('[data-widget-catalogue]').click();
        await page.locator('[data-widget-option="notes"]').click();
        await expect(page.locator('[data-widget-add="notes"]')).toBeVisible();
        await expect(page.locator('[data-widget-wizard-page]')).toHaveCount(0);
        await page.locator('[data-widget-add="notes"]').click();

        await expect.poll(() => widgetTypes(page, only)).toEqual(['notes']);
    });

    test('the preview keeps its amber and red sample tones', async ({ page }) => {
        await openWidgets(page);
        await arrange(page, 1);

        await page.locator('[data-widget-catalogue]').click();
        await page.locator('[data-widget-option="health"]').click();
        const colour = (cls) => page.locator(`.${cls}`).first().evaluate((el) => getComputedStyle(el).color);
        await expect(page.locator('.config-widget-kind-warn').first()).toBeVisible();
        const [good, warn, bad] = [await colour('config-widget-kind-good'), await colour('config-widget-kind-warn'), await colour('config-widget-kind-bad')];
        expect(new Set([good, warn, bad]).size).toBe(3);
    });

    test('the picker names a page, and the widget lands on it', async ({ page }) => {
        await openWidgets(page);
        const [first, second] = await arrange(page, 2);

        await page.locator('[data-widget-catalogue]').click();
        await page.locator('[data-widget-option="notes"]').click();
        await page.locator('[data-widget-wizard-page]').selectOption(String(second));
        // Highlighting another kind redraws the preview; the choice stays.
        await page.locator('[data-widget-option="health"]').click();
        await page.locator('[data-widget-option="notes"]').click();
        await expect(page.locator('[data-widget-wizard-page]')).toHaveValue(String(second));
        await page.locator('[data-widget-add="notes"]').click();

        await expect.poll(() => widgetTypes(page, second)).toEqual(['notes']);
        expect(await widgetTypes(page, first)).toEqual([]);
    });

    test('from the all-pages view the widget lands on the page named, and the list follows', async ({ page }) => {
        await openWidgets(page);
        const [first, second] = await arrange(page, 2);

        // The way a reader gets there: the list's own page select.
        await page.locator('[data-widget-page]').selectOption('all');
        await expect.poll(() => page.evaluate(
            () => window.dashboardInstance.config._module.isAllPagesView())).toBe(true);

        await page.locator('[data-widget-catalogue]').click();
        await page.locator('[data-widget-option="notes"]').click();
        await page.locator('[data-widget-wizard-page]').selectOption(String(second));
        await page.locator('[data-widget-add="notes"]').click();

        await expect.poll(() => widgetTypes(page, second)).toEqual(['notes']);
        expect(await widgetTypes(page, first)).toEqual([]);
        // The list moved to the page it was added to, off the all-pages view.
        await expect.poll(() => page.evaluate(() => {
            const cfg = window.dashboardInstance.config._module;
            return [cfg.isAllPagesView(), cfg._widgetPageId];
        })).toEqual([false, second]);
    });
});

/** Answer Test (and the settings panel's own Connect) for Sonarr with `reply`. */
async function mockSonarr(page, reply) {
    await page.route('**/api/widgets/sonarr/setup', (route) => (typeof reply === 'function'
        ? reply(route)
        : route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(reply) })));
}

/** One page, no widgets, the picker open on Sonarr and its Add pressed. */
async function connectScreen(page, type = 'sonarr') {
    await openWidgets(page);
    const [only] = await arrange(page, 1);
    await page.locator('[data-widget-catalogue]').click();
    await page.locator(`[data-widget-option="${type}"]`).first().click();
    await page.locator(`[data-widget-add="${type}"]`).click();
    await expect(page.locator('[data-widget-wizard-screen="connect"]')).toBeVisible();
    return only;
}

async function widgetsOn(page, pageId) {
    return page.evaluate(async (id) => {
        // With the token: without it the route leaves addresses out.
        const f = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
        const res = await f(`/api/pages/${id}/blocks`);
        const data = await res.json();
        return (data.widgets || []).map((w) => ({ id: w.id, type: w.type, config: w.config || {} }));
    }, pageId);
}

test.describe('the connect screen for media kinds', () => {
    test('a media kind asks for address and key before it is added', async ({ page }) => {
        const only = await connectScreen(page);

        expect(await widgetTypes(page, only)).toEqual([]);
        await expect(page.locator('[data-widget-wizard-server]')).toBeVisible();
        await expect(page.locator('[data-widget-wizard-server]')).toHaveAttribute('placeholder', 'http://sonarr.local:8989');
        await expect(page.locator('[data-widget-wizard-secret]')).toBeVisible();
        await expect(page.locator('[data-widget-wizard-secret]')).toHaveAttribute('type', 'password');
        await expect(page.locator('[data-widget-wizard-test]')).toBeDisabled();
        await expect(page.locator('[data-widget-wizard-finish]')).toHaveText('Add without testing');
        await page.locator('[data-widget-wizard-server]').fill('http://sonarr.local:8989');
        await expect(page.locator('[data-widget-wizard-test]')).toBeEnabled();
    });

    test('a good test says so and adds with the address saved', async ({ page }) => {
        // Distinctive, so a match cannot be an asset hash that happens to contain it.
        const KEY = 'abc-wizard-key-7f3q';
        await mockSonarr(page, { version: '4.0' });
        const only = await connectScreen(page);

        await page.locator('[data-widget-wizard-server]').fill('http://sonarr.local:8989');
        await page.locator('[data-widget-wizard-secret]').fill(KEY);
        await page.locator('[data-widget-wizard-test]').click();
        await expect(page.locator('[data-widget-wizard-result]')).toContainText('Connected');
        await expect(page.locator('[data-widget-wizard-finish]')).toHaveText('Add widget');
        // While the screen is open, the key is only the password box's value:
        // never a text node, never an attribute.
        expect(await page.evaluate((key) => {
            const seen = [];
            const walk = document.createTreeWalker(document.documentElement, NodeFilter.SHOW_TEXT);
            while (walk.nextNode()) if (walk.currentNode.nodeValue.includes(key)) seen.push('text');
            document.querySelectorAll('*').forEach((el) => [...el.attributes].forEach((a) => {
                if (a.value.includes(key)) seen.push(`${el.tagName}@${a.name}`);
            }));
            return seen;
        }, KEY)).toEqual([]);
        await expect(page.locator('[data-widget-wizard-secret]')).toHaveValue(KEY);

        const filed = page.waitForRequest((req) => req.url().includes('/api/health/credentials')
            && req.method() === 'PUT');
        await page.locator('[data-widget-wizard-finish]').click();
        const sent = JSON.parse((await filed).postData() || '{}');
        expect(sent.headers).toEqual({ 'X-Api-Key': KEY });

        await expect.poll(async () => (await widgetsOn(page, only))
            .map((w) => [w.type, w.config.server])).toEqual([['sonarr', 'http://sonarr.local:8989']]);
        const [added] = await widgetsOn(page, only);
        expect(added.config.credentialId).toBe(`widget:${added.id}`);
        await expect.poll(() => page.evaluate((id) => Object.keys(
            window.dashboardInstance.healthCredentialDetails || {}).includes(id), `widget:${added.id}`)).toBe(true);
        expect(await page.evaluate((k) => document.body.innerText.includes(k), KEY)).toBe(false);
        expect(await page.evaluate((k) => document.documentElement.outerHTML.includes(k), KEY)).toBe(false);
    });

    test('a failed test shows why and still lets you add', async ({ page }) => {
        await mockSonarr(page, { error: 'key refused' });
        const only = await connectScreen(page);

        await page.locator('[data-widget-wizard-server]').fill('http://sonarr.local:8989');
        await page.locator('[data-widget-wizard-secret]').fill('wrong');
        await page.locator('[data-widget-wizard-test]').click();
        await expect(page.locator('[data-widget-wizard-result]')).toContainText('Sonarr refused that key.');
        await expect(page.locator('[data-widget-wizard-finish]')).toHaveText('Add anyway');
        await page.locator('[data-widget-wizard-finish]').click();

        await expect.poll(() => widgetTypes(page, only)).toEqual(['sonarr']);
    });

    test('Escape on the connect screen adds nothing', async ({ page }) => {
        const only = await connectScreen(page);

        await page.locator('[data-widget-wizard-server]').fill('http://sonarr.local:8989');
        await page.locator('[data-widget-wizard-secret]').fill('forget-me');
        await page.keyboard.press('Escape');
        // Gone with the modal, the password box (and what was in it) too.
        await expect(page.locator('[data-widget-wizard-screen="connect"]')).toHaveCount(0);
        await expect(page.locator('[data-widget-wizard-secret]')).toHaveCount(0);
        expect(await page.evaluate(() => window.dashboardInstance.config._module._widgetWizard)).toBeNull();
        await page.waitForTimeout(300);
        expect(await widgetTypes(page, only)).toEqual([]);
    });

    test('a double click adds one', async ({ page }) => {
        await mockSonarr(page, { error: 'key refused' });
        const only = await connectScreen(page);

        await page.locator('[data-widget-wizard-server]').fill('http://sonarr.local:8989');
        await page.locator('[data-widget-wizard-test]').click();
        await expect(page.locator('[data-widget-wizard-finish]')).toHaveText('Add anyway');
        await page.locator('[data-widget-wizard-finish]').dblclick();

        await expect.poll(() => widgetTypes(page, only)).toEqual(['sonarr']);
        await page.waitForTimeout(500);
        expect(await widgetTypes(page, only)).toEqual(['sonarr']);
    });

    test('Test with a server that refuses reads as unreachable', async ({ page }) => {
        const errors = [];
        page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text()); });
        page.on('pageerror', (error) => errors.push(String(error)));
        await mockSonarr(page, (route) => route.fulfill({ status: 500 }));
        await connectScreen(page);

        await page.locator('[data-widget-wizard-server]').fill('http://sonarr.local:8989');
        await page.locator('[data-widget-wizard-test]').click();
        await expect(page.locator('[data-widget-wizard-result]')).toContainText('could not be reached');
        await expect(page.locator('[data-widget-wizard-finish]')).toHaveText('Add anyway');
        // The mocked 500 is the browser's own resource error, not the page's.
        expect(errors.filter((e) => !/status of 500/.test(e))).toEqual([]);
    });

    test('nothing typed adds the widget with an empty config and no sign-in', async ({ page }) => {
        const only = await connectScreen(page);
        let filed = false;
        page.on('request', (req) => {
            if (req.url().includes('/api/health/credentials') && req.method() === 'PUT') filed = true;
        });
        await page.locator('[data-widget-wizard-finish]').click();

        await expect.poll(() => widgetTypes(page, only)).toEqual(['sonarr']);
        const [added] = await widgetsOn(page, only);
        expect(added.config.server).toBeUndefined();
        expect(added.config.credentialId).toBeUndefined();
        expect(filed).toBe(false);
    });

    test('an address alone is saved, with no sign-in filed', async ({ page }) => {
        const only = await connectScreen(page);
        const calls = [];
        page.on('request', (req) => {
            if (req.url().includes('/api/health/credentials') && req.method() !== 'GET') calls.push(req.method());
        });
        await page.locator('[data-widget-wizard-server]').fill('http://sonarr.local:8989');
        await page.locator('[data-widget-wizard-finish]').click();

        await expect.poll(async () => (await widgetsOn(page, only))
            .map((w) => [w.type, w.config.server])).toEqual([['sonarr', 'http://sonarr.local:8989']]);
        const [added] = await widgetsOn(page, only);
        expect(added.config.credentialId).toBeUndefined();
        await page.waitForTimeout(300);
        expect(calls).toEqual([]);
    });

    test('an address without its scheme says so and is not tested', async ({ page }) => {
        let asked = 0;
        await mockSonarr(page, (route) => { asked += 1; return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }); });
        await connectScreen(page);

        await page.locator('[data-widget-wizard-server]').fill('sonarr.local:8989');
        await expect(page.locator('[data-widget-wizard-problem]')).toHaveText('Start the address with http:// or https://');
        await expect(page.locator('[data-widget-wizard-test]')).toBeDisabled();
        await page.locator('[data-widget-wizard-server]').fill('http://sonarr.local:8989');
        await expect(page.locator('[data-widget-wizard-problem]')).toBeHidden();
        await expect(page.locator('[data-widget-wizard-test]')).toBeEnabled();
        expect(asked).toBe(0);
    });

    test('an answer about text since changed is ignored', async ({ page }) => {
        let release;
        const held = new Promise((resolve) => { release = resolve; });
        await mockSonarr(page, async (route) => {
            await held;
            await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ version: '4.0' }) });
        });
        await connectScreen(page);

        await page.locator('[data-widget-wizard-server]').fill('http://old.local:8989');
        await page.locator('[data-widget-wizard-test]').click();
        await expect(page.locator('[data-widget-wizard-result]')).toContainText('Connecting');
        await page.locator('[data-widget-wizard-server]').fill('http://new.local:8989');
        release();
        await expect(page.locator('[data-widget-wizard-test]')).toBeEnabled();
        await expect(page.locator('[data-widget-wizard-result]')).toHaveText('');
        await expect(page.locator('[data-widget-wizard-finish]')).toHaveText('Add without testing');
    });

    test('Back returns to the picker on the same kind', async ({ page }) => {
        const only = await connectScreen(page);
        await page.locator('[data-widget-wizard-back]').click();
        await expect(page.locator('[data-widget-add="sonarr"]')).toBeVisible();
        expect(await page.evaluate(() => window.dashboardInstance.config._module._widgetWizard)).toBeNull();
        expect(await widgetTypes(page, only)).toEqual([]);
    });

    test('qBittorrent signs in with a username and password', async ({ page }) => {
        await connectScreen(page, 'qbittorrent');
        await expect(page.locator('[data-widget-wizard-user]')).toBeVisible();
        await expect(page.locator('[data-widget-wizard-secret]')).toHaveAttribute('type', 'password');
        await expect(page.locator('label[for="widget-wizard-secret"]')).toHaveText('Password');

        // A password without its username is not dropped: the screen asks.
        await page.locator('[data-widget-wizard-secret]').fill('pw');
        await expect(page.locator('[data-widget-wizard-problem]')).toHaveText('Fill in the username as well');
        await expect(page.locator('[data-widget-wizard-finish]')).toBeDisabled();
        await page.locator('[data-widget-wizard-user]').fill('admin');
        await expect(page.locator('[data-widget-wizard-problem]')).toBeHidden();
        await expect(page.locator('[data-widget-wizard-finish]')).toBeEnabled();
        await page.locator('[data-widget-wizard-user]').fill('');
        await expect(page.locator('[data-widget-wizard-finish]')).toBeDisabled();
        await page.locator('[data-widget-wizard-secret]').fill('');
        await expect(page.locator('[data-widget-wizard-finish]')).toBeEnabled();
    });

    test('a kind without a connection still adds in one click', async ({ page }) => {
        await openWidgets(page);
        const [only] = await arrange(page, 1);
        await page.locator('[data-widget-catalogue]').click();
        await page.locator('[data-widget-option="notes"]').click();
        await page.locator('[data-widget-add="notes"]').click();
        await expect(page.locator('[data-widget-wizard-screen="connect"]')).toHaveCount(0);
        await expect.poll(() => widgetTypes(page, only)).toEqual(['notes']);
    });
});

/** Answer the Custom Test with `reply`. */
async function mockCustom(page, reply) {
    await page.route('**/api/widgets/custom/test', (route) => (typeof reply === 'function'
        ? reply(route)
        : route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(reply) })));
}

test.describe('the connect screen for Custom', () => {
    test('Custom asks for an address and tests it', async ({ page }) => {
        const KEY = 'custom-wizard-key-9x2m';
        let body = null;
        await mockCustom(page, (route) => {
            body = JSON.parse(route.request().postData() || '{}');
            return route.fulfill({ status: 200, contentType: 'application/json',
                body: JSON.stringify({ status: 200, tookMs: 12, json: true }) });
        });
        const only = await connectScreen(page, 'custom');

        await expect(page.locator('[data-widget-wizard-header]')).toHaveAttribute('placeholder', 'X-Api-Key');
        await expect(page.locator('[data-widget-wizard-test]')).toBeDisabled();
        await page.locator('[data-widget-wizard-server]').fill('https://svc.example/api/stats');
        await page.locator('[data-widget-wizard-secret]').fill(KEY);
        await page.locator('[data-widget-wizard-test]').click();
        await expect(page.locator('[data-widget-wizard-result]')).toContainText('200');
        await expect(page.locator('[data-widget-wizard-finish]')).toHaveText('Add widget');
        expect(body.url).toBe('https://svc.example/api/stats');
        expect(body.method).toBe('GET');
        expect(body.draftCredential).toEqual({ headers: { 'X-Api-Key': KEY } });
        expect(await page.evaluate((k) => document.documentElement.outerHTML.includes(k), KEY)).toBe(false);

        const filed = page.waitForRequest((req) => req.url().includes('/api/health/credentials')
            && req.method() === 'PUT');
        await page.locator('[data-widget-wizard-finish]').click();
        expect(JSON.parse((await filed).postData() || '{}').headers).toEqual({ 'X-Api-Key': KEY });
        await expect.poll(async () => (await widgetsOn(page, only))
            .map((w) => [w.type, w.config.url])).toEqual([['custom', 'https://svc.example/api/stats']]);
    });

    test('a custom address that answers with an error still adds anyway', async ({ page }) => {
        await mockCustom(page, { error: 'unreachable' });
        const only = await connectScreen(page, 'custom');
        await page.locator('[data-widget-wizard-server]').fill('https://svc.example/api/stats');
        await page.locator('[data-widget-wizard-test]').click();
        await expect(page.locator('[data-widget-wizard-result]')).toContainText('unreachable');
        await expect(page.locator('[data-widget-wizard-finish]')).toHaveText('Add anyway');
        await page.locator('[data-widget-wizard-finish]').click();
        await expect.poll(() => widgetTypes(page, only)).toEqual(['custom']);
    });

    test('a refused test reads through the status, and an answer that is not JSON says so', async ({ page }) => {
        await mockCustom(page, (route) => route.fulfill({ status: 429 }));
        await connectScreen(page, 'custom');
        await page.locator('[data-widget-wizard-server]').fill('https://svc.example/api/stats');
        await page.locator('[data-widget-wizard-test]').click();
        await expect(page.locator('[data-widget-wizard-result]')).toContainText('Too many requests');
        await page.unroute('**/api/widgets/custom/test');
        await mockCustom(page, { status: 200, tookMs: 5, json: false });
        await page.locator('[data-widget-wizard-test]').click();
        await expect(page.locator('[data-widget-wizard-result]')).toContainText('not JSON');
    });

    test('the custom explanation is a short hint, not a page', async ({ page }) => {
        await connectScreen(page, 'custom');
        const hint = (await page.locator('[data-widget-wizard-hint]').textContent() || '').trim();
        expect(hint.length).toBeGreaterThan(0);
        expect(hint.length).toBeLessThan(300);
        expect(hint).toContain('Read a figure out of any service that answers JSON, and show it as a tile.');
    });

    test('nothing typed adds a custom widget with no address and no sign-in', async ({ page }) => {
        const only = await connectScreen(page, 'custom');
        let filed = false;
        page.on('request', (req) => {
            if (req.url().includes('/api/health/credentials') && req.method() === 'PUT') filed = true;
        });
        await page.locator('[data-widget-wizard-finish]').dblclick();
        await expect.poll(() => widgetTypes(page, only)).toEqual(['custom']);
        await page.waitForTimeout(400);
        expect(await widgetTypes(page, only)).toEqual(['custom']);
        expect(filed).toBe(false);
    });

    test('an address without its scheme says so and is not tested', async ({ page }) => {
        await connectScreen(page, 'custom');
        await page.locator('[data-widget-wizard-server]').fill('svc.example/api');
        await expect(page.locator('[data-widget-wizard-problem]')).toHaveText('Start the address with http:// or https://');
        await expect(page.locator('[data-widget-wizard-test]')).toBeDisabled();
    });
});
