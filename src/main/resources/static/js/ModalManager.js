// 新文件: ModalManager.js (已翻译)
// 职责:
// - 管理所有模态框的显示状态。
// - 处理通用的确认对话框。
// - 管理与通话相关的模态框 UI（请求、呼叫中）。
// - 管理开源信息模态框。
const ModalManager = {
    // 开源信息模态框元素
    openSourceInfoModal: null,
    closeOpenSourceInfoModalBtn: null,
    permanentlyCloseOpenSourceInfoModalBtn: null,
    openSourceModalTimerSpan: null,
    openSourceModalAutoCloseTimer: null,
    openSourceModalCountdownInterval: null,

    // 其他模态框元素
    mainMenuModal: null,
    newContactGroupModal: null,
    callingModal: null,
    callingModalTitle: null,
    callingModalText: null,
    callingModalAvatar: null,
    callingModalCancelBtn: null,
    videoCallRequestModal: null,

    init: function() {
        // 开源信息模态框
        this.openSourceInfoModal = document.getElementById('openSourceInfoModal');
        this.closeOpenSourceInfoModalBtn = document.getElementById('closeOpenSourceInfoModalBtn');
        this.permanentlyCloseOpenSourceInfoModalBtn = document.getElementById('permanentlyCloseOpenSourceInfoModalBtn');
        this.openSourceModalTimerSpan = document.getElementById('openSourceModalTimer');
        this._bindOpenSourceInfoModalEvents();

        // 主菜单模态框
        this.mainMenuModal = document.getElementById('mainMenuModal');
        const closeMainMenuBtn = document.querySelector('.close-modal-btn[data-modal-id="mainMenuModal"]');
        if (closeMainMenuBtn) closeMainMenuBtn.addEventListener('click', () => this.toggleModal('mainMenuModal', false));
        document.getElementById('mainMenuBtn').addEventListener('click', () => {
            this.toggleModal('mainMenuModal', true);
            // 打开主菜单时刷新网络状态
            if (typeof AppInitializer !== 'undefined' && AppInitializer.refreshNetworkStatusUI) { // 检查 AppInitializer 是否已定义
                AppInitializer.refreshNetworkStatusUI();
            }
            // 如果 SettingsUIManager 可用，则更新设置 UI 元素
            if (typeof SettingsUIManager !== 'undefined') {
                SettingsUIManager.updateMainMenuControlsState();
            }
        });


        // 新建聊天/群组模态框
        this.newContactGroupModal = document.getElementById('newContactGroupModal');
        const closeNewContactGroupModalBtn = document.querySelector('.close-modal-btn[data-modal-id="newContactGroupModal"]');
        if (closeNewContactGroupModalBtn) closeNewContactGroupModalBtn.addEventListener('click', () => this.toggleModal('newContactGroupModal', false));

        const newChatFab = document.getElementById('newChatFab');
        if (newChatFab) newChatFab.addEventListener('click', () => this.toggleModal('newContactGroupModal', true));

        const confirmNewContactBtn = document.getElementById('confirmNewContactBtn');
        if (confirmNewContactBtn) confirmNewContactBtn.addEventListener('click', () => {
            // 此逻辑原在 UIManager.handleAddNewContact
            const peerId = document.getElementById('newPeerIdInput').value.trim();
            const peerName = document.getElementById('newPeerNameInput').value.trim();
            if (!peerId) {
                NotificationManager.showNotification('对方 ID 是必填项。', 'warning');
                return;
            }
            UserManager.addContact(peerId, peerName || `用户 ${peerId.substring(0, 4)}`);
            document.getElementById('newPeerIdInput').value = '';
            document.getElementById('newPeerNameInput').value = '';
            this.toggleModal('newContactGroupModal', false);
        });

        const confirmNewGroupBtnModal = document.getElementById('confirmNewGroupBtnModal');
        if (confirmNewGroupBtnModal) confirmNewGroupBtnModal.addEventListener('click', () => {
            // 此逻辑原在 UIManager.handleCreateNewGroup
            const groupName = document.getElementById('newGroupNameInput').value.trim();
            if (!groupName) {
                NotificationManager.showNotification('群组名称是必填项。', 'warning');
                return;
            }
            GroupManager.createGroup(groupName);
            document.getElementById('newGroupNameInput').value = '';
            this.toggleModal('newContactGroupModal', false);
        });


        // 呼叫中模态框元素
        this.callingModal = document.getElementById('callingModal');
        this.callingModalTitle = document.getElementById('callingModalTitle');
        this.callingModalText = document.getElementById('callingModalText');
        this.callingModalAvatar = document.getElementById('callingModalAvatar');
        this.callingModalCancelBtn = document.getElementById('callingModalCancelBtn');

        // 通话请求模态框元素
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
            let countdown = 8;
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
            }, 8000);
        } else {
            Utils.log("开源信息模态框元素未找到或未初始化。", Utils.logLevels.WARN);
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
        const modal = document.getElementById(modalId); // 动态获取，因为它们可能不都是属性
        if (modal) {
            modal.style.display = show ? 'flex' : 'none';
        } else {
            Utils.log(`未找到 ID 为 '${modalId}' 的模态框。`, Utils.logLevels.WARN);
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
        titleElement.textContent = options.title || '确认操作';
        modalHeader.appendChild(titleElement);

        const modalBody = document.createElement('div');
        modalBody.className = 'modal-body';
        const messageParagraph = document.createElement('p');
        messageParagraph.innerHTML = Utils.escapeHtml(message).replace(/\n/g, '<br>');
        modalBody.appendChild(messageParagraph);

        const modalFooter = document.createElement('div');
        modalFooter.className = 'modal-footer';

        const confirmButton = document.createElement('button');
        confirmButton.textContent = options.confirmText || '确认';
        confirmButton.className = `btn ${options.confirmClass || 'btn-danger'}`;
        confirmButton.onclick = () => {
            if (onConfirm) onConfirm();
            modal.remove();
        };

        const cancelButton = document.createElement('button');
        cancelButton.textContent = options.cancelText || '取消';
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
            Utils.log("呼叫中模态框元素未找到！", Utils.logLevels.ERROR);
            return;
        }

        this.callingModalTitle.textContent = `${callType}...`;
        this.callingModalText.textContent = `正在联系 ${Utils.escapeHtml(peerName)}...`;

        let avatarContentHtml;
        const peerContact = UserManager.contacts[VideoCallManager.currentPeerId]; // 假设 VideoCallManager.currentPeerId 已设置

        let fallbackText = (peerContact && peerContact.avatarText) ? Utils.escapeHtml(peerContact.avatarText) :
            (peerName && peerName.length > 0) ? Utils.escapeHtml(peerName.charAt(0).toUpperCase()) : '?';

        this.callingModalAvatar.className = 'video-call-avatar'; // 重置类名
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


        const peerName = UserManager.contacts[peerId]?.name || `用户 ${peerId.substring(0, 4)}`;
        let avatarContentHtml = (UserManager.contacts[peerId]?.name?.charAt(0).toUpperCase() || 'P');

        const peerContact = UserManager.contacts[peerId];
        if (peerContact && peerContact.avatarUrl) {
            avatarContentHtml = `<img src="${peerContact.avatarUrl}" alt="${Utils.escapeHtml(peerName.charAt(0))}" class="avatar-image">`;
        } else {
            avatarContentHtml = Utils.escapeHtml(avatarContentHtml);
        }
        if (avatarEl) avatarEl.innerHTML = avatarContentHtml;

        let callTypeString = "视频通话";
        if (isScreenShare) callTypeString = "屏幕共享";
        else if (audioOnly) callTypeString = "语音通话";

        if (requestTitle) requestTitle.textContent = `${callTypeString}请求`;
        if (requestDesc) requestDesc.textContent = `${peerName} ${isScreenShare ? '想要共享屏幕' : '正在呼叫'}...`;

        if(acceptBtn) acceptBtn.onclick = () => VideoCallManager.acceptCall();
        if(rejectBtn) rejectBtn.onclick = () => VideoCallManager.rejectCall();

        this.videoCallRequestModal.style.display = 'flex';
    },

    hideCallRequest: function () {
        if (this.videoCallRequestModal) this.videoCallRequestModal.style.display = 'none';
    }
};