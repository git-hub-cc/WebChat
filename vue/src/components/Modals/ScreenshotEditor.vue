<template>
  <!-- ✅ MODIFICATION START: Update v-if condition and remove redundant animation directive -->
  <div v-if="uiStore.activeOverlayModal === 'screenshotEditor'" class="editor-backdrop">
    <!-- ✅ MODIFICATION END -->
    <header class="editor-toolbar">
      <IconButton
          icon="✂️"
          title="裁剪"
          :class="{ active: currentTool === 'crop' }"
          @click="activateTool('crop')"
      />
      <IconButton
          icon="⬜"
          title="矩形标记"
          :class="{ active: currentTool === 'drawRect' }"
          @click="activateTool('drawRect')"
      />
      <input
          v-if="currentTool === 'drawRect'"
          type="color"
          v-model="markColor"
          class="color-picker"
          title="选择标记颜色"
      />
      <div class="spacer"></div>
      <button class="btn-confirm" @click="confirmEdit">完成</button>
      <button class="btn-cancel" @click="cancelEdit">取消</button>
    </header>
    <div class="canvas-container">
      <canvas ref="canvasRef" @mousedown="handleMouseDown"></canvas>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, onUnmounted, nextTick } from 'vue';
import { eventBus } from '@/services/eventBus';
import { generateHash } from '@/utils';
import { useUiStore } from '@/stores/uiStore';
import IconButton from '@/components/Shared/IconButton.vue';
import AppSettings from '@/config/AppSettings';

const uiStore = useUiStore();
const canvasRef = ref(null);
const ctx = ref(null);
const rawImage = ref(null);
const originalStream = ref(null);
const currentTool = ref(null);
const markColor = ref(AppSettings.ui.screenshotEditor.defaultMarkColor);
const marks = ref([]);
const cropRect = ref(null);

const isDrawing = ref(false);
const startPos = ref({ x: 0, y: 0 });
const currentPos = ref({ x: 0, y: 0 });

onMounted(() => {
  const screenshotData = uiStore.modalPrefillData;
  if (screenshotData && screenshotData.dataUrl) {
    initializeEditor(screenshotData);
  }

  window.addEventListener('mousemove', handleMouseMove);
  window.addEventListener('mouseup', handleMouseUp);
});

onUnmounted(() => {
  window.removeEventListener('mousemove', handleMouseMove);
  window.removeEventListener('mouseup', handleMouseUp);
  closeEditor(false);
});

function initializeEditor({ dataUrl, blob, originalStream: stream }) {
  const img = new Image();
  img.onload = () => {
    rawImage.value = img;
    originalStream.value = stream;

    nextTick(() => {
      const canvas = canvasRef.value;
      if (canvas) {
        ctx.value = canvas.getContext('2d');
        canvas.width = img.width;
        canvas.height = img.height;
        activateTool('crop');
        URL.revokeObjectURL(dataUrl);
      }
    });
  };
  img.src = dataUrl;
}

function activateTool(tool) {
  currentTool.value = tool;
  redrawCanvas();
}

function getCanvasCoordinates(event) {
  const canvas = canvasRef.value;
  if (!canvas) return { x: 0, y: 0 };
  const rect = canvas.getBoundingClientRect();
  return {
    x: (event.clientX - rect.left) * (canvas.width / rect.width),
    y: (event.clientY - rect.top) * (canvas.height / rect.height),
  };
}

function handleMouseDown(event) {
  isDrawing.value = true;
  startPos.value = getCanvasCoordinates(event);
  currentPos.value = startPos.value;
}

function handleMouseMove(event) {
  if (!isDrawing.value) return;
  currentPos.value = getCanvasCoordinates(event);
  redrawCanvas();
}

function handleMouseUp() {
  if (!isDrawing.value) return;
  isDrawing.value = false;

  const rect = {
    x: Math.min(startPos.value.x, currentPos.value.x),
    y: Math.min(startPos.value.y, currentPos.value.y),
    w: Math.abs(startPos.value.x - currentPos.value.x),
    h: Math.abs(startPos.value.y - currentPos.value.y),
  };

  if (rect.w < 5 || rect.h < 5) {
    if (currentTool.value === 'crop') cropRect.value = null;
    redrawCanvas();
    return;
  }

  if (currentTool.value === 'crop') {
    cropRect.value = rect;
  } else if (currentTool.value === 'drawRect') {
    marks.value.push({ type: 'rect', ...rect, color: markColor.value });
  }

  redrawCanvas();
}

function redrawCanvas() {
  const canvas = canvasRef.value;
  if (!canvas || !ctx.value || !rawImage.value) return;

  ctx.value.clearRect(0, 0, canvas.width, canvas.height);
  ctx.value.drawImage(rawImage.value, 0, 0);

  if (cropRect.value) {
    ctx.value.fillStyle = 'rgba(0, 0, 0, 0.5)';
    ctx.value.fillRect(0, 0, canvas.width, canvas.height);
    ctx.value.drawImage(rawImage.value, cropRect.value.x, cropRect.value.y, cropRect.value.w, cropRect.value.h, cropRect.value.x, cropRect.value.y, cropRect.value.w, cropRect.value.h);
  }

  marks.value.forEach(mark => {
    ctx.value.strokeStyle = mark.color;
    ctx.value.lineWidth = AppSettings.ui.screenshotEditor.defaultMarkLineWidth;
    ctx.value.strokeRect(mark.x, mark.y, mark.w, mark.h);
  });

  if (cropRect.value) {
    ctx.value.strokeStyle = 'rgba(255, 255, 255, 0.9)';
    ctx.value.lineWidth = 2;
    ctx.value.strokeRect(cropRect.value.x, cropRect.value.y, cropRect.value.w, cropRect.value.h);
  }

  if (isDrawing.value) {
    const rect = {
      x: Math.min(startPos.value.x, currentPos.value.x),
      y: Math.min(startPos.value.y, currentPos.value.y),
      w: Math.abs(startPos.value.x - currentPos.value.x),
      h: Math.abs(startPos.value.y - currentPos.value.y),
    };
    if (currentTool.value === 'crop') {
      ctx.value.strokeStyle = 'rgba(255, 255, 255, 0.9)';
      ctx.value.lineWidth = 2;
      ctx.value.strokeRect(rect.x, rect.y, rect.w, rect.h);
    } else if (currentTool.value === 'drawRect') {
      ctx.value.strokeStyle = markColor.value;
      ctx.value.lineWidth = AppSettings.ui.screenshotEditor.defaultMarkLineWidth;
      ctx.value.strokeRect(rect.x, rect.y, rect.w, rect.h);
    }
  }
}

function closeEditor(emitCancelEvent = true) {
  if (emitCancelEvent) {
    eventBus.emit('screenshot:editing-cancelled');
  }
  // ✅ MODIFICATION START: Call the correct store action
  uiStore.hideOverlayModal();
  // ✅ MODIFICATION END
  if (originalStream.value) {
    originalStream.value.getTracks().forEach(track => track.stop());
  }
  rawImage.value = null;
  originalStream.value = null;
  marks.value = [];
  cropRect.value = null;
}

function cancelEdit() {
  closeEditor(true);
}

async function confirmEdit() {
  const finalCanvas = document.createElement('canvas');
  const finalCtx = finalCanvas.getContext('2d');

  const sourceRect = cropRect.value || { x: 0, y: 0, w: rawImage.value.width, h: rawImage.value.height };

  finalCanvas.width = sourceRect.w;
  finalCanvas.height = sourceRect.h;

  finalCtx.drawImage(
      rawImage.value,
      sourceRect.x, sourceRect.y, sourceRect.w, sourceRect.h,
      0, 0, sourceRect.w, sourceRect.h
  );

  marks.value.forEach(mark => {
    const relativeX = mark.x - sourceRect.x;
    const relativeY = mark.y - sourceRect.y;
    finalCtx.strokeStyle = mark.color;
    finalCtx.lineWidth = AppSettings.ui.screenshotEditor.defaultMarkLineWidth;
    finalCtx.strokeRect(relativeX, relativeY, mark.w, mark.h);
  });

  finalCanvas.toBlob(async (blob) => {
    if (!blob) {
      eventBus.emit('showNotification', { message: '处理截图失败', type: 'error' });
      closeEditor(true);
      return;
    }
    const hash = await generateHash(blob);
    const fileObject = {
      blob, hash,
      name: `screenshot-${Date.now()}.png`,
      fileType: 'image/png',
      size: blob.size
    };
    eventBus.emit('screenshot:editing-complete', fileObject);
    closeEditor(false);
  }, 'image/png');
}
</script>

<style scoped>
/* Styles remain unchanged */
.editor-backdrop { position: fixed; inset: 0; background-color: rgba(0, 0, 0, 0.85); z-index: 1100; display: flex; flex-direction: column; }
.editor-toolbar { display: flex; align-items: center; padding: var(--spacing-2); background-color: #333; flex-shrink: 0; }
.color-picker { -webkit-appearance: none; -moz-appearance: none; appearance: none; width: 30px; height: 30px; border: none; cursor: pointer; background: none; padding: 0; border-radius: 50%; overflow: hidden; border: 2px solid white; }
.color-picker::-webkit-color-swatch-wrapper { padding: 0; }
.color-picker::-webkit-color-swatch { border: none; border-radius: 50%; }
.spacer { flex-grow: 1; }
.btn-confirm, .btn-cancel { padding: var(--spacing-2) var(--spacing-4); border-radius: var(--border-radius-md); margin-left: var(--spacing-2); font-weight: var(--font-weight-medium); }
.btn-confirm { background-color: var(--color-status-success); color: white; }
.btn-cancel { background-color: var(--color-background-elevated); color: var(--color-text-primary); }
.canvas-container { flex-grow: 1; display: flex; align-items: center; justify-content: center; padding: var(--spacing-4); overflow: auto; }
canvas { max-width: 100%; max-height: 100%; object-fit: contain; cursor: crosshair; }

/* The v-motion-fade directive handles the transition, so custom classes are not needed. */
/*
.editor-fade-enter-active, .editor-fade-leave-active { transition: opacity 0.3s ease; }
.editor-fade-enter-from, .editor-fade-leave-to { opacity: 0; }
*/
</style>