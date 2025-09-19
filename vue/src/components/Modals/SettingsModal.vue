<template>
  <ModalWrapper :show="true" title="菜单与设置" @close="$emit('close')">
    <div class="settings-content">
      <nav class="modal-tabs">
        <button :class="{ active: activeTab === 'general' }" @click="switchTab('general')">通用</button>
        <button :class="{ active: activeTab === 'appearance' }" @click="switchTab('appearance')">外观</button>
        <button :class="{ active: activeTab === 'api' }" @click="switchTab('api')">模型服务</button>
        <button :class="{ active: activeTab === 'media' }" @click="switchTab('media')">音视频</button>
        <!-- ✅ MODIFICATION START: Added Network tab and adjusted handler -->
        <button :class="{ active: activeTab === 'network' }" @click="switchTab('network')">网络诊断</button>
        <!-- ✅ MODIFICATION END -->
        <button :class="{ active: activeTab === 'advanced' }" @click="switchTab('advanced')">高级</button>
      </nav>

      <!-- --- [动画] START: 优化选项卡切换动画以消除闪烁 --- -->
      <div class="tab-content-container" ref="tabContainerRef">
        <Transition
            name="tab-content-slide"
            @before-leave="onBeforeLeave"
            @enter="onEnter"
            @after-enter="onAfterEnter"
        >
          <div :key="activeTab" class="tab-content-wrapper">
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
                <button
                    class="btn-danger"
                    @click="clearContacts"
                    :disabled="nonSpecialContactsCount === 0 || uiStore.isPerformingDangerousAction">
                  {{ uiStore.isPerformingDangerousAction ? '处理中...' : `清空联系人 (${nonSpecialContactsCount})` }}
                </button>
                <button
                    class="btn-danger"
                    @click="clearChats"
                    :disabled="totalChatsCount === 0 || uiStore.isPerformingDangerousAction">
                  {{ uiStore.isPerformingDangerousAction ? '处理中...' : `清空所有聊天 (${totalChatsCount})` }}
                </button>
                <button
                    class="btn-danger"
                    @click="clearCache"
                    :disabled="uiStore.isPerformingDangerousAction">
                  {{ uiStore.isPerformingDangerousAction ? '处理中...' : '初始化应用' }}
                </button>
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

            <!-- 模型服务 -->
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

            <!-- Audio/Video device check tab -->
            <div v-if="activeTab === 'media'" class="tab-content">
              <h3>设备检测</h3>
              <p>检查您的摄像头和麦克风是否工作正常，并已被浏览器授权访问。</p>
              <div class="device-check-area" :class="{ 'no-video-preview': !showVideoPreview }">
                <div class="video-preview-container">
                  <video ref="videoPreviewRef" autoplay muted playsinline class="video-preview"></video>
                  <div v-if="!videoPreviewStream" class="preview-placeholder">
                    {{ isCheckingDevices ? '检测中...' : '点击开始检测以预览摄像头' }}
                  </div>
                  <div v-if="micVolume > 0" class="vu-meter-container">
                    <div class="vu-meter-bar" :style="{ width: `${micVolume}%` }"></div>
                  </div>
                </div>
                <div class="device-status-list">
                  <div class="device-status-item">
                    <span class="device-name">摄像头</span>
                    <span class="status-indicator" :class="cameraStatus.class">{{ cameraStatus.text }}</span>
                  </div>
                  <div class="device-status-item">
                    <span class="device-name">麦克风</span>
                    <span class="status-indicator" :class="micStatus.class">{{ micStatus.text }}</span>
                  </div>
                </div>
              </div>
              <button class="btn-secondary" @click="startDeviceCheck" :disabled="isCheckingDevices">
                {{ isCheckingDevices ? '正在检测...' : '开始检测' }}
              </button>
              <hr>
              <h3>通话设置</h3>
              <div class="setting-item">
                <label for="ai-noise-suppression-toggle">AI 智能降噪</label>
                <input
                    type="checkbox"
                    id="ai-noise-suppression-toggle"
                    :checked="settingsStore.isAiNoiseSuppressionEnabled"
                    @change="onAiNoiseSuppressionChange"
                    class="toggle-switch"
                />
              </div>
              <p class="setting-description">开启后可显著消除键盘、环境等噪音（实验性功能，可能会增加CPU消耗）。</p>
            </div>

            <!-- ✅ MODIFICATION START: New Network Diagnostics Tab -->
            <div v-if="activeTab === 'network'" class="tab-content">
              <h3>网络诊断</h3>
              <p>测试与 STUN/TURN 服务器的连通性，这对于建立稳定的通话至关重要。</p>
              <div class="device-status-list" v-if="Object.keys(networkTestResults).length > 0">
                <div class="device-status-item" v-for="(status, server) in networkTestResults" :key="server">
                  <span class="device-name">{{ server }}</span>
                  <span class="status-indicator" :class="status === 'OK' ? 'status-online' : 'status-offline'">{{ status }}</span>
                </div>
              </div>
              <button class="btn-secondary" @click="startNetworkTest" :disabled="isTestingNetwork">
                {{ isTestingNetwork ? '测试中...' : '开始网络测试' }}
              </button>
            </div>
            <!-- ✅ MODIFICATION END -->

            <!-- 高级 Advanced -->
            <div v-if="activeTab === 'advanced'" class="tab-content">
              <h3>手动连接</h3>
              <p>用于信令服务器故障时，通过手动交换信息来建立连接。</p>
              <button class="btn-secondary" @click="uiStore.showModal('bindManualConnection')">
                打开手动连接工具
              </button>
            </div>
          </div>
        </Transition>
      </div>
      <!-- --- [动画] END --- -->
    </div>
  </ModalWrapper>
</template>

<script setup>
import { ref, computed, watch, reactive, onUnmounted } from 'vue';
import ModalWrapper from './ModalWrapper.vue';
import { useSettingsStore } from '@/stores/settingsStore';
import { useUserStore } from '@/stores/userStore';
import { useChatStore } from '@/stores/chatStore';
import { useUiStore } from '@/stores/uiStore';
import { webrtcService } from '@/services/webrtcService';
import { dbService } from '@/services/dbService';
import { eventBus } from '@/services/eventBus';
import { LLMProviders } from '@/config/LLMProviders';
import { mediaService } from '@/services/mediaService';

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

const isCheckingDevices = ref(false);
const deviceCheckResult = ref(null);
const videoPreviewRef = ref(null);
const videoPreviewStream = ref(null);
const isTestingNetwork = ref(false);
const networkTestResults = ref({});
const micVolume = ref(0);
let audioContext = null;
let analyserNode = null;
let micSourceNode = null;
let animationFrameId = null;

// --- [动画] START: Ref for the transition container ---
const tabContainerRef = ref(null);
// --- [动画] END ---

const showVideoPreview = computed(() => !!videoPreviewStream.value);

const cameraStatus = computed(() => {
  if (!deviceCheckResult.value) return { text: '未检测', class: 'status-unknown' };
  switch (deviceCheckResult.value.video.status) {
    case 'ok': return { text: '正常', class: 'status-online' };
    case 'not_found': return { text: '未找到', class: 'status-offline' };
    case 'denied': return { text: '权限被拒绝', class: 'status-offline' };
    case 'error': return { text: '错误', class: 'status-offline' };
    default: return { text: '未知', class: 'status-unknown' };
  }
});
const micStatus = computed(() => {
  if (!deviceCheckResult.value) return { text: '未检测', class: 'status-unknown' };
  switch (deviceCheckResult.value.audio.status) {
    case 'ok': return { text: '正常', class: 'status-online' };
    case 'not_found': return { text: '未找到', class: 'status-offline' };
    case 'denied': return { text: '权限被拒绝', class: 'status-offline' };
    case 'error': return { text: '错误', class: 'status-offline' };
    default: return { text: '未知', class: 'status-unknown' };
  }
});

function startVuMeter(audioStream) {
  if (!audioStream || audioStream.getAudioTracks().length === 0) return;
  try {
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
    analyserNode = audioContext.createAnalyser();
    analyserNode.fftSize = 256;
    micSourceNode = audioContext.createMediaStreamSource(audioStream);
    micSourceNode.connect(analyserNode);

    const bufferLength = analyserNode.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);

    const draw = () => {
      animationFrameId = requestAnimationFrame(draw);
      analyserNode.getByteFrequencyData(dataArray);
      const sum = dataArray.reduce((acc, val) => acc + val, 0);
      const average = sum / bufferLength;
      micVolume.value = Math.min(100, average * 2); // Scale to 0-100
    };
    draw();
  } catch (e) {
    console.error("Failed to initialize VU meter:", e);
  }
}

function stopVuMeter() {
  if (animationFrameId) cancelAnimationFrame(animationFrameId);
  if (audioContext && audioContext.state !== 'closed') audioContext.close();
  micVolume.value = 0;
  audioContext = null;
  analyserNode = null;
  micSourceNode = null;
  animationFrameId = null;
}


async function startDeviceCheck() {
  isCheckingDevices.value = true;
  deviceCheckResult.value = null;
  cleanupPreviewStream();

  const result = await mediaService.checkDevices();
  deviceCheckResult.value = result;

  if (result.video.stream) {
    videoPreviewStream.value = result.video.stream;
    if (videoPreviewRef.value) {
      videoPreviewRef.value.srcObject = result.video.stream;
    }
  }
  if (result.audio.status === 'ok') {
    const tempAudioStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    startVuMeter(tempAudioStream);
    result.audio.stream = tempAudioStream;
  }
  isCheckingDevices.value = false;
}

async function startNetworkTest() {
  isTestingNetwork.value = true;
  networkTestResults.value = {};
  try {
    const results = await webrtcService.testNetwork();
    networkTestResults.value = {
      'STUN (公网IP发现)': results.stun,
      'TURN (UDP中继)': results.turnUdp,
      'TURN (TCP中继)': results.turnTcp,
      'TURN (TLS中继/443)': results.turnTls,
    };
    eventBus.emit('showNotification', { message: '网络诊断完成', type: 'success' });
  } catch (error) {
    eventBus.emit('showNotification', { message: `网络诊断出错: ${error.message}`, type: 'error' });
  } finally {
    isTestingNetwork.value = false;
  }
}

function cleanupPreviewStream() {
  if (videoPreviewStream.value) {
    videoPreviewStream.value.getTracks().forEach(track => track.stop());
    videoPreviewStream.value = null;
  }
  if (videoPreviewRef.value) {
    videoPreviewRef.value.srcObject = null;
  }
  stopVuMeter();
  if (deviceCheckResult.value?.audio.stream) {
    deviceCheckResult.value.audio.stream.getTracks().forEach(track => track.stop());
    deviceCheckResult.value.audio.stream = null;
  }
}

function switchTab(tab) {
  if (activeTab.value !== tab) {
    activeTab.value = tab;
    cleanupPreviewStream();
    deviceCheckResult.value = null;
    networkTestResults.value = {};
  }
}

onUnmounted(() => {
  cleanupPreviewStream();
});

const compatibleThemes = computed(() => {
  const effectiveScheme = settingsStore.effectiveColorScheme;
  return Object.fromEntries(Object.entries(settingsStore.themes)
      .filter(([key]) => (effectiveScheme === 'dark' ? key.endsWith('-深色') : key.endsWith('-浅色'))));
});
const currentProviderModels = computed(() => LLMProviders[apiSettingsForm.llmProvider]?.models || []);
const wsStatusText = computed(() => webrtcService.isWebSocketConnected.value ? '已连接' : '已断开');
const wsStatusClass = computed(() => webrtcService.isWebSocketConnected.value ? 'status-online' : 'status-offline');

const nonSpecialContactsCount = computed(() => {
  const specialContactIds = new Set(settingsStore.currentSpecialContacts.map(c => c.id));
  return Object.keys(userStore.contacts).filter(id => !specialContactIds.has(id)).length;
});

const totalChatsCount = computed(() => Object.keys(chatStore.chats).length);

const clearContacts = () => uiStore.showConfirmationModal({
  message: '确定要删除所有手动添加的联系人吗？此操作不可逆。',
  onConfirm: () => userStore.removeAllContacts()
});

const clearChats = () => uiStore.showConfirmationModal({
  message: '确定要清空所有聊天记录吗？此操作无法撤销。',
  onConfirm: () => chatStore.clearAllChats()
});

const clearCache = () => {
  uiStore.showConfirmationModal({
    message: "确定要初始化应用吗？所有数据都将被删除，页面将刷新。",
    confirmText: '确定初始化',
    onConfirm: async () => {
      uiStore.isPerformingDangerousAction = true;
      try {
        await dbService.clearAllData();
        localStorage.clear();
        window.location.reload();
      } catch (error) {
        uiStore.isPerformingDangerousAction = false;
        eventBus.emit('showNotification', { message: `初始化失败: ${error.message}`, type: 'error' });
      }
    }
  });
};

const onThemeChange = (event) => settingsStore.applyTheme(event.target.value, event);
const onColorSchemeChange = (event) => settingsStore.setColorScheme(event.target.value, event);
const copyUserId = () => { navigator.clipboard.writeText(userStore.userId); eventBus.emit('showNotification', { message: '用户ID已复制', type: 'success' }); };
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

const onAiNoiseSuppressionChange = (event) => {
  settingsStore.setAiNoiseSuppression(event.target.checked);
};

// --- [动画] START: JS Hooks for smooth height transition ---
const onBeforeLeave = (el) => {
  if (tabContainerRef.value) {
    tabContainerRef.value.style.height = `${el.offsetHeight}px`;
  }
};

const onEnter = (el) => {
  if (tabContainerRef.value) {
    tabContainerRef.value.style.height = `${el.offsetHeight}px`;
  }
};

const onAfterEnter = () => {
  if (tabContainerRef.value) {
    tabContainerRef.value.style.height = 'auto';
  }
};
// --- [动画] END ---
</script>

<style scoped>
.settings-content { display: flex; flex-direction: column; }
.modal-tabs { display: flex; border-bottom: 1px solid var(--color-border); margin-bottom: var(--spacing-4); flex-shrink: 0; }
/* ✅ MODIFICATION START: Adjusted padding for more tabs */
.modal-tabs button { padding: var(--spacing-2) var(--spacing-3); border-bottom: 2px solid transparent; font-weight: var(--font-weight-medium); color: var(--color-text-secondary); }
/* ✅ MODIFICATION END */
.modal-tabs button.active { color: var(--color-brand-primary); border-bottom-color: var(--color-brand-primary); }
.tab-content { display: flex; flex-direction: column; gap: var(--spacing-4); }
.setting-item { display: flex; align-items: center; justify-content: space-between; gap: var(--spacing-4); }
.setting-item label { font-weight: var(--font-weight-medium); flex-shrink: 0; text-align: right; width: 120px; }
.user-id-display, .network-status, .background-controls { display: flex; align-items: center; gap: var(--spacing-2); }
.user-id-display { background-color: var(--color-background-elevated); padding: var(--spacing-1) var(--spacing-2); border-radius: var(--border-radius-md); }
.user-id-display button { font-size: var(--font-size-sm); color: var(--color-text-link); }
.network-status .status-online, .status-indicator.status-online { color: var(--color-status-success); }
.network-status .status-offline, .status-indicator.status-offline { color: var(--color-status-danger); }
.status-indicator.status-unknown { color: var(--color-text-tertiary); }
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
.btn-danger:disabled { background-color: var(--color-background-hover); color: var(--color-text-tertiary); cursor: not-allowed; opacity: 0.6; }
.setting-description { grid-column: 2 / -1; margin-top: calc(-1 * var(--spacing-3)); padding-left: var(--spacing-1); }
.device-check-area { display: grid; grid-template-columns: 1fr 1fr; gap: var(--spacing-4); align-items: center; }
.video-preview-container { width: 100%; aspect-ratio: 4 / 3; background-color: var(--color-background-elevated); border: 1px solid var(--color-border); border-radius: var(--border-radius-md); position: relative; display: flex; align-items: center; justify-content: center; overflow: hidden; }
.video-preview { width: 100%; height: 100%; object-fit: cover; }
.preview-placeholder { color: var(--color-text-secondary); font-size: var(--font-size-sm); text-align: center; padding: var(--spacing-2); }
.device-status-list { display: flex; flex-direction: column; gap: var(--spacing-3); }
.device-status-item { display: flex; justify-content: space-between; align-items: center; font-size: var(--font-size-sm); }
.device-name { font-weight: var(--font-weight-medium); }
.status-indicator { font-weight: var(--font-weight-bold); padding: var(--spacing-1) var(--spacing-2); border-radius: var(--border-radius-sm); background-color: var(--color-background-elevated); }
.btn-secondary:disabled { cursor: not-allowed; opacity: 0.7; }
.vu-meter-container {
  position: absolute;
  bottom: 5px;
  left: 5px;
  right: 5px;
  height: 8px;
  background-color: rgba(0, 0, 0, 0.2);
  border-radius: var(--border-radius-pill);
  overflow: hidden;
}
.vu-meter-bar {
  height: 100%;
  background: linear-gradient(to right, var(--color-status-success), var(--color-status-warning), var(--color-status-danger));
  border-radius: var(--border-radius-pill);
  transition: width 0.1s linear;
}
.toggle-switch {
  -webkit-appearance: none;
  appearance: none;
  position: relative;
  width: 44px;
  height: 24px;
  border-radius: var(--border-radius-pill);
  background-color: var(--color-border);
  transition: background-color 0.2s ease;
  cursor: pointer;
}
.toggle-switch::before {
  content: '';
  position: absolute;
  top: 2px;
  left: 2px;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background-color: white;
  transition: transform 0.2s ease;
}
.toggle-switch:checked {
  background-color: var(--color-status-success);
}
.toggle-switch:checked::before {
  transform: translateX(20px);
}

.device-check-area.no-video-preview {
  grid-template-columns: 1fr;
}

.device-check-area.no-video-preview .video-preview-container {
  display: none;
}


/* --- [动画] START: 选项卡内容切换动画 --- */
.tab-content-container {
  position: relative;
  overflow: hidden;
  transition: height 0.3s var(--transition-easing);
}

.tab-content-wrapper {
  width: 100%;
}

.tab-content-slide-enter-active,
.tab-content-slide-leave-active {
  transition: opacity 0.3s var(--transition-easing), transform 0.3s var(--transition-easing);
  position: absolute;
  top: 0;
  left: 0;
}

.tab-content-slide-enter-from {
  opacity: 0;
  transform: translateX(20px);
}
.tab-content-slide-leave-to {
  opacity: 0;
  transform: translateX(-20px);
}
/* --- [动画] END --- */
</style>