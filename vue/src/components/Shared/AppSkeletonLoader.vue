<template>
  <div class="skeleton-root-wrapper">
    <!-- 移动端全局头部骨架 -->
    <div class="mobile-header-skeleton">
      <div class="shimmer-bg circle small"></div>
      <div class="shimmer-bg line long"></div>
      <div class="shimmer-bg circle small"></div>
    </div>

    <!-- ✅ MODIFICATION START: Bind dynamic style for grid-template-columns -->
    <div class="app-container-skeleton" :style="containerStyle">
      <!-- ✅ MODIFICATION END -->
      <!-- 侧边栏骨架 -->
      <aside class="sidebar-container-skeleton">
        <div class="header-skeleton">
          <div class="shimmer-bg circle"></div>
          <div class="shimmer-bg line long"></div>
        </div>
        <div class="tabs-skeleton">
          <div class="shimmer-bg line short"></div>
          <div class="shimmer-bg line short"></div>
          <div class="shimmer-bg line short"></div>
        </div>
        <div class="list-skeleton">
          <div v-for="i in 7" :key="i" class="list-item-skeleton">
            <div class="shimmer-bg circle"></div>
            <div class="text-group">
              <div class="shimmer-bg line"></div>
              <div class="shimmer-bg line short"></div>
            </div>
          </div>
        </div>
      </aside>

      <!-- 主视图骨架 -->
      <main class="main-view-container-skeleton">
        <div class="header-skeleton">
          <div class="shimmer-bg circle"></div>
          <div class="text-group">
            <div class="shimmer-bg line"></div>
            <div class="shimmer-bg line short"></div>
          </div>
          <div class="actions-skeleton">
            <div class="shimmer-bg circle small"></div>
            <div class="shimmer-bg circle small"></div>
            <div class="shimmer-bg circle small"></div>
          </div>
        </div>
        <div class="message-area-skeleton">
          <div class="bubble-skeleton sent"></div>
          <div class="bubble-skeleton sent short"></div>
        </div>
        <div class="input-area-skeleton">
          <div class="shimmer-bg line full"></div>
        </div>
      </main>
    </div>
  </div>
</template>

<script setup>
// ✅ MODIFICATION START: Read sidebar width from localStorage for accurate skeleton layout
import { ref } from 'vue';

// 直接从 localStorage 读取侧边栏宽度，如果不存在则使用默认值 '320'
// 这确保了骨架屏的布局与用户最后一次调整的侧边栏宽度一致
const sidebarWidth = ref(localStorage.getItem('sidebarWidth') || '320');

// 创建一个动态样式对象，用于设置网格布局的列宽
const containerStyle = {
  gridTemplateColumns: `${sidebarWidth.value}px 1fr`
};
// ✅ MODIFICATION END
</script>


<style scoped>
/* 定义闪烁动画 */
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

/* 根包装器，用于定位 */
.skeleton-root-wrapper {
  width: 100%;
  height: 100%;
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
}

/* 主布局骨架 */
.app-container-skeleton {
  display: grid;
  /* ✅ MODIFICATION START: Removed grid-template-columns, now handled by inline style */
  /* grid-template-columns: var(--sidebar-width) 1fr; */
  /* ✅ MODIFICATION END */
  width: 100%;
  height: 100%;
  max-width: var(--max-app-width);
  max-height: 95dvh;
  border-radius: var(--border-radius-lg);
  box-shadow: var(--shadow-lg);
  overflow: hidden;
  background-color: var(--color-background-panel);
}

.sidebar-container-skeleton,
.main-view-container-skeleton {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
}

.main-view-container-skeleton {
  border-left: 1px solid var(--color-border);
}

/* 头部通用骨架 */
.header-skeleton {
  display: flex;
  align-items: center;
  height: var(--header-height);
  padding: 0 var(--spacing-4);
  flex-shrink: 0;
  border-bottom: 1px solid var(--color-border);
  gap: var(--spacing-3);
}

.circle {
  border-radius: 50%;
}

.line {
  border-radius: var(--border-radius-sm);
  height: 1em;
}

.text-group {
  flex-grow: 1;
  display: flex;
  flex-direction: column;
  gap: var(--spacing-2);
}

/* 侧边栏特定骨架 */
.sidebar-container-skeleton .header-skeleton .circle {
  width: 32px;
  height: 32px;
  flex-shrink: 0;
}
.sidebar-container-skeleton .header-skeleton .line.long {
  height: 36px;
  border-radius: var(--border-radius-pill);
}

.tabs-skeleton {
  display: flex;
  justify-content: space-around;
  padding: var(--spacing-3) var(--spacing-2);
  border-bottom: 1px solid var(--color-border);
}
.tabs-skeleton .line.short {
  width: 25%;
  height: 1em;
}

.list-skeleton {
  padding: var(--spacing-2) 0;
}
.list-item-skeleton {
  display: flex;
  align-items: center;
  padding: var(--spacing-3) var(--spacing-4);
  gap: var(--spacing-3);
}
.list-item-skeleton .circle {
  width: 44px;
  height: 44px;
  flex-shrink: 0;
}
.list-item-skeleton .text-group .line { height: 0.8em; width: 70%; }
.list-item-skeleton .text-group .line.short { width: 40%; }

/* 主视图特定骨架 */
.main-view-container-skeleton .header-skeleton .circle {
  width: 44px;
  height: 44px;
  flex-shrink: 0;
}
.main-view-container-skeleton .text-group .line { width: 40%; }
.main-view-container-skeleton .text-group .line.short { width: 25%; }
.actions-skeleton {
  margin-left: auto;
  display: flex;
  gap: var(--spacing-2);
}
.actions-skeleton .circle.small {
  width: 32px;
  height: 32px;
}

.message-area-skeleton {
  flex-grow: 1;
  padding: var(--spacing-4);
  display: flex;
  flex-direction: column;
  gap: var(--spacing-4);
}
.bubble-skeleton {
  border-radius: var(--border-radius-lg);
  height: 40px;
}
.bubble-skeleton.sent {
  align-self: flex-end;
  width: 50%;
  background-color: var(--color-background-hover);
}
.bubble-skeleton.sent.short {
  width: 30%;
}

.input-area-skeleton {
  padding: var(--spacing-3) var(--spacing-4);
  border-top: 1px solid var(--color-border);
}
.input-area-skeleton .line.full {
  width: 100%;
  height: 40px;
  border-radius: var(--border-radius-lg);
}

/* 移动端头部骨架 */
.mobile-header-skeleton {
  display: none;
}


/* 移动端响应式样式 */
@media (max-width: 768px) {
  .mobile-header-skeleton {
    display: flex;
    align-items: center;
    gap: var(--spacing-2);
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    height: 50px;
    padding: 0 var(--spacing-3);
    background-color: var(--color-background-panel);
    border-bottom: 1px solid var(--color-border);
    z-index: 1;
  }
  .mobile-header-skeleton .circle.small {
    width: 32px;
    height: 32px;
    flex-shrink: 0;
  }
  .mobile-header-skeleton .line.long {
    flex-grow: 1;
    height: 36px;
    border-radius: var(--border-radius-pill);
  }

  .app-container-skeleton {
    display: block;
    max-height: 100dvh;
    border-radius: 0;
    padding-top: 50px;
    box-sizing: border-box;
    height: 100dvh;
  }

  .main-view-container-skeleton {
    display: none;
  }

  .sidebar-container-skeleton {
    width: 100%;
  }

  .sidebar-container-skeleton .header-skeleton {
    display: none;
  }
}
</style>