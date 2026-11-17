const { test, expect } = require('./fixtures');
const { mockDocker } = require('./helpers/docker-mock');

const RAW = 'services:\n  db:\n    image: postgres:15\n    environment:\n      POSTGRES_PASSWORD: hunter2\n';
const file = (over = {}) => ({
  id: 'c0', role: 'compose', hostPath: '/opt/stacks/media/compose.yml', state: 'ok', size: 120, sha256: 'abcdef0123456789',
  writable: true, masked: [{ key: 'services.db.environment.POSTGRES_PASSWORD', line: 5 }], yamlError: null, warnings: [],
  content: 'services:\n  db:\n    image: postgres:15\n    environment:\n      POSTGRES_PASSWORD: ••••••\n', ...over,
});
const answer = (over = {}) => ({
  project: 'media', host: 'local', state: 'ok', self: false, control: true, writeToken: true, workingDir: '/opt/stacks/media',
  mismatch: false, map: [{ host: '/opt/stacks', container: '/stacks' }],
  suggest: { env: 'NEXTDASH_COMPOSE_MAP=/opt/stacks:/stacks', mount: '/opt/stacks:/stacks:ro' }, files: [file()], ...over,
});

async function openPanel(page, opts = {}) {
  const state = await mockDocker(page, { compose: { media: answer(opts.answer) }, ...opts.mock });
  state.composeRaw = { c0: RAW };
  await page.goto('/#docker');
  await expect(page.locator('[data-docker-row]')).toHaveCount(4);
  await page.locator('[data-docker-group]').selectOption('project');
  await page.locator('[data-docker-stack-files="media"]').click();
  await page.locator('[data-docker-stack-panel=\"media\"] [data-slp-tab=\"compose\"]').click();
  const panel = page.locator('[data-docker-stack-panel="media"]');
  await expect(panel).toContainText('POSTGRES_PASSWORD');
  return { state, panel };
}
const modal = (page) => page.locator('.modal[role="dialog"]');

test.describe('docker compose editor', () => {
  test('edit, save, close: the PUT carries the loaded sha and the new text shows', async ({ page }) => {
    const { state, panel } = await openPanel(page);
    await panel.locator('[data-docker-compose-edit="c0"]').click();
    const ta = panel.locator('[data-docker-compose-editor]');
    await expect(ta).toHaveValue(RAW);
    await expect(panel.locator('[data-docker-compose-save]')).toBeDisabled();
    await ta.fill(RAW.replace('postgres:15', 'postgres:16'));
    await expect(panel.locator('[data-docker-compose-dirty]')).toBeVisible();
    await panel.locator('[data-docker-compose-save]').click();
    await expect(panel.locator('[data-docker-compose-status]')).toContainText('Saved');
    await expect(panel.locator('[data-docker-compose-dirty]')).toBeHidden();
    expect(state.composeSaves).toHaveLength(1);
    expect(state.composeSaves[0].sha256).toBe('abcdef0123456789');
    expect(state.composeSaves[0].content).toContain('postgres:16');
    await panel.locator('[data-docker-compose-editor-action="close"]').click();
    await expect(panel).toContainText('postgres:16');
    await expect(panel.locator('[data-docker-compose-editor]')).toHaveCount(0);
  });

  test('invalid YAML shows line and column, puts the cursor there and sends no second PUT', async ({ page }) => {
    const { state, panel } = await openPanel(page);
    await panel.locator('[data-docker-compose-edit="c0"]').click();
    const ta = panel.locator('[data-docker-compose-editor]');
    const bad = 'services:\n  db: INVALID\n';
    await ta.fill(bad);
    await panel.locator('[data-docker-compose-save]').click();
    await expect(panel.locator('[data-docker-compose-error]')).toContainText('Line 2, column 3');
    await expect(panel.locator('[data-docker-compose-save]')).toBeDisabled();
    expect(await ta.evaluate((el) => el.selectionStart)).toBe(bad.indexOf('\n') + 1 + 2);
    expect(state.composeSaves).toHaveLength(1);
    // Fixing the text frees Save again.
    await ta.fill('services:\n  db: {}\n');
    await expect(panel.locator('[data-docker-compose-save]')).toBeEnabled();
    await expect(panel.locator('[data-docker-compose-error]')).toBeHidden();
  });

  test('a stale hash offers Reload, which fetches the raw file again, and Keep editing', async ({ page }) => {
    const { state, panel } = await openPanel(page);
    state.composeSaveReply = { status: 409, body: { reason: 'compose-stale', sha256: 'ffff0000ffff0000' } };
    await panel.locator('[data-docker-compose-edit="c0"]').click();
    const ta = panel.locator('[data-docker-compose-editor]');
    await ta.fill(`${RAW}# mine\n`);
    await panel.locator('[data-docker-compose-save]').click();
    const box = panel.locator('[data-docker-compose-conflict]');
    await expect(box).toBeVisible();
    // Keep editing: the next save carries the sha the server reported.
    await box.locator('[data-docker-compose-editor-action="conflict-keep"]').click();
    await expect(box).toBeHidden();
    await panel.locator('[data-docker-compose-save]').click();
    await expect.poll(() => state.composeSaves.length).toBe(2);
    expect(state.composeSaves[1].sha256).toBe('ffff0000ffff0000');
  });

  test('stale then Reload: the raw file is fetched again and the edit is replaced', async ({ page }) => {
    const { state, panel } = await openPanel(page);
    state.composeSaveReply = { status: 409, body: { reason: 'compose-stale', sha256: 'ffff0000ffff0000' } };
    await panel.locator('[data-docker-compose-edit="c0"]').click();
    const ta = panel.locator('[data-docker-compose-editor]');
    await ta.fill(`${RAW}# mine\n`);
    await panel.locator('[data-docker-compose-save]').click();
    const raws = () => state.calls.filter((c) => c === 'GET /compose/media/files/raw').length;
    const before = raws();
    state.composeRaw = { c0: 'services: {}\n' };
    await panel.locator('[data-docker-compose-conflict] [data-docker-compose-editor-action="conflict-reload"]').click();
    await expect.poll(raws).toBe(before + 1);
    await expect(ta).toHaveValue('services: {}\n');
    await expect(panel.locator('[data-docker-compose-conflict]')).toBeHidden();
  });

  test('a file on a read-only mount shows the note and has no Edit or Save', async ({ page }) => {
    const { panel } = await openPanel(page, { answer: { files: [file({ writable: false })] } });
    await expect(panel.locator('[data-docker-compose-edit]')).toHaveCount(0);
    await expect(panel.locator('[data-docker-compose-why]').first()).toContainText('mounted read-only');
    await expect(panel.locator('[data-docker-compose-why]').first()).toContainText('NEXTDASH_RUN_AS_ROOT=true');
    await expect(panel.locator('[data-docker-compose-save]')).toHaveCount(0);
  });

  test('a save refused as read-only swaps Save for the precise note', async ({ page }) => {
    const { state, panel } = await openPanel(page);
    state.composeSaveReply = { status: 409, body: { reason: 'compose-read-only' } };
    await panel.locator('[data-docker-compose-edit="c0"]').click();
    await panel.locator('[data-docker-compose-editor]').fill(`${RAW}# x\n`);
    await panel.locator('[data-docker-compose-save]').click();
    await expect(panel.locator('[data-docker-compose-readonly]')).toContainText('The mount is read-only');
    await expect(panel.locator('[data-docker-compose-save]')).toBeDisabled();
  });

  test('control off: no Edit button, the note names the switch', async ({ page }) => {
    const { panel } = await openPanel(page, { mock: { control: false } });
    await expect(panel.locator('[data-docker-compose-edit]')).toHaveCount(0);
    await expect(panel.locator('[data-docker-compose-why]').first()).toContainText('NEXTDASH_DOCKER_CONTROL=1');
  });

  test('backups are listed, and Restore asks first: Cancel sends nothing, Confirm sends the current sha', async ({ page }) => {
    const { state, panel } = await openPanel(page);
    state.composeBackups = { c0: [{ stamp: '20261116T101500Z', size: 120 }] };
    await panel.locator('[data-slp-tab="backups"]').click();
    const row = panel.locator('[data-docker-compose-backup="20261116T101500Z"]');
    await expect(row).toBeVisible();
    await row.locator('[data-docker-compose-restore]').click();
    await modal(page).getByRole('button', { name: /cancel/i }).click();
    expect(state.composeRestores || []).toHaveLength(0);
    await row.locator('[data-docker-compose-restore]').click();
    await modal(page).getByRole('button', { name: /^restore$/i }).click();
    await expect.poll(() => (state.composeRestores || []).length).toBe(1);
    expect(state.composeRestores[0]).toMatchObject({ file: 'c0', stamp: '20261116T101500Z', body: { sha256: 'abcdef0123456789' } });
  });

  test('with no backups the tab says the first save makes one', async ({ page }) => {
    const { panel } = await openPanel(page);
    await panel.locator('[data-slp-tab="backups"]').click();
    await expect(panel.locator('[data-docker-compose-nobackups]')).toBeVisible();
  });

  test('opening Backups while editing keeps the editor and what was typed', async ({ page }) => {
    const { panel } = await openPanel(page);
    await panel.locator('[data-docker-compose-edit="c0"]').click();
    const ta = panel.locator('[data-docker-compose-editor]');
    await ta.fill(`${RAW}# typed\n`);
    await panel.locator('[data-slp-tab="backups"]').click();
    await expect(panel.locator('[data-docker-compose-nobackups]')).toBeVisible();
    await panel.locator('[data-slp-tab="compose"]').click();
    await expect(ta).toHaveValue(`${RAW}# typed\n`);
  });
});
