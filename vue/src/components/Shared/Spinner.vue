<template>
  <div class="spinner" :class="sizeClass"></div>
</template>

<script setup>
import { computed } from 'vue';

const props = defineProps({
  size: {
    type: String,
    default: '', // 'small', 'x-small'
    validator: (value) => ['', 'small', 'x-small'].includes(value),
  }
});

const sizeClass = computed(() => props.size ? `spinner-${props.size}` : '');
</script>

<style scoped>
.spinner {
  width: 48px;
  height: 48px;
  border-radius: 50%;
  border: 5px solid var(--color-background-hover);
  border-top-color: var(--color-brand-primary);
  animation: spin 1s linear infinite;
}

.spinner-small {
  width: 24px;
  height: 24px;
  border-width: 3px;
}

.spinner-x-small {
  width: 12px;
  height: 12px;
  border-width: 2px;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
</style>