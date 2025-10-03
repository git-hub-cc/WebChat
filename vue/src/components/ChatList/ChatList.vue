<template>
  <div class="chat-list-root">
    <header class="chat-list-header">
      <IconButton icon="☰" title="菜单" @click="uiStore.showModal('settings')" />
      <div class="search-bar-wrapper">
        <span class="search-icon">🔍</span>
        <!-- ✅ FIX START: Added id and a more specific aria-label -->
        <input
            type="search"
            id="chat-list-search"
            :value="chatStore.chatListSearchTerm"
            @input="handleSearchInput"
            placeholder="搜索..."
            class="search-bar"
            aria-label="搜索聊天列表"
        />
        <!-- ✅ FIX END -->
      </div>
    </header>

    <nav class="chat-list-tabs">
      <button :class="{ active: uiStore.chatListFilter === 'all' }" @click="uiStore.chatListFilter = 'all'">全部</button>
      <button :class="{ active: uiStore.chatListFilter === 'contact' }" @click="uiStore.chatListFilter = 'contact'">联系人</button>
      <button :class="{ active: uiStore.chatListFilter === 'group' }" @click="uiStore.chatListFilter = 'group'">群组</button>
    </nav>

    <div class="chat-items-wrapper" v-auto-animate="{ duration: 300, easing: 'ease-in-out' }">

      <div v-if="chatStore.filteredChatList.length === 0" class="empty-list">
        <svg class="empty-list-icon" viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
          <path d="M21.99 4c0-1.1-.89-2-1.99-2H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h14l4 4-.01-18zM18 14H6v-2h12v2zm0-3H6V9h12v2zm0-3H6V6h12v2z"/>
        </svg>
        <p>这里空空如也...</p>
        <p>点击右下角的 "+" 添加新的联系人或群组吧！</p>
      </div>
      <RecycleScroller
          v-else
          class="scroller"
          :items="chatStore.filteredChatList"
          :item-size="72"
          key-field="id"
          v-slot="{ item }"
      >
        <ChatListItem
            :item="item"
            :is-active="item.id === chatStore.currentChatId"
            @click="selectChat(item)"
            @contextmenu.prevent="showContextMenu($event, item)"
        />
      </RecycleScroller>
    </div>

    <IconButton icon="icons/plus.svg" class="new-chat-fab" title="新聊天/群组" @click="uiStore.showModal('newContact')" />
  </div>
</template>

<script setup>
import { useChatStore } from '@/stores/chatStore';
import { useUiStore } from '@/stores/uiStore';
import { useUserStore } from '@/stores/userStore';
import { useGroupStore } from '@/stores/groupStore';
import ChatListItem from './ChatListItem.vue';
import IconButton from '@/components/Shared/IconButton.vue';
import { RecycleScroller } from 'vue-virtual-scroller';
import { debounce } from '@/utils';

const chatStore = useChatStore();
const uiStore = useUiStore();
const userStore = useUserStore();
const groupStore = useGroupStore();

const handleSearchInput = debounce((event) => {
  uiStore.chatListSearchTerm = event.target.value;
}, 250);

const selectChat = (item) => {
  chatStore.openChat(item.id);
  if (window.innerWidth <= 768) {
    uiStore.isChatViewActiveOnMobile = true;
  }
};

const showContextMenu = (event, item) => {
  if (item.type === 'contact' && !item.isSpecial) {
    uiStore.showContextMenu({
      event,
      target: { type: 'contact', id: item.id },
      items: [
        {
          label: `删除 "${item.name}"`,
          action: () => {
            uiStore.showConfirmationModal({
              message: `确定要删除联系人 "${item.name}" 吗？所有相关消息都将丢失。`,
              onConfirm: () => userStore.removeContact(item.id)
            });
          },
          class: 'danger'
        }
      ]
    });
  } else if (item.type === 'group') {
    const group = groupStore.groups[item.id];
    if (!group) return;
    const isOwner = group.owner === userStore.userId;
    const actionLabel = isOwner ? '解散群组' : '退出群组';
    const confirmMessage = isOwner
        ? `确定要解散群组 "${item.name}" 吗？此操作不可逆。`
        : `确定要退出群组 "${item.name}" 吗？`;

    uiStore.showContextMenu({
      event,
      target: { type: 'group', id: item.id },
      items: [
        {
          label: actionLabel,
          action: () => {
            uiStore.showConfirmationModal({
              message: confirmMessage,
              onConfirm: () => {
                if (isOwner) {
                  groupStore.dissolveGroup(item.id);
                } else {
                  groupStore.leaveGroup(item.id);
                }
              }
            });
          },
          class: 'danger'
        }
      ]
    });
  }
};

</script>

<style scoped>
.chat-list-root {
  display: flex;
  flex-direction: column;
  height: 100%;
  position: relative;
  background-color: var(--color-background-panel);
}
.chat-list-header {
  display: flex;
  align-items: center;
  height: var(--header-height);
  padding: 0 var(--spacing-3);
  flex-shrink: 0;
  border-bottom: 1px solid var(--color-border);
}

.search-bar-wrapper {
  flex-grow: 1;
  position: relative;
  margin-left: var(--spacing-2);
}
.search-icon {
  position: absolute;
  left: var(--spacing-3);
  top: 50%;
  transform: translateY(-50%);
  color: var(--color-text-tertiary);
  pointer-events: none;
}
.search-bar {
  width: 100%;
  border-radius: var(--border-radius-pill);
  padding-left: calc(var(--spacing-3) * 2 + 1em);
}

.chat-list-tabs {
  display: flex;
  justify-content: space-around;
  padding: 0 var(--spacing-2);
  border-bottom: 1px solid var(--color-border);
  flex-shrink: 0;
}
.chat-list-tabs button {
  padding: var(--spacing-3) var(--spacing-2);
  font-weight: var(--font-weight-medium);
  color: var(--color-text-secondary);
  border-bottom: 2px solid transparent;
  transition: color var(--transition-duration-fast) ease, border-color var(--transition-duration-fast) ease;
}
.chat-list-tabs button:hover { color: var(--color-text-primary); }
.chat-list-tabs button.active {
  color: var(--color-brand-primary);
  border-bottom-color: var(--color-brand-primary);
}
.chat-items-wrapper {
  flex-grow: 1;
  overflow: hidden;
}
.scroller {
  height: 100%;
}

.empty-list {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: var(--color-text-secondary);
  text-align: center;
  padding: var(--spacing-4);
}
.empty-list-icon {
  width: 64px;
  height: 64px;
  opacity: 0.3;
  margin-bottom: var(--spacing-3);
}
.empty-list p {
  line-height: 1.6;
}

.new-chat-fab {
  position: absolute;
  bottom: var(--spacing-4);
  right: var(--spacing-4);
  width: 56px;
  height: 56px;
  border-radius: 50%;
  background-color: var(--color-brand-primary);
  color: var(--color-text-on-brand);
  font-size: 2rem;
  line-height: 1;
  box-shadow: var(--shadow-lg);
  transition: transform 0.2s ease, background-color 0.2s ease;
}
.new-chat-fab:hover {
  background-color: var(--color-brand-primary-dark);
  transform: scale(1.05);
}

.new-chat-fab :deep(.icon) {
}
.new-chat-fab:hover :deep(.icon) {
  transition: transform 0.3s var(--transition-easing-spring);
  transform: rotate(90deg) scale(0.9);
}

@media (max-width: 768px) {
  .chat-list-header {
    display: none;
  }
}
</style>