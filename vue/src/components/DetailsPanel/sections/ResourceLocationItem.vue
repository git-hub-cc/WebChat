<template>
  <div class="location-item-wrapper">
    <div class="location-item-icon">📍</div>
    <div class="location-item-info">
      <div class="location-item-sender">{{ senderName }}</div>
      <!-- ✅ FIX START: Use a safe computed property to avoid errors -->
      <div class="location-item-coords">
        {{ formattedCoordinates }}
      </div>
      <!-- ✅ FIX END -->
    </div>
    <div class="location-item-timestamp">{{ formattedTimestamp }}</div>
  </div>
</template>

<script setup>
import { computed } from 'vue';

const props = defineProps({
  item: { type: Object, required: true }
});

const senderName = computed(() => props.item.originalSenderName);

const formattedTimestamp = computed(() => {
  if (!props.item.timestamp) return '';
  return new Date(props.item.timestamp).toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
});

// ✅ FIX START: Create a computed property that safely formats coordinates
const formattedCoordinates = computed(() => {
  // Check if item and its coordinate properties are valid numbers before calling .toFixed()
  if (props.item && typeof props.item.latitude === 'number' && typeof props.item.longitude === 'number') {
    return `${props.item.latitude.toFixed(4)}, ${props.item.longitude.toFixed(4)}`;
  }
  // Return a fallback string if data is invalid, preventing the crash
  return '无效坐标';
});
// ✅ FIX END
</script>

<style scoped>
.location-item-wrapper {
  display: flex;
  align-items: center;
  width: 100%;
  height: 72px;
  padding: var(--spacing-2) var(--spacing-4);
  border-bottom: 1px solid var(--color-border);
  cursor: pointer;
  overflow: hidden;
  position: relative;
  text-align: left;
  transition: background-color 0.2s ease;
  gap: var(--spacing-3);
}

.location-item-wrapper:hover {
  background-color: var(--color-background-hover);
}

.location-item-icon {
  font-size: 2rem;
  opacity: 0.7;
}

.location-item-info {
  display: flex;
  flex-direction: column;
  justify-content: center;
  flex-grow: 1;
  overflow: hidden;
}

.location-item-sender {
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-bold);
  color: var(--color-brand-primary);
  margin-bottom: var(--spacing-1);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.location-item-coords {
  font-size: var(--font-size-sm);
  color: var(--color-text-secondary);
  font-family: var(--font-family-mono);
}

.location-item-timestamp {
  position: absolute;
  top: var(--spacing-2);
  right: var(--spacing-4);
  font-size: var(--font-size-xs);
  color: var(--color-text-tertiary);
}
</style>