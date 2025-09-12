<template>
  <button class="icon-button" :title="title" :disabled="disabled">
    <span class="icon">{{ icon }}</span>
  </button>
</template>

<script setup>
defineProps({
  icon: String,
  title: String,
  disabled: Boolean,
});
</script>

<style scoped>
.icon-button {
  width: 40px;
  height: 40px;
  border-radius: 50%;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 1.5rem;
  color: var(--color-text-secondary);
  /* --- MODIFICATION START --- */
  transition: background-color var(--transition-duration-fast) ease,
  color var(--transition-duration-fast) ease,
  transform var(--transition-duration-fast) ease;
  /* --- MODIFICATION END --- */
  flex-shrink: 0;
}
.icon-button .icon {
  line-height: 1; /* Aligns emoji better */
}

/* --- MODIFICATION START --- */
.icon-button:hover:not(:disabled) {
  background-color: var(--color-background-hover);
  color: var(--color-text-primary);
  transform: scale(1.1);
}
/* --- MODIFICATION END --- */
.icon-button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
</style>