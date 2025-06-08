// MODIFIED: ChatAreaUIManager.js
// - Added voiceButtonMain event listeners for recording.
const ChatAreaUIManager = {
    // DOM Elements
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
            const fileInput = document.getElementById('fileInput'); // fileInput is in index.html
            if (fileInput) fileInput.click();
        });

        // Bind voice button events for recording
        if (this.voiceButtonEl) {
            if ('ontouchstart' in window) { // Check for touch support
                this.voiceButtonEl.addEventListener('touchstart', (e) => {
                    e.preventDefault(); // Prevent default touch actions like scrolling or zooming
                    if (!this.voiceButtonEl.disabled) MediaManager.startRecording();
                });
                this.voiceButtonEl.addEventListener('touchend', (e) => {
                    e.preventDefault();
                    if (!this.voiceButtonEl.disabled) MediaManager.stopRecording();
                });
            } else { // Mouse events
                this.voiceButtonEl.addEventListener('mousedown', () => {
                    if (!this.voiceButtonEl.disabled) MediaManager.startRecording();
                });
                this.voiceButtonEl.addEventListener('mouseup', () => {
                    if (!this.voiceButtonEl.disabled) MediaManager.stopRecording();
                });
                this.voiceButtonEl.addEventListener('mouseleave', () => {
                    // Only stop if recording and mouse leaves button while pressed
                    if (!this.voiceButtonEl.disabled && MediaManager.mediaRecorder && MediaManager.mediaRecorder.state === 'recording') {
                        MediaManager.stopRecording();
                    }
                });
            }
        }

        // Call buttons - onclicks are set dynamically by setCallButtonsState or VideoCallManager
        // But we can set initial shells or ensure they call VideoCallManager correctly.
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
    },

    showChatArea: function () {
        if (typeof LayoutManager !== 'undefined') LayoutManager.showChatAreaLayout();

        if (this.noChatSelectedScreenEl) this.noChatSelectedScreenEl.style.display = 'none';
        if (this.chatBoxEl) this.chatBoxEl.style.display = 'flex';
    },

    showNoChatSelected: function () {
        if (this.chatHeaderTitleEl) this.chatHeaderTitleEl.textContent = 'Select a chat';
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

        // Pass currentChatId to setCallButtonsState for context
        this.setCallButtonsState(enabled && ChatManager.currentChatId ? ConnectionManager.isConnectedTo(ChatManager.currentChatId) : false, ChatManager.currentChatId);

        if (enabled && this.messageInputEl) {
            setTimeout(() => {
                if (this.messageInputEl) this.messageInputEl.focus();
            }, 100);
        }
    },

    setCallButtonsState: function(enabled, peerIdContext = null) {
        // Use peerIdContext which should be ChatManager.currentChatId when called from enableChatInterface or openChat
        const targetPeerForCall = peerIdContext || ChatManager.currentChatId;

        const isGroupChat = targetPeerForCall?.startsWith('group_');
        const currentContact = UserManager.contacts[targetPeerForCall];
        const isSpecialChat = currentContact && currentContact.isSpecial;

        const canShareScreen = !!(navigator.mediaDevices && navigator.mediaDevices.getDisplayMedia);
        // A call is possible if 'enabled' (peer connected or conditions met), not a group, and not a special contact (unless special contacts can be called)
        const finalEnabledState = enabled && targetPeerForCall && !isGroupChat && !isSpecialChat;

        if (this.videoCallButtonEl) this.videoCallButtonEl.disabled = !finalEnabledState;
        if (this.audioCallButtonEl) this.audioCallButtonEl.disabled = !finalEnabledState;
        if (this.screenShareButtonEl) this.screenShareButtonEl.disabled = !finalEnabledState || !canShareScreen;

        // Update onclick handlers to ensure they use the correct targetPeerForCall
        if (finalEnabledState) {
            if (this.videoCallButtonEl) this.videoCallButtonEl.onclick = () => VideoCallManager.initiateCall(targetPeerForCall);
            if (this.audioCallButtonEl) this.audioCallButtonEl.onclick = () => VideoCallManager.initiateAudioCall(targetPeerForCall);
            if (this.screenShareButtonEl && canShareScreen) this.screenShareButtonEl.onclick = () => VideoCallManager.initiateScreenShare(targetPeerForCall);
        } else {
            // Clear onclicks if not enabled to prevent outdated calls
            if (this.videoCallButtonEl) this.videoCallButtonEl.onclick = null;
            if (this.audioCallButtonEl) this.audioCallButtonEl.onclick = null;
            if (this.screenShareButtonEl) this.screenShareButtonEl.onclick = null;
        }
    },

    setCallButtonsStateForPeer: function(peerId, enabled) { // Called by EventEmitter
        if (ChatManager.currentChatId === peerId) { // Only update if the event is for the currently active chat
            this.setCallButtonsState(enabled, peerId);
        }
    },

    showReconnectPrompt: function (peerId, onReconnectSuccess) {
        if (!this.chatBoxEl) return;
        let promptDiv = this.chatBoxEl.querySelector(`.system-message.reconnect-prompt[data-peer-id="${peerId}"]`);
        const peerName = UserManager.contacts[peerId]?.name || `Peer ${peerId.substring(0, 4)}`;

        if (promptDiv) {
            const textElement = promptDiv.querySelector('.reconnect-prompt-text');
            if (textElement) textElement.textContent = `Connection to ${peerName} lost.`;
            const recBtn = promptDiv.querySelector('.btn-reconnect-inline');
            if (recBtn) recBtn.disabled = false;
            return;
        }

        promptDiv = document.createElement('div');
        promptDiv.className = 'system-message reconnect-prompt';
        promptDiv.setAttribute('data-peer-id', peerId);
        promptDiv.innerHTML = `
            <span class="reconnect-prompt-text">Connection to ${peerName} lost.</span>
            <button class="btn-reconnect-inline">Reconnect</button>
            <button class="btn-cancel-reconnect-inline">Dismiss</button>
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
                else setTimeout(() => { if (promptDiv && promptDiv.parentNode) promptDiv.remove(); }, textElement.textContent.includes("Failed") ? 5000 : 3000);
            }
        };

        successHandler = (connectedPeerId) => {
            if (connectedPeerId === peerId) {
                textElement.textContent = `Reconnected to ${peerName}.`;
                if (reconnectButton) reconnectButton.style.display = 'none';
                if (cancelButton) { cancelButton.textContent = 'OK'; cancelButton.onclick = () => cleanupPrompt(true); }
                if (typeof onReconnectSuccess === 'function') onReconnectSuccess();
                cleanupPrompt();
            }
        };
        failHandler = (failedPeerId) => {
            if (failedPeerId === peerId) {
                textElement.textContent = `Failed to reconnect to ${peerName}. Try manual connection or refresh.`;
                if (reconnectButton) { reconnectButton.style.display = 'initial'; reconnectButton.disabled = false; }
                if (cancelButton) cancelButton.textContent = 'Dismiss';
            }
        };

        EventEmitter.on('connectionEstablished', successHandler);
        EventEmitter.on('connectionFailed', failHandler);
        reconnectButton.onclick = () => {
            textElement.textContent = `Attempting to reconnect to ${peerName}...`;
            reconnectButton.disabled = true;
            ConnectionManager.createOffer(peerId, {isSilent: false});
        };
        cancelButton.onclick = () => cleanupPrompt(true);
    }
};