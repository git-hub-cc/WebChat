<template>
  <div class="modal-container-skeleton">
    <header class="modal-header-skeleton">
      <div class="shimmer-bg line title"></div>
      <div class="shimmer-bg circle small"></div>
    </header>
    <main class="modal-body-skeleton">
      <nav class="tabs-skeleton">
        <div class="shimmer-bg line short"></div>
        <div class="shimmer-bg line short"></div>
        <div class="shimmer-bg line short"></div>
        <div class="shimmer-bg line short"></div>
      </nav>
      <div class="content-skeleton">
        <div v-for="i in 4" :key="i" class="setting-item-skeleton">
          <div class="shimmer-bg line label"></div>
          <div class="shimmer-bg line input"></div>
        </div>
      </div>
    </main>
  </div>
</template>

<style scoped>
/* 使用与 AppSkeletonLoader 相同的闪烁动画和基础样式 */
@keyframes shimmer {
  100% {
    transform: translateX(100%);
  }
}

.shimmer-bg {
  background-color: var(--color-background-hover);
  position: relative;
  overflow: hidden;
}

.shimmer-bg::after {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  transform: translateX(-100%);
  background-image: linear-gradient(
      90deg,
      rgba(255, 255, 255, 0) 0,
      var(--color-background-elevated) 40%,
      rgba(255, 255, 255, 0) 80%
  );
  animation: shimmer 1.5s infinite;
}

.circle {
  border-radius: 50%;
}

.line {
  border-radius: var(--border-radius-sm);
  height: 1em;
}

/* 模态框骨架特定样式 */
.modal-container-skeleton {
  background: var(--color-background-panel);
  border-radius: var(--border-radius-lg);
  box-shadow: var(--shadow-lg);
  width: 90vw;
  max-width: 500px;
  max-height: 90vh;
  display: flex;
  flex-direction: column;
}

.modal-header-skeleton {
  padding: var(--spacing-4);
  border-bottom: 1px solid var(--color-border);
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-shrink: 0;
}
.modal-header-skeleton .line.title {
  width: 40%;
  height: 1.5rem;
}
.modal-header-skeleton .circle.small {
  width: 24px;
  height: 24px;
}

.modal-body-skeleton {
  padding: var(--spacing-4);
  overflow: hidden;
}

.tabs-skeleton {
  display: flex;
  gap: var(--spacing-4);
  margin-bottom: var(--spacing-4);
  border-bottom: 1px solid var(--color-border);
  padding-bottom: var(--spacing-3);
}
.tabs-skeleton .line.short {
  width: 20%;
  height: 1.2em;
}

.content-skeleton {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-4);
}
.setting-item-skeleton {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--spacing-4);
}
.setting-item-skeleton .line.label {
  width: 30%;
  height: 0.9em;
}
.setting-item-skeleton .line.input {
  width: 60%;
  height: 2.5em;
}
</style>