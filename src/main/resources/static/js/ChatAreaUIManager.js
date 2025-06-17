/**
 * @file ChatAreaUIManager.js
 * @description 管理主聊天区域的 UI 元素和交互，包括聊天头部、消息框、输入区以及通话和截图按钮。
 *              支持消息的右键/双击上下文菜单，用于删除或撤回消息。
 *              支持消息列表的虚拟滚动，以及从资源预览跳转到特定消息。
 *              加载更晚的消息现在使用与加载更早消息相同的阈值 (Config.ui.virtualScrollThreshold)，并实现滚动回弹。
 *              新增逻辑以防止用户在还有更多未加载消息时将滚动条停留在绝对底部。
 *              新增：在群聊输入框中输入 @ 时，显示 AI 成员提及建议。
 *              优化：AI提及建议列表现在精确显示在输入框上方。
 * @module ChatAreaUIManager
 * @exports {object} ChatAreaUIManager - 对外暴露的单例对象，包含管理聊天区域 UI 的所有方法。
 * @property {function} init - 初始化模块，获取 DOM 元素并绑定事件。
 * @property {function} showChatArea - 显示聊天区域并隐藏“未选择聊天”的占位屏幕。
 * @property {function} showNoChatSelected - 显示“未选择聊天”的占位视图并重置相关UI状态。
 * @property {function} updateChatHeader - 更新聊天头部的标题、状态和头像。
 * @property {function} updateChatHeaderStatus - 更新聊天头部的状态文本。
 * @property {function} enableChatInterface - 启用或禁用聊天输入框和相关按钮。
 * @property {function} setCallButtonsState - 根据连接状态和聊天类型设置通话按钮的可用性。
 * @property {function} setCallButtonsStateForPeer - 为特定对方ID更新通话按钮状态（仅当其为当前聊天时）。
 * @property {function} showReconnectPrompt - 当与对方断开连接时，在聊天框中显示重连提示。
 * @property {function} setupForChat - 为指定聊天设置聊天区域，包括初始化虚拟滚动。
 * @property {function} handleNewMessageForCurrentChat - 处理当前聊天的新消息，将其添加到虚拟滚动列表。
 * @property {function} scrollToMessage - 滚动到指定的消息ID并加载其上下文。
 * @dependencies LayoutUIManager, MessageManager, VideoCallManager, ChatManager, ConnectionManager, UserManager, DetailsPanelUIManager, NotificationUIManager, Utils, MediaManager, PeopleLobbyManager, EventEmitter, UIManager, Config
 * @dependents AppInitializer (进行初始化)
 */
const ChatAreaUIManager = {
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
    chatDetailsButtonEl: null,
    peopleLobbyButtonEl: null,
    screenshotMainBtnEl: null,

    contextMenuEl: null,
    activeContextMenuMessageElement: null,
    contextMenuAutoHideTimer: null,
    aiMentionSuggestionsEl: null,

    MESSAGE_RETRACTION_WINDOW: 5 * 60 * 1000,
    CONTEXT_MENU_AUTOHIDE_DURATION: 3000,

    _currentChatIdForVirtualScroll: null,
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

    _scrollToLatestBtnEl: null,
    CONTEXT_LOAD_COUNT: 10,
    MESSAGES_TO_LOAD_ON_SCROLL: 15,

    /**
     * 初始化模块，获取所有需要的 DOM 元素引用并绑定核心事件。
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
        this.chatDetailsButtonEl = document.getElementById('chatDetailsBtnMain');
        this.peopleLobbyButtonEl = document.getElementById('peopleLobbyButtonMain');
        this.screenshotMainBtnEl = document.getElementById('screenshotMainBtn');

        this._initContextMenu();
        this._initAiMentionSuggestions();

        if (this.chatBoxEl) {
            this._loadingIndicatorEl = document.createElement('div');
            this._loadingIndicatorEl.className = 'loading-indicator-older-messages';
            this._loadingIndicatorEl.innerHTML = '<div class="spinner"></div>';
        }
        this._boundHandleChatScroll = this._debouncedHandleChatScroll.bind(this);
        this.bindEvents();
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
     * 绑定聊天区域内的所有 UI 事件监听器。
     */
    bindEvents: function () {
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
        }
        if (this.sendButtonEl) this.sendButtonEl.addEventListener('click', () => {
            MessageManager.sendMessage();
            if (this.aiMentionSuggestionsEl) this.aiMentionSuggestionsEl.style.display = 'none';
        });
        if (this.attachButtonEl) this.attachButtonEl.addEventListener('click', () => {
            const fileInput = document.getElementById('fileInput');
            if (fileInput) fileInput.click();
        });
        if (this.voiceButtonEl) {
            if ('ontouchstart' in window) {
                this.voiceButtonEl.addEventListener('touchstart', (e) => { e.preventDefault(); if (!this.voiceButtonEl.disabled) MediaManager.startRecording(); });
                this.voiceButtonEl.addEventListener('touchend', (e) => { e.preventDefault(); if (!this.voiceButtonEl.disabled) MediaManager.stopRecording(); });
            } else {
                this.voiceButtonEl.addEventListener('mousedown', () => { if (!this.voiceButtonEl.disabled) MediaManager.startRecording(); });
                this.voiceButtonEl.addEventListener('mouseup', () => { if (!this.voiceButtonEl.disabled) MediaManager.stopRecording(); });
                this.voiceButtonEl.addEventListener('mouseleave', () => { if (!this.voiceButtonEl.disabled && MediaManager.mediaRecorder && MediaManager.mediaRecorder.state === 'recording') MediaManager.stopRecording(); });
            }
        }
        if (this.screenshotMainBtnEl) this.screenshotMainBtnEl.addEventListener('click', () => MediaManager.captureScreen());
        if (this.videoCallButtonEl) this.videoCallButtonEl.addEventListener('click', () => { if (!this.videoCallButtonEl.disabled) VideoCallManager.initiateCall(ChatManager.currentChatId); });
        if (this.audioCallButtonEl) this.audioCallButtonEl.addEventListener('click', () => { if (!this.audioCallButtonEl.disabled) VideoCallManager.initiateAudioCall(ChatManager.currentChatId); });
        if (this.screenShareButtonEl) this.screenShareButtonEl.addEventListener('click', () => { if (!this.screenShareButtonEl.disabled) VideoCallManager.initiateScreenShare(ChatManager.currentChatId); });
        if (this.chatDetailsButtonEl) this.chatDetailsButtonEl.addEventListener('click', () => { if (typeof DetailsPanelUIManager !== 'undefined') DetailsPanelUIManager.toggleChatDetailsView(); });
        if (this.peopleLobbyButtonEl) this.peopleLobbyButtonEl.addEventListener('click', () => { if (typeof DetailsPanelUIManager !== 'undefined') DetailsPanelUIManager.togglePeopleLobbyView(); });
        if (this.chatAreaEl) {
            let dragCounter = 0;
            this.chatAreaEl.addEventListener('dragenter', (e) => { e.preventDefault(); e.stopPropagation(); if (ChatManager.currentChatId && e.dataTransfer && e.dataTransfer.types.includes('Files')) { dragCounter++; if (dragCounter === 1) this.chatAreaEl.classList.add('drag-over'); } });
            this.chatAreaEl.addEventListener('dragover', (e) => { e.preventDefault(); e.stopPropagation(); if (ChatManager.currentChatId && e.dataTransfer && e.dataTransfer.types.includes('Files')) e.dataTransfer.dropEffect = 'copy'; else e.dataTransfer.dropEffect = 'none'; });
            this.chatAreaEl.addEventListener('dragleave', (e) => { e.preventDefault(); e.stopPropagation(); dragCounter--; if (dragCounter === 0) this.chatAreaEl.classList.remove('drag-over'); });
            this.chatAreaEl.addEventListener('drop', (e) => {
                e.preventDefault(); e.stopPropagation(); dragCounter = 0; this.chatAreaEl.classList.remove('drag-over');
                if (!ChatManager.currentChatId) { NotificationUIManager.showNotification('发送文件前请先选择一个聊天。', 'warning'); return; }
                if (e.dataTransfer && e.dataTransfer.files.length > 0) { const file = e.dataTransfer.files[0]; MediaManager.processFile(file); }
            });
        }
        if (this.chatBoxEl) {
            this.chatBoxEl.addEventListener('contextmenu', this._handleMessageInteraction.bind(this));
            this.chatBoxEl.addEventListener('dblclick', function (event) {
                const messageElement = event.target.closest('.message:not(.system):not(.retracted)');
                if (messageElement) { if (event.target.closest('a, button, input, textarea, select, .file-preview-img, .play-voice-btn, .download-btn, video[controls], audio[controls]')) return; this._showContextMenu(event, messageElement); }
            }.bind(this));
        }
    },

    _handleMessageInputForMentions: function() {
        if (!this.messageInputEl || !this.aiMentionSuggestionsEl || !ChatManager.currentChatId || !ChatManager.currentChatId.startsWith('group_')) {
            if (this.aiMentionSuggestionsEl) this.aiMentionSuggestionsEl.style.display = 'none';
            return;
        }
        const text = this.messageInputEl.value;
        const cursorPos = this.messageInputEl.selectionStart;
        const textBeforeCursor = text.substring(0, cursorPos);
        const atMatch = textBeforeCursor.match(/@(\w*)$/);
        if (atMatch) {
            const query = atMatch[1].toLowerCase();
            const group = GroupManager.groups[ChatManager.currentChatId];
            if (group && group.members) {
                const aiMembers = group.members.reduce((acc, memberId) => {
                    const contact = UserManager.contacts[memberId];
                    if (contact && contact.isAI && contact.name.toLowerCase().includes(query)) { acc.push(contact); }
                    return acc;
                }, []);
                if (aiMembers.length > 0) { this._populateAiMentionSuggestions(aiMembers, atMatch[0].length); }
                else { this.aiMentionSuggestionsEl.style.display = 'none'; }
            } else { this.aiMentionSuggestionsEl.style.display = 'none'; }
        } else { this.aiMentionSuggestionsEl.style.display = 'none'; }
    },

    /**
     * @private
     * 填充 AI @ 提及建议列表，并正确定位在输入框上方。
     * @param {Array<object>} aiContacts - 匹配的 AI 联系人对象数组。
     * @param {number} lengthOfAtAndQuery - `@` 符号加上查询词的长度，用于替换。
     */
    _populateAiMentionSuggestions: function(aiContacts, lengthOfAtAndQuery) {
        if (!this.aiMentionSuggestionsEl || !this.messageInputEl) return;
        this.aiMentionSuggestionsEl.innerHTML = '';
        aiContacts.forEach(contact => {
            const itemEl = document.createElement('div');
            itemEl.className = 'mention-suggestion-item';
            itemEl.textContent = contact.name;
            itemEl.addEventListener('click', () => {
                const currentText = this.messageInputEl.value;
                const cursorPos = this.messageInputEl.selectionStart;
                const textBefore = currentText.substring(0, cursorPos - lengthOfAtAndQuery);
                const textAfter = currentText.substring(cursorPos);
                this.messageInputEl.value = textBefore + '@' + contact.name + ' ' + textAfter;
                this.messageInputEl.focus();
                const newCursorPos = textBefore.length + 1 + contact.name.length + 1;
                this.messageInputEl.setSelectionRange(newCursorPos, newCursorPos);
                this.aiMentionSuggestionsEl.style.display = 'none';
            });
            this.aiMentionSuggestionsEl.appendChild(itemEl);
        });
        const inputRow = this.messageInputEl.closest('.input-row');
        if (inputRow) {
            this.aiMentionSuggestionsEl.style.bottom = inputRow.offsetHeight + 'px';
            this.aiMentionSuggestionsEl.style.left = '0px';
            this.aiMentionSuggestionsEl.style.right = '0px';
            this.aiMentionSuggestionsEl.style.width = 'auto';
        } else {
            this.aiMentionSuggestionsEl.style.bottom = this.messageInputEl.offsetHeight + 5 + 'px';
            this.aiMentionSuggestionsEl.style.left = this.messageInputEl.offsetLeft + 'px';
            this.aiMentionSuggestionsEl.style.width = this.messageInputEl.offsetWidth + 'px';
        }
        this.aiMentionSuggestionsEl.style.display = 'block';
    },
    // ... (其他方法保持不变) ...
    _initContextMenu: function () {
        this.contextMenuEl = document.createElement('div');
        this.contextMenuEl.id = 'customMessageContextMenu';
        this.contextMenuEl.className = 'custom-context-menu';
        this.contextMenuEl.style.display = 'none';
        document.body.appendChild(this.contextMenuEl);
        document.addEventListener('click', function (event) {
            if (this.contextMenuEl && this.contextMenuEl.style.display === 'block' && !this.contextMenuEl.contains(event.target)) this._hideContextMenu();
        }.bind(this));
        document.addEventListener('keydown', function (event) {
            if (event.key === 'Escape' && this.contextMenuEl && this.contextMenuEl.style.display === 'block') this._hideContextMenu();
        }.bind(this));
    },
    _handleMessageInteraction: function (event) {
        const messageElement = event.target.closest('.message:not(.system):not(.retracted)');
        if (!messageElement) return;
        if (event.type === 'contextmenu') {
            event.preventDefault();
            this._showContextMenu(event, messageElement);
        }
    },
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
    _hideContextMenu: function () {
        this._clearContextMenuAutoHideTimer();
        if (this.contextMenuEl) this.contextMenuEl.style.display = 'none';
        this.activeContextMenuMessageElement = null;
    },
    _clearContextMenuAutoHideTimer: function () {
        if (this.contextMenuAutoHideTimer) {
            clearTimeout(this.contextMenuAutoHideTimer);
            this.contextMenuAutoHideTimer = null;
        }
    },
    showChatArea: function () {
        if (typeof LayoutUIManager !== 'undefined') LayoutUIManager.showChatAreaLayout();
        if (this.noChatSelectedScreenEl) this.noChatSelectedScreenEl.style.display = 'none';
        if (this.chatBoxEl) this.chatBoxEl.style.display = 'flex';
        this._hideContextMenu();
    },
    showNoChatSelected: function () {
        if (this.chatHeaderTitleEl) this.chatHeaderTitleEl.textContent = '选择一个聊天';
        if (this.chatHeaderStatusEl) this.chatHeaderStatusEl.textContent = '';
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
        if (typeof DetailsPanelUIManager !== 'undefined') DetailsPanelUIManager.hideSidePanel();
        if (typeof LayoutUIManager !== 'undefined') LayoutUIManager.showChatListArea();
        if (this.peopleLobbyButtonEl) {
            this.peopleLobbyButtonEl.style.display = 'block';
            this.peopleLobbyButtonEl.disabled = false;
        }
        if (this.chatDetailsButtonEl) {
            this.chatDetailsButtonEl.style.display = 'none';
            this.chatDetailsButtonEl.disabled = true;
        }
        this._hideContextMenu();
        this._detachScrollListener();
        this._currentChatIdForVirtualScroll = null;
        this._allMessagesForCurrentChat = [];
        this._renderedOldestMessageArrayIndex = -1;
        this._renderedNewestMessageArrayIndex = -1;
        this._hideScrollToLatestButton();
    },
    updateChatHeader: function (title, status, avatarTextParam, isGroup = false) {
        if (this.chatHeaderTitleEl) this.chatHeaderTitleEl.textContent = Utils.escapeHtml(title);
        if (this.chatHeaderStatusEl) this.chatHeaderStatusEl.textContent = Utils.escapeHtml(status);
        if (this.chatHeaderMainEl) this.chatHeaderMainEl.className = 'chat-header-main';
        if (this.chatHeaderAvatarEl) this.chatHeaderAvatarEl.className = 'chat-avatar-main';
        if (isGroup && this.chatHeaderAvatarEl) this.chatHeaderAvatarEl.classList.add('group');
        const currentContact = UserManager.contacts[ChatManager.currentChatId];
        let finalAvatarText = avatarTextParam ? Utils.escapeHtml(avatarTextParam) : (title && title.length > 0) ? Utils.escapeHtml(title.charAt(0).toUpperCase()) : '?';
        let avatarContentHtml;
        if (currentContact && currentContact.avatarUrl) {
            let imgFallback = (currentContact.avatarText) ? Utils.escapeHtml(currentContact.avatarText) : (currentContact.name && currentContact.name.length > 0) ? Utils.escapeHtml(currentContact.name.charAt(0).toUpperCase()) : '?';
            avatarContentHtml = `<img src="${currentContact.avatarUrl}" alt="${imgFallback}" class="avatar-image" data-fallback-text="${imgFallback}" data-entity-id="${currentContact.id}">`;
            if (currentContact.isSpecial && this.chatHeaderAvatarEl) this.chatHeaderAvatarEl.classList.add('special-avatar', currentContact.id);
            if (currentContact.isSpecial && this.chatHeaderMainEl) this.chatHeaderMainEl.classList.add('character-active', `current-chat-${currentContact.id}`);
        } else {
            avatarContentHtml = finalAvatarText;
            if (currentContact && currentContact.isSpecial && this.chatHeaderAvatarEl) this.chatHeaderAvatarEl.classList.add('special-avatar', currentContact.id);
            if (currentContact && currentContact.isSpecial && this.chatHeaderMainEl) this.chatHeaderMainEl.classList.add('character-active', `current-chat-${currentContact.id}`);
        }
        if (this.chatHeaderAvatarEl) this.chatHeaderAvatarEl.innerHTML = avatarContentHtml;
        const chatSelected = !!ChatManager.currentChatId;
        if (this.chatDetailsButtonEl) {
            this.chatDetailsButtonEl.style.display = chatSelected ? 'block' : 'none';
            this.chatDetailsButtonEl.disabled = !chatSelected;
        }
        if (this.peopleLobbyButtonEl) {
            this.peopleLobbyButtonEl.style.display = 'block';
            this.peopleLobbyButtonEl.disabled = false;
        }
    },
    updateChatHeaderStatus: function (statusText) {
        if (this.chatHeaderStatusEl) this.chatHeaderStatusEl.textContent = Utils.escapeHtml(statusText);
    },
    enableChatInterface: function (enabled) {
        const elementsToToggle = [this.messageInputEl, this.sendButtonEl, this.attachButtonEl, this.voiceButtonEl, this.chatDetailsButtonEl, this.screenshotMainBtnEl];
        elementsToToggle.forEach(el => {
            if (el) el.disabled = !enabled;
        });
        if (this.peopleLobbyButtonEl) this.peopleLobbyButtonEl.disabled = false;
        this.setCallButtonsState(enabled && ChatManager.currentChatId ? ConnectionManager.isConnectedTo(ChatManager.currentChatId) : false, ChatManager.currentChatId);
        if (enabled && this.messageInputEl) setTimeout(() => {
            if (this.messageInputEl) this.messageInputEl.focus();
        }, 100);
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
        if (ChatManager.currentChatId === peerId) this.setCallButtonsState(enabled, peerId);
    },
    showReconnectPrompt: function (peerId, onReconnectSuccess) {
        if (!this.chatBoxEl) return;
        let promptDiv = this.chatBoxEl.querySelector(`.system-message.reconnect-prompt[data-peer-id="${peerId}"]`);
        const peerName = UserManager.contacts[peerId]?.name || `用户 ${peerId.substring(0, 4)}`;
        if (promptDiv) {
            const textElement = promptDiv.querySelector('.reconnect-prompt-text');
            if (textElement) textElement.textContent = `与 ${Utils.escapeHtml(peerName)} 的连接已断开。`;
            const recBtn = promptDiv.querySelector('.message-inline-action-button:not(.secondary-action)');
            if (recBtn) recBtn.disabled = false;
            return;
        }
        promptDiv = document.createElement('div');
        promptDiv.setAttribute('data-message-id', `reconnect_prompt_${peerId}_${Date.now()}`);
        promptDiv.className = 'message system reconnect-prompt';
        promptDiv.setAttribute('data-peer-id', peerId);
        promptDiv.innerHTML = `<div class="message-content system-text"><span class="reconnect-prompt-text">与 ${Utils.escapeHtml(peerName)} 的连接已断开。</span><button class="message-inline-action-button">重新连接</button><button class="message-inline-action-button secondary-action">忽略</button></div>`;
        this.chatBoxEl.appendChild(promptDiv);
        this.chatBoxEl.scrollTop = this.chatBoxEl.scrollHeight;
        const reconnectButton = promptDiv.querySelector('.message-inline-action-button:not(.secondary-action)');
        const cancelButton = promptDiv.querySelector('.message-inline-action-button.secondary-action');
        const textElement = promptDiv.querySelector('.reconnect-prompt-text');
        let successHandler, failHandler;
        const cleanupPrompt = (removeImmediately = false) => {
            EventEmitter.off('connectionEstablished', successHandler);
            EventEmitter.off('connectionFailed', failHandler);
            if (promptDiv && promptDiv.parentNode) {
                if (removeImmediately) promptDiv.remove(); else setTimeout(() => {
                    if (promptDiv && promptDiv.parentNode) promptDiv.remove();
                }, textElement.textContent.includes("失败") ? 5000 : 3000);
            }
        };
        successHandler = (connectedPeerId) => {
            if (connectedPeerId === peerId) {
                if (textElement) textElement.textContent = `已重新连接到 ${Utils.escapeHtml(peerName)}。`;
                if (reconnectButton) reconnectButton.style.display = 'none';
                if (cancelButton) {
                    cancelButton.textContent = '好的';
                    cancelButton.onclick = () => cleanupPrompt(true);
                }
                if (typeof onReconnectSuccess === 'function') onReconnectSuccess();
                cleanupPrompt();
            }
        };
        failHandler = (failedPeerId) => {
            if (failedPeerId === peerId) {
                if (textElement) textElement.textContent = `无法重新连接到 ${Utils.escapeHtml(peerName)}。请尝试手动连接或刷新页面。`;
                if (reconnectButton) {
                    reconnectButton.style.display = 'initial';
                    reconnectButton.disabled = false;
                }
                if (cancelButton) cancelButton.textContent = '忽略';
            }
        };
        EventEmitter.on('connectionEstablished', successHandler);
        EventEmitter.on('connectionFailed', failHandler);
        if (reconnectButton) {
            reconnectButton.onclick = async () => {
                if (textElement) textElement.textContent = `正在检查信令服务器连接...`;
                reconnectButton.disabled = true;
                let signalingServerNowConnected;
                if (ConnectionManager.isWebSocketConnected && ConnectionManager.websocket?.readyState === WebSocket.OPEN) signalingServerNowConnected = true; else {
                    if (textElement) textElement.textContent = `信令服务器未连接。正在尝试连接...`;
                    try {
                        await ConnectionManager.connectWebSocket();
                        signalingServerNowConnected = ConnectionManager.isWebSocketConnected && ConnectionManager.websocket?.readyState === WebSocket.OPEN;
                    } catch (wsError) {
                        Utils.log(`showReconnectPrompt: 重新连接信令服务器失败: ${wsError.message || wsError}`, Utils.logLevels.ERROR);
                        signalingServerNowConnected = false;
                    }
                }
                if (signalingServerNowConnected) {
                    if (textElement) textElement.textContent = `信令服务器已连接。正在尝试重新连接到 ${Utils.escapeHtml(peerName)} ...`;
                } else {
                    if (textElement) textElement.innerHTML = `无法连接到信令服务器。请检查您的网络，或尝试使用“菜单与设置”中的<br>“AI 与 API 配置 > 高级选项”进行手动连接。`;
                    NotificationUIManager.showNotification('尝试使用“菜单与设置”中的“AI 与 API 配置 > 高级选项”进行手动连接。', 'error');
                    reconnectButton.disabled = false;
                }
            };
        }
        if (cancelButton) cancelButton.onclick = () => cleanupPrompt(true);
    },
    setupForChat: function (chatId) {
        this._detachScrollListener();
        this.showChatArea();
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
        const {scrollTop, scrollHeight, clientHeight} = this.chatBoxEl;
        this._lastScrollTop = scrollTop;

        if (scrollTop < Config.ui.virtualScrollThreshold && !this._isLoadingOlderMessages && this._renderedOldestMessageArrayIndex > 0) {
            this._loadOlderMessages();
            if (this._allMessagesForCurrentChat.length > 0 && this._renderedNewestMessageArrayIndex < this._allMessagesForCurrentChat.length - 1) {
                this._showScrollToLatestButton();
            }
        }

        const distanceToBottom = scrollHeight - scrollTop - clientHeight;
        const hasMoreNewerMessages = this._renderedNewestMessageArrayIndex < this._allMessagesForCurrentChat.length - 1;

        if (hasMoreNewerMessages && !this._isLoadingNewerMessages && distanceToBottom < Config.ui.virtualScrollThreshold) {
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
        if (!this.chatBoxEl || !this._currentChatIdForVirtualScroll) return;
        this.chatBoxEl.innerHTML = '';
        this._hideLoadingIndicator();
        const totalMessages = this._allMessagesForCurrentChat.length;
        if (totalMessages === 0) {
            const placeholder = document.createElement('div');
            placeholder.className = "system-message";
            const contact = UserManager.contacts[this._currentChatIdForVirtualScroll];
            if (contact && contact.isSpecial) placeholder.textContent = `与 ${contact.name} 开始对话吧！`; else if (this._currentChatIdForVirtualScroll.startsWith('group_') && GroupManager.groups[this._currentChatIdForVirtualScroll]?.owner === UserManager.userId && GroupManager.groups[this._currentChatIdForVirtualScroll]?.members.length === 1) {
                placeholder.textContent = "您创建了此群组。邀请成员开始聊天吧！";
            } else placeholder.textContent = "暂无消息。开始对话吧！";
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
    _loadOlderMessages: async function () {
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
    _loadNewerMessages: async function () {
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

        if (stillHasMoreNewerMessagesAfterLoad && currentDistanceToBottom < Config.ui.virtualScrollThreshold) {
            let targetReboundScrollTop = newScrollHeight - clientHeight - (Config.ui.virtualScrollThreshold + 10);
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
    scrollToMessage: function (targetMessageId) {
        if (!this._currentChatIdForVirtualScroll || !this.chatBoxEl) {
            NotificationUIManager.showNotification("请先打开一个聊天。", "warning");
            return;
        }
        let chatIdForMessage = this._currentChatIdForVirtualScroll;
        let messageExistsInCurrentChat = ChatManager.chats[chatIdForMessage]?.some(m => m.id === targetMessageId);

        if (!messageExistsInCurrentChat) {
            const foundChatId = Object.keys(ChatManager.chats).find(cid => ChatManager.chats[cid].some(m => m.id === targetMessageId));
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
    _performScrollToMessage: function (targetMessageId) {
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
                targetElement.scrollIntoView({behavior: 'auto', block: 'center'});
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
    _showScrollToLatestButton: function () {
        if (!this.chatBoxEl || !this.chatBoxEl.parentElement) return;
        if (!this._scrollToLatestBtnEl) {
            this._scrollToLatestBtnEl = document.createElement('button');
            this._scrollToLatestBtnEl.id = 'scrollToLatestBtn';
            this._scrollToLatestBtnEl.className = 'scroll-to-latest-btn';
            this._scrollToLatestBtnEl.innerHTML = '▼';
            this._scrollToLatestBtnEl.title = '滚动到最新消息';
            this._scrollToLatestBtnEl.onclick = this._scrollToLatestMessages.bind(this);
            this.chatBoxEl.parentElement.appendChild(this._scrollToLatestBtnEl);
        }
        this._scrollToLatestBtnEl.style.display = 'flex';
    },
    _hideScrollToLatestButton: function () {
        if (this._scrollToLatestBtnEl) {
            this._scrollToLatestBtnEl.style.display = 'none';
        }
    },
    _scrollToLatestMessages: function () {
        Utils.log("ChatAreaUIManager: 滚动到最新消息...", Utils.logLevels.DEBUG);
        this._detachScrollListener();
        this._isLoadingOlderMessages = false;
        this._isLoadingNewerMessages = false;
        this._renderInitialMessageBatch();
        this._lastScrollTop = this.chatBoxEl.scrollTop;
        this._attachScrollListener();
        this._hideScrollToLatestButton();
    }
};