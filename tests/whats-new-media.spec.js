// @ts-check
/*
 * The pictures and recordings in the What's new window, taken through the
 * real UI.
 *
 * Run on purpose only, for one release, against a copy of the demo data:
 *
 *   WHATS_NEW_MEDIA=v1.20.0 NEXTDASH_DATA_DIR=<copy of data-demo> PW_WORKERS=8 \
 *     npx playwright test tests/whats-new-media.spec.js
 *
 * What to take is in tests/fixtures/whats-new-media/<tag>.js, one entry per
 * highlight (the release checklist writes it after asking what each one
 * should show). The files land in static/data/whats-new/media/ as
 * <tag>-<slug>.jpg, and for a recording <tag>-<slug>.webm beside it; the jpg
 * is then the poster, and what a reader who turned motion down sees.
 *
 * A plan entry:
 *
 *   {
 *     slug: 'digest',                 // file name part, [a-z0-9-]
 *     kind: 'image' | 'video',
 *     alt: 'The weekly digest window', // goes into the release JSON
 *     viewport: { width, height },    // optional, default 1280 x 800
 *     dataPatch: '',                  // optional, see tidyDemoData in the kit
 *     setup: async (page, kit) => {}, // get to the starting point
 *     act: async (page, kit) => {},   // video only: the part that is recorded
 *     target: (page) => locator,      // optional: crop to this element
 *   }
 *
 * The recording runs from the moment setup is done to the end of act, so
 * loading the page is not in it. ffmpeg (Homebrew) cuts and encodes it.
 */
const { execFileSync } = require('child_process');
const {
    test, fs, os, path, prepare, settle, openDashboard, boxAround, DEMO_THEME,
} = require('./helpers/manual-shot-kit');

const TAG = process.env.WHATS_NEW_MEDIA || '';
const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'static', 'data', 'whats-new', 'media');
const PLAN = path.join(__dirname, 'fixtures', 'whats-new-media', `${TAG}.js`);
const VIEWPORT = { width: 1280, height: 800 };

test.skip(!TAG, 'What\'s new media are taken on purpose only (WHATS_NEW_MEDIA=<tag>)');
test.describe.configure({ mode: 'parallel' });
test.setTimeout(120_000);

/** @type {{ slug: string, kind: string, alt?: string, viewport?: any, dataPatch?: string, setup?: Function, act?: Function, target?: Function }[]} */
const shots = TAG && fs.existsSync(PLAN) ? require(PLAN).shots || [] : [];

if (TAG && !shots.length) {
    test('a plan exists for the release', () => {
        throw new Error(`no shots in ${path.relative(ROOT, PLAN)}`);
    });
}

const kit = { prepare, settle, openDashboard, DEMO_THEME };

/** The crop as whole pixels inside the viewport, or the whole viewport. */
async function clipFor(page, shot, viewport) {
    if (!shot.target) return null;
    const box = await boxAround([shot.target(page)]);
    if (!box) throw new Error(`${shot.slug}: nothing to crop`);
    const pad = 16;
    const x = Math.max(0, Math.floor(box.x - pad));
    const y = Math.max(0, Math.floor(box.y - pad));
    // Even sizes: the video encoder needs them.
    const even = (n) => n - (n % 2);
    return {
        x, y,
        width: even(Math.min(viewport.width - x, Math.ceil(box.width + pad * 2))),
        height: even(Math.min(viewport.height - y, Math.ceil(box.height + pad * 2))),
    };
}

async function still(page, file, clip) {
    const view = page.viewportSize() || VIEWPORT;
    await page.mouse.move(5, view.height - 5);
    await page.evaluate(() => /** @type {HTMLElement|null} */ (document.activeElement)?.blur?.());
    // Pacing for the capture, not a condition: a transition gets time to finish before the frame is taken.
    await page.waitForTimeout(300);
    await page.screenshot({ path: file, type: 'jpeg', quality: 85, ...(clip ? { clip } : {}) });
}

for (const shot of shots) {
    if (!/^[a-z0-9-]+$/.test(shot.slug || '')) throw new Error(`bad slug: ${shot.slug}`);
    test.describe(shot.slug, () => {
        if (shot.dataPatch) test.use({ dataPatch: shot.dataPatch });

        test(`${shot.kind} ${shot.slug}`, async ({ browser, server }) => {
            const viewport = shot.viewport || VIEWPORT;
            const base = `${TAG}-${shot.slug}`;
            fs.mkdirSync(OUT, { recursive: true });
            const raw = fs.mkdtempSync(path.join(os.tmpdir(), 'nextdash-wn-media-'));
            const video = shot.kind === 'video';
            const context = await browser.newContext({
                baseURL: server.baseURL,
                viewport,
                // A recording is of something moving; a still is taken as the
                // manual's are, with motion off so nothing is caught halfway.
                reducedMotion: video ? 'no-preference' : 'reduce',
                ...(video ? { recordVideo: { dir: raw, size: viewport } } : {}),
            });
            const started = Date.now();
            try {
                const page = await context.newPage();
                await prepare(page);
                if (shot.setup) await shot.setup(page, kit);
                else await openDashboard(page);
                if (!video) {
                    await still(page, path.join(OUT, `${base}.jpg`), await clipFor(page, shot, viewport));
                    return;
                }
                const from = (Date.now() - started) / 1000;
                if (shot.act) await shot.act(page, kit);
                // Pacing for the capture, not a condition: a transition gets time to finish before the frame is taken.
                await page.waitForTimeout(800);
                const to = (Date.now() - started) / 1000;
                // Measured at the end, where the element act was heading for
                // is on screen; the whole recording is cut to that frame.
                const clip = await clipFor(page, shot, viewport);
                // The last frame is the poster.
                await still(page, path.join(OUT, `${base}.jpg`), clip);
                const recording = page.video();
                await context.close();
                const source = await recording?.path();
                if (!source) throw new Error('no recording was made');
                const filters = [clip ? `crop=${clip.width}:${clip.height}:${clip.x}:${clip.y}` : '', 'scale=\'min(1280,iw)\':-2']
                    .filter(Boolean).join(',');
                execFileSync('ffmpeg', [
                    '-y', '-loglevel', 'error',
                    '-ss', from.toFixed(2), '-to', to.toFixed(2), '-i', source,
                    '-vf', filters, '-an',
                    '-c:v', 'libvpx-vp9', '-b:v', '0', '-crf', '38', '-row-mt', '1',
                    path.join(OUT, `${base}.webm`),
                ]);
            } finally {
                await context.close().catch(() => {});
                fs.rmSync(raw, { recursive: true, force: true });
            }
        });
    });
}
