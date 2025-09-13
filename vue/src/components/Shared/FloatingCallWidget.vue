<template>
  <transition name="widget-slide-down">
    <div v-if="callStore.isCallActive && !callStore.isFullScreenCallViewVisible" class="floating-call-widget" @click="maximize">
      <div class="widget-info">
        <Avatar v-if="callStore.peerContact" :entity="callStore.peerContact" size="small" />
        <div class="text-info">
          <!-- --- MODIFICATION START: Add screenshare icon --- -->
          <span class="peer-name">
            <span v-if="callStore.isScreenSharing" class="screenshare-icon">🖥️</span>
            {{ callStore.peerContact?.name || '通话中' }}
          </span>
          <!-- --- MODIFICATION END --- -->
          <span class="call-status">{{ callStore.callDurationFormatted }}</span>
        </div>
      </div>
      <div class="widget-controls">
        <IconButton
            :icon="callStore.isAudioMuted ? '🔇' : '🎤'"
            title="静音/取消静音"
            @click.stop="callStore.toggleAudio()"
            class="control-btn"
            :class="{ active: !callStore.isAudioMuted }"
        />
        <button class="end-call-btn" @click.stop="callStore.hangUp()" title="挂断">📞</button>
      </div>
    </div>
  </transition>
</template>

<script setup>
import { useCallStore } from '@/stores/callStore';
import Avatar from '@/components/Shared/Avatar.vue';
import IconButton from '@/components/Shared/IconButton.vue';

const callStore = useCallStore();

const maximize = () => {
  callStore.maximizeCallView();
};
</script>

<style scoped>
.floating-call-widget {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  height: 50px;
  background-color: var(--color-status-success);
  color: white;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 var(--spacing-4);
  z-index: 1300;
  cursor: pointer;
  box-shadow: var(--shadow-md);
}

.widget-info {
  display: flex;
  align-items: center;
  gap: var(--spacing-3);
}

.text-info {
  display: flex;
  flex-direction: column;
}

.peer-name {
  font-weight: var(--font-weight-semibold);
  display: flex;
  align-items: center;
  gap: var(--spacing-2);
}

/* --- MODIFICATION START: Style for screenshare icon --- */
.screenshare-icon {
  font-size: 0.9em;
  opacity: 0.9;
}
/* --- MODIFICATION END --- */

.call-status {
  font-size: var(--font-size-sm);
  opacity: 0.8;
}

.widget-controls {
  display: flex;
  align-items: center;
  gap: var(--spacing-2);
}

.control-btn {
  color: white;
  background-color: rgba(255, 255, 255, 0.1);
}

.control-btn.active {
  background-color: rgba(255, 255, 255, 0.2);
}

.end-call-btn {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  background-color: var(--color-status-danger);
  color: white;
  font-size: 1.2rem;
  transform: rotate(135deg);
  border: none;
  display: flex;
  align-items: center;
  justify-content: center;
}

/*noinspection ALL*/
.widget-slide-down-enter-from,
.widget-slide-down-leave-to {
  transform: translateY(-100%);
}
</style>