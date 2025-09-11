<template>
  <div class="spinner" :class="sizeClass"></div>
</template>

<script setup>
import { computed } from 'vue';

// Define a 'size' prop to control the spinner's dimensions.
// It can be 'small' or 'x-small', defaulting to the standard size.
const props = defineProps({
  size: {
    type: String,
    default: '', // 'small', 'x-small'
    validator: (value) => ['', 'small', 'x-small'].includes(value),
  }
});

// Compute the corresponding CSS class based on the size prop.
const sizeClass = computed(() => props.size ? `spinner-${props.size}` : '');
</script>

<style scoped>
/* Default (large) spinner style */
.spinner {
  width: 48px;
  height: 48px;
  border-radius: 50%;
  /* Use CSS variables for colors to respect theme changes */
  border: 5px solid var(--color-background-hover);
  border-top-color: var(--color-brand-primary);
  animation: spin 1s linear infinite;
}

/* Modifier class for a smaller spinner */
.spinner-small {
  width: 24px;
  height: 24px;
  border-width: 3px;
}

/* Modifier class for an extra-small spinner (e.g., for message status) */
.spinner-x-small {
  width: 12px;
  height: 12px;
  border-width: 2px;
}

/* The spinning animation */
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
</style>