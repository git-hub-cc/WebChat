import { createApp } from 'vue'
import { createPinia } from 'pinia'
import { autoAnimatePlugin } from '@formkit/auto-animate/vue'
import { MotionPlugin } from '@vueuse/motion'

import App from './App.vue'
import './assets/styles/main.css'

import 'leaflet/dist/leaflet.css';

// ✅ MODIFICATION START: Import vue-advanced-cropper CSS
import 'vue-advanced-cropper/dist/style.css';
// ✅ MODIFICATION END

import 'vue-virtual-scroller/dist/vue-virtual-scroller.css'
import VueVirtualScroller from 'vue-virtual-scroller'

const app = createApp(App)

app.config.errorHandler = (err, instance, info) => {
    console.error("Global Vue Error:", err);
    console.error("Vue instance:", instance);
    console.error("Component info:", info);
};

app.use(createPinia())
app.use(VueVirtualScroller)
app.use(autoAnimatePlugin)
app.use(MotionPlugin)

app.mount('#app')