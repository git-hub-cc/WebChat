/**
 * @file ModalUIManager.js
 * @description 模态框管理器，负责集中处理应用中所有模态框的显示、隐藏和相关逻辑。
 *              包括设置、新建联系人/群组、通话、确认对话框以及开源信息提示等。
 *              新建群组模态框现在支持通过提供群组ID来修改现有群组名称。
 *              更新：在群组描述中提及人数上限。
 *              MODIFIED: 增加了对角色卡导入/导出标签页的支持。
 *              REFACTORED: 将记忆书(Memory Book Element Set)的管理功能移至此模态框的“要素”标签页下，实现配置的集中化。
 *              REFACTORED: (第2阶段) 此模块已审查，其逻辑大多是独立的或通过数据层间接驱动UI，符合解耦原则，无需大改。
 *                          主要修改是将按钮点击事件转换为分发 Action。
 *              REFACTORED (Phase 1): 事件监听器现在调用 ActionCreators.js 中的函数，而不是直接 dispatch action。
 *              BUGFIX: 将设置模态框内的操作按钮（如清空缓存、手动连接）的事件绑定逻辑从此文件的 init 方法中集中处理，以修复按钮无法点击的问题。
 *              BUGFIX: 修复了 showConfirmationModal 函数未设置模态框 display 样式导致其无法显示的问题。
 * @module ModalManager
 * @exports {object} ModalUIManager - 对外暴露的单例对象，包含所有模态框管理方法。
 * @property {function} init - 初始化模块，获取 DOM 元素并绑定事件。
 * @property {function} toggleModal - 通用的显示/隐藏模态框的方法。
 * @property {function} showConfirmationModal - 显示一个通用的确认对话框。
 * @property {function} showCallingModal - 显示“呼叫中”的模态框。
 * @property {function} showCallRequest - 显示来电请求的模态框。
 * @property {function} showOpenSourceInfoModal - 显示开源信息提示模态框。
 * @property {function} showAddContactModalWithId - 显示添加联系人模态框并预填用户ID。
 * @dependencies Utils, NotificationUIManager, UserManager, GroupManager, AppInitializer, VideoCallManager, AppSettings, CharacterCardManager, MemoryBookManager, Store, ActionCreators
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

    // REFACTORED: 记忆书管理元素
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
                if (typeof SettingsUIManager !== 'undefined') {
                    SettingsUIManager.updateMainMenuControlsState();
                }
            });
        }

        // --- BUGFIX: 将设置模态框内的操作按钮绑定逻辑集中到此处 ---
        this.bindMainMenuActionButtons();

        // --- 新建联系人/群组/角色/要素 模态框 ---
        this.newContactGroupModal = document.getElementById('newContactGroupModal');
        if (this.newContactGroupModal) {
            const closeNewContactGroupModalBtn = this.newContactGroupModal.querySelector('.close-modal-btn[data-modal-id="newContactGroupModal"]');
            if (closeNewContactGroupModalBtn) {
                closeNewContactGroupModalBtn.addEventListener('click', () => this.toggleModal('newContactGroupModal', false));
            }
            this.newContactGroupModal.addEventListener('click', (event) => {
                if (event.target === this.newContactGroupModal) {
                    this.toggleModal('newContactGroupModal', false);
                }
            });

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

        const newChatFab = document.getElementById('newChatFab');
        if (newChatFab) newChatFab.addEventListener('click', () => this.toggleModal('newContactGroupModal', true));

        // REFACTORED (Phase 1): 调用 ActionCreator
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
            ActionCreators.addContactRequest({ peerId, name: peerName || `用户 ${peerId.substring(0, 4)}` });
            peerIdInput.value = '';
            peerNameInput.value = '';
        });

        // REFACTORED (Phase 1): 调用 ActionCreator
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
                ActionCreators.createGroupRequest({ name: groupName, groupId: customGroupId });
                groupNameInput.value = '';
                groupIdInput.value = '';
            });
        }

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

        this.callingModal = document.getElementById('callingModal');
        this.callingModalTitle = document.getElementById('callingModalTitle');
        this.callingModalText = document.getElementById('callingModalText');
        this.callingModalAvatar = document.getElementById('callingModalAvatar');
        this.callingModalCancelBtn = document.getElementById('callingModalCancelBtn');
        this.videoCallRequestModal = document.getElementById('videoCallRequest');
    },

    /**
     * @private
     * BUGFIX: 新增函数，用于集中绑定“菜单”模态框中的所有操作按钮事件。
     */
    bindMainMenuActionButtons: function() {
        const modalCopyIdBtn = document.getElementById('modalCopyIdBtn');
        if(modalCopyIdBtn) {
            modalCopyIdBtn.addEventListener('click', () => {
                if (modalCopyIdBtn.disabled) return;
                // SettingsUIManager.copyUserIdFromModal() 仍然是正确的，因为它依赖于 SettingsUIManager 的属性
                if (typeof SettingsUIManager !== 'undefined' && SettingsUIManager.copyUserIdFromModal) {
                    SettingsUIManager.copyUserIdFromModal();
                }
            });
        }

        const checkNetworkBtnModal = document.getElementById('checkNetworkBtnModal');
        if(checkNetworkBtnModal) {
            checkNetworkBtnModal.addEventListener('click', async () => {
                if (checkNetworkBtnModal.disabled) {
                    NotificationUIManager.showNotification('当前已连接到信令服务器。', 'info');
                    return;
                }
                NotificationUIManager.showNotification('正在重新检查网络并尝试连接...', 'info');
                if (typeof AppInitializer !== 'undefined' && AppInitializer.refreshNetworkStatusUI) {
                    await AppInitializer.refreshNetworkStatusUI();
                }
                if (typeof ConnectionManager !== 'undefined' && typeof WebSocketManager !== 'undefined' && !ConnectionManager.isWebSocketConnected) {
                    WebSocketManager.connect().catch(err => {
                        NotificationUIManager.showNotification('重新建立信令连接失败。', 'error');
                        Utils.log(`手动重新检查网络: connectWebSocket 失败: ${err.message || err}`, Utils.logLevels.ERROR);
                    });
                }
            });
        }

        const modalCopySdpBtn = document.getElementById('modalCopySdpBtn');
        if(modalCopySdpBtn) modalCopySdpBtn.addEventListener('click', () => {
            if (typeof SettingsUIManager !== 'undefined' && SettingsUIManager.copySdpTextFromModal) {
                SettingsUIManager.copySdpTextFromModal();
            }
        });

        const modalCreateOfferBtn = document.getElementById('modalCreateOfferBtn');
        if(modalCreateOfferBtn) modalCreateOfferBtn.addEventListener('click', () => ConnectionManager.createOffer(null, {isManual: true}));

        const modalCreateAnswerBtn = document.getElementById('modalCreateAnswerBtn');
        if(modalCreateAnswerBtn) modalCreateAnswerBtn.addEventListener('click', () => ConnectionManager.createAnswer({isManual: true}));

        const modalHandleAnswerBtn = document.getElementById('modalHandleAnswerBtn');
        if(modalHandleAnswerBtn) modalHandleAnswerBtn.addEventListener('click', () => ConnectionManager.handleAnswer({isManual: true}));

        const modalClearContactsBtn = document.getElementById('modalClearContactsBtn');
        if (modalClearContactsBtn) modalClearContactsBtn.addEventListener('click', () => UserManager.clearAllContacts());

        const modalClearAllChatsBtn = document.getElementById('modalClearAllChatsBtn');
        if (modalClearAllChatsBtn) modalClearAllChatsBtn.addEventListener('click', () => ActionCreators.clearAllChatsRequest());

        const modalClearCacheBtn = document.getElementById('modalClearCacheBtn');
        if (modalClearCacheBtn) {
            modalClearCacheBtn.addEventListener('click', () => {
                ModalUIManager.showConfirmationModal(
                    '您确定要清除所有本地缓存吗？这将删除所有 localStorage 数据和 IndexedDB 数据库中的所有内容。操作完成后，页面将自动刷新。',
                    async () => {
                        try {
                            localStorage.clear();
                            Utils.log('LocalStorage 已清除。', Utils.logLevels.INFO);
                            await DBManager.clearAllData();
                            NotificationUIManager.showNotification('所有缓存已成功清除。页面即将刷新...', 'success');
                            setTimeout(() => window.location.reload(), 2000);
                        } catch (error) {
                            Utils.log(`清除缓存失败: ${error}`, Utils.logLevels.ERROR);
                            NotificationUIManager.showNotification('清除缓存时发生错误。请查看控制台。', 'error');
                        }
                    },
                    null,
                    { title: '警告：清除缓存', confirmText: '确定清除', cancelText: '取消' }
                );
            })
        }
    },


    // ... (从这里到文件结尾的所有其他方法，除了 clearAllChats, 均保持不变。它们不直接 dispatch action，因此在阶段一无需修改)
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
        if (this.openSourceInfoModal) {
            this.openSourceInfoModal.addEventListener('click', (event) => {
                if (event.target === this.openSourceInfoModal) {
                    this.hideOpenSourceInfoModal();
                }
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
        const modal = document.getElementById(modalId);
        if (modal) {
            modal.style.display = show ? 'flex' : 'none';
            if (show && modalId === 'newContactGroupModal') {
                this._renderMemorySetList();
                this._hideMemorySetForm();
            }
        } else {
            Utils.log(`未找到 ID 为 '${modalId}' 的模态框。`, Utils.logLevels.WARN);
        }
    },
    showConfirmationModal: function (message, onConfirm, onCancel = null, options = {}) {
        const existingModal = document.getElementById('genericConfirmationModal');
        if (existingModal) {
            existingModal.remove();
        }

        const template = document.getElementById('confirmation-modal-template');
        if (!template) {
            Utils.log("ModalUIManager: confirmation-modal-template 未找到。", Utils.logLevels.ERROR);
            return;
        }

        const clone = template.content.cloneNode(true);
        const modal = clone.querySelector('#genericConfirmationModal');
        const titleElement = clone.querySelector('.js-modal-title');
        const messageParagraph = clone.querySelector('.js-modal-message');
        const confirmButton = clone.querySelector('.js-modal-confirm-btn');
        const cancelButton = clone.querySelector('.js-modal-cancel-btn');

        titleElement.textContent = options.title || '确认操作';
        messageParagraph.innerHTML = Utils.escapeHtml(message).replace(/\n/g, '<br>');

        confirmButton.textContent = options.confirmText || '确认';
        confirmButton.className = `btn ${options.confirmClass || 'btn-danger'} js-modal-confirm-btn`; // Ensure class is maintained

        cancelButton.textContent = options.cancelText || '取消';
        cancelButton.className = `btn ${options.cancelClass || 'btn-secondary'} js-modal-cancel-btn`; // Ensure class is maintained

        confirmButton.addEventListener('click', () => {
            if (onConfirm) onConfirm();
            modal.remove();
        });

        cancelButton.addEventListener('click', () => {
            if (onCancel) onCancel();
            modal.remove();
        });

        modal.addEventListener('click', (event) => {
            if (event.target === modal) {
                if (onCancel) onCancel();
                modal.remove();
            }
        });

        // BUGFIX: 明确设置 display 样式使其可见
        modal.style.display = 'flex';
        document.body.appendChild(clone);
    },
    _renderMemorySetList: function() {
        if (!this.memorySetListContainerModal) return;
        this.memorySetListContainerModal.innerHTML = '';
        const sets = MemoryBookManager.getElementSets();
        const template = document.getElementById('memory-set-list-item-modal-template');

        if (!template) {
            Utils.log("ModalUIManager: memory-set-list-item-modal-template 未找到。", Utils.logLevels.ERROR);
            return;
        }

        if (sets.length === 0) {
            this.memorySetListContainerModal.innerHTML = `<p class="text-center text-muted">还没有记忆书。点击下方按钮添加一个吧！</p>`;
            return;
        }

        const fragment = document.createDocumentFragment();
        sets.forEach(set => {
            const clone = template.content.cloneNode(true);
            const nameEl = clone.querySelector('.js-set-name');
            const editBtn = clone.querySelector('.js-edit-btn');
            const deleteBtn = clone.querySelector('.js-delete-btn');

            nameEl.textContent = Utils.escapeHtml(set.name);
            editBtn.addEventListener('click', () => this._showMemorySetForm(set));
            deleteBtn.addEventListener('click', () => {
                this.showConfirmationModal(
                    `确定要删除记忆书 "${Utils.escapeHtml(set.name)}" 吗？这将删除所有已记录的记忆，且无法撤销。`,
                    () => MemoryBookManager.deleteElementSet(set.id)
                );
            });
            fragment.appendChild(clone);
        });
        this.memorySetListContainerModal.appendChild(fragment);
    },
    _showMemorySetForm: function(set = null) {
        if (!this.memorySetFormContainerModal || !this.showAddMemorySetFormBtn) return;

        this._editingMemorySetId = set ? set.id : null;
        const template = document.getElementById('memory-set-form-modal-template');
        if (!template) {
            Utils.log("ModalUIManager: memory-set-form-modal-template 未找到。", Utils.logLevels.ERROR);
            return;
        }
        const clone = template.content.cloneNode(true);
        const titleEl = clone.querySelector('.js-form-title');
        const nameInput = clone.querySelector('.js-set-name-input');
        const elementsInput = clone.querySelector('.js-set-elements-input');
        const saveBtn = clone.querySelector('.js-save-form-btn');
        const cancelBtn = clone.querySelector('.js-cancel-form-btn');

        titleEl.textContent = set ? '编辑记忆书' : '添加记忆书';
        nameInput.value = set ? Utils.escapeHtml(set.name) : '';
        elementsInput.value = set ? Utils.escapeHtml(set.elements.join(', ')) : '';
        saveBtn.textContent = set ? '保存修改' : '确认添加';

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
        this.memorySetFormContainerModal.appendChild(clone);
        this.memorySetFormContainerModal.style.display = 'block';
        this.showAddMemorySetFormBtn.style.display = 'none';
    },
    _hideMemorySetForm: function() {
        if (!this.memorySetFormContainerModal || !this.showAddMemorySetFormBtn) return;
        this.memorySetFormContainerModal.style.display = 'none';
        this.memorySetFormContainerModal.innerHTML = '';
        this.showAddMemorySetFormBtn.style.display = 'block';
        this._editingMemorySetId = null;
    },
    showCallingModal: function (peerName, onCancelCall, onStopMusicOnly, callType) {
        if (!this.callingModal || !this.callingModalTitle || !this.callingModalText || !this.callingModalAvatar || !this.callingModalCancelBtn) {
            Utils.log("呼叫中模态框元素未找到！", Utils.logLevels.ERROR);
            return;
        }
        this.callingModalTitle.textContent = `${callType}...`;
        this.callingModalText.textContent = `正在联系 ${Utils.escapeHtml(peerName)}...`;
        let avatarContentHtml;
        const peerContact = UserManager.contacts[VideoCallManager.currentPeerId];
        let fallbackText = (peerContact && peerContact.avatarText) ? Utils.escapeHtml(peerContact.avatarText) :
            (peerName && peerName.length > 0) ? Utils.escapeHtml(peerName.charAt(0).toUpperCase()) : '?';
        this.callingModalAvatar.className = 'video-call-avatar';
        if (peerContact && peerContact.isSpecial) {
            this.callingModalAvatar.classList.add(peerContact.id);
        }
        if (peerContact && peerContact.avatarUrl) {
            avatarContentHtml = `<img src="${peerContact.avatarUrl}" alt="${fallbackText}" class="avatar-image" data-fallback-text="${fallbackText}" data-entity-id="${peerContact.id}">`;
        } else {
            avatarContentHtml = fallbackText;
        }
        this.callingModalAvatar.innerHTML = avatarContentHtml;
        const newCancelBtn = this.callingModalCancelBtn.cloneNode(true);
        this.callingModalCancelBtn.parentNode.replaceChild(newCancelBtn, this.callingModalCancelBtn);
        this.callingModalCancelBtn = newCancelBtn;
        this.callingModalCancelBtn.addEventListener('click', onCancelCall);
        this.callingModal.style.display = 'flex';
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
            acceptBtn.addEventListener('click', () => VideoCallManager.acceptCall());
        }
        if(rejectBtn) {
            const newRejectBtn = rejectBtn.cloneNode(true);
            rejectBtn.parentNode.replaceChild(newRejectBtn, rejectBtn);
            rejectBtn = newRejectBtn;
            rejectBtn.addEventListener('click', () => VideoCallManager.rejectCall());
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