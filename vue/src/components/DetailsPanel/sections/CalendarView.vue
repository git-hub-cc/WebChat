<template>
  <div class="calendar-container">
    <div class="calendar-header">
      <button @click="prevMonth" class="nav-btn">‹</button>
      <span class="month-year">{{ currentMonthYear }}</span>
      <button @click="nextMonth" class="nav-btn">›</button>
    </div>
    <div class="calendar-grid">
      <div v-for="day in weekdays" :key="day" class="weekday">{{ day }}</div>
      <div v-for="day in days" :key="day.dateKey" class="day-cell" :class="day.classes" @click="selectDate(day)">
        {{ day.dayOfMonth }}
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed } from 'vue';
import { useChatStore } from '@/stores/chatStore';
// --- START OF MODIFICATION: Import necessary stores and eventBus ---
import { useUiStore } from '@/stores/uiStore';
import { eventBus } from '@/services/eventBus';
// --- END OF MODIFICATION ---

const props = defineProps({
  chatId: { type: String, required: true }
});

// --- START OF MODIFICATION: Remove emit, add uiStore ---
// const emit = defineEmits(['select-date']); // No longer needed
const uiStore = useUiStore();
// --- END OF MODIFICATION ---

const chatStore = useChatStore();
const currentDate = ref(new Date());

const datesWithMessages = computed(() => new Set(chatStore.getDatesWithMessages(props.chatId)));

const currentMonthYear = computed(() => {
  return currentDate.value.toLocaleDateString('zh-CN', { year: 'numeric', month: 'long' });
});

const weekdays = ['日', '一', '二', '三', '四', '五', '六'];

const days = computed(() => {
  const year = currentDate.value.getFullYear();
  const month = currentDate.value.getMonth();
  const firstDayOfMonth = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const grid = [];

  for (let i = 0; i < firstDayOfMonth; i++) {
    grid.push({ isEmpty: true, dateKey: `empty-${i}` });
  }

  for (let day = 1; day <= daysInMonth; day++) {
    const dateKey = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const hasMessages = datesWithMessages.value.has(dateKey);
    grid.push({
      dayOfMonth: day,
      dateKey,
      hasMessages,
      isEmpty: false,
      classes: {
        'empty': false,
        'has-messages': hasMessages,
        'no-messages': !hasMessages,
      }
    });
  }
  return grid;
});

function prevMonth() {
  currentDate.value = new Date(currentDate.value.getFullYear(), currentDate.value.getMonth() - 1, 1);
}

function nextMonth() {
  currentDate.value = new Date(currentDate.value.getFullYear(), currentDate.value.getMonth() + 1, 1);
}

// --- START OF MODIFICATION: Update selectDate to use eventBus ---
function selectDate(day) {
  if (day.hasMessages) {
    // Emit a global event that MessageArea can listen to
    eventBus.emit('chat:scroll-to-date', { chatId: props.chatId, dateString: day.dateKey });

    // For better mobile UX, hide the panel and show the chat view
    if (window.innerWidth <= 768) {
      uiStore.toggleDetailsPanel(false);
      uiStore.isChatViewActiveOnMobile = true;
    }
  }
}
// --- END OF MODIFICATION ---
</script>

<style scoped>
.calendar-container { padding: var(--spacing-2); }
.calendar-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: var(--spacing-3); }
.month-year { font-weight: var(--font-weight-semibold); }
.nav-btn { font-size: 1.5rem; color: var(--color-brand-primary); }
.calendar-grid { display: grid; grid-template-columns: repeat(7, 1fr); gap: var(--spacing-1); }
.weekday, .day-cell { text-align: center; padding: var(--spacing-2) 0; border-radius: 50%; }
.weekday { font-size: var(--font-size-sm); color: var(--color-text-secondary); }
.day-cell.empty { visibility: hidden; }
.day-cell.no-messages { color: var(--color-text-tertiary); }
.day-cell.has-messages {
  background-color: var(--color-background-active);
  color: var(--color-brand-primary);
  font-weight: bold;
  cursor: pointer;
  transition: background-color 0.2s ease;
}
.day-cell.has-messages:hover {
  background-color: var(--color-brand-primary);
  color: var(--color-text-on-brand);
}
</style>