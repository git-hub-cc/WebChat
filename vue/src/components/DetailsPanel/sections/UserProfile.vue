<template>
  <div v-if="contact" class="user-profile-section" :class="{ 'character-active': contact.isSpecial, [contact.id]: contact.isSpecial }">
    <Avatar :entity="contact" size="xl" class="profile-avatar" />
    <h2 class="profile-name">{{ contact.name }}</h2>
    <p class="profile-id">ID: {{ contact.id }}</p>
    <hr>

    <AiSettings v-if="contact.isAI" :contact-id="contact.id" />

    <div class="actions" v-if="!contact.isSpecial || contact.isImported">
      <button class="btn-danger" @click="deleteContact">删除联系人</button>
    </div>
  </div>
  <div v-else>
    <p>无法加载联系人信息。</p>
  </div>
</template>

<script setup>
import { computed } from 'vue';
import { useUserStore } from '@/stores/userStore';
import { useChatStore } from '@/stores/chatStore';
import Avatar from '@/components/Shared/Avatar.vue';
import AiSettings from './AiSettings.vue';
import { eventBus } from '@/services/eventBus';
import { useUiStore } from '@/stores/uiStore';

const userStore = useUserStore();
const chatStore = useChatStore();
const uiStore = useUiStore();

const contact = computed(() => userStore.contacts[chatStore.currentChatId]);

const deleteContact = () => {
  // TODO: Replace with a proper confirmation modal component
  if (confirm(`确定要删除联系人 "${contact.value.name}" 吗？此操作不可逆。`)) {
    userStore.removeContact(contact.value.id).then(success => {
      if (success) {
        uiStore.toggleDetailsPanel(false); // Close panel on success
      }
    });
  }
}
</script>

<style scoped>
.user-profile-section {
  text-align: center;
}

.profile-avatar {
  margin: 0 auto var(--spacing-4);
}
.profile-name {
  font-size: var(--font-size-xl);
  font-weight: var(--font-weight-bold);
}
.character-active .profile-name {
  color: var(--character-primary-color);
}
.profile-id {
  font-size: var(--font-size-sm);
  color: var(--color-text-secondary);
  margin-bottom: var(--spacing-4);
  word-break: break-all;
}
hr {
  border: none;
  border-top: 1px solid var(--color-border);
  margin: var(--spacing-4) 0;
}
.actions {
  margin-top: var(--spacing-5);
}
.btn-danger {
  background-color: var(--color-status-danger);
  color: white;
  padding: var(--spacing-2) var(--spacing-4);
  border-radius: var(--border-radius-md);
  font-weight: var(--font-weight-medium);
  width: 100%;
}
</style>