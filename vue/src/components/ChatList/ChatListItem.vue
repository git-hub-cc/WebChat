<template>
  <div
      class="chat-list-item"
      :class="{ active: isActive, 'special-contact': item.isSpecial, [item.id]: item.isSpecial, 'highlight-new-message': isHighlighted }"
  >
    <Avatar :entity="item" :is-online="isOnline"
            v-motion
            :hovered="{ scale: 1.1 }"
            :tapped="{ scale: 0.9 }"
    />
    <div class="chat-info">
      <div class="info-top">
        <span class="name">{{ item.name }}</span>
        <span class="timestamp">{{ formattedTime }}</span>
      </div>
      <div class="info-bottom">
        <p class="preview">{{ item.lastMessage }}</p>
        <span v-if="item.unread > 0" class="unread-badge">{{ unreadCount }}</span>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, ref, watch } from 'vue';
import { useUserStore } from '@/stores/userStore';
import Avatar from '@/components/Shared/Avatar.vue';
import { formatDate } from '@/utils';

const props = defineProps({
  item: {
    type: Object,
    required: true,
  },
  isActive: {
    type: Boolean,
    default: false,
  },
});

const userStore = useUserStore();
const isHighlighted = ref(false);

const combinedStatus = computed(() => userStore.getContactCombinedStatus(props.item.id));

const isOnline = computed(() => {
  if (props.item.type === 'group') return null;
  return combinedStatus.value.isOnlineDisplay;
});

const formattedTime = computed(() => {
  return props.item.lastTime ? formatDate(new Date(props.item.lastTime)) : '';
});

const unreadCount = computed(() => {
  return props.item.unread > 99 ? '99+' : props.item.unread;
});

watch(
    () => props.item.unread,
    (newUnread, oldUnread) => {
      // Trigger highlight only when a new message arrives (unread count increases)
      // and this chat is not currently active.
      if (newUnread > oldUnread && !props.isActive) {
        isHighlighted.value = true;
        // The animation duration is 0.6s, so we remove the class after it finishes.
        setTimeout(() => {
          isHighlighted.value = false;
        }, 600);
      }
    }
);
</script>

<style scoped>
.chat-list-item {
  display: flex;
  align-items: center;
  padding: var(--spacing-3) var(--spacing-4);
  cursor: pointer;
  transition: background-color var(--transition-duration-normal) ease,
  transform var(--transition-duration-fast) var(--transition-easing);
  height: 72px; /* Fixed height for virtual scroller */
  border-bottom: 1px solid var(--color-border);
  position: relative; /* For the highlight bar */
  overflow: hidden; /* Hide the highlight bar initially */
}

@keyframes highlight-bar {
  0% {
    transform: translateX(-100%);
    opacity: 0.7;
  }
  50% {
    transform: translateX(0);
    opacity: 0.3;
  }
  100% {
    transform: translateX(100%);
    opacity: 0;
  }
}

.chat-list-item.highlight-new-message::before {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  background: linear-gradient(
      to right,
      transparent 20%,
      rgba(var(--color-brand-primary), 0.2) 50%,
      transparent 80%
  );
  animation: highlight-bar 0.6s var(--transition-easing);
  pointer-events: none;
}

.chat-list-item:hover {
  background-color: var(--color-background-hover);
  transform: translateY(-2px);
  box-shadow: var(--shadow-md);
}

.chat-list-item.active { background-color: var(--color-background-active); }

.chat-info {
  flex-grow: 1;
  margin-left: var(--spacing-3);
  overflow: hidden;
  display: flex;
  flex-direction: column;
  justify-content: center;
  /* ✅ MODIFICATION START: Add transition for smooth appearance */
  transition: opacity 0.1s ease-out, transform 0.2s ease-out;
  opacity: 1;
  transform: translateX(0);
  /* ✅ MODIFICATION END */
}
.info-top, .info-bottom { display: flex; justify-content: space-between; align-items: center; }
.info-bottom { margin-top: 2px; }
.name { font-weight: var(--font-weight-semibold); white-space: nowrap; text-overflow: ellipsis; overflow: hidden; flex-grow: 1; }
.active .name { color: var(--color-text-primary); }
.special-contact.active .name { color: var(--character-primary-color) !important; }
.timestamp { font-size: var(--font-size-xs); color: var(--color-text-secondary); flex-shrink: 0; margin-left: var(--spacing-2); }
.preview { font-size: var(--font-size-sm); color: var(--color-text-secondary); white-space: nowrap; text-overflow: ellipsis; overflow: hidden; flex-grow: 1; line-height: 1.4; }
.unread-badge { background-color: var(--color-brand-secondary); color: var(--color-text-on-brand); border-radius: var(--border-radius-pill); padding: 2px 8px; font-size: var(--font-size-xs); font-weight: var(--font-weight-bold); min-width: 20px; text-align: center; flex-shrink: 0; margin-left: var(--spacing-2); }

/* --- ✅ MODIFICATION START: Styles for the collapsed sidebar state --- */
/*
  Use `:deep()` to target the `.sidebar-collapsed` class which is applied on a parent component (`App.vue`).
  This allows us to style this component based on a global layout state.
*/
:deep(.sidebar-collapsed) .chat-list-item {
  justify-content: center; /* Center the avatar horizontally */
  padding: var(--spacing-2) 0; /* Adjust padding for a centered look */
}

:deep(.sidebar-collapsed) .chat-list-item .chat-info {
  /* Instead of `display: none`, use opacity and transform for a smoother transition */
  opacity: 0;
  transform: translateX(-10px);
  pointer-events: none; /* Prevent interaction with hidden elements */
  position: absolute; /* Take it out of the layout flow */
}
/* --- ✅ MODIFICATION END --- */
</style>