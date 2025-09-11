<template>
  <div class="ai-group-settings">
    <div v-for="ai in aiMembers" :key="ai.id" class="ai-setting-item">
      <div class="ai-info">
        <Avatar :entity="ai" size="medium" />
        <span class="ai-name">{{ ai.name }}</span>
      </div>
      <textarea
          v-model="aiPrompts[ai.id]"
          class="prompt-textarea"
          rows="4"
          placeholder="输入此AI在群组中的特定行为指示..."
      ></textarea>
      <div class="actions">
        <button class="btn-secondary" @click="resetPrompt(ai.id)">重置为默认</button>
        <button class="btn-primary" @click="savePrompt(ai.id)">保存指示</button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watchEffect } from 'vue';
import { useGroupStore } from '@/stores/groupStore';
import { useUserStore } from '@/stores/userStore';
import Avatar from '@/components/Shared/Avatar.vue';

const props = defineProps({
  groupId: {
    type: String,
    required: true,
  },
});

const groupStore = useGroupStore();
const userStore = useUserStore();

// Local reactive state to hold the prompts for editing
const aiPrompts = ref({});

const group = computed(() => groupStore.groups[props.groupId]);

const aiMembers = computed(() => {
  if (!group.value) return [];
  return group.value.members
      .map(id => userStore.contacts[id])
      .filter(contact => contact?.isAI);
});

// Sync local state with the store when the component loads or AI members change
watchEffect(() => {
  const newPrompts = {};
  aiMembers.value.forEach(ai => {
    // Priority: Group-specific prompt > AI's default prompt > empty string
    newPrompts[ai.id] = group.value?.aiPrompts?.[ai.id] ?? ai.aiConfig?.systemPrompt ?? '';
  });
  aiPrompts.value = newPrompts;
});

const savePrompt = (aiId) => {
  const newPrompt = aiPrompts.value[aiId];
  groupStore.updateGroupAiPrompt(props.groupId, aiId, newPrompt);
};

const resetPrompt = (aiId) => {
  const defaultPrompt = userStore.contacts[aiId]?.aiConfig?.systemPrompt ?? '';
  aiPrompts.value[aiId] = defaultPrompt;
  // Also save the reset
  groupStore.updateGroupAiPrompt(props.groupId, aiId, defaultPrompt);
};
</script>

<style scoped>
.ai-group-settings {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-4);
}
.ai-setting-item {
  background-color: var(--color-background-elevated);
  border-radius: var(--border-radius-md);
  padding: var(--spacing-3);
  border: 1px solid var(--color-border);
}
.ai-info {
  display: flex;
  align-items: center;
  gap: var(--spacing-3);
  margin-bottom: var(--spacing-3);
}
.ai-name {
  font-weight: var(--font-weight-semibold);
}
.prompt-textarea {
  width: 100%;
  resize: vertical;
  margin-bottom: var(--spacing-3);
}
.actions {
  display: flex;
  justify-content: flex-end;
  gap: var(--spacing-2);
}
.btn-primary, .btn-secondary {
  font-size: var(--font-size-sm);
  padding: var(--spacing-1) var(--spacing-3);
}
.btn-primary { background-color: var(--color-brand-primary); color: white; }
.btn-secondary { background: none; border: 1px solid var(--color-border-strong); }
</style>