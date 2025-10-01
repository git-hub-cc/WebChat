<template>
  <div class="people-lobby-root">
    <div class="lobby-header">
      <h4>全部在线用户 ({{ allUsers.length }})</h4>
      <div>
        <!-- ✅ MODIFICATION START: Removed World Map button -->
        <IconButton icon="⟳" title="刷新列表" :class="{ loading: isLoading }" @click="fetchUsers" />
        <!-- ✅ MODIFICATION END -->
      </div>
    </div>

    <!-- [优化] 使用 v-if/else-if/else 分离加载、空、内容三种状态，并添加过渡动画 -->
    <div class="lobby-list-container">
      <transition name="content-fade" mode="out-in">
        <!-- 1. 加载状态：仅当 isLoading 为 true 时显示骨架图 -->
        <div v-if="isLoading" class="loading-state scroller">
          <SkeletonLoader type="list-item" v-for="i in 8" :key="i" />
        </div>

        <!-- 2. 空状态：当加载完成且列表为空时显示 -->
        <div v-else-if="allUsers.length === 0" class="empty-state">
          当前无在线用户
        </div>

        <!-- 3. 内容状态：当加载完成且列表有内容时显示 -->
        <div v-else class="lobby-list scroller" v-auto-animate="{ duration: 300 }">
          <div v-for="user in allUsers" :key="user.id" class="lobby-item" @click="handleUserClick(user)">
            <Avatar :entity="user" :is-online="user.isOnline" />
            <div class="user-info">
              <span class="user-name">{{ user.name }}</span>
              <span class="user-status" :class="user.statusClass">{{ user.statusText }}</span>
              <span v-if="!user.isLocal" class="origin-server" :title="user.originServer">{{ getServerName(user.originServer) }}</span>
            </div>
            <span v-if="user.isContact" class="contact-indicator">✓</span>
          </div>
        </div>
      </transition>
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

// ✅ MODIFICATION START: Ensure the loading animation runs for a minimum duration.
async function fetchUsers() {
  isLoading.value = true;
  // 创建一个获取数据的 Promise 和一个最小延迟的 Promise
  const fetchPromise = userStore.fetchAllOnlineUsers();
  const minDelay = new Promise(resolve => setTimeout(resolve, 1000)); // 1秒最小延迟

  try {
    // 等待两个 Promise 都完成
    await Promise.all([fetchPromise, minDelay]);
  } catch (error) {
    // 即使 fetch 失败，我们依然等待最小延迟结束，以保证动画完整性。
    // userStore 内部会处理错误日志。
    console.error("刷新用户列表时出错，但动画将平滑结束:", error);
  } finally {
    // 在数据加载和最小延迟都完成后，才隐藏加载状态
    isLoading.value = false;
  }
}
// ✅ MODIFICATION END

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
.lobby-header { display: flex; justify-content: space-between; align-items: center; padding: var(--spacing-2) var(--spacing-3); border-bottom: 1px solid var(--color-border); flex-shrink: 0; }
.lobby-header div { display: flex; align-items: center; }
.lobby-header h4 { font-weight: var(--font-weight-semibold); }
/* [新增] 容器用于过渡动画 */
.lobby-list-container {
  flex-grow: 1;
  overflow: hidden; /* 隐藏滚动条，由内部scroller处理 */
  position: relative;
}
.scroller {
  height: 100%;
  overflow-y: auto;
}
.lobby-list, .loading-state, .empty-state {
  height: 100%;
}
.empty-state { display: flex; align-items: center; justify-content: center; color: var(--color-text-secondary); }
.loading-state { display: flex; flex-direction: column; justify-content: flex-start; }
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

/* [新增] 内容切换的淡入淡出动画 */
.content-fade-enter-active,
.content-fade-leave-active {
  transition: opacity 0.2s ease-in-out;
}
.content-fade-enter-from,
.content-fade-leave-to {
  opacity: 0;
}
</style>