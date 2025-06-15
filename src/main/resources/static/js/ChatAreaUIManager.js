/**
 * @file ChatAreaUIManager.js
 * @description 管理主聊天区域的 UI 元素和交互，包括聊天头部、消息框、输入区以及通话和截图按钮。
 *              支持消息的右键/双击上下文菜单，用于删除或撤回消息。
 *              支持消息列表的虚拟滚动，以及从资源预览跳转到特定消息。
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
 * @dependencies LayoutManager, MessageManager, VideoCallManager, ChatManager, ConnectionManager, UserManager, DetailsPanelUIManager, NotificationManager, Utils, MediaManager, PeopleLobbyManager, EventEmitter, UIManager, Config
 * @dependents AppInitializer (进行初始化)
 */
const ChatAreaUIManager = {
    // 缓存的 DOM 元素引用
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

    // 自定义上下文菜单相关属性
    contextMenuEl: null,
    activeContextMenuMessageElement: null,
    contextMenuAutoHideTimer: null,

    // 常量
    MESSAGE_RETRACTION_WINDOW: 5 * 60 * 1000, // 5 分钟 (毫秒)
    CONTEXT_MENU_AUTOHIDE_DURATION: 3000, // 3 秒 (毫秒)，用于菜单自动隐藏

    // --- 虚拟滚动属性 ---
    _currentChatIdForVirtualScroll: null,
    _allMessagesForCurrentChat: [],
    _renderedOldestMessageArrayIndex: -1,
    _renderedNewestMessageArrayIndex: -1, // 跟踪已渲染的最新消息的索引
    _isLoadingOlderMessages: false,
    _isLoadingNewerMessages: false, // 标记是否正在加载新消息
    _loadingIndicatorEl: null,
    _scrollListenerAttached: false,
    _debounceScrollTimer: null,
    _boundHandleChatScroll: null, // 用于保存 bind 后的滚动处理函数

    // --- “回到最新”按钮 ---
    _scrollToLatestBtnEl: null,
    CONTEXT_LOAD_COUNT: 10, // 跳转时加载目标消息前后各多少条
    MESSAGES_TO_LOAD_ON_SCROLL: 15, // 向上或向下滚动时加载的数量


    /**
     * 初始化模块，获取所有需要的 DOM 元素引用并绑定核心事件。
     */
    init: function() {
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

        if (this.chatBoxEl) {
            this._loadingIndicatorEl = document.createElement('div');
            this._loadingIndicatorEl.className = 'loading-indicator-older-messages';
            this._loadingIndicatorEl.innerHTML = '<div class="spinner"></div>';
        }
        this._boundHandleChatScroll = this._debouncedHandleChatScroll.bind(this);

        // “回到最新”按钮的创建和事件绑定移至 _showScrollToLatestButton 中，按需创建
        this.bindEvents();
    },

    /**
     * 绑定聊天区域内的所有 UI 事件监听器。
     */
    bindEvents: function() {
        if (this.messageInputEl) {
            this.messageInputEl.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey) {
                    e.preventDefault();
                    MessageManager.sendMessage();
                }
            });
        }
        if (this.sendButtonEl) this.sendButtonEl.addEventListener('click', MessageManager.sendMessage);
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
                this.voiceButtonEl.addEventListener('mouseleave', () => { if (!this.voiceButtonEl.disabled && MediaManager.mediaRecorder && MediaManager.mediaRecorder.state === 'recording') MediaManager.stopRecording();});
            }
        }
        if (this.screenshotMainBtnEl) this.screenshotMainBtnEl.addEventListener('click', () => MediaManager.captureScreen());
        if (this.videoCallButtonEl) this.videoCallButtonEl.onclick = () => { if(!this.videoCallButtonEl.disabled) VideoCallManager.initiateCall(ChatManager.currentChatId); };
        if (this.audioCallButtonEl) this.audioCallButtonEl.onclick = () => { if(!this.audioCallButtonEl.disabled) VideoCallManager.initiateAudioCall(ChatManager.currentChatId); };
        if (this.screenShareButtonEl) this.screenShareButtonEl.onclick = () => { if(!this.screenShareButtonEl.disabled) VideoCallManager.initiateScreenShare(ChatManager.currentChatId); };
        if (this.chatDetailsButtonEl) this.chatDetailsButtonEl.addEventListener('click', () => { if (typeof DetailsPanelUIManager !== 'undefined') DetailsPanelUIManager.toggleChatDetailsView(); });
        if (this.peopleLobbyButtonEl) this.peopleLobbyButtonEl.addEventListener('click', () => { if (typeof DetailsPanelUIManager !== 'undefined') DetailsPanelUIManager.togglePeopleLobbyView(); });

        if (this.chatAreaEl) {
            let dragCounter = 0;
            this.chatAreaEl.addEventListener('dragenter', (e) => { e.preventDefault(); e.stopPropagation(); if (ChatManager.currentChatId && e.dataTransfer && e.dataTransfer.types.includes('Files')) { dragCounter++; if (dragCounter === 1) this.chatAreaEl.classList.add('drag-over'); } });
            this.chatAreaEl.addEventListener('dragover', (e) => { e.preventDefault(); e.stopPropagation(); if (ChatManager.currentChatId && e.dataTransfer && e.dataTransfer.types.includes('Files')) e.dataTransfer.dropEffect = 'copy'; else e.dataTransfer.dropEffect = 'none'; });
            this.chatAreaEl.addEventListener('dragleave', (e) => { e.preventDefault(); e.stopPropagation(); dragCounter--; if (dragCounter === 0) this.chatAreaEl.classList.remove('drag-over'); });
            this.chatAreaEl.addEventListener('drop', (e) => { e.preventDefault(); e.stopPropagation(); dragCounter = 0; this.chatAreaEl.classList.remove('drag-over'); if (!ChatManager.currentChatId) { NotificationManager.showNotification('发送文件前请先选择一个聊天。', 'warning'); return; } if (e.dataTransfer && e.dataTransfer.files.length > 0) { const file = e.dataTransfer.files[0]; MediaManager.processFile(file); } });
        }
        if (this.chatBoxEl) {
            this.chatBoxEl.addEventListener('contextmenu', this._handleMessageInteraction.bind(this));
            this.chatBoxEl.addEventListener('dblclick', function(event) {
                const messageElement = event.target.closest('.message:not(.system):not(.retracted)');
                if (messageElement) {
                    if (event.target.closest('a, button, input, textarea, select, .file-preview-img, .play-voice-btn, .download-btn, video[controls], audio[controls]')) return;
                    this._showContextMenu(event, messageElement);
                }
            }.bind(this));
        }
    },

    /**
     * 初始化自定义上下文菜单元素并将其附加到文档中。
     * 同时绑定全局点击和 Esc 键事件以隐藏菜单。
     * @private
     */
    _initContextMenu: function() {
        this.contextMenuEl = document.createElement('div');
        this.contextMenuEl.id = 'customMessageContextMenu';
        this.contextMenuEl.className = 'custom-context-menu';
        this.contextMenuEl.style.display = 'none';
        document.body.appendChild(this.contextMenuEl);
        document.addEventListener('click', function(event) { if (this.contextMenuEl && this.contextMenuEl.style.display === 'block' && !this.contextMenuEl.contains(event.target)) this._hideContextMenu(); }.bind(this));
        document.addEventListener('keydown', function(event) { if (event.key === 'Escape' && this.contextMenuEl && this.contextMenuEl.style.display === 'block') this._hideContextMenu(); }.bind(this));
    },

    /**
     * 处理消息元素的交互事件（如右键点击）。
     * @param {MouseEvent} event - 鼠标事件对象。
     * @private
     */
    _handleMessageInteraction: function(event) {
        const messageElement = event.target.closest('.message:not(.system):not(.retracted)');
        if (!messageElement) return;
        if (event.type === 'contextmenu') { event.preventDefault(); this._showContextMenu(event, messageElement); }
    },

    /**
     * 显示自定义的上下文菜单，用于对消息进行操作（如删除、撤回）。
     * @param {MouseEvent} event - 触发菜单的鼠标事件。
     * @param {HTMLElement} messageElement - 关联的消息 DOM 元素。
     * @private
     */
    _showContextMenu: function(event, messageElement) {
        if (!this.contextMenuEl || !messageElement) return;
        this._clearContextMenuAutoHideTimer();
        const imageViewerModal = document.querySelector('.modal-like.image-viewer');
        if (imageViewerModal) imageViewerModal.remove();
        this.contextMenuEl.innerHTML = '';
        this.activeContextMenuMessageElement = messageElement;
        const messageId = messageElement.dataset.messageId;
        const messageTimestamp = parseInt(messageElement.dataset.timestamp, 10);
        const isMyMessage = messageElement.classList.contains('sent');
        if (!messageId) { this._hideContextMenu(); return; }

        const deleteBtn = document.createElement('button');
        deleteBtn.textContent = '删除'; deleteBtn.className = 'context-menu-button';
        deleteBtn.onclick = function() { this._clearContextMenuAutoHideTimer(); MessageManager.deleteMessageLocally(messageId); this._hideContextMenu(); }.bind(this);
        this.contextMenuEl.appendChild(deleteBtn);

        if (isMyMessage && !isNaN(messageTimestamp) && (Date.now() - messageTimestamp < this.MESSAGE_RETRACTION_WINDOW)) {
            const retractBtn = document.createElement('button');
            retractBtn.textContent = '撤回'; retractBtn.className = 'context-menu-button';
            retractBtn.onclick = function() { this._clearContextMenuAutoHideTimer(); MessageManager.requestRetractMessage(messageId); this._hideContextMenu(); }.bind(this);
            this.contextMenuEl.appendChild(retractBtn);
        }
        if (this.contextMenuEl.children.length === 0) { this._hideContextMenu(); return; }

        this.contextMenuEl.style.display = 'block';
        const menuRect = this.contextMenuEl.getBoundingClientRect();
        const menuWidth = menuRect.width; const menuHeight = menuRect.height;
        this.contextMenuEl.style.display = 'none';
        let x = event.clientX; let y = event.clientY;
        if (x + menuWidth > window.innerWidth) x = window.innerWidth - menuWidth - 5;
        if (y + menuHeight > window.innerHeight) y = window.innerHeight - menuHeight - 5;
        if (x < 0) x = 5; if (y < 0) y = 5;
        this.contextMenuEl.style.top = y + 'px'; this.contextMenuEl.style.left = x + 'px';
        this.contextMenuEl.style.display = 'block';
        this.contextMenuAutoHideTimer = setTimeout(this._hideContextMenu.bind(this), this.CONTEXT_MENU_AUTOHIDE_DURATION);
    },

    /**
     * 隐藏自定义上下文菜单并清除自动隐藏计时器。
     * @private
     */
    _hideContextMenu: function() {
        this._clearContextMenuAutoHideTimer();
        if (this.contextMenuEl) this.contextMenuEl.style.display = 'none';
        this.activeContextMenuMessageElement = null;
    },

    /**
     * 清除上下文菜单的自动隐藏计时器。
     * @private
     */
    _clearContextMenuAutoHideTimer: function() {
        if (this.contextMenuAutoHideTimer) { clearTimeout(this.contextMenuAutoHideTimer); this.contextMenuAutoHideTimer = null; }
    },

    /**
     * 显示聊天区域，并隐藏“未选择聊天”的占位屏幕。
     * 同时确保上下文菜单被隐藏。
     */
    showChatArea: function () {
        if (typeof LayoutManager !== 'undefined') LayoutManager.showChatAreaLayout();
        if (this.noChatSelectedScreenEl) this.noChatSelectedScreenEl.style.display = 'none';
        if (this.chatBoxEl) this.chatBoxEl.style.display = 'flex';
        this._hideContextMenu();
    },

    /**
     * 显示“未选择聊天”的占位屏幕。
     * 重置聊天头部信息，清空消息区域，禁用聊天输入接口，
     * 并隐藏侧边栏、滚动到底部按钮，同时解除滚动事件监听。
     */
    showNoChatSelected: function () {
        if (this.chatHeaderTitleEl) this.chatHeaderTitleEl.textContent = '选择一个聊天';
        if (this.chatHeaderStatusEl) this.chatHeaderStatusEl.textContent = '';
        if (this.chatHeaderAvatarEl) { this.chatHeaderAvatarEl.innerHTML = ''; this.chatHeaderAvatarEl.className = 'chat-avatar-main'; }
        if (this.chatHeaderMainEl) this.chatHeaderMainEl.className = 'chat-header-main';
        if (this.chatBoxEl) { this.chatBoxEl.innerHTML = ''; this.chatBoxEl.style.display = 'none'; }
        if (this.noChatSelectedScreenEl) this.noChatSelectedScreenEl.style.display = 'flex';
        this.enableChatInterface(false);
        if (typeof DetailsPanelUIManager !== 'undefined') DetailsPanelUIManager.hideSidePanel();
        if (typeof LayoutManager !== 'undefined') LayoutManager.showChatListArea();
        if (this.peopleLobbyButtonEl) { this.peopleLobbyButtonEl.style.display = 'block'; this.peopleLobbyButtonEl.disabled = false; }
        if (this.chatDetailsButtonEl) { this.chatDetailsButtonEl.style.display = 'none'; this.chatDetailsButtonEl.disabled = true; }
        this._hideContextMenu();
        this._detachScrollListener();
        this._currentChatIdForVirtualScroll = null;
        this._allMessagesForCurrentChat = [];
        this._renderedOldestMessageArrayIndex = -1;
        this._renderedNewestMessageArrayIndex = -1;
        this._hideScrollToLatestButton();
    },

    /**
     * 更新聊天头部的标题、状态信息、头像以及群组状态。
     * @param {string} title - 聊天标题。
     * @param {string} status - 聊天状态文本（如在线状态）。
     * @param {string} [avatarTextParam] - 用于生成头像的文本（如果头像URL不可用）。
     * @param {boolean} [isGroup=false] - 是否为群组聊天。
     */
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
        if (this.chatDetailsButtonEl) { this.chatDetailsButtonEl.style.display = chatSelected ? 'block' : 'none'; this.chatDetailsButtonEl.disabled = !chatSelected; }
        if (this.peopleLobbyButtonEl) { this.peopleLobbyButtonEl.style.display = 'block'; this.peopleLobbyButtonEl.disabled = false; }
    },

    /**
     * 更新聊天头部的状态文本。
     * @param {string} statusText - 新的状态文本。
     */
    updateChatHeaderStatus: function (statusText) {
        if (this.chatHeaderStatusEl) this.chatHeaderStatusEl.textContent = Utils.escapeHtml(statusText);
    },

    /**
     * 启用或禁用聊天输入框及相关按钮（发送、附件、语音、截图、聊天详情）。
     * 同时根据连接状态更新通话按钮的可用性。
     * @param {boolean} enabled - true 表示启用，false 表示禁用。
     */
    enableChatInterface: function (enabled) {
        const elementsToToggle = [this.messageInputEl, this.sendButtonEl, this.attachButtonEl, this.voiceButtonEl, this.chatDetailsButtonEl, this.screenshotMainBtnEl];
        elementsToToggle.forEach(el => { if (el) el.disabled = !enabled; });
        if (this.peopleLobbyButtonEl) this.peopleLobbyButtonEl.disabled = false;
        this.setCallButtonsState(enabled && ChatManager.currentChatId ? ConnectionManager.isConnectedTo(ChatManager.currentChatId) : false, ChatManager.currentChatId);
        if (enabled && this.messageInputEl) setTimeout(() => { if (this.messageInputEl) this.messageInputEl.focus(); }, 100);
    },

    /**
     * 设置通话相关按钮（视频、音频、屏幕共享）的启用状态。
     * 这些按钮的状态取决于整体启用标志、目标对方ID、是否群聊、是否特殊聊天以及浏览器能力。
     * @param {boolean} enabled - 是否启用通话功能。
     * @param {string|null} [peerIdContext=null] - 对方的ID。如果为null，则使用当前聊天ID。
     */
    setCallButtonsState: function(enabled, peerIdContext = null) {
        const targetPeerForCall = peerIdContext || ChatManager.currentChatId;
        const isGroupChat = targetPeerForCall?.startsWith('group_');
        const currentContact = UserManager.contacts[targetPeerForCall];
        const isSpecialChat = currentContact && currentContact.isSpecial;
        const canShareScreen = !!(navigator.mediaDevices && navigator.mediaDevices.getDisplayMedia);
        const finalEnabledState = enabled && targetPeerForCall && !isGroupChat && !isSpecialChat;
        if (this.videoCallButtonEl) this.videoCallButtonEl.disabled = !finalEnabledState;
        if (this.audioCallButtonEl) this.audioCallButtonEl.disabled = !finalEnabledState;
        if (this.screenShareButtonEl) this.screenShareButtonEl.disabled = !finalEnabledState || !canShareScreen;
        if (finalEnabledState) {
            if (this.videoCallButtonEl) this.videoCallButtonEl.onclick = () => VideoCallManager.initiateCall(targetPeerForCall);
            if (this.audioCallButtonEl) this.audioCallButtonEl.onclick = () => VideoCallManager.initiateAudioCall(targetPeerForCall);
            if (this.screenShareButtonEl && canShareScreen) this.screenShareButtonEl.onclick = () => VideoCallManager.initiateScreenShare(targetPeerForCall);
        } else {
            if (this.videoCallButtonEl) this.videoCallButtonEl.onclick = null;
            if (this.audioCallButtonEl) this.audioCallButtonEl.onclick = null;
            if (this.screenShareButtonEl) this.screenShareButtonEl.onclick = null;
        }
    },

    /**
     * 为特定的对方ID设置通话按钮状态。
     * 仅当该对方是当前聊天对象时，才会更新UI。
     * @param {string} peerId - 对方的ID。
     * @param {boolean} enabled - 是否启用通话功能。
     */
    setCallButtonsStateForPeer: function(peerId, enabled) {
        if (ChatManager.currentChatId === peerId) this.setCallButtonsState(enabled, peerId);
    },

    /**
     * 在聊天框中显示与指定对方断开连接的提示，并提供重新连接的选项。
     * 如果已存在针对该对方的提示，则更新提示文本和按钮状态。
     * @param {string} peerId - 断开连接的对方ID。
     * @param {function} [onReconnectSuccess] - 成功重新连接后的回调函数。
     */
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
            if (promptDiv && promptDiv.parentNode) { if (removeImmediately) promptDiv.remove(); else setTimeout(() => { if (promptDiv && promptDiv.parentNode) promptDiv.remove(); }, textElement.textContent.includes("失败") ? 5000 : 3000); }
        };
        successHandler = (connectedPeerId) => { if (connectedPeerId === peerId) { if (textElement) textElement.textContent = `已重新连接到 ${Utils.escapeHtml(peerName)}。`; if (reconnectButton) reconnectButton.style.display = 'none'; if (cancelButton) { cancelButton.textContent = '好的'; cancelButton.onclick = () => cleanupPrompt(true); } if (typeof onReconnectSuccess === 'function') onReconnectSuccess(); cleanupPrompt(); } };
        failHandler = (failedPeerId) => { if (failedPeerId === peerId) { if (textElement) textElement.textContent = `无法重新连接到 ${Utils.escapeHtml(peerName)}。请尝试手动连接或刷新页面。`; if (reconnectButton) { reconnectButton.style.display = 'initial'; reconnectButton.disabled = false; } if (cancelButton) cancelButton.textContent = '忽略'; } };
        EventEmitter.on('connectionEstablished', successHandler);
        EventEmitter.on('connectionFailed', failHandler);
        if (reconnectButton) {
            reconnectButton.onclick = async () => {
                if (textElement) textElement.textContent = `正在检查信令服务器连接...`; reconnectButton.disabled = true;
                let signalingServerNowConnected = false;
                if (ConnectionManager.isWebSocketConnected && ConnectionManager.websocket?.readyState === WebSocket.OPEN) signalingServerNowConnected = true;
                else { if (textElement) textElement.textContent = `信令服务器未连接。正在尝试连接...`; try { await ConnectionManager.connectWebSocket(); signalingServerNowConnected = ConnectionManager.isWebSocketConnected && ConnectionManager.websocket?.readyState === WebSocket.OPEN; } catch (wsError) { Utils.log(`showReconnectPrompt: 重新连接信令服务器失败: ${wsError.message || wsError}`, Utils.logLevels.ERROR); signalingServerNowConnected = false; } }
                if (signalingServerNowConnected) { if (textElement) textElement.textContent = `信令服务器已连接。正在尝试重新连接到 ${Utils.escapeHtml(peerName)} 及其他在线联系人...`; ConnectionManager.autoConnectToAllContacts(); }
                else { if (textElement) textElement.innerHTML = `无法连接到信令服务器。请检查您的网络，或尝试使用“菜单与设置”中的<br>“AI 与 API 配置 > 高级选项”进行手动连接。`; NotificationManager.showNotification('尝试使用“菜单与设置”中的“AI 与 API 配置 > 高级选项”进行手动连接。', 'error'); reconnectButton.disabled = false; }
            };
        }
        if (cancelButton) cancelButton.onclick = () => cleanupPrompt(true);
    },

    /**
     * 为指定的聊天ID设置聊天区域。
     * 这包括显示聊天区域、初始化虚拟滚动所需的数据、
     * 渲染初始消息批次，并附加滚动事件监听器。
     * @param {string} chatId - 要设置的聊天ID。
     */
    setupForChat: function(chatId) {
        this._detachScrollListener();
        this.showChatArea();
        this._currentChatIdForVirtualScroll = chatId;
        this._allMessagesForCurrentChat = [...(ChatManager.chats[chatId] || [])];
        this._isLoadingOlderMessages = false;
        this._isLoadingNewerMessages = false;
        this._renderedOldestMessageArrayIndex = -1;
        this._renderedNewestMessageArrayIndex = -1;
        this._renderInitialMessageBatch();
        this._attachScrollListener();
        this._hideScrollToLatestButton();
    },

    /**
     * 将滚动事件监听器附加到聊天框元素上，用于实现虚拟滚动。
     * @private
     */
    _attachScrollListener: function() {
        if (this.chatBoxEl && !this._scrollListenerAttached) {
            this.chatBoxEl.addEventListener('scroll', this._boundHandleChatScroll);
            this._scrollListenerAttached = true;
        }
    },

    /**
     * 从聊天框元素上移除滚动事件监听器，并清除防抖计时器。
     * @private
     */
    _detachScrollListener: function() {
        if (this.chatBoxEl && this._scrollListenerAttached && this._boundHandleChatScroll) {
            this.chatBoxEl.removeEventListener('scroll', this._boundHandleChatScroll);
            this._scrollListenerAttached = false;
            clearTimeout(this._debounceScrollTimer);
            this._debounceScrollTimer = null;
        }
    },

    /**
     * 聊天框滚动事件的防抖处理函数。
     * @private
     */
    _debouncedHandleChatScroll: function() {
        clearTimeout(this._debounceScrollTimer);
        this._debounceScrollTimer = setTimeout(() => {
            this._handleChatScroll();
        }, 150); // 调整后的防抖延迟时间
    },

    /**
     * 处理聊天框的滚动事件。
     * 当滚动到顶部附近时加载更早的消息。
     * 当滚动到底部附近时加载更新的消息（如果适用）。
     * 根据滚动位置显示或隐藏“滚动到最新”按钮。
     * @private
     */
    _handleChatScroll: function() {
        if (!this.chatBoxEl) return;
        const { scrollTop, scrollHeight, clientHeight } = this.chatBoxEl;

        if (scrollTop < Config.ui.virtualScrollThreshold && !this._isLoadingOlderMessages && this._renderedOldestMessageArrayIndex > 0) {
            this._loadOlderMessages();
            if (this._allMessagesForCurrentChat.length > 0 && this._renderedNewestMessageArrayIndex < this._allMessagesForCurrentChat.length -1) {
                this._showScrollToLatestButton();
            }
        }
        const SCROLL_TO_BOTTOM_THRESHOLD = 100;
        if ((scrollHeight - scrollTop - clientHeight) < SCROLL_TO_BOTTOM_THRESHOLD && !this._isLoadingNewerMessages && this._renderedNewestMessageArrayIndex < this._allMessagesForCurrentChat.length - 1) {
            this._loadNewerMessages();
        }
        const isAtBottom = scrollHeight - scrollTop - clientHeight < 1;
        if (isAtBottom && this._renderedNewestMessageArrayIndex === this._allMessagesForCurrentChat.length - 1) {
            this._hideScrollToLatestButton();
        }
    },

    /**
     * 渲染初始批次的消息到聊天框中。
     * 通常是加载最新的若干条消息。
     * @private
     */
    _renderInitialMessageBatch: function() {
        if (!this.chatBoxEl || !this._currentChatIdForVirtualScroll) return;
        this.chatBoxEl.innerHTML = '';
        this._hideLoadingIndicator();
        const totalMessages = this._allMessagesForCurrentChat.length;
        if (totalMessages === 0) {
            const placeholder = document.createElement('div');
            placeholder.className = "system-message";
            const contact = UserManager.contacts[this._currentChatIdForVirtualScroll];
            if (contact && contact.isSpecial) placeholder.textContent = `与 ${contact.name} 开始对话吧！`;
            else if(this._currentChatIdForVirtualScroll.startsWith('group_') && GroupManager.groups[this._currentChatIdForVirtualScroll]?.owner === UserManager.userId && GroupManager.groups[this._currentChatIdForVirtualScroll]?.members.length === 1) {
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

    /**
     * 加载并显示更早的消息批次到聊天框顶部。
     * 这是一个异步操作，会显示加载指示器。
     * @private
     */
    _loadOlderMessages: async function() {
        if (this._isLoadingOlderMessages || this._renderedOldestMessageArrayIndex === 0 || !this.chatBoxEl) return;
        this._isLoadingOlderMessages = true;
        this._showLoadingIndicatorAtTop();
        const currentOldestLoadedIndex = this._renderedOldestMessageArrayIndex;
        const newBatchEndIndexInArray = currentOldestLoadedIndex - 1;
        const newBatchStartIndexInArray = Math.max(0, newBatchEndIndexInArray - this.MESSAGES_TO_LOAD_ON_SCROLL + 1);
        if (newBatchEndIndexInArray < 0) {
            this._hideLoadingIndicator(); this._isLoadingOlderMessages = false; this._renderedOldestMessageArrayIndex = 0; return;
        }
        const oldScrollHeight = this.chatBoxEl.scrollHeight; const oldScrollTop = this.chatBoxEl.scrollTop;
        for (let i = newBatchEndIndexInArray; i >= newBatchStartIndexInArray; i--) {
            MessageManager.displayMessage(this._allMessagesForCurrentChat[i], true);
        }
        this._renderedOldestMessageArrayIndex = newBatchStartIndexInArray;
        requestAnimationFrame(() => {
            const newScrollHeight = this.chatBoxEl.scrollHeight;
            this.chatBoxEl.scrollTop = oldScrollTop + (newScrollHeight - oldScrollHeight);
            this._hideLoadingIndicator(); this._isLoadingOlderMessages = false;
        });
    },

    /**
     * 加载并显示更新的消息批次到聊天框底部。
     * 这是一个异步操作。
     * @private
     */
    _loadNewerMessages: async function() {
        if (this._isLoadingNewerMessages || this._renderedNewestMessageArrayIndex === this._allMessagesForCurrentChat.length - 1 || !this.chatBoxEl) return;
        this._isLoadingNewerMessages = true;
        // 如果需要，可以考虑在底部显示加载指示器
        const currentNewestLoadedIndex = this._renderedNewestMessageArrayIndex;
        const newBatchStartIndexInArray = currentNewestLoadedIndex + 1;
        const newBatchEndIndexInArray = Math.min(this._allMessagesForCurrentChat.length - 1, newBatchStartIndexInArray + this.MESSAGES_TO_LOAD_ON_SCROLL - 1);
        if (newBatchStartIndexInArray >= this._allMessagesForCurrentChat.length) {
            this._isLoadingNewerMessages = false; return;
        }
        const oldScrollHeight = this.chatBoxEl.scrollHeight;
        const oldScrollTop = this.chatBoxEl.scrollTop;
        const distanceToBottomBeforeLoad = oldScrollHeight - oldScrollTop - this.chatBoxEl.clientHeight;

        for (let i = newBatchStartIndexInArray; i <= newBatchEndIndexInArray; i++) {
            MessageManager.displayMessage(this._allMessagesForCurrentChat[i], false);
        }
        this._renderedNewestMessageArrayIndex = newBatchEndIndexInArray;

        // 如果用户不在最底部，尝试保持滚动位置
        const newScrollHeight = this.chatBoxEl.scrollHeight;
        if(distanceToBottomBeforeLoad > 5) { // 如果用户不在底部
            this.chatBoxEl.scrollTop = newScrollHeight - this.chatBoxEl.clientHeight - distanceToBottomBeforeLoad;
        } else { // 如果用户接近底部，则滚动到新的底部
            this.chatBoxEl.scrollTop = newScrollHeight;
        }

        this._isLoadingNewerMessages = false;
        if (this._renderedNewestMessageArrayIndex === this._allMessagesForCurrentChat.length - 1) {
            this._hideScrollToLatestButton();
        }
    },

    /**
     * 在聊天框顶部显示加载指示器。
     * @private
     */
    _showLoadingIndicatorAtTop: function() {
        if (this.chatBoxEl && this._loadingIndicatorEl) {
            this._loadingIndicatorEl.style.display = 'block';
            if (this.chatBoxEl.firstChild !== this._loadingIndicatorEl) {
                this.chatBoxEl.insertBefore(this._loadingIndicatorEl, this.chatBoxEl.firstChild);
            }
        }
    },

    /**
     * 隐藏聊天框中的加载指示器。
     * @private
     */
    _hideLoadingIndicator: function() {
        if (this._loadingIndicatorEl) {
            this._loadingIndicatorEl.style.display = 'none';
            if (this._loadingIndicatorEl.parentNode === this.chatBoxEl) {
                this.chatBoxEl.removeChild(this._loadingIndicatorEl);
            }
        }
    },

    /**
     * 处理当前聊天窗口接收到的新消息。
     * 将新消息添加到内部消息列表和UI中。
     * 如果用户接近聊天底部，则自动滚动到底部；否则显示“滚动到最新”按钮。
     * @param {object} message - 新的消息对象。
     */
    handleNewMessageForCurrentChat: function(message) {
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
        // 如果当前渲染的批次是最新的，则新消息成为新的最新渲染消息
        if (this._renderedNewestMessageArrayIndex === this._allMessagesForCurrentChat.length - 2) {
            this._renderedNewestMessageArrayIndex = this._allMessagesForCurrentChat.length - 1;
        }
    },

    /**
     * 滚动到指定的历史消息。
     * 如果目标消息不在当前打开的聊天中，会先尝试切换到对应的聊天。
     * 然后加载并显示包含目标消息及其上下文的消息批次，并将目标消息滚动到视图中央。
     * @param {string} targetMessageId - 目标消息的ID。
     */
    scrollToMessage: function(targetMessageId) {
        if (!this._currentChatIdForVirtualScroll || !this.chatBoxEl) {
            NotificationManager.showNotification("请先打开一个聊天。", "warning");
            return;
        }
        // 尝试查找此消息属于哪个聊天
        let chatIdForMessage = this._currentChatIdForVirtualScroll;
        let messageExistsInCurrentChat = ChatManager.chats[chatIdForMessage]?.some(m => m.id === targetMessageId);

        if (!messageExistsInCurrentChat) {
            const foundChatId = Object.keys(ChatManager.chats).find(cid => ChatManager.chats[cid].some(m => m.id === targetMessageId));
            if (foundChatId) {
                chatIdForMessage = foundChatId;
            } else {
                NotificationManager.showNotification("未找到目标消息。", "error");
                return;
            }
        }

        // 如果消息不在当前打开的聊天中，请先打开该聊天。
        if (this._currentChatIdForVirtualScroll !== chatIdForMessage) {
            ChatManager.openChat(chatIdForMessage, chatIdForMessage.startsWith('group_') ? 'group' : 'contact');
            // openChat 调用 setupForChat，后者更新 _allMessagesForCurrentChat。
            // 我们需要等待此操作完成。常见的模式是使用 Promise 或回调。
            // 为简单起见，这里我们使用 setTimeout。在实际应用中，需要更健壮的解决方案。
            setTimeout(() => {
                this._performScrollToMessage(targetMessageId);
            }, 100); // 根据需要调整延迟，或重构 openChat 以返回 Promise
            return;
        }
        // 如果已在正确的聊天中，则继续滚动。
        this._performScrollToMessage(targetMessageId);
    },

    /**
     * 执行实际的滚动到指定消息的操作。
     * 假设当前聊天上下文已正确设置为包含目标消息的聊天。
     * @param {string} targetMessageId - 目标消息的ID。
     * @private
     */
    _performScrollToMessage: function(targetMessageId) {
        // 此内部函数假定 _currentChatIdForVirtualScroll 和 _allMessagesForCurrentChat 已为目标消息的聊天正确设置。
        this._allMessagesForCurrentChat = [...(ChatManager.chats[this._currentChatIdForVirtualScroll] || [])];
        const targetMessageIndex = this._allMessagesForCurrentChat.findIndex(msg => msg.id === targetMessageId);

        if (targetMessageIndex === -1) {
            NotificationManager.showNotification("在当前聊天中未找到目标消息。", "error");
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
            if (potentialStart === 0 && potentialEnd < this._allMessagesForCurrentChat.length -1) {
                endIndex = Math.min(this._allMessagesForCurrentChat.length - 1, startIndex + (this.MESSAGES_TO_LOAD_ON_SCROLL - 1) );
            } else if (potentialEnd === this._allMessagesForCurrentChat.length - 1 && potentialStart > 0) {
                startIndex = Math.max(0, endIndex - (this.MESSAGES_TO_LOAD_ON_SCROLL - 1) );
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
            }, 50);
        } else {
            this.chatBoxEl.scrollTop = this.chatBoxEl.scrollHeight / 2;
        }
        this._attachScrollListener();
        if (this._renderedNewestMessageArrayIndex < this._allMessagesForCurrentChat.length - 1) {
            this._showScrollToLatestButton();
        } else {
            this._hideScrollToLatestButton();
        }
    },

    /**
     * 显示“滚动到最新消息”按钮。
     * 如果按钮不存在，则创建它。
     * @private
     */
    _showScrollToLatestButton: function() {
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

    /**
     * 隐藏“滚动到最新消息”按钮。
     * @private
     */
    _hideScrollToLatestButton: function() {
        if (this._scrollToLatestBtnEl) {
            this._scrollToLatestBtnEl.style.display = 'none';
        }
    },

    /**
     * 滚动到最新的消息。
     * 这通常涉及重新渲染初始的消息批次（即最新的消息）。
     * @private
     */
    _scrollToLatestMessages: function() {
        Utils.log("ChatAreaUIManager: 滚动到最新消息...", Utils.logLevels.DEBUG);
        this._detachScrollListener();
        this._isLoadingOlderMessages = false;
        this._isLoadingNewerMessages = false;
        this._renderInitialMessageBatch();
        this._attachScrollListener();
        this._hideScrollToLatestButton();
    }
};