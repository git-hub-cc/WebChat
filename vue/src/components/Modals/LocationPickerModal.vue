<template>
  <ModalWrapper :show="true" title="选择位置" @close="closeModal">
    <div class="location-picker-content">
      <div v-if="loadingStatus === 'loading'" class="status-overlay">
        <Spinner />
        <p>正在获取当前位置...</p>
      </div>
      <div v-if="loadingStatus === 'error'" class="status-overlay error">
        <p>定位失败: {{ errorMessage }}</p>
        <p>地图将显示默认位置。</p>
      </div>
      <div id="location-picker-map" ref="mapContainerRef"></div>
    </div>
    <template #footer>
      <button class="btn-secondary" @click="closeModal">取消</button>
      <button class="btn-primary" @click="confirmLocation" :disabled="!selectedLocation">
        发送
      </button>
    </template>
  </ModalWrapper>
</template>

<script setup>
import { ref, onMounted, onUnmounted } from 'vue';
import L from 'leaflet';
import ModalWrapper from './ModalWrapper.vue';
import Spinner from '@/components/Shared/Spinner.vue';
import { useUiStore } from '@/stores/uiStore';
import { useChatStore } from '@/stores/chatStore';
import { locationService } from '@/services/locationService';

const uiStore = useUiStore();
const chatStore = useChatStore();

const mapContainerRef = ref(null);
const loadingStatus = ref('loading');
const errorMessage = ref('');
const selectedLocation = ref(null);
let map = null;
let marker = null;

// 自定义标记图标
const markerIcon = L.icon({
  iconUrl: 'icons/marker-icon.svg',
  iconRetinaUrl: 'icons/marker-icon.svg',
  shadowUrl: 'icons/marker-shadow.svg',
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41]
});

onMounted(async () => {
  try {
    const { latitude, longitude } = await locationService.getCurrentLocation();
    initMap([latitude, longitude]);
    loadingStatus.value = 'loaded';
  } catch (error) {
    errorMessage.value = error.message;
    loadingStatus.value = 'error';
    // 定位失败时，显示一个默认位置（例如北京）
    initMap([39.9042, 116.4074]);
  }
});

onUnmounted(() => {
  if (map) {
    map.remove();
    map = null;
  }
});

function initMap(centerCoords) {
  if (mapContainerRef.value && !map) {
    map = L.map(mapContainerRef.value).setView(centerCoords, 16);
    L.tileLayer('https://{s}.ppmc.club/{z}/{x}/{y}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
    }).addTo(map);

    marker = L.marker(centerCoords, { draggable: true, icon: markerIcon }).addTo(map);
    selectedLocation.value = marker.getLatLng();

    marker.on('dragend', () => {
      selectedLocation.value = marker.getLatLng();
    });

    map.on('click', (e) => {
      marker.setLatLng(e.latlng);
      selectedLocation.value = marker.getLatLng();
    });
  }
}

function confirmLocation() {
  if (selectedLocation.value) {
    chatStore.sendMessage({
      location: {
        latitude: selectedLocation.value.lat,
        longitude: selectedLocation.value.lng,
        accuracy: -1 // 用户手动选择，无精度
      }
    });
    closeModal();
  }
}

function closeModal() {
  uiStore.hideModal();
}
</script>

<style scoped>
.location-picker-content {
  position: relative;
  width: 100%;
  height: 40vh; /* 确保有足够的高度 */
  min-height: 300px;
  background-color: var(--color-background-elevated);
}
#location-picker-map {
  width: 100%;
  height: 100%;
  z-index: 1;
}
.status-overlay {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  background-color: rgba(var(--color-background-panel), 0.8);
  z-index: 2;
  text-align: center;
  gap: var(--spacing-3);
  color: var(--color-text-secondary);
}
.status-overlay.error {
  color: var(--color-status-danger);
}
.btn-primary:disabled {
  background-color: var(--color-background-hover);
  cursor: not-allowed;
}
</style>