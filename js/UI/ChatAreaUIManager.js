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
 *              REFACTORED: (第2阶段) 不再有公开的 showChatArea/showNoChatSelected 方法，而是订阅 Store 并根据 state 自动更新视图。
 *              REFACTORED (Phase 1): 事件监听器现在调用 ActionCreators.js 中的函数，而不是直接 dispatch action。
 * @module ChatAreaUIManager
 * @exports {object} ChatAreaUIManager - 对外暴露的单例对象，包含管理聊天区域 UI 的所有方法。
 * @property {function} init - 初始化模块，获取 DOM 元素并绑定事件。
 * @property {function} setupForChat - 为指定聊天设置聊天区域，包括初始化虚拟滚动。
 * @property {function} handleNewMessageForCurrentChat - 处理当前聊天的新消息，将其添加到虚拟滚动列表。
 * @property {function} scrollToMessage - 滚动到指定的消息ID并加载其上下文。
 * @property {function} scrollToDate - 滚动到指定日期的第一条消息。
 * @dependencies LayoutUIManager, MessageManager, VideoCallManager, ChatManager, ConnectionManager, UserManager, DetailsPanelUIManager, NotificationUIManager, Utils, MediaManager, PeopleLobbyManager, EventEmitter, UIManager, AppSettings, Store, ActionCreators
 * @dependents AppInitializer (进行初始化)
 */
const ChatAreaUIManager = {
    // DOM 元素引用
    chatAreaEl: null,
    chatHeaderTitleEl: null,
    chatHeaderStatusEl: null,
    chatHeaderAvatarEl: null,
    chatHeaderMainEl: null,
    chatBoxEl: null,
    noChatSelectedScreenEl: null,
    messageInputEl: null,
    sendButtonEl: null,
    attachButtonEl: null,
    voiceButtonEl: null,
    videoCallButtonEl: null,
    audioCallButtonEl: null,
    screenShareButtonEl: null,
    peopleLobbyButtonEl: null,
    screenshotMainBtnEl: null,
    emojiStickerBtnEl: null,

    chatInfoMainEl: null,
    // 上下文菜单相关
    contextMenuEl: null,
    activeContextMenuMessageElement: null,
    contextMenuAutoHideTimer: null,
    aiMentionSuggestionsEl: null,

    // 虚拟滚动相关状态
    _currentChatId: null, // REFACTORED: Renamed from _currentChatIdForVirtualScroll
    _allMessagesForCurrentChat: [],
    _renderedOldestMessageArrayIndex: -1,
    _renderedNewestMessageArrayIndex: -1,
    _isLoadingOlderMessages: false,
    _isLoadingNewerMessages: false,
    _loadingIndicatorEl: null,
    _scrollListenerAttached: false,
    _debounceScrollTimer: null,
    _boundHandleChatScroll: null,
    _lastScrollTop: 0,

    // 其他UI状态
    _scrollToLatestBtnEl: null,

    /**
     * 初始化模块，获取所有需要的 DOM 元素引用并绑定核心事件。
     * REFACTORED: 新增了对 Store 的订阅。
     */
    init: function () {
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
        this._initContextMenu();
        this._initAiMentionSuggestions();

        if (this.chatBoxEl) {
            this._loadingIndicatorEl = document.createElement('div');
            this._loadingIndicatorEl.className = 'loading-indicator-older-messages';
            this._loadingIndicatorEl.innerHTML = '<div class="spinner"></div>';
        }
        this._boundHandleChatScroll = this._debouncedHandleChatScroll.bind(this);
        this.bindEvents();

        // REFACTORED: 订阅 Store 的状态变化
        Store.subscribe(this.handleStateChange.bind(this));
    },

    /**
     * REFACTORED: 新增方法，用于处理从 Store 传来的状态变化。
     * @param {object} newState - 最新的应用状态。
     * @param {object} oldState - 变化前的应用状态。
     */
    handleStateChange: function(newState, oldState) {
        // 检查当前聊天 ID 是否发生变化
        if (newState.currentChatId !== this._currentChatId) {
            // BUGFIX: 必须先更新内部的 _currentChatId，因为 setupForChat 依赖的 _renderInitialMessageBatch 会检查它。
            this._currentChatId = newState.currentChatId;

            if (this._currentChatId) { // 使用已更新的内部状态进行判断
                // 打开新聊天
                this._showChatArea();
                this.setupForChat(this._currentChatId); // 使用已更新的内部状态
                this.enableChatInterface(true);
            } else {
                // 关闭聊天
                this._showNoChatSelected();
            }
        }

        // 无论聊天ID是否变化，都根据最新状态更新头部信息
        this._updateChatHeaderBasedOnState(newState);

        // 检查是否有消息更新
        // 注意：这里的逻辑在阶段三会被进一步优化，消息的渲染将直接由 chatBoxEl 订阅 Store 实现
        if (newState.lastMessageUpdate.timestamp > oldState.lastMessageUpdate.timestamp &&
            newState.lastMessageUpdate.chatId === this._currentChatId) {
            // New message for the current chat, re-render logic should be triggered
            // For simplicity, we can reload all messages to reflect the new state.
            // A more optimized approach would be to just add the new message.
            this.handleNewMessageForCurrentChat(ChatManager.chats[this._currentChatId]?.slice(-1)[0]);
        }
    },

    /**
     * @private
     * 初始化AI提及建议的UI元素。
     * 它将被添加到聊天输入区域的父容器中，以便能正确定位在输入框上方。
     */
    _initAiMentionSuggestions: function() {
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
     * REFACTORED (Phase 1): 绑定事件。所有按钮点击事件现在调用 ActionCreators.js 中的函数。
     */
    bindEvents: function () {
        if (this.messageInputEl) {
            this.messageInputEl.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey) {
                    e.preventDefault();
                    ActionCreators.sendMessageRequest(); // 调用 Action Creator
                    if (this.aiMentionSuggestionsEl) this.aiMentionSuggestionsEl.style.display = 'none';
                } else if (e.key === 'Escape') {
                    if (this.aiMentionSuggestionsEl) this.aiMentionSuggestionsEl.style.display = 'none';
                }
            });
            this.messageInputEl.addEventListener('input', this._handleMessageInputForMentions.bind(this));
            this.messageInputEl.addEventListener('paste', this._handlePasteEvent.bind(this));
        }
        if (this.sendButtonEl) {
            this.sendButtonEl.addEventListener('click', () => {
                ActionCreators.sendMessageRequest(); // 调用 Action Creator
                if (this.aiMentionSuggestionsEl) this.aiMentionSuggestionsEl.style.display = 'none';
            });
        }
        if (this.attachButtonEl) {
            this.attachButtonEl.addEventListener('click', () => {
                const fileInput = document.getElementById('fileInput');
                if (fileInput) fileInput.click();
            });
        }
        if (this.voiceButtonEl) {
            if ('ontouchstart' in window) {
                this.voiceButtonEl.addEventListener('touchstart', (e) => { e.preventDefault(); if (!this.voiceButtonEl.disabled) ActionCreators.startRecordingRequest(); });
                this.voiceButtonEl.addEventListener('touchend', (e) => { e.preventDefault(); if (!this.voiceButtonEl.disabled) ActionCreators.stopRecordingRequest(); });
            } else {
                this.voiceButtonEl.addEventListener('mousedown', () => { if (!this.voiceButtonEl.disabled) ActionCreators.startRecordingRequest(); });
                this.voiceButtonEl.addEventListener('mouseup', () => { if (!this.voiceButtonEl.disabled) ActionCreators.stopRecordingRequest(); });
                this.voiceButtonEl.addEventListener('mouseleave', () => {
                    if (!this.voiceButtonEl.disabled && MediaManager.mediaRecorder && MediaManager.mediaRecorder.state === 'recording') {
                        ActionCreators.stopRecordingRequest();
                    }
                });
            }
        }
        if (this.screenshotMainBtnEl) {
            this.screenshotMainBtnEl.addEventListener('click', () => ActionCreators.captureScreenRequest());
        }
        if (this.videoCallButtonEl) {
            this.videoCallButtonEl.addEventListener('click', () => { if (!this.videoCallButtonEl.disabled) ActionCreators.initiateCallRequest({ peerId: ChatManager.currentChatId, type: 'video' }); });
        }
        if (this.audioCallButtonEl) {
            this.audioCallButtonEl.addEventListener('click', () => { if (!this.audioCallButtonEl.disabled) ActionCreators.initiateCallRequest({ peerId: ChatManager.currentChatId, type: 'audio' }); });
        }
        if (this.screenShareButtonEl) {
            this.screenShareButtonEl.addEventListener('click', () => { if (!this.screenShareButtonEl.disabled) ActionCreators.initiateCallRequest({ peerId: ChatManager.currentChatId, type: 'screen' }); });
        }
        if (this.peopleLobbyButtonEl) {
            this.peopleLobbyButtonEl.addEventListener('click', () => {
                Store.dispatch('TOGGLE_DETAILS_PANEL', { content: 'lobby' });
            });
        }
        if (this.chatInfoMainEl) {
            this.chatInfoMainEl.addEventListener('click', () => {
                const state = Store.getState();
                if (state.currentChatId) {
                    Store.dispatch('TOGGLE_DETAILS_PANEL', { content: 'details' });
                }
            });
        }
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

    // ... (从这里到文件结尾的其他所有方法，如 _handlePasteEvent, _handleMessageInputForMentions, _initContextMenu, _showContextMenu, 虚拟滚动方法等，都保持不变。它们不直接 dispatch action，因此在阶段一无需修改)
    /**
     * @private
     * 处理粘贴事件，用于从剪贴板获取文件。
     * @param {ClipboardEvent} event - 粘贴事件对象。
     */
    _handlePasteEvent: async function(event) {
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
     * 填充 AI @ 提及建议列表。
     */
    _populateAiMentionSuggestions: function(aiContacts, lengthOfAtAndQuery) {
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

        this.contextMenuAutoHideTimer = setTimeout(this._hideContextMenu.bind(this), AppSettings.ui.contextMenuAutoHideDuration);
    },

    /**
     * @private
     * 隐藏消息的上下文菜单。
     */
    _hideContextMenu: function () {
        this._clearContextMenuAutoHideTimer();
        if (this.contextMenuEl) this.contextMenuEl.style.display = 'none';
        this.activeContextMenuMessageElement = null;
    },

    /**
     * @private
     * 清除上下文菜单的自动隐藏定时器。
     */
    _clearContextMenuAutoHideTimer: function() {
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
        if (this.noChatSelectedScreenEl) this.noChatSelectedScreenEl.style.display = 'none';
        if (this.chatBoxEl) this.chatBoxEl.style.display = 'flex';
        this._hideContextMenu();
    },

    /**
     * REFACTORED: 改为私有方法，由 handleStateChange 调用。
     * 显示“未选择聊天”的占位视图，并重置相关UI状态。
     */
    _showNoChatSelected: function () {
        // 更新头部的逻辑现在由 _updateChatHeaderBasedOnState 处理，
        // 当 chatId 为 null 时，它会自动设置“选择聊天”等默认文本。
        if (this.chatBoxEl) {
            this.chatBoxEl.innerHTML = '';
            this.chatBoxEl.style.display = 'none';
        }
        if (this.noChatSelectedScreenEl) this.noChatSelectedScreenEl.style.display = 'flex';

        this.enableChatInterface(false);
        this._hideContextMenu();

        // 移除滚动监听并清理虚拟滚动状态
        this._detachScrollListener();
        this._currentChatId = null;
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
        const { currentChatInfo } = state;

        if (this.chatHeaderTitleEl) this.chatHeaderTitleEl.textContent = Utils.escapeHtml(currentChatInfo.title);
        if (this.chatHeaderStatusEl) {
            this.chatHeaderStatusEl.textContent = Utils.escapeHtml(currentChatInfo.statusText);
            this.chatHeaderStatusEl.classList.remove('status-indicator-active', 'status-indicator-inactive', 'status-indicator-neutral');

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

        // ... (剩余的头像和 class 更新逻辑不变)
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

    enableChatInterface: function (enabled) {
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
    setCallButtonsState: function (enabled, peerIdContext = null) {
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
    setCallButtonsStateForPeer: function (peerId, enabled) {
        if (ChatManager.currentChatId === peerId) {
            this.setCallButtonsState(enabled, peerId);
        }
    },
    setupForChat: function (chatId) {
        this._detachScrollListener();
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
    _attachScrollListener: function () {
        if (this.chatBoxEl && !this._scrollListenerAttached) {
            this.chatBoxEl.addEventListener('scroll', this._boundHandleChatScroll);
            this._scrollListenerAttached = true;
        }
    },
    _detachScrollListener: function () {
        if (this.chatBoxEl && this._scrollListenerAttached && this._boundHandleChatScroll) {
            this.chatBoxEl.removeEventListener('scroll', this._boundHandleChatScroll);
            this._scrollListenerAttached = false;
            clearTimeout(this._debounceScrollTimer);
            this._debounceScrollTimer = null;
        }
    },
    _debouncedHandleChatScroll: function () {
        clearTimeout(this._debounceScrollTimer);
        this._debounceScrollTimer = setTimeout(() => {
            this._handleChatScroll();
        }, 150);
    },
    _handleChatScroll: function () {
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
    _renderInitialMessageBatch: function () {
        if (!this.chatBoxEl || !this._currentChatId) return;
        this.chatBoxEl.innerHTML = '';
        this._hideLoadingIndicator();
        const totalMessages = this._allMessagesForCurrentChat.length;
        if (totalMessages === 0) {
            const placeholder = document.createElement('div');
            placeholder.className = "system-message";
            const contact = UserManager.contacts[this._currentChatId];
            if (contact && contact.isSpecial) {
                placeholder.textContent = `与 ${contact.name} 开始对话吧！`;
            } else if (this._currentChatId.startsWith('group_') &&
                GroupManager.groups[this._currentChatId]?.owner === UserManager.userId &&
                GroupManager.groups[this._currentChatId]?.members.length === 1) {
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
        const startIndexInArray = Math.max(0, endIndexInArray - AppSettings.ui.chatScrollLoadBatchSize + 1);
        for (let i = startIndexInArray; i <= endIndexInArray; i++) {
            MessageManager.displayMessage(this._allMessagesForCurrentChat[i], false);
        }
        this._renderedOldestMessageArrayIndex = startIndexInArray;
        this._renderedNewestMessageArrayIndex = endIndexInArray;
        this.chatBoxEl.scrollTop = this.chatBoxEl.scrollHeight;
    },
    _loadOlderMessages: async function () {
        if (this._isLoadingOlderMessages || this._renderedOldestMessageArrayIndex === 0 || !this.chatBoxEl) return;
        this._isLoadingOlderMessages = true;
        this._showLoadingIndicatorAtTop();
        const currentOldestLoadedIndex = this._renderedOldestMessageArrayIndex;
        const newBatchEndIndexInArray = currentOldestLoadedIndex - 1;
        const newBatchStartIndexInArray = Math.max(0, newBatchEndIndexInArray - AppSettings.ui.chatScrollLoadBatchSize + 1);
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
    _loadNewerMessages: async function () {
        if (this._isLoadingNewerMessages || this._renderedNewestMessageArrayIndex === this._allMessagesForCurrentChat.length - 1 || !this.chatBoxEl) return;
        this._isLoadingNewerMessages = true;
        const oldScrollHeight = this.chatBoxEl.scrollHeight;
        const oldScrollTop = this.chatBoxEl.scrollTop;
        const clientHeight = this.chatBoxEl.clientHeight;
        const wasAtBottomBeforeLoad = (oldScrollHeight - oldScrollTop - clientHeight) < 5;
        const currentNewestLoadedIndex = this._renderedNewestMessageArrayIndex;
        const newBatchStartIndexInArray = currentNewestLoadedIndex + 1;
        const newBatchEndIndexInArray = Math.min(this._allMessagesForCurrentChat.length - 1, newBatchStartIndexInArray + AppSettings.ui.chatScrollLoadBatchSize - 1);
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
    _showLoadingIndicatorAtTop: function () {
        if (this.chatBoxEl && this._loadingIndicatorEl) {
            this._loadingIndicatorEl.style.display = 'block';
            if (this.chatBoxEl.firstChild !== this._loadingIndicatorEl) {
                this.chatBoxEl.insertBefore(this._loadingIndicatorEl, this.chatBoxEl.firstChild);
            }
        }
    },
    _hideLoadingIndicator: function () {
        if (this._loadingIndicatorEl) {
            this._loadingIndicatorEl.style.display = 'none';
            if (this._loadingIndicatorEl.parentNode === this.chatBoxEl) {
                this.chatBoxEl.removeChild(this._loadingIndicatorEl);
            }
        }
    },
    handleNewMessageForCurrentChat: function (message) {
        if (!message || !this.chatBoxEl || !this._currentChatId || this._currentChatId !== ChatManager.currentChatId) return;
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
    scrollToMessage: function (targetMessageId) {
        if (!this._currentChatId || !this.chatBoxEl) {
            NotificationUIManager.showNotification("请先打开一个聊天。", "warning");
            return;
        }
        let chatIdForMessage = this._currentChatId;
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
        if (this._currentChatId !== chatIdForMessage) {
            Store.dispatch('OPEN_CHAT', { chatId: chatIdForMessage });
            setTimeout(() => {
                this._performScrollToMessage(targetMessageId);
            }, 100);
            return;
        }
        this._performScrollToMessage(targetMessageId);
    },
    _performScrollToMessage: function (targetMessageId) {
        this._allMessagesForCurrentChat = [...(ChatManager.chats[this._currentChatId] || [])];
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
        let startIndex = Math.max(0, targetMessageIndex - AppSettings.ui.chatContextLoadCount);
        let endIndex = Math.min(this._allMessagesForCurrentChat.length - 1, targetMessageIndex + AppSettings.ui.chatContextLoadCount);
        let currentBatchSize = endIndex - startIndex + 1;
        if (currentBatchSize < AppSettings.ui.chatScrollLoadBatchSize) {
            const diff = AppSettings.ui.chatScrollLoadBatchSize - currentBatchSize;
            let extendForward = Math.ceil(diff / 2);
            let extendBackward = Math.floor(diff / 2);
            const potentialStart = Math.max(0, startIndex - extendForward);
            const potentialEnd = Math.min(this._allMessagesForCurrentChat.length - 1, endIndex + extendBackward);
            if (potentialStart === 0 && potentialEnd < this._allMessagesForCurrentChat.length - 1) {
                endIndex = Math.min(this._allMessagesForCurrentChat.length - 1, startIndex + (AppSettings.ui.chatScrollLoadBatchSize - 1));
            } else if (potentialEnd === this._allMessagesForCurrentChat.length - 1 && potentialStart > 0) {
                startIndex = Math.max(0, endIndex - (AppSettings.ui.chatScrollLoadBatchSize - 1));
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
    scrollToDate: function(chatId, dateString) {
        Utils.log(`ChatAreaUIManager: scrollToDate 调用， chatId: ${chatId}, date: ${dateString}`, Utils.logLevels.DEBUG);
        if (!this._currentChatId || !this.chatBoxEl) {
            NotificationUIManager.showNotification("请先打开一个聊天。", "warning");
            return;
        }
        let targetChatId = chatId;
        if (this._currentChatId !== targetChatId) {
            Store.dispatch('OPEN_CHAT', { chatId: targetChatId });
            setTimeout(() => {
                this._performScrollToDate(targetChatId, dateString);
            }, 100);
            return;
        }
        this._performScrollToDate(targetChatId, dateString);
    },
    _performScrollToDate: function(chatId, dateString) {
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
    _showScrollToLatestButton: function () {
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
    _hideScrollToLatestButton: function () {
        if (this._scrollToLatestBtnEl) {
            this._scrollToLatestBtnEl.style.display = 'none';
        }
    },
    scrollToLatestMessages: function () {
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