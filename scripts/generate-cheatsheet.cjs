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

/*
 * The wordmark as text rather than the PNG. The PNG is neon green on black —
 * right for the app, wrong on paper, where it printed as a pale smudge. As text
 * it is vector-sharp at any size and takes whatever ink the sheet uses.
 * String.raw keeps the backslashes; the one backtick is spliced in.
 */
const logoAscii = String.raw`                 _   ____            _
 _ __   _____  _| |_|  _ \  __ _ ___| |__
| '_ \ / _ \ \/ / __| | | |/ _${'`'} / __| '_ \
| | | |  __/>  <| |_| |_| | (_| \__ \ | | |
|_| |_|\___/_/\_\\__|____/ \__,_|___/_| |_|`;

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

  /* Made to be printed. White paper, black ink, and only two fills — the
     light grey of a section band and of every other row — both pale enough to
     cost a printer next to nothing and still read on a black-and-white one.
     print-color-adjust keeps those fills: without it Chrome drops backgrounds
     and the zebra that guides the eye across a row goes with them. */
  *, *::before, *::after { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }

  @page { size: A4; margin: 11mm 12mm 12mm; }

  :root {
    --ink: #111;
    --ink-soft: #222;
    --ink-muted: #555;
    --ink-faint: #888;
    --band: #e6e6e6;
    --zebra: #f4f4f4;
    --rule: #999;
    --mono: "Source Code Pro", ui-monospace, monospace;
    --sans: -apple-system, "Helvetica Neue", Helvetica, Arial, sans-serif;
  }

  html, body {
    margin: 0;
    padding: 0;
    background: #fff;
    color: var(--ink);
    font-family: var(--mono);
    font-size: 7.6pt;
    line-height: 1.3;
  }

  .brand {
    text-align: center;
    margin: 0 0 3mm;
  }

  .logo {
    display: inline-block;
    margin: 0;
    text-align: left;
    font: 700 7.4pt/1.12 var(--mono);
    white-space: pre;
    color: var(--ink);
  }

  .brand-tag {
    margin: 1.5mm 0 0;
    font-size: 7pt;
    font-weight: 700;
    letter-spacing: 0.25em;
    text-transform: uppercase;
    color: var(--ink-muted);
  }

  .lead {
    margin: 0 0 3.5mm;
    padding: 2mm 3mm;
    border: 0.6pt solid var(--rule);
    border-radius: 1.5mm;
    color: var(--ink-soft);
    font-size: 7.2pt;
    line-height: 1.45;
  }

  .lead strong, .lead code {
    color: var(--ink);
    font-family: var(--mono);
    font-weight: 700;
  }

  /* Two columns: half the line length, twice the rows per page, and a
     shortcut line is short enough that nothing has to wrap for it. */
  .sheet {
    column-count: 2;
    column-gap: 6mm;
  }

  .cheat-group {
    margin: 0 0 3mm;
    /* A section may flow across a column or a page — with 32 rows under
       Bookmarks it has to — but never so that its heading is stranded at the
       foot of one, and never with a row split down the middle. */
    break-inside: auto;
  }

  h2 {
    margin: 0 0 1mm;
    padding: 1mm 2mm;
    background: var(--band);
    border-left: 2.5pt solid var(--ink);
    font-size: 8pt;
    font-weight: 700;
    letter-spacing: 0.04em;
    text-transform: lowercase;
    line-height: 1.2;
    break-after: avoid;
  }

  table {
    width: 100%;
    border-collapse: collapse;
    table-layout: fixed;
    margin: 0;
  }

  tr { break-inside: avoid; }

  tr:nth-child(even) td { background: var(--zebra); }

  td {
    vertical-align: top;
    padding: 0.6mm 1.5mm;
    line-height: 1.3;
  }

  td.keys {
    width: 38%;
    overflow-wrap: anywhere;
  }

  /* The description in a sans: next to a column of monospace keys it tells
     key from meaning at a glance, and it sets tighter, so fewer rows wrap. */
  td.desc {
    width: 62%;
    color: var(--ink-soft);
    font-family: var(--sans);
    font-size: 7.6pt;
  }

  /* Keys bold, without a chip. A chip is a box of ink around every key, and on
     paper the weight alone reads as a key. overflow-wrap still lets the long
     ones — Right-click bookmark, Long-press category (~500 ms), Drag // in
     category title — wrap inside their column instead of running into the
     description. (No backticks in this comment: the stylesheet lives inside a
     template literal.) */
  kbd {
    font-family: var(--mono);
    font-size: 7.2pt;
    font-weight: 700;
    color: var(--ink);
    overflow-wrap: anywhere;
  }

  .keys-command kbd { font-weight: 600; }

  .kbd-sep, .kbd-plus {
    margin: 0 0.8mm;
    color: var(--ink-faint);
    font-weight: 400;
  }

  .footer {
    margin: 3mm 0 0;
    padding-top: 1.5mm;
    border-top: 0.6pt solid var(--rule);
    text-align: center;
    font-size: 6.6pt;
    color: var(--ink-muted);
    letter-spacing: 0.04em;
  }
</style>
</head>
<body>
  <header class="brand">
    <pre class="logo" aria-label="nextDash">${esc(logoAscii)}</pre>
    <p class="brand-tag">keyboard shortcuts</p>
  </header>
  <p class="lead">Press <strong>!</strong> or <strong>F1</strong> on the dashboard for the searchable live list (also <strong>Config → Help → Keyboard</strong>). <code>:cheat</code> and <code>:help</code> open the same modal. This printable sheet is generated from the same source.</p>
  <main class="sheet">
${sections.join('\n')}
  </main>
  <p class="footer">nextdash.cc · generated ${generated} · <code>npm run generate:cheatsheet</code></p>
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
        preferCSSPageSize: true,
    });
    await browser.close();
    console.log('Wrote', pdfPath);
    copyPdfToStatic();
})().catch((err) => {
    console.error('PDF generation failed (HTML was still written):', err.message);
    process.exitCode = 1;
});
