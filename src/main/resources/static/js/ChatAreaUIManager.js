// MODIFIED: ChatAreaUIManager.js (已翻译为中文)
// - 添加了用于录音的 voiceButtonMain 事件监听器。
// - 添加了用于文件发送的拖放事件监听器。
const ChatAreaUIManager = {
    // DOM 元素
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
            const fileInput = document.getElementById('fileInput'); // fileInput 在 index.html 中
            if (fileInput) fileInput.click();
        });

        // 绑定语音按钮事件用于录音
        if (this.voiceButtonEl) {
            if ('ontouchstart' in window) { // 检查是否支持触摸
                this.voiceButtonEl.addEventListener('touchstart', (e) => {
                    e.preventDefault(); // 阻止默认的触摸操作，如滚动或缩放
                    if (!this.voiceButtonEl.disabled) MediaManager.startRecording();
                });
                this.voiceButtonEl.addEventListener('touchend', (e) => {
                    e.preventDefault();
                    if (!this.voiceButtonEl.disabled) MediaManager.stopRecording();
                });
            } else { // 鼠标事件
                this.voiceButtonEl.addEventListener('mousedown', () => {
                    if (!this.voiceButtonEl.disabled) MediaManager.startRecording();
                });
                this.voiceButtonEl.addEventListener('mouseup', () => {
                    if (!this.voiceButtonEl.disabled) MediaManager.stopRecording();
                });
                this.voiceButtonEl.addEventListener('mouseleave', () => {
                    // 仅当正在录音且鼠标在按下的状态下离开按钮时才停止
                    if (!this.voiceButtonEl.disabled && MediaManager.mediaRecorder && MediaManager.mediaRecorder.state === 'recording') {
                        MediaManager.stopRecording();
                    }
                });
            }
        }

        // 通话按钮 - onclick 事件由 setCallButtonsState 或 VideoCallManager 动态设置。
        // 但我们可以设置初始框架或确保它们正确调用 VideoCallManager。
        if (this.videoCallButtonEl) this.videoCallButtonEl.onclick = () => {
            if(!this.videoCallButtonEl.disabled) VideoCallManager.initiateCall(ChatManager.currentChatId);
        };
        if (this.audioCallButtonEl) this.audioCallButtonEl.onclick = () => {
            if(!this.audioCallButtonEl.disabled) VideoCallManager.initiateAudioCall(ChatManager.currentChatId);
        };
        if (this.screenShareButtonEl) this.screenShareButtonEl.onclick = () => {
            if(!this.screenShareButtonEl.disabled) VideoCallManager.initiateScreenShare(ChatManager.currentChatId);
        };


        if (this.chatDetailsButtonEl) this.chatDetailsButtonEl.addEventListener('click', () => {
            if (typeof DetailsPanelUIManager !== 'undefined') DetailsPanelUIManager.toggleDetailsPanel(true);
        });

        // 文件发送的拖放事件监听器
        if (this.chatAreaEl) {
            let dragCounter = 0;

            this.chatAreaEl.addEventListener('dragenter', (e) => {
                e.preventDefault();
                e.stopPropagation();
                if (ChatManager.currentChatId && e.dataTransfer && e.dataTransfer.types.includes('Files')) {
                    dragCounter++;
                    if (dragCounter === 1) {
                        this.chatAreaEl.classList.add('drag-over');
                    }
                }
            });

            this.chatAreaEl.addEventListener('dragover', (e) => {
                e.preventDefault();
                e.stopPropagation();
                if (ChatManager.currentChatId && e.dataTransfer && e.dataTransfer.types.includes('Files')) {
                    e.dataTransfer.dropEffect = 'copy'; // 显示复制光标
                } else {
                    e.dataTransfer.dropEffect = 'none';
                }
            });

            this.chatAreaEl.addEventListener('dragleave', (e) => {
                e.preventDefault();
                e.stopPropagation();
                dragCounter--;
                if (dragCounter === 0) {
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
                    const file = e.dataTransfer.files[0];
                    // 对现有 audioData 的检查现在位于 MediaManager.processFile 内部
                    MediaManager.processFile(file);
                }
            });
        }
    },

    showChatArea: function () {
        if (typeof LayoutManager !== 'undefined') LayoutManager.showChatAreaLayout();

        if (this.noChatSelectedScreenEl) this.noChatSelectedScreenEl.style.display = 'none';
        if (this.chatBoxEl) this.chatBoxEl.style.display = 'flex';
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
        if (typeof DetailsPanelUIManager !== 'undefined') DetailsPanelUIManager.toggleDetailsPanel(false);
        if (typeof LayoutManager !== 'undefined') LayoutManager.showChatListArea();
    },

    updateChatHeader: function (title, status, avatarTextParam, isGroup = false) {
        if (this.chatHeaderTitleEl) this.chatHeaderTitleEl.textContent = Utils.escapeHtml(title);
        if (this.chatHeaderStatusEl) this.chatHeaderStatusEl.textContent = Utils.escapeHtml(status);

        if (this.chatHeaderMainEl) this.chatHeaderMainEl.className = 'chat-header-main';
        if (this.chatHeaderAvatarEl) this.chatHeaderAvatarEl.className = 'chat-avatar-main';
        if (isGroup && this.chatHeaderAvatarEl) this.chatHeaderAvatarEl.classList.add('group');

        const currentContact = UserManager.contacts[ChatManager.currentChatId];
        let finalAvatarText = avatarTextParam ? Utils.escapeHtml(avatarTextParam) :
            (title && title.length > 0) ? Utils.escapeHtml(title.charAt(0).toUpperCase()) : '?';
        let avatarContentHtml;

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

    updateChatHeaderStatus: function (statusText) {
        if (this.chatHeaderStatusEl) this.chatHeaderStatusEl.textContent = Utils.escapeHtml(statusText);
    },

    enableChatInterface: function (enabled) {
        const elementsToToggle = [
            this.messageInputEl, this.sendButtonEl, this.attachButtonEl,
            this.voiceButtonEl, this.chatDetailsButtonEl
        ];
        elementsToToggle.forEach(el => { if (el) el.disabled = !enabled; });

        // 将 currentChatId 传递给 setCallButtonsState 作为上下文
        this.setCallButtonsState(enabled && ChatManager.currentChatId ? ConnectionManager.isConnectedTo(ChatManager.currentChatId) : false, ChatManager.currentChatId);

        if (enabled && this.messageInputEl) {
            setTimeout(() => {
                if (this.messageInputEl) this.messageInputEl.focus();
            }, 100);
        }
    },

    setCallButtonsState: function(enabled, peerIdContext = null) {
        // 使用 peerIdContext，它在从 enableChatInterface 或 openChat 调用时应为 ChatManager.currentChatId
        const targetPeerForCall = peerIdContext || ChatManager.currentChatId;

        const isGroupChat = targetPeerForCall?.startsWith('group_');
        const currentContact = UserManager.contacts[targetPeerForCall];
        const isSpecialChat = currentContact && currentContact.isSpecial;

        const canShareScreen = !!(navigator.mediaDevices && navigator.mediaDevices.getDisplayMedia);
        // 只有在 'enabled' (对方已连接或满足条件)、不是群聊、也不是特殊联系人(除非特殊联系人可通话)的情况下，才能进行通话
        const finalEnabledState = enabled && targetPeerForCall && !isGroupChat && !isSpecialChat;

        if (this.videoCallButtonEl) this.videoCallButtonEl.disabled = !finalEnabledState;
        if (this.audioCallButtonEl) this.audioCallButtonEl.disabled = !finalEnabledState;
        if (this.screenShareButtonEl) this.screenShareButtonEl.disabled = !finalEnabledState || !canShareScreen;

        // 更新 onclick 处理程序以确保它们使用正确的 targetPeerForCall
        if (finalEnabledState) {
            if (this.videoCallButtonEl) this.videoCallButtonEl.onclick = () => VideoCallManager.initiateCall(targetPeerForCall);
            if (this.audioCallButtonEl) this.audioCallButtonEl.onclick = () => VideoCallManager.initiateAudioCall(targetPeerForCall);
            if (this.screenShareButtonEl && canShareScreen) this.screenShareButtonEl.onclick = () => VideoCallManager.initiateScreenShare(targetPeerForCall);
        } else {
            // 如果未启用，则清除 onclick 以防止过时的调用
            if (this.videoCallButtonEl) this.videoCallButtonEl.onclick = null;
            if (this.audioCallButtonEl) this.audioCallButtonEl.onclick = null;
            if (this.screenShareButtonEl) this.screenShareButtonEl.onclick = null;
        }
    },

    setCallButtonsStateForPeer: function(peerId, enabled) { // 由 EventEmitter 调用
        if (ChatManager.currentChatId === peerId) { // 仅当事件针对当前活动聊天时才更新
            this.setCallButtonsState(enabled, peerId);
        }
    },

    showReconnectPrompt: function (peerId, onReconnectSuccess) {
        if (!this.chatBoxEl) return;
        let promptDiv = this.chatBoxEl.querySelector(`.system-message.reconnect-prompt[data-peer-id="${peerId}"]`);
        const peerName = UserManager.contacts[peerId]?.name || `用户 ${peerId.substring(0, 4)}`;

        if (promptDiv) {
            const textElement = promptDiv.querySelector('.reconnect-prompt-text');
            if (textElement) textElement.textContent = `与 ${peerName} 的连接已断开。`;
            const recBtn = promptDiv.querySelector('.btn-reconnect-inline');
            if (recBtn) recBtn.disabled = false;
            return;
        }

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

        const cleanupPrompt = (removeImmediately = false) => {
            EventEmitter.off('connectionEstablished', successHandler);
            EventEmitter.off('connectionFailed', failHandler);
            if (promptDiv && promptDiv.parentNode) {
                if (removeImmediately) promptDiv.remove();
                else setTimeout(() => { if (promptDiv && promptDiv.parentNode) promptDiv.remove(); }, textElement.textContent.includes("失败") ? 5000 : 3000);
            }
        };

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