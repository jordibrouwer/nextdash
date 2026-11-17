const { test, expect } = require('./fixtures');
const { mockDocker } = require('./helpers/docker-mock');

const RAW = 'services:\n  db:\n    image: postgres:15\n    restart: unless-stopped\n';
const file = (over = {}) => ({
  id: 'c0', role: 'compose', hostPath: '/opt/stacks/media/compose.yml', state: 'ok', size: RAW.length, sha256: 'abcdef0123456789',
  writable: true, masked: [], yamlError: null, warnings: [], content: RAW, ...over,
});
const answer = (over = {}) => ({
  project: 'media', host: 'local', state: 'ok', self: false, control: true, writeToken: true, workingDir: '/opt/stacks/media',
  mismatch: false, map: [{ host: '/opt/stacks', container: '/stacks' }],
  suggest: { env: 'NEXTDASH_COMPOSE_MAP=/opt/stacks:/stacks', mount: '/opt/stacks:/stacks:ro' }, files: [file()], pendingChange: false, ...over,
});
const box = (id, name, service, state, health, port) => ({
  id: id.repeat(64), shortId: id.repeat(12), name, image: `img/${service}:1`, tag: '1', state, status: state === 'running' ? 'Up 2 hours' : 'Exited (0) 1 hour ago',
  health, created: 1790000000, ports: port ? [{ private: port, public: port, type: 'tcp' }] : [], composeProject: 'media', composeService: service,
});
const CONTAINERS = [
  box('a', 'media-jellyfin-1', 'jellyfin', 'running', 'healthy', 8096),
  box('b', 'media-radarr-1', 'radarr', 'running', 'unhealthy', 7878),
  box('c', 'media-sonarr-1', 'sonarr', 'exited', '', 0),
  { id: 'd'.repeat(64), shortId: 'd'.repeat(12), name: 'nextdash', image: 'ghcr.io/jordibrouwer/nextdash:latest', tag: 'latest', state: 'running', status: 'Up 1 hour', health: '', created: 1790000000, ports: [], self: true },
];
const overlay = (page) => page.locator('#nextdash-progress-overlay');
const confirmUp = (page) => page.locator('.modal[role="dialog"]').getByRole('button', { name: /^up$/i }).click();

async function openPanel(page, { tab = 'services', answerOver = {}, mock = {} } = {}) {
  const state = await mockDocker(page, { compose: { media: answer(answerOver) }, containers: CONTAINERS, ...mock });
  state.composeRaw = { c0: RAW };
  await page.goto('/#docker');
  await expect(page.locator('[data-docker-row]')).toHaveCount(4);
  await page.locator('[data-docker-group]').selectOption('project');
  await page.locator('[data-docker-stack-files="media"]').click();
  const panel = page.locator('[data-docker-stack-panel="media"]');
  await expect(panel).toBeVisible();
  if (tab !== 'services') await panel.locator(`[data-slp-tab="${tab}"]`).click();
  return { state, panel };
}
const startEdit = async (panel) => {
  await panel.locator('[data-docker-compose-edit="c0"]').click();
  const ta = panel.locator('[data-docker-compose-editor]');
  await expect(ta).toHaveValue(RAW);
  return ta;
};

test.describe('docker compose panel, round 2', () => {
  test('the panel opens on Services; Restart on one row runs that service without asking', async ({ page }) => {
    const { state, panel } = await openPanel(page);
    await expect(panel.locator('[data-slp-tab="services"]')).toHaveClass(/is-active/);
    const rows = panel.locator('[data-docker-compose-service]');
    await expect(rows).toHaveCount(3);
    await expect(rows.nth(0)).toContainText('jellyfin');
    await expect(rows.nth(1)).toContainText('unhealthy');
    await expect(rows.nth(2)).toContainText('exited');
    await panel.locator('[data-docker-compose-svc="restart"][data-service="radarr"]').click();
    await expect(overlay(page).locator('[data-docker-run-item="media/radarr"]')).toHaveAttribute('data-state', 'done');
    expect(state.composeRuns).toEqual(['restart/radarr?stream=1']);
  });

  test('Edited, not applied: chip on the heading and a note whose Apply runs Up; no chip when nothing changed', async ({ page }) => {
    const { state, panel } = await openPanel(page, { answerOver: { pendingChange: true } });
    await expect(panel.locator('[data-docker-compose-pending]')).toBeVisible();
    await panel.locator('[data-docker-compose-pending-note] [data-slp-action="up"]').click();
    await confirmUp(page);
    await expect.poll(() => state.composeRuns || []).toEqual(['up?stream=1']);
    // A second panel on a stack that matches shows no chip.
    await page.reload();
    const again = await openPanel(page, { answerOver: { pendingChange: false } });
    await expect(again.panel.locator('[data-docker-compose-pending]')).toBeHidden();
  });

  test('Check on unsaved text sends that text, marks the failing line, links to it, and clears the mark on typing', async ({ page }) => {
    const { state, panel } = await openPanel(page, { tab: 'compose' });
    state.composeCheck = { fail: true, line: 3, column: 5 };
    const ta = await startEdit(panel);
    await panel.locator('[data-docker-compose-editor-action="check"]').click();
    const result = panel.locator('[data-docker-compose-result]');
    await expect(result).toContainText('Check failed');
    await expect(result).toContainText('Line 3');
    await expect(panel.locator('[data-docker-compose-hl]')).toBeVisible();
    await ta.evaluate((el) => el.setSelectionRange(0, 0));
    await result.locator('[data-docker-compose-editor-action="jump"]').click();
    expect(await ta.evaluate((el) => el.selectionStart)).toBe(RAW.split('\n').slice(0, 2).join('\n').length + 1 + 4);
    // Typing clears the mark.
    await ta.press('End');
    await ta.type(' ');
    await expect(panel.locator('[data-docker-compose-hl]')).toBeHidden();
    // Unsaved text goes along with the request; the saved file is not what is checked.
    await ta.fill(RAW.replace('postgres:15', 'postgres:16'));
    await panel.locator('[data-docker-compose-editor-action="check"]').click();
    await expect.poll(() => state.composeChecks).toBe(2);
    expect(state.composeCheckBodies[1]).toEqual({ file: 'c0', content: RAW.replace('postgres:15', 'postgres:16') });
    expect(state.composeSaves || []).toHaveLength(0);
  });

  test('Apply stops at a failed Check: nothing is saved and nothing runs', async ({ page }) => {
    const { state, panel } = await openPanel(page, { tab: 'compose' });
    state.composeCheck = { fail: true, line: 2, column: 3 };
    const ta = await startEdit(panel);
    await ta.fill(RAW.replace('postgres:15', 'postgres:16'));
    await panel.locator('[data-docker-compose-editor-action="apply"]').click();
    await expect(panel.locator('[data-docker-compose-result]')).toContainText('Check failed');
    expect(state.composeSaves || []).toHaveLength(0);
    expect(state.composeRuns || []).toHaveLength(0);
  });

  test('Check on a good file says so and writes nothing', async ({ page }) => {
    const { state, panel } = await openPanel(page, { tab: 'compose' });
    await startEdit(panel);
    await panel.locator('[data-docker-compose-editor-action="check"]').click();
    await expect(panel.locator('[data-docker-compose-result]')).toContainText('Check passed');
    expect(state.composeSaves || []).toHaveLength(0);
  });

  test('the Changes chip counts and opens the diff; Ctrl+S saves; Tab types two spaces', async ({ page }) => {
    const { state, panel } = await openPanel(page, { tab: 'compose' });
    const ta = await startEdit(panel);
    await ta.fill(RAW.replace('postgres:15', 'postgres:16'));
    const chip = panel.locator('[data-docker-compose-chg]');
    await expect(chip).toContainText('+1');
    await expect(chip).toContainText('−1');
    await chip.click();
    const diff = panel.locator('[data-docker-compose-diff]');
    await expect(diff.locator('.docker-compose-dl.is-add')).toContainText('postgres:16');
    await expect(diff.locator('.docker-compose-dl.is-del')).toContainText('postgres:15');
    await ta.press('Control+s');
    await expect.poll(() => (state.composeSaves || []).length).toBe(1);
    await expect(chip).toBeHidden();
    await ta.evaluate((el) => { el.focus(); el.setSelectionRange(0, 0); });
    await ta.press('Tab');
    await expect(ta).toHaveValue(/^ {2}services:/);
    expect(await ta.evaluate((el) => document.activeElement === el)).toBe(true);
  });

  test('Apply saves, then runs Up; when Up fails the file stays and the previous copy can be restored', async ({ page }) => {
    const { state, panel } = await openPanel(page, { tab: 'compose' });
    const ta = await startEdit(panel);
    await ta.fill(RAW.replace('postgres:15', 'postgres:16'));
    await panel.locator('[data-docker-compose-editor-action="apply"]').click();
    await confirmUp(page);
    await expect(overlay(page).locator('[data-docker-run-item="media"]')).toHaveAttribute('data-state', 'done');
    expect(state.composeSaves).toHaveLength(1);
    expect(state.composeRuns).toEqual(['up?stream=1']);

    await ta.fill(RAW.replace('postgres:15', 'postgres:17'));
    state.composeRun = { up: { fail: true, tail: ['port is already allocated'] } };
    await panel.locator('[data-docker-compose-editor-action="apply"]').click();
    await confirmUp(page);
    await expect(overlay(page).locator('[data-docker-run-item="media"]')).toHaveAttribute('data-state', 'fail');
    expect(state.composeSaves).toHaveLength(2);
    await expect(panel.locator('[data-docker-compose-result]')).toContainText('The file is saved, but Up failed');
    await expect(panel.locator('[data-docker-compose-editor-action="restore-prev"]')).toHaveCount(1);
  });

  test('Apply with a file that does not parse writes nothing and runs nothing', async ({ page }) => {
    const { state, panel } = await openPanel(page, { tab: 'compose' });
    const ta = await startEdit(panel);
    await ta.fill('services:\n  db: INVALID\n');
    await panel.locator('[data-docker-compose-editor-action="apply"]').click();
    await confirmUp(page);
    await expect(panel.locator('[data-docker-compose-error]')).toContainText('Line 2');
    expect(state.composeRuns || []).toHaveLength(0);
  });

  test('a backup shows what restoring it would change before Restore', async ({ page }) => {
    const { state, panel } = await openPanel(page, { tab: 'backups', mock: {} });
    state.composeBackups = { c0: [{ stamp: '20261116T101500Z', size: 60 }] };
    state.composeBackupRaw = { '20261116T101500Z': RAW.replace('postgres:15', 'postgres:14') };
    await panel.locator('[data-slp-tab="services"]').click();
    await panel.locator('[data-slp-tab="backups"]').click();
    await panel.locator('[data-docker-compose-bkdiff]').click();
    const row = panel.locator('[data-docker-compose-bkdiffrow]');
    await expect(row.locator('.docker-compose-dl.is-del')).toContainText('postgres:15');
    await expect(row.locator('.docker-compose-dl.is-add')).toContainText('postgres:14');
    expect(state.composeRestores || []).toHaveLength(0);
  });

  test('Logs: lines of two services come tagged, and a chip filters to one', async ({ page }) => {
    const { state, panel } = await openPanel(page, { mock: {} });
    state.composeLogs = [
      { t: '2026-11-17T09:10:02.000Z', s: 'out', m: 'listening on 8096', service: 'jellyfin', container: 'media-jellyfin-1' },
      { t: '2026-11-17T09:10:03.000Z', s: 'out', m: 'listening on 7878', service: 'radarr', container: 'media-radarr-1' },
    ];
    await panel.locator('[data-slp-tab="logs"]').click();
    const lines = panel.locator('[data-logs-line]');
    await expect(lines).toHaveCount(2);
    await expect(lines.nth(0)).toContainText('jellyfin');
    await expect(lines.nth(1)).toContainText('radarr');
    await panel.locator('[data-logs-service="radarr"]').click();
    await expect(panel.locator('[data-logs-line]:visible')).toHaveCount(1);
    await expect(panel.locator('[data-logs-line]:visible')).toContainText('listening on 7878');
  });
});
