<template>
  <div class="skeleton-wrapper" :style="{ '--base-color': baseColor, '--highlight-color': highlightColor }">
    <div v-if="type === 'list-item'" class="skeleton-list-item">
      <div class="skeleton-avatar"></div>
      <div class="skeleton-text-group">
        <div class="skeleton-line" style="width: 50%;"></div>
        <div class="skeleton-line" style="width: 80%;"></div>
      </div>
    </div>

    <div v-else-if="type === 'profile'" class="skeleton-profile">
      <div class="skeleton-avatar-xl"></div>
      <div class="skeleton-line" style="width: 40%; height: 1.5rem; margin-top: 1rem;"></div>
      <div class="skeleton-line" style="width: 60%; margin-top: 0.5rem;"></div>
      <div class="skeleton-line" style="width: 30%; margin-top: 0.5rem;"></div>
    </div>

    <div v-else-if="type === 'grid'" class="skeleton-grid">
      <div v-for="i in 9" :key="i" class="skeleton-grid-item"></div>
    </div>

    <!-- --- [动画] START: 新增 grid-item 类型 --- -->
    <div v-else-if="type === 'grid-item'" class="skeleton-grid-item-single"></div>
    <!-- --- [动画] END --- -->

    <div v-else class="skeleton-generic">
      <div v-for="i in 3" :key="i" class="skeleton-line" :style="{ width: `${Math.random() * 40 + 50}%` }"></div>
    </div>
  </div>
</template>

<script setup>
defineProps({
  type: {
    type: String,
    default: 'generic', // 'list-item', 'profile', 'grid', 'grid-item', 'generic'
  },
  baseColor: {
    type: String,
    default: 'var(--color-background-hover)',
  },
  highlightColor: {
    type: String,
    default: 'var(--color-background-elevated)',
  },
  // --- [动画] START: 新增 shimmer prop ---
  shimmer: {
    type: Boolean,
    default: true
  }
  // --- [动画] END ---
});
</script>

<style scoped>
@keyframes shimmer {
  100% {
    transform: translateX(100%);
  }
}

.skeleton-wrapper {
  padding: var(--spacing-4);
  width: 100%;
}

.skeleton-line, .skeleton-avatar, .skeleton-avatar-xl, .skeleton-grid-item, .skeleton-grid-item-single {
  background-color: var(--base-color);
  position: relative;
  overflow: hidden;
  border-radius: var(--border-radius-md);
}

.skeleton-line::after, .skeleton-avatar::after, .skeleton-avatar-xl::after, .skeleton-grid-item::after, .skeleton-grid-item-single::after {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  transform: translateX(-100%);
  background-image: linear-gradient(90deg,
  rgba(255, 255, 255, 0) 0,
  var(--highlight-color) 40%,
  rgba(255, 255, 255, 0) 80%
  );
  /* --- [动画] START: 根据 prop 控制动画 --- */
  animation: shimmer 1.5s infinite;
  /* --- [动画] END --- */
}

/* --- [动画] START: 新增 grid-item-single 样式 --- */
.skeleton-grid-item-single {
  width: 100%;
  height: 100%;
}
/* --- [动画] END --- */


.skeleton-list-item {
  display: flex;
  align-items: center;
  gap: var(--spacing-3);
  padding: var(--spacing-2) 0;
}

.skeleton-avatar {
  width: 44px;
  height: 44px;
  border-radius: 50%;
  flex-shrink: 0;
}

.skeleton-text-group {
  flex-grow: 1;
  display: flex;
  flex-direction: column;
  gap: var(--spacing-2);
}

.skeleton-line {
  height: 0.8rem;
}

.skeleton-profile {
  display: flex;
  flex-direction: column;
  align-items: center;
}

.skeleton-avatar-xl {
  width: 80px;
  height: 80px;
  border-radius: 50%;
}

.skeleton-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: var(--spacing-2);
}

.skeleton-grid-item {
  aspect-ratio: 1 / 1;
}

.skeleton-generic {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-3);
}
</style>