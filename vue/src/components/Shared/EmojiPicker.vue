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
        </div>
        <!-- Sticker Grid -->
        <div v-show="activeTab === 'sticker'" class="sticker-grid scroller">
          <template v-for="(pack, packId) in stickerPacks" :key="packId">
            <div
                v-for="(sticker, index) in pack.stickers"
                :key="sticker.id"
                class="sticker-item-wrapper"
                v-motion
                :initial="{ opacity: 0, y: 10 }"
                :enter="{ opacity: 1, y: 0, transition: { type: 'spring', stiffness: 350, damping: 25, delay: 10 + index * 5 } }"
            >
              <!-- --- ✅ MODIFICATION START: Added mouse events and ref binding --- -->
              <div
                  class="sticker-item"
                  @click="selectSticker(packId, sticker.id)"
                  @mouseenter="handleMouseEnter(packId, sticker.id)"
                  @mouseleave="handleMouseLeave(packId, sticker.id)"
              >
                <AnimatedSticker
                    :src="sticker.file"
                    :ref="(el) => setStickerRef(`${packId}/${sticker.id}`, el)"
                />
              </div>
              <!-- --- ✅ MODIFICATION END --- -->
            </div>
          </template>
        </div>
      </div>
    </div>
  </transition>
</template>

<script setup>
// --- ✅ MODIFICATION START ---
import { ref, onBeforeUpdate } from 'vue';
// --- ✅ MODIFICATION END ---
import { EMOJI_LIST } from '@/config/EmojiList';
import { STICKER_PACKS } from '@/config/stickerPacks';
import AnimatedSticker from './AnimatedSticker.vue';

defineProps({
  show: Boolean,
});
const emit = defineEmits(['select-emoji', 'select-sticker']);

const activeTab = ref('emoji');
const emojiList = EMOJI_LIST;
const stickerPacks = ref(STICKER_PACKS);

// --- ✅ MODIFICATION START: Logic for handling hover animations ---
const stickerRefs = ref(new Map());

// This function is called during render to populate the refs map.
const setStickerRef = (id, el) => {
  if (el) {
    stickerRefs.value.set(id, el);
  }
};

// Before each update, clear the map to remove refs to old, unmounted components.
onBeforeUpdate(() => {
  stickerRefs.value.clear();
});

const handleMouseEnter = (packId, stickerId) => {
  const combinedId = `${packId}/${stickerId}`;
  const stickerComponent = stickerRefs.value.get(combinedId);
  if (stickerComponent) {
    stickerComponent.playAnimation();
  }
};

const handleMouseLeave = (packId, stickerId) => {
  const combinedId = `${packId}/${stickerId}`;
  const stickerComponent = stickerRefs.value.get(combinedId);
  if (stickerComponent) {
    stickerComponent.stopAnimation();
  }
};
// --- ✅ MODIFICATION END ---

function selectEmoji(emoji) {
  emit('select-emoji', emoji);
}

function selectSticker(packId, stickerId) {
  const combinedId = `${packId}/${stickerId}`;
  emit('select-sticker', combinedId);
}
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
  grid-template-columns: repeat(auto-fill, minmax(56px, 1fr));
  gap: var(--spacing-1);
}
.sticker-item-wrapper {
  width: 56px;
  height: 56px;
}

.sticker-item {
  width: 100%;
  height: 100%;
  border-radius: var(--border-radius-md);
  cursor: pointer;
  transition: transform 0.1s ease, background-color 0.1s ease;
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
  position: relative;
  background-color: var(--color-background-elevated);
}

.sticker-item:hover {
  transform: scale(1.05);
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