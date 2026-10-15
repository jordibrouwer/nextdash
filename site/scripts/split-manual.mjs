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

// HTML the manual uses on purpose. Anything else that looks like a tag, such
// as <name> in ":docker <name>", is text and must not reach Vue's compiler.
const HTML_TAGS = new Set(['a', 'p', 'img', 'kbd', 'sub', 'sup', 'details', 'summary', 'b', 'i', 'em', 'strong',
  'br', 'hr', 'code', 'pre', 'div', 'span', 'table', 'thead', 'tbody', 'tr', 'td', 'th', 'ul', 'ol', 'li', 'small',
  'blockquote', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6'])

function parseArgs (argv) {
  const args = { ref: null, only: null }
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--ref') args.ref = argv[++i]
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

// Every anchor in the manual and the chapter it lives in. Heading slugs are
// counted over the whole file, the way GitHub numbers duplicates.
function mapAnchors (chapters) {
  const where = new Map()
  const seen = new Map()
  for (const ch of chapters) {
    ch.headingIds = new Map()
    const all = ch.heading ? [ch.heading, ...ch.lines] : ch.lines
    let fenced = false
    all.forEach((line, i) => {
      if (FENCE.test(line)) fenced = !fenced
      if (fenced) return
      for (const m of line.matchAll(/<a\s+(?:id|name)="([^"]+)"/g)) where.set(m[1], ch)
      const h = line.match(/^#{1,6}\s+(.*)$/)
      if (!h) return
      let slug = githubSlug(h[1])
      const n = seen.get(slug) ?? 0
      seen.set(slug, n + 1)
      if (n) slug = `${slug}-${n}`
      where.set(slug, ch)
      ch.headingIds.set(i - (ch.heading ? 1 : 0), slug)
    })
  }
  return where
}

function main () {
  const args = parseArgs(process.argv.slice(2))
  const ref = args.ref ?? latestTag()
  const blobRef = ref === 'WORKTREE' ? 'dev' : ref
  const text = readAt(ref, 'MANUAL.md').toString()

  const chunks = splitChapters(text)
  const chapters = chunks.map(c => c.heading ? describe(c) : { ...c, key: null, preface: true })
  const where = mapAnchors(chapters)

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
    // Link targets are rewritten on the whole line, since link text may hold
    // inline code. Escaping only touches the text outside inline code.
    const fixLinks = line => line
      .replace(/\]\(([^)\s]+)((?:\s+"[^"]*")?)\)/g, (_, target, t) => `](${rewrite(target, 'md')}${t})`)
      .replace(/\b(href|src)="([^"]+)"/g, (_, a, target) => `${a}="${rewrite(target, 'html')}"`)
    const escape = segment => segment
      .replace(/<(\/?)([a-zA-Z][\w-]*)(?=[\s>/])/g, (m, slash, tag) => HTML_TAGS.has(tag.toLowerCase()) ? m : `&lt;${slash}${tag}`)
      .replace(/\{\{/g, '&#123;&#123;')
    const fixLine = line => fixLinks(line).split(/(`+[^`]*`+)/).map((s, i) => i % 2 ? s : escape(s)).join('')

    const out = []
    let fenced = false
    ch.lines.forEach((line, i) => {
      if (FENCE.test(line)) { fenced = !fenced; out.push(line); return }
      if (fenced) { out.push(line); return }
      const h = line.match(/^(#{3,6})\s+(.*)$/)
      if (h) { out.push(`${h[1].slice(1)} ${fixLine(stripEmoji(h[2]))} {#${ch.headingIds.get(i)}}`); return }
      out.push(fixLine(line))
    })
    while (out.length && isFiller(out.at(-1)) && !ANCHOR_LINE.test(out.at(-1).trim())) out.pop()

    const front = ['---', `title: ${JSON.stringify(ch.title)}`, 'outline: [2, 3]', '---', '']
    const h1 = `# ${ch.title} {#${ch.headingIds.get(-1)}}`
    writeFileSync(join(OUT, `${ch.slug}.md`), [...front, h1, ...out, ''].join('\n'))
  }

  for (const path of images) {
    let data
    try { data = readAt(ref, path) } catch { broken.push(`missing image: ${path}`); continue }
    mkdirSync(dirname(join(OUT, path)), { recursive: true })
    writeFileSync(join(OUT, path), data)
  }

  const sidebar = GROUPS.map(([text, keys]) => ({
    text,
    collapsed: false,
    items: keys.map(k => built.find(c => c.key === k)).filter(Boolean).map(c => ({
      text: c.num ? `<span class="nd-n">${c.num}</span>${c.short}` : `<span class="nd-n"></span>${c.short}`,
      link: `/${c.slug}`
    }))
  })).filter(g => g.items.length)
  writeFileSync(join(OUT, '_sidebar.json'), JSON.stringify(sidebar, null, 2))
  writeFileSync(join(OUT, '_meta.json'), JSON.stringify({ ref, blobRef, chapters: built.map(c => c.slug) }, null, 2))

  const index = ['---', 'title: Documentation', '---', '', '# nextDash documentation', '',
    `How nextDash works, from the first launch to running it next to your own services. This is the manual of ${ref === 'WORKTREE' ? 'the development version' : `nextDash ${ref}`}.`, '']
  for (const g of sidebar) {
    index.push(`## ${g.text}`, '')
    for (const item of g.items) index.push(`- [${item.text.replace(/<[^>]+>/g, '')}](.${item.link}.md)`)
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
