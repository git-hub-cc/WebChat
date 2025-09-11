<template>
  <div class="chat-list-item" :class="{ active: isActive, 'special-contact': item.isSpecial, [item.id]: item.isSpecial }">
    <Avatar :entity="item" :is-online="isOnline" />
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
import { computed } from 'vue';
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

// MODIFICATION: Use the centralized getter for online status
const combinedStatus = computed(() => userStore.getContactCombinedStatus(props.item.id));

const isOnline = computed(() => {
  if (props.item.type === 'group') return null; // Group never shows online dot
  return combinedStatus.value.isOnlineDisplay;
});

const formattedTime = computed(() => {
  return props.item.lastTime ? formatDate(new Date(props.item.lastTime)) : '';
});

const unreadCount = computed(() => {
  return props.item.unread > 99 ? '99+' : props.item.unread;
});

</script>

<style scoped>
.chat-list-item {
  display: flex;
  align-items: center;
  padding: var(--spacing-3) var(--spacing-4);
  cursor: pointer;
  transition: background-color var(--transition-duration-fast) ease;
  height: 72px; /* Fixed height for virtual scroller */
  border-bottom: 1px solid var(--color-border);
}
.chat-list-item:hover { background-color: var(--color-background-hover); }
.chat-list-item.active { background-color: var(--color-background-active); }
.chat-info { flex-grow: 1; margin-left: var(--spacing-3); overflow: hidden; display: flex; flex-direction: column; justify-content: center; }
.info-top, .info-bottom { display: flex; justify-content: space-between; align-items: center; }
.info-bottom { margin-top: 2px; }
.name { font-weight: var(--font-weight-semibold); white-space: nowrap; text-overflow: ellipsis; overflow: hidden; flex-grow: 1; }
.active .name { color: var(--color-text-primary); }
.special-contact.active .name { color: var(--character-primary-color) !important; }
.timestamp { font-size: var(--font-size-xs); color: var(--color-text-secondary); flex-shrink: 0; margin-left: var(--spacing-2); }
.preview { font-size: var(--font-size-sm); color: var(--color-text-secondary); white-space: nowrap; text-overflow: ellipsis; overflow: hidden; flex-grow: 1; line-height: 1.4; }
.unread-badge { background-color: var(--color-brand-secondary); color: var(--color-text-on-brand); border-radius: var(--border-radius-pill); padding: 2px 8px; font-size: var(--font-size-xs); font-weight: var(--font-weight-bold); min-width: 20px; text-align: center; flex-shrink: 0; margin-left: var(--spacing-2); }
</style>