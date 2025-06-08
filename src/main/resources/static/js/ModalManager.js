// NEW FILE: ModalManager.js
// Responsibilities:
// - Managing the display state of all modals.
// - Handling generic confirmation dialogs.
// - Managing UI for call-related modals (request, calling).
// - Managing the Open Source Info modal.
const ModalManager = {
    // Open Source Info Modal elements
    openSourceInfoModal: null,
    closeOpenSourceInfoModalBtn: null,
    permanentlyCloseOpenSourceInfoModalBtn: null,
    openSourceModalTimerSpan: null,
    openSourceModalAutoCloseTimer: null,
    openSourceModalCountdownInterval: null,

    // Other modal elements
    mainMenuModal: null,
    newContactGroupModal: null,
    callingModal: null,
    callingModalTitle: null,
    callingModalText: null,
    callingModalAvatar: null,
    callingModalCancelBtn: null,
    videoCallRequestModal: null,

    init: function() {
        // Open Source Info Modal
        this.openSourceInfoModal = document.getElementById('openSourceInfoModal');
        this.closeOpenSourceInfoModalBtn = document.getElementById('closeOpenSourceInfoModalBtn');
        this.permanentlyCloseOpenSourceInfoModalBtn = document.getElementById('permanentlyCloseOpenSourceInfoModalBtn');
        this.openSourceModalTimerSpan = document.getElementById('openSourceModalTimer');
        this._bindOpenSourceInfoModalEvents();

        // Main Menu Modal
        this.mainMenuModal = document.getElementById('mainMenuModal');
        const closeMainMenuBtn = document.querySelector('.close-modal-btn[data-modal-id="mainMenuModal"]');
        if (closeMainMenuBtn) closeMainMenuBtn.addEventListener('click', () => this.toggleModal('mainMenuModal', false));
        document.getElementById('mainMenuBtn').addEventListener('click', () => {
            this.toggleModal('mainMenuModal', true);
            // Refresh network status when main menu is opened
            if (typeof AppInitializer !== 'undefined' && AppInitializer.refreshNetworkStatusUI) { // Check if AppInitializer is defined
                AppInitializer.refreshNetworkStatusUI();
            }
            // Update settings UI elements if SettingsUIManager is available
            if (typeof SettingsUIManager !== 'undefined') {
                SettingsUIManager.updateMainMenuControlsState();
            }
        });


        // New Chat/Group Modal
        this.newContactGroupModal = document.getElementById('newContactGroupModal');
        const closeNewContactGroupModalBtn = document.querySelector('.close-modal-btn[data-modal-id="newContactGroupModal"]');
        if (closeNewContactGroupModalBtn) closeNewContactGroupModalBtn.addEventListener('click', () => this.toggleModal('newContactGroupModal', false));

        const newChatFab = document.getElementById('newChatFab');
        if (newChatFab) newChatFab.addEventListener('click', () => this.toggleModal('newContactGroupModal', true));

        const confirmNewContactBtn = document.getElementById('confirmNewContactBtn');
        if (confirmNewContactBtn) confirmNewContactBtn.addEventListener('click', () => {
            // This logic was in UIManager.handleAddNewContact
            const peerId = document.getElementById('newPeerIdInput').value.trim();
            const peerName = document.getElementById('newPeerNameInput').value.trim();
            if (!peerId) {
                NotificationManager.showNotification('Peer ID is required.', 'warning');
                return;
            }
            UserManager.addContact(peerId, peerName || `Peer ${peerId.substring(0, 4)}`);
            document.getElementById('newPeerIdInput').value = '';
            document.getElementById('newPeerNameInput').value = '';
            this.toggleModal('newContactGroupModal', false);
        });

        const confirmNewGroupBtnModal = document.getElementById('confirmNewGroupBtnModal');
        if (confirmNewGroupBtnModal) confirmNewGroupBtnModal.addEventListener('click', () => {
            // This logic was in UIManager.handleCreateNewGroup
            const groupName = document.getElementById('newGroupNameInput').value.trim();
            if (!groupName) {
                NotificationManager.showNotification('Group Name is required.', 'warning');
                return;
            }
            GroupManager.createGroup(groupName);
            document.getElementById('newGroupNameInput').value = '';
            this.toggleModal('newContactGroupModal', false);
        });


        // Calling Modal elements
        this.callingModal = document.getElementById('callingModal');
        this.callingModalTitle = document.getElementById('callingModalTitle');
        this.callingModalText = document.getElementById('callingModalText');
        this.callingModalAvatar = document.getElementById('callingModalAvatar');
        this.callingModalCancelBtn = document.getElementById('callingModalCancelBtn');

        // Call Request Modal elements
        this.videoCallRequestModal = document.getElementById('videoCallRequest');
    },

    _bindOpenSourceInfoModalEvents: function () {
        if (this.closeOpenSourceInfoModalBtn) {
            this.closeOpenSourceInfoModalBtn.addEventListener('click', () => this.hideOpenSourceInfoModal());
        }
        if (this.permanentlyCloseOpenSourceInfoModalBtn) {
            this.permanentlyCloseOpenSourceInfoModalBtn.addEventListener('click', () => {
                localStorage.setItem('hideOpenSourceModalPermanently', 'true');
                this.hideOpenSourceInfoModal();
            });
        }
    },

    showOpenSourceInfoModal: function () {
        if (localStorage.getItem('hideOpenSourceModalPermanently') === 'true') {
            return;
        }
        if (this.openSourceInfoModal && this.openSourceModalTimerSpan) {
            this.openSourceInfoModal.style.display = 'flex';
            let countdown = 15;
            this.openSourceModalTimerSpan.textContent = countdown;

            if (this.openSourceModalAutoCloseTimer) clearTimeout(this.openSourceModalAutoCloseTimer);
            if (this.openSourceModalCountdownInterval) clearInterval(this.openSourceModalCountdownInterval);

            this.openSourceModalCountdownInterval = setInterval(() => {
                countdown--;
                this.openSourceModalTimerSpan.textContent = countdown;
                if (countdown <= 0) {
                    clearInterval(this.openSourceModalCountdownInterval);
                }
            }, 1000);

            this.openSourceModalAutoCloseTimer = setTimeout(() => {
                this.hideOpenSourceInfoModal();
            }, 15000);
        } else {
            Utils.log("Open Source Info Modal elements not found or not initialized.", Utils.logLevels.WARN);
        }
    },

    hideOpenSourceInfoModal: function () {
        if (this.openSourceInfoModal) {
            this.openSourceInfoModal.style.display = 'none';
        }
        if (this.openSourceModalAutoCloseTimer) clearTimeout(this.openSourceModalAutoCloseTimer);
        if (this.openSourceModalCountdownInterval) clearInterval(this.openSourceModalCountdownInterval);
        this.openSourceModalAutoCloseTimer = null;
        this.openSourceModalCountdownInterval = null;
    },

    toggleModal: function (modalId, show) {
        const modal = document.getElementById(modalId); // Get dynamically, as they might not all be properties
        if (modal) {
            modal.style.display = show ? 'flex' : 'none';
        } else {
            Utils.log(`Modal with ID '${modalId}' not found.`, Utils.logLevels.WARN);
        }
    },

    showConfirmationModal: function (message, onConfirm, onCancel = null, options = {}) {
        const existingModal = document.getElementById('genericConfirmationModal');
        if (existingModal) {
            existingModal.remove();
        }

        const modalId = 'genericConfirmationModal';
        const modal = document.createElement('div');
        modal.id = modalId;
        modal.className = 'modal-like confirmation-modal';
        modal.style.display = 'flex';

        const modalContent = document.createElement('div');
        modalContent.className = 'modal-content';

        const modalHeader = document.createElement('div');
        modalHeader.className = 'modal-header';
        const titleElement = document.createElement('h2');
        titleElement.textContent = options.title || 'Confirm Action';
        modalHeader.appendChild(titleElement);

        const modalBody = document.createElement('div');
        modalBody.className = 'modal-body';
        const messageParagraph = document.createElement('p');
        messageParagraph.innerHTML = Utils.escapeHtml(message).replace(/\n/g, '<br>');
        modalBody.appendChild(messageParagraph);

        const modalFooter = document.createElement('div');
        modalFooter.className = 'modal-footer';

        const confirmButton = document.createElement('button');
        confirmButton.textContent = options.confirmText || 'Confirm';
        confirmButton.className = `btn ${options.confirmClass || 'btn-danger'}`;
        confirmButton.onclick = () => {
            if (onConfirm) onConfirm();
            modal.remove();
        };

        const cancelButton = document.createElement('button');
        cancelButton.textContent = options.cancelText || 'Cancel';
        cancelButton.className = `btn ${options.cancelClass || 'btn-secondary'}`;
        cancelButton.onclick = () => {
            if (onCancel) onCancel();
            modal.remove();
        };

        modalFooter.appendChild(cancelButton);
        modalFooter.appendChild(confirmButton);
        modalContent.appendChild(modalHeader);
        modalContent.appendChild(modalBody);
        modalContent.appendChild(modalFooter);
        modal.appendChild(modalContent);
        document.body.appendChild(modal);
    },

    showCallingModal: function (peerName, onCancelCall, onStopMusicOnly, callType) {
        if (!this.callingModal || !this.callingModalTitle || !this.callingModalText || !this.callingModalAvatar || !this.callingModalCancelBtn) {
            Utils.log("Calling modal elements not found!", Utils.logLevels.ERROR);
            return;
        }

        this.callingModalTitle.textContent = `${callType}...`;
        this.callingModalText.textContent = `Contacting ${Utils.escapeHtml(peerName)}...`;

        let avatarContentHtml;
        const peerContact = UserManager.contacts[VideoCallManager.currentPeerId]; // Assumes VideoCallManager.currentPeerId is set

        let fallbackText = (peerContact && peerContact.avatarText) ? Utils.escapeHtml(peerContact.avatarText) :
            (peerName && peerName.length > 0) ? Utils.escapeHtml(peerName.charAt(0).toUpperCase()) : '?';

        this.callingModalAvatar.className = 'video-call-avatar'; // Reset classes
        if (peerContact && peerContact.isSpecial) {
            this.callingModalAvatar.classList.add(peerContact.id);
        }

        if (peerContact && peerContact.avatarUrl) {
            avatarContentHtml = `<img src="${peerContact.avatarUrl}" alt="${fallbackText}" class="avatar-image" data-fallback-text="${fallbackText}" data-entity-id="${peerContact.id}">`;
        } else {
            avatarContentHtml = fallbackText;
        }
        this.callingModalAvatar.innerHTML = avatarContentHtml;
        this.callingModalCancelBtn.onclick = onCancelCall;
        this.callingModal.style.display = 'flex';
    },

    hideCallingModal: function () {
        if (this.callingModal && this.callingModal.style.display !== 'none') {
            this.callingModal.style.display = 'none';
            if (this.callingModalCancelBtn) this.callingModalCancelBtn.onclick = null;
        }
    },

    showCallRequest: function (peerId, audioOnly = false, isScreenShare = false) {
        if (!this.videoCallRequestModal) return;

        const requestTitle = this.videoCallRequestModal.querySelector('h3');
        const requestDesc = this.videoCallRequestModal.querySelector('p');
        const avatarEl = this.videoCallRequestModal.querySelector('.video-call-avatar');
        const acceptBtn = this.videoCallRequestModal.querySelector('.accept-call');
        const rejectBtn = this.videoCallRequestModal.querySelector('.reject-call');


        const peerName = UserManager.contacts[peerId]?.name || `Peer ${peerId.substring(0, 4)}`;
        let avatarContentHtml = (UserManager.contacts[peerId]?.name?.charAt(0).toUpperCase() || 'P');

        const peerContact = UserManager.contacts[peerId];
        if (peerContact && peerContact.avatarUrl) {
            avatarContentHtml = `<img src="${peerContact.avatarUrl}" alt="${Utils.escapeHtml(peerName.charAt(0))}" class="avatar-image">`;
        } else {
            avatarContentHtml = Utils.escapeHtml(avatarContentHtml);
        }
        if (avatarEl) avatarEl.innerHTML = avatarContentHtml;

        let callTypeString = "Video Call";
        if (isScreenShare) callTypeString = "Screen Share";
        else if (audioOnly) callTypeString = "Audio Call";

        if (requestTitle) requestTitle.textContent = `${callTypeString} Request`;
        if (requestDesc) requestDesc.textContent = `${peerName} ${isScreenShare ? 'wants to share screen' : 'is calling'}...`;

        if(acceptBtn) acceptBtn.onclick = () => VideoCallManager.acceptCall();
        if(rejectBtn) rejectBtn.onclick = () => VideoCallManager.rejectCall();

        this.videoCallRequestModal.style.display = 'flex';
    },

    hideCallRequest: function () {
        if (this.videoCallRequestModal) this.videoCallRequestModal.style.display = 'none';
    }
};