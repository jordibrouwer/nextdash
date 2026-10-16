#!/usr/bin/env node
// Splits MANUAL.md into one VitePress page per chapter under site/src/.
//
// The manual is read from a release tag, not from the working tree, so the
// docs describe what people run. Every in-page link (#anchor) is rewritten to
// the page that holds the anchor; a link to an anchor that exists nowhere in
// the manual fails the run.
//
//   node scripts/split-manual.mjs                    latest vX.Y.Z tag, all chapters
//   node scripts/split-manual.mjs --ref v1.19.8      a fixed tag
//   node scripts/split-manual.mjs --ref WORKTREE     the MANUAL.md on disk (drafting)
//   node scripts/split-manual.mjs --only 2,7,14      a subset of chapters
//   node scripts/split-manual.mjs --ref WORKTREE --label v1.19.8
//                                                    the files on disk, named as a release
//                                                    (only when their text is that release's)

import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const SITE = join(dirname(fileURLToPath(import.meta.url)), '..')
const REPO = join(SITE, '..')
const OUT = join(SITE, 'src')
const GITHUB = 'https://github.com/jordibrouwer/nextdash'

// Sidebar groups, by chapter number. The Self-hosted guide has no number and
// goes by its anchor.
const GROUPS = [
  ['Getting started', [1, 2, 3, 'self-hosted-guide']],
  ['Using nextDash', [4, 5, 6, 7, 8, 9, 10, 11, 12, 13]],
  ['Homelab', [14, 15, 21, 22]],
  ['Make it yours', [16, 17, 18]],
  ['Operate', [19, 20, 23, 24]],
  ['Reference', [25, 26]]
]
const SLUGS = { 1: 'what-is-nextdash', 2: 'installation', 'self-hosted-guide': 'self-hosted-guide' }

// Notes of the site's own, under a chapter's lead, by chapter slug.
const SITE_NOTES = {
  appearance: '::: tip See them first\nThe [theme gallery](https://nextdash.cc/themes/) on nextdash.cc shows the dashboard in every material, dark and light, in the twelve looks, the surfaces and on every backdrop, with a search by name.\n:::'
}

// HTML the manual uses on purpose. Anything else that looks like a tag, such
// as <name> in ":docker <name>", is text and must not reach Vue's compiler.
const HTML_TAGS = new Set(['a', 'p', 'img', 'kbd', 'sub', 'sup', 'details', 'summary', 'b', 'i', 'em', 'strong',
  'br', 'hr', 'code', 'pre', 'div', 'span', 'table', 'thead', 'tbody', 'tr', 'td', 'th', 'ul', 'ol', 'li', 'small',
  'blockquote', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'figure', 'figcaption'])

function parseArgs (argv) {
  const args = { ref: null, only: null, label: null }
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--ref') args.ref = argv[++i]
    else if (argv[i] === '--label') args.label = argv[++i]
    else if (argv[i] === '--only') args.only = new Set(argv[++i].split(',').map(s => /^\d+$/.test(s) ? Number(s) : s))
    else throw new Error(`unknown argument: ${argv[i]}`)
  }
  return args
}

const git = (args, opts = {}) => execFileSync('git', ['-C', REPO, ...args], { maxBuffer: 256 * 1024 * 1024, ...opts })

function latestTag () {
  const tags = git(['tag', '-l', 'v*']).toString().split('\n').filter(t => /^v\d{1,3}\.\d+\.\d+$/.test(t))
  if (!tags.length) throw new Error('no vX.Y.Z release tag found')
  const num = t => t.slice(1).split('.').map(Number)
  tags.sort((a, b) => { const x = num(a); const y = num(b); return x[0] - y[0] || x[1] - y[1] || x[2] - y[2] })
  return tags.at(-1)
}

const readAt = (ref, path) => ref === 'WORKTREE' ? readFileSync(join(REPO, path)) : git(['show', `${ref}:${path}`])

const stripEmoji = s => s.replace(/[\p{Extended_Pictographic}\u{FE0F}\u{200D}\u{20E3}]/gu, '').replace(/\s+/g, ' ').trim()

// GitHub's heading slug: lower case, punctuation and emoji removed, spaces to hyphens.
function githubSlug (text) {
  return text
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[`*_]/g, '')
    .toLowerCase()
    .replace(/[\p{Extended_Pictographic}\u{FE0F}\u{200D}\u{20E3}]/gu, '')
    .replace(/[^\p{L}\p{M}\p{N}\p{Pc}\- ]/gu, '')
    .replace(/ /g, '-')
}

const FENCE = /^\s*(```|~~~)/
const ANCHOR_LINE = /^<a\s+(?:id|name)="[^"]+"\s*><\/a>\s*$/
const isFiller = l => l.trim() === '' || l.trim() === '---' || ANCHOR_LINE.test(l.trim())

// Cut the manual at every "## " heading. Anchor lines right above a heading
// belong to that heading, so they move with it.
function splitChapters (text) {
  const chunks = [{ heading: null, lines: [] }]
  let fenced = false
  for (const line of text.split('\n')) {
    if (FENCE.test(line)) fenced = !fenced
    if (!fenced && /^## /.test(line)) {
      const prev = chunks.at(-1).lines
      const carried = []
      while (prev.length && isFiller(prev.at(-1))) {
        const l = prev.pop()
        if (ANCHOR_LINE.test(l.trim())) carried.unshift(l.trim())
      }
      chunks.push({ heading: line, lines: [...carried, ''] })
      continue
    }
    chunks.at(-1).lines.push(line)
  }
  return chunks
}

function describe (chunk) {
  const raw = chunk.heading.replace(/^##\s+/, '')
  const m = raw.match(/^(\d+)\.\s+(.*)$/)
  const title = stripEmoji(m ? m[2] : raw)
  const firstAnchor = chunk.lines.map(l => l.match(/<a\s+(?:id|name)="([^"]+)"/)).find(Boolean)
  const key = m ? Number(m[1]) : firstAnchor ? firstAnchor[1] : githubSlug(title)
  const slug = SLUGS[key] ?? githubSlug(title.replace(/&/g, 'and')).replace(/-+/g, '-')
  return { ...chunk, key, title, short: title.split(':')[0], num: m ? Number(m[1]) : null, slug }
}

// Section numbers ("14.1 ") lead the manual's headings. The site leaves them
// out: the sidebar carries the chapter number, the page carries the rest.
const SECTION_NUMBER = /^(\d+(?:\.\d+)+|\d+\.)\s+/
const cleanHeading = text => stripEmoji(text).replace(SECTION_NUMBER, '')

// Every anchor in the manual: the chapter it lives in and the title of the
// heading it names. Heading slugs are counted over the whole file, the way
// GitHub numbers duplicates. Section numbers map to the heading's slug, so a
// bare "§14.6" in the text can be named too.
function mapAnchors (chapters) {
  const where = new Map()
  const titles = new Map()
  const numbers = new Map()
  const seen = new Map()
  for (const ch of chapters) {
    ch.headingIds = new Map()
    const all = ch.heading ? [ch.heading, ...ch.lines] : ch.lines
    let fenced = false
    let pending = []
    all.forEach((line, i) => {
      if (FENCE.test(line)) fenced = !fenced
      if (fenced) return
      const ids = [...line.matchAll(/<a\s+(?:id|name)="([^"]+)"/g)].map(m => m[1])
      ids.forEach(id => where.set(id, ch))
      if (ANCHOR_LINE.test(line.trim())) { pending.push(...ids); return }
      const h = line.match(/^#{1,6}\s+(.*)$/)
      if (!h) { if (line.trim()) pending = []; return }
      let slug = githubSlug(h[1])
      const n = seen.get(slug) ?? 0
      seen.set(slug, n + 1)
      if (n) slug = `${slug}-${n}`
      where.set(slug, ch)
      const title = cleanHeading(h[1].replace(/[`*_]/g, ''))
      for (const id of [...pending, slug]) titles.set(id, title)
      pending = []
      const num = stripEmoji(h[1]).match(SECTION_NUMBER)
      if (num && ch.heading) numbers.set(num[1].replace(/\.$/, ''), slug)
      ch.headingIds.set(i - (ch.heading ? 1 : 0), slug)
    })
  }
  return { where, titles, numbers }
}

// Markdown inside an HTML block is not rendered, so captions are converted here.
function inlineMarkdown (text) {
  return text
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, label, href) => `<a href="${href.replace(/\.md(#|$)/, '.html$1')}">${label}</a>`)
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[\s(])[*_]([^*_]+)[*_](?=[\s).,;:]|$)/g, '$1<em>$2</em>')
}

// True when running text follows position `from`: a picture only sits beside
// text when there is text to sit beside. Anchor lines are skipped; a heading,
// table, code block, another picture or the end of the page means no.
function followedByText (str, from) {
  for (const line of str.slice(from).split('\n')) {
    const t = line.trim()
    if (!t || ANCHOR_LINE.test(t)) continue
    return !/^(#|<figure|<p class="nd-center"|<p align|<img|\||```|~~~|<details|<div|<\/details|---)/.test(t)
  }
  return false
}

// GitHub layout in the manual, turned into the site's own markup.
function reshape (segment) {
  return segment
    // Centred screenshots (one, or a pair side by side) with their <sub>
    // caption become a figure.
    .replace(/<p align="center">\s*(<img\b[^>]*>(?:\s*<img\b[^>]*>)*)\s*<\/p>(?:\s*<p align="center"><sub>([\s\S]*?)<\/sub><\/p>)?/g,
      (_, imgs, cap) => `<figure class="nd-fig"><div class="nd-fig-row">${imgs.replace(/>\s+</g, '><')}</div>${cap ? `<figcaption>${inlineMarkdown(cap.trim())}</figcaption>` : ''}</figure>`)
    .replace(/<p align="center">/g, '<p class="nd-center">')
    // A narrow figure on its own sits beside the text that follows it;
    // with no text after it, it stays centred.
    .replace(/<figure class="nd-fig"><div class="nd-fig-row">(<img\b[^>]*\swidth="(\d+)"[^>]*>)<\/div>/g,
      (m, img, w, offset, str) => Number(w) <= 360 && followedByText(str, str.indexOf('</figure>', offset) + 9)
        ? `<figure class="nd-fig nd-fig-side"><div class="nd-fig-row">${img}</div>` : m)
    // Fixed widths become an upper limit; align becomes a float class.
    // tabindex lets the keyboard reach a wide screenshot, the kind the
    // column shrinks and the lightbox enlarges.
    .replace(/<img\b([^>]*)>/g, (m, attrs, offset, str) => {
      const width = attrs.match(/\swidth="(\d+)"/)
      const align = followedByText(str, offset + m.length) && attrs.match(/\salign="(left|right)"/)
      const rest = attrs.replace(/\s(width|height|align)="[^"]*"/g, '')
      const wide = !width || Number(width[1]) > 600
      return `<img${rest}${align ? ` class="nd-float-${align[1]}"` : ''}${width ? ` style="width:${width[1]}px"` : ''}${wide ? ' tabindex="0"' : ''}>`
    })
    // The "In short" note that opens a chapter becomes its lead paragraph.
    .replace(/^> \[!NOTE\]\n> \*\*In short:\*\*\s*(.*(?:\n>.*)*)/gm,
      (_, body) => {
        const text = body.split('\n').map(l => l.replace(/^>\s?/, '')).join(' ').trim()
        return `${text.charAt(0).toUpperCase()}${text.slice(1)} {.nd-lead}`
      })
}

// A drawing in box characters is scaled to fit the column instead of
// scrolling; --cols tells the CSS how many characters wide it is.
function fitDrawing (block) {
  const lines = block.split('\n')
  if (!/^\s*```\s*(text)?\s*$/.test(lines[0]) || !/[─-╿]/.test(block)) return block
  const cols = Math.max(...lines.slice(1, -1).map(l => [...l].length))
  return `<div class="nd-drawing" style="--cols:${cols}">\n\n${block}\n\n</div>`
}

// Apply fn to the parts of a page outside fenced code, and fenced to the code blocks.
function outsideFences (lines, fn, fenced = b => b) {
  const parts = []
  let buf = []
  let inside = false
  for (const line of lines) {
    const toggles = FENCE.test(line)
    if (!inside && toggles) { parts.push(fn(buf.join('\n'))); buf = [line]; inside = true; continue }
    if (inside) { buf.push(line); if (toggles) { parts.push(fenced(buf.join('\n'))); buf = []; inside = false } continue }
    buf.push(line)
  }
  parts.push(inside ? buf.join('\n') : fn(buf.join('\n')))
  return parts.join('\n')
}

function main () {
  const args = parseArgs(process.argv.slice(2))
  const ref = args.ref ?? latestTag()
  const blobRef = ref === 'WORKTREE' ? 'dev' : ref
  // The version the pages name: the tag, or --label for a build from disk.
  const shown = args.label ?? ref
  const text = readAt(ref, 'MANUAL.md').toString()

  const chunks = splitChapters(text)
  const chapters = chunks.map(c => c.heading ? describe(c) : { ...c, key: null, preface: true })
  const { where, titles, numbers } = mapAnchors(chapters)

  const grouped = new Set(GROUPS.flatMap(g => g[1]))
  const built = chapters.filter(c => grouped.has(c.key) && (!args.only || args.only.has(c.key)))
  const builtSet = new Set(built)
  if (!built.length) throw new Error('no chapters selected')

  rmSync(OUT, { recursive: true, force: true })
  mkdirSync(OUT, { recursive: true })

  const broken = []
  const images = new Set()

  for (const ch of built) {
    const rewrite = (target, attr) => {
      if (/^(https?:|mailto:)/.test(target)) return target
      if (target.startsWith('#')) {
        const anchor = target.slice(1)
        const home = where.get(anchor)
        if (!home) { broken.push(`${ch.slug}: #${anchor}`); return target }
        if (home === ch) return target
        if (builtSet.has(home)) return `./${home.slug}.${attr === 'md' ? 'md' : 'html'}#${anchor}`
        return `${GITHUB}/blob/${blobRef}/MANUAL.md#${anchor}`
      }
      const path = target.split(/[?#]/)[0]
      if (path.startsWith('screenshots/')) { images.add(path); return `./${path}` }
      return `${GITHUB}/blob/${blobRef}/${target}`
    }
    // "§14.6" becomes the name of what it points at: the section on this
    // page, the chapter, or "Chapter › Section" on another page.
    const label = anchor => {
      const home = where.get(anchor)
      const title = titles.get(anchor)
      if (!home) return null
      if (!title || title === home.title || title === home.short) return home.short
      return home === ch ? title : `${home.short} › ${title}`
    }
    const SECTION_REF = /^§\s?\d+(?:\.\d+)*\s*/

    // Link targets are rewritten on the whole line, since link text may hold
    // inline code. Escaping only touches the text outside inline code.
    const fixLinks = line => line
      .replace(/(!?)\[((?:[^[\]]|\[[^\]]*\])*)\]\(([^)\s]+)((?:\s+"[^"]*")?)\)/g, (_, bang, text, target, t) => {
        const named = !bang && target.startsWith('#') && SECTION_REF.test(text) ? (label(target.slice(1)) ?? text) : text
        return `${bang}[${named}](${rewrite(target, 'md')}${t})`
      })
      .replace(/\b(href|src)="([^"]+)"/g, (_, a, target) => `${a}="${rewrite(target, 'html')}"`)
    const escape = segment => segment
      .replace(/<(\/?)([a-zA-Z][\w-]*)(?=[\s>/])/g, (m, slash, tag) => HTML_TAGS.has(tag.toLowerCase()) ? m : `&lt;${slash}${tag}`)
      .replace(/\{\{/g, '&#123;&#123;')
      .replace(/§\s?(\d+(?:\.\d+)*)/g, (m, num) => numbers.has(num) ? label(numbers.get(num)) : m)
    const fixLine = line => fixLinks(line).split(/(`+[^`]*`+)/).map((s, i) => i % 2 ? s : escape(s)).join('')

    const out = []
    let fenced = false
    ch.lines.forEach((line, i) => {
      if (FENCE.test(line)) { fenced = !fenced; out.push(line); return }
      if (fenced) { out.push(line); return }
      // "↑ Contents" points at the manual's table of contents; the sidebar does that here.
      if (/^\s*<sub>\[↑ Contents\]\(#table-of-contents\)<\/sub>\s*$/.test(line)) return
      const h = line.match(/^(#{3,6})\s+(.*)$/)
      if (h) { out.push(`${h[1].slice(1)} ${fixLine(cleanHeading(h[2]))} {#${ch.headingIds.get(i)}}`); return }
      out.push(fixLine(line))
    })
    while (out.length && isFiller(out.at(-1)) && !ANCHOR_LINE.test(out.at(-1).trim())) out.pop()

    const front = ['---', `title: ${JSON.stringify(ch.title)}`, 'outline: [2, 3]', '---', '']
    const h1 = `# ${ch.title} {#${ch.headingIds.get(-1)}}`
    let body = outsideFences(out, reshape, fitDrawing)
    // A note of the site's own under a chapter's lead; the manual itself does not carry it.
    if (SITE_NOTES[ch.slug]) body = body.replace(/\{\.nd-lead\}\n/, (m) => `${m}\n${SITE_NOTES[ch.slug]}\n`)
    writeFileSync(join(OUT, `${ch.slug}.md`), [...front, h1, body, ''].join('\n'))
  }

  for (const path of images) {
    let data
    try { data = readAt(ref, path) } catch { broken.push(`missing image: ${path}`); continue }
    mkdirSync(dirname(join(OUT, path)), { recursive: true })
    writeFileSync(join(OUT, path), data)
  }

  // Groups start folded; VitePress opens the one that holds the current page.
  const sidebar = GROUPS.map(([text, keys]) => ({
    text,
    collapsed: true,
    items: keys.map(k => built.find(c => c.key === k)).filter(Boolean).map(c => ({
      text: c.num ? `<span class="nd-n">${c.num}</span>${c.short}` : `<span class="nd-n"></span>${c.short}`,
      link: `/${c.slug}`
    }))
  })).filter(g => g.items.length)
  writeFileSync(join(OUT, '_sidebar.json'), JSON.stringify(sidebar, null, 2))

  // The docs folder sits inside the WordPress container, whose Apache answers
  // /docs/ with index.php first; point it at the built pages instead.
  // RewriteEngine On without rules keeps WordPress's rewrite from sending a
  // missing docs page to WordPress's own 404.
  // Pages must not be cached: an old page asks for the old build's scripts,
  // and its menu then opens the 404 page. mod_expires is on in the image.
  mkdirSync(join(OUT, 'public'), { recursive: true })
  writeFileSync(join(OUT, 'public', '.htaccess'), [
    'DirectoryIndex index.html',
    'RewriteEngine On',
    'ErrorDocument 404 /docs/404.html',
    '<IfModule mod_expires.c>',
    '  ExpiresActive On',
    '  ExpiresByType text/html "access plus 0 seconds"',
    '</IfModule>',
    ''
  ].join('\n'))
  writeFileSync(join(OUT, '_meta.json'), JSON.stringify({ ref: shown, source: ref, blobRef, chapters: built.map(c => c.slug) }, null, 2))

  const index = ['---', 'title: Documentation', 'pageClass: nd-index', '---', '', '# nextDash documentation', '',
    `How nextDash works, from the first launch to running it next to your own services. This is the manual of ${shown === 'WORKTREE' ? 'the development version' : `nextDash ${shown}`}.`, '']
  for (const g of sidebar) {
    index.push(`## ${g.text}`, '')
    // The chapter number stands before the link, in its own column, as in the sidebar.
    for (const item of g.items) {
      const num = (item.text.match(/<span class="nd-n">([^<]*)<\/span>/) || [])[1] || ''
      index.push(`- <span class="nd-n">${num}</span>[${item.text.replace(/<[^>]+>/g, '').slice(num.length)}](.${item.link}.md)`)
    }
    index.push('')
  }
  writeFileSync(join(OUT, 'index.md'), index.join('\n'))

  console.log(`MANUAL.md at ${ref}: ${built.length} chapters, ${images.size} screenshots`)
  if (broken.length) {
    console.error(`\n${broken.length} broken link(s):\n  ${broken.join('\n  ')}`)
    process.exit(1)
  }
}

main()
