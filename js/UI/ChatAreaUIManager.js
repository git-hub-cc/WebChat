/**
 * @file ChatAreaUIManager.js
 * @description 管理主聊天区域的 UI 元素和交互，包括聊天头部、消息框、输入区以及通话和截图按钮。
 *              支持消息的右键/双击上下文菜单，用于删除或撤回消息。
 *              支持消息列表的虚拟滚动，以及从资源预览跳转到特定消息。
 *              加载更晚的消息现在使用与加载更早消息相同的阈值 (AppSettings.ui.virtualScrollThreshold)，并实现滚动回弹。
 *              新增逻辑以防止用户在还有更多未加载消息时将滚动条停留在绝对底部。
 *              新增：在群聊输入框中输入 @ 时，显示 AI 成员提及建议。
 *              优化：AI提及建议列表现在精确显示在输入框上方。
 *              修复: 正则表达式 @-提及 现在限制较少。
 *              功能增强：当用户复制文件后，在输入框ctrl+v时，将用户剪切板的文件，当作需要上传的文件，在预览文件中显示，用户点击发送后能将文件进行发送。
 *              新增：聊天头部的状态文本现在会根据连接或AI服务状态显示一个彩色圆点指示器。
 *              新增：scrollToDate 方法，用于从资源预览的日期导航跳转到指定日期的第一条消息。
 *              REFACTORED: (第1阶段) 不再有公开的 showChatArea/showNoChatSelected 方法，而是订阅 Store 并根据 state 自动更新视图。
 * @module ChatAreaUIManager
 * @exports {object} ChatAreaUIManager - 对外暴露的单例对象，包含管理聊天区域 UI 的所有方法。
 * @property {function} init - 初始化模块，获取 DOM 元素并绑定事件。
 * @property {function} setupForChat - 为指定聊天设置聊天区域，包括初始化虚拟滚动。
 * @property {function} handleNewMessageForCurrentChat - 处理当前聊天的新消息，将其添加到虚拟滚动列表。
 * @property {function} scrollToMessage - 滚动到指定的消息ID并加载其上下文。
 * @property {function} scrollToDate - 滚动到指定日期的第一条消息。
 * @dependencies LayoutUIManager, MessageManager, VideoCallManager, ChatManager, ConnectionManager, UserManager, DetailsPanelUIManager, NotificationUIManager, Utils, MediaManager, PeopleLobbyManager, EventEmitter, UIManager, AppSettings, Store
 * @dependents AppInitializer (进行初始化)
 */
const ChatAreaUIManager = {
    // DOM 元素引用
    chatAreaEl: null, // 主聊天区域元素
    chatHeaderTitleEl: null, // 聊天头部标题元素
    chatHeaderStatusEl: null, // 聊天头部状态文本元素
    chatHeaderAvatarEl: null, // 聊天头部头像元素
    chatHeaderMainEl: null, // 聊天头部主容器元素
    chatBoxEl: null, // 消息显示框元素
    noChatSelectedScreenEl: null, // “未选择聊天”占位屏幕元素
    messageInputEl: null, // 消息输入框元素
    sendButtonEl: null, // 发送按钮元素
    attachButtonEl: null, // 附件按钮元素
    voiceButtonEl: null, // 语音按钮元素
    videoCallButtonEl: null, // 视频通话按钮元素
    audioCallButtonEl: null, // 语音通话按钮元素
    screenShareButtonEl: null, // 屏幕共享按钮元素
    peopleLobbyButtonEl: null, // 人员大厅按钮元素
    screenshotMainBtnEl: null, // 截图按钮元素
    emojiStickerBtnEl: null, // ADDED: 表情/贴图按钮元素

    chatInfoMainEl: null, // .chat-info-main element for click to show details
    // 上下文菜单相关
    contextMenuEl: null, // 自定义右键菜单元素
    activeContextMenuMessageElement: null, // 当前显示上下文菜单的消息元素
    contextMenuAutoHideTimer: null, // 上下文菜单自动隐藏的定时器
    aiMentionSuggestionsEl: null, // AI @提及建议列表元素

    // 常量
    MESSAGE_RETRACTION_WINDOW: 5 * 60 * 1000, // 消息可撤回时间窗口 (5分钟，毫秒数)
    CONTEXT_MENU_AUTOHIDE_DURATION: 3000, // 右键菜单自动隐藏延迟 (3秒，毫秒数)

    // 虚拟滚动相关状态
    _currentChatIdForVirtualScroll: null, // 当前用于虚拟滚动的聊天ID
    _allMessagesForCurrentChat: [],       // 当前聊天的所有消息数组（内存中的副本）
    _renderedOldestMessageArrayIndex: -1, // 已渲染消息中，在 _allMessagesForCurrentChat 中最旧消息的索引
    _renderedNewestMessageArrayIndex: -1, // 已渲染消息中，在 _allMessagesForCurrentChat 中最新消息的索引
    _isLoadingOlderMessages: false,       // 标记是否正在加载更早的消息
    _isLoadingNewerMessages: false,       // 标记是否正在加载更新的消息
    _loadingIndicatorEl: null,            // 消息加载指示器元素 (通常用于加载更早消息时显示在顶部)
    _scrollListenerAttached: false,       // 标记滚动事件监听器是否已附加到 chatBoxEl
    _debounceScrollTimer: null,           // 滚动事件的防抖定时器
    _boundHandleChatScroll: null,         // 绑定的滚动处理函数 (为了方便移除监听器)
    _lastScrollTop: 0,                    // 上一次的滚动位置 (scrollTop)

    // 其他UI状态
    _scrollToLatestBtnEl: null,           // “滚动到最新消息”按钮元素
    CONTEXT_LOAD_COUNT: 10,               // 通过资源预览跳转到某条消息时，其上下文加载的消息数量 (前后各加载此数量)
    MESSAGES_TO_LOAD_ON_SCROLL: 15,       // 滚动到顶部或底部时，每次加载的消息数量

    /**
     * 初始化模块，获取所有需要的 DOM 元素引用并绑定核心事件。
     * REFACTORED: 新增了对 Store 的订阅。
     */
    init: function () {
        // 获取聊天区域核心 DOM 元素的引用
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
        this.emojiStickerBtnEl = document.getElementById('emojiStickerBtn'); // ADDED

        this.chatInfoMainEl = document.querySelector('.chat-header-main .chat-info-main');
        this._initContextMenu(); // 初始化消息右键上下文菜单
        this._initAiMentionSuggestions(); // 初始化AI提及建议的UI

        // 如果聊天框存在，创建加载指示器元素
        if (this.chatBoxEl) {
            this._loadingIndicatorEl = document.createElement('div');
            this._loadingIndicatorEl.className = 'loading-indicator-older-messages'; // 加载旧消息的指示器
            this._loadingIndicatorEl.innerHTML = '<div class="spinner"></div>'; // 加载动画
        }
        // 绑定 `this` 上下文到滚动处理函数，以便在事件监听器中正确使用
        this._boundHandleChatScroll = this._debouncedHandleChatScroll.bind(this);
        this.bindEvents(); // 绑定所有相关的UI事件

        // REFACTORED: 订阅 Store 的状态变化
        Store.subscribe(this.handleStateChange.bind(this));
    },

    /**
     * REFACTORED: 新增方法，用于处理从 Store 传来的状态变化。
     * @param {object} newState - 最新的应用状态。
     */
    handleStateChange: function(newState) {
        // 检查当前聊天 ID 是否发生变化
        if (newState.currentChatId !== this._currentChatIdForVirtualScroll) {
            if (newState.currentChatId) {
                // 打开新聊天
                this._showChatArea();
                this.setupForChat(newState.currentChatId);
                this.enableChatInterface(true);
            } else {
                // 关闭聊天
                this._showNoChatSelected();
            }
        }

        // 无论聊天ID是否变化，都根据最新状态更新头部信息
        this._updateChatHeaderBasedOnState(newState);
    },

    /**
     * @private
     * 初始化AI提及建议的UI元素。
     * 它将被添加到聊天输入区域的父容器中，以便能正确定位在输入框上方。
     */
    _initAiMentionSuggestions: function() {
        // ... 此方法未改变 ...
        this.aiMentionSuggestionsEl = document.createElement('div');
        this.aiMentionSuggestionsEl.id = 'aiMentionSuggestions';
        this.aiMentionSuggestionsEl.className = 'ai-mention-suggestions';
        this.aiMentionSuggestionsEl.style.display = 'none';
        this.aiMentionSuggestionsEl.style.position = 'absolute';

        const chatInputContainer = this.messageInputEl ? this.messageInputEl.closest('.chat-input-container') : null;
        if (chatInputContainer) {
            chatInputContainer.style.position = 'relative';
            chatInputContainer.appendChild(this.aiMentionSuggestionsEl);
        } else if (this.messageInputEl && this.messageInputEl.parentNode) {
            Utils.log("ChatAreaUIManager: 无法找到理想的 .chat-input-container 来附加提及建议。尝试添加到输入框的父级。", Utils.logLevels.WARN);
            this.messageInputEl.parentNode.style.position = 'relative';
            this.messageInputEl.parentNode.appendChild(this.aiMentionSuggestionsEl);
        } else {
            Utils.log("ChatAreaUIManager: 无法找到附加提及建议列表的合适位置。", Utils.logLevels.ERROR);
            return;
        }

        document.addEventListener('click', (event) => {
            if (this.aiMentionSuggestionsEl && this.aiMentionSuggestionsEl.style.display === 'block' &&
                !this.aiMentionSuggestionsEl.contains(event.target) && event.target !== this.messageInputEl) {
                this.aiMentionSuggestionsEl.style.display = 'none';
            }
        });
    },


    /**
     * 绑定聊天区域内的所有 UI 事件监听器。
     */
    bindEvents: function () {
        // ... 此方法未改变，但注意 peopleLobbyButtonEl 的点击事件现在分发 Action
        // 消息输入框事件
        if (this.messageInputEl) {
            this.messageInputEl.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey) {
                    e.preventDefault();
                    MessageManager.sendMessage();
                    if (this.aiMentionSuggestionsEl) this.aiMentionSuggestionsEl.style.display = 'none';
                } else if (e.key === 'Escape') {
                    if (this.aiMentionSuggestionsEl) this.aiMentionSuggestionsEl.style.display = 'none';
                }
            });
            this.messageInputEl.addEventListener('input', this._handleMessageInputForMentions.bind(this));
            this.messageInputEl.addEventListener('paste', this._handlePasteEvent.bind(this));
        }
        // 发送按钮点击事件
        if (this.sendButtonEl) {
            this.sendButtonEl.addEventListener('click', () => {
                MessageManager.sendMessage();
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
        // 语音按钮事件
        if (this.voiceButtonEl) {
            if ('ontouchstart' in window) {
                this.voiceButtonEl.addEventListener('touchstart', (e) => { e.preventDefault(); if (!this.voiceButtonEl.disabled) MediaManager.startRecording(); });
                this.voiceButtonEl.addEventListener('touchend', (e) => { e.preventDefault(); if (!this.voiceButtonEl.disabled) MediaManager.stopRecording(); });
            } else {
                this.voiceButtonEl.addEventListener('mousedown', () => { if (!this.voiceButtonEl.disabled) MediaManager.startRecording(); });
                this.voiceButtonEl.addEventListener('mouseup', () => { if (!this.voiceButtonEl.disabled) MediaManager.stopRecording(); });
                this.voiceButtonEl.addEventListener('mouseleave', () => {
                    if (!this.voiceButtonEl.disabled && MediaManager.mediaRecorder && MediaManager.mediaRecorder.state === 'recording') {
                        MediaManager.stopRecording();
                    }
                });
            }
        }
        // 截图按钮点击事件
        if (this.screenshotMainBtnEl) {
            this.screenshotMainBtnEl.addEventListener('click', () => MediaManager.captureScreen());
        }
        // 视频通话按钮点击事件
        if (this.videoCallButtonEl) {
            this.videoCallButtonEl.addEventListener('click', () => { if (!this.videoCallButtonEl.disabled) VideoCallManager.initiateCall(ChatManager.currentChatId); });
        }
        // 语音通话按钮点击事件
        if (this.audioCallButtonEl) {
            this.audioCallButtonEl.addEventListener('click', () => { if (!this.audioCallButtonEl.disabled) VideoCallManager.initiateAudioCall(ChatManager.currentChatId); });
        }
        // 屏幕共享按钮点击事件
        if (this.screenShareButtonEl) {
            this.screenShareButtonEl.addEventListener('click', () => { if (!this.screenShareButtonEl.disabled) VideoCallManager.initiateScreenShare(ChatManager.currentChatId); });
        }
        // REFACTORED: 人员大厅按钮点击事件，分发 Action
        if (this.peopleLobbyButtonEl) {
            this.peopleLobbyButtonEl.addEventListener('click', () => {
                Store.dispatch('TOGGLE_DETAILS_PANEL', { content: 'lobby' });
            });
        }

        // REFACTORED: 聊天头部点击事件，分发 Action
        if (this.chatInfoMainEl) {
            this.chatInfoMainEl.addEventListener('click', () => {
                const state = Store.getState();
                if (state.currentChatId) {
                    Store.dispatch('TOGGLE_DETAILS_PANEL', { content: 'details' });
                }
            });
        }
        // 聊天区域的拖放事件
        if (this.chatAreaEl) {
            let dragCounter = 0;
            this.chatAreaEl.addEventListener('dragenter', (e) => {
                e.preventDefault(); e.stopPropagation();
                if (ChatManager.currentChatId && e.dataTransfer && e.dataTransfer.types.includes('Files')) {
                    dragCounter++;
                    if (dragCounter === 1) this.chatAreaEl.classList.add('drag-over');
                }
            });
            this.chatAreaEl.addEventListener('dragover', (e) => {
                e.preventDefault(); e.stopPropagation();
                if (ChatManager.currentChatId && e.dataTransfer && e.dataTransfer.types.includes('Files')) {
                    e.dataTransfer.dropEffect = 'copy';
                } else {
                    e.dataTransfer.dropEffect = 'none';
                }
            });
            this.chatAreaEl.addEventListener('dragleave', (e) => {
                e.preventDefault(); e.stopPropagation();
                dragCounter--;
                if (dragCounter === 0) this.chatAreaEl.classList.remove('drag-over');
            });
            this.chatAreaEl.addEventListener('drop', (e) => {
                e.preventDefault(); e.stopPropagation();
                dragCounter = 0; this.chatAreaEl.classList.remove('drag-over');
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
        // 聊天框内的消息交互事件
        if (this.chatBoxEl) {
            this.chatBoxEl.addEventListener('contextmenu', this._handleMessageInteraction.bind(this));
            this.chatBoxEl.addEventListener('dblclick', function (event) {
                const messageElement = event.target.closest('.message:not(.system):not(.retracted)');
                if (messageElement) {
                    if (event.target.closest('a, button, input, textarea, select, .file-preview-img, .play-voice-btn, .download-btn, video[controls], audio[controls]')) return;
                    this._showContextMenu(event, messageElement);
                }
            }.bind(this));
        }
    },

    /**
     * @private
     * 处理粘贴事件，用于从剪贴板获取文件。
     * @param {ClipboardEvent} event - 粘贴事件对象。
     */
    _handlePasteEvent: async function(event) {
        // ... 此方法未改变 ...
        if (!ChatManager.currentChatId || (this.messageInputEl && this.messageInputEl.disabled)) {
            Utils.log("ChatAreaUIManager._handlePasteEvent: 聊天未激活或输入框禁用，粘贴操作忽略。", Utils.logLevels.DEBUG);
            return;
        }

        const items = (event.clipboardData || event.originalEvent?.clipboardData)?.items;
        if (!items) {
            Utils.log("ChatAreaUIManager._handlePasteEvent: 无法访问剪贴板项目。", Utils.logLevels.WARN);
            return;
        }

        let fileFoundAndProcessed = false;
        for (let i = 0; i < items.length; i++) {
            const item = items[i];
            if (item.kind === 'file') {
                const file = item.getAsFile();
                if (file) {
                    event.preventDefault();
                    Utils.log(`ChatAreaUIManager: 从剪贴板粘贴文件: ${file.name}, 类型: ${file.type}, 大小: ${file.size}`, Utils.logLevels.INFO);

                    if (MessageManager.selectedFile) {
                        NotificationUIManager.showNotification('已有待发送的文件，请先发送或取消。', 'warning');
                        return;
                    }
                    if (MessageManager.audioData) {
                        NotificationUIManager.showNotification('已有待发送的语音，请先发送或取消。', 'warning');
                        return;
                    }

                    await MediaManager.processFile(file);
                    fileFoundAndProcessed = true;
                    break;
                }
            }
        }

        if (fileFoundAndProcessed) {
            Utils.log("ChatAreaUIManager: 剪贴板中的文件已处理并设置预览。", Utils.logLevels.DEBUG);
        } else {
            Utils.log("ChatAreaUIManager: 在粘贴事件中未找到文件，或文件无法检索。将执行默认粘贴行为（文本）。", Utils.logLevels.DEBUG);
        }
    },


    /**
     * @private
     * 处理消息输入框的输入事件，用于检测和显示 @ 提及建议。
     * 仅在群聊中且输入 `@` 符号后触发。
     */
    _handleMessageInputForMentions: function() {
        // ... 此方法未改变 ...
        if (!this.messageInputEl || !this.aiMentionSuggestionsEl || !ChatManager.currentChatId || !ChatManager.currentChatId.startsWith('group_')) {
            if (this.aiMentionSuggestionsEl) this.aiMentionSuggestionsEl.style.display = 'none';
            return;
        }

        const text = this.messageInputEl.value;
        const cursorPos = this.messageInputEl.selectionStart;
        const textBeforeCursor = text.substring(0, cursorPos);

        const lastAtSymbolIndex = textBeforeCursor.lastIndexOf('@');

        if (lastAtSymbolIndex !== -1) {
            const query = textBeforeCursor.substring(lastAtSymbolIndex + 1).toLowerCase();
            const lengthOfAtAndQuery = textBeforeCursor.length - lastAtSymbolIndex;

            const group = GroupManager.groups[ChatManager.currentChatId];
            if (group && group.members) {
                const aiMembers = group.members.reduce((acc, memberId) => {
                    const contact = UserManager.contacts[memberId];
                    if (contact && contact.isAI && contact.name.toLowerCase().includes(query)) {
                        acc.push(contact);
                    }
                    return acc;
                }, []);

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
     * @private
     * 填充 AI @ 提及建议列表...
     */
    _populateAiMentionSuggestions: function(aiContacts, lengthOfAtAndQuery) {
        // ... 此方法未改变 ...
        if (!this.aiMentionSuggestionsEl || !this.messageInputEl) return;

        this.aiMentionSuggestionsEl.innerHTML = '';
        const fragment = document.createDocumentFragment();
        const template = document.getElementById('ai-mention-suggestion-item-template').content;

        aiContacts.forEach(contact => {
            const itemClone = template.cloneNode(true);
            const itemEl = itemClone.querySelector('.mention-suggestion-item');
            const avatarEl = itemClone.querySelector('.mention-suggestion-avatar');
            const nameEl = itemClone.querySelector('.mention-suggestion-name');

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

            itemEl.addEventListener('click', () => {
                const currentText = this.messageInputEl.value;
                const cursorPos = this.messageInputEl.selectionStart;
                const textBefore = currentText.substring(0, cursorPos - lengthOfAtAndQuery);
                const textAfter = currentText.substring(cursorPos);
                const mentionText = '@' + contact.name + ' ';
                this.messageInputEl.value = textBefore + mentionText + textAfter;
                this.messageInputEl.focus();
                const newCursorPos = textBefore.length + mentionText.length;
                this.messageInputEl.setSelectionRange(newCursorPos, newCursorPos);
                this.aiMentionSuggestionsEl.style.display = 'none';
            });
            fragment.appendChild(itemEl);
        });

        this.aiMentionSuggestionsEl.appendChild(fragment);

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
     * @private
     * 初始化消息的右键上下文菜单。
     */
    _initContextMenu: function () {
        // ... 此方法未改变 ...
        this.contextMenuEl = document.createElement('div');
        this.contextMenuEl.id = 'customMessageContextMenu';
        this.contextMenuEl.className = 'custom-context-menu';
        this.contextMenuEl.style.display = 'none';
        document.body.appendChild(this.contextMenuEl);

        document.addEventListener('click', function (event) {
            if (this.contextMenuEl && this.contextMenuEl.style.display === 'block' && !this.contextMenuEl.contains(event.target)) {
                this._hideContextMenu();
            }
        }.bind(this));

        document.addEventListener('keydown', function (event) {
            if (event.key === 'Escape' && this.contextMenuEl && this.contextMenuEl.style.display === 'block') {
                this._hideContextMenu();
            }
        }.bind(this));
    },

    /**
     * @private
     * 处理消息元素的交互事件（当前主要用于右键点击）。
     * @param {MouseEvent} event - 鼠标事件对象。
     */
    _handleMessageInteraction: function (event) {
        // ... 此方法未改变 ...
        const messageElement = event.target.closest('.message:not(.system):not(.retracted)');
        if (!messageElement) return;

        if (event.type === 'contextmenu') {
            event.preventDefault();
            this._showContextMenu(event, messageElement);
        }
    },

    /**
     * @private
     * 显示消息的上下文菜单。
     * @param {MouseEvent} event - 触发菜单的事件对象 (用于获取点击位置以定位菜单)。
     * @param {HTMLElement} messageElement - 被操作的消息元素。
     */
    _showContextMenu: function (event, messageElement) {
        // ... 此方法未改变 ...
        if (!this.contextMenuEl || !messageElement) return;

        this._clearContextMenuAutoHideTimer();

        const imageViewerModal = document.querySelector('.modal-like.image-viewer');
        if (imageViewerModal) imageViewerModal.remove();


        this.contextMenuEl.innerHTML = '';
        this.activeContextMenuMessageElement = messageElement;

        const messageId = messageElement.dataset.messageId;
        const messageTimestamp = parseInt(messageElement.dataset.timestamp, 10);
        const isMyMessage = messageElement.classList.contains('sent');

        if (!messageId) {
            this._hideContextMenu();
            return;
        }

        const deleteBtn = document.createElement('button');
        deleteBtn.textContent = '删除';
        deleteBtn.className = 'context-menu-button';
        deleteBtn.onclick = function () {
            this._clearContextMenuAutoHideTimer();
            MessageManager.deleteMessageLocally(messageId);
            this._hideContextMenu();
        }.bind(this);
        this.contextMenuEl.appendChild(deleteBtn);

        if (isMyMessage && !isNaN(messageTimestamp) && (Date.now() - messageTimestamp < this.MESSAGE_RETRACTION_WINDOW)) {
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

        if (this.contextMenuEl.children.length === 0) {
            this._hideContextMenu();
            return;
        }

        this.contextMenuEl.style.display = 'block';
        const menuRect = this.contextMenuEl.getBoundingClientRect();
        const menuWidth = menuRect.width;
        const menuHeight = menuRect.height;
        this.contextMenuEl.style.display = 'none';

        let x = event.clientX;
        let y = event.clientY;

        if (x + menuWidth > window.innerWidth) x = window.innerWidth - menuWidth - 5;
        if (y + menuHeight > window.innerHeight) y = window.innerHeight - menuHeight - 5;
        if (x < 0) x = 5;
        if (y < 0) y = 5;

        this.contextMenuEl.style.top = y + 'px';
        this.contextMenuEl.style.left = x + 'px';
        this.contextMenuEl.style.display = 'block';

        this.contextMenuAutoHideTimer = setTimeout(this._hideContextMenu.bind(this), this.CONTEXT_MENU_AUTOHIDE_DURATION);
    },

    /**
     * @private
     * 隐藏消息的上下文菜单。
     */
    _hideContextMenu: function () {
        // ... 此方法未改变 ...
        this._clearContextMenuAutoHideTimer();
        if (this.contextMenuEl) this.contextMenuEl.style.display = 'none';
        this.activeContextMenuMessageElement = null;
    },

    /**
     * @private
     * 清除上下文菜单的自动隐藏定时器。
     */
    _clearContextMenuAutoHideTimer: function() {
        // ... 此方法未改变 ...
        if (this.contextMenuAutoHideTimer) {
            clearTimeout(this.contextMenuAutoHideTimer);
            this.contextMenuAutoHideTimer = null;
        }
    },

    /**
     * REFACTORED: 改为私有方法，由 handleStateChange 调用。
     * 显示聊天区域，并隐藏“未选择聊天”的占位屏幕。
     */
    _showChatArea: function () {
        // 注意：LayoutUIManager 的调用现在由其自身的 state handler 处理
        if (this.noChatSelectedScreenEl) this.noChatSelectedScreenEl.style.display = 'none';
        if (this.chatBoxEl) this.chatBoxEl.style.display = 'flex';
        this._hideContextMenu();
    },

    /**
     * REFACTORED: 改为私有方法，由 handleStateChange 调用。
     * 显示“未选择聊天”的占位视图，并重置相关UI状态。
     */
    _showNoChatSelected: function () {
        if (this.chatHeaderTitleEl) this.chatHeaderTitleEl.textContent = '选择一个聊天';
        if (this.chatHeaderStatusEl) {
            this.chatHeaderStatusEl.textContent = '';
            this.chatHeaderStatusEl.className = 'chat-status-main status-indicator-neutral';
        }
        if (this.chatHeaderAvatarEl) {
            this.chatHeaderAvatarEl.innerHTML = '';
            this.chatHeaderAvatarEl.className = 'chat-avatar-main';
        }
        if (this.chatHeaderMainEl) this.chatHeaderMainEl.className = 'chat-header-main';

        if (this.chatBoxEl) {
            this.chatBoxEl.innerHTML = '';
            this.chatBoxEl.style.display = 'none';
        }
        if (this.noChatSelectedScreenEl) this.noChatSelectedScreenEl.style.display = 'flex';

        this.enableChatInterface(false);
        // DetailsPanel 的隐藏现在也由 Store 驱动
        // if (typeof DetailsPanelUIManager !== 'undefined') DetailsPanelUIManager.hideSidePanel();

        // 同样，LayoutUIManager 的视图切换也由 Store 驱动
        // if (typeof LayoutUIManager !== 'undefined') LayoutUIManager.showChatListArea();

        if (this.peopleLobbyButtonEl) {
            this.peopleLobbyButtonEl.style.display = 'block';
            this.peopleLobbyButtonEl.disabled = false;
        }

        this._hideContextMenu();

        if (this.chatInfoMainEl) {
            this.chatInfoMainEl.style.cursor = 'default';
            this.chatInfoMainEl.removeAttribute('title');
            this.chatInfoMainEl.classList.remove('clickable-chat-header');
        }

        this._detachScrollListener();
        this._currentChatIdForVirtualScroll = null;
        this._allMessagesForCurrentChat = [];
        this._renderedOldestMessageArrayIndex = -1;
        this._renderedNewestMessageArrayIndex = -1;
        this._hideScrollToLatestButton();
    },

    /**
     * REFACTORED: 重构为私有方法，从 Store state 获取所有需要的数据。
     * 更新聊天头部的标题、状态（包括状态指示圆点）和头像。
     * @param {object} state - 当前的应用状态对象。
     */
    _updateChatHeaderBasedOnState: function (state) {
        const { currentChatId, isAiServiceHealthy } = state;

        if (!currentChatId) {
            // 状态清理逻辑，如果需要的话，可以在_showNoChatSelected中处理
            return;
        }

        const isGroup = currentChatId.startsWith('group_');
        const entity = isGroup ? GroupManager.groups[currentChatId] : UserManager.contacts[currentChatId];

        if (!entity) {
            Utils.log(`_updateChatHeaderBasedOnState: 未找到实体 ${currentChatId}`, Utils.logLevels.WARN);
            return;
        }

        let title = entity.name;
        let statusText = '';
        let avatarText = 'S';

        if (isGroup) {
            statusText = `${entity.members.length} 名成员 (上限 ${GroupManager.MAX_GROUP_MEMBERS})`;
            avatarText = '👥';
        } else {
            const contact = entity;
            if (contact.isAI) {
                statusText = isAiServiceHealthy ? "服务可用" : "服务不可用";
                statusText = `AI 助手 - ${statusText}`;
            } else if (contact.isSpecial) {
                statusText = '特殊联系人';
            } else {
                statusText = ConnectionManager.isConnectedTo(currentChatId) ? '已连接' : `ID: ${contact.id.substring(0,8)}... (离线)`;
            }
            avatarText = contact.avatarText || 'S';
        }

        // --- 以下是原 updateChatHeader 的渲染逻辑 ---
        if (this.chatHeaderTitleEl) this.chatHeaderTitleEl.textContent = Utils.escapeHtml(title);

        if (this.chatHeaderStatusEl) {
            this.chatHeaderStatusEl.textContent = Utils.escapeHtml(statusText);
            this.chatHeaderStatusEl.classList.remove('status-indicator-active', 'status-indicator-inactive', 'status-indicator-neutral');
            if (isGroup) {
                this.chatHeaderStatusEl.classList.add('status-indicator-neutral');
            } else {
                const contact = entity;
                if (contact.isAI) {
                    this.chatHeaderStatusEl.classList.add(isAiServiceHealthy ? 'status-indicator-active' : 'status-indicator-inactive');
                } else if (contact.isSpecial) {
                    this.chatHeaderStatusEl.classList.add('status-indicator-active');
                } else {
                    this.chatHeaderStatusEl.classList.add(ConnectionManager.isConnectedTo(currentChatId) ? 'status-indicator-active' : 'status-indicator-inactive');
                }
            }
        }

        if (this.chatHeaderMainEl) this.chatHeaderMainEl.className = 'chat-header-main';
        if (this.chatHeaderAvatarEl) this.chatHeaderAvatarEl.className = 'chat-avatar-main';
        if (isGroup && this.chatHeaderAvatarEl) {
            this.chatHeaderAvatarEl.classList.add('group');
        }

        let finalAvatarText = avatarText ? Utils.escapeHtml(avatarText) : (title && title.length > 0) ? Utils.escapeHtml(title.charAt(0).toUpperCase()) : '?';
        let avatarContentHtml;

        if (entity.avatarUrl) {
            let imgFallback = (entity.avatarText) ? Utils.escapeHtml(entity.avatarText) : (entity.name && entity.name.length > 0) ? Utils.escapeHtml(entity.name.charAt(0).toUpperCase()) : '?';
            avatarContentHtml = `<img src="${entity.avatarUrl}" alt="${imgFallback}" class="avatar-image" data-fallback-text="${imgFallback}" data-entity-id="${entity.id}">`;
            if (entity.isSpecial) {
                if(this.chatHeaderAvatarEl) this.chatHeaderAvatarEl.classList.add('special-avatar', entity.id);
                if(this.chatHeaderMainEl) this.chatHeaderMainEl.classList.add('character-active', `current-chat-${entity.id}`);
            }
        } else {
            avatarContentHtml = finalAvatarText;
            if (entity.isSpecial) {
                if(this.chatHeaderAvatarEl) this.chatHeaderAvatarEl.classList.add('special-avatar', entity.id);
                if(this.chatHeaderMainEl) this.chatHeaderMainEl.classList.add('character-active', `current-chat-${entity.id}`);
            }
        }
        if (this.chatHeaderAvatarEl) this.chatHeaderAvatarEl.innerHTML = avatarContentHtml;

        const chatSelected = !!currentChatId;
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
     * 启用或禁用聊天输入框和相关按钮。
     * @param {boolean} enabled - true 表示启用，false 表示禁用。
     */
    enableChatInterface: function (enabled) {
        // ... 此方法未改变 ...
        const elementsToToggle = [
            this.messageInputEl, this.sendButtonEl, this.attachButtonEl,
            this.voiceButtonEl, this.screenshotMainBtnEl, this.emojiStickerBtnEl
        ];
        elementsToToggle.forEach(el => {
            if (el) el.disabled = !enabled;
        });

        if (this.peopleLobbyButtonEl) this.peopleLobbyButtonEl.disabled = false;

        this.setCallButtonsState(enabled && ChatManager.currentChatId ? ConnectionManager.isConnectedTo(ChatManager.currentChatId) : false, ChatManager.currentChatId);

        if (enabled && this.messageInputEl) {
            setTimeout(() => {
                if (this.messageInputEl) this.messageInputEl.focus();
            }, 100);
        }
    },

    /**
     * 根据连接状态和聊天类型设置通话按钮（视频、音频、屏幕共享）的可用性。
     * @param {boolean} enabled - 指示是否已连接到对方 (对于非特殊联系人)。
     * @param {string|null} [peerIdContext=null] - 当前聊天对象的ID。如果为null，则使用 ChatManager.currentChatId。
     */
    setCallButtonsState: function (enabled, peerIdContext = null) {
        // ... 此方法未改变 ...
        const targetPeerForCall = peerIdContext || ChatManager.currentChatId;
        const isGroupChat = targetPeerForCall?.startsWith('group_');
        const currentContact = UserManager.contacts[targetPeerForCall];
        const isSpecialChat = currentContact && currentContact.isSpecial;
        const canShareScreen = !!(navigator.mediaDevices && navigator.mediaDevices.getDisplayMedia);

        const finalEnabledState = enabled && targetPeerForCall && !isGroupChat && !isSpecialChat;

        if (this.videoCallButtonEl) this.videoCallButtonEl.disabled = !finalEnabledState;
        if (this.audioCallButtonEl) this.audioCallButtonEl.disabled = !finalEnabledState;
        if (this.screenShareButtonEl) this.screenShareButtonEl.disabled = !finalEnabledState || !canShareScreen;
    },

    /**
     * 为特定对方ID更新通话按钮状态（仅当该对方是当前正在进行的聊天时）。
     * @param {string} peerId - 对方的ID。
     * @param {boolean} enabled - 是否已连接到该对方。
     */
    setCallButtonsStateForPeer: function (peerId, enabled) {
        // ... 此方法未改变 ...
        if (ChatManager.currentChatId === peerId) {
            this.setCallButtonsState(enabled, peerId);
        }
    },

    /**
     * 为指定聊天设置聊天区域，包括初始化虚拟滚动。
     * 当用户切换到另一个聊天时调用此方法。
     * @param {string} chatId - 要设置的聊天ID。
     */
    setupForChat: function (chatId) {
        // ... 此方法未改变 ...
        this._detachScrollListener();
        // this._showChatArea() 已由 handleStateChange 处理
        this._currentChatIdForVirtualScroll = chatId;
        this._allMessagesForCurrentChat = [...(ChatManager.chats[chatId] || [])];
        this._isLoadingOlderMessages = false;
        this._isLoadingNewerMessages = false;
        this._renderedOldestMessageArrayIndex = -1;
        this._renderedNewestMessageArrayIndex = -1;
        this._lastScrollTop = 0;
        this._renderInitialMessageBatch();
        this._attachScrollListener();
        this._hideScrollToLatestButton();
    },

    /**
     * @private
     * 附加聊天框的滚动事件监听器。
     */
    _attachScrollListener: function () {
        // ... 此方法未改变 ...
        if (this.chatBoxEl && !this._scrollListenerAttached) {
            this.chatBoxEl.addEventListener('scroll', this._boundHandleChatScroll);
            this._scrollListenerAttached = true;
        }
    },

    /**
     * @private
     * 解绑聊天框的滚动事件监听器。
     */
    _detachScrollListener: function () {
        // ... 此方法未改变 ...
        if (this.chatBoxEl && this._scrollListenerAttached && this._boundHandleChatScroll) {
            this.chatBoxEl.removeEventListener('scroll', this._boundHandleChatScroll);
            this._scrollListenerAttached = false;
            clearTimeout(this._debounceScrollTimer);
            this._debounceScrollTimer = null;
        }
    },

    /**
     * @private
     * 滚动事件的防抖处理函数。
     * 目的是在用户连续滚动时，只在滚动停止一段时间后才执行实际的滚动处理逻辑，以提高性能。
     */
    _debouncedHandleChatScroll: function () {
        // ... 此方法未改变 ...
        clearTimeout(this._debounceScrollTimer);
        this._debounceScrollTimer = setTimeout(() => {
            this._handleChatScroll();
        }, 150);
    },

    /**
     * @private
     * 处理聊天框的滚动事件，用于触发加载更多消息（虚拟滚动）和管理“滚动到最新”按钮的显隐。
     */
    _handleChatScroll: function () {
        // ... 此方法未改变 ...
        if (!this.chatBoxEl) return;

        const { scrollTop, scrollHeight, clientHeight } = this.chatBoxEl;
        this._lastScrollTop = scrollTop;

        if (scrollTop < AppSettings.ui.virtualScrollThreshold && !this._isLoadingOlderMessages && this._renderedOldestMessageArrayIndex > 0) {
            this._loadOlderMessages();
            if (this._allMessagesForCurrentChat.length > 0 && this._renderedNewestMessageArrayIndex < this._allMessagesForCurrentChat.length - 1) {
                this._showScrollToLatestButton();
            }
        }

        const distanceToBottom = scrollHeight - scrollTop - clientHeight;
        const hasMoreNewerMessages = this._renderedNewestMessageArrayIndex < this._allMessagesForCurrentChat.length - 1;

        if (hasMoreNewerMessages && !this._isLoadingNewerMessages && distanceToBottom < AppSettings.ui.virtualScrollThreshold) {
            this._loadNewerMessages();
        }

        requestAnimationFrame(() => {
            if (!this.chatBoxEl) return;
            const finalScrollTop = this.chatBoxEl.scrollTop;
            const finalScrollHeight = this.chatBoxEl.scrollHeight;
            const finalClientHeight = this.chatBoxEl.clientHeight;
            const finalDistanceToBottom = finalScrollHeight - finalScrollTop - finalClientHeight;
            const stillHasMoreNewerMessages = this._renderedNewestMessageArrayIndex < this._allMessagesForCurrentChat.length - 1;

            if (stillHasMoreNewerMessages && !this._isLoadingNewerMessages && finalDistanceToBottom < 1) {
                const targetScrollTop = finalScrollHeight - finalClientHeight - 20;
                if (this.chatBoxEl.scrollTop < targetScrollTop) {
                    this.chatBoxEl.scrollTop = targetScrollTop;
                    Utils.log("ChatAreaUIManager: _handleChatScroll 防止停留在底部，强制向上微调。", Utils.logLevels.DEBUG);
                }
            }

            const isEffectivelyAtBottom = finalScrollHeight - finalScrollTop - finalClientHeight < 1;
            if (isEffectivelyAtBottom && !stillHasMoreNewerMessages) {
                this._hideScrollToLatestButton();
            } else if (stillHasMoreNewerMessages && !isEffectivelyAtBottom) {
                this._showScrollToLatestButton();
            }
        });
    },


    /**
     * @private
     * 渲染初始批次的消息到聊天框 (通常是最新的消息)。
     * 在 `setupForChat` 或点击“滚动到最新消息”按钮时调用。
     */
    _renderInitialMessageBatch: function () {
        // ... 此方法未改变 ...
        if (!this.chatBoxEl || !this._currentChatIdForVirtualScroll) return;

        this.chatBoxEl.innerHTML = '';
        this._hideLoadingIndicator();

        const totalMessages = this._allMessagesForCurrentChat.length;
        if (totalMessages === 0) {
            const placeholder = document.createElement('div');
            placeholder.className = "system-message";
            const contact = UserManager.contacts[this._currentChatIdForVirtualScroll];
            if (contact && contact.isSpecial) {
                placeholder.textContent = `与 ${contact.name} 开始对话吧！`;
            } else if (this._currentChatIdForVirtualScroll.startsWith('group_') &&
                GroupManager.groups[this._currentChatIdForVirtualScroll]?.owner === UserManager.userId &&
                GroupManager.groups[this._currentChatIdForVirtualScroll]?.members.length === 1) {
                placeholder.textContent = "您创建了此群组。邀请成员开始聊天吧！";
            } else {
                placeholder.textContent = "暂无消息。开始对话吧！";
            }
            this.chatBoxEl.appendChild(placeholder);
            this._renderedOldestMessageArrayIndex = -1;
            this._renderedNewestMessageArrayIndex = -1;
            return;
        }

        const endIndexInArray = totalMessages - 1;
        const startIndexInArray = Math.max(0, endIndexInArray - this.MESSAGES_TO_LOAD_ON_SCROLL + 1);

        for (let i = startIndexInArray; i <= endIndexInArray; i++) {
            MessageManager.displayMessage(this._allMessagesForCurrentChat[i], false);
        }

        this._renderedOldestMessageArrayIndex = startIndexInArray;
        this._renderedNewestMessageArrayIndex = endIndexInArray;
        this.chatBoxEl.scrollTop = this.chatBoxEl.scrollHeight;
    },

    /**
     * @private
     * 异步加载并渲染更早的一批消息。
     * 当用户向上滚动到聊天框顶部附近时触发。
     */
    _loadOlderMessages: async function () {
        // ... 此方法未改变 ...
        if (this._isLoadingOlderMessages || this._renderedOldestMessageArrayIndex === 0 || !this.chatBoxEl) return;

        this._isLoadingOlderMessages = true;
        this._showLoadingIndicatorAtTop();

        const currentOldestLoadedIndex = this._renderedOldestMessageArrayIndex;
        const newBatchEndIndexInArray = currentOldestLoadedIndex - 1;
        const newBatchStartIndexInArray = Math.max(0, newBatchEndIndexInArray - this.MESSAGES_TO_LOAD_ON_SCROLL + 1);

        if (newBatchEndIndexInArray < 0) {
            this._hideLoadingIndicator();
            this._isLoadingOlderMessages = false;
            this._renderedOldestMessageArrayIndex = 0;
            return;
        }

        const oldScrollHeight = this.chatBoxEl.scrollHeight;
        const oldScrollTop = this.chatBoxEl.scrollTop;

        for (let i = newBatchEndIndexInArray; i >= newBatchStartIndexInArray; i--) {
            MessageManager.displayMessage(this._allMessagesForCurrentChat[i], true);
        }
        this._renderedOldestMessageArrayIndex = newBatchStartIndexInArray;

        requestAnimationFrame(() => {
            const newScrollHeight = this.chatBoxEl.scrollHeight;
            this.chatBoxEl.scrollTop = oldScrollTop + (newScrollHeight - oldScrollHeight);
            this._hideLoadingIndicator();
            this._isLoadingOlderMessages = false;
        });
    },

    /**
     * @private
     * 异步加载并渲染更新的一批消息。
     * 当用户向下滚动到聊天框底部附近，且仍有未显示的更新消息时触发。
     */
    _loadNewerMessages: async function () {
        // ... 此方法未改变 ...
        if (this._isLoadingNewerMessages || this._renderedNewestMessageArrayIndex === this._allMessagesForCurrentChat.length - 1 || !this.chatBoxEl) return;
        this._isLoadingNewerMessages = true;

        const oldScrollHeight = this.chatBoxEl.scrollHeight;
        const oldScrollTop = this.chatBoxEl.scrollTop;
        const clientHeight = this.chatBoxEl.clientHeight;
        const wasAtBottomBeforeLoad = (oldScrollHeight - oldScrollTop - clientHeight) < 5;

        const currentNewestLoadedIndex = this._renderedNewestMessageArrayIndex;
        const newBatchStartIndexInArray = currentNewestLoadedIndex + 1;
        const newBatchEndIndexInArray = Math.min(this._allMessagesForCurrentChat.length - 1, newBatchStartIndexInArray + this.MESSAGES_TO_LOAD_ON_SCROLL - 1);

        if (newBatchStartIndexInArray >= this._allMessagesForCurrentChat.length) {
            this._isLoadingNewerMessages = false;
            return;
        }

        for (let i = newBatchStartIndexInArray; i <= newBatchEndIndexInArray; i++) {
            MessageManager.displayMessage(this._allMessagesForCurrentChat[i], false);
        }
        this._renderedNewestMessageArrayIndex = newBatchEndIndexInArray;
        const newScrollHeight = this.chatBoxEl.scrollHeight;

        if (wasAtBottomBeforeLoad) {
            this.chatBoxEl.scrollTop = newScrollHeight;
        } else {
            this.chatBoxEl.scrollTop = oldScrollTop;
        }

        const currentScrollTopAfterInitialAdjust = this.chatBoxEl.scrollTop;
        const currentDistanceToBottom = newScrollHeight - currentScrollTopAfterInitialAdjust - clientHeight;
        const stillHasMoreNewerMessagesAfterLoad = this._renderedNewestMessageArrayIndex < this._allMessagesForCurrentChat.length - 1;

        if (stillHasMoreNewerMessagesAfterLoad && currentDistanceToBottom < AppSettings.ui.virtualScrollThreshold) {
            let targetReboundScrollTop = newScrollHeight - clientHeight - (AppSettings.ui.virtualScrollThreshold + 10);
            targetReboundScrollTop = Math.max(0, targetReboundScrollTop);
            if (wasAtBottomBeforeLoad || targetReboundScrollTop > currentScrollTopAfterInitialAdjust) {
                this.chatBoxEl.scrollTop = targetReboundScrollTop;
                Utils.log(`ChatAreaUIManager: _loadNewerMessages 执行了滚动回弹。目标 scrollTop: ${targetReboundScrollTop.toFixed(0)}`, Utils.logLevels.DEBUG);
            }
        }

        this._isLoadingNewerMessages = false;
        if (this._renderedNewestMessageArrayIndex === this._allMessagesForCurrentChat.length - 1) {
            this._hideScrollToLatestButton();
        } else {
            this._showScrollToLatestButton();
        }
    },

    /**
     * @private
     * 在聊天框顶部显示加载指示器 (通常用于加载更早的消息时)。
     */
    _showLoadingIndicatorAtTop: function () {
        // ... 此方法未改变 ...
        if (this.chatBoxEl && this._loadingIndicatorEl) {
            this._loadingIndicatorEl.style.display = 'block';
            if (this.chatBoxEl.firstChild !== this._loadingIndicatorEl) {
                this.chatBoxEl.insertBefore(this._loadingIndicatorEl, this.chatBoxEl.firstChild);
            }
        }
    },

    /**
     * @private
     * 隐藏加载指示器。
     */
    _hideLoadingIndicator: function () {
        // ... 此方法未改变 ...
        if (this._loadingIndicatorEl) {
            this._loadingIndicatorEl.style.display = 'none';
            if (this._loadingIndicatorEl.parentNode === this.chatBoxEl) {
                this.chatBoxEl.removeChild(this._loadingIndicatorEl);
            }
        }
    },

    /**
     * 处理当前聊天的新消息，将其添加到虚拟滚动列表并显示。
     * @param {object} message - 新接收到的消息对象。
     */
    handleNewMessageForCurrentChat: function (message) {
        // ... 此方法未改变 ...
        if (!this.chatBoxEl || !this._currentChatIdForVirtualScroll || this._currentChatIdForVirtualScroll !== ChatManager.currentChatId) return;

        this._allMessagesForCurrentChat.push(message);

        const isNearBottom = this.chatBoxEl.scrollHeight - this.chatBoxEl.scrollTop - this.chatBoxEl.clientHeight < 150;

        MessageManager.displayMessage(message, false);

        if (isNearBottom) {
            this.chatBoxEl.scrollTop = this.chatBoxEl.scrollHeight;
            this._renderedNewestMessageArrayIndex = this._allMessagesForCurrentChat.length - 1;
            this._hideScrollToLatestButton();
        } else {
            this._showScrollToLatestButton();
        }

        if (this._renderedNewestMessageArrayIndex === this._allMessagesForCurrentChat.length - 2) {
            this._renderedNewestMessageArrayIndex = this._allMessagesForCurrentChat.length - 1;
        }
    },

    /**
     * 滚动到指定的消息ID并加载其上下文。
     * 此方法会处理消息可能在不同聊天中的情况。
     * @param {string} targetMessageId - 目标消息的ID。
     */
    scrollToMessage: function (targetMessageId) {
        // ... 此方法未改变 ...
        if (!this._currentChatIdForVirtualScroll || !this.chatBoxEl) {
            NotificationUIManager.showNotification("请先打开一个聊天。", "warning");
            return;
        }

        let chatIdForMessage = this._currentChatIdForVirtualScroll;
        let messageExistsInCurrentChat = ChatManager.chats[chatIdForMessage]?.some(m => m.id === targetMessageId);

        if (!messageExistsInCurrentChat) {
            const foundChatId = Object.keys(ChatManager.chats).find(cid =>
                ChatManager.chats[cid].some(m => m.id === targetMessageId)
            );
            if (foundChatId) {
                chatIdForMessage = foundChatId;
            } else {
                NotificationUIManager.showNotification("未找到目标消息。", "error");
                return;
            }
        }

        if (this._currentChatIdForVirtualScroll !== chatIdForMessage) {
            ChatManager.openChat(chatIdForMessage, chatIdForMessage.startsWith('group_') ? 'group' : 'contact');
            setTimeout(() => {
                this._performScrollToMessage(targetMessageId);
            }, 100);
            return;
        }

        this._performScrollToMessage(targetMessageId);
    },

    /**
     * @private
     * 执行实际的滚动到指定消息的操作。
     * 此方法假设当前聊天已是包含目标消息的聊天。
     * @param {string} targetMessageId - 目标消息的ID。
     */
    _performScrollToMessage: function (targetMessageId) {
        // ... 此方法未改变 ...
        this._allMessagesForCurrentChat = [...(ChatManager.chats[this._currentChatIdForVirtualScroll] || [])];
        const targetMessageIndex = this._allMessagesForCurrentChat.findIndex(msg => msg.id === targetMessageId);

        if (targetMessageIndex === -1) {
            NotificationUIManager.showNotification("在当前聊天中未找到目标消息。", "error");
            return;
        }

        this.chatBoxEl.innerHTML = '';
        this._detachScrollListener();
        this._hideLoadingIndicator();
        this._isLoadingOlderMessages = false;
        this._isLoadingNewerMessages = false;

        let startIndex = Math.max(0, targetMessageIndex - this.CONTEXT_LOAD_COUNT);
        let endIndex = Math.min(this._allMessagesForCurrentChat.length - 1, targetMessageIndex + this.CONTEXT_LOAD_COUNT);
        let currentBatchSize = endIndex - startIndex + 1;

        if (currentBatchSize < this.MESSAGES_TO_LOAD_ON_SCROLL) {
            const diff = this.MESSAGES_TO_LOAD_ON_SCROLL - currentBatchSize;
            let extendForward = Math.ceil(diff / 2);
            let extendBackward = Math.floor(diff / 2);

            const potentialStart = Math.max(0, startIndex - extendForward);
            const potentialEnd = Math.min(this._allMessagesForCurrentChat.length - 1, endIndex + extendBackward);

            if (potentialStart === 0 && potentialEnd < this._allMessagesForCurrentChat.length - 1) {
                endIndex = Math.min(this._allMessagesForCurrentChat.length - 1, startIndex + (this.MESSAGES_TO_LOAD_ON_SCROLL - 1));
            } else if (potentialEnd === this._allMessagesForCurrentChat.length - 1 && potentialStart > 0) {
                startIndex = Math.max(0, endIndex - (this.MESSAGES_TO_LOAD_ON_SCROLL - 1));
            } else {
                startIndex = potentialStart;
                endIndex = potentialEnd;
            }
        }
        startIndex = Math.max(0, startIndex);
        endIndex = Math.min(this._allMessagesForCurrentChat.length - 1, endIndex);

        for (let i = startIndex; i <= endIndex; i++) {
            MessageManager.displayMessage(this._allMessagesForCurrentChat[i], false);
        }
        this._renderedOldestMessageArrayIndex = startIndex;
        this._renderedNewestMessageArrayIndex = endIndex;

        const targetElement = this.chatBoxEl.querySelector(`.message[data-message-id="${targetMessageId}"]`);
        if (targetElement) {
            setTimeout(() => {
                targetElement.scrollIntoView({ behavior: 'auto', block: 'center' });
                this._lastScrollTop = this.chatBoxEl.scrollTop;
            }, 50);
        } else {
            this.chatBoxEl.scrollTop = this.chatBoxEl.scrollHeight / 2;
            this._lastScrollTop = this.chatBoxEl.scrollTop;
        }

        this._attachScrollListener();
        if (this._renderedNewestMessageArrayIndex < this._allMessagesForCurrentChat.length - 1) {
            this._showScrollToLatestButton();
        } else {
            this._hideScrollToLatestButton();
        }
    },

    /**
     * 新增：滚动到指定日期的第一条消息。
     * @param {string} chatId - 聊天ID。
     * @param {string} dateString - YYYY-MM-DD格式的日期字符串。
     */
    scrollToDate: function(chatId, dateString) {
        // ... 此方法未改变 ...
        Utils.log(`ChatAreaUIManager: scrollToDate 调用， chatId: ${chatId}, date: ${dateString}`, Utils.logLevels.DEBUG);
        if (!this._currentChatIdForVirtualScroll || !this.chatBoxEl) {
            NotificationUIManager.showNotification("请先打开一个聊天。", "warning");
            return;
        }

        let targetChatId = chatId;
        if (this._currentChatIdForVirtualScroll !== targetChatId) {
            ChatManager.openChat(targetChatId, targetChatId.startsWith('group_') ? 'group' : 'contact');
            setTimeout(() => {
                this._performScrollToDate(targetChatId, dateString);
            }, 100);
            return;
        }
        this._performScrollToDate(targetChatId, dateString);
    },

    /**
     * @private
     * 执行实际的滚动到指定日期第一条消息的操作。
     * @param {string} chatId - 聊天ID。
     * @param {string} dateString - YYYY-MM-DD格式的日期字符串。
     */
    _performScrollToDate: function(chatId, dateString) {
        // ... 此方法未改变 ...
        this._allMessagesForCurrentChat = [...(ChatManager.chats[chatId] || [])];
        let firstMessageOfDate = null;

        const targetDate = new Date(dateString + "T00:00:00.000Z");
        const targetDateStart = targetDate.getTime();
        targetDate.setUTCDate(targetDate.getUTCDate() + 1);
        const targetDateEnd = targetDate.getTime() -1;

        for (let i = 0; i < this._allMessagesForCurrentChat.length; i++) {
            const msg = this._allMessagesForCurrentChat[i];
            if (msg.isThinking || msg.isRetracted) continue;
            const msgTimestamp = new Date(msg.timestamp).getTime();
            if (msgTimestamp >= targetDateStart && msgTimestamp <= targetDateEnd) {
                firstMessageOfDate = msg;
                break;
            }
        }

        if (!firstMessageOfDate) {
            NotificationUIManager.showNotification(`日期 ${dateString} 没有消息。`, "info");
            return;
        }

        Utils.log(`正在滚动到 ${dateString} 的第一条消息, ID: ${firstMessageOfDate.id}`, Utils.logLevels.DEBUG);
        this._performScrollToMessage(firstMessageOfDate.id);
    },

    /**
     * @private
     * 显示“滚动到最新消息”按钮。
     * 此按钮通常在用户向上滚动查看历史消息，且有未显示的更新消息时出现。
     */
    _showScrollToLatestButton: function () {
        // ... 此方法未改变 ...
        if (!this.chatBoxEl || !this.chatBoxEl.parentElement) return;

        if (!this._scrollToLatestBtnEl) {
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
     * @private
     * 隐藏“滚动到最新消息”按钮。
     * 当用户已滚动到聊天底部，或没有更多新消息时调用。
     */
    _hideScrollToLatestButton: function () {
        // ... 此方法未改变 ...
        if (this._scrollToLatestBtnEl) {
            this._scrollToLatestBtnEl.style.display = 'none';
        }
    },

    /**
     * 滚动到最新的消息。
     * 用户点击“滚动到最新消息”按钮时调用此方法。
     */
    scrollToLatestMessages: function () {
        // ... 此方法未改变 ...
        Utils.log("ChatAreaUIManager: 滚动到最新消息...", Utils.logLevels.DEBUG);
        if (!this.chatBoxEl) return;
        this._detachScrollListener();
        this._isLoadingOlderMessages = false;
        this._isLoadingNewerMessages = false;
        this._renderInitialMessageBatch();
        this._lastScrollTop = this.chatBoxEl.scrollTop;
        this._attachScrollListener();
        this._hideScrollToLatestButton();
    }
};