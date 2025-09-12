<template>
  <div class="people-lobby-root">
    <!-- [已移除] 标签页导航已被移除，以简化界面 -->
    <!--
    <div class="lobby-tabs">
      ...
    </div>
    -->

    <div class="lobby-header">
      <!-- [修改] 标题变为静态，因为只有一个列表 -->
      <h4>全部在线用户 ({{ allUsers.length }})</h4>
      <IconButton icon="🔄" title="刷新列表" :class="{ loading: isLoading }" @click="fetchUsers" />
    </div>

    <div class="lobby-list scroller">
      <div v-if="isLoading && allUsers.length === 0" class="loading-state">
        <SkeletonLoader type="list-item" v-for="i in 5" :key="i" />
      </div>
      <!-- [修改] v-else-if 条件直接检查 allUsers -->
      <div v-else-if="allUsers.length === 0" class="empty-state">
        当前无在线用户
      </div>
      <!-- [修改] v-for 直接遍历 allUsers -->
      <div v-else v-for="user in allUsers" :key="user.id" class="lobby-item" @click="handleUserClick(user)">
        <Avatar :entity="user" :is-online="user.isOnline" />
        <div class="user-info">
          <span class="user-name">{{ user.name }}</span>
          <span class="user-status" :class="user.statusClass">{{ user.statusText }}</span>
          <!-- [修改] isLocal 的判断现在用于显示/隐藏服务器来源标签 -->
          <span v-if="!user.isLocal" class="origin-server" :title="user.originServer">{{ getServerName(user.originServer) }}</span>
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
import { webrtcService } from '@/services/webrtcService';
import { eventBus } from '@/services/eventBus';
import IconButton from '@/components/Shared/IconButton.vue';
import Avatar from '@/components/Shared/Avatar.vue';
import SkeletonLoader from '@/components/Shared/SkeletonLoader.vue';

const userStore = useUserStore();
const uiStore = useUiStore();
const isLoading = ref(false);
// [已移除] activeTab 不再需要
// const activeTab = ref('local');

const allUsers = computed(() => {
  return userStore.allOnlineUsers.map(user => {
    const contact = userStore.contacts[user.userId];
    const status = userStore.getContactCombinedStatus(user.userId);

    return {
      id: user.userId,
      name: contact ? contact.name : `用户 ${user.userId.substring(0, 6)}`,
      avatarText: contact ? contact.avatarText : user.userId.charAt(0).toUpperCase(),
      avatarUrl: contact ? contact.avatarUrl : null,
      isContact: !!contact,
      type: 'contact',
      originServer: user.originServer,
      isLocal: user.isLocal,
      isOnline: status.isOnlineDisplay,
      statusText: status.statusText,
      statusClass: status.statusClass,
    };
  });
});

// [已移除] localUsers 和 displayedUsers 不再需要，因为我们只显示一个列表
// const localUsers = computed(() => ...);
// const displayedUsers = computed(() => ...);

async function fetchUsers() {
  isLoading.value = true;
  await userStore.fetchAllOnlineUsers();
  isLoading.value = false;
}

function handleUserClick(user) {
  if (user.isContact) {
    const status = userStore.getContactCombinedStatus(user.id);
    if (!status.isConnected) {
      eventBus.emit('showNotification', { message: `正在尝试连接 ${user.name}...`, type: 'info' });
      webrtcService.createOffer(user.id);
    } else {
      eventBus.emit('showNotification', { message: `${user.name} 已在您的联系人列表中并已连接。`, type: 'info' });
    }
    return;
  }

  uiStore.showModal('newContact', {
    prefillId: user.id,
    prefillName: user.name.startsWith('用户 ') ? '' : user.name
  });
}

function getServerName(url) {
  try {
    // 增加对不带协议的URL的兼容
    const fullUrl = url.startsWith('http') ? url : `http://${url}`;
    return new URL(fullUrl).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

onMounted(() => {
  fetchUsers();
});
</script>

<style scoped>
.people-lobby-root { display: flex; flex-direction: column; height: 100%; }
/* [已移除] 标签页相关样式 */
.lobby-header { display: flex; justify-content: space-between; align-items: center; padding: var(--spacing-2) var(--spacing-3); border-bottom: 1px solid var(--color-border); flex-shrink: 0; }
.lobby-header h4 { font-weight: var(--font-weight-semibold); }
.lobby-list { flex-grow: 1; overflow-y: auto; }
.empty-state { display: flex; align-items: center; justify-content: center; height: 100%; color: var(--color-text-secondary); }
.loading-state { display: flex; flex-direction: column; justify-content: flex-start; height: 100%; }
.lobby-item { display: flex; align-items: center; padding: var(--spacing-2) var(--spacing-3); cursor: pointer; border-bottom: 1px solid var(--color-border); }
.lobby-item:hover { background-color: var(--color-background-hover); }
.user-info { margin-left: var(--spacing-3); flex-grow: 1; overflow: hidden; }
.user-name { font-weight: var(--font-weight-medium); display: block; }
.user-status { font-size: var(--font-size-sm); color: var(--color-text-secondary); }
.user-status.online { color: var(--color-status-success); }
.user-status.offline { color: var(--color-status-danger); }
.user-status.warning { color: var(--color-status-warning); }
.contact-indicator { color: var(--color-status-success); font-weight: bold; margin-left: var(--spacing-2); }
.loading { animation: spin 1s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
.origin-server { font-size: 0.7rem; color: var(--color-text-tertiary); background-color: var(--color-background-elevated); padding: 1px 4px; border-radius: var(--border-radius-sm); margin-top: 2px; display: inline-block; max-width: 150px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
</style>