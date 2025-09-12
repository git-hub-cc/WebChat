<template>
  <ModalWrapper :show="true" title="交互管理" @close="$emit('close')">
    <div class="interaction-manager">
      <nav class="modal-tabs">
        <button :class="{ active: activeTab === 'contact' }" @click="activeTab = 'contact'">联系人</button>
        <button :class="{ active: activeTab === 'group' }" @click="activeTab = 'group'">群组</button>
        <button :class="{ active: activeTab === 'character' }" @click="activeTab = 'character'">角色</button>
        <button :class="{ active: activeTab === 'memory' }" @click="activeTab = 'memory'">记忆书</button>
      </nav>

      <!-- Contact Tab -->
      <div v-if="activeTab === 'contact'" class="tab-content">
        <h3>添加/修改联系人</h3>
        <p>输入对方ID。若ID已存在，可修改其昵称。</p>
        <input type="text" v-model="newContactId" placeholder="对方 ID (必填)">
        <input type="text" v-model="newContactName" placeholder="对方昵称 (可选)">
        <button class="btn-primary" @click="handleConfirmContact">确认</button>
      </div>

      <!-- Group Tab -->
      <div v-if="activeTab === 'group'" class="tab-content">
        <h3>创建/修改群组</h3>
        <p>输入群组名称。提供ID可修改，留空则创建。</p>
        <input type="text" v-model="newGroupName" placeholder="群组名称 (必填)">
        <input type="text" v-model="newGroupId" placeholder="群组 ID (可选)">
        <button class="btn-primary" @click="handleConfirmGroup">确认</button>
      </div>

      <!-- Character Tab -->
      <div v-if="activeTab === 'character'" class="tab-content">
        <h3>角色卡管理</h3>
        <p>导入或导出角色定义文件 (.json)。</p>
        <div class="button-group">
          <button class="btn-secondary" @click="triggerImport">导入角色卡</button>
          <button class="btn-secondary" @click="exportCharacters">导出当前主题角色</button>
        </div>
        <input type="file" ref="importFileInputRef" @change="handleImport" accept=".json" style="display: none;">
      </div>

      <!-- Memory Book Tab Content -->
      <div v-if="activeTab === 'memory'" class="tab-content">
        <h3>记忆书管理</h3>
        <p>管理用于AI提取长期记忆的关键要素。</p>
        <div class="memory-set-list">
          <div v-if="memoryStore.elementSets.length === 0 && !isFormVisible" class="empty-list-info">
            还没有记忆书，点击下方按钮添加一个吧！
          </div>
          <div v-for="set in memoryStore.elementSets" :key="set.id" class="memory-set-item">
            <span class="set-name">{{ set.name }}</span>
            <div class="set-actions">
              <button class="btn-icon" @click="_showMemorySetForm(set)" title="编辑">✏️</button>
              <button class="btn-icon" @click="deleteMemorySet(set)" title="删除">🗑️</button>
            </div>
          </div>
        </div>
        <transition name="form-fade">
          <div v-if="isFormVisible" class="memory-set-form">
            <h4>{{ editingSetId ? '编辑记忆书' : '添加新记忆书' }}</h4>
            <input type="text" v-model="editingSetName" placeholder="记忆书名称 (例如: '个人喜好')">
            <input type="text" v-model="editingSetElements" placeholder="关键要素, 用逗号分隔 (例如: '颜色, 食物')">
            <div class="form-actions">
              <button class="btn-secondary" @click="_hideMemorySetForm">取消</button>
              <button class="btn-primary" @click="handleSaveMemorySet">
                {{ editingSetId ? '保存修改' : '确认添加' }}
              </button>
            </div>
          </div>
        </transition>
        <button v-if="!isFormVisible" class="btn-primary" @click="_showMemorySetForm()">+ 添加新记忆书</button>
      </div>

    </div>
  </ModalWrapper>
</template>

<script setup>
import { ref, watch } from 'vue';
import ModalWrapper from './ModalWrapper.vue';
import { useUserStore } from '@/stores/userStore';
import { useGroupStore } from '@/stores/groupStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { useUiStore } from '@/stores/uiStore';
import { useMemoryStore } from '@/stores/memoryStore';
import { eventBus } from '@/services/eventBus';
import { log } from '@/utils';

const emit = defineEmits(['close']);
const userStore = useUserStore();
const groupStore = useGroupStore();
const settingsStore = useSettingsStore();
const uiStore = useUiStore();
const memoryStore = useMemoryStore();

const activeTab = ref('contact');
const newContactId = ref('');
const newContactName = ref('');
const newGroupName = ref('');
const newGroupId = ref('');
const importFileInputRef = ref(null);
const isFormVisible = ref(false);
const editingSetId = ref(null);
const editingSetName = ref('');
const editingSetElements = ref('');

watch(() => uiStore.modalPrefillData, (prefill) => {
  if (prefill.prefillId) {
    newContactId.value = prefill.prefillId;
    newContactName.value = prefill.prefillName || '';
    activeTab.value = 'contact';
  }
}, { immediate: true });

const handleConfirmContact = async () => {
  if (!newContactId.value) {
    eventBus.emit('showNotification', { message: '对方ID不能为空', type: 'warning' });
    return;
  }
  const success = await userStore.addContact({ id: newContactId.value, name: newContactName.value, type: 'contact' });
  if (success) emit('close');
};

const handleConfirmGroup = async () => {
  if (!newGroupName.value) {
    eventBus.emit('showNotification', { message: '群组名称不能为空', type: 'warning' });
    return;
  }
  const groupId = await groupStore.createGroup(newGroupName.value, newGroupId.value);
  if (groupId) emit('close');
};

const triggerImport = () => importFileInputRef.value?.click();

const handleImport = (event) => {
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = async (e) => {
    try {
      const characters = JSON.parse(e.target.result);
      if (!Array.isArray(characters)) throw new Error("JSON文件内容不是数组。");
      for (const charData of characters) {
        await userStore.addContact({ ...charData, isImported: true });
      }
      eventBus.emit('showNotification', { message: `成功导入 ${characters.length} 个角色。`, type: 'success' });
      emit('close');
    } catch (error) {
      eventBus.emit('showNotification', { message: `导入失败: ${error.message}`, type: 'error' });
    }
  };
  reader.readAsText(file);
  if (event.target) event.target.value = '';
};

const imageToBase64 = async (url) => {
  if (!url) return null;
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Image fetch failed: ${response.statusText}`);
    const blob = await response.blob();
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  } catch (error) {
    log(`Failed to convert image to Base64 (URL: ${url}): ${error}`, 'ERROR');
    return null;
  }
};

const exportCharacters = async () => {
  await settingsStore.ensureThemeDataIsLoaded();

  const charactersToExport = settingsStore.currentSpecialContacts;
  if (!charactersToExport || charactersToExport.length === 0) {
    eventBus.emit('showNotification', { message: '当前主题没有可导出的角色。', type: 'info' });
    return;
  }

  eventBus.emit('showNotification', { message: '正在准备角色数据...', type: 'info' });
  try {
    const processedCharacters = await Promise.all(
        charactersToExport.map(async (contact) => {
          const cleanContact = { ...contact };
          delete cleanContact.lastMessage;
          delete cleanContact.lastTime;
          delete cleanContact.unread;
          delete cleanContact.isOnline;

          if (cleanContact.avatarUrl) {
            const dataUrl = await imageToBase64(cleanContact.avatarUrl);
            if (dataUrl) cleanContact.avatarDataUrl = dataUrl;
            delete cleanContact.avatarUrl;
          }
          return cleanContact;
        })
    );

    const jsonData = JSON.stringify(processedCharacters, null, 2);
    const blob = new Blob([jsonData], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `WebChat_Theme_${settingsStore.currentThemeKey}_Characters.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  } catch (error) {
    eventBus.emit('showNotification', { message: '导出角色失败，请检查控制台。', type: 'error' });
    log(`Error exporting characters: ${error}`, 'ERROR');
  }
};

const _showMemorySetForm = (set = null) => {
  if (set) {
    editingSetId.value = set.id;
    editingSetName.value = set.name;
    editingSetElements.value = set.elements.join(', ');
  } else {
    editingSetId.value = null;
    editingSetName.value = '';
    editingSetElements.value = '';
  }
  isFormVisible.value = true;
};
const _hideMemorySetForm = () => { isFormVisible.value = false; };
const handleSaveMemorySet = async () => {
  const name = editingSetName.value.trim();
  const elements = editingSetElements.value.split(/[,，、\s]+/).map(e => e.trim()).filter(Boolean);
  const success = editingSetId.value
      ? await memoryStore.updateElementSet(editingSetId.value, name, elements)
      : await memoryStore.addElementSet(name, elements);
  if (success) _hideMemorySetForm();
};
const deleteMemorySet = (set) => {
  uiStore.showConfirmationModal({
    message: `确定要删除记忆书 "${set.name}" 吗？此操作不可逆。`,
    onConfirm: () => memoryStore.deleteElementSet(set.id)
  });
};
</script>

<style scoped>
.modal-tabs { display: flex; border-bottom: 1px solid var(--color-border); margin-bottom: var(--spacing-4); }
.modal-tabs button { padding: var(--spacing-2) var(--spacing-4); border-bottom: 2px solid transparent; font-weight: var(--font-weight-medium); color: var(--color-text-secondary); }
.modal-tabs button.active { color: var(--color-brand-primary); border-bottom-color: var(--color-brand-primary); }
.tab-content { display: flex; flex-direction: column; gap: var(--spacing-3); }
h3 { margin-bottom: var(--spacing-1); }
p { font-size: var(--font-size-sm); color: var(--color-text-secondary); margin-bottom: var(--spacing-2); }
.btn-primary, .btn-secondary { padding: var(--spacing-2) var(--spacing-4); border-radius: var(--border-radius-md); font-weight: var(--font-weight-medium); width: 100%; }
.btn-primary { background-color: var(--color-brand-primary); color: var(--color-text-on-brand); }
.btn-secondary { background-color: var(--color-background-elevated); border: 1px solid var(--color-border); }
.button-group { display: flex; gap: var(--spacing-3); }
.memory-set-list { display: flex; flex-direction: column; gap: var(--spacing-2); }
.memory-set-item { display: flex; justify-content: space-between; align-items: center; padding: var(--spacing-2) var(--spacing-3); background-color: var(--color-background-elevated); border-radius: var(--border-radius-md); }
.set-name { font-weight: var(--font-weight-medium); }
.set-actions { display: flex; gap: var(--spacing-1); }
.btn-icon { font-size: 1rem; padding: var(--spacing-1); border-radius: 50%; width: 32px; height: 32px; }
.btn-icon:hover { background-color: var(--color-background-hover); }
.empty-list-info { text-align: center; color: var(--color-text-secondary); padding: var(--spacing-3); }
.memory-set-form { padding: var(--spacing-3); border: 1px dashed var(--color-border); border-radius: var(--border-radius-md); display: flex; flex-direction: column; gap: var(--spacing-3); margin-top: var(--spacing-2); }
.memory-set-form h4 { margin: 0 0 var(--spacing-1) 0; }
.form-actions { display: flex; justify-content: flex-end; gap: var(--spacing-2); }
.form-actions .btn-primary, .form-actions .btn-secondary { width: auto; }
.form-fade-enter-active, .form-fade-leave-active { transition: all 0.3s ease; }
.form-fade-enter-from, .form-fade-leave-to { opacity: 0; transform: translateY(-10px); }
</style>