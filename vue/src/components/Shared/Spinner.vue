<template>
  <div class="spinner" :class="sizeClass"></div>
</template>

<script setup>
import { computed } from 'vue';

const props = defineProps({
  size: {
    type: String,
    // ✅ MODIFICATION: Add 'large' to the default comment
    default: '', // 'small', 'x-small', 'large'
    // ✅ MODIFICATION: Add 'large' to the validator array
    validator: (value) => ['', 'small', 'x-small', 'large'].includes(value),
  }
});

const sizeClass = computed(() => props.size ? `spinner-${props.size}` : '');
</script>

<style scoped>
.spinner {
  width: 48px;
  height: 48px;
  border-radius: 50%;
  border: 5px solid rgba(var(--color-brand-primary), 0.2);
  border-top-color: var(--color-brand-primary);
  animation: spin 0.8s cubic-bezier(0.25, 0.46, 0.45, 0.94) infinite;
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

/* ✅ MODIFICATION START: Add the new .spinner-large style */
.spinner-large {
  width: 72px;
  height: 72px;
  border-width: 6px;
}
/* ✅ MODIFICATION END */

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
</style>