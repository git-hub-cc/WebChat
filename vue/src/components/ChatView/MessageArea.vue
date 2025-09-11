<template>
  <div class="message-area" ref="scrollContainerRef">
    <DynamicScroller
        ref="scrollerRef"
        class="scroller"
        :items="chatStore.currentChatMessages"
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
import { ref, watch, nextTick, onMounted, onUnmounted } from 'vue';
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

const scrollToBottom = (behavior = 'smooth') => {
  nextTick(() => {
    scrollerRef.value?.scrollToBottom();
  });
};

const scrollToMessage = (messageId) => {
  const index = chatStore.currentChatMessages.findIndex(m => m.id === messageId);
  if (index > -1 && scrollerRef.value) {
    scrollerRef.value.scrollToItem(index);
  }
};

watch(() => chatStore.currentChatMessages.length, (newLength, oldLength) => {
  if (newLength > oldLength) {
    const lastMessage = chatStore.currentChatMessages[newLength - 1];
    if (lastMessage && typeof lastMessage.sender !== 'undefined') {
      const isMyMessage = lastMessage.sender === userStore.userId;
      if (isMyMessage || !showScrollToBottom.value || lastMessage.isStreaming) {
        scrollToBottom('smooth');
      }
    }
  }
}, { flush: 'post' });

watch(() => props.chatId, () => {
  scrollToBottom('auto');
}, { immediate: true });

let scrollerEl = null;
const handleScroll = () => {
  if (scrollerEl) {
    const isNearBottom = scrollerEl.scrollHeight - scrollerEl.scrollTop - scrollerEl.clientHeight < 200;
    showScrollToBottom.value = !isNearBottom;
  }
};

onMounted(() => {
  scrollerEl = scrollerRef.value?.$el;
  if (scrollerEl) {
    scrollerEl.addEventListener('scroll', handleScroll);
  }
  eventBus.on('chat:scroll-to-message', scrollToMessage);
});

onUnmounted(() => {
  if (scrollerEl) {
    scrollerEl.removeEventListener('scroll', handleScroll);
  }
  eventBus.off('chat:scroll-to-message', scrollToMessage);
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