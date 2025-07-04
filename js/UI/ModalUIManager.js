
/**
 * @file ModalUIManager.js
 * @description 模态框管理器，负责集中处理应用中所有模态框的显示、隐藏和相关逻辑。
 *              包括设置、新建联系人/群组、通话、确认对话框以及开源信息提示等。
 *              新建群组模态框现在支持通过提供群组ID来修改现有群组名称。
 *              更新：在群组描述中提及人数上限。
 *              MODIFIED: 增加了对角色卡导入/导出标签页的支持。
 *              REFACTORED: 将记忆书(Memory Book Element Set)的管理功能移至此模态框的“要素”标签页下，实现配置的集中化。
 * @module ModalManager
 * @exports {object} ModalUIManager - 对外暴露的单例对象，包含所有模态框管理方法。
 * @property {function} init - 初始化模块，获取 DOM 元素并绑定事件。
 * @property {function} toggleModal - 通用的显示/隐藏模态框的方法。
 * @property {function} showConfirmationModal - 显示一个通用的确认对话框。
 * @property {function} showCallingModal - 显示“呼叫中”的模态框。
 * @property {function} showCallRequest - 显示来电请求的模态框。
 * @property {function} showOpenSourceInfoModal - 显示开源信息提示模态框。
 * @property {function} showAddContactModalWithId - 显示添加联系人模态框并预填用户ID。
 * @dependencies Utils, NotificationUIManager, UserManager, GroupManager, AppInitializer, VideoCallManager, AppSettings, CharacterCardManager, MemoryBookManager
 * @dependents AppInitializer (进行初始化), 各个模块在需要显示模态框时调用。
 */
const ModalUIManager = {
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

    // REFACTORED: Memory Set Management elements
    memorySetListContainerModal: null,
    memorySetFormContainerModal: null,
    showAddMemorySetFormBtn: null,
    _editingMemorySetId: null,


    /**
     * 初始化模态框管理器，获取所有模态框的 DOM 引用并绑定其内部的通用事件。
     */
    init: function() {
        // --- 开源信息模态框 ---
        this.openSourceInfoModal = document.getElementById('openSourceInfoModal');
        this.closeOpenSourceInfoModalBtn = document.getElementById('closeOpenSourceInfoModalBtn');
        this.permanentlyCloseOpenSourceInfoModalBtn = document.getElementById('permanentlyCloseOpenSourceInfoModalBtn');
        this.openSourceModalTimerSpan = document.getElementById('openSourceModalTimer');
        this._bindOpenSourceInfoModalEvents(); // 绑定此模态框的特定事件

        // --- 主菜单/设置模态框 ---
        this.mainMenuModal = document.getElementById('mainMenuModal');
        if (this.mainMenuModal) {
            // ... (rest of main menu modal logic is unchanged)
            const closeMainMenuBtn = this.mainMenuModal.querySelector('.close-modal-btn[data-modal-id="mainMenuModal"]');
            if (closeMainMenuBtn) {
                closeMainMenuBtn.addEventListener('click', () => this.toggleModal('mainMenuModal', false));
            }
            this.mainMenuModal.addEventListener('click', (event) => {
                if (event.target === this.mainMenuModal) {
                    this.toggleModal('mainMenuModal', false);
                }
            });
        }

        const mainMenuBtn = document.getElementById('mainMenuBtn');
        if (mainMenuBtn) {
            mainMenuBtn.addEventListener('click', () => {
                this.toggleModal('mainMenuModal', true);
                if (typeof AppInitializer !== 'undefined' && AppInitializer.refreshNetworkStatusUI) {
                    AppInitializer.refreshNetworkStatusUI();
                }
                if (typeof SettingsUIManager !== 'undefined') {
                    SettingsUIManager.updateMainMenuControlsState();
                }
            });
        }


        // --- 新建联系人/群组/角色/要素 模态框 ---
        this.newContactGroupModal = document.getElementById('newContactGroupModal');
        if (this.newContactGroupModal) {
            // ... (closing logic is unchanged) ...
            const closeNewContactGroupModalBtn = this.newContactGroupModal.querySelector('.close-modal-btn[data-modal-id="newContactGroupModal"]');
            if (closeNewContactGroupModalBtn) {
                closeNewContactGroupModalBtn.addEventListener('click', () => this.toggleModal('newContactGroupModal', false));
            }
            this.newContactGroupModal.addEventListener('click', (event) => {
                if (event.target === this.newContactGroupModal) {
                    this.toggleModal('newContactGroupModal', false);
                }
            });

            // ... (tab switching logic is unchanged) ...
            const contactGroupTabs = this.newContactGroupModal.querySelectorAll('.menu-tab-item');
            contactGroupTabs.forEach(tab => {
                tab.addEventListener('click', (event) => {
                    event.preventDefault();
                    const targetSelector = tab.dataset.tabTarget;
                    const targetContent = this.newContactGroupModal.querySelector(targetSelector);
                    if (!targetContent) return;
                    this.newContactGroupModal.querySelectorAll('.menu-tab-item').forEach(t => t.classList.remove('active'));
                    this.newContactGroupModal.querySelectorAll('.menu-tab-content').forEach(c => c.classList.remove('active'));
                    tab.classList.add('active');
                    targetContent.classList.add('active');
                });
            });
        }

        // 新建聊天悬浮按钮
        const newChatFab = document.getElementById('newChatFab');
        if (newChatFab) newChatFab.addEventListener('click', () => this.toggleModal('newContactGroupModal', true));

        // ... (confirm new contact/group buttons logic is unchanged) ...
        const confirmNewContactBtn = document.getElementById('confirmNewContactBtn');
        if (confirmNewContactBtn) confirmNewContactBtn.addEventListener('click', () => {
            const peerIdInput = document.getElementById('newPeerIdInput');
            const peerNameInput = document.getElementById('newPeerNameInput');
            const peerId = peerIdInput.value.trim();
            const peerName = peerNameInput.value.trim();
            if (!peerId) {
                NotificationUIManager.showNotification('对方 ID 是必填项。', 'warning');
                return;
            }
            UserManager.addContact(peerId, peerName || `用户 ${peerId.substring(0, 4)}`).then(success => {
                if (success) {
                    peerIdInput.value = '';
                    peerNameInput.value = '';
                    this.toggleModal('newContactGroupModal', false);
                }
            });
        });
        const confirmNewGroupBtnModal = document.getElementById('confirmNewGroupBtnModal');
        if (confirmNewGroupBtnModal) {
            confirmNewGroupBtnModal.addEventListener('click', () => {
                const groupNameInput = document.getElementById('newGroupNameInput');
                const groupIdInput = document.getElementById('newGroupIdInput');
                const groupName = groupNameInput.value.trim();
                const customGroupId = groupIdInput.value.trim();
                if (!groupName) {
                    NotificationUIManager.showNotification('群组名称是必填项。', 'warning');
                    return;
                }
                GroupManager.createGroup(groupName, customGroupId).then(createdGroupId => {
                    if (createdGroupId) {
                        groupNameInput.value = '';
                        groupIdInput.value = '';
                        this.toggleModal('newContactGroupModal', false);
                    }
                });
            });
        }

        // REFACTORED: Memory Set management initialization
        this.memorySetListContainerModal = document.getElementById('memorySetListContainerModal');
        this.memorySetFormContainerModal = document.getElementById('memorySetFormContainerModal');
        this.showAddMemorySetFormBtn = document.getElementById('showAddMemorySetFormBtn');
        if (this.showAddMemorySetFormBtn) {
            this.showAddMemorySetFormBtn.addEventListener('click', () => this._showMemorySetForm());
        }
        if (typeof EventEmitter !== 'undefined') {
            EventEmitter.on('memorySetsUpdated', () => {
                if (this.newContactGroupModal && this.newContactGroupModal.style.display !== 'none') {
                    this._renderMemorySetList();
                }
            });
        }

        // --- 通话相关模态框 ---
        this.callingModal = document.getElementById('callingModal');
        this.callingModalTitle = document.getElementById('callingModalTitle');
        this.callingModalText = document.getElementById('callingModalText');
        this.callingModalAvatar = document.getElementById('callingModalAvatar');
        this.callingModalCancelBtn = document.getElementById('callingModalCancelBtn');
        this.videoCallRequestModal = document.getElementById('videoCallRequest');
    },

    /**
     * @private
     * 绑定开源信息模态框的内部事件。
     */
    _bindOpenSourceInfoModalEvents: function () {
        if (this.closeOpenSourceInfoModalBtn) { // 关闭按钮
            this.closeOpenSourceInfoModalBtn.addEventListener('click', () => this.hideOpenSourceInfoModal());
        }
        if (this.permanentlyCloseOpenSourceInfoModalBtn) { // “不再显示”按钮
            this.permanentlyCloseOpenSourceInfoModalBtn.addEventListener('click', () => {
                localStorage.setItem('hideOpenSourceModalPermanently', 'true'); // 存储偏好
                this.hideOpenSourceInfoModal();
            });
        }
        if (this.openSourceInfoModal) { // 点击外部关闭
            this.openSourceInfoModal.addEventListener('click', (event) => {
                if (event.target === this.openSourceInfoModal) {
                    this.hideOpenSourceInfoModal();
                }
            });
        }
    },

    /**
     * 显示开源信息提示模态框，并启动自动关闭倒计时。
     * 如果用户已选择“不再显示”，则不执行任何操作。
     */
    showOpenSourceInfoModal: function () {
        if (localStorage.getItem('hideOpenSourceModalPermanently') === 'true') { // 检查用户偏好
            return;
        }
        if (this.openSourceInfoModal && this.openSourceModalTimerSpan) {
            this.openSourceInfoModal.style.display = 'flex'; // 显示模态框
            let countdown = 8; // 倒计时8秒
            this.openSourceModalTimerSpan.textContent = countdown; // 更新倒计时显示

            // 清理可能存在的旧定时器
            if (this.openSourceModalAutoCloseTimer) clearTimeout(this.openSourceModalAutoCloseTimer);
            if (this.openSourceModalCountdownInterval) clearInterval(this.openSourceModalCountdownInterval);

            // 启动倒计时更新
            this.openSourceModalCountdownInterval = setInterval(() => {
                countdown--;
                this.openSourceModalTimerSpan.textContent = countdown;
                if (countdown <= 0) {
                    clearInterval(this.openSourceModalCountdownInterval); // 清除间隔
                }
            }, 1000);

            // 启动自动关闭定时器
            this.openSourceModalAutoCloseTimer = setTimeout(() => {
                this.hideOpenSourceInfoModal();
            }, 8000);
        } else {
            Utils.log("开源信息模态框元素未找到或未初始化。", Utils.logLevels.WARN);
        }
    },

    /**
     * 隐藏开源信息模态框，并清除相关的定时器。
     */
    hideOpenSourceInfoModal: function () {
        if (this.openSourceInfoModal) {
            this.openSourceInfoModal.style.display = 'none'; // 隐藏模态框
        }
        // 清除定时器
        if (this.openSourceModalAutoCloseTimer) clearTimeout(this.openSourceModalAutoCloseTimer);
        if (this.openSourceModalCountdownInterval) clearInterval(this.openSourceModalCountdownInterval);
        this.openSourceModalAutoCloseTimer = null;
        this.openSourceModalCountdownInterval = null;
    },

    /**
     * 通用的显示或隐藏模态框的方法。
     * @param {string} modalId - 目标模态框的 DOM ID。
     * @param {boolean} show - true 为显示，false 为隐藏。
     * @param {boolean} [immediate=false] - 如果为true，则立即隐藏，不播放动画。
     */
    toggleModal: function (modalId, show, immediate = false) {
        const modal = document.getElementById(modalId);
        if (modal) {
            if (show) {
                this._showModalWithAnimation(modal);
                if (modalId === 'newContactGroupModal') {
                    this._renderMemorySetList();
                    this._hideMemorySetForm();
                }
            } else {
                this._hideModalWithAnimation(modal, immediate);
            }
        } else {
            Utils.log(`未找到 ID 为 '${modalId}' 的模态框。`, Utils.logLevels.WARN);
        }
    },
    _showModalWithAnimation: function(modalEl) {
        if (!modalEl || modalEl.classList.contains('show')) return;
        modalEl.style.display = 'flex';
        setTimeout(() => {
            modalEl.classList.add('show');
        }, 10);
    },
    /**
     * @private
     * 以动画形式隐藏一个模态框元素。
     * @param {HTMLElement} modalEl - 要隐藏的模态框元素。
     * @param {boolean} [immediate=false] - 如果为true，则立即隐藏，不播放动画。
     */
    _hideModalWithAnimation: function(modalEl, immediate = false) {
        if (!modalEl) return;

        // 如果是立即隐藏模式
        if (immediate) {
            modalEl.classList.remove('show');
            modalEl.style.display = 'none';
            return;
        }

        // 动画隐藏模式
        if (!modalEl.classList.contains('show')) return;

        modalEl.classList.remove('show');
        modalEl.addEventListener('transitionend', function handler() {
            if (!modalEl.classList.contains('show')) {
                modalEl.style.display = 'none';
            }
        }, { once: true });
    },
    /**
     * 动态创建一个通用的确认对话框。
     * @param {string} message - 对话框中显示的消息文本。
     * @param {function} onConfirm - 用户点击确认按钮时执行的回调函数。
     * @param {function|null} [onCancel=null] - 用户点击取消按钮时执行的回调函数。
     * @param {object} [options={}] - 对话框的自定义选项。
     * @param {string} [options.title='确认操作'] - 对话框标题。
     * @param {string} [options.confirmText='确认'] - 确认按钮的文本。
     * @param {string} [options.cancelText='取消'] - 取消按钮的文本。
     * @param {string} [options.confirmClass='btn-danger'] - 确认按钮的 CSS 类。
     * @param {string} [options.cancelClass='btn-secondary'] - 取消按钮的 CSS 类。
     */
    showConfirmationModal: function (message, onConfirm, onCancel = null, options = {}) {
        // ... (this method is unchanged) ...
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
        confirmButton.addEventListener('click', () => {
            if (onConfirm) onConfirm();
            modal.remove();
        });
        const cancelButton = document.createElement('button');
        cancelButton.textContent = options.cancelText || '取消';
        cancelButton.className = `btn ${options.cancelClass || 'btn-secondary'}`;
        cancelButton.addEventListener('click', () => {
            if (onCancel) onCancel();
            modal.remove();
        });
        modalFooter.appendChild(cancelButton);
        modalFooter.appendChild(confirmButton);
        modalContent.appendChild(modalHeader);
        modalContent.appendChild(modalBody);
        modalContent.appendChild(modalFooter);
        modal.appendChild(modalContent);
        modal.addEventListener('click', (event) => {
            if (event.target === modal) {
                if (onCancel) onCancel();
                modal.remove();
            }
        });
        document.body.appendChild(modal);
    },

    /**
     * @private
     * Renders the list of memory element sets in the modal.
     */
    _renderMemorySetList: function() {
        if (!this.memorySetListContainerModal) return;
        this.memorySetListContainerModal.innerHTML = '';
        const sets = MemoryBookManager.getElementSets();
        const fragment = document.createDocumentFragment();
        const template = document.getElementById('memory-set-list-item-modal-template').content;

        if (sets.length === 0) {
            this.memorySetListContainerModal.innerHTML = `<p class="text-center text-muted">还没有记忆书。点击下方按钮添加一个吧！</p>`;
            return;
        }

        sets.forEach(set => {
            const itemClone = template.cloneNode(true);
            const nameEl = itemClone.querySelector('.memory-set-name-modal');
            const editBtn = itemClone.querySelector('.edit-btn');
            const deleteBtn = itemClone.querySelector('.delete-btn');

            nameEl.textContent = Utils.escapeHtml(set.name);

            editBtn.addEventListener('click', () => this._showMemorySetForm(set));
            deleteBtn.addEventListener('click', () => {
                this.showConfirmationModal(
                    `确定要删除记忆书 "${Utils.escapeHtml(set.name)}" 吗？这将删除所有已记录的记忆，且无法撤销。`,
                    () => MemoryBookManager.deleteElementSet(set.id)
                );
            });

            fragment.appendChild(itemClone.firstElementChild);
        });

        this.memorySetListContainerModal.appendChild(fragment);
    },

    /**
     * @private
     * Shows the form for adding or editing a memory set.
     * @param {object|null} set - The set data to edit, or null to add a new one.
     */
    _showMemorySetForm: function(set = null) {
        if (!this.memorySetFormContainerModal || !this.showAddMemorySetFormBtn) return;

        this._editingMemorySetId = set ? set.id : null;

        const template = document.getElementById('memory-set-form-template').content.cloneNode(true);
        const formEl = template.querySelector('.memory-set-form-inner');
        const titleEl = formEl.querySelector('.form-title');
        const nameInput = formEl.querySelector('.memory-set-name-input');
        const elementsInput = formEl.querySelector('.memory-set-elements-input');
        const saveBtn = formEl.querySelector('.save-btn');
        const cancelBtn = formEl.querySelector('.cancel-btn');

        titleEl.textContent = set ? '编辑记忆书' : '添加记忆书';
        saveBtn.textContent = set ? '保存修改' : '确认添加';
        nameInput.value = set ? Utils.escapeHtml(set.name) : '';
        elementsInput.value = set ? Utils.escapeHtml(set.elements.join(', ')) : '';

        saveBtn.addEventListener('click', async () => {
            const name = nameInput.value.trim();
            const elements = elementsInput.value.split(/[,，、\s]+/).map(e => e.trim()).filter(Boolean);
            let success;
            if (this._editingMemorySetId) {
                success = await MemoryBookManager.updateElementSet(this._editingMemorySetId, name, elements);
            } else {
                success = await MemoryBookManager.addElementSet(name, elements);
            }
            if (success) {
                this._hideMemorySetForm();
            }
        });

        cancelBtn.addEventListener('click', () => this._hideMemorySetForm());

        this.memorySetFormContainerModal.innerHTML = '';
        this.memorySetFormContainerModal.appendChild(formEl);
        this.memorySetFormContainerModal.style.display = 'block';
        this.showAddMemorySetFormBtn.style.display = 'none';
        nameInput.focus();
    },

    /**
     * @private
     * Hides the memory set form and resets its state.
     */
    _hideMemorySetForm: function() {
        if (!this.memorySetFormContainerModal || !this.showAddMemorySetFormBtn) return;
        this.memorySetFormContainerModal.style.display = 'none';
        this.memorySetFormContainerModal.innerHTML = '';
        this.showAddMemorySetFormBtn.style.display = 'block';
        this._editingMemorySetId = null;
    },


    // ... The rest of the methods (showCallingModal, hideCallingModal, etc.) are unchanged ...
    showCallingModal: function (peerName, onCancelCall, onStopMusicOnly, callType) {
        if (!this.callingModal || !this.callingModalTitle || !this.callingModalText || !this.callingModalAvatar || !this.callingModalCancelBtn) {
            Utils.log("呼叫中模态框元素未找到！", Utils.logLevels.ERROR);
            return;
        }

        this.callingModalTitle.textContent = `${callType}...`; // 设置标题
        this.callingModalText.textContent = `正在联系 ${Utils.escapeHtml(peerName)}...`; // 设置文本

        // 设置头像
        let avatarContentHtml;
        const peerContact = UserManager.contacts[VideoCallManager.currentPeerId]; // 获取对方联系人信息
        let fallbackText = (peerContact && peerContact.avatarText) ? Utils.escapeHtml(peerContact.avatarText) :
            (peerName && peerName.length > 0) ? Utils.escapeHtml(peerName.charAt(0).toUpperCase()) : '?';

        this.callingModalAvatar.className = 'video-call-avatar'; // 重置头像类名
        if (peerContact && peerContact.isSpecial) { // 如果是特殊联系人，添加特定类
            this.callingModalAvatar.classList.add(peerContact.id);
        }

        if (peerContact && peerContact.avatarUrl) { // 如果有头像URL
            avatarContentHtml = `<img src="${peerContact.avatarUrl}" alt="${fallbackText}" class="avatar-image" data-fallback-text="${fallbackText}" data-entity-id="${peerContact.id}">`;
        } else { // 否则使用文本头像
            avatarContentHtml = fallbackText;
        }
        this.callingModalAvatar.innerHTML = avatarContentHtml;

        // 确保取消按钮的事件监听器被正确替换，避免重复绑定
        const newCancelBtn = this.callingModalCancelBtn.cloneNode(true); // 克隆按钮
        this.callingModalCancelBtn.parentNode.replaceChild(newCancelBtn, this.callingModalCancelBtn); // 替换旧按钮
        this.callingModalCancelBtn = newCancelBtn; // 更新引用
        this.callingModalCancelBtn.addEventListener('click', onCancelCall); // 绑定新的取消回调

        this.callingModal.style.display = 'flex'; // 显示模态框
    },

    hideCallingModal: function () {
        if (this.callingModal && this.callingModal.style.display !== 'none') {
            this.callingModal.style.display = 'none';
        }
    },

    showCallRequest: function (peerId, audioOnly = false, isScreenShare = false) {
        if (!this.videoCallRequestModal) return;

        const requestTitle = this.videoCallRequestModal.querySelector('h3');
        const requestDesc = this.videoCallRequestModal.querySelector('p');
        const avatarEl = this.videoCallRequestModal.querySelector('.video-call-avatar');
        let acceptBtn = this.videoCallRequestModal.querySelector('.accept-call');
        let rejectBtn = this.videoCallRequestModal.querySelector('.reject-call');

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

        if(acceptBtn) {
            const newAcceptBtn = acceptBtn.cloneNode(true);
            acceptBtn.parentNode.replaceChild(newAcceptBtn, acceptBtn);
            acceptBtn = newAcceptBtn;
            acceptBtn.addEventListener('click', () => VideoCallHandler.acceptCall());
        }
        if(rejectBtn) {
            const newRejectBtn = rejectBtn.cloneNode(true);
            rejectBtn.parentNode.replaceChild(newRejectBtn, rejectBtn);
            rejectBtn = newRejectBtn;
            rejectBtn.addEventListener('click', () => VideoCallHandler.rejectCall());
        }

        this.videoCallRequestModal.style.display = 'flex';
    },

    hideCallRequest: function () {
        if (this.videoCallRequestModal) this.videoCallRequestModal.style.display = 'none';
    },

    showAddContactModalWithId: function(userId) {
        this.toggleModal('newContactGroupModal', true);
        const peerIdInput = document.getElementById('newPeerIdInput');
        const peerNameInput = document.getElementById('newPeerNameInput');
        if (peerIdInput) {
            peerIdInput.value = userId;
        }
        if (peerNameInput) {
            peerNameInput.value = '';
            peerNameInput.focus();
        }
    }
};