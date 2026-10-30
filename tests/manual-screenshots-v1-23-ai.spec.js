// @ts-check
/*
 * The MANUAL.md screenshots of the assistant and the MCP endpoint (chapter 23),
 * over the demo that nextDash seeds itself (NEXTDASH_DEMO=1):
 *
 *   MANUAL_SHOTS=1 NEXTDASH_DATA_DIR=<seed> PW_WORKERS=8 \
 *     npx playwright test tests/manual-screenshots-v1-23-ai.spec.js
 *
 * The assistant is off in the demo, so each shot's copy of the data gets the
 * settings, a stored key and finished conversations written into it; no model
 * is called. The key is a placeholder and never leaves the data copy.
 */
const fs = require('fs');
const path = require('path');
const { test, prepare, settle, snap, openDashboard, DESKTOP } = require('./helpers/manual-shot-kit');

test.skip(!process.env.MANUAL_SHOTS, 'manual screenshots run on purpose only');
test.describe.configure({ mode: 'parallel' });
test.use({ viewport: DESKTOP, reducedMotion: 'reduce' });
test.setTimeout(90_000);

const MIN = 60_000;

/** Messages and proposals as the assistant stores them. */
function conversations(now) {
    const answer = (id, text, extra = {}) => ({
        id, role: 'assistant', text, tools: [], proposals: [], provider: 'anthropic', model: 'claude-sonnet-5-5',
        tokensIn: 5200, tokensOut: 310, created: now, ...extra,
    });
    const question = (id, text, created) => ({ id, role: 'user', text, tools: [], proposals: [], provider: '', model: '', tokensIn: 0, tokensOut: 0, created });
    return [
        {
            id: 'c-down',
            title: 'Which of my links are down?',
            created: now - 12 * MIN,
            updated: now - 11 * MIN,
            messages: [
                question('m1', 'Which of my links are down? Tidy up what is dead.', now - 12 * MIN),
                answer('m2',
                    'Three bookmarks failed their last check:\n\n' +
                    '- **Podcast feed** (podcast.example.net): DNS lookup failed, down for 3 days\n' +
                    '- **Homelab wiki** (wiki.example.org): HTTP 404 since the same day\n' +
                    '- **Shodan** (shodan.io): HTTP 502, probably a hiccup on their side\n\n' +
                    'The first two look gone for good. I would tag Shodan and keep it, and move the other two out of sight.',
                    {
                        created: now - 11 * MIN,
                        tools: [{ name: 'list_health_issues', bytes: 1480 }, { name: 'search_bookmarks', bytes: 2210 }],
                        proposals: [
                            {
                                id: 'p1', tool: 'update_bookmark', status: 'pending', destructive: false, error: '', result: '',
                                arguments: { url: 'https://www.shodan.io/', tags_add: ['check-later'] },
                                reason: 'The 502 may pass; tagged so it comes back in a search.',
                            },
                            {
                                id: 'p2', tool: 'delete_bookmark', status: 'pending', destructive: true, error: '', result: '',
                                arguments: { url: 'https://podcast.example.net/feed' },
                                reason: 'The domain no longer resolves. It goes to the Trash, where you can restore it.',
                            },
                        ],
                    }),
            ],
        },
        {
            id: 'c-tags',
            title: 'Tag everything about Proxmox',
            created: now - 3 * 86_400_000,
            updated: now - 3 * 86_400_000,
            messages: [
                question('m3', 'Tag everything about Proxmox', now - 3 * 86_400_000),
                answer('m4', 'Done: four bookmarks now carry the tag proxmox.', { created: now - 3 * 86_400_000, tools: [{ name: 'search_bookmarks', bytes: 1900 }] }),
            ],
        },
        {
            id: 'c-inbox',
            title: 'What is waiting in my Inbox?',
            created: now - 6 * 86_400_000,
            updated: now - 6 * 86_400_000,
            messages: [
                question('m5', 'What is waiting in my Inbox?', now - 6 * 86_400_000),
                answer('m6', 'Nine unread links, the oldest from three weeks ago.', { created: now - 6 * 86_400_000, tools: [{ name: 'list_inbox', bytes: 3100 }] }),
            ],
        },
    ];
}

/** Settings, a placeholder key and the conversations, written into this shot's copy of the data. */
const withAssistant = (extra = {}) => ({
    run(dir) {
        const file = path.join(dir, 'settings.json');
        const settings = JSON.parse(fs.readFileSync(file, 'utf8'));
        Object.assign(settings, {
            aiEnabled: true,
            aiProvider: 'anthropic',
            mcpEnabled: true,
            mcpHealthInbox: true,
            mcpContainersRead: true,
            ...extra,
        });
        fs.writeFileSync(file, JSON.stringify(settings, null, 2));
        fs.writeFileSync(path.join(dir, 'ai-secrets.json'), JSON.stringify({ keys: { anthropic: 'sk-ant-placeholder-for-screenshots' } }), { mode: 0o600 });
        fs.writeFileSync(path.join(dir, 'ai-conversations.json'), JSON.stringify(conversations(Date.now()), null, 2));
    },
});

test.use({ dataTweak: withAssistant() });

test('23 assistant panel', async ({ page }) => {
    await prepare(page);
    await openDashboard(page);
    await page.evaluate(() => { document.body.focus(); });
    await page.keyboard.press('=');
    await page.keyboard.press('Enter');
    const panel = page.locator('.assistant-panel');
    await panel.waitFor();
    await panel.getByRole('button', { name: /^Which of my links are down\?/ }).click();
    await panel.locator('[data-ai-thread]').getByText('Three bookmarks failed').waitFor();
    // Pacing for the capture, not a condition: the panel finishes sliding in before the frame is taken.
    await page.waitForTimeout(800);
    await snap(page, panel, '23-assistant-panel.jpg', { pad: 14 });
});

test('23 assistant conversations', async ({ page }) => {
    await prepare(page);
    await openDashboard(page);
    await page.evaluate(() => { document.body.focus(); });
    await page.keyboard.press('=');
    // Pacing for the capture, not a condition: the list of conversations finishes drawing before the frame is taken.
    await page.waitForTimeout(800);
    await page.screenshot({ path: path.join(process.env.SHOTS_OUT || 'screenshots/manual.md', '23-assistant-conversations.jpg'), type: 'jpeg', quality: 88, clip: { x: 290, y: 285, width: 860, height: 330 } });
});

async function openConfig(page, section) {
    await openDashboard(page);
    await page.locator('.config-link-anchor').click();
    await page.locator('[data-config-section]').first().waitFor();
    await page.locator(`[data-config-section="${section}"]`).click();
    // Pacing for the capture, not a condition: a transition gets time to finish before the frame is taken.
    await page.waitForTimeout(800);
    await settle(page);
}

test('23 assistant settings', async ({ page }) => {
    await prepare(page);
    await openConfig(page, 'assistant');
    await page.setViewportSize({ width: 1440, height: 1500 });
    await page.locator('[data-ai-panel]').waitFor();
    // Pacing for the capture, not a condition: the panels finish laying out before the frame is taken.
    await page.waitForTimeout(600);
    await snap(page, page.locator('[data-ai-panel]'), '23-assistant-settings.jpg', { pad: 14 });
});

test('23 mcp access', async ({ page }) => {
    await prepare(page);
    await openConfig(page, 'data-backups');
    await page.locator('[data-db-tab="webhooks"]').click();
    const panel = page.locator('[data-fold="mcp"]');
    await panel.waitFor();
    if (!(await panel.evaluate((el) => /** @type {HTMLDetailsElement} */ (el).open))) await panel.locator('summary').click();
    await page.setViewportSize({ width: 1440, height: 1500 });
    // The test server's port is random; the picture shows the address a reader would give the tool.
    await panel.locator('.config-mcp-address').evaluate((el) => { el.textContent = 'http://your-host:8080/mcp'; });
    // Pacing for the capture, not a condition: the fold finishes opening before the frame is taken.
    await page.waitForTimeout(600);
    await snap(page, panel, '23-mcp-access.jpg', { pad: 14 });
});
