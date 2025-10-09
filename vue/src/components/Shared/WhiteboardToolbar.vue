<template>
  <div class="whiteboard-toolbar" v-motion-slide-left>
    <div class="tool-group">
      <IconButton
          icon="✒️"
          title="画笔"
          :class="{ active: currentTool === 'pen' }"
          @click="selectTool('pen')"
      />
      <IconButton
          icon="⬜"
          title="矩形"
          :class="{ active: currentTool === 'rect' }"
          @click="selectTool('rect')"
      />
    </div>
    <div class="separator"></div>
    <div class="color-picker-wrapper">
      <input
          type="color"
          :value="currentColor"
          @input="selectColor"
          class="color-picker"
          title="选择颜色"
      />
    </div>
    <div class="separator"></div>
    <div class="action-group">
      <IconButton
          icon="↩️"
          title="撤销"
          @click="$emit('undo')"
      />
      <IconButton
          icon="🗑️"
          title="清空"
          @click="$emit('clear')"
      />
    </div>
  </div>
</template>

<script setup>
import { ref } from 'vue';
import IconButton from './IconButton.vue';

const emit = defineEmits(['tool-selected', 'color-selected', 'undo', 'clear']);

const currentTool = ref('pen');
const currentColor = ref('#FF0000');

function selectTool(tool) {
  currentTool.value = tool;
  emit('tool-selected', tool);
}

function selectColor(event) {
  currentColor.value = event.target.value;
  emit('color-selected', event.target.value);
}
</script>

<style scoped>
.whiteboard-toolbar {
  position: absolute;
  top: 80px;
  right: 20px;
  display: flex;
  flex-direction: column;
  gap: var(--spacing-2);
  background-color: rgba(0, 0, 0, 0.4);
  padding: var(--spacing-2);
  border-radius: var(--border-radius-lg);
  backdrop-filter: blur(5px);
  z-index: 1203;
  box-shadow: var(--shadow-md);
}

.tool-group, .action-group {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-1);
}

.icon-button {
  color: white;
  width: 48px;
  height: 48px;
}

.icon-button:hover {
  background-color: rgba(255, 255, 255, 0.1);
}

.icon-button.active {
  background-color: rgba(255, 255, 255, 0.2);
  border: 1px solid var(--color-brand-primary);
}

.separator {
  height: 1px;
  background-color: rgba(255, 255, 255, 0.2);
  margin: var(--spacing-1) 0;
}

.color-picker-wrapper {
  display: flex;
  justify-content: center;
  align-items: center;
  padding: var(--spacing-1) 0;
}

.color-picker {
  -webkit-appearance: none;
  -moz-appearance: none;
  appearance: none;
  width: 36px;
  height: 36px;
  background: none;
  border: none;
  cursor: pointer;
  padding: 0;
  border-radius: 50%;
  overflow: hidden;
  border: 2px solid white;
}
.color-picker::-webkit-color-swatch-wrapper {
  padding: 0;
}
.color-picker::-webkit-color-swatch {
  border: none;
  border-radius: 50%;
}
</style>