import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitepress'
import { withMermaid } from 'vitepress-plugin-mermaid'

// Both files are written by scripts/split-manual.mjs.
const src = (name: string) => fileURLToPath(new URL(`../src/${name}`, import.meta.url))
const sidebar = JSON.parse(readFileSync(src('_sidebar.json'), 'utf8'))
const meta = JSON.parse(readFileSync(src('_meta.json'), 'utf8'))

const SITE = 'https://nextdash.cc'

// The manual draws its flowcharts in Mermaid, which GitHub renders; so does the site.
export default withMermaid(defineConfig({
  title: 'nextDash',
  titleTemplate: ':title · nextDash docs',
  description: 'How nextDash works, from the first launch to running it next to your own services.',
  lang: 'en',
  base: '/docs/',
  srcDir: 'src',
  srcExclude: ['_*.json'],
  lastUpdated: false,
  appearance: true,

  head: [
    ['link', { rel: 'icon', type: 'image/svg+xml', href: "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'><rect width='32' height='32' rx='7' fill='%23232a27'/><path d='M8.5 10l6 5-6 5' fill='none' stroke='%2372ca9d' stroke-width='2.6' stroke-linecap='square'/><rect x='16' y='20.5' width='8' height='2.6' fill='%2372ca9d'/></svg>" }],
    ['link', { rel: 'preconnect', href: 'https://fonts.googleapis.com' }],
    ['link', { rel: 'preconnect', href: 'https://fonts.gstatic.com', crossorigin: '' }],
    ['link', { rel: 'stylesheet', href: 'https://fonts.googleapis.com/css2?family=Source+Sans+3:wght@400;600&family=Source+Code+Pro:wght@400;500&display=swap' }],
    // The same Umami site as WordPress; data-domains keeps local builds out of the stats.
    ['script', { defer: '', src: 'https://stats.nextdash.cc/script.js', 'data-website-id': 'd33ce6d0-a7b7-4b4c-8b4a-a905f75c08a6', 'data-domains': 'nextdash.cc' }]
  ],

  themeConfig: {
    siteTitle: 'nextDash',
    // The logo goes to the site's home, as it does in the WordPress header.
    logoLink: { link: `${SITE}/`, target: '_self' },
    logo: { light: "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'><rect width='32' height='32' rx='7' fill='%23232a27'/><path d='M8.5 10l6 5-6 5' fill='none' stroke='%2372ca9d' stroke-width='2.6' stroke-linecap='square'/><rect x='16' y='20.5' width='8' height='2.6' fill='%2372ca9d'/></svg>", dark: "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'><rect width='32' height='32' rx='7' fill='%2324352d'/><path d='M8.5 10l6 5-6 5' fill='none' stroke='%2372ca9d' stroke-width='2.6' stroke-linecap='square'/><rect x='16' y='20.5' width='8' height='2.6' fill='%2372ca9d'/></svg>", alt: '' },
    nav: [
      { text: 'Features', link: `${SITE}/features/`, target: '_self' },
      { text: 'Install', link: '/installation' },
      { text: 'Docs', link: '/', activeMatch: '^/(?!installation)' },
      { text: 'Integrations', link: '/widgets' },
      { text: 'News', link: `${SITE}/news/`, target: '_self' },
      { text: 'Demo', link: 'https://demo.nextdash.cc' }
    ],
    socialLinks: [{ icon: 'github', link: 'https://github.com/jordibrouwer/nextdash' }],
    sidebar,
    outline: { level: [2, 3], label: 'On this page' },
    search: { provider: 'local' },
    editLink: {
      pattern: 'https://github.com/jordibrouwer/nextdash/edit/dev/MANUAL.md',
      text: 'Edit this page on GitHub'
    },
    docFooter: { prev: 'Previous', next: 'Next' },
    externalLinkIcon: true
  },

  mermaid: {
    fontFamily: '"Source Sans 3", system-ui, sans-serif'
  },

  vite: {
    define: { __DOCS_REF__: JSON.stringify(meta.ref) }
  }
}))
