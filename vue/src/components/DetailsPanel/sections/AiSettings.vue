<template>
  <div class="ai-settings-section">
    <!-- Chapter Selector -->
    <div v-if="contact.chapters && contact.chapters.length > 0" class="setting-block">
      <h4>篇章选择</h4>
      <select :value="selectedChapter" @change="onChapterChange" class="chapter-select">
        <option :value="null">默认行为</option>
        <option v-for="chapter in contact.chapters" :key="chapter.id" :value="chapter.id">
          {{ chapter.name }}
        </option>
      </select>
    </div>

    <!-- Memory Books Section -->
    <div class="setting-block">
      <h4>记忆书</h4>
      <div v-if="memoryStore.elementSets.length === 0" class="empty-memory">
        <p>请在"交互管理" > "记忆书"中添加记忆书定义。</p>
      </div>
      <div v-else class="memory-book-list">
        <div v-for="set in memoryStore.elementSets" :key="set.id" class="memory-item">
          <div class="memory-header">
            <span class="memory-name">{{ set.name }}</span>
            <div class="memory-actions">
              <label :for="`radio-${set.id}`" class="enable-label">
                <input
                    type="radio"
                    :name="`memory-enable-${contactId}`"
                    :checked="isMemoryBookEnabled(set.id)"
                    @change="toggleMemoryBook(set.id, $event.target.checked)"
                    :id="`radio-${set.id}`"
                />
                启用
              </label>
              <button @click="generateMemory(set.id)" class="btn-action">记录</button>
            </div>
          </div>
          <textarea
              :value="getMemoryContent(set.id)"
              @blur="saveMemory(set.id, $event.target.value)"
              placeholder="点击“记录”以生成，或在此手动编辑..."
          ></textarea>
        </div>
      </div>
    </div>

    <!-- TTS Settings -->
    <div class="setting-block">
      <h4>TTS 设置</h4>
      <!-- [MODIFIED] Replaced placeholder with the TtsSettings component -->
      <TtsSettings :contact-id="contactId" />
    </div>
  </div>
</template>

<script setup>
import { computed, defineAsyncComponent } from 'vue';
import { useUserStore } from '@/stores/userStore';
import { useMemoryStore } from '@/stores/memoryStore';

// [NEW] Asynchronously import TtsSettings component
const TtsSettings = defineAsyncComponent(() => import('./TtsSettings.vue'));

const props = defineProps({
  contactId: { type: String, required: true },
});

const userStore = useUserStore();
const memoryStore = useMemoryStore();

const contact = computed(() => userStore.contacts[props.contactId]);
const selectedChapter = computed(() => contact.value?.selectedChapterId || null);

const onChapterChange = (event) => {
  const chapterId = event.target.value === 'null' ? null : event.target.value;
  userStore.setSelectedChapterForAI(props.contactId, chapterId);
};

const getMemoryContent = (setId) => memoryStore.elementSets.find(s => s.id === setId)?.books?.[props.contactId]?.content || '';
const isMemoryBookEnabled = (setId) => !!memoryStore.elementSets.find(s => s.id === setId)?.books?.[props.contactId]?.enabled;
const toggleMemoryBook = (setId, isEnabled) => memoryStore.setMemoryBookEnabled(setId, props.contactId, isEnabled);
const generateMemory = (setId) => memoryStore.generateMemoryBook(setId, props.contactId);
const saveMemory = (setId, content) => memoryStore.saveMemoryBookContent(setId, props.contactId, content);
</script>

<style scoped>
/* Styles are unchanged */
.ai-settings-section { padding: var(--spacing-4); display: flex; flex-direction: column; gap: var(--spacing-5); }
.setting-block { text-align: left; }
h4 { font-weight: var(--font-weight-semibold); margin-bottom: var(--spacing-3); padding-bottom: var(--spacing-2); border-bottom: 1px solid var(--color-border); }
.chapter-select { width: 100%; }
.empty-memory { text-align: center; color: var(--color-text-secondary); font-size: var(--font-size-sm); padding: var(--spacing-3); background-color: var(--color-background-elevated); border-radius: var(--border-radius-md); }
.memory-book-list { display: flex; flex-direction: column; gap: var(--spacing-3); }
.memory-item { border: 1px solid var(--color-border); border-radius: var(--border-radius-md); overflow: hidden; }
.memory-header { display: flex; justify-content: space-between; align-items: center; padding: var(--spacing-2) var(--spacing-3); background-color: var(--color-background-elevated); }
.memory-name { font-weight: var(--font-weight-medium); }
.memory-actions { display: flex; align-items: center; gap: var(--spacing-3); font-size: var(--font-size-sm); }
.enable-label { cursor: pointer; display: flex; align-items: center; gap: var(--spacing-1); }
.memory-actions .btn-action { background: none; color: var(--color-brand-primary); font-weight: var(--font-weight-semibold); padding: 0; }
.memory-item textarea { width: 100%; border: none; border-top: 1px solid var(--color-border); padding: var(--spacing-2); min-height: 80px; resize: vertical; font-family: var(--font-family-mono); }
</style>