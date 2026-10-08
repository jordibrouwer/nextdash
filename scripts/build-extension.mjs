#!/usr/bin/env node
// Build the browser extension for Chromium and Firefox from the one source
// tree in extension/.
//
//   node scripts/build-extension.mjs [chromium|firefox|all] [--out DIR]
//
// extension/manifest.json stays the Chromium manifest, so extension/ can
// still be loaded unpacked as it is. The Firefox manifest is derived from it
// here. Each browser gets an unpacked folder and a zip under the output
// directory (dist/extension by default, not checked in). This script lives in
// scripts/ and never reaches main: users get the Firefox build signed from
// addons.mozilla.org, so only a release needs it.

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'extension');

// Fixed once the add-on is first signed on addons.mozilla.org: Firefox keys
// storage, updates and the listing on it.
export const GECKO_ID = 'bookmark-saver@nextdash.cc';
// 140 is the ESR that knows data_collection_permissions.
export const GECKO_MIN_VERSION = '140.0';
export const GECKO_ANDROID_MIN_VERSION = '142.0';

// Files in extension/ that are not part of the extension itself.
const SKIP = new Set(['README.md', 'manifest.json', '.DS_Store']);

/**
 * The helpers background.js loads with importScripts, in order. Firefox has
 * no importScripts in a background script, so its manifest lists them; read
 * from the call itself so the two lists cannot drift.
 */
export function backgroundHelperScripts(backgroundSource) {
  const call = backgroundSource.match(/importScripts\(([\s\S]*?)\)/);
  if (!call) throw new Error('background.js: no importScripts(...) call to read the helper list from');
  const files = [...call[1].matchAll(/['"]([^'"]+)['"]/g)].map((m) => m[1]);
  if (!files.length) throw new Error('background.js: importScripts(...) names no files');
  return files;
}

export function firefoxManifest(chromiumManifest, helperScripts) {
  const manifest = structuredClone(chromiumManifest);
  manifest.background = { scripts: [...helperScripts, 'background.js'] };
  // Firefox MV3 treats host permissions as opt-in. Listing them as optional
  // keeps the install prompt quiet; the popup asks for the server's origin
  // when the settings are saved (requestServerAccess in save-common.js).
  if (manifest.host_permissions) {
    manifest.optional_host_permissions = manifest.host_permissions;
    delete manifest.host_permissions;
  }
  manifest.browser_specific_settings = {
    gecko: {
      id: GECKO_ID,
      strict_min_version: GECKO_MIN_VERSION,
      // The URL and title of what you save go to the nextDash server you set.
      // Mozilla counts any transfer out of the browser, also to your own server.
      data_collection_permissions: { required: ['browsingActivity'] },
    },
    // Android learned data_collection_permissions in 142. Whether the add-on
    // is offered there at all is chosen on addons.mozilla.org.
    gecko_android: { strict_min_version: GECKO_ANDROID_MIN_VERSION },
  };
  return manifest;
}

function copyTree(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    if (SKIP.has(entry.name)) continue;
    const src = path.join(from, entry.name);
    const dest = path.join(to, entry.name);
    if (entry.isDirectory()) copyTree(src, dest);
    else fs.copyFileSync(src, dest);
  }
}

export function buildTarget(target, outDir) {
  const chromium = JSON.parse(fs.readFileSync(path.join(SRC, 'manifest.json'), 'utf8'));
  const manifest = target === 'firefox'
    ? firefoxManifest(chromium, backgroundHelperScripts(fs.readFileSync(path.join(SRC, 'background.js'), 'utf8')))
    : chromium;

  const dir = path.join(outDir, target);
  fs.rmSync(dir, { recursive: true, force: true });
  copyTree(SRC, dir);
  fs.writeFileSync(path.join(dir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);

  for (const file of manifest.background.scripts || [manifest.background.service_worker]) {
    if (!fs.existsSync(path.join(dir, file))) throw new Error(`${target}: background file ${file} is missing`);
  }

  const zip = path.join(outDir, `nextdash-${target}-${manifest.version}.zip`);
  fs.rmSync(zip, { force: true });
  // Files at the root of the archive, as both stores expect.
  execFileSync('zip', ['-r', '-X', '-q', zip, '.'], { cwd: dir });
  return { dir, zip };
}

function main(argv) {
  let target = 'all';
  let outDir = path.join(ROOT, 'dist', 'extension');
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--out') outDir = path.resolve(argv[++i]);
    else target = argv[i];
  }
  const targets = target === 'all' ? ['chromium', 'firefox'] : [target];
  for (const t of targets) {
    if (t !== 'chromium' && t !== 'firefox') {
      console.error(`unknown target "${t}" (chromium, firefox or all)`);
      process.exit(2);
    }
  }

  // The bookmark-form copy must match static/ before it ships.
  execFileSync('sh', [path.join(ROOT, 'scripts', 'check-extension-bookmark-form.sh')], { stdio: 'inherit' });

  for (const t of targets) {
    const { dir, zip } = buildTarget(t, outDir);
    console.log(`${t}: ${path.relative(ROOT, dir)}/ and ${path.relative(ROOT, zip)}`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2));
}
