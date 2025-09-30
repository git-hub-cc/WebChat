<template>
  <div class="location-item-wrapper">
    <div class="location-item-icon">📍</div>
    <div class="location-item-info">
      <div class="location-item-sender">{{ senderName }}</div>
      <div class="location-item-coords">
        {{ item.latitude.toFixed(4) }}, {{ item.longitude.toFixed(4) }}
      </div>
    </div>
    <div class="location-item-timestamp">{{ formattedTimestamp }}</div>
  </div>
</template>

<script setup>
import { computed } from 'vue';
import { useUserStore } from '@/stores/userStore';

const props = defineProps({
  item: { type: Object, required: true }
});

const userStore = useUserStore();

const senderName = computed(() => {
  return props.item.originalSenderName || userStore.contacts[props.item.sender]?.name || `用户 ${String(props.item.sender).substring(0,4)}`;
});

const formattedTimestamp = computed(() => {
  if (!props.item.timestamp) return '';
  return new Date(props.item.timestamp).toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
});
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