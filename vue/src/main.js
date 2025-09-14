import { createApp } from 'vue'
import { createPinia } from 'pinia'
import { autoAnimatePlugin } from '@formkit/auto-animate/vue'
import { MotionPlugin } from '@vueuse/motion'

import App from './App.vue'
import './assets/styles/main.css'

// 引入 vue-virtual-scroller 以支持高性能长列表
import 'vue-virtual-scroller/dist/vue-virtual-scroller.css'
import VueVirtualScroller from 'vue-virtual-scroller'

const app = createApp(App)

app.use(createPinia())
app.use(VueVirtualScroller)
app.use(autoAnimatePlugin) // <-- [动画] 注册 AutoAnimate 插件
app.use(MotionPlugin)      // <-- [动画] 注册 VueUse Motion 插件

app.mount('#app')