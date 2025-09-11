<template>
  <div class="tts-settings-form">
    <div v-for="field in configFields" :key="field.key" class="tts-config-item">
      <label :for="`tts-${contactId}-${field.key}`">{{ field.label }}</label>

      <!-- TTS Mode Select -->
      <select v-if="field.key === 'tts_mode'" v-model="localSettings.tts_mode" :id="`tts-${contactId}-${field.key}`">
        <option v-for="opt in field.options" :key="opt.value" :value="opt.value">{{ opt.text }}</option>
      </select>

      <!-- Version Select -->
      <select v-else-if="field.key === 'version'" v-model="localSettings.version" :id="`tts-${contactId}-${field.key}`">
        <option v-for="opt in field.options" :key="opt.value" :value="opt.value">{{ opt.text }}</option>
      </select>

      <!-- Dynamic, Searchable Model Select -->
      <div v-else-if="field.key === 'model_name' && localSettings.tts_mode === 'Dynamic'" class="searchable-select">
        <input
            type="text"
            v-model="modelSearch"
            @focus="showModelOptions = true"
            @input="showModelOptions = true"
            :placeholder="dynamicDataStatus.models === 'loading' ? '加载中...' : '搜索或选择模型'"
            :disabled="dynamicDataStatus.models !== 'loaded'"
        />
        <div v-if="showModelOptions" class="options-container">
          <div v-for="model in filteredModels" :key="model" @mousedown="selectModel(model)" class="option">{{ model }}</div>
          <div v-if="!filteredModels.length && modelSearch" class="option-disabled">无匹配项</div>
        </div>
      </div>

      <!-- Dynamic Selects (Language, Emotion) -->
      <select v-else-if="field.isPotentiallyDynamic && localSettings.tts_mode === 'Dynamic'" v-model="localSettings[field.key]" :disabled="isDynamicSelectDisabled(field.key)">
        <option disabled value="">{{ getDynamicSelectPlaceholder(field.key) }}</option>
        <option v-for="opt in getDynamicOptions(field.key)" :key="opt" :value="opt">{{ opt }}</option>
      </select>

      <!-- Standard Inputs (Text, Number, Checkbox, Select) -->
      <input v-else-if="field.type === 'checkbox'" type="checkbox" v-model="localSettings[field.key]" :id="`tts-${contactId}-${field.key}`">
      <select v-else-if="field.type === 'select'" v-model="localSettings[field.key]" :id="`tts-${contactId}-${field.key}`">
        <option v-for="opt in field.options" :key="opt.value" :value="opt.value">{{ opt.text }}</option>
      </select>
      <input v-else :type="field.type" v-model="localSettings[field.key]" :id="`tts-${contactId}-${field.key}`" :step="field.step" :min="field.min" :max="field.max">
    </div>
    <button class="btn-primary btn-save-tts" @click="saveSettings">保存 TTS 设置</button>
  </div>
</template>

<script setup>
import {ref, reactive, watch, computed, onUnmounted, onMounted} from 'vue';
import { useUserStore } from '@/stores/userStore';
import { log } from '@/utils';

const props = defineProps({
  contactId: { type: String, required: true }
});
const userStore = useUserStore();

const configFields = [
  { key: 'tts_mode', label: '模式', type: 'select', default: 'Dynamic', options: [{value: 'Preset', text: '预设'},{value: 'Dynamic', text: '动态'}] },
  { key: 'version', label: '版本', type: 'select', default: 'v4', options: [{value: 'v2', text: 'v2'}, {value: 'v3', text: 'v3'}, {value: 'v4', text: 'v4'}] },
  { key: 'enabled', label: '启用TTS', type: 'checkbox', default: false },
  { key: 'model_name', label: '模型', type: 'text', default: '', isPotentiallyDynamic: true },
  { key: 'prompt_text_lang', label: '参考音频语言', type: 'select', options: [], isPotentiallyDynamic: true },
  { key: 'emotion', label: '情感', type: 'select', options: [], isPotentiallyDynamic: true },
  // ... other fields from your config can be added here
];

const localSettings = reactive({});
const dynamicDataCache = ref({}); // { [version]: { models: { [modelName]: { [lang]: [emotions] } } } }
const dynamicDataStatus = reactive({ models: 'idle', speakers: 'idle' });
const modelSearch = ref('');
const showModelOptions = ref(false);

watch(() => props.contactId, (newId) => {
  if (newId) {
    const contact = userStore.contacts[newId];
    const settings = contact?.aiConfig?.tts || {};
    configFields.forEach(field => {
      localSettings[field.key] = settings[field.key] ?? field.default;
    });
    if (localSettings.tts_mode === 'Dynamic') {
      modelSearch.value = localSettings.model_name;
      fetchModels(localSettings.version);
    }
  }
}, { immediate: true });

watch(() => localSettings.version, (newVersion) => {
  if (localSettings.tts_mode === 'Dynamic') fetchModels(newVersion);
});
watch(() => localSettings.tts_mode, (newMode) => {
  if (newMode === 'Dynamic') fetchModels(localSettings.version);
});

const filteredModels = computed(() => {
  const models = dynamicDataCache.value[localSettings.version]?.models || {};
  const modelNames = Object.keys(models);
  if (!modelSearch.value) return modelNames;
  return modelNames.filter(m => m.toLowerCase().includes(modelSearch.value.toLowerCase()));
});

async function fetchModels(version) {
  if (!version || dynamicDataCache.value[version]) return;
  dynamicDataStatus.models = 'loading';
  try {
    // This is a mock implementation. Replace with actual apiService call
    // const modelsData = await apiService.fetchTtsModels(version);
    // MOCK DATA for demonstration:
    const modelsData = { "派蒙": { "中文": ["开心", "默认"] }, "钟离": { "中文": ["沉稳", "默认"] } };
    dynamicDataCache.value[version] = { models: modelsData };
    dynamicDataStatus.models = 'loaded';
  } catch (error) {
    log(`Failed to fetch TTS models for version ${version}: ${error}`, 'ERROR');
    dynamicDataStatus.models = 'error';
  }
}

function selectModel(model) {
  localSettings.model_name = model;
  modelSearch.value = model;
  showModelOptions.value = false;
}

function isDynamicSelectDisabled(key) {
  if (key === 'prompt_text_lang') return !localSettings.model_name || !dynamicDataCache.value[localSettings.version]?.models[localSettings.model_name];
  if (key === 'emotion') return !localSettings.prompt_text_lang || !dynamicDataCache.value[localSettings.version]?.models[localSettings.model_name]?.[localSettings.prompt_text_lang];
  return true;
}

function getDynamicSelectPlaceholder(key) {
  if (key === 'prompt_text_lang') return localSettings.model_name ? '选择语言' : '先选模型';
  if (key === 'emotion') return localSettings.prompt_text_lang ? '选择情感' : '先选语言';
  return '...';
}

function getDynamicOptions(key) {
  const modelData = dynamicDataCache.value[localSettings.version]?.models[localSettings.model_name];
  if (!modelData) return [];
  if (key === 'prompt_text_lang') return Object.keys(modelData);
  if (key === 'emotion') return modelData[localSettings.prompt_text_lang] || [];
  return [];
}

async function saveSettings() {
  await userStore.saveTtsSettings(props.contactId, JSON.parse(JSON.stringify(localSettings)));
}

// Global click listener to close options
const closeOptions = () => { showModelOptions.value = false; };
onMounted(() => document.addEventListener('click', closeOptions));
onUnmounted(() => document.removeEventListener('click', closeOptions));
</script>

<style scoped>
.tts-settings-form { display: flex; flex-direction: column; gap: var(--spacing-3); }
.tts-config-item { display: grid; grid-template-columns: 100px 1fr; align-items: center; gap: var(--spacing-3); }
label { text-align: right; font-size: var(--font-size-sm); color: var(--color-text-secondary); }
input, select { width: 100%; }
.btn-save-tts { margin-top: var(--spacing-3); background-color: var(--color-brand-primary); color: white; padding: var(--spacing-2); border-radius: var(--border-radius-md); }
.searchable-select { position: relative; }
.options-container { position: absolute; top: 100%; left: 0; right: 0; background-color: var(--color-background-panel); border: 1px solid var(--color-border); max-height: 150px; overflow-y: auto; z-index: 10; border-radius: 0 0 var(--border-radius-md) var(--border-radius-md); }
.option { padding: var(--spacing-2); cursor: pointer; }
.option:hover { background-color: var(--color-background-hover); }
.option-disabled { padding: var(--spacing-2); color: var(--color-text-tertiary); }
</style>