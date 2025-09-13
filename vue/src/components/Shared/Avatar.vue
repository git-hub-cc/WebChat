<template>
  <!-- --- MODIFICATION START: Add speaking indicator class --- -->
  <div class="avatar" :class="[sizeClass, { 'is-special': entity.isSpecial, 'speaking-indicator': isSpeaking }, entity.id]">
    <!-- --- MODIFICATION END --- -->
    <img v-if="entity.avatarUrl" :src="entity.avatarUrl" :alt="avatarText" class="avatar-image">
    <span v-else class="avatar-text">{{ avatarText }}</span>
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
  isOnline: {
    type: Boolean,
    default: false,
  },
  // --- MODIFICATION START: Add isSpeaking prop ---
  isSpeaking: {
    type: Boolean,
    default: false,
  }
  // --- MODIFICATION END ---
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
  /* --- MODIFICATION START: Add transition for speaking indicator --- */
  transition: box-shadow 0.2s ease-in-out;
  /* --- MODIFICATION END --- */
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

/* --- MODIFICATION START: Style for speaking indicator --- */
.speaking-indicator {
  /* Use a box-shadow for a glowing effect that doesn't affect layout */
  box-shadow: 0 0 8px 3px var(--color-status-success);
}
/* --- MODIFICATION END --- */


/* This is where character-specific variables from themes will take effect */
.avatar.is-special {
  background-color: var(--character-primary-color, var(--color-brand-secondary));
  color: var(--character-text-color, white);
  border: 2px solid var(--character-accent-color, transparent);
  box-shadow: 0 0 8px var(--character-glow-color, transparent);
}
/* The speaking indicator shadow should override the character glow */
.avatar.is-special.speaking-indicator {
  box-shadow: 0 0 8px 3px var(--color-status-success);
}

</style>