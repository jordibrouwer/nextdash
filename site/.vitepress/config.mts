import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitepress'

// Both files are written by scripts/split-manual.mjs.
const src = (name: string) => fileURLToPath(new URL(`../src/${name}`, import.meta.url))
const sidebar = JSON.parse(readFileSync(src('_sidebar.json'), 'utf8'))
const meta = JSON.parse(readFileSync(src('_meta.json'), 'utf8'))

const SITE = 'https://nextdash.cc'

export default defineConfig({
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
    ['link', { rel: 'preconnect', href: 'https://fonts.googleapis.com' }],
    ['link', { rel: 'preconnect', href: 'https://fonts.gstatic.com', crossorigin: '' }],
    ['link', { rel: 'stylesheet', href: 'https://fonts.googleapis.com/css2?family=Source+Sans+3:wght@400;600&family=Source+Code+Pro:wght@400;500&display=swap' }],
    // The same Umami site as WordPress; data-domains keeps local builds out of the stats.
    ['script', { defer: '', src: 'https://stats.nextdash.cc/script.js', 'data-website-id': 'd33ce6d0-a7b7-4b4c-8b4a-a905f75c08a6', 'data-domains': 'nextdash.cc' }]
  ],

  themeConfig: {
    siteTitle: 'nextDash',
    logo: undefined,
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

  vite: {
    define: { __DOCS_REF__: JSON.stringify(meta.ref) }
  }
})
