#!/usr/bin/env node
/**
 * Regenerate nextDash-cheatsheet.html and nextDash-cheatsheet.pdf from
 * locales/en.json and static/js/shared/keyboard-cheat-sheet-registry.js.
 *
 * This sheet is a deliberate subset, not the whole modal: it is A4 and meant to
 * be read at a glance, so it carries only rows the registry marks `print: true`
 * and prefers their short `printFallback` wording. Widening it to every row
 * would spill onto a second page and defeat the point.
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
    const parts = String(keys).split(/\s*\/\s*/);
    return parts.map((part, i) => {
        const sep = i > 0 ? '<span class="kbd-sep">/</span>' : '';
        const chips = part.trim().split(/\s*\+\s*/).map((bit) =>
            `<kbd>${esc(bit.trim())}</kbd>`,
        ).join('<span class="kbd-plus">+</span>');
        return sep + chips;
    }).join('');
}

function renderSection({ title, items }) {
    const body = items.map(({ keys, description }) => `
        <tr><td class="keys">${formatKeysHtml(keys)}</td><td class="desc">${esc(description)}</td></tr>
    `).join('');
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
    font-size: 9.5pt;
    line-height: 1.45;
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
    margin: 0 0 1.1rem;
    padding-bottom: 0.85rem;
    border-bottom: 1px solid var(--border);
  }

  .brand img {
    display: block;
    width: min(24rem, 92vw);
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
    padding: 0.95rem 1.05rem 0.75rem;
    box-shadow: 0 12px 40px rgba(0, 0, 0, 0.45), inset 0 1px 0 rgba(57, 255, 20, 0.06);
  }

  .lead {
    margin: 0 0 0.85rem;
    color: var(--text-muted);
    font-size: 0.82rem;
    line-height: 1.5;
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
    padding: 0.85rem 0 0.45rem;
    border-top: 1px solid var(--border);
  }

  .cheat-group:first-of-type {
    border-top: none;
    padding-top: 0;
  }

  h2 {
    margin: 0 0 0.55rem;
    font-size: 1.2rem;
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
    padding: 0.18rem 0;
    border-bottom: 1px solid color-mix(in srgb, var(--border) 65%, transparent);
    line-height: 1.35;
  }

  tr:last-child td { border-bottom: none; }

  td.keys {
    width: 38%;
    padding-right: 0.65rem;
    white-space: normal;
    word-break: break-word;
  }

  td.desc {
    width: 62%;
    color: var(--text-muted);
    font-size: 0.84rem;
  }

  kbd {
    display: inline-block;
    padding: 0.04em 0.32em;
    border: 1px solid color-mix(in srgb, var(--accent) 35%, var(--border));
    border-radius: 0.28em;
    background: color-mix(in srgb, var(--accent-soft) 80%, #111 20%);
    color: var(--accent);
    font-family: inherit;
    font-size: 0.78rem;
    font-weight: 700;
    line-height: 1.25;
    white-space: nowrap;
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
