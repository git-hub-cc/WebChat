<template>
  <div class="message-area" ref="scrollContainerRef">
    <DynamicScroller
        ref="scrollerRef"
        class="scroller"
        :items="messagesToRender"
        :min-item-size="52"
        key-field="id"
    >
      <template v-slot="{ item, index, active }">
        <DynamicScrollerItem
            :item="item"
            :active="active"
            :data-index="index"
            :data-id="item.id"
            class="scroller-item"
        >
          <MessageBubble :message="item" />
        </DynamicScrollerItem>
      </template>
    </DynamicScroller>

    <button v-show="showScrollToBottom" @click="scrollToBottom" class="scroll-to-bottom">
      <span>↓</span>
    </button>
  </div>
</template>

<script setup>
import { ref, watch, nextTick, onMounted, onUnmounted, computed } from 'vue';
import { useChatStore } from '@/stores/chatStore';
import { useUserStore } from '@/stores/userStore';
import { eventBus } from '@/services/eventBus';
import MessageBubble from './MessageBubble.vue';
import { DynamicScroller, DynamicScrollerItem } from 'vue-virtual-scroller';

const props = defineProps({
  chatId: {
    type: String,
    required: true,
  },
});

const chatStore = useChatStore();
const userStore = useUserStore();
const scrollerRef = ref(null);
const showScrollToBottom = ref(false);

// --- START OF FIX ---
const temporaryMessages = ref([]);

const messagesToRender = computed(() => {
  const persistentMessages = chatStore.currentChatMessages || [];
  return [...persistentMessages, ...temporaryMessages.value];
});
// --- END OF FIX ---

const scrollToBottom = (behavior = 'smooth') => {
  nextTick(() => {
    scrollerRef.value?.scrollToBottom();
  });
};

const scrollToMessage = (messageId) => {
  const index = messagesToRender.value.findIndex(m => m.id === messageId);
  if (index > -1 && scrollerRef.value) {
    scrollerRef.value.scrollToItem(index);
  }
};

watch(() => messagesToRender.value.length, (newLength, oldLength) => {
  if (newLength > oldLength) {
    const lastMessage = messagesToRender.value[newLength - 1];
    // Robustness check for lastMessage and its sender
    if (lastMessage && typeof lastMessage.sender !== 'undefined') {
      const isMyMessage = lastMessage.sender === userStore.userId;
      if (isMyMessage || !showScrollToBottom.value || lastMessage.isStreaming) {
        scrollToBottom('smooth');
      }
    }
  }
}, { flush: 'post' });

watch(() => props.chatId, () => {
  temporaryMessages.value = [];
  scrollToBottom('auto');
}, { immediate: true });

let scrollerEl = null;
const handleScroll = () => {
  if (scrollerEl) {
    const isNearBottom = scrollerEl.scrollHeight - scrollerEl.scrollTop - scrollerEl.clientHeight < 200;
    showScrollToBottom.value = !isNearBottom;
  }
};

// --- START OF FIX: EventBus Listeners ---
const onAiThinking = ({ chatId, message }) => {
  if (chatId === props.chatId && message && message.id) {
    temporaryMessages.value.push(message);
  }
};

const onAiClearThinking = ({ chatId, thinkingId }) => {
  if (chatId === props.chatId) {
    temporaryMessages.value = temporaryMessages.value.filter(m => m.id !== thinkingId);
  }
};

const onAiStreamingStart = ({ chatId, message }) => {
  if (chatId === props.chatId && message && message.id) {
    temporaryMessages.value.push(message);
  }
};

const onAiStreamingChunk = ({ chatId, messageId, content }) => {
  if (chatId === props.chatId) {
    const msg = temporaryMessages.value.find(m => m.id === messageId);
    if (msg) {
      msg.content = content;
    }
  }
};

const onAiStreamingEnd = ({ chatId, messageId }) => {
  if (chatId === props.chatId) {
    temporaryMessages.value = temporaryMessages.value.filter(m => m.id !== messageId);
  }
};

const onAiToolUseStart = ({ chatId, message }) => {
  if (chatId === props.chatId && message && message.id) {
    temporaryMessages.value.push(message);
  }
};

const onAiToolUseEnd = ({ chatId, toolUseId }) => {
  if (chatId === props.chatId) {
    temporaryMessages.value = temporaryMessages.value.filter(m => m.id !== toolUseId);
  }
};
// --- END OF FIX ---


onMounted(() => {
  scrollerEl = scrollerRef.value?.$el;
  if (scrollerEl) {
    scrollerEl.addEventListener('scroll', handleScroll);
  }
  eventBus.on('chat:scroll-to-message', scrollToMessage);

  // --- START OF FIX: Register EventBus Listeners ---
  eventBus.on('ai:thinking', onAiThinking);
  eventBus.on('ai:clear_thinking', onAiClearThinking);
  eventBus.on('ai:streaming_start', onAiStreamingStart);
  eventBus.on('ai:streaming_chunk', onAiStreamingChunk);
  eventBus.on('ai:streaming_end', onAiStreamingEnd);
  eventBus.on('ai:tool_use_start', onAiToolUseStart);
  eventBus.on('ai:tool_use_end', onAiToolUseEnd);
  // --- END OF FIX ---
});

onUnmounted(() => {
  if (scrollerEl) {
    scrollerEl.removeEventListener('scroll', handleScroll);
  }
  eventBus.off('chat:scroll-to-message', scrollToMessage);

  // --- START OF FIX: Unregister EventBus Listeners ---
  eventBus.off('ai:thinking', onAiThinking);
  eventBus.off('ai:clear_thinking', onAiClearThinking);
  eventBus.off('ai:streaming_start', onAiStreamingStart);
  eventBus.off('ai:streaming_chunk', onAiStreamingChunk);
  eventBus.off('ai:streaming_end', onAiStreamingEnd);
  eventBus.off('ai:tool_use_start', onAiToolUseStart);
  eventBus.off('ai:tool_use_end', onAiToolUseEnd);
  // --- END OF FIX ---
});
</script>

<style scoped>
.message-area {
  flex-grow: 1;
  overflow: hidden;
  position: relative;
  display: flex;
  flex-direction: column;
  background-color: var(--color-background-page);
}
.scroller {
  height: 100%;
}
.scroller-item {
  padding: 0 var(--spacing-4);
}
.scroll-to-bottom {
  position: absolute;
  bottom: var(--spacing-4);
  right: var(--spacing-4);
  width: 40px;
  height: 40px;
  border-radius: 50%;
  background-color: var(--color-brand-primary);
  color: white;
  border: none;
  box-shadow: var(--shadow-md);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 10;
  transition: opacity 0.2s ease, transform 0.2s ease;
  opacity: 0.8;
}
.scroll-to-bottom span {
  font-size: 1.5rem;
  line-height: 1;
}
.scroll-to-bottom:hover {
  opacity: 1;
  transform: scale(1.05);
}
</style>