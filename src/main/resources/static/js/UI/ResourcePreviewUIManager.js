/**
 * @file ResourcePreviewUIManager.js
 * @description 管理详情面板中聊天资源预览部分的 UI 和交互。
 *              包括影像、文本、其他文件类型的网格视图以及按日期导航的日历视图。
 *              支持内容搜索和无限滚动加载。
 * @module ResourcePreviewUIManager
 * @exports {object} ResourcePreviewUIManager - 对外暴露的单例对象。
 * @property {function} init - 初始化模块，获取DOM元素引用并绑定基础事件。
 * @property {function} loadResourcesForChat - 为指定的聊天加载并显示资源。
 * @property {function} hide - 隐藏资源预览区域并清理状态。
 * @dependencies ChatManager, ChatAreaUIManager, MediaUIManager, Utils, NotificationUIManager, DBManager, LayoutUIManager
 * @dependents DetailsPanelUIManager (调用以显示和更新), AppInitializer (进行初始化)
 */
const ResourcePreviewUIManager = {
    // DOM Element References
    resourcePreviewSectionEl: null,
    resourceSearchInputEl: null,
    resourceCategoryTabsContainerEl: null,
    resourceCategoryButtons: {}, // { imagery: btnEl, text: btnEl, ... }
    resourceGridContainerEl: null,
    calendarContainerEl: null,
    resourceGridLoadingIndicatorEl: null,

    // State
    _currentChatId: null,
    _currentResourceType: 'imagery', // Default type
    _resourceItems: [], // Stores currently loaded raw message objects for the grid
    _resourceGridRenderedItemsCount: 0, // Count of items rendered in the grid (not all from _resourceItems if filtered)
    _rawItemsFetchedCount: 0, // Count of raw items fetched from DB for current type/chat (for pagination)
    _currentSearchQuery: '',
    _isResourceLoading: false,
    _resourceScrollListenerAttached: false,
    _boundHandleResourceGridScroll: null,
    _scrollableContainerEl: null, // 新增：存储可滚动的父容器
    _lastFetchWasEmptySearch: false,

    /**
     * 初始化模块。
     */
    init: function() {
        this.resourcePreviewSectionEl = document.getElementById('resourcePreviewSection');
        if (!this.resourcePreviewSectionEl) {
            Utils.log("ResourcePreviewUIManager: resourcePreviewSectionEl 未找到，模块无法正常工作。", Utils.logLevels.ERROR);
            return;
        }

        this.resourceSearchInputEl = this.resourcePreviewSectionEl.querySelector('#resourceSearchInputDetailsPanel');
        this.resourceCategoryTabsContainerEl = this.resourcePreviewSectionEl.querySelector('#resourceCategoryTabsContainer');
        this.resourceGridContainerEl = this.resourcePreviewSectionEl.querySelector('#resourceGridContainer');
        this.calendarContainerEl = this.resourcePreviewSectionEl.querySelector('#calendarContainerDetailsPanel');
        this.resourceGridLoadingIndicatorEl = this.resourcePreviewSectionEl.querySelector('#resourceGridLoadingIndicator');

        this._boundHandleResourceGridScroll = this._handleResourceGridScroll.bind(this);
        this.bindEvents();
        Utils.log("ResourcePreviewUIManager 初始化完成。", Utils.logLevels.INFO);
    },

    /**
     * 绑定事件监听器。
     */
    bindEvents: function() {
        if (this.resourceSearchInputEl) {
            this.resourceSearchInputEl.addEventListener('input', (e) => {
                this._currentSearchQuery = e.target.value.toLowerCase().trim();
                if (this._currentChatId && this._currentResourceType !== 'date') {
                    this._switchResourceTypeAndLoad(this._currentResourceType, true); // Force reload
                }
            });
        }

        if (this.resourceCategoryTabsContainerEl) {
            const buttons = this.resourceCategoryTabsContainerEl.querySelectorAll('.resource-category-tab');
            buttons.forEach(btn => {
                const type = btn.dataset.resourceType;
                if (type) {
                    this.resourceCategoryButtons[type] = btn;
                    btn.addEventListener('click', () => this._switchResourceTypeAndLoad(type, true));
                }
            });
        }
    },

    /**
     * 为指定的聊天加载并显示资源。
     * @param {string} chatId - 要加载资源的聊天ID。
     */
    loadResourcesForChat: function(chatId) {
        if (!chatId || !this.resourcePreviewSectionEl) return;

        if (this._currentChatId === chatId && !this.resourceSearchInputEl.value && this._currentResourceType === 'imagery') {
            // 如果聊天ID和默认过滤器未变，且搜索框为空，则可能不需要完全重载，除非强制
            // 但通常切换聊天时应重载
        }

        this._currentChatId = chatId;
        this.resourcePreviewSectionEl.style.display = 'block';
        this._attachResourceScrollListener();
        // 默认加载影像，或保持之前的类型但强制重载数据
        this._switchResourceTypeAndLoad(this._currentResourceType, true);
        Utils.log(`ResourcePreviewUIManager: 为聊天 ${chatId} 加载资源。`, Utils.logLevels.DEBUG);
    },

    /**
     * 隐藏资源预览区域并清理相关状态。
     */
    hide: function() {
        if (this.resourcePreviewSectionEl) {
            this.resourcePreviewSectionEl.style.display = 'none';
        }
        this._detachResourceScrollListener();
        // 清理状态，以便下次打开时重新加载
        this._currentChatId = null;
        // this._currentResourceType = 'imagery'; // 可以选择保留上次类型或重置
        this._resourceItems = [];
        this._resourceGridRenderedItemsCount = 0;
        this._rawItemsFetchedCount = 0;
        if(this.resourceSearchInputEl) this.resourceSearchInputEl.value = "";
        this._currentSearchQuery = "";
        if(this.resourceGridContainerEl) this.resourceGridContainerEl.innerHTML = "";
        if(this.calendarContainerEl) this.calendarContainerEl.innerHTML = "";
        Utils.log("ResourcePreviewUIManager: 已隐藏并清理。", Utils.logLevels.DEBUG);
    },

    /**
     * @private
     * 切换资源预览的类型并加载相应数据。
     */
    _switchResourceTypeAndLoad: function(resourceType, forceReload = false) {
        if (!this._currentChatId || (!this.resourceGridContainerEl && resourceType !== 'date') || (!this.calendarContainerEl && resourceType === 'date')) return;
        Utils.log(`ResourcePreviewUIManager: 切换到资源类型: ${resourceType} for chat ${this._currentChatId}`, Utils.logLevels.DEBUG);

        const prevResourceType = this._currentResourceType;
        this._currentResourceType = resourceType;

        for (const type in this.resourceCategoryButtons) {
            if (this.resourceCategoryButtons[type]) {
                this.resourceCategoryButtons[type].classList.toggle('active', type === resourceType);
            }
        }

        if (this.resourceGridContainerEl) {
            this.resourceGridContainerEl.style.display = (resourceType !== 'date') ? 'grid' : 'none';
        }
        if (this.calendarContainerEl) {
            this.calendarContainerEl.style.display = (resourceType === 'date') ? 'block' : 'none';
        }
        if (this.resourceGridLoadingIndicatorEl) {
            this.resourceGridLoadingIndicatorEl.style.display = 'none';
        }


        if (resourceType === 'date') {
            this._renderCalendar();
            this._detachResourceScrollListener();
            return;
        } else {
            this._attachResourceScrollListener();
        }

        if (forceReload || prevResourceType !== resourceType) {
            this._resourceItems.forEach(item => { // 清理旧Object URL
                if(item.fileType && (item.fileType.startsWith('image/') || item.fileType.startsWith('video/'))) {
                    const itemEl = this.resourceGridContainerEl?.querySelector(`.resource-preview-item[data-message-id="${item.id}"] .thumbnail-placeholder-resource`);
                    if(itemEl && itemEl.dataset.objectUrlForRevoke){
                        URL.revokeObjectURL(itemEl.dataset.objectUrlForRevoke);
                        delete itemEl.dataset.objectUrlForRevoke;
                    }
                }
            });
            this._resourceItems = [];
            this._resourceGridRenderedItemsCount = 0;
            this._rawItemsFetchedCount = 0;
            if (this.resourceGridContainerEl) this.resourceGridContainerEl.innerHTML = '';
        }
        this._lastFetchWasEmptySearch = false;
        this._loadMoreResources(true);
    },

    /**
     * @private
     * 异步加载更多资源消息并渲染。
     */
    _loadMoreResources: async function(isInitialLoad = false) {
        if (this._isResourceLoading || !this._currentChatId || this._currentResourceType === 'date') return;
        this._isResourceLoading = true;
        if (this.resourceGridLoadingIndicatorEl) this.resourceGridLoadingIndicatorEl.style.display = 'flex';

        try {
            const newRawItems = await ChatManager.getMessagesWithResources(
                this._currentChatId, this._currentResourceType,
                this._rawItemsFetchedCount,
                15 // Batch size
            );

            if (newRawItems && newRawItems.length > 0) {
                this._rawItemsFetchedCount += newRawItems.length;
                let itemsToRenderThisBatch = newRawItems;
                if (this._currentSearchQuery) {
                    itemsToRenderThisBatch = newRawItems.filter(msg => {
                        if (this._currentResourceType === 'text' && msg.content) {
                            return msg.content.toLowerCase().includes(this._currentSearchQuery);
                        } else if ((this._currentResourceType === 'imagery' || this._currentResourceType === 'other') && msg.fileName) {
                            return msg.fileName.toLowerCase().includes(this._currentSearchQuery);
                        }
                        return false;
                    });
                }

                if (itemsToRenderThisBatch.length > 0) {
                    const fragment = document.createDocumentFragment();
                    itemsToRenderThisBatch.forEach(itemData => {
                        const itemEl = this._createResourcePreviewItem(itemData);
                        if (itemEl) {
                            fragment.appendChild(itemEl);
                            this._resourceItems.push(itemData);
                        }
                    });
                    if (this.resourceGridContainerEl) this.resourceGridContainerEl.appendChild(fragment);
                    this._resourceGridRenderedItemsCount = this._resourceItems.length;
                    this._lastFetchWasEmptySearch = false;
                } else if (newRawItems.length > 0 && this._currentSearchQuery) {
                    if(this.resourceGridContainerEl && this.resourceGridContainerEl.scrollHeight <= this.resourceGridContainerEl.clientHeight + 100) {
                        if (!this._lastFetchWasEmptySearch) {
                            this._lastFetchWasEmptySearch = true;
                            setTimeout(() => this._loadMoreResources(false), 50);
                        } else {
                            this._lastFetchWasEmptySearch = false;
                        }
                    } else {
                        this._lastFetchWasEmptySearch = false;
                    }
                }

                if (isInitialLoad && this._resourceItems.length === 0 && this.resourceGridContainerEl) {
                    const emptyMsg = document.createElement('div');
                    emptyMsg.className = 'resource-grid-empty-message';
                    emptyMsg.textContent = this._currentSearchQuery ? '未找到符合搜索条件的资源。' : '此分类下暂无资源。';
                    this.resourceGridContainerEl.innerHTML = '';
                    this.resourceGridContainerEl.appendChild(emptyMsg);
                }
            } else if (isInitialLoad && this._resourceItems.length === 0) {
                if (this.resourceGridContainerEl) {
                    const emptyMsg = document.createElement('div');
                    emptyMsg.className = 'resource-grid-empty-message';
                    emptyMsg.textContent = this._currentSearchQuery ? '未找到符合搜索条件的资源。' : '此分类下暂无资源。';
                    this.resourceGridContainerEl.innerHTML = '';
                    this.resourceGridContainerEl.appendChild(emptyMsg);
                }
            }
        } catch (error) {
            Utils.log(`ResourcePreviewUIManager._loadMoreResources: 加载资源失败 - ${error}`, Utils.logLevels.ERROR);
            NotificationUIManager.showNotification('加载资源失败。', 'error');
        } finally {
            this._isResourceLoading = false;
            if (this.resourceGridLoadingIndicatorEl) this.resourceGridLoadingIndicatorEl.style.display = 'none';
        }
    },

    /**
     * @private
     * 创建单个资源预览项的DOM元素。
     */
    _createResourcePreviewItem: function(message) {
        const template = document.getElementById('resource-preview-item-template').content.cloneNode(true);
        const itemEl = template.querySelector('.resource-preview-item');
        const contentArea = template.querySelector('.resource-content-area');
        const timestampEl = template.querySelector('.resource-timestamp');

        itemEl.dataset.messageId = message.id;
        timestampEl.textContent = Utils.formatDate(new Date(message.timestamp), false);

        itemEl.addEventListener('click', () => {
            if (typeof ChatAreaUIManager !== 'undefined' && ChatAreaUIManager.scrollToMessage) {
                ChatAreaUIManager.scrollToMessage(message.id);
            }
            // On mobile, also hide details panel and show chat area for better UX
            const isMobileView = window.innerWidth <= 768;
            if (isMobileView) {
                if (typeof DetailsPanelUIManager !== 'undefined') {
                    DetailsPanelUIManager.hideSidePanel();
                }
                if (typeof LayoutUIManager !== 'undefined') {
                    LayoutUIManager.showChatAreaLayout();
                }
            }
        });

        if (this._currentResourceType === 'imagery') {
            const placeholderDiv = document.createElement('div');
            placeholderDiv.className = 'thumbnail-placeholder-resource';
            const icon = message.fileType?.startsWith('video/') ? '🎬' : '🖼️';
            placeholderDiv.innerHTML = icon; // Initial icon
            contentArea.appendChild(placeholderDiv);

            setTimeout(() => { // Defer thumbnail rendering
                if (typeof MediaUIManager !== 'undefined' && MediaUIManager.renderMediaThumbnail) {
                    MediaUIManager.renderMediaThumbnail(placeholderDiv, message.fileHash, message.fileType, message.fileName || '媒体预览', true);
                }
            }, 0);
        } else if (this._currentResourceType === 'text') {
            itemEl.classList.add('text-message-preview');
            const senderName = message.originalSenderName || UserManager.contacts[message.sender]?.name || `用户 ${String(message.sender).substring(0,4)}`;

            const senderEl = document.createElement('div');
            senderEl.className = 'resource-text-sender-preview';
            senderEl.textContent = `${Utils.escapeHtml(senderName)}:`;

            const textEl = document.createElement('div');
            textEl.className = 'resource-text-content-preview';
            textEl.title = message.content || '';
            textEl.textContent = message.content || '';

            contentArea.appendChild(senderEl);
            contentArea.appendChild(textEl);
        } else if (this._currentResourceType === 'other') {
            const iconType = (message.type === 'audio' || message.fileType?.startsWith('audio/')) ? '🎵' : '📎';
            contentArea.innerHTML = `<div class="file-icon-resource">${iconType}</div>
                                     <div class="resource-name" title="${Utils.escapeHtml(message.fileName || '文件')}">
                                         ${Utils.truncateFileName(message.fileName || '文件', 15)}
                                     </div>`;
        }

        return itemEl;
    },
    /**
     * @private
     * 处理资源网格的滚动事件。
     */
    _handleResourceGridScroll: function() {
        if (!this._scrollableContainerEl || !this.resourceGridContainerEl || this._isResourceLoading || this._currentResourceType === 'date') return;

        const scrollableAreaRect = this._scrollableContainerEl.getBoundingClientRect();
        const gridRect = this.resourceGridContainerEl.getBoundingClientRect();
        const threshold = AppSettings.ui.resourcePreviewScrollThreshold || 150;

        // 当网格的底部距离可滚动区域的底部小于阈值时，加载更多
        if (gridRect.bottom <= scrollableAreaRect.bottom + threshold) {
            this._loadMoreResources(false);
        }
    },

    /**
     * @private
     * 附加资源网格的滚动事件监听器。
     */
    _attachResourceScrollListener: function() {
        if (this._resourceScrollListenerAttached) return;

        // 找到正确的滚动容器
        this._scrollableContainerEl = document.getElementById('detailsPanelContent');

        if (this._scrollableContainerEl && this._currentResourceType !== 'date') {
            this._scrollableContainerEl.addEventListener('scroll', this._boundHandleResourceGridScroll);
            this._resourceScrollListenerAttached = true;
        } else if (!this._scrollableContainerEl) {
            Utils.log("ResourcePreviewUIManager: _attachResourceScrollListener 未能找到滚动容器 #detailsPanelContent。", Utils.logLevels.WARN);
        }
    },

    /**
     * @private
     * 解绑资源网格的滚动事件监听器。
     */
    _detachResourceScrollListener: function() {
        if (this._scrollableContainerEl && this._resourceScrollListenerAttached) {
            this._scrollableContainerEl.removeEventListener('scroll', this._boundHandleResourceGridScroll);
            this._resourceScrollListenerAttached = false;
            this._scrollableContainerEl = null; // 清理引用
        }
    },

    /**
     * @private
     * 渲染日历视图。
     */
    _renderCalendar: async function() {
        if (!this.calendarContainerEl || !this._currentChatId) {
            Utils.log("ResourcePreviewUIManager: 日历容器或当前聊天ID未设置，无法渲染日历。", Utils.logLevels.WARN);
            return;
        }
        this.calendarContainerEl.innerHTML = '<div class="calendar-loading">加载日历数据...</div>';

        try {
            const datesWithMessages = await ChatManager.getDatesWithMessages(this._currentChatId);
            this.calendarContainerEl.innerHTML = '';

            const now = new Date();
            let currentDisplayMonth = this.calendarContainerEl.dataset.currentDisplayMonth ? parseInt(this.calendarContainerEl.dataset.currentDisplayMonth, 10) : now.getMonth();
            let currentDisplayYear = this.calendarContainerEl.dataset.currentDisplayYear ? parseInt(this.calendarContainerEl.dataset.currentDisplayYear, 10) : now.getFullYear();

            const calendarHeader = document.createElement('div');
            calendarHeader.className = 'calendar-header-rps';
            const prevMonthBtn = document.createElement('button');
            prevMonthBtn.textContent = '‹';
            prevMonthBtn.className = 'calendar-nav-btn-rps';
            const nextMonthBtn = document.createElement('button');
            nextMonthBtn.textContent = '›';
            nextMonthBtn.className = 'calendar-nav-btn-rps';
            const monthYearSpan = document.createElement('span');
            monthYearSpan.className = 'calendar-monthyear-rps';

            const dayCellTemplate = document.getElementById('calendar-day-cell-template').content;

            const renderMonthView = (month, year) => {
                this.calendarContainerEl.dataset.currentDisplayMonth = month;
                this.calendarContainerEl.dataset.currentDisplayYear = year;
                monthYearSpan.textContent = `${year}年 ${month + 1}月`;
                const daysInMonth = new Date(year, month + 1, 0).getDate();
                const firstDayOfMonth = new Date(year, month, 1).getDay();

                let calendarGrid = this.calendarContainerEl.querySelector('.calendar-grid-rps');
                if (calendarGrid) calendarGrid.remove();
                calendarGrid = document.createElement('div');
                calendarGrid.className = 'calendar-grid-rps';
                const fragment = document.createDocumentFragment();

                const weekdays = ['日', '一', '二', '三', '四', '五', '六'];
                weekdays.forEach(wd => {
                    const dayHeaderEl = document.createElement('div');
                    dayHeaderEl.className = 'calendar-day-header-rps';
                    dayHeaderEl.textContent = wd;
                    fragment.appendChild(dayHeaderEl);
                });

                for (let i = 0; i < firstDayOfMonth; i++) {
                    const emptyCellClone = dayCellTemplate.cloneNode(true);
                    const emptyCell = emptyCellClone.querySelector('.calendar-day-rps');
                    emptyCell.classList.add('empty');
                    fragment.appendChild(emptyCell);
                }

                for (let day = 1; day <= daysInMonth; day++) {
                    const dayCellClone = dayCellTemplate.cloneNode(true);
                    const dayCell = dayCellClone.querySelector('.calendar-day-rps');
                    dayCell.textContent = day;
                    const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

                    if (datesWithMessages.includes(dateStr)) {
                        dayCell.classList.add('has-messages-rps');
                        dayCell.title = "有消息记录";
                        dayCell.addEventListener('click', () => {
                            if (typeof ChatAreaUIManager !== 'undefined' && ChatAreaUIManager.scrollToDate) {
                                ChatAreaUIManager.scrollToDate(this._currentChatId, dateStr);
                                const appContainer = document.querySelector('.app-container');
                                const isMobileView = window.innerWidth <= 768;
                                if (isMobileView && appContainer && appContainer.classList.contains('show-details')) {
                                    if (typeof LayoutUIManager !== 'undefined') LayoutUIManager.showChatAreaLayout();
                                    if (typeof DetailsPanelUIManager !== 'undefined') DetailsPanelUIManager.hideSidePanel();
                                }
                            }
                        });
                    } else {
                        dayCell.classList.add('no-messages-rps');
                    }
                    fragment.appendChild(dayCell);
                }
                calendarGrid.appendChild(fragment);
                this.calendarContainerEl.appendChild(calendarGrid);
            };

            prevMonthBtn.onclick = () => {
                currentDisplayMonth--;
                if (currentDisplayMonth < 0) { currentDisplayMonth = 11; currentDisplayYear--; }
                renderMonthView(currentDisplayMonth, currentDisplayYear);
            };
            nextMonthBtn.onclick = () => {
                currentDisplayMonth++;
                if (currentDisplayMonth > 11) { currentDisplayMonth = 0; currentDisplayYear++; }
                renderMonthView(currentDisplayMonth, currentDisplayYear);
            };

            calendarHeader.appendChild(prevMonthBtn);
            calendarHeader.appendChild(monthYearSpan);
            calendarHeader.appendChild(nextMonthBtn);
            this.calendarContainerEl.prepend(calendarHeader);
            renderMonthView(currentDisplayMonth, currentDisplayYear);
        } catch (error) {
            Utils.log("ResourcePreviewUIManager: 渲染日历失败: " + error, Utils.logLevels.ERROR);
            this.calendarContainerEl.innerHTML = '<div class="calendar-error">无法加载日历。</div>';
        }
    }
};