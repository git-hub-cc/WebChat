<template>
  <div class="notification-container">
    <transition-group name="notification-list" tag="div">
      <div
          v-for="notification in notifications"
          :key="notification.id"
          class="notification"
          :class="`notification-${notification.type}`"
      >
        <span class="icon">{{ notificationIcon(notification.type) }}</span>
        <p class="message">{{ notification.message }}</p>
        <button class="close" @click="removeNotification(notification.id)">×</button>
      </div>
    </transition-group>
  </div>
</template>

<script setup>
import { ref, onMounted, onUnmounted } from 'vue';
import { eventBus } from '@/services/eventBus';

const notifications = ref([]);
let idCounter = 0;

const notificationIcon = (type) => {
  const map = { info: 'ℹ️', success: '✅', warning: '⚠️', error: '❌' };
  return map[type] || 'ℹ️';
};

const addNotification = ({ message, type = 'info', duration = 5000 }) => {
  const id = idCounter++;
  notifications.value.push({ id, message, type });
  setTimeout(() => removeNotification(id), duration);
};

const removeNotification = (id) => {
  const index = notifications.value.findIndex(n => n.id === id);
  if (index > -1) {
    notifications.value.splice(index, 1);
  }
};

onMounted(() => {
  eventBus.on('showNotification', addNotification);
});

onUnmounted(() => {
  eventBus.off('showNotification', addNotification);
});
</script>

<style scoped>
.notification-container {
  position: fixed;
  top: var(--spacing-4);
  right: var(--spacing-4);
  z-index: 9999;
  width: 100%;
  max-width: 350px;
}

.notification {
  display: flex;
  align-items: center;
  padding: var(--spacing-3);
  background-color: var(--color-background-panel);
  border-radius: var(--border-radius-md);
  box-shadow: var(--shadow-lg);
  margin-bottom: var(--spacing-3);
  border-left: 4px solid;
}
.notification-info { border-left-color: var(--color-status-info); }
.notification-success { border-left-color: var(--color-status-success); }
.notification-warning { border-left-color: var(--color-status-warning); }
.notification-error { border-left-color: var(--color-status-danger); }

.icon { font-size: 1.2rem; margin-right: var(--spacing-3); }
.message { flex-grow: 1; word-wrap: break-word; }
.close {
  background: none;
  border: none;
  font-size: 1.5rem;
  color: var(--color-text-secondary);
  cursor: pointer;
}

/* Transitions */
</style>