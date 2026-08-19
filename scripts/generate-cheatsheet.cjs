#!/usr/bin/env node
/**
 * Regenerate nextDash-cheatsheet.html and nextDash-cheatsheet.pdf from
 * locales/en.json and static/js/shared/keyboard-cheat-sheet-registry.js.
 *
 * The sheet carries every key the registry has, over as many A4 pages as that
 * takes. It was a curated one-pager, which made the paper a smaller product than
 * the app — a key added to the modal was simply not on it. Short `printFallback`
 * wording is still preferred where a row has it: a printed row that reads in one
 * line is the point, not a page count.
 *
 * Usage: node scripts/generate-cheatsheet.cjs
 * Requires: playwright (devDependency)
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const en = JSON.parse(fs.readFileSync(path.join(root, 'locales/en.json'), 'utf8'));
const cs = en.dashboard.cheatsheet;

// The registry is the same file the dashboard modal builds from, so the sheet
// cannot list a key the app no longer has. It reads KeyboardViewLegends for the
// health/inbox/triage rows, so both load into one context.
const sandbox = { window: {} };
sandbox.global = sandbox;
for (const file of [
    'static/js/shared/keyboard-view-legends.js',
    'static/js/shared/keyboard-cheat-sheet-registry.js',
]) {
    vm.runInNewContext(fs.readFileSync(path.join(root, file), 'utf8'), sandbox);
}
const registry = sandbox.window.KeyboardCheatSheetRegistry;

function esc(text) {
    return String(text ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function cheatLabel(key, fallback) {
    const value = cs[key];
    return value && value !== key ? value : fallback;
}

function formatKeysHtml(keys) {
    // Split alternatives on a spaced slash only. A bare "/" is a key in its own
    // right (the tag cloud), and "//" is the category drag handle — splitting on
    // any slash turned both into empty chips.
    const parts = String(keys).split(/\s+\/\s+/).filter((part) => part.trim());
    return parts.map((part, i) => {
        const sep = i > 0 ? '<span class="kbd-sep">/</span>' : '';
        // Split on + only where both sides are a key. The add-bookmark shortcut
        // *is* "+", and splitting it produced two empty chips with a plus
        // between them — a row that read as "— ' —" on the printed sheet.
        const bits = part.trim().split(/\s*\+\s*/).filter(Boolean);
        const chips = (bits.length ? bits : [part.trim()])
            .map((bit) => `<kbd>${esc(bit)}</kbd>`)
            .join('<span class="kbd-plus">+</span>');
        return sep + chips;
    }).join('');
}

/**
 * The printed wording: the action, not the essay.
 *
 * A row without its own `printFallback` prints the modal's sentence, which is
 * written to be read once and often runs to twenty-five words. In a narrow
 * column that is three lines for one key, and it is what pushed the sheet from
 * three pages to five. The head of the sentence is the action — everything
 * after the first dash or full stop is the reasoning, which the modal and the
 * manual both still carry.
 */
function printableDescription(text) {
    let out = String(text).trim();
    // Everything after an em dash, a semicolon or the first sentence is
    // explanation. Keep the head only when it can stand on its own.
    for (const cut of [' — ', '; ', '. ']) {
        const at = out.indexOf(cut);
        // A head shorter than this is not the action, it is half of it —
        // "Open the category menu" qualifies, "Move" would not.
        if (at >= 12) out = out.slice(0, at);
    }
    // A trailing parenthetical is a caveat, not the action — dropping it whole
    // reads better than the length cap slicing it in half.
    out = out.replace(/\s*\([^)]*\)\s*$/, (match, offset) => (offset >= 20 ? '' : match));
    out = out.replace(/[.,;:]$/, '');
    // A head that is still long gets trimmed on a word boundary rather than
    // wrapping to a third line.
    const LIMIT = 56;
    if (out.length > LIMIT) {
        const clipped = out.slice(0, LIMIT);
        const space = clipped.lastIndexOf(' ');
        out = `${clipped.slice(0, space > 28 ? space : LIMIT)}…`;
    }
    return out;
}

function renderSection({ title, items }) {
    const body = items.map(({ keys, description }) => {
        const isCommand = String(keys).trim().startsWith(':');
        return `
        <tr><td class="keys${isCommand ? ' keys-command' : ''}">${formatKeysHtml(keys)}</td><td class="desc">${esc(printableDescription(description))}</td></tr>
    `;
    }).join('');
    return `<section class="cheat-group"><h2>${esc(title)}</h2><table>${body}</table></section>`;
}

const sections = registry.buildPrintSections(cheatLabel).map(renderSection);

const logoSource = path.join(root, 'logo-ascii-on-black-large.png');
const logoTransparent = path.join(root, 'logo-ascii-transparent.png');

function ensureTransparentLogo() {
    try {
        const needsRefresh = !fs.existsSync(logoTransparent)
            || fs.statSync(logoSource).mtimeMs > fs.statSync(logoTransparent).mtimeMs;
        if (!needsRefresh) return logoTransparent;
        const { spawnSync } = require('child_process');
        const py = spawnSync('python3', ['-c', `
from PIL import Image
img = Image.open(${JSON.stringify(logoSource)}).convert('RGBA')
px = img.load()
for y in range(img.size[1]):
    for x in range(img.size[0]):
        r, g, b, a = px[x, y]
        if r < 40 and g < 40 and b < 40:
            px[x, y] = (0, 0, 0, 0)
img.save(${JSON.stringify(logoTransparent)})
`], { encoding: 'utf8' });
        if (py.status === 0 && fs.existsSync(logoTransparent)) {
            return logoTransparent;
        }
    } catch {
        // fall back to opaque logo
    }
    return logoSource;
}

const logoPath = ensureTransparentLogo().replace(/\\/g, '/');
const fontLatin = path.join(root, 'static/fonts/source-code-pro-latin.woff2').replace(/\\/g, '/');
const generated = new Date().toISOString().slice(0, 10);

const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>nextDash — keyboard shortcuts</title>
<style>
  @font-face {
    font-family: 'Source Code Pro';
    font-style: normal;
    font-weight: 400 700;
    src: url('file://${fontLatin}') format('woff2');
  }

  *, *::before, *::after { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }

  :root {
    --bg: #0a0a0a;
    --bg-card: #141414;
    --bg-dots: #1c2418;
    --text: #e4e8e0;
    --text-muted: #8a9688;
    --text-section: #6b8060;
    --accent: #39ff14;
    --accent-soft: rgba(57, 255, 20, 0.14);
    --border: #2a3528;
    --radius: 10px;
  }

  html, body {
    margin: 0;
    padding: 0;
    background: var(--bg);
    color: var(--text);
    font-family: "Source Code Pro", ui-monospace, monospace;
    font-size: 8pt;
    line-height: 1.3;
  }

  body::before {
    content: "";
    position: fixed;
    inset: 0;
    z-index: -1;
    background-image: radial-gradient(var(--bg-dots) 0.65px, transparent 0.65px);
    background-size: 14px 14px;
    opacity: 0.55;
  }

  .page {
    max-width: 48rem;
    margin: 0 auto;
    padding: 1.1cm 1.25cm 1.4cm;
  }

  .brand {
    text-align: center;
    margin: 0 0 0.8rem;
    padding-bottom: 0.6rem;
    border-bottom: 1px solid var(--border);
  }

  .brand img {
    display: block;
    width: min(17rem, 70vw);
    height: auto;
    margin: 0 auto 0.55rem;
    filter: drop-shadow(0 0 22px rgba(57, 255, 20, 0.28));
  }

  .brand-tag {
    margin: 0;
    font-size: 0.62rem;
    font-weight: 700;
    letter-spacing: 0.22em;
    text-transform: uppercase;
    color: var(--accent);
    opacity: 0.92;
  }

  .sheet {
    background: color-mix(in srgb, var(--bg-card) 92%, #000 8%);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 0.85rem 0.95rem 0.6rem;
    box-shadow: 0 12px 40px rgba(0, 0, 0, 0.45), inset 0 1px 0 rgba(57, 255, 20, 0.06);
    /* Two columns: half the line length, twice the rows per page, and a
       shortcut line is short enough that nothing has to wrap for it. */
    column-count: 2;
    column-gap: 1.1rem;
    column-rule: 1px solid color-mix(in srgb, var(--border) 70%, transparent);
  }

  .lead {
    margin: 0 0 0.7rem;
    color: var(--text-muted);
    font-size: 0.86rem;
    line-height: 1.45;
    /* Across both columns: it is one sentence about the sheet, not a section. */
    column-span: all;
  }

  .lead strong, .lead code {
    color: var(--text);
    font-weight: 700;
  }

  .lead code {
    padding: 0.05em 0.3em;
    border-radius: 0.25em;
    background: var(--accent-soft);
    color: var(--accent);
    font-size: 0.95em;
  }

  .cheat-group {
    margin: 0;
    padding: 0.5rem 0 0.3rem;
    border-top: 1px solid var(--border);
    /* A section may flow across a column or a page — with 32 rows under
       Bookmarks it has to — but never so that its heading is stranded at the
       foot of one, and never with a row split down the middle. */
    break-inside: auto;
  }

  h2 {
    break-after: avoid;
  }

  tr {
    break-inside: avoid;
  }

  .cheat-group:first-of-type {
    border-top: none;
    padding-top: 0;
  }

  h2 {
    margin: 0 0 0.35rem;
    font-size: 1.05rem;
    font-weight: 700;
    letter-spacing: 0.04em;
    text-transform: lowercase;
    color: var(--accent);
    line-height: 1.2;
  }

  table {
    width: 100%;
    border-collapse: collapse;
    table-layout: fixed;
    margin: 0;
  }

  td {
    vertical-align: top;
    padding: 0.1rem 0;
    border-bottom: 1px solid color-mix(in srgb, var(--border) 55%, transparent);
    line-height: 1.28;
  }

  tr:last-child td { border-bottom: none; }

  td.keys {
    width: 36%;
    padding-right: 0.45rem;
    white-space: normal;
    overflow-wrap: anywhere;
  }

  td.desc {
    width: 64%;
    color: var(--text-muted);
    font-size: 0.9rem;
  }

  /* Chips wrap rather than overflow.
     Not every "key" here is a chord: the sheet also carries Right-click
     bookmark, Long-press category (~500 ms), Drag // in category title and the
     palette's :buttonbar bottom. With nowrap those ran straight out of the key
     column and printed on top of the description beside them. A chord is
     unaffected — Ctrl + C is two chips of one token each, and neither has
     anywhere to break. (No backticks in this comment: the stylesheet lives
     inside a template literal.) */
  kbd {
    display: inline-block;
    white-space: normal;
    overflow-wrap: anywhere;
    padding: 0.03em 0.28em;
    border: 1px solid color-mix(in srgb, var(--accent) 35%, var(--border));
    border-radius: 0.28em;
    background: color-mix(in srgb, var(--accent-soft) 80%, #111 20%);
    color: var(--accent);
    font-family: inherit;
    font-size: 0.78rem;
    font-weight: 700;
    line-height: 1.25;
  }

  .kbd-sep, .kbd-plus {
    margin: 0 0.18em;
    color: var(--text-section);
    font-size: 0.72rem;
    font-weight: 400;
  }

  .footer {
    margin: 0.85rem 0 0;
    text-align: center;
    font-size: 0.68rem;
    color: var(--text-section);
    letter-spacing: 0.04em;
  }

  .footer a {
    color: var(--accent);
    text-decoration: none;
  }

  @media print {
    .page { padding: 0.75cm 1cm 1cm; }
    .sheet { box-shadow: none; }
  }
</style>
</head>
<body>
<div class="page">
  <header class="brand">
    <img src="file://${logoPath}" alt="nextDash">
    <p class="brand-tag">keyboard shortcuts</p>
  </header>
  <div class="sheet">
    <p class="lead">Press <strong>!</strong> or <strong>F1</strong> on the dashboard for the searchable live list (also <strong>Config → Help → Keyboard</strong>). <code>:cheat</code> and <code>:help</code> open the same modal. This printable sheet is generated from the same source.</p>
${sections.join('\n')}
  </div>
  <p class="footer">nextdash.cc · generated ${generated} · <code>npm run generate:cheatsheet</code></p>
</div>
</body>
</html>`;

const htmlPath = path.join(root, 'nextDash-cheatsheet.html');
const pdfPath = path.join(root, 'nextDash-cheatsheet.pdf');
// The repo-root copies are the artifacts people download from the project page.
// A second copy lands in static/ because only static/, templates/ and locales/
// are embedded in the binary — without it the in-app link would 404.
const staticPdfPath = path.join(root, 'static', 'nextDash-cheatsheet.pdf');
fs.writeFileSync(htmlPath, html, 'utf8');
console.log('Wrote', htmlPath);

function resolveChromiumExecutable() {
    const candidates = [
        process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
        process.platform === 'darwin'
            ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
            : null,
        process.platform === 'linux' ? '/usr/bin/google-chrome' : null,
        process.platform === 'win32'
            ? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
            : null,
    ].filter(Boolean);
    for (const candidate of candidates) {
        try {
            if (fs.existsSync(candidate)) return candidate;
        } catch {
            // ignore
        }
    }
    return null;
}

function printPdfWithChromeCli(executablePath, htmlPath, pdfPath) {
    const { spawnSync } = require('child_process');
    const result = spawnSync(executablePath, [
        '--headless=new',
        '--disable-gpu',
        '--no-pdf-header-footer',
        '--print-background',
        `--print-to-pdf=${pdfPath}`,
        `file://${htmlPath}`,
    ], { encoding: 'utf8', timeout: 60000 });
    if (result.error) throw result.error;
    if (result.status !== 0) {
        throw new Error(result.stderr?.trim() || 'Chrome CLI print failed');
    }
    if (!fs.existsSync(pdfPath)) {
        throw new Error('Chrome CLI did not write PDF');
    }
}

/** Mirror the finished PDF into static/ so the running app can serve it. */
function copyPdfToStatic() {
    fs.mkdirSync(path.dirname(staticPdfPath), { recursive: true });
    fs.copyFileSync(pdfPath, staticPdfPath);
    console.log('Wrote', staticPdfPath);
}

(async () => {
    const executablePath = resolveChromiumExecutable();
    if (executablePath) {
        try {
            printPdfWithChromeCli(executablePath, htmlPath, pdfPath);
            console.log('Wrote', pdfPath);
            copyPdfToStatic();
            return;
        } catch (cliErr) {
            console.warn('Chrome CLI PDF failed, trying Playwright:', cliErr.message);
        }
    }
    const { chromium } = require('playwright');
    const browser = await chromium.launch(executablePath ? { executablePath } : {});
    const page = await browser.newPage();
    await page.goto(`file://${htmlPath}`, { waitUntil: 'load' });
    await page.pdf({
        path: pdfPath,
        format: 'A4',
        printBackground: true,
        margin: { top: '12mm', bottom: '12mm', left: '12mm', right: '12mm' },
    });
    await browser.close();
    console.log('Wrote', pdfPath);
    copyPdfToStatic();
})().catch((err) => {
    console.error('PDF generation failed (HTML was still written):', err.message);
    process.exitCode = 1;
});
