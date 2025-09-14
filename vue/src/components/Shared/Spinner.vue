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
  /* --- [动画] START: 优化边框颜色和动画 --- */
  border: 5px solid rgba(var(--color-brand-primary-rgb), 0.2);
  border-top-color: var(--color-brand-primary);
  animation: spin 0.8s cubic-bezier(0.25, 0.46, 0.45, 0.94) infinite;
  /* --- [动画] END --- */
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