<template>
  <div class="spinner"></div>
</template>

<style scoped>
.spinner {
  width: 48px;
  height: 48px;
  border: 5px solid var(--color-background-hover);
  border-top-color: var(--color-brand-primary);
  border-radius: 50%;
  animation: spin 1s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
</style>