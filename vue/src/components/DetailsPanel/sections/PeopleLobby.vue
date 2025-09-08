<template>
  <div class="people-lobby-root">
    <div class="lobby-header">
      <h4>在线用户 ({{ onlineUsers.length }})</h4>
      <IconButton icon="🔄" title="刷新列表" :class="{ loading: isLoading }" @click="fetchUsers" />
    </div>
    <div class="lobby-list scroller">
      <div v-if="isLoading && onlineUsers.length === 0" class="loading-state">
        <Spinner />
      </div>
      <div v-else-if="onlineUsers.length === 0" class="empty-state">
        当前无其他在线用户
      </div>
      <div v-else v-for="user in onlineUsers" :key="user.id" class="lobby-item" @click="handleUserClick(user)">
        <Avatar :entity="user" />
        <div class="user-info">
          <span class="user-name">{{ user.name }}</span>
          <span class="user-status">{{ user.isContact ? '已是联系人' : '点击添加' }}</span>
        </div>
        <span v-if="user.isContact" class="contact-indicator">✓</span>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, computed } from 'vue';
import { useUserStore } from '@/stores/userStore';
import { useUiStore } from '@/stores/uiStore';
import IconButton from '@/components/Shared/IconButton.vue';
import Avatar from '@/components/Shared/Avatar.vue';
import Spinner from '@/components/Shared/Spinner.vue';
import { log } from '@/utils';

const userStore = useUserStore();
const uiStore = useUiStore();
const isLoading = ref(false);

// This computed property reactively transforms the list of online IDs from the store
// into a displayable list of user objects.
const onlineUsers = computed(() => {
  return userStore.onlineUserIds.map(id => {
    const contact = userStore.contacts[id];
    return {
      id,
      name: contact ? contact.name : `用户 ${id.substring(0, 6)}`,
      avatarText: contact ? contact.avatarText : id.charAt(0).toUpperCase(),
      avatarUrl: contact ? contact.avatarUrl : null,
      isContact: !!contact,
      type: 'contact',
    };
  });
});

// The refresh button now just triggers the centralized fetch action
async function fetchUsers() {
  isLoading.value = true;
  await userStore.fetchOnlineUsers();
  isLoading.value = false;
}

function handleUserClick(user) {
  if (user.isContact) {
    uiStore.showNotification({ message: `${user.name} 已在您的联系人列表中。`, type: 'info' });
    return;
  }
  uiStore.showModal('newContact', {
    prefillId: user.id,
    prefillName: user.name.startsWith('用户 ') ? '' : user.name
  });
}

// Fetch the list immediately when the component is shown
onMounted(() => {
  fetchUsers();
});
</script>

<style scoped>
.people-lobby-root { display: flex; flex-direction: column; height: 100%; }
.lobby-header { display: flex; justify-content: space-between; align-items: center; padding: var(--spacing-2) var(--spacing-3); border-bottom: 1px solid var(--color-border); flex-shrink: 0; }
.lobby-header h4 { font-weight: var(--font-weight-semibold); }
.lobby-list { flex-grow: 1; overflow-y: auto; }
.loading-state, .empty-state { display: flex; align-items: center; justify-content: center; height: 100%; color: var(--color-text-secondary); }
.lobby-item { display: flex; align-items: center; padding: var(--spacing-2) var(--spacing-3); cursor: pointer; border-bottom: 1px solid var(--color-border); }
.lobby-item:hover { background-color: var(--color-background-hover); }
.user-info { margin-left: var(--spacing-3); flex-grow: 1; overflow: hidden; }
.user-name { font-weight: var(--font-weight-medium); display: block; }
.user-status { font-size: var(--font-size-sm); color: var(--color-text-secondary); }
.contact-indicator { color: var(--color-status-success); font-weight: bold; }
.loading { animation: spin 1s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
</style>