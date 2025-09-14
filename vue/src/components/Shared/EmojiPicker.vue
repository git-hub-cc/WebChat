<template>
  <transition name="picker-fade">
    <div v-if="show" class="picker-container" @click.stop>
      <nav class="picker-tabs">
        <button :class="{ active: activeTab === 'emoji' }" @click="activeTab = 'emoji'" title="表情">😀</button>
        <button :class="{ active: activeTab === 'sticker' }" @click="activeTab = 'sticker'" title="贴图">🎨</button>
      </nav>
      <div class="picker-content">
        <!-- Emoji Grid -->
        <div v-show="activeTab === 'emoji'" class="emoji-grid scroller">
          <!-- --- [动画] START: 为每个表情添加交错动画 --- -->
          <span
              v-for="(emoji, index) in emojiList"
              :key="emoji"
              @click="selectEmoji(emoji)"
              class="emoji-item"
              v-motion
              :initial="{ opacity: 0, y: 10 }"
              :enter="{ opacity: 1, y: 0, transition: { type: 'spring', stiffness: 350, damping: 25, delay: 10 + index * 5 } }"
          >
            {{ emoji }}
          </span>
          <!-- --- [动画] END --- -->
        </div>
        <!-- Sticker Grid -->
        <div v-show="activeTab === 'sticker'" class="sticker-grid scroller">
          <!-- --- [动画] START: 为每个贴图添加交错动画 --- -->
          <div
              v-for="(sticker, index) in stickers"
              :key="sticker.id"
              class="sticker-item-wrapper"
              v-motion
              :initial="{ opacity: 0, y: 10 }"
              :enter="{ opacity: 1, y: 0, transition: { type: 'spring', stiffness: 350, damping: 25, delay: 10 + index * 5 } }"
          >
            <div class="sticker-item" @click="selectSticker(sticker)">
              <div v-if="!sticker.url" class="sticker-placeholder"></div>
              <img v-if="sticker.url" :src="sticker.url" :alt="sticker.name" loading="lazy">
            </div>
          </div>
          <!-- --- [动画] END --- -->
          <label class="add-sticker-button" title="添加新贴图">
            +
            <input type="file" @change="handleStickerUpload" accept="image/png, image/jpeg, image/gif, image/webp" hidden>
          </label>
        </div>
      </div>
    </div>
  </transition>
</template>

<script setup>
import { ref, onUnmounted, watch } from 'vue';
import { EMOJI_LIST } from '@/config/EmojiList';
import { mediaService } from '@/services/mediaService';
import { dbService } from '@/services/dbService';

const props = defineProps({
  show: Boolean,
});
const emit = defineEmits(['select-emoji', 'select-sticker']);

const activeTab = ref('emoji');
const emojiList = EMOJI_LIST;
const stickers = ref([]);

let objectUrls = new Map();

async function loadStickers() {
  objectUrls.forEach(URL.revokeObjectURL);
  objectUrls.clear();

  const storedStickers = await dbService.getAllItems('stickers');
  stickers.value = storedStickers.map(s => {
    const url = URL.createObjectURL(s.blob);
    objectUrls.set(s.id, url);
    return { ...s, url };
  });
}

async function handleStickerUpload(event) {
  const file = event.target.files[0];
  if (!file) return;
  const newStickerData = await mediaService.processStickerFile(file);
  if (newStickerData) {
    const url = URL.createObjectURL(newStickerData.blob);
    objectUrls.set(newStickerData.id, url);
    stickers.value.push({ ...newStickerData, url });
  }
  event.target.value = '';
}

function selectEmoji(emoji) {
  emit('select-emoji', emoji);
}

function selectSticker(sticker) {
  emit('select-sticker', sticker);
}

watch(() => props.show, (isVisible) => {
  if (isVisible) {
    loadStickers();
  }
});

onUnmounted(() => {
  objectUrls.forEach(URL.revokeObjectURL);
});
</script>

<style scoped>
.picker-container {
  position: absolute;
  bottom: calc(100% + var(--spacing-2));
  left: 0;
  width: 320px;
  height: 300px;
  background-color: var(--color-background-panel);
  border: 1px solid var(--color-border);
  border-radius: var(--border-radius-lg);
  box-shadow: var(--shadow-lg);
  z-index: 50;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.picker-tabs {
  display: flex;
  flex-shrink: 0;
  border-bottom: 1px solid var(--color-border);
}
.picker-tabs button {
  flex: 1;
  padding: var(--spacing-2);
  font-size: 1.2rem;
  opacity: 0.6;
  transition: background-color 0.2s ease, opacity 0.2s ease;
}
.picker-tabs button.active {
  background-color: var(--color-background-hover);
  opacity: 1;
}

.picker-content {
  flex-grow: 1;
  overflow: hidden;
}

.scroller {
  height: 100%;
  overflow-y: auto;
  padding: var(--spacing-2);
}

.emoji-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(32px, 1fr));
  gap: var(--spacing-1);
}
.emoji-item {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 32px;
  border-radius: var(--border-radius-md);
  cursor: pointer;
  font-size: 1.5rem;
  transition: background-color 0.1s ease;
}
.emoji-item:hover {
  background-color: var(--color-background-hover);
}

.sticker-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(70px, 1fr));
  gap: var(--spacing-2);
}
/* --- MODIFICATION START: Styles for sticker placeholder and wrapper --- */
.sticker-item-wrapper {
  width: 70px;
  height: 70px;
}

.sticker-item {
  width: 100%;
  height: 100%;
  border-radius: var(--border-radius-md);
  cursor: pointer;
  transition: transform 0.1s ease;
  overflow: hidden; /* Important for placeholder */
  display: flex;
  align-items: center;
  justify-content: center;
  position: relative; /* For placeholder positioning */
}

.sticker-placeholder {
  position: absolute;
  inset: 0;
  background-color: var(--color-background-elevated);
  border: 1px solid var(--color-border);
  border-radius: var(--border-radius-md);
}

.sticker-item:hover {
  transform: scale(1.05);
}
.sticker-item img {
  max-width: 90%;
  max-height: 90%;
  object-fit: contain;
  position: relative; /* Ensure it's on top of the placeholder */
  z-index: 1;
}
/* --- MODIFICATION END --- */

.add-sticker-button {
  width: 70px;
  height: 70px;
  border-radius: var(--border-radius-md);
  background-color: var(--color-background-elevated);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  font-size: 2rem;
  color: var(--color-text-secondary);
  border: 2px dashed var(--color-border);
}
.add-sticker-button:hover {
  background-color: var(--color-background-hover);
}

.picker-fade-enter-active,
.picker-fade-leave-active {
  transition: all 0.2s ease;
}
.picker-fade-enter-from,
.picker-fade-leave-to {
  opacity: 0;
  transform: translateY(10px);
}
</style>