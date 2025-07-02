/**
 * @file 管理主聊天区域的UI元素和交互
 * @description 该文件负责管理主聊天区域的全部UI逻辑，包括聊天头部、消息列表（支持虚拟滚动）、输入框、以及各类功能按钮（如通话、截图、发送等）。它还实现了消息的上下文菜单、@提及、文件拖拽与粘贴上传等高级交互功能。通过订阅Store的状态变化，自动更新UI，实现数据与视图的单向绑定。
 * @module ChatAreaUIManager
 * @exports {object} ChatAreaUIManager - 对外暴露的单例对象，包含管理聊天区域UI的所有方法。
 * @dependency LayoutUIManager, MessageManager, VideoCallManager, ChatManager, ConnectionManager, UserManager, DetailsPanelUIManager, NotificationUIManager, Utils, MediaManager, PeopleLobbyManager, EventEmitter, UIManager, AppSettings, Store, ActionCreators
 */
const ChatAreaUIManager = {
    // --- 变量排序：1. DOM 引用 ---
    // 主要聊天区容器
    chatAreaEl: null,
    // 聊天头部 - 标题元素
    chatHeaderTitleEl: null,
    // 聊天头部 - 状态文本元素
    chatHeaderStatusEl: null,
    // 聊天头部 - 头像元素
    chatHeaderAvatarEl: null,
    // 聊天头部 - 主容器
    chatHeaderMainEl: null,
    // 消息显示盒子
    chatBoxEl: null,
    // “未选择聊天”的占位界面
    noChatSelectedScreenEl: null,
    // 消息输入框
    messageInputEl: null,
    // 发送按钮
    sendButtonEl: null,
    // 附件按钮
    attachButtonEl: null,
    // 语音消息按钮
    voiceButtonEl: null,
    // 视频通话按钮
    videoCallButtonEl: null,
    // 音频通话按钮
    audioCallButtonEl: null,
    // 屏幕共享按钮
    screenShareButtonEl: null,
    // 群成员（大厅）按钮
    peopleLobbyButtonEl: null,
    // 截图按钮
    screenshotMainBtnEl: null,
    // Emoji和贴纸按钮
    emojiStickerBtnEl: null,
    // 聊天头部 - 可点击的信息区域
    chatInfoMainEl: null,

    // --- 变量排序：2. 上下文菜单与提及建议相关UI ---
    // 消息右键上下文菜单元素
    contextMenuEl: null,
    // 当前激活上下文菜单的消息DOM元素
    activeContextMenuMessageElement: null,
    // 上下文菜单自动隐藏的定时器
    contextMenuAutoHideTimer: null,
    // AI @提及 建议列表的容器
    aiMentionSuggestionsEl: null,

    // --- 变量排序：3. 状态变量（虚拟滚动、UI状态等） ---
    // 当前聊天窗口的ID
    _currentChatId: null,
    // 当前聊天窗口加载的所有消息数组
    _allMessagesForCurrentChat: [],
    // 已渲染消息中，最旧一条消息在数组中的索引
    _renderedOldestMessageArrayIndex: -1,
    // 已渲染消息中，最新一条消息在数组中的索引
    _renderedNewestMessageArrayIndex: -1,
    // 标记是否正在加载更旧的消息
    _isLoadingOlderMessages: false,
    // 标记是否正在加载更新的消息
    _isLoadingNewerMessages: false,
    // “正在加载”指示器的DOM元素
    _loadingIndicatorEl: null,
    // 标记滚动事件监听器是否已附加
    _scrollListenerAttached: false,
    // 滚动事件的防抖定时器
    _debounceScrollTimer: null,
    // 绑定了this的滚动处理函数
    _boundHandleChatScroll: null,
    // 上次记录的滚动条位置
    _lastScrollTop: 0,
    // “滚动到最新消息”按钮的DOM元素
    _scrollToLatestBtnEl: null,

    /**
     * 初始化模块，获取所有需要的 DOM 元素引用并绑定核心事件。
     * @function init
     * @returns {void}
     */
    init: function () {
        // 1. 获取所有DOM元素
        this.chatAreaEl = document.getElementById('chatArea');
        this.chatHeaderTitleEl = document.getElementById('currentChatTitleMain');
        this.chatHeaderStatusEl = document.getElementById('currentChatStatusMain');
        this.chatHeaderAvatarEl = document.getElementById('currentChatAvatarMain');
        this.chatHeaderMainEl = document.querySelector('.chat-header-main');
        this.chatBoxEl = document.getElementById('chatBox');
        this.noChatSelectedScreenEl = document.getElementById('noChatSelectedScreen');
        this.messageInputEl = document.getElementById('messageInput');
        this.sendButtonEl = document.getElementById('sendButtonMain');
        this.attachButtonEl = document.getElementById('attachBtnMain');
        this.voiceButtonEl = document.getElementById('voiceButtonMain');
        this.videoCallButtonEl = document.getElementById('videoCallButtonMain');
        this.audioCallButtonEl = document.getElementById('audioCallButtonMain');
        this.screenShareButtonEl = document.getElementById('screenShareButtonMain');
        this.peopleLobbyButtonEl = document.getElementById('peopleLobbyButtonMain');
        this.screenshotMainBtnEl = document.getElementById('screenshotMainBtn');
        this.emojiStickerBtnEl = document.getElementById('emojiStickerBtn');
        this.chatInfoMainEl = document.querySelector('.chat-header-main .chat-info-main');

        // 2. 初始化UI组件
        this._initContextMenu();
        this._initAiMentionSuggestions();

        // 3. 创建加载指示器元素
        if (this.chatBoxEl) {
            this._loadingIndicatorEl = document.createElement('div');
            this._loadingIndicatorEl.className = 'loading-indicator-older-messages';
            this._loadingIndicatorEl.innerHTML = '<div class="spinner"></div>';
        }

        // 4. 绑定滚动处理函数并绑定事件
        this._boundHandleChatScroll = this._debouncedHandleChatScroll.bind(this);
        this.bindEvents();

        // 5. 订阅 Store 的状态变化以自动更新UI
        Store.subscribe(this.handleStateChange.bind(this));
    },

    /**
     * 处理从 Store 传来的状态变化，根据新旧状态差异更新UI。
     * @function handleStateChange
     * @param {object} newState - 最新的应用状态。
     * @param {object} oldState - 变化前的应用状态。
     * @returns {void}
     */
    handleStateChange: function(newState, oldState) {
        // 1. 检查当前聊天ID是否发生变化
        if (newState.currentChatId !== this._currentChatId) {
            // BUGFIX: 必须先更新内部的 _currentChatId，因为 setupForChat 依赖它
            this._currentChatId = newState.currentChatId;

            if (this._currentChatId) {
                // 打开新聊天
                this._showChatArea();
                this.setupForChat(this._currentChatId);
                this.enableChatInterface(true);
            } else {
                // 关闭当前聊天，显示占位图
                this._showNoChatSelected();
            }
        }

        // 2. 无论聊天ID是否变化，都根据最新状态更新头部信息
        this._updateChatHeaderBasedOnState(newState);

        // 3. 检查是否有新消息需要处理
        // NOTE: 此处为简化逻辑，未来可优化为仅增量渲染新消息
        if (newState.lastMessageUpdate.timestamp > oldState.lastMessageUpdate.timestamp &&
            newState.lastMessageUpdate.chatId === this._currentChatId) {
            const latestMessage = ChatManager.chats[this._currentChatId]?.slice(-1)[0];
            this.handleNewMessageForCurrentChat(latestMessage);
        }
    },

    /**
     * 初始化AI提及建议的UI元素并附加到DOM。
     * @private
     * @function _initAiMentionSuggestions
     * @returns {void}
     */
    _initAiMentionSuggestions: function() {
        this.aiMentionSuggestionsEl = document.createElement('div');
        this.aiMentionSuggestionsEl.id = 'aiMentionSuggestions';
        this.aiMentionSuggestionsEl.className = 'ai-mention-suggestions';
        this.aiMentionSuggestionsEl.style.display = 'none';
        this.aiMentionSuggestionsEl.style.position = 'absolute';

        const chatInputContainer = this.messageInputEl ? this.messageInputEl.closest('.chat-input-container') : null;
        if (chatInputContainer) {
            // 将建议列表添加到输入框的父容器，以便精确定位
            chatInputContainer.style.position = 'relative'; // 确保父容器是定位基准
            chatInputContainer.appendChild(this.aiMentionSuggestionsEl);
        } else if (this.messageInputEl && this.messageInputEl.parentNode) {
            // 降级方案
            Utils.log("ChatAreaUIManager: 无法找到 .chat-input-container，尝试添加到输入框的父级。", Utils.logLevels.WARN);
            this.messageInputEl.parentNode.style.position = 'relative';
            this.messageInputEl.parentNode.appendChild(this.aiMentionSuggestionsEl);
        } else {
            Utils.log("ChatAreaUIManager: 无法找到附加提及建议列表的合适位置。", Utils.logLevels.ERROR);
            return;
        }

        // 添加全局点击事件，用于在点击外部区域时隐藏建议列表
        document.addEventListener('click', (event) => {
            if (this.aiMentionSuggestionsEl && this.aiMentionSuggestionsEl.style.display === 'block' &&
                !this.aiMentionSuggestionsEl.contains(event.target) && event.target !== this.messageInputEl) {
                this.aiMentionSuggestionsEl.style.display = 'none';
            }
        });
    },

    /**
     * 绑定所有UI元素的事件监听器。
     * @function bindEvents
     * @returns {void}
     */
    bindEvents: function () {
        // 消息输入框事件
        if (this.messageInputEl) {
            this.messageInputEl.addEventListener('keydown', (e) => {
                // Enter键发送消息
                if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey) {
                    e.preventDefault();
                    ActionCreators.sendMessageRequest();
                    if (this.aiMentionSuggestionsEl) this.aiMentionSuggestionsEl.style.display = 'none';
                } else if (e.key === 'Escape') {
                    // Esc键隐藏提及建议
                    if (this.aiMentionSuggestionsEl) this.aiMentionSuggestionsEl.style.display = 'none';
                }
            });
            this.messageInputEl.addEventListener('input', this._handleMessageInputForMentions.bind(this));
            this.messageInputEl.addEventListener('paste', this._handlePasteEvent.bind(this));
        }

        // 发送按钮点击事件
        if (this.sendButtonEl) {
            this.sendButtonEl.addEventListener('click', () => {
                ActionCreators.sendMessageRequest();
                if (this.aiMentionSuggestionsEl) this.aiMentionSuggestionsEl.style.display = 'none';
            });
        }

        // 附件按钮点击事件
        if (this.attachButtonEl) {
            this.attachButtonEl.addEventListener('click', () => {
                const fileInput = document.getElementById('fileInput');
                if (fileInput) fileInput.click();
            });
        }

        // 语音按钮事件（兼容触摸和鼠标）
        if (this.voiceButtonEl) {
            if ('ontouchstart' in window) { // 触摸设备
                this.voiceButtonEl.addEventListener('touchstart', (e) => { e.preventDefault(); if (!this.voiceButtonEl.disabled) ActionCreators.startRecordingRequest(); });
                this.voiceButtonEl.addEventListener('touchend', (e) => { e.preventDefault(); if (!this.voiceButtonEl.disabled) ActionCreators.stopRecordingRequest(); });
            } else { // 桌面设备
                this.voiceButtonEl.addEventListener('mousedown', () => { if (!this.voiceButtonEl.disabled) ActionCreators.startRecordingRequest(); });
                this.voiceButtonEl.addEventListener('mouseup', () => { if (!this.voiceButtonEl.disabled) ActionCreators.stopRecordingRequest(); });
                this.voiceButtonEl.addEventListener('mouseleave', () => { // 鼠标移开时也停止录音
                    if (!this.voiceButtonEl.disabled && MediaManager.mediaRecorder && MediaManager.mediaRecorder.state === 'recording') {
                        ActionCreators.stopRecordingRequest();
                    }
                });
            }
        }

        // 截图按钮点击事件
        if (this.screenshotMainBtnEl) {
            this.screenshotMainBtnEl.addEventListener('click', () => ActionCreators.captureScreenRequest());
        }

        // 通话相关按钮点击事件
        if (this.videoCallButtonEl) {
            this.videoCallButtonEl.addEventListener('click', () => { if (!this.videoCallButtonEl.disabled) ActionCreators.initiateCallRequest({ peerId: ChatManager.currentChatId, type: 'video' }); });
        }
        if (this.audioCallButtonEl) {
            this.audioCallButtonEl.addEventListener('click', () => { if (!this.audioCallButtonEl.disabled) ActionCreators.initiateCallRequest({ peerId: ChatManager.currentChatId, type: 'audio' }); });
        }
        if (this.screenShareButtonEl) {
            this.screenShareButtonEl.addEventListener('click', () => { if (!this.screenShareButtonEl.disabled) ActionCreators.initiateCallRequest({ peerId: ChatManager.currentChatId, type: 'screen' }); });
        }

        // 群成员（大厅）按钮点击事件
        if (this.peopleLobbyButtonEl) {
            this.peopleLobbyButtonEl.addEventListener('click', () => {
                Store.dispatch('TOGGLE_DETAILS_PANEL', { content: 'lobby' });
            });
        }

        // 聊天信息区域点击事件
        if (this.chatInfoMainEl) {
            this.chatInfoMainEl.addEventListener('click', () => {
                const state = Store.getState();
                if (state.currentChatId) {
                    Store.dispatch('TOGGLE_DETAILS_PANEL', { content: 'details' });
                }
            });
        }

        // 文件拖拽上传逻辑
        if (this.chatAreaEl) {
            let dragCounter = 0; // 计数器防止子元素触发dragleave
            // 文件拖入区域
            this.chatAreaEl.addEventListener('dragenter', (e) => {
                e.preventDefault(); e.stopPropagation();
                if (ChatManager.currentChatId && e.dataTransfer && e.dataTransfer.types.includes('Files')) {
                    dragCounter++;
                    if (dragCounter === 1) this.chatAreaEl.classList.add('drag-over');
                }
            });
            // 文件在区域内移动
            this.chatAreaEl.addEventListener('dragover', (e) => {
                e.preventDefault(); e.stopPropagation();
                if (ChatManager.currentChatId && e.dataTransfer && e.dataTransfer.types.includes('Files')) {
                    e.dataTransfer.dropEffect = 'copy';
                } else {
                    e.dataTransfer.dropEffect = 'none';
                }
            });
            // 文件拖离区域
            this.chatAreaEl.addEventListener('dragleave', (e) => {
                e.preventDefault(); e.stopPropagation();
                dragCounter--;
                if (dragCounter === 0) this.chatAreaEl.classList.remove('drag-over');
            });
            // 文件在区域内释放
            this.chatAreaEl.addEventListener('drop', (e) => {
                e.preventDefault(); e.stopPropagation();
                dragCounter = 0;
                this.chatAreaEl.classList.remove('drag-over');
                if (!ChatManager.currentChatId) {
                    NotificationUIManager.showNotification('发送文件前请先选择一个聊天。', 'warning');
                    return;
                }
                if (e.dataTransfer && e.dataTransfer.files.length > 0) {
                    const file = e.dataTransfer.files[0];
                    MediaManager.processFile(file);
                }
            });
        }

        // 消息盒子事件（用于上下文菜单）
        if (this.chatBoxEl) {
            this.chatBoxEl.addEventListener('contextmenu', this._handleMessageInteraction.bind(this));
            this.chatBoxEl.addEventListener('dblclick', function (event) {
                const messageElement = event.target.closest('.message:not(.system):not(.retracted)');
                if (messageElement) {
                    // 避免在链接、按钮等可交互元素上触发
                    if (event.target.closest('a, button, input, textarea, select, .file-preview-img, .play-voice-btn, .download-btn, video[controls], audio[controls]')) return;
                    this._showContextMenu(event, messageElement);
                }
            }.bind(this));
        }
    },

    /**
     * 处理粘贴事件，用于从剪贴板获取并处理文件。
     * @private
     * @function _handlePasteEvent
     * @param {ClipboardEvent} event - 粘贴事件对象。
     * @returns {Promise<void>}
     */
    _handlePasteEvent: async function(event) {
        if (!ChatManager.currentChatId || (this.messageInputEl && this.messageInputEl.disabled)) {
            return; // 聊天未激活或输入框禁用，则忽略
        }

        const items = (event.clipboardData || event.originalEvent?.clipboardData)?.items;
        if (!items) {
            return; // 无法访问剪贴板
        }

        // 处理流程如下：
        // 1. 遍历剪贴板中的所有项目
        // 2. 如果项目是文件类型 (kind === 'file')，则获取文件对象
        // 3. 阻止默认的粘贴行为（如粘贴文本路径）
        // 4. 检查当前是否已有待发送的文件或语音，如有则提示用户
        // 5. 调用 MediaManager 处理文件，生成预览
        // 6. 标记已处理并跳出循环
        let fileFoundAndProcessed = false;
        for (let i = 0; i < items.length; i++) {
            const item = items[i];
            if (item.kind === 'file') {
                const file = item.getAsFile();
                if (file) {
                    event.preventDefault();
                    Utils.log(`ChatAreaUIManager: 从剪贴板粘贴文件: ${file.name}`, Utils.logLevels.INFO);

                    if (MessageManager.selectedFile || MessageManager.audioData) {
                        NotificationUIManager.showNotification('已有待发送的内容，请先发送或取消。', 'warning');
                        return;
                    }

                    await MediaManager.processFile(file);
                    fileFoundAndProcessed = true;
                    break;
                }
            }
        }
    },

    /**
     * 处理消息输入框的输入事件，用于检测和显示 @ 提及建议。
     * @private
     * @function _handleMessageInputForMentions
     * @returns {void}
     */
    _handleMessageInputForMentions: function() {
        // 1. 检查是否满足显示提及的条件（在群聊中）
        if (!this.messageInputEl || !this.aiMentionSuggestionsEl || !ChatManager.currentChatId || !ChatManager.currentChatId.startsWith('group_')) {
            if (this.aiMentionSuggestionsEl) this.aiMentionSuggestionsEl.style.display = 'none';
            return;
        }

        const text = this.messageInputEl.value;
        const cursorPos = this.messageInputEl.selectionStart;
        const textBeforeCursor = text.substring(0, cursorPos);

        // 2. 查找光标前最后一个'@'符号
        const lastAtSymbolIndex = textBeforeCursor.lastIndexOf('@');

        if (lastAtSymbolIndex !== -1) {
            // 3. 获取@符号后的查询词
            const query = textBeforeCursor.substring(lastAtSymbolIndex + 1).toLowerCase();
            const lengthOfAtAndQuery = textBeforeCursor.length - lastAtSymbolIndex;

            // 4. 在当前群成员中查找匹配的AI成员
            const group = GroupManager.groups[ChatManager.currentChatId];
            if (group && group.members) {
                const aiMembers = group.members.reduce((acc, memberId) => {
                    const contact = UserManager.contacts[memberId];
                    if (contact && contact.isAI && contact.name.toLowerCase().includes(query)) {
                        acc.push(contact);
                    }
                    return acc;
                }, []);

                // 5. 如果找到匹配项，则填充并显示建议列表
                if (aiMembers.length > 0) {
                    this._populateAiMentionSuggestions(aiMembers, lengthOfAtAndQuery);
                } else {
                    this.aiMentionSuggestionsEl.style.display = 'none';
                }
            } else {
                this.aiMentionSuggestionsEl.style.display = 'none';
            }
        } else {
            this.aiMentionSuggestionsEl.style.display = 'none';
        }
    },

    /**
     * 根据匹配的AI联系人，填充并显示提及建议列表。
     * @private
     * @function _populateAiMentionSuggestions
     * @param {Array<object>} aiContacts - 匹配的AI联系人对象数组。
     * @param {number} lengthOfAtAndQuery - `@`符号加上查询词的长度，用于后续文本替换。
     * @returns {void}
     */
    _populateAiMentionSuggestions: function(aiContacts, lengthOfAtAndQuery) {
        if (!this.aiMentionSuggestionsEl || !this.messageInputEl) return;

        this.aiMentionSuggestionsEl.innerHTML = '';
        const fragment = document.createDocumentFragment();
        const template = document.getElementById('ai-mention-suggestion-item-template').content;

        // 1. 遍历联系人，为每人创建一个建议项
        aiContacts.forEach(contact => {
            const itemClone = template.cloneNode(true);
            const itemEl = itemClone.querySelector('.mention-suggestion-item');
            const avatarEl = itemClone.querySelector('.mention-suggestion-avatar');
            const nameEl = itemClone.querySelector('.mention-suggestion-name');

            // 设置头像和名称
            if (contact.avatarUrl) {
                const img = document.createElement('img');
                img.src = contact.avatarUrl;
                img.alt = contact.name.charAt(0);
                img.loading = "lazy";
                avatarEl.appendChild(img);
            } else {
                avatarEl.textContent = contact.name.charAt(0).toUpperCase();
            }
            nameEl.textContent = contact.name;

            // 2. 为建议项绑定点击事件
            itemEl.addEventListener('click', () => {
                const currentText = this.messageInputEl.value;
                const cursorPos = this.messageInputEl.selectionStart;
                const textBefore = currentText.substring(0, cursorPos - lengthOfAtAndQuery);
                const textAfter = currentText.substring(cursorPos);
                const mentionText = '@' + contact.name + ' ';
                // 替换@查询词为完整的@用户名
                this.messageInputEl.value = textBefore + mentionText + textAfter;
                this.messageInputEl.focus();
                // 将光标移动到提及文本之后
                const newCursorPos = textBefore.length + mentionText.length;
                this.messageInputEl.setSelectionRange(newCursorPos, newCursorPos);
                this.aiMentionSuggestionsEl.style.display = 'none';
            });
            fragment.appendChild(itemEl);
        });

        this.aiMentionSuggestionsEl.appendChild(fragment);

        // 3. 定位建议列表，使其显示在输入框上方
        const inputRow = this.messageInputEl.closest('.input-row');
        if (inputRow) {
            const inputRowHeight = inputRow.offsetHeight;
            this.aiMentionSuggestionsEl.style.bottom = `${inputRowHeight}px`;
        } else {
            this.aiMentionSuggestionsEl.style.bottom = '100%';
        }
        this.aiMentionSuggestionsEl.style.left = '0';
        this.aiMentionSuggestionsEl.style.right = '0';
        this.aiMentionSuggestionsEl.style.width = '300px';
        this.aiMentionSuggestionsEl.style.display = 'block';
    },

    /**
     * 初始化消息的右键/双击上下文菜单。
     * @private
     * @function _initContextMenu
     * @returns {void}
     */
    _initContextMenu: function () {
        this.contextMenuEl = document.createElement('div');
        this.contextMenuEl.id = 'customMessageContextMenu';
        this.contextMenuEl.className = 'custom-context-menu';
        this.contextMenuEl.style.display = 'none';
        document.body.appendChild(this.contextMenuEl);

        // 全局点击时隐藏菜单
        document.addEventListener('click', function (event) {
            if (this.contextMenuEl && this.contextMenuEl.style.display === 'block' && !this.contextMenuEl.contains(event.target)) {
                this._hideContextMenu();
            }
        }.bind(this));

        // 按下Esc键时隐藏菜单
        document.addEventListener('keydown', function (event) {
            if (event.key === 'Escape' && this.contextMenuEl && this.contextMenuEl.style.display === 'block') {
                this._hideContextMenu();
            }
        }.bind(this));
    },

    /**
     * 处理消息元素的交互事件（右键点击或双击）。
     * @private
     * @function _handleMessageInteraction
     * @param {MouseEvent} event - 鼠标事件对象。
     * @returns {void}
     */
    _handleMessageInteraction: function (event) {
        // 确保点击的是一个有效的消息元素
        const messageElement = event.target.closest('.message:not(.system):not(.retracted)');
        if (!messageElement) return;

        if (event.type === 'contextmenu') {
            event.preventDefault();
            this._showContextMenu(event, messageElement);
        }
    },

    /**
     * 在指定位置显示消息的上下文菜单。
     * @private
     * @function _showContextMenu
     * @param {MouseEvent} event - 触发菜单的事件对象，用于定位。
     * @param {HTMLElement} messageElement - 被操作的消息元素。
     * @returns {void}
     */
    _showContextMenu: function (event, messageElement) {
        if (!this.contextMenuEl || !messageElement) return;
        this._clearContextMenuAutoHideTimer(); // 清除旧的隐藏定时器
        this.contextMenuEl.innerHTML = '';
        this.activeContextMenuMessageElement = messageElement;

        const messageId = messageElement.dataset.messageId;
        const messageTimestamp = parseInt(messageElement.dataset.timestamp, 10);
        const isMyMessage = messageElement.classList.contains('sent');
        if (!messageId) {
            this._hideContextMenu();
            return;
        }

        // 1. 创建“删除”按钮
        const deleteBtn = document.createElement('button');
        deleteBtn.textContent = '删除';
        deleteBtn.className = 'context-menu-button';
        deleteBtn.onclick = function () {
            this._clearContextMenuAutoHideTimer();
            MessageManager.deleteMessageLocally(messageId);
            this._hideContextMenu();
        }.bind(this);
        this.contextMenuEl.appendChild(deleteBtn);

        // 2. 如果是自己的消息且在可撤回时间内，创建“撤回”按钮
        if (isMyMessage && !isNaN(messageTimestamp) && (Date.now() - messageTimestamp < AppSettings.ui.messageRetractionWindow)) {
            const retractBtn = document.createElement('button');
            retractBtn.textContent = '撤回';
            retractBtn.className = 'context-menu-button';
            retractBtn.onclick = function () {
                this._clearContextMenuAutoHideTimer();
                MessageManager.requestRetractMessage(messageId);
                this._hideContextMenu();
            }.bind(this);
            this.contextMenuEl.appendChild(retractBtn);
        }

        // 如果没有任何可操作按钮，则不显示菜单
        if (this.contextMenuEl.children.length === 0) {
            this._hideContextMenu();
            return;
        }

        // 3. 计算并设置菜单位置，防止菜单超出窗口边界
        this.contextMenuEl.style.display = 'block'; // 先显示以计算尺寸
        const menuRect = this.contextMenuEl.getBoundingClientRect();
        this.contextMenuEl.style.display = 'none'; // 计算后隐藏
        let x = event.clientX;
        let y = event.clientY;
        if (x + menuRect.width > window.innerWidth) x = window.innerWidth - menuRect.width - 5;
        if (y + menuRect.height > window.innerHeight) y = window.innerHeight - menuRect.height - 5;
        if (x < 0) x = 5;
        if (y < 0) y = 5;
        this.contextMenuEl.style.top = y + 'px';
        this.contextMenuEl.style.left = x + 'px';
        this.contextMenuEl.style.display = 'block';

        // 4. 设置自动隐藏定时器
        this.contextMenuAutoHideTimer = setTimeout(this._hideContextMenu.bind(this), AppSettings.ui.contextMenuAutoHideDuration);
    },

    /**
     * 隐藏消息的上下文菜单。
     * @private
     * @function _hideContextMenu
     * @returns {void}
     */
    _hideContextMenu: function () {
        this._clearContextMenuAutoHideTimer();
        if (this.contextMenuEl) this.contextMenuEl.style.display = 'none';
        this.activeContextMenuMessageElement = null;
    },

    /**
     * 清除上下文菜单的自动隐藏定时器。
     * @private
     * @function _clearContextMenuAutoHideTimer
     * @returns {void}
     */
    _clearContextMenuAutoHideTimer: function() {
        if (this.contextMenuAutoHideTimer) {
            clearTimeout(this.contextMenuAutoHideTimer);
            this.contextMenuAutoHideTimer = null;
        }
    },

    /**
     * 显示聊天区域，并隐藏“未选择聊天”的占位屏幕。
     * @private
     * @function _showChatArea
     * @returns {void}
     */
    _showChatArea: function () {
        if (this.noChatSelectedScreenEl) this.noChatSelectedScreenEl.style.display = 'none';
        if (this.chatBoxEl) this.chatBoxEl.style.display = 'flex';
        this._hideContextMenu();
    },

    /**
     * 显示“未选择聊天”的占位视图，并重置相关UI状态。
     * @private
     * @function _showNoChatSelected
     * @returns {void}
     */
    _showNoChatSelected: function () {
        // NOTE: 头部的更新现在由 `_updateChatHeaderBasedOnState` 统一处理
        if (this.chatBoxEl) {
            this.chatBoxEl.innerHTML = '';
            this.chatBoxEl.style.display = 'none';
        }
        if (this.noChatSelectedScreenEl) this.noChatSelectedScreenEl.style.display = 'flex';

        this.enableChatInterface(false);
        this._hideContextMenu();

        // 清理虚拟滚动状态
        this._detachScrollListener();
        this._currentChatId = null;
        this._allMessagesForCurrentChat = [];
        this._renderedOldestMessageArrayIndex = -1;
        this._renderedNewestMessageArrayIndex = -1;
        this._hideScrollToLatestButton();
    },

    /**
     * 根据应用状态更新聊天头部的标题、状态和头像。
     * @private
     * @function _updateChatHeaderBasedOnState
     * @param {object} state - 当前的应用状态对象 (来自Store)。
     * @returns {void}
     */
    _updateChatHeaderBasedOnState: function (state) {
        const { currentChatInfo } = state;

        if (this.chatHeaderTitleEl) this.chatHeaderTitleEl.textContent = Utils.escapeHtml(currentChatInfo.title);
        if (this.chatHeaderStatusEl) {
            this.chatHeaderStatusEl.textContent = Utils.escapeHtml(currentChatInfo.statusText);
            this.chatHeaderStatusEl.classList.remove('status-indicator-active', 'status-indicator-inactive', 'status-indicator-neutral');

            // 根据实体类型和状态设置状态指示器圆点的颜色
            if (currentChatInfo.entityType === 'group') {
                this.chatHeaderStatusEl.classList.add('status-indicator-neutral');
            } else if (currentChatInfo.entityType === 'contact') {
                const contact = currentChatInfo.entity;
                if (contact.isAI) {
                    this.chatHeaderStatusEl.classList.add(state.isAiServiceHealthy ? 'status-indicator-active' : 'status-indicator-inactive');
                } else if (contact.isSpecial) {
                    this.chatHeaderStatusEl.classList.add('status-indicator-active');
                } else {
                    this.chatHeaderStatusEl.classList.add(ConnectionManager.isConnectedTo(contact.id) ? 'status-indicator-active' : 'status-indicator-inactive');
                }
            } else {
                this.chatHeaderStatusEl.classList.add('status-indicator-neutral');
            }
        }

        // 更新头像和容器的CSS类
        if (this.chatHeaderMainEl) this.chatHeaderMainEl.className = 'chat-header-main';
        if (this.chatHeaderAvatarEl) this.chatHeaderAvatarEl.className = 'chat-avatar-main';
        if (currentChatInfo.entityType === 'group' && this.chatHeaderAvatarEl) {
            this.chatHeaderAvatarEl.classList.add('group');
        }

        let avatarContentHtml = Utils.escapeHtml(currentChatInfo.avatarText);
        if (currentChatInfo.avatarUrl) {
            avatarContentHtml = `<img src="${currentChatInfo.avatarUrl}" alt="${avatarContentHtml}" class="avatar-image" data-fallback-text="${avatarContentHtml}" data-entity-id="${currentChatInfo.entity?.id}">`;
        }

        if (currentChatInfo.entity?.isSpecial && this.chatHeaderAvatarEl) {
            this.chatHeaderAvatarEl.classList.add('special-avatar', currentChatInfo.entity.id);
        }
        if (currentChatInfo.entity?.isSpecial && this.chatHeaderMainEl) {
            this.chatHeaderMainEl.classList.add('character-active', `current-chat-${currentChatInfo.entity.id}`);
        }

        if (this.chatHeaderAvatarEl) this.chatHeaderAvatarEl.innerHTML = avatarContentHtml;

        // 根据是否选中聊天，决定头部信息区域是否可点击
        const chatSelected = !!state.currentChatId;
        if (this.chatInfoMainEl) {
            if (chatSelected) {
                this.chatInfoMainEl.style.cursor = 'pointer';
                this.chatInfoMainEl.setAttribute('title', '聊天信息');
                this.chatInfoMainEl.classList.add('clickable-chat-header');
            } else {
                this.chatInfoMainEl.style.cursor = 'default';
                this.chatInfoMainEl.removeAttribute('title');
                this.chatInfoMainEl.classList.remove('clickable-chat-header');
            }
        }
    },

    /**
     * 启用或禁用聊天界面的交互元素（输入框、按钮等）。
     * @function enableChatInterface
     * @param {boolean} enabled - true为启用，false为禁用。
     * @returns {void}
     */
    enableChatInterface: function (enabled) {
        const elementsToToggle = [
            this.messageInputEl, this.sendButtonEl, this.attachButtonEl,
            this.voiceButtonEl, this.screenshotMainBtnEl, this.emojiStickerBtnEl
        ];
        elementsToToggle.forEach(el => {
            if (el) el.disabled = !enabled;
        });

        // NOTE: 群成员按钮始终可用
        if (this.peopleLobbyButtonEl) this.peopleLobbyButtonEl.disabled = false;

        this.setCallButtonsState(enabled && ChatManager.currentChatId ? ConnectionManager.isConnectedTo(ChatManager.currentChatId) : false, ChatManager.currentChatId);

        // 启用时自动聚焦到输入框
        if (enabled && this.messageInputEl) {
            setTimeout(() => {
                if (this.messageInputEl) this.messageInputEl.focus();
            }, 100);
        }
    },

    /**
     * 设置通话相关按钮（视频、音频、共享）的可用状态。
     * @function setCallButtonsState
     * @param {boolean} enabled - 是否启用。
     * @param {string|null} peerIdContext - 上下文关联的对端ID。
     * @returns {void}
     */
    setCallButtonsState: function (enabled, peerIdContext = null) {
        const targetPeerForCall = peerIdContext || ChatManager.currentChatId;
        const isGroupChat = targetPeerForCall?.startsWith('group_');
        const currentContact = UserManager.contacts[targetPeerForCall];
        const isSpecialChat = currentContact && currentContact.isSpecial;
        const canShareScreen = !!(navigator.mediaDevices && navigator.mediaDevices.getDisplayMedia);

        // 最终状态：必须启用，且目标是已连接的非群聊、非特殊联系人
        const finalEnabledState = enabled && targetPeerForCall && !isGroupChat && !isSpecialChat;

        if (this.videoCallButtonEl) this.videoCallButtonEl.disabled = !finalEnabledState;
        if (this.audioCallButtonEl) this.audioCallButtonEl.disabled = !finalEnabledState;
        if (this.screenShareButtonEl) this.screenShareButtonEl.disabled = !finalEnabledState || !canShareScreen;
    },

    /**
     * 当特定对端连接状态变化时，更新通话按钮状态。
     * @function setCallButtonsStateForPeer
     * @param {string} peerId - 对端ID。
     * @param {boolean} enabled - 是否已连接。
     * @returns {void}
     */
    setCallButtonsStateForPeer: function (peerId, enabled) {
        // 仅当状态变化的对端是当前聊天对象时，才更新UI
        if (ChatManager.currentChatId === peerId) {
            this.setCallButtonsState(enabled, peerId);
        }
    },

    /**
     * 为指定的聊天ID设置聊天区域，重置并初始化虚拟滚动。
     * @function setupForChat
     * @param {string} chatId - 要设置的聊天ID。
     * @returns {void}
     */
    setupForChat: function (chatId) {
        // 1. 清理旧状态
        this._detachScrollListener();

        // 2. 初始化新聊天的状态
        this._allMessagesForCurrentChat = [...(ChatManager.chats[chatId] || [])];
        this._isLoadingOlderMessages = false;
        this._isLoadingNewerMessages = false;
        this._renderedOldestMessageArrayIndex = -1;
        this._renderedNewestMessageArrayIndex = -1;
        this._lastScrollTop = 0;

        // 3. 渲染初始消息批次并附加滚动监听
        this._renderInitialMessageBatch();
        this._attachScrollListener();
        this._hideScrollToLatestButton();
    },

    /**
     * 附加消息区域的滚动事件监听器。
     * @private
     * @function _attachScrollListener
     * @returns {void}
     */
    _attachScrollListener: function () {
        if (this.chatBoxEl && !this._scrollListenerAttached) {
            this.chatBoxEl.addEventListener('scroll', this._boundHandleChatScroll);
            this._scrollListenerAttached = true;
        }
    },

    /**
     * 移除消息区域的滚动事件监听器。
     * @private
     * @function _detachScrollListener
     * @returns {void}
     */
    _detachScrollListener: function () {
        if (this.chatBoxEl && this._scrollListenerAttached && this._boundHandleChatScroll) {
            this.chatBoxEl.removeEventListener('scroll', this._boundHandleChatScroll);
            this._scrollListenerAttached = false;
            clearTimeout(this._debounceScrollTimer);
            this._debounceScrollTimer = null;
        }
    },

    /**
     * 使用防抖技术包装的滚动事件处理函数。
     * @private
     * @function _debouncedHandleChatScroll
     * @returns {void}
     */
    _debouncedHandleChatScroll: function () {
        clearTimeout(this._debounceScrollTimer);
        this._debounceScrollTimer = setTimeout(() => {
            this._handleChatScroll();
        }, 150);
    },

    /**
     * 核心的滚动事件处理函数，用于触发加载更多消息。
     * @private
     * @function _handleChatScroll
     * @returns {void}
     */
    _handleChatScroll: function () {
        if (!this.chatBoxEl) return;
        const { scrollTop, scrollHeight, clientHeight } = this.chatBoxEl;
        this._lastScrollTop = scrollTop;

        // 1. 检查是否滚动到顶部附近，触发加载更旧的消息
        if (scrollTop < AppSettings.ui.virtualScrollThreshold && !this._isLoadingOlderMessages && this._renderedOldestMessageArrayIndex > 0) {
            this._loadOlderMessages();
            // 如果还有未渲染的新消息，显示“滚动到最新”按钮
            if (this._allMessagesForCurrentChat.length > 0 && this._renderedNewestMessageArrayIndex < this._allMessagesForCurrentChat.length - 1) {
                this._showScrollToLatestButton();
            }
        }

        // 2. 检查是否滚动到底部附近，触发加载更新的消息
        const distanceToBottom = scrollHeight - scrollTop - clientHeight;
        const hasMoreNewerMessages = this._renderedNewestMessageArrayIndex < this._allMessagesForCurrentChat.length - 1;
        if (hasMoreNewerMessages && !this._isLoadingNewerMessages && distanceToBottom < AppSettings.ui.virtualScrollThreshold) {
            this._loadNewerMessages();
        }

        // 3. 在下一帧检查并处理UI状态
        requestAnimationFrame(() => {
            if (!this.chatBoxEl) return;
            const finalScrollTop = this.chatBoxEl.scrollTop;
            const finalScrollHeight = this.chatBoxEl.scrollHeight;
            const finalClientHeight = this.chatBoxEl.clientHeight;
            const finalDistanceToBottom = finalScrollHeight - finalScrollTop - finalClientHeight;
            const stillHasMoreNewerMessages = this._renderedNewestMessageArrayIndex < this._allMessagesForCurrentChat.length - 1;

            // NOTE: 特殊逻辑，防止在仍有新消息时滚动条停在最底部，强制向上回弹一点
            if (stillHasMoreNewerMessages && !this._isLoadingNewerMessages && finalDistanceToBottom < 1) {
                const targetScrollTop = finalScrollHeight - finalClientHeight - 20;
                if (this.chatBoxEl.scrollTop < targetScrollTop) {
                    this.chatBoxEl.scrollTop = targetScrollTop;
                }
            }

            // 更新“滚动到最新”按钮的显示状态
            const isEffectivelyAtBottom = finalDistanceToBottom < 1;
            if (isEffectivelyAtBottom && !stillHasMoreNewerMessages) {
                this._hideScrollToLatestButton();
            } else if (stillHasMoreNewerMessages && !isEffectivelyAtBottom) {
                this._showScrollToLatestButton();
            }
        });
    },

    /**
     * 渲染初始批次的消息，通常是最新的一部分。
     * @private
     * @function _renderInitialMessageBatch
     * @returns {void}
     */
    _renderInitialMessageBatch: function () {
        if (!this.chatBoxEl || !this._currentChatId) return;
        this.chatBoxEl.innerHTML = '';
        this._hideLoadingIndicator();

        const totalMessages = this._allMessagesForCurrentChat.length;
        // 如果没有消息，显示占位符文本
        if (totalMessages === 0) {
            const placeholder = document.createElement('div');
            placeholder.className = "system-message";
            // 根据聊天类型显示不同的提示
            const contact = UserManager.contacts[this._currentChatId];
            if (contact && contact.isSpecial) {
                placeholder.textContent = `与 ${contact.name} 开始对话吧！`;
            } else if (this._currentChatId.startsWith('group_') && GroupManager.groups[this._currentChatId]?.members.length === 1) {
                placeholder.textContent = "您创建了此群组。邀请成员开始聊天吧！";
            } else {
                placeholder.textContent = "暂无消息。开始对话吧！";
            }
            this.chatBoxEl.appendChild(placeholder);
            this._renderedOldestMessageArrayIndex = -1;
            this._renderedNewestMessageArrayIndex = -1;
            return;
        }

        // 计算并渲染最新的一批消息
        const endIndexInArray = totalMessages - 1;
        const startIndexInArray = Math.max(0, endIndexInArray - AppSettings.ui.chatScrollLoadBatchSize + 1);
        for (let i = startIndexInArray; i <= endIndexInArray; i++) {
            MessageManager.displayMessage(this._allMessagesForCurrentChat[i], false);
        }

        // 更新渲染索引并滚动到底部
        this._renderedOldestMessageArrayIndex = startIndexInArray;
        this._renderedNewestMessageArrayIndex = endIndexInArray;
        this.chatBoxEl.scrollTop = this.chatBoxEl.scrollHeight;
    },

    /**
     * 加载并渲染更旧的一批消息。
     * @private
     * @function _loadOlderMessages
     * @returns {Promise<void>}
     */
    _loadOlderMessages: async function () {
        if (this._isLoadingOlderMessages || this._renderedOldestMessageArrayIndex === 0 || !this.chatBoxEl) return;
        this._isLoadingOlderMessages = true;
        this._showLoadingIndicatorAtTop();

        // 1. 计算要加载的旧消息的索引范围
        const newBatchEndIndexInArray = this._renderedOldestMessageArrayIndex - 1;
        const newBatchStartIndexInArray = Math.max(0, newBatchEndIndexInArray - AppSettings.ui.chatScrollLoadBatchSize + 1);
        if (newBatchEndIndexInArray < 0) { // 已无更多旧消息
            this._hideLoadingIndicator();
            this._isLoadingOlderMessages = false;
            this._renderedOldestMessageArrayIndex = 0;
            return;
        }

        const oldScrollHeight = this.chatBoxEl.scrollHeight;
        const oldScrollTop = this.chatBoxEl.scrollTop;

        // 2. 从后往前渲染，将新消息插入到顶部
        for (let i = newBatchEndIndexInArray; i >= newBatchStartIndexInArray; i--) {
            MessageManager.displayMessage(this._allMessagesForCurrentChat[i], true); // true表示插入到顶部
        }
        this._renderedOldestMessageArrayIndex = newBatchStartIndexInArray;

        // 3. 在下一帧调整滚动条位置，保持用户视觉位置不变
        requestAnimationFrame(() => {
            const newScrollHeight = this.chatBoxEl.scrollHeight;
            this.chatBoxEl.scrollTop = oldScrollTop + (newScrollHeight - oldScrollHeight);
            this._hideLoadingIndicator();
            this._isLoadingOlderMessages = false;
        });
    },

    /**
     * 加载并渲染更新的一批消息。
     * @private
     * @function _loadNewerMessages
     * @returns {Promise<void>}
     */
    _loadNewerMessages: async function () {
        if (this._isLoadingNewerMessages || this._renderedNewestMessageArrayIndex === this._allMessagesForCurrentChat.length - 1 || !this.chatBoxEl) return;
        this._isLoadingNewerMessages = true;

        const oldScrollHeight = this.chatBoxEl.scrollHeight;
        const oldScrollTop = this.chatBoxEl.scrollTop;
        const clientHeight = this.chatBoxEl.clientHeight;
        const wasAtBottomBeforeLoad = (oldScrollHeight - oldScrollTop - clientHeight) < 5;

        // 1. 计算要加载的新消息的索引范围
        const newBatchStartIndexInArray = this._renderedNewestMessageArrayIndex + 1;
        const newBatchEndIndexInArray = Math.min(this._allMessagesForCurrentChat.length - 1, newBatchStartIndexInArray + AppSettings.ui.chatScrollLoadBatchSize - 1);
        if (newBatchStartIndexInArray >= this._allMessagesForCurrentChat.length) {
            this._isLoadingNewerMessages = false;
            return;
        }

        // 2. 渲染新消息到列表底部
        for (let i = newBatchStartIndexInArray; i <= newBatchEndIndexInArray; i++) {
            MessageManager.displayMessage(this._allMessagesForCurrentChat[i], false);
        }
        this._renderedNewestMessageArrayIndex = newBatchEndIndexInArray;

        // 3. 调整滚动条位置
        if (wasAtBottomBeforeLoad) {
            this.chatBoxEl.scrollTop = this.chatBoxEl.scrollHeight; // 如果之前在底部，则继续保持在底部
        } else {
            // 否则保持原位
        }

        // NOTE: 滚动回弹逻辑
        const currentScrollTopAfterInitialAdjust = this.chatBoxEl.scrollTop;
        const currentDistanceToBottom = this.chatBoxEl.scrollHeight - currentScrollTopAfterInitialAdjust - clientHeight;
        const stillHasMoreNewerMessagesAfterLoad = this._renderedNewestMessageArrayIndex < this._allMessagesForCurrentChat.length - 1;
        if (stillHasMoreNewerMessagesAfterLoad && currentDistanceToBottom < AppSettings.ui.virtualScrollThreshold) {
            let targetReboundScrollTop = this.chatBoxEl.scrollHeight - clientHeight - (AppSettings.ui.virtualScrollThreshold + 10);
            this.chatBoxEl.scrollTop = Math.max(0, targetReboundScrollTop);
        }

        this._isLoadingNewerMessages = false;

        // 4. 更新“滚动到最新”按钮状态
        if (this._renderedNewestMessageArrayIndex === this._allMessagesForCurrentChat.length - 1) {
            this._hideScrollToLatestButton();
        } else {
            this._showScrollToLatestButton();
        }
    },

    /**
     * 在消息列表顶部显示“正在加载”指示器。
     * @private
     * @function _showLoadingIndicatorAtTop
     * @returns {void}
     */
    _showLoadingIndicatorAtTop: function () {
        if (this.chatBoxEl && this._loadingIndicatorEl) {
            this._loadingIndicatorEl.style.display = 'block';
            if (this.chatBoxEl.firstChild !== this._loadingIndicatorEl) {
                this.chatBoxEl.insertBefore(this._loadingIndicatorEl, this.chatBoxEl.firstChild);
            }
        }
    },

    /**
     * 隐藏“正在加载”指示器。
     * @private
     * @function _hideLoadingIndicator
     * @returns {void}
     */
    _hideLoadingIndicator: function () {
        if (this._loadingIndicatorEl) {
            this._loadingIndicatorEl.style.display = 'none';
            if (this._loadingIndicatorEl.parentNode === this.chatBoxEl) {
                this.chatBoxEl.removeChild(this._loadingIndicatorEl);
            }
        }
    },

    /**
     * 处理当前聊天窗口接收到的新消息。
     * @function handleNewMessageForCurrentChat
     * @param {object} message - 新的消息对象。
     * @returns {void}
     */
    handleNewMessageForCurrentChat: function (message) {
        if (!message || !this.chatBoxEl || this._currentChatId !== ChatManager.currentChatId) return;

        // 1. 将新消息添加到内部数组
        this._allMessagesForCurrentChat.push(message);

        // 2. 判断用户当前是否在底部附近
        const isNearBottom = this.chatBoxEl.scrollHeight - this.chatBoxEl.scrollTop - this.chatBoxEl.clientHeight < 150;

        // 3. 显示消息
        MessageManager.displayMessage(message, false);

        // 4. 根据用户位置决定行为
        if (isNearBottom) {
            // 如果在底部，自动滚动到底部
            this.chatBoxEl.scrollTop = this.chatBoxEl.scrollHeight;
            this._renderedNewestMessageArrayIndex = this._allMessagesForCurrentChat.length - 1;
            this._hideScrollToLatestButton();
        } else {
            // 如果不在底部，显示“滚动到最新”按钮
            this._showScrollToLatestButton();
        }

        // 确保渲染索引正确更新
        if (this._renderedNewestMessageArrayIndex === this._allMessagesForCurrentChat.length - 2) {
            this._renderedNewestMessageArrayIndex = this._allMessagesForCurrentChat.length - 1;
        }
    },

    /**
     * 滚动到指定的消息ID，并加载其上下文消息。
     * @function scrollToMessage
     * @param {string} targetMessageId - 目标消息的ID。
     * @returns {void}
     */
    scrollToMessage: function (targetMessageId) {
        if (!this._currentChatId || !this.chatBoxEl) {
            NotificationUIManager.showNotification("请先打开一个聊天。", "warning");
            return;
        }

        // 检查消息是否在当前聊天中
        let chatIdForMessage = this._currentChatId;
        let messageExistsInCurrentChat = ChatManager.chats[chatIdForMessage]?.some(m => m.id === targetMessageId);

        // 如果不在，则查找该消息所在的聊天
        if (!messageExistsInCurrentChat) {
            const foundChatId = Object.keys(ChatManager.chats).find(cid =>
                ChatManager.chats[cid].some(m => m.id === targetMessageId)
            );
            if (!foundChatId) {
                NotificationUIManager.showNotification("未找到目标消息。", "error");
                return;
            }
            chatIdForMessage = foundChatId;
        }

        // 如果需要切换聊天，则先切换再滚动
        if (this._currentChatId !== chatIdForMessage) {
            Store.dispatch('OPEN_CHAT', { chatId: chatIdForMessage });
            setTimeout(() => {
                this._performScrollToMessage(targetMessageId);
            }, 100); // 等待UI切换完成
            return;
        }

        // 如果就在当前聊天，直接滚动
        this._performScrollToMessage(targetMessageId);
    },

    /**
     * 执行实际的滚动到指定消息的操作。
     * @private
     * @function _performScrollToMessage
     * @param {string} targetMessageId - 目标消息的ID。
     * @returns {void}
     */
    _performScrollToMessage: function (targetMessageId) {
        // 处理流程如下：
        // 1. 重新获取当前聊天的所有消息
        this._allMessagesForCurrentChat = [...(ChatManager.chats[this._currentChatId] || [])];
        const targetMessageIndex = this._allMessagesForCurrentChat.findIndex(msg => msg.id === targetMessageId);
        if (targetMessageIndex === -1) {
            NotificationUIManager.showNotification("在当前聊天中未找到目标消息。", "error");
            return;
        }

        // 2. 清理当前消息列表和虚拟滚动状态
        this.chatBoxEl.innerHTML = '';
        this._detachScrollListener();
        this._hideLoadingIndicator();
        this._isLoadingOlderMessages = false;
        this._isLoadingNewerMessages = false;

        // 3. 计算要渲染的消息窗口（目标消息及其前后若干条消息）
        let startIndex = Math.max(0, targetMessageIndex - AppSettings.ui.chatContextLoadCount);
        let endIndex = Math.min(this._allMessagesForCurrentChat.length - 1, targetMessageIndex + AppSettings.ui.chatContextLoadCount);
        // NOTE: 确保加载的消息数量至少达到一个批次的大小，以提供更好的滚动体验
        let currentBatchSize = endIndex - startIndex + 1;
        if (currentBatchSize < AppSettings.ui.chatScrollLoadBatchSize) {
            const diff = AppSettings.ui.chatScrollLoadBatchSize - currentBatchSize;
            startIndex = Math.max(0, startIndex - Math.ceil(diff / 2));
            endIndex = Math.min(this._allMessagesForCurrentChat.length - 1, endIndex + Math.floor(diff / 2));
        }

        // 4. 渲染计算出的消息批次
        for (let i = startIndex; i <= endIndex; i++) {
            MessageManager.displayMessage(this._allMessagesForCurrentChat[i], false);
        }

        // 5. 更新渲染索引
        this._renderedOldestMessageArrayIndex = startIndex;
        this._renderedNewestMessageArrayIndex = endIndex;

        // 6. 将目标消息滚动到视图中央
        const targetElement = this.chatBoxEl.querySelector(`.message[data-message-id="${targetMessageId}"]`);
        if (targetElement) {
            setTimeout(() => {
                targetElement.scrollIntoView({ behavior: 'auto', block: 'center' });
                this._lastScrollTop = this.chatBoxEl.scrollTop;
            }, 50);
        }

        // 7. 重新附加滚动监听并更新UI按钮
        this._attachScrollListener();
        if (this._renderedNewestMessageArrayIndex < this._allMessagesForCurrentChat.length - 1) {
            this._showScrollToLatestButton();
        } else {
            this._hideScrollToLatestButton();
        }
    },

    /**
     * 滚动到指定日期的第一条消息。
     * @function scrollToDate
     * @param {string} chatId - 聊天的ID。
     * @param {string} dateString - 日期字符串 (格式: YYYY-MM-DD)。
     * @returns {void}
     */
    scrollToDate: function(chatId, dateString) {
        if (!this._currentChatId || !this.chatBoxEl) {
            NotificationUIManager.showNotification("请先打开一个聊天。", "warning");
            return;
        }

        // 如果需要，先切换到目标聊天
        if (this._currentChatId !== chatId) {
            Store.dispatch('OPEN_CHAT', { chatId: chatId });
            setTimeout(() => {
                this._performScrollToDate(chatId, dateString);
            }, 100);
            return;
        }

        this._performScrollToDate(chatId, dateString);
    },

    /**
     * 执行实际的滚动到指定日期的操作。
     * @private
     * @function _performScrollToDate
     * @param {string} chatId - 聊天的ID。
     * @param {string} dateString - 日期字符串 (格式: YYYY-MM-DD)。
     * @returns {void}
     */
    _performScrollToDate: function(chatId, dateString) {
        // 1. 获取该聊天的所有消息
        this._allMessagesForCurrentChat = [...(ChatManager.chats[chatId] || [])];
        let firstMessageOfDate = null;

        // 2. 计算目标日期的起止时间戳
        const targetDate = new Date(dateString + "T00:00:00.000Z");
        const targetDateStart = targetDate.getTime();
        targetDate.setUTCDate(targetDate.getUTCDate() + 1);
        const targetDateEnd = targetDate.getTime() - 1;

        // 3. 遍历消息，查找在时间范围内的第一条消息
        for (let i = 0; i < this._allMessagesForCurrentChat.length; i++) {
            const msg = this._allMessagesForCurrentChat[i];
            const msgTimestamp = new Date(msg.timestamp).getTime();
            if (msgTimestamp >= targetDateStart && msgTimestamp <= targetDateEnd) {
                firstMessageOfDate = msg;
                break;
            }
        }

        // 4. 如果找到，则调用 scrollToMessage 进行跳转
        if (firstMessageOfDate) {
            Utils.log(`正在滚动到 ${dateString} 的第一条消息, ID: ${firstMessageOfDate.id}`, Utils.logLevels.DEBUG);
            this._performScrollToMessage(firstMessageOfDate.id);
        } else {
            NotificationUIManager.showNotification(`日期 ${dateString} 没有消息。`, "info");
        }
    },

    /**
     * 显示“滚动到最新消息”按钮。
     * @private
     * @function _showScrollToLatestButton
     * @returns {void}
     */
    _showScrollToLatestButton: function () {
        if (!this.chatBoxEl || !this.chatBoxEl.parentElement) return;
        if (!this._scrollToLatestBtnEl) {
            // 如果按钮不存在，则创建并附加到DOM
            this._scrollToLatestBtnEl = document.createElement('button');
            this._scrollToLatestBtnEl.id = 'scrollToLatestBtn';
            this._scrollToLatestBtnEl.className = 'scroll-to-latest-btn';
            this._scrollToLatestBtnEl.innerHTML = '▼';
            this._scrollToLatestBtnEl.title = '滚动到最新消息';
            this._scrollToLatestBtnEl.onclick = this.scrollToLatestMessages.bind(this);
            this.chatBoxEl.parentElement.appendChild(this._scrollToLatestBtnEl);
        }
        this._scrollToLatestBtnEl.style.display = 'flex';
    },

    /**
     * 隐藏“滚动到最新消息”按钮。
     * @private
     * @function _hideScrollToLatestButton
     * @returns {void}
     */
    _hideScrollToLatestButton: function () {
        if (this._scrollToLatestBtnEl) {
            this._scrollToLatestBtnEl.style.display = 'none';
        }
    },

    /**
     * 滚动到最新的消息列表。
     * @function scrollToLatestMessages
     * @returns {void}
     */
    scrollToLatestMessages: function () {
        if (!this.chatBoxEl) return;

        // 重置虚拟滚动状态，并重新渲染初始（最新）的消息批次
        this._detachScrollListener();
        this._isLoadingOlderMessages = false;
        this._isLoadingNewerMessages = false;
        this._renderInitialMessageBatch();
        this._lastScrollTop = this.chatBoxEl.scrollTop;
        this._attachScrollListener();
        this._hideScrollToLatestButton();
    }
};