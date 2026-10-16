import { h, onMounted } from 'vue'
import DefaultTheme from 'vitepress/theme'
import SiteFooter from './SiteFooter.vue'
import { installLightbox } from './lightbox'
import './werkbank.css'

/**
 * /docs/?q=word opens the search with that word in it: "Search the docs for …"
 * at the bottom of the site's search list leads here.
 */
function openSearchFromQuery () {
  const q = new URLSearchParams(location.search).get('q')
  if (!q) return
  document.querySelector<HTMLButtonElement>('.VPNavBarSearch button')?.click()
  let tries = 0
  const fill = () => {
    const input = document.querySelector<HTMLInputElement>('#localsearch-input')
    if (!input) {
      if (++tries < 40) setTimeout(fill, 50)
      return
    }
    input.value = q
    input.dispatchEvent(new Event('input', { bubbles: true }))
    history.replaceState(history.state, '', location.pathname + location.hash)
  }
  fill()
}

/**
 * A search in the docs' own search box goes to Umami as a 'search' event, the
 * same event the site's header search sends, with site: 'docs'. It is sent
 * once the typing pauses for a second, and once per word, so a search is one
 * event and not one per letter.
 */
function trackDocsSearch () {
  let timer: ReturnType<typeof setTimeout> | undefined
  let last = ''
  document.addEventListener('input', (e) => {
    const input = e.target as HTMLInputElement | null
    if (!input || input.id !== 'localsearch-input') return
    clearTimeout(timer)
    timer = setTimeout(() => {
      const q = input.value.trim()
      const umami = (window as any).umami
      if (q.length < 2 || q === last || typeof umami?.track !== 'function') return
      last = q
      const results = document.querySelectorAll('.VPLocalSearchBox .results .result').length
      umami.track('search', { q, site: 'docs', results })
    }, 1000)
  })
}

export default {
  extends: DefaultTheme,
  Layout: () => h(DefaultTheme.Layout, null, {
    'layout-bottom': () => h(SiteFooter)
  }),
  setup () {
    onMounted(installLightbox)
    onMounted(openSearchFromQuery)
    onMounted(trackDocsSearch)
  }
}
