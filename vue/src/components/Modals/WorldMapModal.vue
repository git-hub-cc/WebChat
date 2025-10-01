<template>
  <transition name="world-map-fade">
    <div v-if="uiStore.activeOverlayModal === 'worldMap'" class="viewer-backdrop" @click.self="close">
      <button class="close-button" @click="close" title="关闭 (Esc)">×</button>

      <div class="map-modal-container" v-motion-pop>
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
                @show-cropper="handleShowCropper"
            />
          </transition>
        </div>
        <footer class="map-footer">
          <!-- ✅ MODIFICATION START: Added filter dropdown -->
          <div class="map-filter-container">
            <select v-model="selectedTagFilter" class="filter-select">
              <option v-for="option in filterOptions" :key="option.value" :value="option.value">
                {{ option.text }}
              </option>
            </select>
          </div>
          <!-- ✅ MODIFICATION END -->
          <p v-if="isAddingMode" class="add-mode-hint">请在地图上点击选择要分享的位置</p>
          <div class="spacer"></div>
          <button class="btn-secondary" @click="toggleAddMode(!isAddingMode)">
            {{ isAddingMode ? '取消添加' : '+ 分享地点' }}
          </button>
        </footer>
      </div>

      <ImageCropperModal
          v-if="isCropperVisible"
          :image-src="cropperProps.imageSrc"
          :file-name="cropperProps.fileName"
          @complete="handleCroppingComplete"
          @cancel="handleCropperCancel"
      />
    </div>
  </transition>
</template>

<script setup>
import { ref, onMounted, onUnmounted, watch, defineAsyncComponent, computed } from 'vue';
import L from 'leaflet';
import Spinner from '@/components/Shared/Spinner.vue';
import AddLocationForm from './AddLocationForm.vue';
import { useUiStore } from '@/stores/uiStore';
import { useMapStore } from '@/stores/mapStore';
import { log } from '@/utils';

const ImageCropperModal = defineAsyncComponent(() => import('./ImageCropperModal.vue'));

const uiStore = useUiStore();
const mapStore = useMapStore();

const mapContainerRef = ref(null);
let map = null;
let markersLayer = null;
let tempMarker = null;

const isAddingMode = ref(false);
const newMarkerCoords = ref(null);

const isCropperVisible = ref(false);
const cropperProps = ref({});

// ✅ MODIFICATION START: Define tag configurations and filter state
const TAG_CONFIG = {
  '美食': { iconFile: 'icons/marker-icon-food.svg' },
  '景点': { iconFile: 'icons/marker-icon-scenery.svg' },
  '购物': { iconFile: 'icons/marker-icon-shopping.svg' },
  '活动': { iconFile: 'icons/marker-icon-activity.svg' },
  '其他': { iconFile: 'icons/marker-icon-other.svg' },
};

const selectedTagFilter = ref('all');
const filterOptions = ref([
  { value: 'all', text: '全部分类' },
  ...Object.keys(TAG_CONFIG).map(key => ({ value: key, text: key }))
]);

const locationIcons = {
  default: L.icon({
    iconUrl: 'icons/marker-icon.svg',
    shadowUrl: 'icons/marker-shadow.svg',
    iconSize: [25, 41], iconAnchor: [12, 41], popupAnchor: [1, -34], shadowSize: [41, 41]
  }),
  temp: L.icon({
    iconUrl: 'icons/marker-icon-temp.svg',
    shadowUrl: 'icons/marker-shadow.svg',
    iconSize: [25, 41], iconAnchor: [12, 41], popupAnchor: [1, -34], shadowSize: [41, 41]
  })
};

// Create icon instances for each tag
for (const tag in TAG_CONFIG) {
  locationIcons[tag] = L.icon({
    iconUrl: TAG_CONFIG[tag].iconFile,
    shadowUrl: 'icons/marker-shadow.svg',
    iconSize: [25, 41], iconAnchor: [12, 41], popupAnchor: [1, -34], shadowSize: [41, 41]
  });
}

const filteredLocations = computed(() => {
  if (selectedTagFilter.value === 'all') {
    return mapStore.locations;
  }
  return mapStore.locations.filter(loc => loc.tag === selectedTagFilter.value);
});
// ✅ MODIFICATION END


function initMap() {
  if (mapContainerRef.value && !map) {
    map = L.map(mapContainerRef.value).setView([31.2304, 121.4737], 5);
    L.tileLayer('https://{s}.ppmc.club/{z}/{x}/{y}.png', {
      maxZoom: 18,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
    }).addTo(map);

    markersLayer = L.layerGroup().addTo(map);
    map.on('click', handleMapClick);
    map.invalidateSize();
  }
}

function close() {
  uiStore.hideOverlayModal();
}

function handleKeyDown(event) {
  if (event.key === 'Escape') {
    if (isCropperVisible.value) {
      handleCropperCancel();
    } else if (isAddingMode.value) {
      toggleAddMode(false);
    } else {
      close();
    }
  }
}

onMounted(async () => {
  setTimeout(async () => {
    initMap();
    await mapStore.fetchLocations();
  }, 100);
  window.addEventListener('keydown', handleKeyDown);
});

onUnmounted(() => {
  window.removeEventListener('keydown', handleKeyDown);
  if (map) {
    map.remove();
    map = null;
  }
});

// ✅ MODIFICATION START: Watch the computed filteredLocations instead of the raw store data
watch(filteredLocations, (newLocations) => {
  if (!map || !markersLayer) return;
  markersLayer.clearLayers();

  newLocations.forEach(loc => {
    // Select the correct icon based on the tag
    const icon = locationIcons[loc.tag] || locationIcons.default;
    const marker = L.marker([loc.latitude, loc.longitude], { icon }).addTo(markersLayer);
    const popupContent = `
      <div class="map-popup">
        <img src="https://ppmc.club/webchat-vue/${loc.imageUrl}" alt="${loc.tag}" class="popup-image" />
        <div class="popup-content">
          <h4>${loc.tag}</h4>
          <p>${loc.description}</p>
          <small>由 ${loc.createdBy} 分享</small>
        </div>
      </div>
    `;
    marker.bindPopup(popupContent);
  });
}, { deep: true });
// ✅ MODIFICATION END

function toggleAddMode(forceState) {
  isAddingMode.value = typeof forceState === 'boolean' ? forceState : !isAddingMode.value;
  if (!isAddingMode.value) {
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
      tempMarker = L.marker(e.latlng, { icon: locationIcons.temp, zIndexOffset: 1000 }).addTo(map);
    }
    map.panTo(e.latlng);
  }
}

async function handleFormSubmit(formData) {
  const success = await mapStore.addLocation(formData);
  if (success) {
    toggleAddMode(false);
  }
}

function handleShowCropper(data) {
  cropperProps.value = data;
  isCropperVisible.value = true;
}

function handleCroppingComplete(finalFile) {
  if (typeof cropperProps.value.onComplete === 'function') {
    cropperProps.value.onComplete(finalFile);
  }
  isCropperVisible.value = false;
  cropperProps.value = {};
}

function handleCropperCancel() {
  isCropperVisible.value = false;
  cropperProps.value = {};
}
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

.map-modal-container {
  width: 90vw;
  height: 90vh;
  max-width: 1400px;
  max-height: 900px;
  background-color: var(--color-background-panel);
  border-radius: var(--border-radius-lg);
  overflow: hidden;
  box-shadow: 0 0 40px rgba(0,0,0,0.5);
  display: flex;
  flex-direction: column;
}

.world-map-content {
  position: relative;
  flex-grow: 1;
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
  padding: var(--spacing-3) var(--spacing-4);
  border-top: 1px solid var(--color-border);
  flex-shrink: 0;
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

.world-map-fade-enter-active,
.world-map-fade-leave-active {
  transition: opacity 0.3s var(--transition-easing);
}
.world-map-fade-enter-from,
.world-map-fade-leave-to {
  opacity: 0;
}

/* ✅ MODIFICATION START: Styles for the new filter dropdown */
.map-filter-container {
  position: relative;
}
.filter-select {
  padding: var(--spacing-1) var(--spacing-2);
  border-radius: var(--border-radius-md);
  border: 1px solid var(--color-border);
  background-color: var(--color-background-elevated);
  min-width: 120px;
}
/* ✅ MODIFICATION END */


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
  max-height: 80px;
  overflow-y: auto;
  overflow-wrap: break-word;
  white-space: normal;
}
:deep(.map-popup small) {
  color: var(--color-text-tertiary);
  font-size: var(--font-size-xs);
}
</style>