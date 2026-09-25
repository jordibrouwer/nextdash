// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays, answerNoCategory } = require('./e2e-helpers');

async function openAdd(page) {
    await markWhatsNewSeen(page);
    await page.setViewportSize({ width: 1400, height: 900 });
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.evaluate(() => window.dashboardInstance.openBookmarkFormModal({ mode: 'create' }));
    await expect(page.locator('#bookmark-form-modal')).toHaveClass(/show/);
    return page.locator('#bookmark-form-modal .bookmark-inline-form');
}

test.describe('bookmark form layout', () => {
    test('one column in the order it is filled in, without the icon URL field', async ({ page }) => {
        const form = await openAdd(page);
        const order = await form.evaluate((el) => [...el.querySelectorAll(
            '[data-field="url"], [data-field="name"], .bookmark-form-card, .bookmark-form-tags-suggest, .bookmark-form-place, .bookmark-form-flags-row, [data-field="note"]',
        )].map((n) => n.dataset.field
            || ['bookmark-form-card', 'bookmark-form-tags-suggest', 'bookmark-form-place', 'bookmark-form-flags-row']
                .find((c) => n.classList.contains(c))));
        expect(order).toEqual([
            'url', 'name', 'bookmark-form-card', 'bookmark-form-tags-suggest',
            'bookmark-form-place', 'bookmark-form-flags-row', 'note',
        ]);
        await expect(form.locator('.bookmark-inline-group-title')).toHaveCount(0);
        await expect(form.getByRole('button', { name: /^set url$/i })).toHaveCount(0);
        await expect(form.locator('[data-field-block="icon"] input[type="text"]')).toBeHidden();
    });

    test('the footer ends cancel, create + new, then the button that saves', async ({ page }) => {
        const form = await openAdd(page);
        const buttons = form.locator('.bookmark-inline-actions button:visible');
        const labels = (await buttons.allTextContents()).map((l) => l.trim().toLowerCase());
        expect(labels.slice(0, 2)).toEqual(['cancel', 'create + new']);
        await expect(buttons.last()).toHaveClass(/bookmark-inline-save/);
        await expect(buttons).toHaveCount(3);
    });
});

async function stubPreview(page, body) {
    const calls = { preview: 0 };
    await page.route('**/api/bookmark-preview*', async (route) => {
        calls.preview += 1;
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    });
    await page.route('**/api/icon/from-url', (route) => route.fulfill({
        status: 200, contentType: 'application/json', body: JSON.stringify({ icon: 'stub-icon.png' }),
    }));
    return calls;
}

test.describe('bookmark form preview card', () => {
    test('leaving the URL fills the card from one preview request', async ({ page }) => {
        const calls = await stubPreview(page, {
            icon: 'https://example.com/favicon.ico', title: 'Example page',
            description: 'What the page says about itself', image: '',
        });
        const form = await openAdd(page);
        await form.locator('[data-field="url"]').fill('https://example.com/post');
        await form.locator('[data-field="url"]').blur();
        const card = form.locator('.bookmark-form-card');
        await expect(card.locator('.bookmark-form-card-desc')).toHaveText('What the page says about itself');
        await expect(card.locator('.bookmark-form-card-host')).toHaveText(/example\.com/);
        expect(calls.preview).toBe(1);
    });

    test('editing opens without asking for a preview', async ({ page }) => {
        const calls = await stubPreview(page, { title: 'x' });
        await markWhatsNewSeen(page);
        await page.goto('/');
        await page.waitForFunction(() => window.dashboardInstance?.bookmarks?.length > 0, null, { timeout: 15_000 });
        await dismissOnboardingIfPresent(page);
        await dismissBlockingOverlays(page);
        await page.evaluate(() => {
            const d = window.dashboardInstance;
            return d.openBookmarkFormModal({ mode: 'edit', pageId: d.currentPageId, index: 0, bookmark: d.bookmarks[0] });
        });
        await expect(page.locator('#bookmark-form-modal')).toHaveClass(/show/);
        await page.waitForTimeout(600);
        expect(calls.preview).toBe(0);
    });
});

test.describe('bookmark form title suggestion', () => {
    test('an empty name takes the page title; a typed one is kept and Use puts it in', async ({ page }) => {
        await stubPreview(page, { title: 'Example page', description: '' });
        const form = await openAdd(page);
        const url = form.locator('[data-field="url"]');
        const name = form.locator('[data-field="name"]');
        const note = form.locator('.bookmark-form-name-note');

        await url.fill('https://example.com/a');
        await url.blur();
        await expect(name).toHaveValue('Example page');
        await expect(note).toContainText(/suggested from the page/i);

        await name.fill('Mine');
        await url.fill('https://example.com/b');
        await url.blur();
        await expect(name).toHaveValue('Mine');
        await note.getByRole('button', { name: /use/i }).click();
        await expect(name).toHaveValue('Example page');
    });

    test('a page without a title gives the host', async ({ page }) => {
        await stubPreview(page, { title: '' });
        const form = await openAdd(page);
        await form.locator('[data-field="url"]').fill('https://notitle.example/x');
        await form.locator('[data-field="url"]').blur();
        await expect(form.locator('[data-field="name"]')).toHaveValue('notitle.example');
    });
});

test('after Create + New the next address gets its title again', async ({ page }) => {
    await stubPreview(page, { title: 'Example page' });
    const form = await openAdd(page);
    const url = form.locator('[data-field="url"]');
    const name = form.locator('[data-field="name"]');
    await url.fill(`https://example.com/first-${Date.now()}`);
    await url.blur();
    await name.fill('Typed by hand');
    await form.locator('#bookmark-form-create-another').click();
    await answerNoCategory(page);
    await expect(name).toHaveValue('');
    await url.fill(`https://example.com/second-${Date.now()}`);
    await url.blur();
    await expect(name).toHaveValue('Example page');
});

/*
 * A site whose three bookmarks agree on #homelab. Each test that uses it
 * names its own host: the store is reset per spec file, not per test, and a
 * refusal in one test would silence the next one's suggestion.
 */
async function seedSite(page, host = 'agree.example') {
    await page.evaluate(async (site) => {
        const d = window.dashboardInstance;
        const api = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
        for (const slug of ['a', 'b', 'c']) {
            await api('/api/bookmarks/add', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ page: d.currentPageId, bookmark: {
                    name: `Agree ${slug}`, url: `https://${site}/${slug}`, category: '', tags: ['homelab'],
                } }),
            });
        }
        await d.loadAllBookmarks?.();
        window.TagSuggestLive.invalidate();
    }, host);
}

test.describe('bookmark form tag suggestions', () => {
    test('a site whose bookmarks share a tag offers it; + adds it; ✕ refuses it everywhere', async ({ page }) => {
        await stubPreview(page, { title: 'x' });
        const form = await openAdd(page);
        await seedSite(page);
        await form.locator('[data-field="url"]').fill('https://agree.example/new');
        await form.locator('[data-field="url"]').blur();
        const chips = form.locator('.bookmark-form-tags-suggest');
        await expect(chips.locator('.tag-suggest-chip[data-tag="homelab"]')).toBeVisible();

        await chips.locator('.tag-suggest-chip-add').first().click();
        await expect(form.locator('[data-field="tags"]')).toHaveValue(/homelab/);

        await form.locator('[data-field="tags"]').fill('');
        await form.locator('.bookmark-form-tags-suggest-refresh').click();
        await chips.locator('.tag-suggest-chip-dismiss').first().click();
        await expect(chips.locator('.tag-suggest-chip[data-tag="homelab"]')).toHaveCount(0);
        const stored = await page.evaluate(() => window.dashboardInstance.settings.dismissedTagSuggestions);
        expect(stored).toContain('agree.example|homelab');
    });

    test('editing an existing bookmark shows its suggestions without fetching the page', async ({ page }) => {
        const calls = await stubPreview(page, { title: 'x' });
        await openAdd(page);
        await seedSite(page, 'edit.example');
        await page.keyboard.press('Escape');
        await page.evaluate(async () => {
            const d = window.dashboardInstance;
            const api = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
            await api('/api/bookmarks/add', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ page: d.currentPageId, bookmark: {
                    name: 'Untagged', url: 'https://edit.example/d', category: '', tags: [],
                } }),
            });
            await d.loadAllBookmarks?.();
            await d.loadBookmarks?.();
        });
        await page.evaluate(() => {
            const d = window.dashboardInstance;
            const index = d.bookmarks.findIndex((b) => b.url === 'https://edit.example/d');
            return d.openBookmarkFormModal({ mode: 'edit', pageId: d.currentPageId, index, bookmark: d.bookmarks[index] });
        });
        const chips = page.locator('#bookmark-form-modal .bookmark-form-tags-suggest');
        await expect(chips.locator('.tag-suggest-chip[data-tag="homelab"]')).toBeVisible();
        expect(calls.preview).toBe(0);
    });
});

/*
 * A URL that arrives with the form -- pasted and sent to Add bookmark, from
 * the inbox, `:new <url>`, the extension -- never gets an input event and so
 * was never read: the fetch waited for a blur that did nothing the first time.
 * The form reads it the moment it opens.
 */
test.describe('a URL that arrives with the form', () => {
    test('paste, Add bookmark: name, card and suggestions appear without a click', async ({ page }) => {
        await stubPreview(page, { title: 'Pasted page', description: 'Said by the pasted page' });
        await markWhatsNewSeen(page);
        await page.setViewportSize({ width: 1400, height: 900 });
        await page.goto('/');
        await page.waitForFunction(() => window.dashboardInstance?._bookmarksReady === true, null, { timeout: 20_000 });
        await dismissOnboardingIfPresent(page);
        await dismissBlockingOverlays(page);
        await seedSite(page, 'pasted.example');
        await page.evaluate(() => {
            document.activeElement?.blur?.();
            const data = new DataTransfer();
            data.setData('text/plain', 'https://pasted.example/new');
            document.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true }));
        });
        await page.locator('[data-paste-choice="bookmark"]').click();
        const form = page.locator('#bookmark-form-modal .bookmark-inline-form');
        await expect(form.locator('[data-field="name"]')).toHaveValue('Pasted page');
        await expect(form.locator('.bookmark-form-card-desc')).toHaveText('Said by the pasted page');
        await expect(form.locator('.bookmark-form-tags-suggest .tag-suggest-chip[data-tag="homelab"]')).toBeVisible();
    });

    test('a name the route brought along is kept', async ({ page }) => {
        await stubPreview(page, { title: 'Page title' });
        await markWhatsNewSeen(page);
        await page.goto('/');
        await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
        await dismissOnboardingIfPresent(page);
        await dismissBlockingOverlays(page);
        await page.evaluate(() => window.dashboardInstance.openBookmarkFormModal({
            url: 'https://named.example/x', name: 'From the inbox',
        }));
        const form = page.locator('#bookmark-form-modal .bookmark-inline-form');
        await expect(form.locator('.bookmark-form-name-note')).toContainText(/Page title/);
        await expect(form.locator('[data-field="name"]')).toHaveValue('From the inbox');
    });
});

test('a refusal in the form makes Config → Tag suggestions read its words again', async ({ page }) => {
    await stubPreview(page, { title: 'x' });
    const form = await openAdd(page);
    await seedSite(page, 'config.example');
    await page.evaluate(async () => { await window.dashboardInstance.config.ensureTagKeywords?.(); });
    expect(await page.evaluate(() => window.dashboardInstance.config._tagKeywordsPromise != null)).toBe(true);
    await form.locator('[data-field="url"]').fill('https://config.example/new');
    await form.locator('[data-field="url"]').blur();
    await form.locator('.bookmark-form-tags-suggest .tag-suggest-chip[data-tag="homelab"] .tag-suggest-chip-dismiss').click();
    await expect.poll(() => page.evaluate(() => window.dashboardInstance.config._tagKeywordsPromise)).toBeNull();
});

/*
 * Changing the address reads the new page, all of it.
 *
 * The icon the form had fetched for the first address counted as chosen, so
 * the second address kept it; and leaving the field while the first read was
 * still running skipped the second, or let the first answer arrive last and
 * paint over it.
 */
test('a changed address replaces the card and the fetched icon, whatever arrives first', async ({ page }) => {
    await page.route('**/api/bookmark-preview*', async (route) => {
        const url = new URL(route.request().url()).searchParams.get('url') || '';
        const first = url.includes('first.example');
        if (first) await new Promise((r) => setTimeout(r, 1500));
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
            title: first ? 'First page' : 'Second page',
            description: first ? 'Said by the first page' : 'Said by the second page',
            icon: first ? 'https://first.example/icon.png' : 'https://second.example/icon.png',
        }) });
    });
    await page.route('**/api/icon/from-url', async (route) => {
        const body = route.request().postDataJSON?.() || {};
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
            icon: String(body.url || '').includes('first') ? 'first-icon.png' : 'second-icon.png',
        }) });
    });
    const form = await openAdd(page);
    const url = form.locator('[data-field="url"]');
    await url.fill('https://first.example/a');
    await url.blur();
    // Past the 250ms settle, so the first read is really running.
    await page.waitForTimeout(500);
    await url.fill('https://second.example/b');
    await url.blur();
    await expect(form.locator('.bookmark-form-card-desc')).toHaveText('Said by the second page');
    await page.waitForTimeout(1800);
    await expect(form.locator('.bookmark-form-card-desc')).toHaveText('Said by the second page');
    await expect(form.locator('.bookmark-form-card-icon img')).toHaveAttribute('src', /second-icon/);
    await expect(form.locator('[data-field="name"]')).toHaveValue('Second page');
});

test('a changed address replaces an icon the form fetched, but not one you uploaded', async ({ page }) => {
    await page.route('**/api/bookmark-preview*', async (route) => {
        const url = new URL(route.request().url()).searchParams.get('url') || '';
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
            title: 'x', icon: url.includes('one.example') ? 'https://one.example/i.png' : 'https://two.example/i.png',
        }) });
    });
    await page.route('**/api/icon/from-url', async (route) => {
        const body = route.request().postDataJSON?.() || {};
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
            icon: String(body.url || '').includes('one') ? 'one-icon.png' : 'two-icon.png',
        }) });
    });
    const form = await openAdd(page);
    const url = form.locator('[data-field="url"]');
    await url.fill('https://one.example/a');
    await url.blur();
    await expect(form.locator('.bookmark-form-card-icon img')).toHaveAttribute('src', /one-icon/);
    await url.fill('https://two.example/b');
    await url.blur();
    await expect(form.locator('.bookmark-form-card-icon img')).toHaveAttribute('src', /two-icon/);
});

/*
 * A second address that says nothing about itself -- nytimes.com answers the
 * server's read with an empty page -- still clears the first page's card and
 * gives the name its host.
 */
test('a changed address whose page says nothing still updates the card and the name', async ({ page }) => {
    await page.route('**/api/bookmark-preview*', async (route) => {
        const url = new URL(route.request().url()).searchParams.get('url') || '';
        const talks = url.includes('talks.example');
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(talks
            ? { title: 'Talking page', description: 'Says plenty', icon: 'https://talks.example/i.png' }
            : { title: '', description: '', icon: '', image: '' }) });
    });
    await page.route('**/api/icon/from-url', async (route) => {
        const body = route.request().postDataJSON?.() || {};
        const ok = String(body.url || '').includes('talks');
        await route.fulfill({ status: ok ? 200 : 404, contentType: 'application/json',
            body: JSON.stringify(ok ? { icon: 'talks-icon.png' } : {}) });
    });
    const form = await openAdd(page);
    const url = form.locator('[data-field="url"]');
    await url.fill('https://talks.example/a');
    await url.blur();
    await expect(form.locator('[data-field="name"]')).toHaveValue('Talking page');
    await expect(form.locator('.bookmark-form-card-desc')).toHaveText('Says plenty');

    await url.fill('https://www.silent.example/b');
    await url.blur();
    await expect(form.locator('.bookmark-form-card-host')).toHaveText('www.silent.example');
    await expect(form.locator('.bookmark-form-card-desc')).toHaveText(/no preview/i);
    await expect(form.locator('.bookmark-form-card-icon img')).toBeHidden();
    await expect(form.locator('[data-field="name"]')).toHaveValue('silent.example');
});

/*
 * A slow page says it is being read.
 *
 * Some sites keep the server waiting for seconds. The card already showed the
 * new host while the old page's name, line and icon stayed put, so it looked
 * as if the change had not been picked up at all.
 */
test('while a new address is read, the card and the name say so', async ({ page }) => {
    await page.route('**/api/bookmark-preview*', async (route) => {
        const url = new URL(route.request().url()).searchParams.get('url') || '';
        const slow = url.includes('slow.example');
        if (slow) await new Promise((r) => setTimeout(r, 2500));
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(slow
            ? { title: 'Slow page', description: 'Took its time' }
            : { title: 'Quick page', description: 'Answered at once', icon: 'https://quick.example/i.png' }) });
    });
    await page.route('**/api/icon/from-url', (route) => route.fulfill({
        status: 200, contentType: 'application/json', body: JSON.stringify({ icon: 'quick-icon.png' }),
    }));
    const form = await openAdd(page);
    const url = form.locator('[data-field="url"]');
    const name = form.locator('[data-field="name"]');
    await url.fill('https://quick.example/a');
    await url.blur();
    await expect(name).toHaveValue('Quick page');
    await expect(form.locator('.bookmark-form-card-icon img')).toHaveAttribute('src', /quick-icon/);

    await url.fill('https://slow.example/b');
    await url.blur();
    await expect(form.locator('.bookmark-form-card-desc')).toHaveText(/reading the page/i);
    await expect(name).toHaveValue('');
    await expect(name).toHaveAttribute('placeholder', /fetching title/i);
    // The old address's icon is gone at once; the letter stands in.
    await expect(form.locator('.bookmark-form-card-icon img')).not.toHaveAttribute('src', /quick-icon/);

    await expect(name).toHaveValue('Slow page', { timeout: 6000 });
    await expect(form.locator('.bookmark-form-card-desc')).toHaveText('Took its time');
});

/*
 * A page that cannot be read says so.
 *
 * The card emptied, and then stayed empty: no way to tell a page that had
 * nothing to say from one still being read, or from a read that failed.
 */
for (const [label, respond] of [
    ['answers with nothing', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '{}' })],
    ['fails', (route) => route.fulfill({ status: 502, contentType: 'application/json', body: '{"error":"fetch failed"}' })],
]) {
    test(`a new address whose read ${label} clears the old preview and says so`, async ({ page }) => {
        await page.route('**/api/bookmark-preview*', async (route) => {
            const url = new URL(route.request().url()).searchParams.get('url') || '';
            if (url.includes('readable.example')) {
                await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
                    title: 'Readable', description: 'The old line', image: 'data:image/gif;base64,R0lGODlhAQABAAAAACw=',
                }) });
                return;
            }
            await respond(route);
        });
        const form = await openAdd(page);
        const url = form.locator('[data-field="url"]');
        await url.fill('https://readable.example/a');
        await url.blur();
        await expect(form.locator('.bookmark-form-card-desc')).toHaveText('The old line');
        await expect(form.locator('.bookmark-form-card-image')).toBeVisible();

        await url.fill('https://blank.example/b');
        await url.blur();
        await expect(form.locator('.bookmark-form-card-desc')).toHaveText(/no preview/i);
        await expect(form.locator('.bookmark-form-card')).toHaveClass(/is-empty/);
        await expect(form.locator('.bookmark-form-card-image')).toBeHidden();
        await expect(form.locator('.bookmark-form-card-host')).toHaveText('blank.example');
    });
}

test('before there is an address the card explains itself, without a stray letter or pencil', async ({ page }) => {
    const form = await openAdd(page);
    const card = form.locator('.bookmark-form-card');
    await expect(card).toHaveClass(/is-idle/);
    await expect(card.locator('.bookmark-form-card-desc')).toHaveText(/once there is an address/i);
    await expect(card.locator('.bookmark-form-card-letter')).toBeHidden();
    await expect(card.locator('.bookmark-form-card-pencil')).toBeHidden();
});

/*
 * A second go in the same sheet reads the page again, in full.
 *
 * Create + New cleared the fields and left the card, the name suggestion,
 * the fetched icon and the address it had last read -- so the next bookmark
 * started from the last one's preview, and the same address typed again was
 * not read at all.
 */
test('after Create + New the next address is read in full, even the same one again', async ({ page }) => {
    let calls = 0;
    await page.route('**/api/bookmark-preview*', async (route) => {
        calls += 1;
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
            title: `Read ${calls}`, description: `Line ${calls}`, icon: 'https://again.example/i.png',
        }) });
    });
    await page.route('**/api/icon/from-url', (route) => route.fulfill({
        status: 200, contentType: 'application/json', body: JSON.stringify({ icon: `again-${calls}.png` }),
    }));
    const form = await openAdd(page);
    const url = form.locator('[data-field="url"]');
    const name = form.locator('[data-field="name"]');
    const address = `https://again.example/${Date.now()}`;
    await url.fill(address);
    await url.blur();
    await expect(name).toHaveValue('Read 1');
    await form.locator('#bookmark-form-create-another').click();
    await answerNoCategory(page);
    await expect(name).toHaveValue('');
    // The card starts over, not on the last bookmark's page.
    await expect(form.locator('.bookmark-form-card')).toHaveClass(/is-idle/);

    await url.fill(`${address}-two`);
    await url.blur();
    await expect(name).toHaveValue('Read 2');
    await expect(form.locator('.bookmark-form-card-desc')).toHaveText('Line 2');
    await expect(form.locator('.bookmark-form-card-icon img')).toHaveAttribute('src', /again-2/);
});

test('an address whose read gave nothing can be tried again from the card', async ({ page }) => {
    let calls = 0;
    await page.route('**/api/bookmark-preview*', async (route) => {
        calls += 1;
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(calls === 1
            ? {} : { title: 'Second try', description: 'Answered this time' }) });
    });
    const form = await openAdd(page);
    const url = form.locator('[data-field="url"]');
    await url.fill('https://flaky.example/a');
    await url.blur();
    await expect(form.locator('.bookmark-form-card-desc')).toHaveText(/no preview/i);
    await form.locator('.bookmark-form-card-retry').click();
    await expect(form.locator('.bookmark-form-card-desc')).toHaveText('Answered this time');
    await expect(form.locator('[data-field="name"]')).toHaveValue('Second try');
});

test('tags, shortcut and check each carry an explanation in the same ⓘ', async ({ page }) => {
    const form = await openAdd(page);
    for (const field of ['tags', 'shortcut', 'check']) {
        const info = form.locator(`.bookmark-form-info[data-info-for="${field}"]`);
        await info.hover();
        const bubble = page.locator('.field-popover');
        await expect(bubble).toBeVisible();
        await expect(bubble).not.toBeEmpty();
        await page.mouse.move(0, 0);
    }
    // The tags text says where suggestions come from; the shortcut one what it does.
    await form.locator('.bookmark-form-info[data-info-for="tags"]').hover();
    await expect(page.locator('.field-popover')).toContainText('Suggestions');
    // And the field itself is described, for a screen reader on the input.
    const described = await form.locator('[data-field="tags"]').getAttribute('aria-describedby');
    expect(described).toBeTruthy();
});
