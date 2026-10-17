import { h, onMounted, watch, nextTick } from 'vue'
import { useRoute } from 'vitepress'
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

const reduceMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches

/**
 * A chapter's recording plays while it is in view and stops when it leaves.
 * With reduced motion asked for it stays on its poster, with controls.
 */
let loopWatch: IntersectionObserver | null = null
function playLoopsInView () {
  loopWatch?.disconnect()
  const videos = document.querySelectorAll<HTMLVideoElement>('.nd-chapter-loop video')
  if (!videos.length) return
  if (reduceMotion() || !('IntersectionObserver' in window)) {
    videos.forEach(v => { v.controls = true })
    return
  }
  loopWatch = new IntersectionObserver(entries => {
    for (const e of entries) {
      const v = e.target as HTMLVideoElement
      if (e.isIntersecting) { v.preload = 'auto'; v.play().catch(() => {}) } else v.pause()
    }
  }, { threshold: 0.35 })
  videos.forEach(v => loopWatch!.observe(v))
}

/** A thin line under the header that follows how far down the page you are. */
function readingProgress () {
  const bar = document.createElement('div')
  bar.className = 'nd-progress'
  bar.setAttribute('aria-hidden', 'true')
  document.body.appendChild(bar)
  let queued = false
  const draw = () => {
    queued = false
    const el = document.documentElement
    const room = el.scrollHeight - el.clientHeight
    bar.hidden = room < 400 || !!document.querySelector('.nd-index')
    bar.style.transform = `scaleX(${room > 0 ? Math.min(1, el.scrollTop / room) : 0})`
  }
  const ask = () => { if (!queued) { queued = true; requestAnimationFrame(draw) } }
  addEventListener('scroll', ask, { passive: true })
  addEventListener('resize', ask, { passive: true })
  return ask
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
    const route = useRoute()
    let progress: () => void = () => {}
    onMounted(() => { progress = readingProgress(); playLoopsInView(); progress() })
    // A new page in the same tab: its recordings and its length are new too.
    watch(() => route.path, () => nextTick(() => { playLoopsInView(); progress() }))
  }
}
