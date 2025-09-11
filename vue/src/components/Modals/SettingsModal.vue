<template>
  <ModalWrapper :show="true" title="菜单与设置" @close="$emit('close')">
    <div class="settings-content">
      <nav class="modal-tabs">
        <button :class="{ active: activeTab === 'general' }" @click="activeTab = 'general'">通用</button>
        <button :class="{ active: activeTab === 'appearance' }" @click="activeTab = 'appearance'">外观</button>
        <button :class="{ active: activeTab === 'api' }" @click="activeTab = 'api'">AI & API</button>
        <button :class="{ active: activeTab === 'advanced' }" @click="activeTab = 'advanced'">高级</button>
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
        <hr>
        <div class="setting-item">
          <label>浅色模式背景</label>
          <div class="background-controls">
            <button class="btn-secondary" @click="triggerBgInput('light')">选择图片</button>
            <button class="btn-danger-outline" @click="removeBackground('light')" :disabled="!settingsStore.customBackgrounds.light">移除</button>
          </div>
        </div>
        <div class="setting-item">
          <label>深色模式背景</label>
          <div class="background-controls">
            <button class="btn-secondary" @click="triggerBgInput('dark')">选择图片</button>
            <button class="btn-danger-outline" @click="removeBackground('dark')" :disabled="!settingsStore.customBackgrounds.dark">移除</button>
          </div>
        </div>
        <input type="file" ref="bgInputLightRef" @change="handleBgChange($event, 'light')" accept="image/*" hidden>
        <input type="file" ref="bgInputDarkRef" @change="handleBgChange($event, 'dark')" accept="image/*" hidden>
      </div>

      <!-- AI & API -->
      <div v-if="activeTab === 'api'" class="tab-content">
        <div class="setting-item">
          <label for="llm-provider-select">大模型提供商</label>
          <select id="llm-provider-select" :value="apiSettingsForm.llmProvider" @change="onProviderChange">
            <option v-for="(provider, key) in LLMProviders" :key="key" :value="key">
              {{ provider.label }}
            </option>
          </select>
        </div>
        <div class="setting-item">
          <label for="api-endpoint-input">API 端点</label>
          <input id="api-endpoint-input" type="text" v-model="apiSettingsForm.apiEndpoint" @blur="saveApiSetting('apiEndpoint')">
        </div>
        <div class="setting-item">
          <label for="api-model-select">模型名称</label>
          <select v-if="currentProviderModels.length" id="api-model-select" v-model="apiSettingsForm.model" @change="saveApiSetting('model')">
            <option v-for="model in currentProviderModels" :key="model.key" :value="model.key">
              {{ model.label }}
            </option>
          </select>
          <input v-else id="api-model-input" type="text" v-model="apiSettingsForm.model" @blur="saveApiSetting('model')" placeholder="输入自定义模型">
        </div>
        <div class="setting-item">
          <label for="api-key-input">API 密钥</label>
          <input id="api-key-input" type="password" v-model="apiSettingsForm.apiKey" @blur="saveApiSetting('apiKey')">
        </div>
        <div class="setting-item">
          <label for="max-tokens-input">最大令牌数</label>
          <input id="max-tokens-input" type="number" v-model.number="apiSettingsForm.maxTokens" @blur="saveApiSetting('maxTokens')">
        </div>
        <div class="setting-item">
          <label for="tts-endpoint-input">TTS API 端点</label>
          <input id="tts-endpoint-input" type="text" v-model="apiSettingsForm.ttsApiEndpoint" @blur="saveApiSetting('ttsApiEndpoint')">
        </div>
      </div>

      <!-- 高级 Advanced -->
      <div v-if="activeTab === 'advanced'" class="tab-content">
        <h3>手动连接</h3>
        <p>用于信令服务器故障时，通过手动交换信息来建立连接。</p>
        <button class="btn-secondary" @click="uiStore.showModal('bindManualConnection')">
          打开手动连接工具
        </button>
      </div>

    </div>
  </ModalWrapper>
</template>

<script setup>
import { ref, computed, watch, reactive } from 'vue';
import ModalWrapper from './ModalWrapper.vue';
import { useSettingsStore } from '@/stores/settingsStore';
import { useUserStore } from '@/stores/userStore';
import { useChatStore } from '@/stores/chatStore';
import { useUiStore } from '@/stores/uiStore';
import { webrtcService } from '@/services/webrtcService';
import { dbService } from '@/services/dbService';
import { eventBus } from '@/services/eventBus';
import { LLMProviders } from '@/config/LLMProviders';

const emit = defineEmits(['close']);
const settingsStore = useSettingsStore();
const userStore = useUserStore();
const chatStore = useChatStore();
const uiStore = useUiStore();

const activeTab = ref('general');
const bgInputLightRef = ref(null);
const bgInputDarkRef = ref(null);

const apiSettingsForm = reactive({ ...settingsStore.apiSettings });
watch(() => settingsStore.apiSettings, (newSettings) => {
  Object.assign(apiSettingsForm, newSettings);
}, { deep: true });

const compatibleThemes = computed(() => {
  const effectiveScheme = settingsStore.effectiveColorScheme;
  return Object.fromEntries(Object.entries(settingsStore.themes)
      .filter(([key]) => (effectiveScheme === 'dark' ? key.endsWith('-深色') : key.endsWith('-浅色'))));
});
const currentProviderModels = computed(() => LLMProviders[apiSettingsForm.llmProvider]?.models || []);
const wsStatusText = computed(() => webrtcService.isWebSocketConnected.value ? '已连接' : '已断开');
const wsStatusClass = computed(() => webrtcService.isWebSocketConnected.value ? 'status-online' : 'status-offline');

const onThemeChange = (event) => settingsStore.applyTheme(event.target.value, event);
const onColorSchemeChange = (event) => settingsStore.setColorScheme(event.target.value, event);
const copyUserId = () => { navigator.clipboard.writeText(userStore.userId); eventBus.emit('showNotification', { message: '用户ID已复制', type: 'success' }); };
const clearContacts = () => eventBus.emit('showConfirmation', { message: '确定要删除所有手动添加的联系人吗？', onConfirm: () => userStore.removeAllContacts() });
const clearChats = () => chatStore.clearAllChats();
const clearCache = () => {
  eventBus.emit('showConfirmation', {
    message: "确定要初始化应用吗？所有数据都将被删除，页面将刷新。",
    onConfirm: async () => {
      await dbService.clearAllData();
      localStorage.clear();
      window.location.reload();
    }
  });
};
const triggerBgInput = (mode) => {
  if (mode === 'light') bgInputLightRef.value?.click();
  else bgInputDarkRef.value?.click();
};
const handleBgChange = (event, mode) => {
  const file = event.target.files[0];
  if (!file) return;
  if (!file.type.startsWith('image/')) {
    eventBus.emit('showNotification', { message: '请选择图片文件', type: 'error' });
    return;
  }
  if (file.size > 5 * 1024 * 1024) {
    eventBus.emit('showNotification', { message: '图片大小不能超过 5MB', type: 'warning' });
    return;
  }
  settingsStore.setCustomBackground(file, mode);
  event.target.value = '';
};
const removeBackground = (mode) => settingsStore.removeCustomBackground(mode);
const onProviderChange = (event) => settingsStore.handleLlmProviderChange(event.target.value);
const saveApiSetting = (key) => settingsStore.saveApiSetting(key, apiSettingsForm[key]);
</script>

<style scoped>
.settings-content { display: flex; flex-direction: column; }
.modal-tabs { display: flex; border-bottom: 1px solid var(--color-border); margin-bottom: var(--spacing-4); flex-shrink: 0; }
.modal-tabs button { padding: var(--spacing-2) var(--spacing-4); border-bottom: 2px solid transparent; font-weight: var(--font-weight-medium); color: var(--color-text-secondary); }
.modal-tabs button.active { color: var(--color-brand-primary); border-bottom-color: var(--color-brand-primary); }
.tab-content { display: flex; flex-direction: column; gap: var(--spacing-4); }
.setting-item { display: flex; align-items: center; justify-content: space-between; gap: var(--spacing-4); }
.setting-item label { font-weight: var(--font-weight-medium); flex-shrink: 0; text-align: right; width: 120px; }
.user-id-display, .network-status, .background-controls { display: flex; align-items: center; gap: var(--spacing-2); }
.user-id-display { background-color: var(--color-background-elevated); padding: var(--spacing-1) var(--spacing-2); border-radius: var(--border-radius-md); }
.user-id-display button { font-size: var(--font-size-sm); color: var(--color-text-link); }
.network-status .status-online { color: var(--color-status-success); }
.network-status .status-offline { color: var(--color-status-danger); }
hr { border: none; border-top: 1px solid var(--color-border); margin: var(--spacing-2) 0; }
.actions-group { display: flex; flex-direction: column; gap: var(--spacing-2); }
.actions-group h3 { margin-bottom: var(--spacing-1); }
.btn-danger { background-color: var(--color-status-danger); color: white; padding: var(--spacing-2); border-radius: var(--border-radius-md); text-align: center; }
.btn-secondary, .btn-danger-outline { padding: var(--spacing-1) var(--spacing-3); border-radius: var(--border-radius-md); font-size: var(--font-size-sm); }
.btn-secondary { background-color: var(--color-background-elevated); border: 1px solid var(--color-border); }
.btn-danger-outline { color: var(--color-status-danger); border: 1px solid var(--color-status-danger); }
.btn-danger-outline:disabled { color: var(--color-text-tertiary); border-color: var(--color-border); }
input[type="text"], input[type="password"], input[type="number"], select, textarea { width: 100%; flex-grow: 1; }
p { font-size: var(--font-size-sm); color: var(--color-text-secondary); margin-bottom: 0; line-height: 1.4; }
</style>