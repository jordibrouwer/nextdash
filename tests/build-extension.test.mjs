/**
 * The extension build: one source tree, a Chromium and a Firefox package.
 *
 * Firefox runs background.js as a plain background script, without
 * importScripts, so its manifest has to list the helpers that call loads, in
 * the same order. The list is read from background.js; this test builds both
 * targets into a temporary folder and checks that the Firefox manifest carries
 * exactly those files, that the Chromium one is the source manifest, and that
 * Firefox gets its gecko settings and opt-in host permissions.
 *
 * Run with: node tests/build-extension.test.mjs
 */
import assert from 'node:assert';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  backgroundHelperScripts,
  buildTarget,
  GECKO_ID,
  GECKO_MIN_VERSION,
} from '../scripts/build-extension.mjs';

const source = JSON.parse(readFileSync('extension/manifest.json', 'utf8'));
const helpers = backgroundHelperScripts(readFileSync('extension/background.js', 'utf8'));
const out = mkdtempSync(join(tmpdir(), 'nextdash-extension-build-'));

try {
  const chromium = buildTarget('chromium', out);
  const firefox = buildTarget('firefox', out);

  const builtChromium = JSON.parse(readFileSync(join(chromium.dir, 'manifest.json'), 'utf8'));
  assert.deepStrictEqual(builtChromium, source, 'the Chromium manifest is the source manifest');

  const ff = JSON.parse(readFileSync(join(firefox.dir, 'manifest.json'), 'utf8'));
  assert.deepStrictEqual(ff.background, { scripts: [...helpers, 'background.js'] });
  assert.ok(helpers.includes('save-common.js') && helpers.includes('i18n.js'), `helpers read: ${helpers}`);
  assert.strictEqual(ff.host_permissions, undefined, 'Firefox gets no install-time host permissions');
  assert.deepStrictEqual(ff.optional_host_permissions, source.host_permissions);
  assert.strictEqual(ff.browser_specific_settings.gecko.id, GECKO_ID);
  assert.strictEqual(ff.browser_specific_settings.gecko.strict_min_version, GECKO_MIN_VERSION);
  assert.deepStrictEqual(ff.browser_specific_settings.gecko.data_collection_permissions.required, ['browsingActivity']);
  assert.deepStrictEqual(ff.commands, source.commands, 'both shortcuts carry over');

  for (const target of [chromium, firefox]) {
    assert.ok(existsSync(target.zip), `${target.zip} written`);
    assert.ok(!existsSync(join(target.dir, 'README.md')), 'README stays out of the package');
    const listing = execFileSync('unzip', ['-Z1', target.zip], { encoding: 'utf8' }).split('\n');
    assert.ok(listing.includes('manifest.json'), 'manifest.json at the root of the zip');
  }

  console.log('extension build: ok');
} finally {
  rmSync(out, { recursive: true, force: true });
}
