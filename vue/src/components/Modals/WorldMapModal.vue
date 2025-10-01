<template>
  <ModalWrapper :show="true" title="世界地图" @close="uiStore.hideModal()">
    <div class="world-map-content">
      <div v-if="mapStore.isLoading && mapStore.locations.length === 0" class="status-overlay">
        <Spinner />
        <p>正在加载地点数据...</p>
      </div>
      <div id="world-map-container" ref="mapContainerRef" :class="{ 'add-mode': isAddingMode }"></div>

      <transition name="form-fade">
        <AddLocationForm
            v-if="isAddingMode && newMarkerCoords"
            :coordinates="newMarkerCoords"
            @submit="handleFormSubmit"
            @cancel="toggleAddMode(false)"
        />
      </transition>
    </div>
    <template #footer>
      <div class="map-footer">
        <p v-if="isAddingMode" class="add-mode-hint">请在地图上点击选择要分享的位置</p>
        <div class="spacer"></div>
        <button class="btn-secondary" @click="toggleAddMode(!isAddingMode)">
          {{ isAddingMode ? '取消添加' : '+ 分享地点' }}
        </button>
      </div>
    </template>
  </ModalWrapper>
</template>

<script setup>
import { ref, onMounted, onUnmounted, watch } from 'vue';
import L from 'leaflet';
import ModalWrapper from './ModalWrapper.vue';
import Spinner from '@/components/Shared/Spinner.vue';
import AddLocationForm from './AddLocationForm.vue';
import { useUiStore } from '@/stores/uiStore';
import { useMapStore } from '@/stores/mapStore';
import { log } from '@/utils';

const uiStore = useUiStore();
const mapStore = useMapStore();

const mapContainerRef = ref(null);
let map = null;
let markersLayer = null; // 用于存放所有标记点
let tempMarker = null; // 用于“添加模式”下的临时标记

const isAddingMode = ref(false);
const newMarkerCoords = ref(null);

// 自定义标记图标
const defaultIcon = L.icon({
  iconUrl: 'icons/marker-icon.svg',
  shadowUrl: 'icons/marker-shadow.svg',
  iconSize: [25, 41], iconAnchor: [12, 41], popupAnchor: [1, -34], shadowSize: [41, 41]
});
const tempIcon = L.icon({
  iconUrl: 'icons/marker-icon-temp.svg', // 一个不同颜色的图标
  shadowUrl: 'icons/marker-shadow.svg',
  iconSize: [25, 41], iconAnchor: [12, 41], popupAnchor: [1, -34], shadowSize: [41, 41]
});


onMounted(async () => {
  // 延迟地图初始化，确保模态框动画完成，容器尺寸正确
  setTimeout(async () => {
    initMap();
    await mapStore.fetchLocations();
  }, 100);
});

onUnmounted(() => {
  if (map) {
    map.remove();
    map = null;
  }
});

function initMap() {
  if (mapContainerRef.value && !map) {
    map = L.map(mapContainerRef.value).setView([31.2304, 121.4737], 5); // 默认视图（上海）
    L.tileLayer('https://{s}.ppmc.club/{z}/{x}/{y}.png', {
      maxZoom: 18,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
    }).addTo(map);

    markersLayer = L.layerGroup().addTo(map);

    // 监听地图点击事件
    map.on('click', handleMapClick);
  }
}

// 监听从 store 获取的地点数据变化，并更新地图标记
watch(() => mapStore.locations, (newLocations) => {
  if (!map || !markersLayer) return;
  markersLayer.clearLayers(); // 清空旧标记

  newLocations.forEach(loc => {
    const marker = L.marker([loc.latitude, loc.longitude], { icon: defaultIcon }).addTo(markersLayer);
    const popupContent = `
      <div class="map-popup">
        <img src="${loc.imageUrl}" alt="${loc.tag}" class="popup-image" />
        <div class="popup-content">
          <h4>${loc.tag}</h4>
          <p>${loc.description}</p>
          <small>由 ${loc.createdBy.substring(0, 6)}... 分享</small>
        </div>
      </div>
    `;
    marker.bindPopup(popupContent);
  });
}, { deep: true });

function toggleAddMode(forceState) {
  isAddingMode.value = typeof forceState === 'boolean' ? forceState : !isAddingMode.value;

  if (!isAddingMode.value) {
    // 退出添加模式时，清除临时标记和坐标
    if (tempMarker) {
      tempMarker.remove();
      tempMarker = null;
    }
    newMarkerCoords.value = null;
  }
}

function handleMapClick(e) {
  if (isAddingMode.value) {
    newMarkerCoords.value = e.latlng;
    if (tempMarker) {
      tempMarker.setLatLng(e.latlng);
    } else {
      tempMarker = L.marker(e.latlng, { icon: tempIcon, zIndexOffset: 1000 }).addTo(map);
    }
    map.panTo(e.latlng);
  }
}

async function handleFormSubmit(formData) {
  const success = await mapStore.addLocation(formData);
  if (success) {
    toggleAddMode(false); // 提交成功后退出添加模式
  }
}
</script>

<style scoped>
.world-map-content {
  position: relative;
  width: 100%;
  height: 65vh;
  min-height: 400px;
  background-color: var(--color-background-elevated);
}
#world-map-container {
  width: 100%;
  height: 100%;
  z-index: 1000;
}
#world-map-container.add-mode {
  cursor: crosshair;
}
.status-overlay {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  background-color: rgba(var(--color-background-panel-rgb, 255, 255, 255), 0.8);
  z-index: 1002;
  text-align: center;
  gap: var(--spacing-3);
  color: var(--color-text-secondary);
}
.map-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  width: 100%;
}
.add-mode-hint {
  font-size: var(--font-size-sm);
  color: var(--color-text-secondary);
  font-style: italic;
}
.spacer {
  flex-grow: 1;
}
.form-fade-enter-active, .form-fade-leave-active {
  transition: all 0.3s ease;
}
.form-fade-enter-from, .form-fade-leave-to {
  opacity: 0;
  transform: translate(-50%, 20px);
}

/* Leaflet Popup Customization */
:deep(.leaflet-popup-content-wrapper) {
  border-radius: var(--border-radius-md);
  box-shadow: var(--shadow-md);
}
:deep(.leaflet-popup-content) {
  margin: 0;
  width: 250px !important;
}
:deep(.map-popup .popup-image) {
  width: 100%;
  height: 120px;
  object-fit: cover;
  display: block;
}
:deep(.map-popup .popup-content) {
  padding: var(--spacing-3);
}
:deep(.map-popup h4) {
  margin: 0 0 var(--spacing-1) 0;
  color: var(--color-brand-primary);
  font-weight: var(--font-weight-semibold);
}
:deep(.map-popup p) {
  margin: 0 0 var(--spacing-2) 0;
  font-size: var(--font-size-sm);
  line-height: 1.5;
  /* ✅ MODIFICATION START */
  max-height: 80px;      /* 限制描述区域最大高度，约4行 */
  overflow-y: auto;      /* 内容超限时，仅在此区域显示垂直滚动条 */
  overflow-wrap: break-word; /* 强制长单词或URL换行，防止水平溢出 */
  white-space: normal;   /* 确保文本正常换行 */
  /* ✅ MODIFICATION END */
}
:deep(.map-popup small) {
  color: var(--color-text-tertiary);
  font-size: var(--font-size-xs);
}
</style>