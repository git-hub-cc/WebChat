<template>
  <header class="chat-header" v-if="chatInfo" :class="{ 'character-active': chatInfo.isSpecial }">
    <!-- Back button for mobile -->
    <IconButton
        icon="←"
        title="返回列表"
        class="back-button"
        @click="uiStore.isChatViewActiveOnMobile = false"
    />

    <div class="chat-info" @click="uiStore.toggleDetailsPanel(true, 'info')">
      <Avatar :entity="chatInfo" :is-online="isOnline" />
      <div class="chat-details">
        <h1 class="chat-title">{{ chatInfo.name }}</h1>
        <p class="chat-status" :class="statusClass">{{ statusText }}</p>
      </div>
    </div>
    <div class="chat-actions">
      <IconButton icon="📹" title="视频通话" :disabled="!canCall" />
      <IconButton icon="🎤" title="语音通话" :disabled="!canCall" />
      <IconButton icon="🖥️" title="屏幕共享" :disabled="!canCall" />
      <IconButton icon="👥" title="人员大厅" @click="uiStore.toggleDetailsPanel(true, 'lobby')" />
    </div>
  </header>
</template>

<script setup>
import { computed } from 'vue';
import { useChatStore } from '@/stores/chatStore';
import { useUserStore } from '@/stores/userStore';
import { useUiStore } from '@/stores/uiStore';
import { useGroupStore } from '@/stores/groupStore';
import Avatar from '@/components/Shared/Avatar.vue';
import IconButton from '@/components/Shared/IconButton.vue';

const chatStore = useChatStore();
const userStore = useUserStore();
const groupStore = useGroupStore();
const uiStore = useUiStore();

const chatInfo = computed(() => {
  const chatId = chatStore.currentChatId;
  if (!chatId) return null;
  return userStore.contacts[chatId] || groupStore.groups[chatId];
});

const contactStatus = computed(() => {
  if (!chatInfo.value || chatInfo.value.type === 'group') return null;
  // Use the centralized getter from the user store
  return userStore.getContactStatus(chatInfo.value);
});

const isOnline = computed(() => {
  if (!chatInfo.value || chatInfo.value.type === 'group') return false;
  // The Avatar's online dot reflects the status from the getter
  return contactStatus.value?.className === 'online';
});

const canCall = computed(() => {
  return chatInfo.value && chatInfo.value.type !== 'group' && !chatInfo.value.isAI && !chatInfo.value.isSpecial && isOnline.value;
});

const statusText = computed(() => {
  if (!chatInfo.value) return '';
  if (chatInfo.value.type === 'group') {
    return `${chatInfo.value.members.length} 名成员`;
  }
  return contactStatus.value?.text || '加载中...';
});

const statusClass = computed(() => {
  if (!chatInfo.value) return 'offline';
  if (chatInfo.value.type === 'group') return 'online'; // Groups are always 'online' conceptually
  return contactStatus.value?.className || 'offline';
});
</script>

<style scoped>
.chat-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 var(--spacing-4);
  height: var(--header-height);
  flex-shrink: 0;
  border-bottom: 1px solid var(--color-border);
  background-color: var(--color-background-panel);
}
.back-button { display: none; margin-right: var(--spacing-2); }
@media (max-width: 768px) { .back-button { display: inline-flex; } }
.chat-info { display: flex; align-items: center; cursor: pointer; flex-grow: 1; overflow: hidden; padding: var(--spacing-2) 0; }
.chat-details { margin-left: var(--spacing-3); overflow: hidden; }
.chat-title { font-size: var(--font-size-lg); font-weight: var(--font-weight-semibold); white-space: nowrap; text-overflow: ellipsis; overflow: hidden; }
.character-active .chat-title { color: var(--character-primary-color); text-shadow: 0 0 5px var(--character-glow-color); }
.chat-status { font-size: var(--font-size-sm); color: var(--color-text-secondary); position: relative; padding-left: 12px; }
.chat-status::before {
  content: ''; position: absolute; left: 0; top: 50%;
  transform: translateY(-50%); width: 8px; height: 8px;
  border-radius: 50%; background-color: var(--color-text-tertiary);
  transition: background-color 0.3s ease, box-shadow 0.3s ease;
}
.chat-status.online::before { background-color: var(--color-status-success); box-shadow: 0 0 4px var(--color-status-success); }
.chat-status.offline::before { background-color: var(--color-status-danger); }
.chat-actions { display: flex; align-items: center; gap: var(--spacing-1); }
</style>