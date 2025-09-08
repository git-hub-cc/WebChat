<template>
  <ModalWrapper :show="true" title="交互管理" @close="$emit('close')">
    <div class="interaction-manager">
      <nav class="modal-tabs">
        <button :class="{ active: activeTab === 'contact' }" @click="activeTab = 'contact'">联系人</button>
        <button :class="{ active: activeTab === 'group' }" @click="activeTab = 'group'">群组</button>
        <button :class="{ active: activeTab === 'character' }" @click="activeTab = 'character'">角色</button>
      </nav>

      <div v-if="activeTab === 'contact'" class="tab-content">
        <h3>添加/修改联系人</h3>
        <p>输入对方ID。若ID已存在，可修改其昵称。</p>
        <input type="text" v-model="newContactId" placeholder="对方 ID (必填)">
        <input type="text" v-model="newContactName" placeholder="对方昵称 (可选)">
        <button class="btn-primary" @click="handleConfirmContact">确认</button>
      </div>

      <div v-if="activeTab === 'group'" class="tab-content">
        <h3>创建/修改群组</h3>
        <p>输入群组名称。提供ID可修改，留空则创建。</p>
        <input type="text" v-model="newGroupName" placeholder="群组名称 (必填)">
        <input type="text" v-model="newGroupId" placeholder="群组 ID (可选)">
        <button class="btn-primary" @click="handleConfirmGroup">确认</button>
      </div>

      <div v-if="activeTab === 'character'" class="tab-content">
        <h3>角色卡管理</h3>
        <p>导入或导出角色定义文件 (.json)。</p>
        <div class="button-group">
          <button class="btn-secondary" @click="triggerImport">导入角色卡</button>
          <button class="btn-secondary" @click="exportCharacters">导出当前主题角色</button>
        </div>
        <input type="file" ref="importFileInputRef" @change="handleImport" accept=".json" style="display: none;">
      </div>
    </div>
  </ModalWrapper>
</template>

<script setup>
// --- FIX START: Import necessary hooks and store ---
import { ref, onMounted, watch } from 'vue';
import ModalWrapper from './ModalWrapper.vue';
import { useUserStore } from '@/stores/userStore';
import { useGroupStore } from '@/stores/groupStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { useUiStore } from '@/stores/uiStore'; // Import uiStore
import { eventBus } from '@/services/eventBus';
// --- FIX END ---

const emit = defineEmits(['close']);
const userStore = useUserStore();
const groupStore = useGroupStore();
const settingsStore = useSettingsStore();
const uiStore = useUiStore(); // Get uiStore instance

const activeTab = ref('contact');
const newContactId = ref('');
const newContactName = ref('');
const newGroupName = ref('');
const newGroupId = ref('');
const importFileInputRef = ref(null);

// --- FIX START: Logic to handle prefill data ---
const checkPrefillData = () => {
  const prefill = uiStore.modalPrefillData;
  if (prefill.prefillId) {
    newContactId.value = prefill.prefillId;
    newContactName.value = prefill.prefillName || '';
    // Switch to the correct tab if not already active
    activeTab.value = 'contact';
  }
};

// Check when the component is mounted
onMounted(checkPrefillData);

// Also watch for changes if the modal is already open and data changes
watch(() => uiStore.modalPrefillData, checkPrefillData);
// --- FIX END ---


const handleConfirmContact = async () => {
  if (!newContactId.value) {
    eventBus.emit('showNotification', { message: '对方ID不能为空', type: 'warning' });
    return;
  }
  const success = await userStore.addContact({
    id: newContactId.value,
    name: newContactName.value,
    type: 'contact',
  });
  if (success) {
    eventBus.emit('showNotification', { message: '联系人已添加/更新', type: 'success' });
    emit('close');
  }
};

const handleConfirmGroup = async () => {
  if(!newGroupName.value) {
    eventBus.emit('showNotification', { message: '群组名称不能为空', type: 'warning' });
    return;
  }
  const groupId = await groupStore.createGroup(newGroupName.value, newGroupId.value);
  if(groupId) {
    eventBus.emit('showNotification', { message: '群组已创建/更新', type: 'success' });
    emit('close');
  }
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
        // Mark as imported to prevent theme switching from removing it
        await userStore.addContact({ ...charData, isImported: true });
      }
      eventBus.emit('showNotification', { message: `成功导入 ${characters.length} 个角色。`, type: 'success' });
      emit('close');
    } catch (error) {
      eventBus.emit('showNotification', { message: `导入失败: ${error.message}`, type: 'error' });
    }
  };
  reader.readAsText(file);
  if(event.target) event.target.value = '';
};

const exportCharacters = async () => {
  const charactersToExport = settingsStore.currentSpecialContacts;
  if (charactersToExport.length === 0) {
    eventBus.emit('showNotification', { message: '当前主题没有可导出的角色。', type: 'info' });
    return;
  }

  const jsonData = JSON.stringify(charactersToExport, null, 2);
  const blob = new Blob([jsonData], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `WebChat_Theme_${settingsStore.currentThemeKey}_Characters.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
};
</script>

<style scoped>
.modal-tabs {
  display: flex;
  border-bottom: 1px solid var(--color-border);
  margin-bottom: var(--spacing-4);
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
  gap: var(--spacing-3);
}
h3 { margin-bottom: var(--spacing-1); }
p { font-size: var(--font-size-sm); color: var(--color-text-secondary); margin-bottom: var(--spacing-2); }
.btn-primary, .btn-secondary {
  padding: var(--spacing-2) var(--spacing-4);
  border-radius: var(--border-radius-md);
  font-weight: var(--font-weight-medium);
  width: 100%;
}
.btn-primary { background-color: var(--color-brand-primary); color: var(--color-text-on-brand); }
.btn-secondary { background-color: var(--color-background-elevated); border: 1px solid var(--color-border); }
.button-group { display: flex; gap: var(--spacing-3); }
</style>