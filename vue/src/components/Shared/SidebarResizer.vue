<template>
  <div class="resizer-handle" @mousedown.prevent="startDrag"></div>
</template>

<script setup>
import { onUnmounted } from 'vue';
import { useUiStore } from '@/stores/uiStore';
import { log } from '@/utils';

const uiStore = useUiStore();

let initialMouseX = 0;
let initialSidebarWidth = 0;

/**
 * Handles the dragging logic on mousemove.
 * This function is NOT throttled to ensure the UI feels perfectly responsive ("跟手").
 * @param {MouseEvent} event - The mousemove event.
 */
function handleDrag(event) {
  // requestAnimationFrame ensures the update is synced with the browser's repaint cycle,
  // making the resizing feel smoother without causing layout thrashing.
  requestAnimationFrame(() => {
    // Calculate the change in mouse position
    const deltaX = event.clientX - initialMouseX;
    // Calculate the new potential width
    const newWidth = initialSidebarWidth + deltaX;

    // Log the dragging action for debugging (optional, can be noisy)
    // log(`[Resizer] Dragging... DeltaX: ${deltaX}, New Width: ${newWidth}`, 'DEBUG');

    // Call the store action to update the width
    uiStore.setSidebarWidth(newWidth);
  });
}

/**
 * Handles the start of a drag operation on mousedown.
 * @param {MouseEvent} event - The mousedown event.
 */
function startDrag(event) {
  log('[Resizer] Drag started.', 'INFO');

  // Store the initial state at the beginning of the drag
  initialMouseX = event.clientX;
  initialSidebarWidth = uiStore.sidebarWidth;

  // Add global listeners to the window to capture mouse movements everywhere
  window.addEventListener('mousemove', handleDrag);
  window.addEventListener('mouseup', stopDrag);

  // Add a class to the body to apply global styles like cursor and user-select
  document.body.classList.add('is-resizing');
}

/**
 * Handles the end of a drag operation on mouseup.
 */
function stopDrag() {
  log('[Resizer] Drag stopped.', 'INFO');

  // Critical: Clean up global event listeners to prevent memory leaks
  window.removeEventListener('mousemove', handleDrag);
  window.removeEventListener('mouseup', stopDrag);

  // Remove the global styling class from the body
  document.body.classList.remove('is-resizing');
}

// Ensure listeners are cleaned up if the component is unmounted during a drag
onUnmounted(() => {
  stopDrag();
});
</script>

<style scoped>
.resizer-handle {
  width: 5px;
  cursor: ew-resize; /* East-West resize cursor */
  background-color: transparent;
  flex-shrink: 0;
  z-index: 10;
  position: relative;
  transition: background-color 0.2s ease-in-out;
}

.resizer-handle::before {
  content: '';
  position: absolute;
  top: 0;
  bottom: 0;
  left: 50%;
  transform: translateX(-50%);
  width: 1px;
  /* ✅ MODIFICATION START: Make the default indicator transparent */
  background-color: transparent;
  /* ✅ MODIFICATION END */
  transition: width 0.2s ease-in-out, background-color 0.2s ease-in-out;
}

/* ✅ MODIFICATION START: Show the indicator ONLY on hover or during active resize */
.resizer-handle:hover::before,
body.is-resizing .resizer-handle::before {
  width: 3px;
  background-color: var(--color-brand-primary);
}
/* ✅ MODIFICATION END */


/* On mobile, the resizer should not be visible or interactive */
@media (max-width: 768px) {
  .resizer-handle {
    display: none;
  }
}
</style>