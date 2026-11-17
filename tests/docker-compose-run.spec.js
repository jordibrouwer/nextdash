const { test, expect } = require('./fixtures');
const { mockDocker } = require('./helpers/docker-mock');

const file = () => ({
  id: 'c0', role: 'compose', hostPath: '/opt/stacks/media/compose.yml', state: 'ok', size: 40, sha256: 'abcdef0123456789',
  writable: true, masked: [], yamlError: null, warnings: [], content: 'services:\n  db:\n    image: postgres:15\n',
});
const answer = (over = {}) => ({
  project: 'media', host: 'local', state: 'ok', self: false, control: true, writeToken: true, workingDir: '/opt/stacks/media',
  mismatch: false, map: [{ host: '/opt/stacks', container: '/stacks' }],
  suggest: { env: 'NEXTDASH_COMPOSE_MAP=/opt/stacks:/stacks', mount: '/opt/stacks:/stacks:ro' }, files: [file()], ...over,
});
const overlay = (page) => page.locator('#nextdash-progress-overlay');
const modal = (page) => page.locator('.modal[role="dialog"]');
const confirmUp = (page) => modal(page).getByRole('button', { name: /^up$/i }).click();

async function openPanel(page, opts = {}) {
  const state = await mockDocker(page, { compose: { media: answer(opts.answer) }, ...opts.mock });
  await page.goto('/#docker');
  await expect(page.locator('[data-docker-row]')).toHaveCount(4);
  await page.locator('[data-docker-group]').selectOption('project');
  await page.locator('[data-docker-stack-files="media"]').click();
  await page.locator('[data-docker-stack-panel=\"media\"] [data-slp-tab=\"compose\"]').click();
  const panel = page.locator('[data-docker-stack-panel="media"]');
  await expect(panel).toContainText('services');
  return { state, panel };
}
const btn = (panel, a) => panel.locator(`.config-bm-panel-actions [data-slp-action="${a}"]`);

test.describe('docker compose run (Up, Down, Pull)', () => {
  test('Up streams its log lines into the output and ends done', async ({ page }) => {
    const { state, panel } = await openPanel(page);
    await btn(panel, 'up').click();
    await confirmUp(page);
    const row = overlay(page).locator('[data-docker-run-item="media"]');
    await expect(row.locator('[data-docker-run-log]')).toContainText('up media: first line');
    await expect(row.locator('[data-docker-run-log]')).toContainText('up media: second line');
    await expect(row).toHaveAttribute('data-state', 'done');
    await expect(row.locator('[data-step="validate"]')).toHaveAttribute('data-state', 'done');
    expect(state.composeRuns).toEqual(['up?stream=1']);
  });

  test('Up asks first: it names the recreated services and the blank variables, and Cancel sends nothing', async ({ page }) => {
    const { state, panel } = await openPanel(page);
    await btn(panel, 'up').click();
    await expect(modal(page)).toContainText('recreates every service whose file or image changed');
    await expect(modal(page)).toContainText('blank');
    await modal(page).getByRole('button', { name: /cancel/i }).click();
    expect(state.composeRuns || []).toHaveLength(0);
    await expect(btn(panel, 'up')).toBeEnabled();
  });

  test('Pull runs without asking and shows its steps', async ({ page }) => {
    const { state, panel } = await openPanel(page);
    await btn(panel, 'pull').click();
    await expect(overlay(page).locator('[data-docker-run-item="media"]')).toHaveAttribute('data-state', 'done');
    expect(state.composeRuns).toEqual(['pull?stream=1']);
  });

  test('Down asks first and names what it does: Cancel sends nothing, Confirm sends the run', async ({ page }) => {
    const { state, panel } = await openPanel(page);
    await btn(panel, 'down').click();
    await expect(modal(page)).toContainText('Volumes and images stay');
    await modal(page).getByRole('button', { name: /cancel/i }).click();
    expect(state.composeRuns || []).toHaveLength(0);
    await btn(panel, 'down').click();
    await modal(page).getByRole('button', { name: /^down$/i }).click();
    await expect.poll(() => (state.composeRuns || []).length).toBe(1);
    expect(state.composeRuns[0]).toBe('down?stream=1');
  });

  test('the stack panel stays open after a run: confirm, the progress overlay and its Close', async ({ page }) => {
    const { state, panel } = await openPanel(page);
    await btn(panel, 'down').click();
    await modal(page).getByRole('button', { name: /^down$/i }).click();
    await expect.poll(() => (state.composeRuns || []).length).toBe(1);
    await expect(overlay(page).locator('[data-docker-run-item="media"]')).toHaveAttribute('data-state', 'done');
    await expect(overlay(page)).toBeHidden();
    await expect(panel).toBeVisible();
    await expect(panel).toContainText('services');
  });

  test('the stack panel also stays open after a failed run: a press on the overlay and on its Close', async ({ page }) => {
    const { state, panel } = await openPanel(page);
    state.composeRun = { up: { fail: true, tail: ['port is already allocated'] } };
    await btn(panel, 'up').click();
    await confirmUp(page);
    await expect(overlay(page).locator('[data-docker-run-item="media"]')).toHaveAttribute('data-state', 'fail');
    await overlay(page).locator('[data-docker-run-item="media"]').click();
    await expect(panel).toBeVisible();
    await overlay(page).getByRole('button', { name: /close/i }).click();
    await expect(overlay(page)).toBeHidden();
    await expect(panel).toBeVisible();
  });

  test('a failed run shows the exit code and the last lines', async ({ page }) => {
    const { state, panel } = await openPanel(page);
    state.composeRun = { up: { fail: true, tail: ['service db: exited with code 1', 'port is already allocated'] } };
    await btn(panel, 'up').click();
    await confirmUp(page);
    const row = overlay(page).locator('[data-docker-run-item="media"]');
    await expect(row).toHaveAttribute('data-state', 'fail');
    await expect(row).toContainText('exit code 1');
    await expect(row.locator('[data-docker-run-log]')).toContainText('port is already allocated');
  });

  test('control off: all three buttons are disabled and the reason names the switch', async ({ page }) => {
    const { state, panel } = await openPanel(page, { mock: { control: false } });
    for (const a of ['up', 'down', 'pull']) {
      await expect(btn(panel, a)).toBeDisabled();
      await expect(btn(panel, a)).toHaveAttribute('title', /NEXTDASH_DOCKER_CONTROL=1/);
    }
    await expect(panel.locator('[data-docker-compose-runnote]')).toContainText('NEXTDASH_DOCKER_CONTROL=1');
    expect(state.composeRuns || []).toHaveLength(0);
  });

  test("nextDash's own stack: the buttons are disabled with the note", async ({ page }) => {
    const { panel } = await openPanel(page, { answer: { self: true } });
    for (const a of ['up', 'down', 'pull']) await expect(btn(panel, a)).toBeDisabled();
    await expect(panel.locator('[data-docker-compose-runnote]')).toContainText('own stack');
  });
});
