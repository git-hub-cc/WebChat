/**
 * @file 管理聊天资源的预览界面
 * @description
 * 负责管理详情面板中聊天资源（如图片、视频、文本、文件）的预览UI和交互。
 * 功能包括：按类型（影像、文本、其他）分页、按日期日历导航、内容搜索和无限滚动加载。
 * @module ResourcePreviewUIManager
 * @exports {object} ResourcePreviewUIManager - 对外暴露的单例对象，提供资源预览的初始化、加载和隐藏等功能。
 * @dependency ChatManager - 用于获取特定聊天的资源消息数据。
 * @dependency ChatAreaUIManager - 用于在点击日历日期后，跳转到聊天区域的对应位置。
 * @dependency MediaUIManager - 用于渲染图片和视频的缩略图。
 * @dependency Utils - 提供通用工具函数，如日期格式化、文件名截断等。
 * @dependency NotificationUIManager - 用于显示加载失败等通知。
 * @dependency DBManager - ChatManager 间接依赖，用于从数据库查询消息。
 * @dependency AppSettings - 提供UI相关的配置，如每次加载的资源数量。
 */
const ResourcePreviewUIManager = {
    // DOM 元素引用
    // 资源预览区域的主容器
    resourcePreviewSectionEl: null,
    // 资源搜索输入框
    resourceSearchInputEl: null,
    // 资源分类标签页的容器
    resourceCategoryTabsContainerEl: null,
    // 存储各资源分类按钮的引用，键为资源类型
    resourceCategoryButtons: {}, // 例如: { imagery: btnEl, text: btnEl, ... }
    // 显示资源网格的容器
    resourceGridContainerEl: null,
    // 显示日历视图的容器
    calendarContainerEl: null,
    // 网格加载中的指示器元素
    resourceGridLoadingIndicatorEl: null,

    // 状态变量
    // 当前正在预览资源的聊天ID
    _currentChatId: null,
    // 当前选中的资源类型，默认为 'imagery'
    _currentResourceType: 'imagery',
    // 当前已加载并准备渲染的原始消息对象数组
    _resourceItems: [],
    // 已在网格中渲染的条目数量
    _resourceGridRenderedItemsCount: 0,
    // 已从数据库为当前类型/聊天获取的原始条目总数（用于分页）
    _rawItemsFetchedCount: 0,
    // 当前的搜索查询字符串
    _currentSearchQuery: '',
    // 标记资源是否正在加载中，防止重复加载
    _isResourceLoading: false,
    // 标记资源网格的滚动事件监听器是否已附加
    _resourceScrollListenerAttached: false,
    // 绑定了 this 的滚动处理函数引用，用于添加和移除监听器
    _boundHandleResourceGridScroll: null,
    // 标记上一次获取的数据在搜索过滤后是否为空，用于处理需要连续加载的场景
    _lastFetchWasEmptySearch: false,

    /**
     * 初始化资源预览UI管理器。
     * @function init
     */
    init: function() {
        this.resourcePreviewSectionEl = document.getElementById('resourcePreviewSection');
        if (!this.resourcePreviewSectionEl) {
            Utils.log("ResourcePreviewUIManager: resourcePreviewSectionEl 未找到，模块无法正常工作。", Utils.logLevels.ERROR);
            return;
        }

        // 获取所有必要的DOM元素引用
        this.resourceSearchInputEl = this.resourcePreviewSectionEl.querySelector('#resourceSearchInputDetailsPanel');
        this.resourceCategoryTabsContainerEl = this.resourcePreviewSectionEl.querySelector('#resourceCategoryTabsContainer');
        this.resourceGridContainerEl = this.resourcePreviewSectionEl.querySelector('#resourceGridContainer');
        this.calendarContainerEl = this.resourcePreviewSectionEl.querySelector('#calendarContainerDetailsPanel');
        this.resourceGridLoadingIndicatorEl = this.resourcePreviewSectionEl.querySelector('#resourceGridLoadingIndicator');

        // 绑定滚动处理函数
        this._boundHandleResourceGridScroll = this._handleResourceGridScroll.bind(this);
        // 绑定其他事件
        this.bindEvents();
        Utils.log("ResourcePreviewUIManager 初始化完成。", Utils.logLevels.INFO);
    },

    /**
     * 绑定模块所需的事件监听器。
     * @function bindEvents
     */
    bindEvents: function() {
        // 绑定搜索框的输入事件，实时触发搜索
        if (this.resourceSearchInputEl) {
            this.resourceSearchInputEl.addEventListener('input', (e) => {
                this._currentSearchQuery = e.target.value.toLowerCase().trim();
                // 仅在非日期视图下触发重载
                if (this._currentChatId && this._currentResourceType !== 'date') {
                    this._switchResourceTypeAndLoad(this._currentResourceType, true); // 强制重载
                }
            });
        }

        // 绑定资源分类标签页的点击事件
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
     * 为指定的聊天加载并显示资源，是外部调用此模块的主要入口。
     * @function loadResourcesForChat
     * @param {string} chatId - 要加载资源的聊天ID。
     */
    loadResourcesForChat: function(chatId) {
        if (!chatId || !this.resourcePreviewSectionEl) return;

        // NOTE: 此处有一个优化逻辑的注释，当前实现为每次都重载
        if (this._currentChatId === chatId && !this.resourceSearchInputEl.value && this._currentResourceType === 'imagery') {
            // 如果聊天ID和默认过滤器未变，且搜索框为空，则可能不需要完全重载
        }

        // 1. 更新当前聊天ID并显示预览区域
        this._currentChatId = chatId;
        this.resourcePreviewSectionEl.style.display = 'block';

        // 2. 附加滚动监听器以实现无限加载
        this._attachResourceScrollListener();

        // 3. 切换到（或保持）当前资源类型并强制重载数据
        this._switchResourceTypeAndLoad(this._currentResourceType, true);
        Utils.log(`ResourcePreviewUIManager: 为聊天 ${chatId} 加载资源。`, Utils.logLevels.DEBUG);
    },

    /**
     * 隐藏资源预览区域并清理相关状态。
     * @function hide
     */
    hide: function() {
        if (this.resourcePreviewSectionEl) {
            this.resourcePreviewSectionEl.style.display = 'none';
        }
        // 解绑滚动监听器以节省性能
        this._detachResourceScrollListener();

        // 清理所有状态，以便下次打开时是全新的
        this._currentChatId = null;
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
     * 切换资源预览的类型（如从影像到文本）并加载相应数据。
     * @function _switchResourceTypeAndLoad
     * @private
     * @param {string} resourceType - 目标资源类型。
     * @param {boolean} [forceReload=false] - 是否强制重载，即使类型未变。
     */
    _switchResourceTypeAndLoad: function(resourceType, forceReload = false) {
        if (!this._currentChatId || (!this.resourceGridContainerEl && resourceType !== 'date') || (!this.calendarContainerEl && resourceType === 'date')) return;
        Utils.log(`ResourcePreviewUIManager: 切换到资源类型: ${resourceType} for chat ${this._currentChatId}`, Utils.logLevels.DEBUG);

        const prevResourceType = this._currentResourceType;
        this._currentResourceType = resourceType;

        // 1. 更新标签页的激活状态
        for (const type in this.resourceCategoryButtons) {
            if (this.resourceCategoryButtons[type]) {
                this.resourceCategoryButtons[type].classList.toggle('active', type === resourceType);
            }
        }

        // 2. 根据资源类型，显示网格视图或日历视图
        if (this.resourceGridContainerEl) {
            this.resourceGridContainerEl.style.display = (resourceType !== 'date') ? 'grid' : 'none';
        }
        if (this.calendarContainerEl) {
            this.calendarContainerEl.style.display = (resourceType === 'date') ? 'block' : 'none';
        }
        if (this.resourceGridLoadingIndicatorEl) {
            this.resourceGridLoadingIndicatorEl.style.display = 'none';
        }

        // 3. 处理不同视图的逻辑
        if (resourceType === 'date') {
            this._renderCalendar();
            this._detachResourceScrollListener(); // 日历视图不需要无限滚动
            return;
        } else {
            this._attachResourceScrollListener(); // 网格视图需要无限滚动
        }

        // 4. 如果需要重载，则清空旧数据
        if (forceReload || prevResourceType !== resourceType) {
            // 清理旧的 Object URL 以释放内存
            this._resourceItems.forEach(item => {
                if(item.fileType && (item.fileType.startsWith('image/') || item.fileType.startsWith('video/'))) {
                    const itemEl = this.resourceGridContainerEl?.querySelector(`.resource-preview-item[data-message-id="${item.id}"] .thumbnail-placeholder-resource`);
                    if(itemEl && itemEl.dataset.objectUrlForRevoke){
                        URL.revokeObjectURL(itemEl.dataset.objectUrlForRevoke);
                        delete itemEl.dataset.objectUrlForRevoke;
                    }
                }
            });
            // 重置状态
            this._resourceItems = [];
            this._resourceGridRenderedItemsCount = 0;
            this._rawItemsFetchedCount = 0;
            if (this.resourceGridContainerEl) this.resourceGridContainerEl.innerHTML = '';
        }
        this._lastFetchWasEmptySearch = false;
        // 5. 开始加载第一批资源
        this._loadMoreResources(true);
    },

    /**
     * 异步加载更多资源消息并渲染到网格中。
     * @function _loadMoreResources
     * @private
     * @param {boolean} [isInitialLoad=false] - 标记是否为初始加载。
     */
    _loadMoreResources: async function(isInitialLoad = false) {
        if (this._isResourceLoading || !this._currentChatId || this._currentResourceType === 'date') return;
        this._isResourceLoading = true;
        if (this.resourceGridLoadingIndicatorEl) this.resourceGridLoadingIndicatorEl.style.display = 'flex';

        try {
            // 1. 从 ChatManager 获取一批资源消息
            const newRawItems = await ChatManager.getMessagesWithResources(
                this._currentChatId, this._currentResourceType,
                this._rawItemsFetchedCount,
                AppSettings.ui.resourceGridLoadBatchSize
            );

            if (newRawItems && newRawItems.length > 0) {
                this._rawItemsFetchedCount += newRawItems.length;
                let itemsToRenderThisBatch = newRawItems;

                // 2. 如果有搜索词，则在前端过滤获取到的数据
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

                // 3. 如果有需要渲染的条目，则创建DOM并添加到网格中
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
                    // 4. 如果有搜索词，但当前批次过滤后为空，则自动加载下一批
                } else if (newRawItems.length > 0 && this._currentSearchQuery) {
                    if(this.resourceGridContainerEl && this.resourceGridContainerEl.scrollHeight <= this.resourceGridContainerEl.clientHeight + 100) {
                        if (!this._lastFetchWasEmptySearch) {
                            this._lastFetchWasEmptySearch = true;
                            // 延迟一小段时间再加载，避免瞬间多次请求
                            setTimeout(() => this._loadMoreResources(false), 50);
                        } else {
                            this._lastFetchWasEmptySearch = false; // 避免无限循环
                        }
                    } else {
                        this._lastFetchWasEmptySearch = false;
                    }
                }

                // 5. 如果是初始加载且没有任何结果，显示空状态提示
                if (isInitialLoad && this._resourceItems.length === 0 && this.resourceGridContainerEl) {
                    const emptyMsg = document.createElement('div');
                    emptyMsg.className = 'resource-grid-empty-message';
                    emptyMsg.textContent = this._currentSearchQuery ? '未找到符合搜索条件的资源。' : '此分类下暂无资源。';
                    this.resourceGridContainerEl.innerHTML = '';
                    this.resourceGridContainerEl.appendChild(emptyMsg);
                }
            } else if (isInitialLoad && this._resourceItems.length === 0) {
                // 数据库中没有更多数据，并且是首次加载，显示空状态
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
     * 创建单个资源预览项的DOM元素。
     * @function _createResourcePreviewItem
     * @private
     * @param {object} message - 包含资源信息的消息对象。
     * @returns {HTMLElement} 创建的DOM元素。
     */
    _createResourcePreviewItem: function(message) {
        // 1. 从模板克隆元素
        const template = document.getElementById('resource-preview-item-template').content.cloneNode(true);
        const itemEl = template.querySelector('.resource-preview-item');
        const contentArea = template.querySelector('.resource-content-area');
        const timestampEl = template.querySelector('.resource-timestamp');

        itemEl.dataset.messageId = message.id;
        timestampEl.textContent = Utils.formatDate(new Date(message.timestamp), false);

        itemEl.addEventListener('click', () => {
            Store.dispatch('OPEN_CHAT', { chatId: this._currentChatId });

            if (typeof ChatAreaUIManager !== 'undefined' && ChatAreaUIManager.scrollToMessage) {
                setTimeout(() => {
                    ChatAreaUIManager.scrollToMessage(message.id);
                }, 50);
            }
        });

        // 2. 根据资源类型填充内容区域
        if (this._currentResourceType === 'imagery') {
            const placeholderDiv = document.createElement('div');
            placeholderDiv.className = 'thumbnail-placeholder-resource';
            const icon = message.fileType?.startsWith('video/') ? '🎬' : '🖼️';
            placeholderDiv.innerHTML = icon; // 先显示一个图标
            contentArea.appendChild(placeholderDiv);

            // 延迟渲染缩略图，提升滚动性能
            setTimeout(() => {
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
     * 处理资源网格的滚动事件，用于触发无限加载。
     * @function _handleResourceGridScroll
     * @private
     */
    _handleResourceGridScroll: function() {
        if (!this.resourceGridContainerEl || this._isResourceLoading || this._currentResourceType === 'date') return;
        const { scrollTop, scrollHeight, clientHeight } = this.resourceGridContainerEl;
        // 当滚动到底部附近时，加载更多资源
        if (scrollHeight - scrollTop - clientHeight < AppSettings.ui.resourceGridScrollThreshold) {
            this._loadMoreResources(false);
        }
    },

    /**
     * 附加资源网格的滚动事件监听器。
     * @function _attachResourceScrollListener
     * @private
     */
    _attachResourceScrollListener: function() {
        if (this.resourceGridContainerEl && !this._resourceScrollListenerAttached && this._currentResourceType !== 'date') {
            this.resourceGridContainerEl.addEventListener('scroll', this._boundHandleResourceGridScroll);
            this._resourceScrollListenerAttached = true;
        }
    },

    /**
     * 解绑资源网格的滚动事件监听器。
     * @function _detachResourceScrollListener
     * @private
     */
    _detachResourceScrollListener: function() {
        if (this.resourceGridContainerEl && this._resourceScrollListenerAttached) {
            this.resourceGridContainerEl.removeEventListener('scroll', this._boundHandleResourceGridScroll);
            this._resourceScrollListenerAttached = false;
        }
    },

    /**
     * 异步渲染日历视图。
     * @function _renderCalendar
     * @private
     */
    _renderCalendar: async function() {
        if (!this.calendarContainerEl || !this._currentChatId) {
            Utils.log("ResourcePreviewUIManager: 日历容器或当前聊天ID未设置，无法渲染日历。", Utils.logLevels.WARN);
            return;
        }
        this.calendarContainerEl.innerHTML = '<div class="calendar-loading">加载日历数据...</div>';

        try {
            // 1. 获取该聊天所有有消息的日期
            const datesWithMessages = await ChatManager.getDatesWithMessages(this._currentChatId);
            this.calendarContainerEl.innerHTML = '';

            const now = new Date();
            let currentDisplayMonth = this.calendarContainerEl.dataset.currentDisplayMonth ? parseInt(this.calendarContainerEl.dataset.currentDisplayMonth, 10) : now.getMonth();
            let currentDisplayYear = this.calendarContainerEl.dataset.currentDisplayYear ? parseInt(this.calendarContainerEl.dataset.currentDisplayYear, 10) : now.getFullYear();

            // 2. 创建日历头部（月份切换按钮和年月显示）
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

            // 3. 定义渲染指定月份视图的函数
            const renderMonthView = (month, year) => {
                this.calendarContainerEl.dataset.currentDisplayMonth = month;
                this.calendarContainerEl.dataset.currentDisplayYear = year;
                monthYearSpan.textContent = `${year}年 ${month + 1}月`;
                const daysInMonth = new Date(year, month + 1, 0).getDate();
                const firstDayOfMonth = new Date(year, month, 1).getDay(); // 周日是0

                let calendarGrid = this.calendarContainerEl.querySelector('.calendar-grid-rps');
                if (calendarGrid) calendarGrid.remove();
                calendarGrid = document.createElement('div');
                calendarGrid.className = 'calendar-grid-rps';

                // 渲染星期表头
                const weekdays = ['日', '一', '二', '三', '四', '五', '六'];
                weekdays.forEach(wd => {
                    const dayHeaderEl = document.createElement('div');
                    dayHeaderEl.className = 'calendar-day-header-rps';
                    dayHeaderEl.textContent = wd;
                    calendarGrid.appendChild(dayHeaderEl);
                });

                // 渲染月份第一天前的空白单元格
                for (let i = 0; i < firstDayOfMonth; i++) {
                    const emptyCell = document.createElement('div');
                    emptyCell.className = 'calendar-day-rps empty';
                    calendarGrid.appendChild(emptyCell);
                }

                // 渲染当月的每一天
                for (let day = 1; day <= daysInMonth; day++) {
                    const dayCell = document.createElement('div');
                    dayCell.className = 'calendar-day-rps';
                    dayCell.textContent = day;
                    const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

                    // 如果当天有消息，则高亮并添加点击事件
                    if (datesWithMessages.includes(dateStr)) {
                        dayCell.classList.add('has-messages-rps');
                        dayCell.title = "有消息记录";
                        dayCell.addEventListener('click', () => {
                            if (typeof ChatAreaUIManager !== 'undefined' && ChatAreaUIManager.scrollToDate) {
                                ChatAreaUIManager.scrollToDate(this._currentChatId, dateStr);
                                // NOTE: 此处为重构后的代码，表明未来可能通过状态管理来切换视图
                                const isMobileView = window.innerWidth <= 768;
                                if (isMobileView) {
                                    // 在移动端，点击日期后，应该切换回聊天视图
                                    Store.dispatch('OPEN_CHAT', { chatId: this._currentChatId });
                                }
                            }
                        });
                    } else {
                        dayCell.classList.add('no-messages-rps');
                    }
                    calendarGrid.appendChild(dayCell);
                }
                this.calendarContainerEl.appendChild(calendarGrid);
            };

            // 4. 绑定月份切换按钮的事件
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

            // 5. 组装并渲染初始视图
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