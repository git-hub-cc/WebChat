<template>
  <transition name="world-map-fade">
    <div v-if="uiStore.activeOverlayModal === 'worldMap'" class="viewer-backdrop" :class="{ 'widget-active': isWidgetActive }" @click.self="close">
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

          <!-- ✅ MODIFICATION START: CommentModal is now a child component, positioned absolutely -->
          <transition name="comment-panel-fade">
            <CommentModal
                v-if="isCommentPanelVisible && selectedLocation"
                :location-data="selectedLocation"
                :style="commentPanelStyle"
                @close="closeCommentPanel"
            />
          </transition>
          <!-- ✅ MODIFICATION END -->
        </div>
        <footer class="map-footer">
          <div class="map-filter-container">
            <select v-model="selectedTagFilter" class="filter-select">
              <option v-for="option in filterOptions" :key="option.value" :value="option.value">
                {{ option.text }}
              </option>
            </select>
          </div>

          <div class="map-search-container">
            <input
                type="search"
                :value="searchQuery"
                @input="handleSearchInput"
                placeholder="搜索地点..."
                class="search-input"
                aria-label="搜索地点"
            />
          </div>

          <p v-if="isAddingMode" class="add-mode-hint">请在地图上点击选择要分享的位置</p>
          <p v-if="!isAddingMode && filteredLocations.length === 0 && (selectedTagFilter !== 'all' || searchQuery !== '')" class="no-results-hint">
            无匹配地点
          </p>
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
import { useCallStore } from '@/stores/callStore';
import { log, debounce } from '@/utils';
import CommentModal from './CommentModal.vue';

const ImageCropperModal = defineAsyncComponent(() => import('./ImageCropperModal.vue'));

const uiStore = useUiStore();
const mapStore = useMapStore();
const callStore = useCallStore();

const mapContainerRef = ref(null);
let map = null;
let markersLayer = null;
let tempMarker = null;

const isAddingMode = ref(false);
const newMarkerCoords = ref(null);

const isCropperVisible = ref(false);
const cropperProps = ref({});

const isWidgetActive = computed(() => callStore.isCallActive && !callStore.isFullScreenCallViewVisible);

// ✅ MODIFICATION START: Renamed state for clarity
const isCommentPanelVisible = ref(false);
const selectedLocation = ref(null);
const commentPanelPosition = ref({ top: 0, left: 0 });

const commentPanelStyle = computed(() => ({
  top: `${commentPanelPosition.value.top}px`,
  left: `${commentPanelPosition.value.left}px`,
}));

function closeCommentPanel() {
  isCommentPanelVisible.value = false;
  selectedLocation.value = null;
}
// ✅ MODIFICATION END

const TAG_CONFIG = {
  '美食': { iconFile: 'icons/marker-icon-food.svg' },
  '景点': { iconFile: 'icons/marker-icon-scenery.svg' },
  '购物': { iconFile: 'icons/marker-icon-shopping.svg' },
  '活动': { iconFile: 'icons/marker-icon-activity.svg' },
  '其他': { iconFile: 'icons/marker-icon-other.svg' },
};

const selectedTagFilter = ref('all');
const searchQuery = ref('');
const handleSearchInput = debounce((event) => {
  searchQuery.value = event.target.value;
}, 300);

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

for (const tag in TAG_CONFIG) {
  locationIcons[tag] = L.icon({
    iconUrl: TAG_CONFIG[tag].iconFile,
    shadowUrl: 'icons/marker-shadow.svg',
    iconSize: [25, 41], iconAnchor: [12, 41], popupAnchor: [1, -34], shadowSize: [41, 41]
  });
}

const filteredLocations = computed(() => {
  const locationsByTag = selectedTagFilter.value === 'all'
      ? mapStore.locations
      : mapStore.locations.filter(loc => loc.tag === selectedTagFilter.value);
  const query = searchQuery.value.toLowerCase().trim();
  if (!query) {
    return locationsByTag;
  }
  return locationsByTag.filter(loc =>
      (loc.description && loc.description.toLowerCase().includes(query)) ||
      (loc.tag && loc.tag.toLowerCase().includes(query)) ||
      (loc.createdBy && loc.createdBy.toLowerCase().includes(query))
  );
});

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
    if (isCommentPanelVisible.value) {
      closeCommentPanel();
    } else if (isCropperVisible.value) {
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

watch(filteredLocations, (newLocations) => {
  if (!map || !markersLayer) return;
  markersLayer.clearLayers();

  newLocations.forEach(loc => {
    const icon = locationIcons[loc.tag] || locationIcons.default;
    const marker = L.marker([loc.latitude, loc.longitude], { icon }).addTo(markersLayer);

    // ✅ MODIFICATION START: Bind a click event instead of a popup
    marker.on('click', (e) => {
      L.DomEvent.stopPropagation(e); // Prevent map's click event from firing

      selectedLocation.value = loc;
      isCommentPanelVisible.value = true;

      // Calculate panel position
      const mapContainer = mapContainerRef.value;
      if (!mapContainer) return;
      const point = map.latLngToContainerPoint(e.latlng);
      const panelWidth = 350; // Should match CommentModal width
      const panelHeight = 400; // Should match CommentModal max-height
      const margin = 15;

      let left = point.x + margin;
      let top = point.y - (panelHeight / 2);

      // Adjust if panel goes out of bounds
      if (left + panelWidth > mapContainer.clientWidth) {
        left = point.x - panelWidth - margin;
      }
      if (top < 0) {
        top = margin;
      }
      if (top + panelHeight > mapContainer.clientHeight) {
        top = mapContainer.clientHeight - panelHeight - margin;
      }

      commentPanelPosition.value = { top, left };
    });
    // ✅ MODIFICATION END
  });
}, { deep: true });

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
  // ✅ MODIFICATION START: Close comment panel when clicking on the map background
  if (isCommentPanelVisible.value) {
    closeCommentPanel();
  }
  // ✅ MODIFICATION END

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
  transition: top 0.3s var(--transition-easing), height 0.3s var(--transition-easing);
}
.viewer-backdrop.widget-active {
  top: 50px;
  height: calc(100% - 50px);
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
  justify-content: flex-start;
  align-items: center;
  width: 100%;
  padding: var(--spacing-3) var(--spacing-4);
  border-top: 1px solid var(--color-border);
  flex-shrink: 0;
  gap: var(--spacing-3);
}
.add-mode-hint, .no-results-hint {
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
.map-search-container {
  position: relative;
}
.search-input {
  padding: var(--spacing-1) var(--spacing-2);
  border-radius: var(--border-radius-md);
  border: 1px solid var(--color-border);
  background-color: var(--color-background-elevated);
  width: 200px;
}

/* ✅ MODIFICATION START: Styles for the new comment panel transition */
.comment-panel-fade-enter-active,
.comment-panel-fade-leave-active {
  transition: opacity 0.2s ease, transform 0.2s ease;
}
.comment-panel-fade-enter-from,
.comment-panel-fade-leave-to {
  opacity: 0;
  transform: scale(0.95);
}
/* ✅ MODIFICATION END */
</style>