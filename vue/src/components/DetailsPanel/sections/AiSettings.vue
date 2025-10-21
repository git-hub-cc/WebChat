<template>
  <div class="ai-settings-section">
    <!-- Chapter Selector (Stays at the top level) -->
    <div v-if="contact.chapters && contact.chapters.length > 0" class="setting-block">
      <h4>篇章选择</h4>
      <select :value="selectedChapter" @change="onChapterChange" class="chapter-select">
        <!-- ✅ MODIFICATION START: Use empty string for default value -->
        <option value="">默认行为</option>
        <!-- ✅ MODIFICATION END -->
        <option v-for="chapter in formattedChapters" :key="chapter.id" :value="chapter.id" :title="chapter.name">
          {{ chapter.displayName }}
        </option>
      </select>
    </div>

    <!-- Memory Books Section (Stays at the top level) -->
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

    <!-- MODIFICATION START: New container for TTS-related tabs -->
    <div class="tts-tab-container setting-block">
      <nav class="details-tabs">
        <button :class="{ active: activeTab === 'tts' }" @click="activeTab = 'tts'">TTS 设置</button>
        <button :class="{ active: activeTab === 'about' }" @click="activeTab = 'about'">关于 TTS</button>
      </nav>

      <!-- TTS Settings Tab Content -->
      <div v-if="activeTab === 'tts'" class="tab-content">
        <TtsSettings :contact-id="contactId" />
      </div>

      <!-- About Tab Content -->
      <div v-if="activeTab === 'about'" class="tab-content about-tts-content">
        <p>我们感谢 <strong>GPT-SoVITS</strong> 及类似开源 TTS 项目的开发者为可访问的语音合成技术所做的贡献。特别感谢以下 GPT-SoVITS 社区贡献者 (排名不分先后)：</p>
        <ul>
          <li><strong>GPT-SoVITS 核心开发者:</strong> @花儿不哭 (FlowerNotCry)</li>
          <li><strong>模型训练与分享:</strong> @红血球AE3803 (RedBloodCellAE3803), @白菜工厂1145号员工 (CabbageFactoryEmployee1145)</li>
          <li><strong>推理优化与在线服务 (GSV AI Lab):</strong> @AI-Hobbyist</li>
        </ul>
        <p class="disclaimer">用户有责任确保遵守他们配置和使用的任何 TTS API 的服务条款。</p>
      </div>
    </div>
    <!-- MODIFICATION END -->
  </div>
</template>

<script setup>
import { ref, computed, defineAsyncComponent } from 'vue';
import { useUserStore } from '@/stores/userStore';
import { useMemoryStore } from '@/stores/memoryStore';

// (imports remain unchanged)
const TtsSettings = defineAsyncComponent(() => import('./TtsSettings.vue'));

const props = defineProps({
  contactId: { type: String, required: true },
});

// MODIFICATION: Set default tab to 'tts'
const activeTab = ref('tts');

const userStore = useUserStore();
const memoryStore = useMemoryStore();

const contact = computed(() => userStore.contacts[props.contactId]);
// ✅ MODIFICATION START: Default to empty string for select binding
const selectedChapter = computed(() => contact.value?.selectedChapterId || '');
// ✅ MODIFICATION END

// ✅ FIX START: Create a computed property to handle text truncation
const formattedChapters = computed(() => {
  if (!contact.value?.chapters) {
    return [];
  }
  return contact.value.chapters.map(chapter => ({
    ...chapter,
    displayName: chapter.name.length > 50
        ? `${chapter.name.substring(0, 50)}...`
        : chapter.name,
  }));
});
// ✅ FIX END

// ✅ MODIFICATION START: Handle empty string value from select
const onChapterChange = (event) => {
  const chapterId = event.target.value === '' ? null : event.target.value;
  userStore.setSelectedChapterForAI(props.contactId, chapterId);
};
// ✅ MODIFICATION END

const getMemoryContent = (setId) => memoryStore.elementSets.find(s => s.id === setId)?.books?.[props.contactId]?.content || '';
const isMemoryBookEnabled = (setId) => !!memoryStore.elementSets.find(s => s.id === setId)?.books?.[props.contactId]?.enabled;
const toggleMemoryBook = (setId, isEnabled) => memoryStore.setMemoryBookEnabled(setId, props.contactId, isEnabled);
const generateMemory = (setId) => memoryStore.generateMemoryBook(setId, props.contactId);
const saveMemory = (setId, content) => memoryStore.saveMemoryBookContent(setId, props.contactId, content);
</script>

<style scoped>
.ai-settings-section { padding: var(--spacing-4); display: flex; flex-direction: column; gap: var(--spacing-5); }
.setting-block { text-align: left; }
h4 { font-weight: var(--font-weight-semibold); margin-bottom: var(--spacing-3); padding-bottom: var(--spacing-2); border-bottom: 1px solid var(--color-border); }
.chapter-select {
  width: 100%;
  /* --- [✅ UI 优化] START --- */
  max-width: 300px; /* 限制最大宽度，防止过长的篇章名破坏布局 */
  text-overflow: ellipsis; /* 对已选中的长文本显示省略号 */
  /* --- [✅ UI 优化] END --- */
}
.empty-memory { text-align: center; color: var(--color-text-secondary); font-size: var(--font-size-sm); padding: var(--spacing-3); background-color: var(--color-background-elevated); border-radius: var(--border-radius-md); }
.memory-book-list { display: flex; flex-direction: column; gap: var(--spacing-3); }
.memory-item { border: 1px solid var(--color-border); border-radius: var(--border-radius-md); overflow: hidden; }
.memory-header { display: flex; justify-content: space-between; align-items: center; padding: var(--spacing-2) var(--spacing-3); background-color: var(--color-background-elevated); }
.memory-name { font-weight: var(--font-weight-medium); }
.memory-actions { display: flex; align-items: center; gap: var(--spacing-3); font-size: var(--font-size-sm); }
.enable-label { cursor: pointer; display: flex; align-items: center; gap: var(--spacing-1); }
.memory-actions .btn-action { background: none; color: var(--color-brand-primary); font-weight: var(--font-weight-semibold); padding: 0; }
.memory-item textarea { width: 100%; border: none; border-top: 1px solid var(--color-border); padding: var(--spacing-2); min-height: 80px; resize: vertical; font-family: var(--font-family-mono); }

/* --- MODIFICATION START: Styles for the TTS-specific tab container --- */
.tts-tab-container h4 {
  /* Hide the h4 if it's inside the tab container, as tabs serve as headers */
  display: none;
}
.details-tabs {
  display: flex;
  border-bottom: 1px solid var(--color-border);
  margin-bottom: var(--spacing-4);
  flex-shrink: 0;
}
.details-tabs button {
  padding: var(--spacing-2) var(--spacing-4);
  color: var(--color-text-secondary);
  border-bottom: 2px solid transparent;
  font-weight: var(--font-weight-medium);
  transition: color 0.2s ease, border-color 0.2s ease;
}
.details-tabs button:hover {
  color: var(--color-text-primary);
}
.details-tabs button.active {
  color: var(--color-brand-primary);
  border-bottom-color: var(--color-brand-primary);
}

.tab-content {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-5);
}

.about-tts-content {
  text-align: left;
  font-size: var(--font-size-sm);
  color: var(--color-text-secondary);
  line-height: 1.6;
}

.about-tts-content p {
  margin-bottom: var(--spacing-3);
}

.about-tts-content strong {
  color: var(--color-text-primary);
  font-weight: var(--font-weight-semibold);
}

.about-tts-content ul {
  list-style-type: none;
  padding-left: 0;
  margin: var(--spacing-3) 0;
}

.about-tts-content li {
  margin-bottom: var(--spacing-1);
}

.about-tts-content .disclaimer {
  font-style: italic;
  font-size: calc(var(--font-size-sm) * 0.9);
  padding: var(--spacing-2);
  background-color: var(--color-background-elevated);
  border-left: 3px solid var(--color-border-strong);
  border-radius: var(--border-radius-sm);
}
/* --- MODIFICATION END --- */
</style>