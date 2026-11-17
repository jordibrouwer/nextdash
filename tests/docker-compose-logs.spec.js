const { test, expect } = require('./fixtures');
const { mockDocker } = require('./helpers/docker-mock');

// The stack panel's Logs tab is the shared log reader (DockerLogView): search with
// next match, stdout/stderr, Pause that holds lines back, reconnect after an end
// marker, Download, and the same stream in the large logs window.

const RAW = 'services:\n  db:\n    image: postgres:15\n';
const answer = () => ({
  project: 'media', host: 'local', state: 'ok', self: false, control: true, writeToken: true, workingDir: '/opt/stacks/media',
  mismatch: false, map: [{ host: '/opt/stacks', container: '/stacks' }],
  suggest: { env: 'NEXTDASH_COMPOSE_MAP=/opt/stacks:/stacks', mount: '/opt/stacks:/stacks:ro' },
  files: [{ id: 'c0', role: 'compose', hostPath: '/opt/stacks/media/compose.yml', state: 'ok', size: RAW.length, sha256: 'abcdef0123456789', writable: true, masked: [], yamlError: null, warnings: [], content: RAW }],
  pendingChange: false,
});
const box = (id, name, service) => ({
  id: id.repeat(64), shortId: id.repeat(12), name, image: `img/${service}:1`, tag: '1', state: 'running', status: 'Up 2 hours',
  health: '', created: 1790000000, ports: [], composeProject: 'media', composeService: service,
});
const CONTAINERS = [box('a', 'media-jellyfin-1', 'jellyfin'), box('b', 'media-radarr-1', 'radarr')];

// A stack stream the test pushes into; every connection is recorded.
async function fakeStack(page) {
  await page.addInitScript(() => {
    const enc = new TextEncoder();
    const state = { urls: [], controller: null };
    window.__stack = {
      state,
      push(lines) { state.controller?.enqueue(enc.encode(lines.map((l) => `${JSON.stringify(l)}\n`).join(''))); },
      end() { state.controller?.close(); state.controller = null; },
    };
    const real = window.fetch.bind(window);
    window.fetch = (input, init) => {
      const url = String(typeof input === 'string' ? input : input.url);
      if (!/\/compose\/media\/logs\/stream/.test(url)) return real(input, init);
      state.urls.push(url);
      const body = new ReadableStream({ start(c) { state.controller = c; } });
      return Promise.resolve(new Response(body, { status: 200, headers: { 'Content-Type': 'application/x-ndjson' } }));
    };
  });
}

const line = (sec, m, service = 'jellyfin', s = 'out') => ({
  t: `2026-11-17T09:10:${String(sec).padStart(2, '0')}.123456789Z`, s, m, service, container: `media-${service}-1`,
});
// The less used controls sit behind the ⋯ button in the narrow panel.
const options = async (panel) => {
  if (await panel.locator('[data-logs-options]').isHidden()) await panel.locator('[data-logs-options-toggle]').click();
};
const push = (page, lines) => page.evaluate((l) => window.__stack.push(l), lines);

async function openLogs(page) {
  await mockDocker(page, { compose: { media: answer() }, containers: CONTAINERS });
  await fakeStack(page);
  await page.goto('/#docker');
  await expect(page.locator('[data-docker-row]')).toHaveCount(2);
  await page.locator('[data-docker-group]').selectOption('project');
  await page.locator('[data-docker-stack-files="media"]').click();
  const panel = page.locator('[data-docker-stack-panel="media"]');
  await expect(panel).toBeVisible();
  await panel.locator('[data-slp-tab="logs"]').click();
  await expect.poll(() => page.evaluate(() => window.__stack.state.urls.length)).toBe(1);
  return panel;
}

test.describe('docker compose logs tab', () => {
  test('Pause holds new lines back and Resume brings every one in', async ({ page }) => {
    const panel = await openLogs(page);
    await push(page, [line(1, 'one'), line(2, 'two', 'radarr')]);
    const rows = panel.locator('[data-logs-line]');
    await expect(rows).toHaveCount(2);
    await panel.locator('[data-logs-hold]').click();
    await push(page, [line(3, 'three'), line(4, 'four'), line(5, 'five', 'radarr')]);
    await expect(panel.locator('[data-logs-status]')).toContainText('3 waiting');
    await expect(rows).toHaveCount(2);
    await panel.locator('[data-logs-hold]').click();
    await expect(rows).toHaveCount(5);
    await expect(rows.nth(4)).toContainText('five');
    await expect(panel.locator('[data-logs-status]')).toContainText('Live');
  });

  test('an end marker reopens the stream from the last line, without repeating it', async ({ page }) => {
    const panel = await openLogs(page);
    await push(page, [line(1, 'one'), line(2, 'two', 'radarr'), { s: 'end', service: 'jellyfin', container: 'media-jellyfin-1' }]);
    await page.evaluate(() => window.__stack.end());
    await expect.poll(() => page.evaluate(() => window.__stack.state.urls.length), { timeout: 8000 }).toBe(2);
    expect(await page.evaluate(() => window.__stack.state.urls[1])).toMatch(/since=\d+\.\d{9}/);
    await push(page, [line(2, 'two', 'radarr'), line(9, 'back again')]);
    const rows = panel.locator('[data-logs-line]');
    await expect(rows).toHaveCount(3);
    await expect(rows.nth(2)).toContainText('back again');
  });

  test('search counts matches and Enter goes to the next one', async ({ page }) => {
    const panel = await openLogs(page);
    await push(page, [line(1, 'tick a'), line(2, 'other', 'radarr'), line(3, 'tick b'), line(4, 'tick c', 'radarr')]);
    await expect(panel.locator('[data-logs-line]')).toHaveCount(4);
    const search = panel.locator('[data-logs-search]');
    await search.fill('tick');
    await expect(panel.locator('[data-logs-count]')).toHaveText('1 of 3');
    await search.press('Enter');
    await expect(panel.locator('[data-logs-count]')).toHaveText('2 of 3');
    await expect(panel.locator('[data-logs-line].is-current')).toContainText('tick b');
    await options(panel);
    await panel.locator('[data-logs-filter]').click();
    await expect(panel.locator('[data-logs-line]:visible')).toHaveCount(3);
  });

  test('stdout and stderr narrow the lines, a service chip narrows to one service', async ({ page }) => {
    const panel = await openLogs(page);
    await push(page, [line(1, 'fine'), line(2, 'broke', 'radarr', 'err'), line(3, 'fine too', 'radarr')]);
    const shown = panel.locator('[data-logs-line]:visible');
    await expect(shown).toHaveCount(3);
    await options(panel);
    await panel.locator('[data-logs-stream="err"]').click();
    await expect(shown).toHaveCount(1);
    await expect(shown).toContainText('broke');
    await panel.locator('[data-logs-stream="out"]').click();
    await expect(shown).toHaveCount(2);
    await panel.locator('[data-logs-stream="all"]').click();
    await panel.locator('[data-logs-service="jellyfin"]').click();
    await expect(shown).toHaveCount(1);
  });

  test('Download names the file after the project', async ({ page }) => {
    const panel = await openLogs(page);
    await push(page, [line(1, 'one')]);
    await expect(panel.locator('[data-logs-line]')).toHaveCount(1);
    await options(panel);
    const [download] = await Promise.all([page.waitForEvent('download'), panel.locator('[data-logs-download]').click()]);
    expect(download.suggestedFilename()).toMatch(/^media-.*\.log$/);
  });

  test('Open logs window shows the whole stack in the large window', async ({ page }) => {
    const panel = await openLogs(page);
    await push(page, [line(1, 'one')]);
    await expect(panel.locator('[data-logs-window]')).toContainText('Open logs window');
    await panel.locator('[data-logs-window]').click();
    const win = page.locator('[data-docker-logs-modal]');
    await expect(win).toBeVisible();
    await expect(win.locator('.docker-logs-modal-title')).toHaveText('media');
    await expect(win.locator('[data-logs-service="radarr"]')).toBeVisible();
    await expect.poll(() => page.evaluate(() => window.__stack.state.urls.length)).toBe(2);
    await push(page, [line(2, 'in the window', 'radarr')]);
    await expect(win.locator('[data-logs-line]')).toContainText('in the window');
    await page.keyboard.press('Escape');
    await expect(win).toBeHidden();
  });
});
