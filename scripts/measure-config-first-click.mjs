#!/usr/bin/env node
/*
 * First click on Config, measured: bytes fetched, script compile/run time and
 * time to render, cold (no HTTP cache), as the median of N runs.
 *
 *   NEXTDASH_DATA_DIR=$(mktemp -d) PORT=8099 go run .      # in another shell
 *   node scripts/measure-config-first-click.mjs [--runs 7] [--mode hover|direct] [--out file.json]
 *
 * "hover" rests the pointer on the Config link first (the prewarm), then clicks:
 * the way a reader goes. "direct" clicks with no head start.
 * Chromium only (tracing). Never point it at port 8080.
 */
import { createRequire } from 'node:module';
import fs from 'node:fs';

const require = createRequire(import.meta.url);
const { chromium } = require('@playwright/test');
const { markWhatsNewSeen, dismissBlockingOverlays, dismissOnboardingIfPresent } = require('../tests/e2e-helpers');

const arg = (name, fallback) => {
    const i = process.argv.indexOf(`--${name}`);
    return i > -1 ? process.argv[i + 1] : fallback;
};
const RUNS = Number(arg('runs', 7));
const MODE = arg('mode', 'hover');
const OUT = arg('out', '');
const BASE = process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:8099';
if (/:8080(\/|$)/.test(BASE)) throw new Error('port 8080 is not for tests');

const median = (xs) => {
    const s = [...xs].sort((a, b) => a - b);
    return s.length ? s[Math.floor(s.length / 2)] : 0;
};

async function once(browser) {
    const context = await browser.newContext();
    const page = await context.newPage();
    const cdp = await context.newCDPSession(page);
    await cdp.send('Network.enable');
    await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });

    await markWhatsNewSeen(page);
    await page.goto(BASE + '/');
    await page.waitForSelector('#dashboard-layout', { timeout: 20_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 20_000 });
    // Settle: late dashboard work is not the click's.
    await page.waitForTimeout(1500);

    await browser.startTracing(page, {
        categories: ['devtools.timeline', 'v8', 'disabled-by-default-v8.compile'],
    });
    // The resource timing buffer holds 250 entries and then drops the rest: a
    // dashboard with many icons can fill it before the click and read as zero
    // files. Empty it and make room, so only what the click fetches is in it.
    await page.evaluate(() => {
        performance.clearResourceTimings();
        performance.setResourceTimingBufferSize(2000);
    });
    const mark = await page.evaluate(() => performance.now());
    const link = page.locator('.config-link-anchor').first();
    if (MODE === 'hover') {
        await link.hover();
        await page.waitForTimeout(50);
    }
    const t0 = await page.evaluate(() => performance.now());
    await link.click();
    await page.waitForSelector('.config-view-body', { timeout: 20_000 });
    const tBody = await page.evaluate(() => performance.now());
    await page.waitForSelector('.config-overview-panels', { timeout: 20_000 }).catch(() => {});
    const tPanels = await page.evaluate(() => performance.now());
    // Trailing fetches (prewarm of other sections) still count against the click.
    await page.waitForTimeout(1500);
    const traceBuf = await browser.stopTracing();

    const resources = await page.evaluate((from) => performance.getEntriesByType('resource')
        .filter((r) => r.startTime >= from && /\/static\/.*\.js(\?|$)/.test(r.name))
        .map((r) => ({
            url: r.name.replace(/^.*\/static\//, '').replace(/\?.*$/, ''),
            transfer: r.transferSize,
            decoded: r.decodedBodySize,
        })), mark);

    let compileMs = 0;
    let evalMs = 0;
    try {
        const events = JSON.parse(traceBuf.toString()).traceEvents || [];
        for (const e of events) {
            if (e.ph !== 'X') continue;
            if (e.name === 'v8.compile' || e.name === 'v8.parseOnBackground') compileMs += (e.dur || 0) / 1000;
            if (e.name === 'EvaluateScript') evalMs += (e.dur || 0) / 1000;
        }
    } catch { /* the trace is a bonus; bytes and render time stand alone */ }

    await context.close();
    return {
        files: resources.length,
        transferKB: resources.reduce((n, r) => n + (r.transfer || 0), 0) / 1024,
        decodedKB: resources.reduce((n, r) => n + (r.decoded || 0), 0) / 1024,
        bookmarkFiles: resources.filter((r) => /bookmark/.test(r.url)).length,
        compileMs,
        evalMs,
        clickToBodyMs: tBody - t0,
        clickToPanelsMs: tPanels - t0,
        urls: resources.map((r) => r.url),
    };
}

const browser = await chromium.launch();
const runs = [];
for (let i = 0; i < RUNS; i += 1) runs.push(await once(browser));
await browser.close();

const keys = ['files', 'bookmarkFiles', 'transferKB', 'decodedKB', 'compileMs', 'evalMs', 'clickToBodyMs', 'clickToPanelsMs'];
const summary = { mode: MODE, runs: RUNS, median: {} };
for (const k of keys) summary.median[k] = Math.round(median(runs.map((r) => r[k])) * 10) / 10;
summary.urls = runs[0].urls;
console.log(JSON.stringify(summary, null, 2));
if (OUT) fs.writeFileSync(OUT, JSON.stringify({ summary, runs }, null, 2));
