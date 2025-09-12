<template>
  <transition name="mention-fade">
    <div v-if="show && suggestions.length" class="mention-list">
      <div
          v-for="user in suggestions"
          :key="user.id"
          class="mention-item"
          @click="selectUser(user)"
      >
        <Avatar :entity="user" size="small" />
        <span class="mention-name">{{ user.name }}</span>
      </div>
    </div>
  </transition>
</template>

<script setup>
import Avatar from '@/components/Shared/Avatar.vue';

const props = defineProps({
  show: Boolean,
  suggestions: {
    type: Array,
    default: () => []
  }
});

const emit = defineEmits(['select']);

function selectUser(user) {
  emit('select', user);
}
</script>

<style scoped>
.mention-list {
  position: absolute;
  bottom: 100%;
  left: 0;
  right: 0;
  background-color: var(--color-background-panel);
  border: 1px solid var(--color-border);
  border-bottom: none;
  border-radius: var(--border-radius-lg) var(--border-radius-lg) 0 0;
  box-shadow: var(--shadow-md);
  max-height: 200px;
  overflow-y: auto;
  z-index: 50;
}

.mention-item {
  display: flex;
  align-items: center;
  padding: var(--spacing-2) var(--spacing-3);
  cursor: pointer;
  transition: background-color 0.1s ease;
}

.mention-item:hover {
  background-color: var(--color-background-hover);
}

.mention-name {
  margin-left: var(--spacing-2);
  font-weight: var(--font-weight-medium);
}

</style>