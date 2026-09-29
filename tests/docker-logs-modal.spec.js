const { test, expect } = require('./fixtures');
const { mockDocker } = require('./helpers/docker-mock');

/*
 * The logs window follows /logs/stream, an NDJSON body that stays open. A
 * Playwright route answers a request in one piece, so the stream is faked one
 * level up instead: fetch() for that path returns a ReadableStream the test
 * pushes lines into with window.__logs.push() and closes with .end().
 */
async function fakeLogStream(page) {
  await page.addInitScript(() => {
    const encoder = new TextEncoder();
    const state = { urls: [], aborted: 0, controller: null };
    window.__logs = {
      state,
      push(lines) {
        state.controller?.enqueue(encoder.encode(lines.map((l) => `${JSON.stringify(l)}\n`).join('')));
      },
      end() {
        state.controller?.close();
        state.controller = null;
      },
    };
    const real = window.fetch.bind(window);
    window.fetch = (input, init) => {
      const url = String(typeof input === 'string' ? input : input.url);
      if (!url.includes('/logs/stream')) return real(input, init);
      state.urls.push(url);
      init?.signal?.addEventListener('abort', () => { state.aborted += 1; });
      const body = new ReadableStream({ start(c) { state.controller = c; } });
      return Promise.resolve(new Response(body, { status: 200, headers: { 'Content-Type': 'application/x-ndjson' } }));
    };
  });
}

const line = (sec, m, s = 'out') => ({ t: `2026-09-29T10:00:${String(sec).padStart(2, '0')}.123456789Z`, s, m });

async function openLogs(page) {
  await mockDocker(page);
  await fakeLogStream(page);
  await page.goto('/#docker');
  await expect(page.locator('[data-docker-row]')).toHaveCount(4);
  await page.locator('[data-docker-row="sonarr"]').click({ button: 'right' });
  await page.locator('#docker-row-menu [data-docker-menu-action="logs"]').click();
  const modal = page.locator('[data-docker-logs-modal]');
  await expect(modal).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.__logs.state.urls.length)).toBe(1);
  return modal;
}

test.describe('docker logs window', () => {
  test('lines arrive live, stderr is marked, and scrolling up pauses the follow', async ({ page }) => {
    const modal = await openLogs(page);
    await expect(modal.locator('.docker-logs-modal-title')).toHaveText('sonarr');
    expect(await page.evaluate(() => window.__logs.state.urls[0])).toMatch(/\/api\/docker\/containers\/sonarr\/logs\/stream\?tail=\d+$/);

    const many = Array.from({ length: 80 }, (_, i) => line(i % 60, `line ${i}`));
    many[5] = line(5, 'something broke', 'err');
    await page.evaluate((l) => window.__logs.push(l), many);
    const rows = modal.locator('[data-logs-line]');
    await expect(rows).toHaveCount(80);
    await expect(rows.nth(5)).toHaveAttribute('data-stream', 'err');
    const body = modal.locator('[data-logs-body]');
    const atBottom = () => body.evaluate((el) => el.scrollHeight - el.scrollTop - el.clientHeight < 4);
    await expect.poll(atBottom).toBe(true);

    // Scrolled up: the follow pauses and counts what arrives meanwhile.
    await body.evaluate((el) => { el.scrollTop = 0; el.dispatchEvent(new Event('scroll')); });
    await page.evaluate((l) => window.__logs.push(l), [line(1, 'late one'), line(2, 'late two')]);
    await expect(modal.locator('[data-logs-follow]')).toContainText('2 new');
    expect(await body.evaluate((el) => el.scrollTop)).toBe(0);
    await modal.locator('[data-logs-jump]').click();
    await expect.poll(atBottom).toBe(true);
    await expect(modal.locator('[data-logs-follow]')).toContainText('Following');
    await expect(modal.locator('[data-logs-jump]')).toBeHidden();
  });

  test('search marks matches, Enter steps through them, Filter and the stream choice narrow the lines', async ({ page }) => {
    const modal = await openLogs(page);
    await page.evaluate((l) => window.__logs.push(l), [
      line(1, 'starting up'), line(2, 'Error: disk full', 'err'), line(3, 'retrying'), line(4, 'error again', 'err'), line(5, 'all fine'),
    ]);
    await expect(modal.locator('[data-logs-line]')).toHaveCount(5);

    await page.keyboard.press('/');
    await expect(modal.locator('[data-logs-search]')).toBeFocused();
    await page.keyboard.type('error');
    await expect(modal.locator('mark')).toHaveCount(2);
    await expect(modal.locator('[data-logs-count]')).toHaveText('1 of 2');
    await page.keyboard.press('Enter');
    await expect(modal.locator('[data-logs-count]')).toHaveText('2 of 2');
    await expect(modal.locator('[data-logs-line].is-current')).toContainText('error again');

    await modal.locator('[data-logs-filter]').click();
    await expect(modal.locator('[data-logs-line]:visible')).toHaveCount(2);
    await modal.locator('[data-logs-filter]').click();
    await modal.locator('[data-logs-search]').fill('');

    await modal.locator('[data-logs-stream="out"]').click();
    await expect(modal.locator('[data-logs-line]:visible')).toHaveCount(3);
    await modal.locator('[data-logs-stream="err"]').click();
    await expect(modal.locator('[data-logs-line]:visible')).toHaveCount(2);
    await modal.locator('[data-logs-stream="all"]').click();
  });

  test('a stream that ends offers Resume, which picks up after the last line', async ({ page }) => {
    const modal = await openLogs(page);
    await page.evaluate((l) => window.__logs.push(l), [line(1, 'one'), line(2, 'two')]);
    await page.evaluate(() => window.__logs.end());
    await expect(modal.locator('[data-logs-ended]')).toBeVisible();
    await modal.locator('[data-logs-resume]').click();
    await expect.poll(() => page.evaluate(() => window.__logs.state.urls.length)).toBe(2);
    expect(await page.evaluate(() => window.__logs.state.urls[1])).toContain('since=1790676002.123456789');
    // The daemon's since is inclusive: the line it sends again is not shown twice.
    await page.evaluate((l) => window.__logs.push(l), [line(2, 'two'), line(3, 'three')]);
    await expect(modal.locator('[data-logs-line]')).toHaveCount(3);
    await expect(modal.locator('[data-logs-ended]')).toBeHidden();
  });

  test('f pauses and resumes, Download saves the lines, Escape closes and lets go of the stream', async ({ page }) => {
    const modal = await openLogs(page);
    await page.evaluate((l) => window.__logs.push(l), [line(1, 'one'), line(2, 'two', 'err')]);
    await expect(modal.locator('[data-logs-line]')).toHaveCount(2);

    await modal.locator('[data-logs-body]').focus();
    await page.keyboard.press('f');
    await expect(modal.locator('[data-logs-follow]')).toContainText('Paused');
    await page.keyboard.press('f');
    await expect(modal.locator('[data-logs-follow]')).toContainText('Following');

    const [download] = await Promise.all([page.waitForEvent('download'), modal.locator('[data-logs-download]').click()]);
    expect(download.suggestedFilename()).toMatch(/^sonarr-\d{8}-\d{4}\.log$/);
    const text = require('fs').readFileSync(await download.path(), 'utf8');
    expect(text).toContain('[err] two');

    await page.keyboard.press('Escape');
    await expect(modal).toHaveCount(0);
    expect(await page.evaluate(() => window.__logs.state.aborted)).toBe(1);
    // The window was on top; the view underneath stays open, and presses
    // inside the window never counted as presses beside the side panel.
    await expect(page.locator('[data-docker-row="sonarr"]')).toBeVisible();
    await expect(page.locator('[data-docker-drawer] .config-bm-panel-title')).toHaveText('sonarr');
  });
});
