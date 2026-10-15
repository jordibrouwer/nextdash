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

export default {
  extends: DefaultTheme,
  Layout: () => h(DefaultTheme.Layout, null, {
    'layout-bottom': () => h(SiteFooter)
  }),
  setup () {
    onMounted(installLightbox)
    onMounted(openSearchFromQuery)
  }
}
