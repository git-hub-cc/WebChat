import { createApp } from 'vue'
import { createPinia } from 'pinia'

import App from './App.vue'
import './assets/styles/main.css'

// 引入 vue-virtual-scroller 以支持高性能长列表
import 'vue-virtual-scroller/dist/vue-virtual-scroller.css'
import VueVirtualScroller from 'vue-virtual-scroller'

const app = createApp(App)

app.use(createPinia())
app.use(VueVirtualScroller)

app.mount('#app')