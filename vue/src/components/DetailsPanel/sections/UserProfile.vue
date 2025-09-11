<template>
  <div v-if="contact" class="user-profile-section" :class="{ 'character-active': contact.isSpecial, [contact.id]: contact.isSpecial }">
    <!-- Basic Info -->
    <div class="profile-header">
      <Avatar :entity="contact" size="xl" class="profile-avatar" />
      <h2 class="profile-name">{{ contact.name }}</h2>
      <p class="profile-id">ID: {{ contact.id }}</p>
    </div>
    <hr>

    <!-- AI-Specific Details -->
    <div v-if="contact.isAI && contact.aboutDetails" class="about-section">
      <h4>关于 {{ contact.aboutDetails.nameForAbout || contact.name }}</h4>
      <ul class="basic-info-list">
        <li v-for="info in contact.aboutDetails.basicInfo" :key="info.label">
          <strong>{{ info.label }}:</strong> {{ info.value }}
        </li>
      </ul>
      <p class="about-text">{{ contact.aboutDetails.aboutText }}</p>
    </div>

    <!-- AI Settings (Chapter, Memory, TTS) -->
    <AiSettings v-if="contact.isAI" :contact-id="contact.id" />

    <!-- Actions for non-special or imported contacts -->
    <div class="actions" v-if="!isThemeSpecialContact || contact.isImported">
      <hr v-if="contact.isAI">
      <button class="btn-danger" @click="deleteContact">删除联系人</button>
    </div>

    <!-- [NEW] Resource Preview for all contact types -->
    <hr>
    <div class="resource-section">
      <ResourcePreview :chat-id="contact.id" />
    </div>

  </div>
  <div v-else class="loading-state">
    <Spinner />
  </div>
</template>

<script setup>
import { computed } from 'vue';
import { useUserStore } from '@/stores/userStore';
import { useChatStore } from '@/stores/chatStore';
import { useUiStore } from '@/stores/uiStore';
import { useSettingsStore } from '@/stores/settingsStore';
import Avatar from '@/components/Shared/Avatar.vue';
import AiSettings from './AiSettings.vue';
import Spinner from '@/components/Shared/Spinner.vue';
import ResourcePreview from './ResourcePreview.vue'; // [NEW] Import ResourcePreview

const userStore = useUserStore();
const chatStore = useChatStore();
const uiStore = useUiStore();
const settingsStore = useSettingsStore();

const contact = computed(() => userStore.contacts[chatStore.currentChatId]);

const isThemeSpecialContact = computed(() => {
  if (!contact.value) return false;
  return settingsStore.currentSpecialContacts.some(sc => sc.id === contact.value.id);
});

const deleteContact = () => {
  uiStore.showConfirmationModal({
    message: `确定要删除联系人 "${contact.value.name}" 吗？此操作不可逆。`,
    onConfirm: () => {
      userStore.removeContact(contact.value.id).then(success => {
        if (success) {
          uiStore.toggleDetailsPanel(false);
        }
      });
    }
  });
}
</script>

<style scoped>
.user-profile-section { text-align: center; }
.profile-header { padding: var(--spacing-4) 0; }
.profile-avatar { margin: 0 auto var(--spacing-4); }
.profile-name { font-size: var(--font-size-xl); font-weight: var(--font-weight-bold); }
.character-active .profile-name { color: var(--character-primary-color); }
.profile-id { font-size: var(--font-size-sm); color: var(--color-text-secondary); margin-bottom: var(--spacing-4); word-break: break-all; }
hr { border: none; border-top: 1px solid var(--color-border); margin: 0 var(--spacing-4); }

.about-section, .actions, .resource-section { padding: 0 var(--spacing-4); } /* [MODIFIED] Add .resource-section to padding rule */
.about-section { text-align: left; margin-top: var(--spacing-4); }
.about-section h4 { font-weight: var(--font-weight-semibold); margin-bottom: var(--spacing-3); }
.basic-info-list { list-style: none; margin-bottom: var(--spacing-3); }
.basic-info-list li { margin-bottom: var(--spacing-1); }
.about-text { line-height: 1.6; color: var(--color-text-secondary); }

.actions { margin-top: var(--spacing-5); }
.btn-danger { background-color: var(--color-status-danger); color: white; padding: var(--spacing-2) var(--spacing-4); border-radius: var(--border-radius-md); font-weight: var(--font-weight-medium); width: 100%; }
.loading-state { display: flex; justify-content: center; padding: var(--spacing-6); }

/* [NEW] Style for the resource section container */
.resource-section {
  margin-top: var(--spacing-5);
  margin-bottom: var(--spacing-4);
  text-align: left; /* Reset text align for the contents of ResourcePreview */
}
</style>