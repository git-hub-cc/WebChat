<template>
  <div class="comment-item">
    <div class="comment-header">
      <span class="comment-author">{{ authorName }}</span>
      <span class="comment-timestamp">{{ formattedTimestamp }}</span>
    </div>
    <p class="comment-content">{{ comment.content }}</p>
    <div class="comment-footer">
      <button
          class="like-button"
          :class="{ liked: comment.likedByCurrentUser }"
          @click="$emit('toggle-like', comment.id)"
      >
        <span class="like-icon">{{ comment.likedByCurrentUser ? '❤️' : '🤍' }}</span>
        <span class="like-count">{{ comment.likeCount }}</span>
      </button>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue';
import { useUserStore } from '@/stores/userStore';

const props = defineProps({
  comment: {
    type: Object,
    required: true,
  }
});

defineEmits(['toggle-like']);

const userStore = useUserStore();

const authorName = computed(() => {
  const contact = userStore.contacts[props.comment.userId];
  if (contact) return contact.name;
  if (props.comment.userId === userStore.userId) return userStore.userName;
  return `用户 ${props.comment.userId.substring(0, 6)}`;
});

const formattedTimestamp = computed(() => {
  return new Date(props.comment.createdAt).toLocaleString('zh-CN', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
});
</script>

<style scoped>
.comment-item {
  padding: var(--spacing-3) 0;
  border-bottom: 1px solid var(--color-border);
}
.comment-item:last-child {
  border-bottom: none;
}
.comment-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: var(--spacing-2);
}
.comment-author {
  font-weight: var(--font-weight-semibold);
  color: var(--color-text-primary);
}
.comment-timestamp {
  font-size: var(--font-size-xs);
  color: var(--color-text-tertiary);
}
.comment-content {
  white-space: pre-wrap;
  word-wrap: break-word;
  color: var(--color-text-secondary);
  line-height: 1.6;
  text-align: left;
}
.comment-footer {
  display: flex;
  justify-content: flex-end;
  margin-top: var(--spacing-2);
}
.like-button {
  display: flex;
  align-items: center;
  gap: var(--spacing-1);
  padding: 4px 8px;
  border-radius: var(--border-radius-pill);
  background-color: var(--color-background-elevated);
  border: 1px solid var(--color-border);
  transition: all 0.2s ease;
}
.like-button:hover {
  background-color: var(--color-background-hover);
}
.like-button.liked {
  border-color: var(--color-status-danger);
  background-color: rgba(220, 53, 69, 0.1);
}
.like-icon {
  font-size: 1rem;
}
.like-count {
  font-size: var(--font-size-sm);
  color: var(--color-text-secondary);
}
.like-button.liked .like-count {
  color: var(--color-status-danger);
}
</style>