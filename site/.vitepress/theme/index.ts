import { h, onMounted } from 'vue'
import DefaultTheme from 'vitepress/theme'
import SiteFooter from './SiteFooter.vue'
import { installLightbox } from './lightbox'
import './werkbank.css'

export default {
  extends: DefaultTheme,
  Layout: () => h(DefaultTheme.Layout, null, {
    'layout-bottom': () => h(SiteFooter)
  }),
  setup () {
    onMounted(installLightbox)
  }
}
