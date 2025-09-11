<template>
  <div class="avatar" :class="[sizeClass, { 'is-special': entity.isSpecial }, entity.id]">
    <img v-if="entity.avatarUrl" :src="entity.avatarUrl" :alt="avatarText" class="avatar-image">
    <span v-else class="avatar-text">{{ avatarText }}</span>
    <!-- MODIFICATION: isOnline prop is now the single source of truth for online dot visibility -->
    <span v-if="isOnline" class="online-dot"></span>
  </div>
</template>

<script setup>
import { computed } from 'vue';
import { useSettingsStore } from '@/stores/settingsStore';

const props = defineProps({
  entity: {
    type: Object,
    required: true,
  },
  size: {
    type: String,
    default: 'medium', // 'small', 'medium', 'large', 'xl'
  },
  // MODIFICATION: isOnline is now directly passed as a boolean, no internal logic
  isOnline: {
    type: Boolean,
    default: false,
  }
});

const settingsStore = useSettingsStore();

const sizeClass = computed(() => `avatar-${props.size}`);

const avatarText = computed(() => {
  return props.entity.avatarText || props.entity.name?.charAt(0).toUpperCase() || '?';
});

</script>

<style scoped>
.avatar {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  background-color: var(--color-brand-secondary);
  color: white;
  font-weight: var(--font-weight-bold);
  flex-shrink: 0;
  user-select: none;
}
.avatar-small { width: 32px; height: 32px; font-size: 0.875rem; }
.avatar-medium { width: 44px; height: 44px; font-size: 1.125rem; }
.avatar-large { width: 56px; height: 56px; font-size: 1.5rem; }
.avatar-xl { width: 80px; height: 80px; font-size: 2.5rem; }


.avatar-image {
  width: 100%;
  height: 100%;
  border-radius: 50%;
  object-fit: cover;
}

.online-dot {
  position: absolute;
  bottom: 0;
  right: 0;
  width: 12px;
  height: 12px;
  background-color: var(--color-status-success);
  border: 2px solid var(--color-background-panel);
  border-radius: 50%;
}
.avatar-large .online-dot, .avatar-xl .online-dot {
  width: 15px;
  height: 15px;
}

/* This is where character-specific variables from themes will take effect */
.avatar.is-special {
  background-color: var(--character-primary-color, var(--color-brand-secondary));
  color: var(--character-text-color, white);
  border: 2px solid var(--character-accent-color, transparent);
  box-shadow: 0 0 8px var(--character-glow-color, transparent);
}
</style>