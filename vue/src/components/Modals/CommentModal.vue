<template>
  <div class="location-panel-root">
    <!-- ✅ MODIFICATION START: Header now also contains the close button -->
    <header class="panel-header">
      <h3 class="location-name">{{ locationName }}</h3>
      <button class="close-btn" @click="$emit('close')" title="关闭">×</button>
    </header>
    <!-- ✅ MODIFICATION END -->

    <!-- ✅ MODIFICATION START: Added a new section for location details -->
    <div class="location-details-container">
      <img :src="`https://ppmc.club/webchat/${locationData.imageUrl}`" :alt="locationData.tag" class="location-image">
      <div class="location-text-content">
        <p class="location-description">{{ locationData.description }}</p>
        <small class="location-creator">由 {{ locationData.createdBy }} 分享</small>
      </div>
    </div>
    <!-- ✅ MODIFICATION END -->

    <div class="comment-content-wrapper">
      <div v-if="isLoading" class="status-overlay">
        <Spinner />
        <p>正在加载评论...</p>
      </div>
      <div v-else-if="error" class="status-overlay error">
        <p>{{ error }}</p>
      </div>
      <div v-else-if="comments.length === 0" class="status-overlay">
        <p>还没有评论，快来抢沙发吧！</p>
      </div>
      <div v-else class="comment-list scroller">
        <CommentItem
            v-for="comment in comments"
            :key="comment.id"
            :comment="comment"
            @toggle-like="handleToggleLike"
        />
      </div>
    </div>

    <footer class="panel-footer">
      <div class="comment-input-area">
        <textarea
            v-model="newCommentContent"
            placeholder="发表你的看法..."
            rows="1"
            class="comment-textarea"
            :disabled="isSubmitting"
            @input="autoResizeTextarea"
            ref="textareaRef"
        ></textarea>
        <button
            class="btn-primary"
            @click="handleSubmitComment"
            :disabled="isSubmitting || !newCommentContent.trim()"
        >
          {{ isSubmitting ? '...' : '发表' }}
        </button>
      </div>
    </footer>
  </div>
</template>

<script setup>
import { ref, computed, watch, nextTick } from 'vue';
import CommentItem from './CommentItem.vue';
import Spinner from '@/components/Shared/Spinner.vue';
import { apiService } from '@/services/apiService';

const props = defineProps({
  locationData: {
    type: Object,
    required: true,
  }
});
const emit = defineEmits(['close']);

const locationId = computed(() => props.locationData?.id);
const locationName = computed(() => props.locationData?.tag || '地点');

const comments = ref([]);
const isLoading = ref(true);
const error = ref(null);
const newCommentContent = ref('');
const isSubmitting = ref(false);
const textareaRef = ref(null);

// Function to auto-resize textarea
function autoResizeTextarea() {
  nextTick(() => {
    const textarea = textareaRef.value;
    if (textarea) {
      textarea.style.height = 'auto';
      textarea.style.height = `${Math.min(textarea.scrollHeight, 100)}px`; // Max height 100px
    }
  });
}

async function fetchComments() {
  if (!locationId.value) return;
  isLoading.value = true;
  error.value = null;
  try {
    const fetchedComments = await apiService.getCommentsForLocation(locationId.value);
    comments.value = fetchedComments;
  } catch (e) {
    error.value = '加载评论失败，请稍后重试。';
  } finally {
    isLoading.value = false;
  }
}

async function handleSubmitComment() {
  const content = newCommentContent.value.trim();
  if (!content || !locationId.value) return;

  isSubmitting.value = true;
  try {
    const newComment = await apiService.addCommentForLocation(locationId.value, content);
    if (newComment) {
      comments.value.unshift(newComment);
      newCommentContent.value = '';
      autoResizeTextarea(); // Reset height
      const listElement = document.querySelector('.comment-list');
      if (listElement) listElement.scrollTop = 0;
    }
  } finally {
    isSubmitting.value = false;
  }
}

async function handleToggleLike(commentId) {
  const commentIndex = comments.value.findIndex(c => c.id === commentId);
  if (commentIndex === -1) return;

  const originalComment = { ...comments.value[commentIndex] };
  comments.value[commentIndex].likedByCurrentUser = !originalComment.likedByCurrentUser;
  comments.value[commentIndex].likeCount += originalComment.likedByCurrentUser ? -1 : 1;

  const result = await apiService.toggleCommentLike(commentId);
  if (!result) {
    comments.value[commentIndex] = originalComment;
  } else {
    comments.value[commentIndex].likedByCurrentUser = result.likedByCurrentUser;
    comments.value[commentIndex].likeCount = result.newLikeCount;
  }
}

watch(() => locationId.value, (newId, oldId) => {
  if (newId && newId !== oldId) {
    comments.value = [];
    newCommentContent.value = '';
    fetchComments();
  }
}, { immediate: true });
</script>

<style scoped>
.location-panel-root {
  position: absolute;
  width: 350px;
  max-height: 550px; /* Increased height */
  background-color: var(--color-background-panel);
  border-radius: var(--border-radius-lg);
  box-shadow: var(--shadow-lg);
  display: flex;
  flex-direction: column;
  border: 1px solid var(--color-border);
  z-index: 1001;
}

.panel-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: var(--spacing-2) var(--spacing-3);
  border-bottom: 1px solid var(--color-border);
  flex-shrink: 0;
}
.location-name {
  font-weight: var(--font-weight-semibold);
  margin: 0;
  font-size: var(--font-size-lg);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.close-btn {
  font-size: 1.5rem;
  color: var(--color-text-secondary);
  background: none;
  border: none;
  cursor: pointer;
  padding: 0 var(--spacing-1);
}

/* ✅ MODIFICATION START: Styles for the new location details section */
.location-details-container {
  flex-shrink: 0;
  border-bottom: 1px solid var(--color-border);
}
.location-image {
  width: 100%;
  height: 150px;
  object-fit: cover;
  display: block;
}
.location-text-content {
  padding: var(--spacing-3);
}
.location-description {
  font-size: var(--font-size-sm);
  color: var(--color-text-secondary);
  line-height: 1.6;
  margin-bottom: var(--spacing-2);
  max-height: 6.4em; /* Approx 4 lines */
  overflow-y: auto;
}
.location-creator {
  font-size: var(--font-size-xs);
  color: var(--color-text-tertiary);
  display: block;
  text-align: right;
}
/* ✅ MODIFICATION END */

.comment-content-wrapper {
  position: relative;
  flex-grow: 1;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}
.status-overlay {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--spacing-3);
  color: var(--color-text-secondary);
  background-color: var(--color-background-panel);
  z-index: 2;
}
.status-overlay.error {
  color: var(--color-status-danger);
}
.comment-list {
  overflow-y: auto;
  flex-grow: 1;
  padding: 0 var(--spacing-3);
}

.panel-footer {
  padding: var(--spacing-2) var(--spacing-3);
  border-top: 1px solid var(--color-border);
  flex-shrink: 0;
}
.comment-input-area {
  display: flex;
  gap: var(--spacing-2);
  align-items: flex-end; /* Align to bottom for multiline */
  width: 100%;
}
.comment-textarea {
  flex-grow: 1;
  resize: none; /* Let JS handle resizing */
  min-height: 38px; /* Match button height */
  max-height: 100px;
  line-height: 1.4;
  padding-top: 8px; /* Adjust for better vertical alignment */
}
.comment-input-area .btn-primary {
  flex-shrink: 0;
  height: 38px;
  padding-left: var(--spacing-4);
  padding-right: var(--spacing-4);
}
.comment-input-area .btn-primary:disabled {
  background-color: var(--color-background-hover);
  cursor: not-allowed;
}
</style>