/**
 * @file ChatAreaUIManager.js
 * @description 管理主聊天区域的 UI 元素和交互，包括聊天头部、消息框、输入区以及通话按钮。
 * @module ChatAreaUIManager
 * @exports {object} ChatAreaUIManager - 对外暴露的单例对象，包含管理聊天区域 UI 的所有方法。
 * @property {function} init - 初始化模块，获取 DOM 元素并绑定事件。
 * @property {function} showChatArea - 显示聊天区域并隐藏“未选择聊天”的占位屏幕。
 * @property {function} updateChatHeader - 更新聊天头部的标题、状态和头像。
 * @property {function} enableChatInterface - 启用或禁用聊天输入框和相关按钮。
 * @property {function} setCallButtonsState - 根据连接状态设置通话按钮的可用性。
 * @property {function} showReconnectPrompt - 当与对方断开连接时，在聊天框中显示重连提示。
 * @dependencies LayoutManager, MessageManager, VideoCallManager, ChatManager, ConnectionManager, UserManager, DetailsPanelUIManager, NotificationManager, Utils, MediaManager
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

        this.bindEvents();
    },

    /**
     * 绑定聊天区域内的所有 UI 事件监听器。
     */
    bindEvents: function() {
        // 绑定消息输入框的 Enter 键发送事件
        if (this.messageInputEl) {
            this.messageInputEl.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey) {
                    e.preventDefault();
                    MessageManager.sendMessage();
                }
            });
        }
        // 绑定发送按钮的点击事件
        if (this.sendButtonEl) this.sendButtonEl.addEventListener('click', MessageManager.sendMessage);

        // 绑定附件按钮的点击事件，触发隐藏的文件输入框
        if (this.attachButtonEl) this.attachButtonEl.addEventListener('click', () => {
            const fileInput = document.getElementById('fileInput');
            if (fileInput) fileInput.click();
        });

        // 绑定语音按钮事件，用于录音（支持触摸和鼠标）
        if (this.voiceButtonEl) {
            if ('ontouchstart' in window) { // 检查是否为触摸设备
                this.voiceButtonEl.addEventListener('touchstart', (e) => {
                    e.preventDefault(); // 阻止滚动等默认触摸行为
                    if (!this.voiceButtonEl.disabled) MediaManager.startRecording();
                });
                this.voiceButtonEl.addEventListener('touchend', (e) => {
                    e.preventDefault();
                    if (!this.voiceButtonEl.disabled) MediaManager.stopRecording();
                });
            } else { // 桌面鼠标事件
                this.voiceButtonEl.addEventListener('mousedown', () => {
                    if (!this.voiceButtonEl.disabled) MediaManager.startRecording();
                });
                this.voiceButtonEl.addEventListener('mouseup', () => {
                    if (!this.voiceButtonEl.disabled) MediaManager.stopRecording();
                });
                // 处理鼠标按下后移出按钮区域的情况
                this.voiceButtonEl.addEventListener('mouseleave', () => {
                    if (!this.voiceButtonEl.disabled && MediaManager.mediaRecorder && MediaManager.mediaRecorder.state === 'recording') {
                        MediaManager.stopRecording();
                    }
                });
            }
        }

        // 绑定通话相关按钮的点击事件
        if (this.videoCallButtonEl) this.videoCallButtonEl.onclick = () => {
            if(!this.videoCallButtonEl.disabled) VideoCallManager.initiateCall(ChatManager.currentChatId);
        };
        if (this.audioCallButtonEl) this.audioCallButtonEl.onclick = () => {
            if(!this.audioCallButtonEl.disabled) VideoCallManager.initiateAudioCall(ChatManager.currentChatId);
        };
        if (this.screenShareButtonEl) this.screenShareButtonEl.onclick = () => {
            if(!this.screenShareButtonEl.disabled) VideoCallManager.initiateScreenShare(ChatManager.currentChatId);
        };

        // 绑定聊天详情按钮的点击事件，用于打开右侧详情面板
        if (this.chatDetailsButtonEl) this.chatDetailsButtonEl.addEventListener('click', () => {
            if (typeof DetailsPanelUIManager !== 'undefined') DetailsPanelUIManager.toggleDetailsPanel(true);
        });

        // 绑定拖放事件监听器，用于文件发送
        if (this.chatAreaEl) {
            let dragCounter = 0; // 用于处理 dragenter/dragleave 的嵌套问题

            this.chatAreaEl.addEventListener('dragenter', (e) => {
                e.preventDefault();
                e.stopPropagation();
                // 仅当拖入的是文件且有活动聊天时才响应
                if (ChatManager.currentChatId && e.dataTransfer && e.dataTransfer.types.includes('Files')) {
                    dragCounter++;
                    if (dragCounter === 1) { // 第一次进入时显示覆盖层
                        this.chatAreaEl.classList.add('drag-over');
                    }
                }
            });

            this.chatAreaEl.addEventListener('dragover', (e) => {
                e.preventDefault();
                e.stopPropagation();
                // 设置拖放效果为“复制”
                if (ChatManager.currentChatId && e.dataTransfer && e.dataTransfer.types.includes('Files')) {
                    e.dataTransfer.dropEffect = 'copy';
                } else {
                    e.dataTransfer.dropEffect = 'none';
                }
            });

            this.chatAreaEl.addEventListener('dragleave', (e) => {
                e.preventDefault();
                e.stopPropagation();
                dragCounter--;
                if (dragCounter === 0) { // 最后一次离开时隐藏覆盖层
                    this.chatAreaEl.classList.remove('drag-over');
                }
            });

            this.chatAreaEl.addEventListener('drop', (e) => {
                e.preventDefault();
                e.stopPropagation();
                dragCounter = 0;
                this.chatAreaEl.classList.remove('drag-over');

                if (!ChatManager.currentChatId) {
                    NotificationManager.showNotification('发送文件前请先选择一个聊天。', 'warning');
                    return;
                }

                if (e.dataTransfer && e.dataTransfer.files.length > 0) {
                    const file = e.dataTransfer.files[0]; // 一次只处理一个文件
                    MediaManager.processFile(file);
                }
            });
        }
    },

    /**
     * 显示聊天区域，并隐藏“未选择聊天”的占位屏幕。
     */
    showChatArea: function () {
        if (typeof LayoutManager !== 'undefined') LayoutManager.showChatAreaLayout();

        if (this.noChatSelectedScreenEl) this.noChatSelectedScreenEl.style.display = 'none';
        if (this.chatBoxEl) this.chatBoxEl.style.display = 'flex';
    },

    /**
     * 显示“未选择聊天”的占位屏幕，并重置聊天区域的 UI。
     */
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

        this.enableChatInterface(false); // 禁用输入
        if (typeof DetailsPanelUIManager !== 'undefined') DetailsPanelUIManager.toggleDetailsPanel(false); // 关闭详情面板
        if (typeof LayoutManager !== 'undefined') LayoutManager.showChatListArea(); // 在移动端返回列表
    },

    /**
     * 更新聊天头部的标题、状态和头像。
     * @param {string} title - 聊天标题。
     * @param {string} status - 聊天状态文本（如在线、离线）。
     * @param {string} avatarTextParam - 用于生成头像的文本（通常是名称首字母）。
     * @param {boolean} [isGroup=false] - 是否为群组聊天。
     */
    updateChatHeader: function (title, status, avatarTextParam, isGroup = false) {
        if (this.chatHeaderTitleEl) this.chatHeaderTitleEl.textContent = Utils.escapeHtml(title);
        if (this.chatHeaderStatusEl) this.chatHeaderStatusEl.textContent = Utils.escapeHtml(status);

        // 重置并应用主题/类型相关的类
        if (this.chatHeaderMainEl) this.chatHeaderMainEl.className = 'chat-header-main';
        if (this.chatHeaderAvatarEl) this.chatHeaderAvatarEl.className = 'chat-avatar-main';
        if (isGroup && this.chatHeaderAvatarEl) this.chatHeaderAvatarEl.classList.add('group');

        const currentContact = UserManager.contacts[ChatManager.currentChatId];
        let finalAvatarText = avatarTextParam ? Utils.escapeHtml(avatarTextParam) :
            (title && title.length > 0) ? Utils.escapeHtml(title.charAt(0).toUpperCase()) : '?';
        let avatarContentHtml;

        // 如果有头像 URL，则使用 <img>，否则使用文本
        if (currentContact && currentContact.avatarUrl) {
            let imgFallback = (currentContact.avatarText) ? Utils.escapeHtml(currentContact.avatarText) :
                (currentContact.name && currentContact.name.length > 0) ? Utils.escapeHtml(currentContact.name.charAt(0).toUpperCase()) : '?';
            avatarContentHtml = `<img src="${currentContact.avatarUrl}" alt="${imgFallback}" class="avatar-image" data-fallback-text="${imgFallback}" data-entity-id="${currentContact.id}">`;
            if (currentContact.isSpecial && this.chatHeaderAvatarEl) this.chatHeaderAvatarEl.classList.add('special-avatar', currentContact.id);
            if (currentContact.isSpecial && this.chatHeaderMainEl) this.chatHeaderMainEl.classList.add(`current-chat-${currentContact.id}`);
        } else {
            avatarContentHtml = finalAvatarText;
            if (currentContact && currentContact.isSpecial && this.chatHeaderAvatarEl) this.chatHeaderAvatarEl.classList.add('special-avatar', currentContact.id);
            if (currentContact && currentContact.isSpecial && this.chatHeaderMainEl) this.chatHeaderMainEl.classList.add(`current-chat-${currentContact.id}`);
        }
        if (this.chatHeaderAvatarEl) this.chatHeaderAvatarEl.innerHTML = avatarContentHtml;
        if (this.chatDetailsButtonEl) this.chatDetailsButtonEl.style.display = ChatManager.currentChatId ? 'block' : 'none';
    },

    /**
     * 仅更新聊天头部的状态文本。
     * @param {string} statusText - 新的状态文本。
     */
    updateChatHeaderStatus: function (statusText) {
        if (this.chatHeaderStatusEl) this.chatHeaderStatusEl.textContent = Utils.escapeHtml(statusText);
    },

    /**
     * 启用或禁用聊天输入接口（输入框、发送按钮等）。
     * @param {boolean} enabled - 是否启用。
     */
    enableChatInterface: function (enabled) {
        const elementsToToggle = [
            this.messageInputEl, this.sendButtonEl, this.attachButtonEl,
            this.voiceButtonEl, this.chatDetailsButtonEl
        ];
        elementsToToggle.forEach(el => { if (el) el.disabled = !enabled; });

        // 根据连接状态更新通话按钮的可用性
        this.setCallButtonsState(enabled && ChatManager.currentChatId ? ConnectionManager.isConnectedTo(ChatManager.currentChatId) : false, ChatManager.currentChatId);

        // 启用时自动聚焦到输入框
        if (enabled && this.messageInputEl) {
            setTimeout(() => {
                if (this.messageInputEl) this.messageInputEl.focus();
            }, 100);
        }
    },

    /**
     * 根据连接状态设置通话按钮的可用性。
     * @param {boolean} enabled - 是否启用通话功能。
     * @param {string|null} peerIdContext - 当前聊天的对方 ID。
     */
    setCallButtonsState: function(enabled, peerIdContext = null) {
        const targetPeerForCall = peerIdContext || ChatManager.currentChatId;
        const isGroupChat = targetPeerForCall?.startsWith('group_');
        const currentContact = UserManager.contacts[targetPeerForCall];
        const isSpecialChat = currentContact && currentContact.isSpecial;

        const canShareScreen = !!(navigator.mediaDevices && navigator.mediaDevices.getDisplayMedia);
        // 最终的启用状态：对方已连接，且不是群聊或特殊联系人。
        const finalEnabledState = enabled && targetPeerForCall && !isGroupChat && !isSpecialChat;

        if (this.videoCallButtonEl) this.videoCallButtonEl.disabled = !finalEnabledState;
        if (this.audioCallButtonEl) this.audioCallButtonEl.disabled = !finalEnabledState;
        if (this.screenShareButtonEl) this.screenShareButtonEl.disabled = !finalEnabledState || !canShareScreen;

        // 更新 onclick 处理程序以确保它们使用正确的对方 ID
        if (finalEnabledState) {
            if (this.videoCallButtonEl) this.videoCallButtonEl.onclick = () => VideoCallManager.initiateCall(targetPeerForCall);
            if (this.audioCallButtonEl) this.audioCallButtonEl.onclick = () => VideoCallManager.initiateAudioCall(targetPeerForCall);
            if (this.screenShareButtonEl && canShareScreen) this.screenShareButtonEl.onclick = () => VideoCallManager.initiateScreenShare(targetPeerForCall);
        } else {
            // 如果禁用，则清除 onclick 以防止过时的调用
            if (this.videoCallButtonEl) this.videoCallButtonEl.onclick = null;
            if (this.audioCallButtonEl) this.audioCallButtonEl.onclick = null;
            if (this.screenShareButtonEl) this.screenShareButtonEl.onclick = null;
        }
    },

    /**
     * 专为 EventEmitter 调用而设计，当特定 peer 的连接状态改变时更新通话按钮。
     * @param {string} peerId - 连接状态发生变化的对方 ID。
     * @param {boolean} enabled - 新的连接状态。
     */
    setCallButtonsStateForPeer: function(peerId, enabled) {
        // 仅当事件针对当前活动的聊天时才更新 UI
        if (ChatManager.currentChatId === peerId) {
            this.setCallButtonsState(enabled, peerId);
        }
    },

    /**
     * 在聊天框中显示一个重连提示。
     * @param {string} peerId - 已断开连接的对方 ID。
     * @param {function} onReconnectSuccess - 重连成功后的回调函数。
     */
    showReconnectPrompt: function (peerId, onReconnectSuccess) {
        if (!this.chatBoxEl) return;
        let promptDiv = this.chatBoxEl.querySelector(`.system-message.reconnect-prompt[data-peer-id="${peerId}"]`);
        const peerName = UserManager.contacts[peerId]?.name || `用户 ${peerId.substring(0, 4)}`;

        // 如果提示已存在，则只更新文本和按钮状态
        if (promptDiv) {
            const textElement = promptDiv.querySelector('.reconnect-prompt-text');
            if (textElement) textElement.textContent = `与 ${peerName} 的连接已断开。`;
            const recBtn = promptDiv.querySelector('.btn-reconnect-inline');
            if (recBtn) recBtn.disabled = false;
            return;
        }

        // 创建新的提示元素
        promptDiv = document.createElement('div');
        promptDiv.className = 'system-message reconnect-prompt';
        promptDiv.setAttribute('data-peer-id', peerId);
        promptDiv.innerHTML = `
<span class="reconnect-prompt-text">与 ${peerName} 的连接已断开。</span>
<button class="btn-reconnect-inline">重新连接</button>
<button class="btn-cancel-reconnect-inline">忽略</button>
    `;
        this.chatBoxEl.appendChild(promptDiv);
        this.chatBoxEl.scrollTop = this.chatBoxEl.scrollHeight;

        const reconnectButton = promptDiv.querySelector('.btn-reconnect-inline');
        const cancelButton = promptDiv.querySelector('.btn-cancel-reconnect-inline');
        const textElement = promptDiv.querySelector('.reconnect-prompt-text');
        let successHandler, failHandler;

        // 清理函数，用于移除提示和事件监听器
        const cleanupPrompt = (removeImmediately = false) => {
            EventEmitter.off('connectionEstablished', successHandler);
            EventEmitter.off('connectionFailed', failHandler);
            if (promptDiv && promptDiv.parentNode) {
                if (removeImmediately) promptDiv.remove();
                else setTimeout(() => { if (promptDiv && promptDiv.parentNode) promptDiv.remove(); }, textElement.textContent.includes("失败") ? 5000 : 3000);
            }
        };

        // 定义成功和失败的处理器
        successHandler = (connectedPeerId) => {
            if (connectedPeerId === peerId) {
                textElement.textContent = `已重新连接到 ${peerName}。`;
                if (reconnectButton) reconnectButton.style.display = 'none';
                if (cancelButton) { cancelButton.textContent = '好的'; cancelButton.onclick = () => cleanupPrompt(true); }
                if (typeof onReconnectSuccess === 'function') onReconnectSuccess();
                cleanupPrompt();
            }
        };
        failHandler = (failedPeerId) => {
            if (failedPeerId === peerId) {
                textElement.textContent = `无法重新连接到 ${peerName}。请尝试手动连接或刷新页面。`;
                if (reconnectButton) { reconnectButton.style.display = 'initial'; reconnectButton.disabled = false; }
                if (cancelButton) cancelButton.textContent = '忽略';
            }
        };

        // 绑定事件
        EventEmitter.on('connectionEstablished', successHandler);
        EventEmitter.on('connectionFailed', failHandler);
        reconnectButton.onclick = () => {
            textElement.textContent = `正在尝试重新连接到 ${peerName}...`;
            reconnectButton.disabled = true;
            ConnectionManager.createOffer(peerId, {isSilent: false});
        };
        cancelButton.onclick = () => cleanupPrompt(true);
    }
};