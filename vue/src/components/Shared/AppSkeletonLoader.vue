<template>
  <div class="skeleton-root-wrapper">
    <!-- ✅ MODIFICATION START: Add a separate skeleton for the mobile global header -->
    <div class="mobile-header-skeleton">
      <div class="shimmer-bg circle small"></div>
      <div class="shimmer-bg line long"></div>
      <div class="shimmer-bg circle small"></div>
    </div>
    <!-- ✅ MODIFICATION END -->

    <div class="app-container-skeleton">
      <!-- Sidebar Skeleton -->
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

      <!-- Main View Skeleton -->
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

/* ✅ MODIFICATION START: Add a root wrapper for positioning context */
.skeleton-root-wrapper {
  width: 100%;
  height: 100%;
  position: relative;
  /* --- FIX START: Center the skeleton container --- */
  display: flex;
  align-items: center;
  justify-content: center;
  /* --- FIX END --- */
}
/* ✅ MODIFICATION END */

/* 主布局骨架 */
.app-container-skeleton {
  display: grid;
  grid-template-columns: var(--sidebar-width) 1fr;
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
.bubble-skeleton.received {
  align-self: flex-start;
  width: 60%;
  background-color: var(--color-background-elevated);
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

/* ✅ MODIFICATION START: Add styles for the mobile header skeleton */
.mobile-header-skeleton {
  display: none; /* Hidden on desktop by default */
}
/* ✅ MODIFICATION END */


/* ✅ MODIFICATION START: Responsive styles for mobile skeleton */
@media (max-width: 768px) {
  /* 1. Show and style the mobile header skeleton */
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

  /* 2. Adjust the main container for mobile */
  .app-container-skeleton {
    display: block; /* Change from grid to block */
    max-height: 100dvh;
    border-radius: 0;
    padding-top: 50px; /* Make space for the fixed header skeleton */
    box-sizing: border-box;
    height: 100dvh;
  }

  /* 3. Hide the main view (chat window) skeleton */
  .main-view-container-skeleton {
    display: none;
  }

  /* 4. Make the sidebar (chat list) skeleton full-width */
  .sidebar-container-skeleton {
    width: 100%;
  }

  /* 5. Hide the original header inside the sidebar skeleton */
  .sidebar-container-skeleton .header-skeleton {
    display: none;
  }
}
/* ✅ MODIFICATION END */
</style>