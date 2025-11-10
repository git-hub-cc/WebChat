<template>
  <div class="sticker-animation-container" ref="lottieContainer"></div>
</template>

<script setup>
// ✅ MODIFICATION START: Removed defineExpose from import
import { ref, onMounted, onUnmounted, watch } from 'vue';
// ✅ MODIFICATION END
import lottie from 'lottie-web';
import pako from 'pako';

const props = defineProps({
  src: {
    type: String,
    required: true,
  },
  loop: {
    type: Boolean,
    default: false,
  },
});

const lottieContainer = ref(null);
let animationInstance = null;

const loadAnimation = async () => {
  if (animationInstance) {
    animationInstance.destroy();
    animationInstance = null;
  }

  if (lottieContainer.value && props.src) {
    try {
      const response = await fetch(props.src);
      if (!response.ok) {
        throw new Error(`Failed to fetch TGS file: ${response.status} ${response.statusText}`);
      }
      const compressedBuffer = await response.arrayBuffer();
      const decompressedData = pako.inflate(new Uint8Array(compressedBuffer), { to: 'string' });
      const animationData = JSON.parse(decompressedData);

      animationInstance = lottie.loadAnimation({
        container: lottieContainer.value,
        renderer: 'svg',
        loop: props.loop,
        autoplay: props.loop,
        animationData: animationData,
      });

    } catch (error) {
      console.error(`Lottie Error: Could not load or process animation from ${props.src}`, error);
      if (lottieContainer.value) {
        lottieContainer.value.innerHTML = `<span title="${error.message}">⚠️</span>`;
      }
    }
  }
};

// Expose control methods to the parent component
defineExpose({
  /**
   * Plays the animation from the beginning.
   */
  playAnimation() {
    if (animationInstance) {
      // Use goToAndPlay to ensure it always starts from the first frame.
      animationInstance.goToAndPlay(0, true);
    }
  },
  /**
   * Stops the animation and resets it to the first frame.
   */
  stopAnimation() {
    if (animationInstance) {
      // Use stop() which also rewinds to the first frame.
      animationInstance.stop();
    }
  }
});


onMounted(() => {
  const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          loadAnimation();
          observer.disconnect();
        }
      },
      { threshold: 0.1 }
  );

  if (lottieContainer.value) {
    observer.observe(lottieContainer.value);
  }

  onUnmounted(() => {
    observer.disconnect();
  });
});

onUnmounted(() => {
  if (animationInstance) {
    animationInstance.destroy();
  }
});

watch(() => props.src, (newSrc, oldSrc) => {
  if (newSrc && newSrc !== oldSrc) {
    loadAnimation();
  }
});
</script>

<style scoped>
.sticker-animation-container {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
}
.sticker-animation-container span {
  font-size: 2rem;
  opacity: 0.5;
}
</style>