<template>
  <ModalWrapper :show="true" title="菜单与设置" @close="$emit('close')">
    <div class="settings-content">
      <nav class="modal-tabs">
        <button :class="{ active: activeTab === 'general' }" @click="activeTab = 'general'">通用</button>
        <button :class="{ active: activeTab === 'appearance' }" @click="activeTab = 'appearance'">外观</button>
        <button :class="{ active: activeTab === 'api' }" @click="activeTab = 'api'">AI & API</button>
      </nav>

      <!-- 通用 General -->
      <div v-if="activeTab === 'general'" class="tab-content">
        <div class="setting-item">
          <label>你的用户ID</label>
          <div class="user-id-display">
            <span>{{ userStore.userId }}</span>
            <button @click="copyUserId">复制</button>
          </div>
        </div>
        <div class="setting-item">
          <label>网络状态</label>
          <div class="network-status">
            信令服务器:
            <span :class="wsStatusClass">{{ wsStatusText }}</span>
          </div>
        </div>
        <hr>
        <div class="actions-group">
          <h3>操作</h3>
          <button class="btn-danger" @click="clearContacts">清空联系人</button>
          <button class="btn-danger" @click="clearChats">清空所有聊天</button>
          <button class="btn-danger" @click="clearCache">初始化应用</button>
        </div>
      </div>

      <!-- 外观 Appearance -->
      <div v-if="activeTab === 'appearance'" class="tab-content">
        <div class="setting-item">
          <label for="color-scheme-select">配色方案</label>
          <select id="color-scheme-select" :value="settingsStore.colorScheme" @change="onColorSchemeChange">
            <option value="auto">自动 (跟随系统)</option>
            <option value="light">浅色模式</option>
            <option value="dark">深色模式</option>
          </select>
        </div>
        <div class="setting-item">
          <label for="theme-select">主题</label>
          <select id="theme-select" :value="settingsStore.currentThemeKey" @change="onThemeChange">
            <option v-for="(theme, key) in compatibleThemes" :key="key" :value="key">
              {{ theme.name }}
            </option>
          </select>
        </div>
      </div>

      <!-- AI & API -->
      <div v-if="activeTab === 'api'" class="tab-content">
        <!-- Form fields will be added here -->
        <p>AI & API 设置正在建设中...</p>
      </div>
    </div>
  </ModalWrapper>
</template>

<script setup>
import { ref, computed } from 'vue';
import ModalWrapper from './ModalWrapper.vue';
import { useSettingsStore } from '@/stores/settingsStore';
import { useUserStore } from '@/stores/userStore';
import { useChatStore } from '@/stores/chatStore';
import { useGroupStore } from '@/stores/groupStore';
import { webrtcService } from '@/services/webrtcService';
import { dbService } from '@/services/dbService';
import { eventBus } from '@/services/eventBus';

const emit = defineEmits(['close']);
const settingsStore = useSettingsStore();
const userStore = useUserStore();
const chatStore = useChatStore();
const groupStore = useGroupStore();

const activeTab = ref('general');

const compatibleThemes = computed(() => {
  const effectiveScheme = settingsStore.effectiveColorScheme;
  return Object.entries(settingsStore.themes)
      .filter(([key]) => (effectiveScheme === 'dark' ? key.endsWith('-深色') : key.endsWith('-浅色')))
      .reduce((obj, [key, val]) => {
        obj[key] = val;
        return obj;
      }, {});
});

const wsStatusText = computed(() => webrtcService.isWebSocketConnected.value ? '已连接' : '已断开');
const wsStatusClass = computed(() => webrtcService.isWebSocketConnected.value ? 'status-online' : 'status-offline');

const onThemeChange = (event) => {
  settingsStore.applyTheme(event.target.value, event);
};

const onColorSchemeChange = (event) => {
  settingsStore.setColorScheme(event.target.value, event);
};

const copyUserId = () => {
  navigator.clipboard.writeText(userStore.userId);
  eventBus.emit('showNotification', { message: '用户ID已复制', type: 'success' });
};

const clearContacts = () => { /* TODO: Implement confirmation */ userStore.removeAllContacts(); };
const clearChats = () => { /* TODO: Implement confirmation */ chatStore.clearAllChats(); };
const clearCache = () => {
  if(confirm("确定要初始化应用吗？所有数据都将被删除。")) {
    dbService.clearAllData().then(() => {
      localStorage.clear();
      window.location.reload();
    });
  }
};

</script>

<style scoped>
.settings-content {
  display: flex;
  flex-direction: column;
}
.modal-tabs {
  display: flex;
  border-bottom: 1px solid var(--color-border);
  margin-bottom: var(--spacing-4);
  flex-shrink: 0;
}
.modal-tabs button {
  padding: var(--spacing-2) var(--spacing-4);
  border-bottom: 2px solid transparent;
  font-weight: var(--font-weight-medium);
  color: var(--color-text-secondary);
}
.modal-tabs button.active {
  color: var(--color-brand-primary);
  border-bottom-color: var(--color-brand-primary);
}
.tab-content {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-4);
}
.setting-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.setting-item label {
  font-weight: var(--font-weight-medium);
  margin-right: var(--spacing-4);
}
select { min-width: 150px; }
.user-id-display {
  display: flex;
  align-items: center;
  gap: var(--spacing-2);
  background-color: var(--color-background-elevated);
  padding: var(--spacing-1) var(--spacing-2);
  border-radius: var(--border-radius-md);
}
.user-id-display button {
  font-size: var(--font-size-sm);
  color: var(--color-text-link);
}
.network-status .status-online { color: var(--color-status-success); }
.network-status .status-offline { color: var(--color-status-danger); }
hr {
  border: none;
  border-top: 1px solid var(--color-border);
  margin: var(--spacing-2) 0;
}
.actions-group { display: flex; flex-direction: column; gap: var(--spacing-2); }
.actions-group h3 { margin-bottom: var(--spacing-1); }
.btn-danger {
  background-color: var(--color-status-danger);
  color: white;
  padding: var(--spacing-2);
  border-radius: var(--border-radius-md);
  text-align: center;
}
</style>