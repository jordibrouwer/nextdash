const { test, expect } = require('./fixtures');
const { mockDocker } = require('./helpers/docker-mock');

const file = (over = {}) => ({
  id: 'c0', role: 'compose', hostPath: '/opt/stacks/media/compose.yml', state: 'ok', size: 120, sha256: 'abcdef0123456789',
  writable: false, masked: [{ key: 'services.db.environment.POSTGRES_PASSWORD', line: 5 }], yamlError: null, warnings: [],
  content: 'services:\n  db:\n    environment:\n      POSTGRES_USER: media\n      POSTGRES_PASSWORD: ••••••\n', ...over,
});
const answer = (over = {}) => ({
  project: 'media', host: 'local', state: 'ok', self: false, control: true, writeToken: true, workingDir: '/opt/stacks/media',
  mismatch: false, map: [{ host: '/opt/stacks', container: '/stacks' }],
  suggest: { env: 'NEXTDASH_COMPOSE_MAP=/opt/stacks:/stacks', mount: '/opt/stacks:/stacks:ro' }, files: [file()], ...over,
});

async function open(page, opts, group = 'project') {
  const state = await mockDocker(page, opts);
  await page.goto('/#docker');
  await expect(page.locator('[data-docker-row]')).toHaveCount(4);
  await page.locator('[data-docker-group]').selectOption(group);
  return state;
}

test.describe('docker compose files (stack panel)', () => {
  test('Files on the heading shows the file with the secret masked, and Reveal sends the request', async ({ page }) => {
    const state = await open(page, { compose: { media: answer() } });
    await page.locator('[data-docker-stack-files="media"]').click();
    await page.locator('[data-docker-stack-panel=\"media\"] [data-slp-tab=\"compose\"]').click();
    const panel = page.locator('[data-docker-stack-panel="media"]');
    await expect(panel).toContainText('POSTGRES_PASSWORD');
    await expect(panel.locator('[data-docker-compose-mask]')).toHaveText('••••••');
    await expect(panel).not.toContainText('hunter2');
    await panel.locator('[data-docker-compose-reveal]').click();
    await expect(panel.locator('[data-docker-compose-mask]')).toHaveText('hunter2');
    expect(state.calls.some((c) => c.startsWith('GET /compose/media/files/value'))).toBeTruthy();
  });

  test('Files stays on the heading with control off', async ({ page }) => {
    await open(page, { control: false, compose: { media: answer() } });
    await expect(page.locator('[data-docker-stack-files="media"]')).toBeVisible();
    await expect(page.locator('[data-docker-stack-action]')).toHaveCount(0);
  });

  test('unmapped shows the env line and the mount line', async ({ page }) => {
    await open(page, { compose: { media: answer({ files: [file({ state: 'compose-unmapped', content: '', masked: [] })] }) } });
    await page.locator('[data-docker-stack-files="media"]').click();
    await page.locator('[data-docker-stack-panel=\"media\"] [data-slp-tab=\"compose\"]').click();
    const panel = page.locator('[data-docker-stack-panel="media"]');
    await expect(panel).toContainText('NEXTDASH_COMPOSE_MAP=/opt/stacks:/stacks');
    await expect(panel).toContainText('- /opt/stacks:/stacks:ro');
  });

  test('the project chip in a container drawer opens the stack panel and back returns', async ({ page }) => {
    await open(page, { compose: { media: answer() } }, 'none');
    await expect(page.locator('[data-docker-stack-files]')).toHaveCount(0);
    await page.locator('[data-docker-row="jellyfin"]').click();
    await page.locator('[data-docker-drawer] .docker-project-chip').click();
    await expect(page.locator('[data-docker-stack-panel="media"]')).toContainText('POSTGRES_PASSWORD');
    await page.locator('.docker-compose-back').click();
    await expect(page.locator('[data-docker-drawer]')).toContainText('jellyfin');
  });

  test('Reload makes exactly one more files request', async ({ page }) => {
    const state = await open(page, { compose: { media: answer() } });
    await page.locator('[data-docker-stack-files="media"]').click();
    await page.locator('[data-docker-stack-panel=\"media\"] [data-slp-tab=\"compose\"]').click();
    await expect(page.locator('[data-docker-stack-panel="media"]')).toContainText('POSTGRES_PASSWORD');
    const n = () => state.calls.filter((c) => c === 'GET /compose/media/files').length;
    const before = n();
    await page.locator('[data-docker-stack-panel="media"] [data-slp-action="reload"]').first().click();
    await expect.poll(n).toBe(before + 1);
  });

  // The other states a stack can be in (design D5): each says what is wrong and the one thing to do.
  const panelOf = async (page, opts) => {
    await open(page, opts);
    await page.locator('[data-docker-stack-files="media"]').click();
    await page.locator('[data-docker-stack-panel=\"media\"] [data-slp-tab=\"compose\"]').click();
    return page.locator('[data-docker-stack-panel="media"]');
  };

  test('no compose labels says there is nothing to show', async ({ page }) => {
    const panel = await panelOf(page, { compose: { media: answer({ state: 'compose-no-labels', files: [] }) } });
    await expect(panel).toContainText('No compose file for this stack');
    await expect(panel.locator('[data-docker-compose-edit]')).toHaveCount(0);
  });

  test('a missing file names the path and the mount line to check', async ({ page }) => {
    const panel = await panelOf(page, { compose: { media: answer({ files: [file({ state: 'compose-missing', content: '', masked: [] })] }) } });
    await expect(panel).toContainText('The file is not there');
    await expect(panel).toContainText('/opt/stacks/media/compose.yml');
    await expect(panel).toContainText('- /opt/stacks:/stacks:ro');
  });

  test('an unreadable file names the setting that fixes permissions', async ({ page }) => {
    const panel = await panelOf(page, { compose: { media: answer({ files: [file({ state: 'compose-denied', content: '', masked: [] })] }) } });
    await expect(panel).toContainText('nextDash cannot read the file');
    await expect(panel).toContainText('NEXTDASH_RUN_AS_ROOT=true');
  });

  test('a path outside the map names the folders nextDash reads', async ({ page }) => {
    const panel = await panelOf(page, { compose: { media: answer({ files: [file({ hostPath: '/srv/other/compose.yml', state: 'compose-outside', content: '', masked: [] })] }) } });
    await expect(panel).toContainText('This path is outside the mapped folders');
    await expect(panel).toContainText('/opt/stacks');
    await expect(panel).toContainText('NEXTDASH_COMPOSE_MAP=/opt/stacks:/stacks');
  });

  test('a folder, a wrong suffix and a huge file each get their own note', async ({ page }) => {
    const panel = await panelOf(page, { compose: { media: answer({ files: [
      file({ id: 'c0', state: 'compose-not-file', content: '', masked: [] }),
      file({ id: 'c1', state: 'compose-not-yaml', content: '', masked: [] }),
      file({ id: 'c2', state: 'compose-too-large', content: '', masked: [] }),
    ] }) } });
    await expect(panel).toContainText('That path is not a file');
    await expect(panel).toContainText('That is not a compose file');
    await expect(panel).toContainText('The file is too large to show');
  });

  test('control off keeps the file readable and names the switch, with no Edit', async ({ page }) => {
    const panel = await panelOf(page, { control: false, compose: { media: answer({ control: false, files: [file({ writable: true })] }) } });
    await expect(panel).toContainText('POSTGRES_PASSWORD');
    await expect(panel.locator('[data-docker-compose-why]').first()).toContainText('NEXTDASH_DOCKER_CONTROL=1');
    await expect(panel.locator('[data-docker-compose-edit]')).toHaveCount(0);
  });

  test('nextDash\'s own stack is readable with the note', async ({ page }) => {
    const panel = await panelOf(page, { compose: { media: answer({ self: true }) } });
    await expect(panel).toContainText('This is nextDash\'s own stack');
    await expect(panel).toContainText('Update it from your Docker host');
    await expect(panel.locator('[data-docker-compose-edit]')).toHaveCount(0);
  });

  test('another Docker host says it is not supported yet and asks for nothing', async ({ page }) => {
    const state = await open(page, { compose: { media: answer() } });
    await page.evaluate(() => { window.nextdashDockerHost = 'd_remote'; });
    await page.locator('[data-docker-stack-files="media"]').click();
    await page.locator('[data-docker-stack-panel=\"media\"] [data-slp-tab=\"compose\"]').click();
    await expect(page.locator('[data-docker-stack-panel="media"]')).toContainText('Files on another host are not supported yet');
    expect(state.calls.filter((c) => c.startsWith('GET /compose/'))).toHaveLength(0);
  });
});
