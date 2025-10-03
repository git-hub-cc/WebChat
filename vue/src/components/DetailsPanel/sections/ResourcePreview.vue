<template>
  <div class="resource-preview-root">
    <!-- ✅ FIX START: Added id and aria-label for accessibility and autofill hints -->
    <input type="search" id="resource-search-input" :value="searchQuery" @input="handleSearchInput" placeholder="搜索资源..." class="resource-search" aria-label="搜索聊天中的资源" />
    <!-- ✅ FIX END -->

    <nav class="resource-tabs">
      <button :class="{ active: activeTab === 'media' }" @click="switchTab('media')">媒体</button>
      <button :class="{ active: activeTab === 'text' }" @click="switchTab('text')">文本</button>
      <button :class="{ active: activeTab === 'files' }" @click="switchTab('files')">文件</button>
      <button :class="{ active: activeTab === 'location' }" @click="switchTab('location')">位置</button>
      <button :class="{ active: activeTab === 'calendar' }" @click="switchTab('calendar')">日历</button>
    </nav>

    <div class="resource-content" ref="scrollContainerRef">
      <div v-if="isLoading && filteredResources.length === 0" class="loading-state">
        <SkeletonLoader v-if="activeTab !== 'text'" type="grid" />
        <SkeletonLoader v-else type="list-item" v-for="i in 4" :key="i" />
      </div>

      <div v-else-if="activeTab !== 'calendar'" class="resource-view-wrapper">
        <RecycleScroller
            v-if="filteredResources.length > 0"
            class="scroller"
            :class="{ 'grid-view': activeTab !== 'text', 'list-view': activeTab === 'text' }"
            :items="filteredResources"
            :item-size="itemSize"
            key-field="id"
            :buffer="200"
            :grid-items="gridColumns"
            direction="vertical"
            v-slot="{ item }"
        >
          <component
              :is="itemComponent"
              :item="item"
              @click="handleItemClick(item)"
          />
        </RecycleScroller>

        <div v-if="!isLoading && filteredResources.length === 0" class="empty-state">
          <svg class="empty-state-icon" viewBox="0 0 24 24" fill="currentColor">
            <path d="M21.99 4c0-1.1-.89-2-1.99-2H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h14l4 4-.01-18zM18 14H6v-2h12v2zm0-3H6V9h12v2zm0-3H6V6h12v2z"></path>
          </svg>
          <p>{{ searchQuery ? '无匹配结果' : '此分类下无资源' }}</p>
        </div>
      </div>

      <div v-if="activeTab === 'calendar'" class="calendar-wrapper">
        <CalendarView :chat-id="chatId" />
      </div>
    </div>
  </div>
</template>