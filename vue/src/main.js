import { createApp } from 'vue'
import { createPinia } from 'pinia'
import { autoAnimatePlugin } from '@formkit/auto-animate/vue'
import { MotionPlugin } from '@vueuse/motion'

import App from './App.vue'
import './assets/styles/main.css'

// ✅ MODIFICATION: Import Leaflet's CSS for map rendering
import 'leaflet/dist/leaflet.css';

// 引入 vue-virtual-scroller 以支持高性能长列表
import 'vue-virtual-scroller/dist/vue-virtual-scroller.css'
import VueVirtualScroller from 'vue-virtual-scroller'

const app = createApp(App)

// ✅ MODIFICATION START: Add global error handler
app.config.errorHandler = (err, instance, info) => {
    // Log the error for debugging purposes
    console.error("Global Vue Error:", err);
    console.error("Vue instance:", instance);
    console.error("Component info:", info);

    // Optionally, you can send this error to a monitoring service like Sentry
    // Sentry.captureException(err);

    // You could also show a user-friendly error message via an eventBus or a global store
    // eventBus.emit('showNotification', { message: '应用发生未知错误，请刷新页面。', type: 'error' });
};
// ✅ MODIFICATION END

app.use(createPinia())
app.use(VueVirtualScroller)
app.use(autoAnimatePlugin) // <-- [动画] 注册 AutoAnimate 插件
app.use(MotionPlugin)      // <-- [动画] 注册 VueUse Motion 插件

app.mount('#app')