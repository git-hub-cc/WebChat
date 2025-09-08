<template>
  <div v-if="group" class="group-info-section">
    <Avatar :entity="group" size="xl" class="profile-avatar" />
    <h2 class="profile-name">{{ group.name }}</h2>
    <p class="profile-id">群组 ID: {{ groupIdShort }}</p>
    <p class="member-count">{{ group.members.length }} / {{ maxMembers }} 名成员</p>

    <div class="details-tabs">
      <button :class="{ active: activeTab === 'members' }" @click="activeTab = 'members'">成员</button>
      <button :class="{ active: activeTab === 'media' }" @click="activeTab = 'media'">媒体</button>
      <button v-if="isOwnerWithAIs" :class="{ active: activeTab === 'ai' }" @click="activeTab = 'ai'">AI设置</button>
    </div>

    <!-- 成员列表 -->
    <div v-if="activeTab === 'members'" class="tab-content">
      <div class="member-list">
        <div v-for="member in sortedMembers" :key="member.id" class="member-item">
          <Avatar :entity="member" :is-online="member.statusClass === 'online'" size="medium" />
          <div class="member-info">
            <span class="member-name">
              {{ member.name }}
              <span v-if="member.isOwner" class="owner-badge">群主</span>
            </span>
            <span class="member-status" :class="member.statusClass">{{ member.statusText }}</span>
          </div>
          <IconButton v-if="isOwner && !member.isOwner" icon="✕" title="移除成员" @click="removeMember(member.id, member.name)" />
        </div>
      </div>

      <div v-if="isOwner" class="add-member-section">
        <hr>
        <h3>添加成员</h3>
        <div class="add-member-controls">
          <select v-model="selectedContactToAdd">
            <option disabled value="">选择联系人...</option>
            <option v-for="contact in addableContacts" :key="contact.id" :value="contact.id">
              {{ contact.name }}
            </option>
          </select>
          <button class="btn-primary" @click="addMember" :disabled="!selectedContactToAdd">添加</button>
        </div>
      </div>
    </div>

    <!-- 媒体预览 -->
    <ResourcePreview v-if="activeTab === 'media'" :chat-id="group.id" />

    <!-- AI 设置 -->
    <div v-if="activeTab === 'ai' && isOwnerWithAIs" class="tab-content">
      <p>AI 设置占位</p>
      <!-- TODO: AI Settings for group prompts would go here -->
    </div>

    <div class="actions">
      <hr>
      <button v-if="!isOwner" class="btn-danger" @click="leaveGroup">退出群组</button>
      <button v-if="isOwner" class="btn-danger" @click="dissolveGroup">解散群组</button>
    </div>

  </div>
</template>

<script setup>
import { ref, computed } from 'vue';
import { useGroupStore } from '@/stores/groupStore';
import { useUserStore } from '@/stores/userStore';
import { useChatStore } from '@/stores/chatStore';
import { useUiStore } from '@/stores/uiStore';
import { eventBus } from '@/services/eventBus';
import Avatar from '@/components/Shared/Avatar.vue';
import IconButton from '@/components/Shared/IconButton.vue';
import ResourcePreview from './ResourcePreview.vue';
import AppSettings from '@/config/AppSettings';
import { webrtcService } from '@/services/webrtcService';

const groupStore = useGroupStore();
const userStore = useUserStore();
const chatStore = useChatStore();
const uiStore = useUiStore();

const activeTab = ref('members');
const selectedContactToAdd = ref("");

const group = computed(() => groupStore.groups[chatStore.currentChatId]);
const isOwner = computed(() => group.value?.owner === userStore.userId);
const maxMembers = AppSettings.chat.maxGroupMembers;

const groupIdShort = computed(() => group.value?.id.replace('group_', ''));

const isOwnerWithAIs = computed(() => {
  return isOwner.value && group.value?.members.some(id => userStore.contacts[id]?.isAI);
});

const sortedMembers = computed(() => {
  if (!group.value) return [];
  return group.value.members
      .map(id => {
        const contact = userStore.contacts[id] || { id, name: `用户 ${id.substring(0,4)}`, type: 'contact' };
        const isConnected = webrtcService.connections.value[id]?.isConnected;
        const status = {
          isOwner: id === group.value.owner,
          statusText: id === userStore.userId ? '您' : (contact.isAI ? 'AI 助手' : (isConnected ? '在线' : '离线')),
          statusClass: isConnected ? 'online' : 'offline',
          sortOrder: id === group.value.owner ? 0 : (isConnected ? 1 : (contact.isAI ? 2 : 3))
        };
        return { ...contact, ...status };
      })
      .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
});

const addableContacts = computed(() => {
  if (!group.value) return [];
  return Object.values(userStore.contacts).filter(
      contact => !group.value.members.includes(contact.id)
  );
});

async function addMember() {
  if (!selectedContactToAdd.value) return;
  const success = await groupStore.addMemberToGroup(group.value.id, selectedContactToAdd.value);
  if(success) {
    selectedContactToAdd.value = "";
  }
}

function removeMember(memberId, memberName) {
  eventBus.emit('showConfirmation', {
    message: `确定要将 "${memberName}" 移出群组吗？`,
    onConfirm: () => groupStore.removeMemberFromGroup(group.value.id, memberId),
  });
}

function leaveGroup() {
  eventBus.emit('showConfirmation', {
    message: `确定要退出群组 "${group.value.name}" 吗？`,
    onConfirm: () => groupStore.leaveGroup(group.value.id).then(() => uiStore.toggleDetailsPanel(false)),
  });
}

function dissolveGroup() {
  eventBus.emit('showConfirmation', {
    message: `确定要解散群组 "${group.value.name}" 吗？此操作不可逆！`,
    onConfirm: () => groupStore.dissolveGroup(group.value.id).then(() => uiStore.toggleDetailsPanel(false)),
  });
}
</script>

<style scoped>
.group-info-section { text-align: center; padding: 0 var(--spacing-4) var(--spacing-4); }
.profile-avatar { margin: var(--spacing-4) auto; }
.profile-name { font-size: var(--font-size-xl); font-weight: var(--font-weight-bold); }
.profile-id, .member-count { font-size: var(--font-size-sm); color: var(--color-text-secondary); }
hr { border: none; border-top: 1px solid var(--color-border); margin: var(--spacing-4) 0; }
.details-tabs { display: flex; border-bottom: 1px solid var(--color-border); margin-bottom: var(--spacing-3); }
.details-tabs button { padding: var(--spacing-2) var(--spacing-3); color: var(--color-text-secondary); border-bottom: 2px solid transparent; }
.details-tabs button.active { color: var(--color-brand-primary); border-bottom-color: var(--color-brand-primary); }
.tab-content { text-align: left; }
.member-list { margin-bottom: var(--spacing-4); }
.member-item { display: flex; align-items: center; padding: var(--spacing-2) 0; gap: var(--spacing-3); }
.member-info { flex-grow: 1; }
.member-name { font-weight: var(--font-weight-medium); display: block; }
.owner-badge { font-size: 0.7rem; color: var(--color-brand-primary); font-weight: bold; margin-left: var(--spacing-1); background-color: rgba(var(--color-brand-primary-rgb), 0.1); padding: 2px 5px; border-radius: 4px; }
.member-status { font-size: var(--font-size-sm); color: var(--color-text-secondary); }
.member-status.online { color: var(--color-status-success); }
.add-member-section h3 { margin-bottom: var(--spacing-2); }
.add-member-controls { display: flex; gap: var(--spacing-2); }
.add-member-controls select { flex-grow: 1; }
.btn-primary, .btn-danger { padding: var(--spacing-2) var(--spacing-4); border-radius: var(--border-radius-md); font-weight: var(--font-weight-medium); }
.btn-primary { background-color: var(--color-brand-primary); color: white; }
.btn-danger { width: 100%; background-color: var(--color-status-danger); color: white; margin-top: var(--spacing-3); }
</style>