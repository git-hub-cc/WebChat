<template>
  <transition name="location-viewer-fade">
    <!-- ✅ BUG FIX START: Changed v-if condition to check 'activeOverlayModal' instead of 'activeModal' -->
    <div
        v-if="uiStore.activeOverlayModal === 'locationViewer' && content"
        class="viewer-backdrop"
        @click.self="close"
    >
      <!-- ✅ BUG FIX END -->
      <button class="close-button" @click="close" title="关闭 (Esc)">×</button>
      <div class="map-container" v-motion-pop>
        <div id="location-viewer-map" ref="mapContainerRef"></div>
      </div>
    </div>
  </transition>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue';
import L from 'leaflet';
import { useUiStore } from '@/stores/uiStore';

const uiStore = useUiStore();
const content = computed(() => uiStore.locationViewerContent);
const mapContainerRef = ref(null);
let map = null;

// 使用 SVG 标记图标
const markerIcon = L.icon({
  iconUrl: 'icons/marker-icon.svg',
  shadowUrl: 'icons/marker-shadow.svg',
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41]
});

function initMap() {
  if (mapContainerRef.value && content.value && !map) {
    const coords = [content.value.latitude, content.value.longitude];
    map = L.map(mapContainerRef.value).setView(coords, 16);

    L.tileLayer('https://{s}.ppmc.club/{z}/{x}/{y}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
    }).addTo(map);

    L.marker(coords, { icon: markerIcon }).addTo(map);

    // 对于在模态框或隐藏元素中的地图，这至关重要
    map.invalidateSize();
  }
}

function close() {
  // ✅ BUG FIX START: Changed from hideModal to hideOverlayModal
  uiStore.hideOverlayModal();
  // ✅ BUG FIX END
}

function handleKeyDown(event) {
  if (event.key === 'Escape') {
    close();
  }
}

onMounted(() => {
  // 轻微延迟有助于 Leaflet 在模态框过渡后正确计算容器尺寸
  setTimeout(initMap, 100);
  window.addEventListener('keydown', handleKeyDown);
});

onUnmounted(() => {
  window.removeEventListener('keydown', handleKeyDown);
  if (map) {
    map.remove();
    map = null;
  }
});
</script>

<style scoped>
.viewer-backdrop {
  position: fixed;
  inset: 0;
  background-color: rgba(0, 0, 0, 0.85);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1500;
  padding: var(--spacing-4);
  box-sizing: border-box;
}

.close-button {
  position: absolute;
  top: var(--spacing-4);
  right: var(--spacing-4);
  width: 40px;
  height: 40px;
  border-radius: 50%;
  background-color: rgba(30, 30, 30, 0.7);
  color: white;
  font-size: 2rem;
  line-height: 1;
  border: none;
  cursor: pointer;
  z-index: 1501;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background-color 0.2s ease, transform 0.2s ease;
}

.close-button:hover {
  background-color: rgba(220, 53, 69, 0.8);
  transform: scale(1.1);
}

.map-container {
  width: 90vw;
  height: 90vh;
  max-width: 1200px;
  max-height: 800px;
  border-radius: var(--border-radius-lg);
  overflow: hidden;
  box-shadow: 0 0 40px rgba(0,0,0,0.5);
}

#location-viewer-map {
  width: 100%;
  height: 100%;
}

.location-viewer-fade-enter-active,
.location-viewer-fade-leave-active {
  transition: opacity 0.3s var(--transition-easing);
}
.location-viewer-fade-enter-from,
.location-viewer-fade-leave-to {
  opacity: 0;
}
</style>