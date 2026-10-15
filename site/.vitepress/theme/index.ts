import { h } from 'vue'
import DefaultTheme from 'vitepress/theme'
import SiteFooter from './SiteFooter.vue'
import './werkbank.css'

export default {
  extends: DefaultTheme,
  Layout: () => h(DefaultTheme.Layout, null, {
    'layout-bottom': () => h(SiteFooter)
  })
}
