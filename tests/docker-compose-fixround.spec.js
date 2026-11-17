const { test, expect } = require('./fixtures');
const { mockDocker } = require('./helpers/docker-mock');
const { markWhatsNewSeen, markConfigSettingPromosSeen, dismissBlockingOverlays } = require('./e2e-helpers');

// Fix round on the compose panel's frontend (docs/compose-management-final-review.md):
// unsaved edits, the Logs tab, the heading chip, Apply as a flow, .env, masks, the Config row.

const RAW = 'services:\n  db:\n    image: postgres:15\n    restart: unless-stopped\n';
const file = (over = {}) => ({
  id: 'c0', role: 'compose', hostPath: '/opt/stacks/media/compose.yml', state: 'ok', size: RAW.length, sha256: 'abcdef0123456789',
  writable: true, masked: [], yamlError: null, warnings: [], content: RAW, ...over,
});
const envFile = (over = {}) => ({
  id: 'e0', role: 'env', hostPath: '/opt/stacks/media/.env', state: 'ok', size: 12, sha256: 'envsha0123456789',
  writable: true, masked: [], yamlError: null, warnings: [], content: 'TZ=Europe/Amsterdam\n', ...over,
});
const answer = (over = {}) => ({
  project: 'media', host: 'local', state: 'ok', self: false, control: true, writeToken: true, workingDir: '/opt/stacks/media',
  mismatch: false, map: [{ host: '/opt/stacks', container: '/stacks' }],
  suggest: { env: 'NEXTDASH_COMPOSE_MAP=/opt/stacks:/stacks', mount: '/opt/stacks:/stacks:ro' }, files: [file()], pendingChange: false, ...over,
});
const box = (id, name, service, state) => ({
  id: id.repeat(64), shortId: id.repeat(12), name, image: `img/${service}:1`, tag: '1', state, status: 'Up 2 hours',
  health: '', created: 1790000000, ports: [], composeProject: 'media', composeService: service,
});
const CONTAINERS = [
  box('a', 'media-jellyfin-1', 'jellyfin', 'running'),
  box('b', 'media-radarr-1', 'radarr', 'running'),
  { id: 'd'.repeat(64), shortId: 'd'.repeat(12), name: 'nextdash', image: 'ghcr.io/jordibrouwer/nextdash:latest', tag: 'latest', state: 'running', status: 'Up 1 hour', health: '', created: 1790000000, ports: [], self: true },
];
const modal = (page) => page.locator('.modal[role="dialog"]');
const confirmUp = (page) => modal(page).getByRole('button', { name: /^up$/i }).click();

async function openPanel(page, { tab = 'compose', answerOver = {}, mock = {}, open = true } = {}) {
  const state = await mockDocker(page, { compose: { media: answer(answerOver) }, containers: CONTAINERS, ...mock });
  state.composeRaw = { c0: RAW, e0: 'TZ=Europe/Amsterdam\n' };
  await page.goto('/#docker');
  await expect(page.locator('[data-docker-row]')).toHaveCount(3);
  await page.locator('[data-docker-group]').selectOption('project');
  const panel = page.locator('[data-docker-stack-panel="media"]');
  if (!open) return { state, panel };
  await page.locator('[data-docker-stack-files="media"]').click();
  await expect(panel).toBeVisible();
  if (tab !== 'services') await panel.locator(`[data-slp-tab="${tab}"]`).click();
  return { state, panel };
}
const startEdit = async (panel, id = 'c0', text = RAW) => {
  await panel.locator(`[data-docker-compose-edit="${id}"]`).click();
  const ta = panel.locator('[data-docker-compose-editor]');
  await expect(ta).toHaveValue(text);
  return ta;
};

test.describe('docker compose panel, fix round', () => {
  test('unsaved text survives a press on another container; Discard leaves for it', async ({ page }) => {
    const { panel } = await openPanel(page);
    const ta = await startEdit(panel);
    await ta.fill(RAW.replace('postgres:15', 'postgres:16'));
    await page.locator('[data-docker-row="media-radarr-1"]').click();
    await expect(modal(page)).toContainText('unsaved changes in /opt/stacks/media/compose.yml');
    await modal(page).getByRole('button', { name: /cancel/i }).click();
    await expect(panel).toBeVisible();
    await expect(ta).toHaveValue(/postgres:16/);
    await page.locator('[data-docker-row="media-radarr-1"]').click();
    await modal(page).getByRole('button', { name: /^discard$/i }).click();
    await expect(panel).toHaveCount(0);
    await expect(page.locator('[data-docker-drawer]')).toContainText('media-radarr-1');
  });

  test('unsaved text survives the Files button of the stack and the Escape key; a clean editor asks nothing', async ({ page }) => {
    const { panel } = await openPanel(page);
    const ta = await startEdit(panel);
    await ta.fill(RAW.replace('postgres:15', 'postgres:16'));
    // A press beside the panel closes it, unless text would be lost.
    await page.locator('body').click({ position: { x: 5, y: 5 } });
    await expect(modal(page)).toContainText('unsaved changes');
    await modal(page).getByRole('button', { name: /cancel/i }).click();
    await expect(ta).toHaveValue(/postgres:16/);
    // The panel covers the heading's button on a narrow window: the press is sent to it directly.
    await page.locator('[data-docker-stack-files="media"]').dispatchEvent('click');
    await expect(modal(page)).toContainText('Leaving this panel throws them away');
    await modal(page).getByRole('button', { name: /cancel/i }).click();
    await expect(ta).toHaveValue(/postgres:16/);
    // Escape inside the textarea only leaves the field; outside it, it closes the panel.
    await page.evaluate(() => document.activeElement.blur());
    await page.keyboard.press('Escape');
    await expect(modal(page)).toContainText('unsaved changes');
    await modal(page).getByRole('button', { name: /cancel/i }).click();
    await expect(panel).toBeVisible();
  });

  test('Restore with an edit that is not saved says so; Cancel keeps the edit and sends nothing', async ({ page }) => {
    const { state, panel } = await openPanel(page);
    state.composeBackups = { c0: [{ stamp: '20261116T101500Z', size: 40 }] };
    state.composeBackupRaw = { '20261116T101500Z': RAW.replace('postgres:15', 'postgres:14') };
    const ta = await startEdit(panel);
    await ta.fill(RAW.replace('postgres:15', 'postgres:16'));
    await panel.locator('[data-slp-tab="backups"]').click();
    await panel.locator('[data-docker-compose-restore]').click();
    await expect(modal(page)).toContainText('Your unsaved changes in the editor are lost');
    await modal(page).getByRole('button', { name: /cancel/i }).click();
    expect(state.composeRestores || []).toHaveLength(0);
    await panel.locator('[data-slp-tab="compose"]').click();
    await expect(panel.locator('[data-docker-compose-editor]')).toHaveValue(/postgres:16/);
  });

  test('Logs: end markers are not rows, and the stream reconnects from the last line', async ({ page }) => {
    const { state, panel } = await openPanel(page, { tab: 'services' });
    state.composeLogs = [
      { t: '2026-11-17T09:10:02.000Z', s: 'out', m: 'listening on 8096', service: 'jellyfin', container: 'media-jellyfin-1' },
      { t: '2026-11-17T09:10:03.000Z', s: 'out', m: 'listening on 7878', service: 'radarr', container: 'media-radarr-1' },
      { s: 'end', service: 'jellyfin', container: 'media-jellyfin-1' },
    ];
    state.composeLogsNext = [
      { t: '2026-11-17T09:10:03.000Z', s: 'out', m: 'listening on 7878', service: 'radarr', container: 'media-radarr-1' },
      { t: '2026-11-17T09:10:09.000Z', s: 'out', m: 'jellyfin is back', service: 'jellyfin', container: 'media-jellyfin-2' },
    ];
    await panel.locator('[data-slp-tab="logs"]').click();
    await expect.poll(() => (state.composeLogRequests || []).length, { timeout: 8000 }).toBeGreaterThanOrEqual(2);
    expect(state.composeLogRequests[0]).not.toContain('since');
    expect(state.composeLogRequests[1]).toMatch(/since=\d+\.\d{3}/);
    const rows = panel.locator('[data-logs-line]');
    await expect(rows).toHaveCount(3);
    await expect(rows.nth(2)).toContainText('jellyfin is back');
    for (const text of await panel.locator('[data-logs-line] .docker-logs-text').allTextContents()) expect(text).not.toBe('');
  });

  test('Logs: a stream that drops says so, retries, and offers Reconnect at the end', async ({ page }) => {
    const { state, panel } = await openPanel(page, { tab: 'services' });
    state.composeLogs = [{ t: '2026-11-17T09:10:02.000Z', s: 'out', m: 'hello', service: 'jellyfin', container: 'media-jellyfin-1' }];
    await panel.locator('[data-slp-tab="logs"]').click();
    // The mock closes the stream with no marker: that is a dropped connection, not "Following".
    await expect(panel.locator('[data-logs-status]')).toContainText(/Disconnected|Reconnecting/);
    await expect(panel.locator('[data-logs-status]')).not.toContainText('Following');
    await expect.poll(() => (state.composeLogRequests || []).length, { timeout: 8000 }).toBeGreaterThanOrEqual(2);
  });

  test('the stack heading in the list carries the chip, before the panel is opened', async ({ page }) => {
    await openPanel(page, { answerOver: { pendingChange: true }, open: false });
    await expect(page.locator('[data-docker-stack-pending="media"]')).toBeVisible();
  });

  test('the stack heading shows no chip when the file matches', async ({ page }) => {
    await openPanel(page, { answerOver: { pendingChange: false }, open: false });
    await expect(page.locator('[data-docker-stack-pending="media"]')).toBeHidden();
  });

  test('Apply shows Check, Save and Up as steps, and a failed Check says nothing was written', async ({ page }) => {
    const { state, panel } = await openPanel(page);
    state.composeCheck = { fail: true, line: 2, column: 3 };
    const ta = await startEdit(panel);
    await ta.fill(RAW.replace('postgres:15', 'postgres:16'));
    await panel.locator('[data-docker-compose-editor-action="apply"]').click();
    const card = panel.locator('[data-docker-compose-result]');
    await expect(card).toContainText('Apply stopped: Check failed');
    await expect(card).toContainText('Check: failed');
    await expect(card).toContainText('Save: waiting');
    await expect(card).toContainText('Nothing was written and nothing was started');
    expect(state.composeSaves || []).toHaveLength(0);
    expect(state.composeRuns || []).toHaveLength(0);
  });

  test('Apply: Cancel on the Up question writes nothing; a good run ends with every step done', async ({ page }) => {
    const { state, panel } = await openPanel(page);
    const ta = await startEdit(panel);
    await ta.fill(RAW.replace('postgres:15', 'postgres:16'));
    await panel.locator('[data-docker-compose-editor-action="apply"]').click();
    await modal(page).getByRole('button', { name: /cancel/i }).click();
    await expect(panel.locator('[data-docker-compose-result]')).toContainText('Apply cancelled');
    expect(state.composeSaves || []).toHaveLength(0);
    await panel.locator('[data-docker-compose-editor-action="apply"]').click();
    await confirmUp(page);
    const card = panel.locator('[data-docker-compose-result]');
    await expect(card).toContainText('Applied');
    await expect(card).toContainText('Check: done');
    await expect(card).toContainText('Save: done');
    await expect(card).toContainText('Up: done');
    expect(state.composeSaves).toHaveLength(1);
  });

  test('Apply on a text too long to check goes on to Save and Up', async ({ page }) => {
    const { state, panel } = await openPanel(page);
    state.composeCheck = { status: 413 };
    const ta = await startEdit(panel);
    await ta.fill(RAW.replace('postgres:15', 'postgres:16'));
    await panel.locator('[data-docker-compose-editor-action="apply"]').click();
    await confirmUp(page);
    await expect(panel.locator('[data-docker-compose-result]')).toContainText('Check: skipped');
    await expect.poll(() => (state.composeRuns || []).length).toBe(1);
    expect(state.composeSaves).toHaveLength(1);
  });

  test('a .env file has no Check; Apply saves it and runs Up without sending it to Check', async ({ page }) => {
    const { state, panel } = await openPanel(page, { tab: 'env', answerOver: { files: [file(), envFile()] } });
    const ta = await startEdit(panel, 'e0', 'TZ=Europe/Amsterdam\n');
    await expect(panel.locator('[data-docker-compose-check]')).toHaveCount(0);
    await ta.fill('TZ=UTC\n');
    await panel.locator('[data-docker-compose-editor-action="apply"]').click();
    await confirmUp(page);
    await expect.poll(() => (state.composeRuns || []).length).toBe(1);
    expect(state.composeSaves).toHaveLength(1);
    expect(state.composeSaves[0].file).toBe('e0');
    expect(state.composeChecks || 0).toBe(0);
  });

  test('a second Edit while one editor is open says why it does nothing', async ({ page }) => {
    const { panel } = await openPanel(page, { answerOver: { files: [file(), envFile()] } });
    await startEdit(panel);
    await panel.locator('[data-slp-tab="env"]').click();
    await panel.locator('[data-docker-compose-edit="e0"]').click();
    await expect(page.locator('body')).toContainText('Another file is open in the editor');
  });

  test('two masked values on one line each reveal by index, and carry their own name', async ({ page }) => {
    const content = 'services:\n  db:\n    environment: {A: ••••••, B: ••••••}\n';
    const { state, panel } = await openPanel(page, {
      answerOver: { files: [file({ content, masked: [
        { key: 'services.db.environment.A', name: 'A', line: 3, index: 0 },
        { key: 'services.db.environment.B', name: 'B', line: 3, index: 1 }] })] },
    });
    const reveals = panel.locator('[data-docker-compose-reveal]');
    await expect(reveals).toHaveCount(2);
    await expect(reveals.nth(0)).toHaveAttribute('aria-label', 'Reveal A');
    await expect(reveals.nth(1)).toHaveAttribute('aria-label', 'Reveal B');
    await reveals.nth(1).click();
    const masks = panel.locator('[data-docker-compose-mask]');
    await expect(masks.nth(1)).toHaveText('hunter2');
    await expect(masks.nth(0)).toHaveText('••••••');
    await expect(reveals.nth(1)).toHaveAttribute('aria-label', 'Hide B');
    await reveals.nth(0).click();
    await expect(masks.nth(0)).toHaveText('hunter2');
    expect(state.valueQueries[0]).toContain('index=1');
    expect(state.valueQueries[0]).toContain('key=services.db.environment.B');
    expect(state.valueQueries[1]).toContain('index=0');
  });

  test('after a save the panel keeps no raw text of the file, only its sha', async ({ page }) => {
    const { panel } = await openPanel(page, { open: false });
    await page.evaluate(() => {
      const proto = window.DockerComposeFiles.prototype;
      const mount = proto.mount;
      proto.mount = function (...a) { window.__compose = this; return mount.apply(this, a); };
    });
    await page.locator('[data-docker-stack-files="media"]').click();
    await panel.locator('[data-slp-tab="compose"]').click();
    const ta = await startEdit(panel);
    await ta.fill(RAW.replace('postgres:15', 'postgres:16'));
    await panel.locator('[data-docker-compose-save]').click();
    await expect(panel.locator('[data-docker-compose-status]')).toContainText('Saved');
    const kept = await page.evaluate(() => {
      const f = window.__compose._fileById('c0');
      return { content: f.content, sha: f.sha256 };
    });
    expect(kept.content).not.toContain('postgres:16');
    expect(kept.sha).toMatch(/^sha1/);
  });

  test('the log chips say which one is on', async ({ page }) => {
    const { state, panel } = await openPanel(page, { tab: 'services' });
    state.composeLogs = [];
    await panel.locator('[data-slp-tab="logs"]').click();
    const all = panel.locator('[data-logs-service=""]');
    await expect(all).toHaveAttribute('aria-pressed', 'true');
    await panel.locator('[data-logs-service="radarr"]').click();
    await expect(all).toHaveAttribute('aria-pressed', 'false');
    await expect(panel.locator('[data-logs-service="radarr"]')).toHaveAttribute('aria-pressed', 'true');
  });

  test('the editor text is 16px on a phone, so iOS does not zoom on focus', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 800 });
    const { panel } = await openPanel(page);
    const ta = await startEdit(panel);
    expect(await ta.evaluate((el) => getComputedStyle(el).fontSize)).toBe('16px');
  });
});

test.describe('Config -> Containers, Compose files', () => {
  const open = async (page, composeStatus) => {
    await markWhatsNewSeen(page);
    await markConfigSettingPromosSeen(page);
    await mockDocker(page, { composeStatus });
    await page.goto('/#config/containers/connection');
    await page.waitForSelector('[data-docker-status-panel]', { timeout: 20_000 });
    await dismissBlockingOverlays(page);
  };

  test('shows the mapped folders and what was refused', async ({ page }) => {
    await open(page, { map: [{ host: '/opt/stacks', container: '/stacks' }], rejected: ['relative/path'] });
    const row = page.locator('[data-docker-state="compose"]');
    await expect(row).toContainText('/opt/stacks → /stacks');
    await expect(row).toContainText('relative/path');
    await expect(row).toHaveAttribute('data-tone', 'warn');
  });

  test('with no folder mapped it names the variable', async ({ page }) => {
    await open(page, { map: [], rejected: [] });
    await expect(page.locator('[data-docker-state="compose"]')).toContainText('NEXTDASH_COMPOSE_MAP');
  });
});
