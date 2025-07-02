/**
 * @file 模态框统一管理器
 * @description 集中处理应用中所有模态框的显示、隐藏和相关逻辑。它负责管理设置、新建联系人/群组、通话、通用确认框以及开源信息提示等多种模态框，并统一处理其内部的事件绑定。
 * @module ModalManager - 在需要显示或操作模态框的模块中被引用，主要由 AppInitializer 进行初始化。
 * @exports {object} ModalUIManager - 对外暴露的单例对象，包含所有模态框管理方法。
 * @dependency Utils, NotificationUIManager, UserManager, GroupManager, AppInitializer, VideoCallManager, AppSettings, CharacterCardManager, MemoryBookManager, Store, ActionCreators, DBManager
 */
const ModalUIManager = {
    // =================================================================
    // 依赖的 DOM 元素引用 (按模态框功能组织)
    // =================================================================

    // --- 开源信息模态框 ---
    // 开源信息模态框的根元素
    openSourceInfoModal: null,
    // 关闭开源信息模态框的按钮
    closeOpenSourceInfoModalBtn: null,
    // “不再提示”按钮
    permanentlyCloseOpenSourceInfoModalBtn: null,
    // 显示倒计时的 span 元素
    openSourceModalTimerSpan: null,
    // 自动关闭模态框的定时器ID
    openSourceModalAutoCloseTimer: null,
    // 更新倒计时的定时器ID
    openSourceModalCountdownInterval: null,

    // --- 主菜单/设置模态框 ---
    // 主菜单（设置）模态框的根元素
    mainMenuModal: null,

    // --- 新建联系人/群组/角色/要素 模态框 ---
    // "新建" 功能的模态框根元素，包含多个标签页
    newContactGroupModal: null,

    // --- 通话相关模态框 ---
    // “呼叫中”模态框的根元素
    callingModal: null,
    // “呼叫中”模态框的标题元素
    callingModalTitle: null,
    // “呼叫中”模态框的描述文本元素
    callingModalText: null,
    // “呼叫中”模态框的头像容器
    callingModalAvatar: null,
    // “呼叫中”模态框的取消按钮
    callingModalCancelBtn: null,
    // "来电请求" 模态框的根元素
    videoCallRequestModal: null,

    // --- 记忆书（要素）管理 ---
    // 记忆书列表的容器元素
    memorySetListContainerModal: null,
    // 记忆书编辑表单的容器元素
    memorySetFormContainerModal: null,
    // “添加新记忆书”按钮
    showAddMemorySetFormBtn: null,

    // =================================================================
    // 内部状态变量
    // =================================================================

    // 当前正在编辑的记忆书ID，为 null 表示新建
    _editingMemorySetId: null,

    // =================================================================
    // 对外暴露方法
    // =================================================================

    /**
     * 初始化模态框管理器，获取所有相关的 DOM 引用并绑定通用事件。
     * @function init
     * @returns {void}
     */
    init: function() {
        // NOTE: 初始化流程负责将所有模态框相关的元素获取并绑定基础事件，确保模块就绪。
        // 1. 初始化开源信息模态框及其事件
        this.openSourceInfoModal = document.getElementById('openSourceInfoModal');
        this.closeOpenSourceInfoModalBtn = document.getElementById('closeOpenSourceInfoModalBtn');
        this.permanentlyCloseOpenSourceInfoModalBtn = document.getElementById('permanentlyCloseOpenSourceInfoModalBtn');
        this.openSourceModalTimerSpan = document.getElementById('openSourceModalTimer');
        this._bindOpenSourceInfoModalEvents();

        // 2. 初始化主菜单（设置）模态框
        this.mainMenuModal = document.getElementById('mainMenuModal');
        if (this.mainMenuModal) {
            const closeMainMenuBtn = this.mainMenuModal.querySelector('.close-modal-btn[data-modal-id="mainMenuModal"]');
            if (closeMainMenuBtn) {
                closeMainMenuBtn.addEventListener('click', () => this.toggleModal('mainMenuModal', false));
            }
            // 点击模态框背景关闭
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
                // 每次打开时更新设置项的状态
                if (typeof SettingsUIManager !== 'undefined') {
                    SettingsUIManager.updateMainMenuControlsState();
                }
            });
        }
        // NOTE: 将设置模态框内的操作按钮绑定逻辑集中到 bindMainMenuActionButtons 方法，以修复之前按钮无法点击的问题。
        this.bindMainMenuActionButtons();

        // 3. 初始化新建联系人/群组模态框
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
            // 绑定标签页切换逻辑
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

        // 4. 初始化新建联系人/群组模态框内的确认操作
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

        // 5. 初始化记忆书（要素）管理相关元素和事件
        this.memorySetListContainerModal = document.getElementById('memorySetListContainerModal');
        this.memorySetFormContainerModal = document.getElementById('memorySetFormContainerModal');
        this.showAddMemorySetFormBtn = document.getElementById('showAddMemorySetFormBtn');
        if (this.showAddMemorySetFormBtn) {
            this.showAddMemorySetFormBtn.addEventListener('click', () => this._showMemorySetForm());
        }
        if (typeof EventEmitter !== 'undefined') {
            EventEmitter.on('memorySetsUpdated', () => {
                // 当记忆书数据更新时，如果模态框是打开的，则重新渲染列表
                if (this.newContactGroupModal && this.newContactGroupModal.style.display !== 'none') {
                    this._renderMemorySetList();
                }
            });
        }

        // 6. 初始化通话相关模态框
        this.callingModal = document.getElementById('callingModal');
        this.callingModalTitle = document.getElementById('callingModalTitle');
        this.callingModalText = document.getElementById('callingModalText');
        this.callingModalAvatar = document.getElementById('callingModalAvatar');
        this.callingModalCancelBtn = document.getElementById('callingModalCancelBtn');
        this.videoCallRequestModal = document.getElementById('videoCallRequest');
    },

    /**
     * 通用的模态框显示/隐藏切换方法。
     * @function toggleModal
     * @param {string} modalId - 目标模态框的 DOM ID。
     * @param {boolean} show - `true` 表示显示，`false` 表示隐藏。
     * @returns {void}
     */
    toggleModal: function (modalId, show) {
        const modal = document.getElementById(modalId);
        if (modal) {
            modal.style.display = show ? 'flex' : 'none';
            // 特殊逻辑：当打开新建模态框时，渲染记忆书列表并隐藏表单
            if (show && modalId === 'newContactGroupModal') {
                this._renderMemorySetList();
                this._hideMemorySetForm();
            }
        } else {
            Utils.log(`未找到 ID 为 '${modalId}' 的模态框。`, Utils.logLevels.WARN);
        }
    },

    /**
     * 显示一个通用的、动态生成的确认对话框。
     * @function showConfirmationModal
     * @param {string} message - 对话框中显示的提示信息，支持换行符 `\n`。
     * @param {function} onConfirm - 用户点击确认按钮时执行的回调函数。
     * @param {function} [onCancel=null] - 用户点击取消或关闭时执行的回调函数（可选）。
     * @param {object} [options={}] - 自定义对话框外观和文本的选项（可选）。
     * @param {string} [options.title='确认操作'] - 对话框标题。
     * @param {string} [options.confirmText='确认'] - 确认按钮的文本。
     * @param {string} [options.cancelText='取消'] - 取消按钮的文本。
     * @param {string} [options.confirmClass='btn-danger'] - 确认按钮的 CSS 类。
     * @param {string} [options.cancelClass='btn-secondary'] - 取消按钮的 CSS 类。
     * @returns {void}
     */
    showConfirmationModal: function (message, onConfirm, onCancel = null, options = {}) {
        // 1. 如果已存在同类模态框，先移除，防止重复
        const existingModal = document.getElementById('genericConfirmationModal');
        if (existingModal) {
            existingModal.remove();
        }

        // 2. 从 HTML 模板中克隆模态框结构
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

        // 3. 根据传入参数填充内容和样式
        titleElement.textContent = options.title || '确认操作';
        messageParagraph.innerHTML = Utils.escapeHtml(message).replace(/\n/g, '<br>'); // 支持换行
        confirmButton.textContent = options.confirmText || '确认';
        confirmButton.className = `btn ${options.confirmClass || 'btn-danger'} js-modal-confirm-btn`;
        cancelButton.textContent = options.cancelText || '取消';
        cancelButton.className = `btn ${options.cancelClass || 'btn-secondary'} js-modal-cancel-btn`;

        // 4. 绑定事件处理器
        confirmButton.addEventListener('click', () => {
            if (onConfirm) onConfirm();
            modal.remove();
        });
        cancelButton.addEventListener('click', () => {
            if (onCancel) onCancel();
            modal.remove();
        });
        modal.addEventListener('click', (event) => {
            if (event.target === modal) { // 点击背景关闭
                if (onCancel) onCancel();
                modal.remove();
            }
        });

        // 5. 显示模态框
        // NOTE: 修复了原先未设置 display 样式导致模态框不可见的问题。
        modal.style.display = 'flex';
        document.body.appendChild(clone);
    },

    /**
     * 显示“呼叫中”的模态框。
     * @function showCallingModal
     * @param {string} peerName - 对方的名称。
     * @param {function} onCancelCall - 用户点击取消按钮时的回调函数。
     * @param {function} onStopMusicOnly - (未使用) 预留用于仅停止音乐的回调。
     * @param {string} callType - 呼叫类型，如 'Calling'。
     * @returns {void}
     */
    showCallingModal: function (peerName, onCancelCall, onStopMusicOnly, callType) {
        if (!this.callingModal || !this.callingModalTitle || !this.callingModalText || !this.callingModalAvatar || !this.callingModalCancelBtn) {
            Utils.log("呼叫中模态框元素未找到！", Utils.logLevels.ERROR);
            return;
        }

        // 1. 设置模态框内容
        this.callingModalTitle.textContent = `${callType}...`;
        this.callingModalText.textContent = `正在联系 ${Utils.escapeHtml(peerName)}...`;

        // 2. 设置头像
        let avatarContentHtml;
        const peerContact = UserManager.contacts[VideoCallManager.currentPeerId];
        let fallbackText = (peerContact && peerContact.avatarText) ? Utils.escapeHtml(peerContact.avatarText) :
            (peerName && peerName.length > 0) ? Utils.escapeHtml(peerName.charAt(0).toUpperCase()) : '?';
        this.callingModalAvatar.className = 'video-call-avatar'; // 重置样式
        if (peerContact && peerContact.isSpecial) {
            this.callingModalAvatar.classList.add(peerContact.id);
        }
        if (peerContact && peerContact.avatarUrl) {
            avatarContentHtml = `<img src="${peerContact.avatarUrl}" alt="${fallbackText}" class="avatar-image" data-fallback-text="${fallbackText}" data-entity-id="${peerContact.id}">`;
        } else {
            avatarContentHtml = fallbackText;
        }
        this.callingModalAvatar.innerHTML = avatarContentHtml;

        // 3. 重新绑定取消按钮事件以避免陈旧闭包
        const newCancelBtn = this.callingModalCancelBtn.cloneNode(true);
        this.callingModalCancelBtn.parentNode.replaceChild(newCancelBtn, this.callingModalCancelBtn);
        this.callingModalCancelBtn = newCancelBtn;
        this.callingModalCancelBtn.addEventListener('click', onCancelCall);

        // 4. 显示模态框
        this.callingModal.style.display = 'flex';
    },

    /**
     * 隐藏“呼叫中”的模态框。
     * @function hideCallingModal
     * @returns {void}
     */
    hideCallingModal: function () {
        if (this.callingModal && this.callingModal.style.display !== 'none') {
            this.callingModal.style.display = 'none';
        }
    },

    /**
     * 显示来电请求的模态框。
     * @function showCallRequest
     * @param {string} peerId - 来电方的 Peer ID。
     * @param {boolean} [audioOnly=false] - 是否为纯音频通话。
     * @param {boolean} [isScreenShare=false] - 是否为屏幕共享请求。
     * @returns {void}
     */
    showCallRequest: function (peerId, audioOnly = false, isScreenShare = false) {
        if (!this.videoCallRequestModal) return;

        // 1. 获取模态框内部元素
        const requestTitle = this.videoCallRequestModal.querySelector('h3');
        const requestDesc = this.videoCallRequestModal.querySelector('p');
        const avatarEl = this.videoCallRequestModal.querySelector('.video-call-avatar');
        let acceptBtn = this.videoCallRequestModal.querySelector('.accept-call');
        let rejectBtn = this.videoCallRequestModal.querySelector('.reject-call');

        // 2. 准备并填充内容
        const peerName = UserManager.contacts[peerId]?.name || `用户 ${peerId.substring(0, 4)}`;
        const peerContact = UserManager.contacts[peerId];
        let avatarContentHtml;
        if (peerContact && peerContact.avatarUrl) {
            avatarContentHtml = `<img src="${peerContact.avatarUrl}" alt="${Utils.escapeHtml(peerName.charAt(0))}" class="avatar-image">`;
        } else {
            avatarContentHtml = Utils.escapeHtml(peerName?.charAt(0).toUpperCase() || 'P');
        }
        if (avatarEl) avatarEl.innerHTML = avatarContentHtml;

        let callTypeString = "视频通话";
        if (isScreenShare) callTypeString = "屏幕共享";
        else if (audioOnly) callTypeString = "语音通话";

        if (requestTitle) requestTitle.textContent = `${callTypeString}请求`;
        if (requestDesc) requestDesc.textContent = `${peerName} ${isScreenShare ? '想要共享屏幕' : '正在呼叫'}...`;

        // 3. 重新绑定接受和拒绝按钮事件
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

        // 4. 显示模态框
        this.videoCallRequestModal.style.display = 'flex';
    },

    /**
     * 隐藏来电请求的模态框。
     * @function hideCallRequest
     * @returns {void}
     */
    hideCallRequest: function () {
        if (this.videoCallRequestModal) this.videoCallRequestModal.style.display = 'none';
    },

    /**
     * 显示开源信息提示模态框，并启动自动关闭倒计时。
     * @function showOpenSourceInfoModal
     * @returns {void}
     */
    showOpenSourceInfoModal: function () {
        // 如果用户已选择永久关闭，则不显示
        if (localStorage.getItem('hideOpenSourceModalPermanently') === 'true') {
            return;
        }
        if (this.openSourceInfoModal && this.openSourceModalTimerSpan) {
            this.openSourceInfoModal.style.display = 'flex';

            // 设置倒计时逻辑
            let countdown = 8;
            this.openSourceModalTimerSpan.textContent = countdown;

            // 清理旧的定时器
            if (this.openSourceModalAutoCloseTimer) clearTimeout(this.openSourceModalAutoCloseTimer);
            if (this.openSourceModalCountdownInterval) clearInterval(this.openSourceModalCountdownInterval);

            // 启动新的定时器
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

    /**
     * 隐藏开源信息提示模态框，并清除相关定时器。
     * @function hideOpenSourceInfoModal
     * @returns {void}
     */
    hideOpenSourceInfoModal: function () {
        if (this.openSourceInfoModal) {
            this.openSourceInfoModal.style.display = 'none';
        }
        // 确保清除所有定时器
        if (this.openSourceModalAutoCloseTimer) clearTimeout(this.openSourceModalAutoCloseTimer);
        if (this.openSourceModalCountdownInterval) clearInterval(this.openSourceModalCountdownInterval);
        this.openSourceModalAutoCloseTimer = null;
        this.openSourceModalCountdownInterval = null;
    },

    /**
     * 显示添加联系人模态框，并预先填入用户ID。
     * @function showAddContactModalWithId
     * @param {string} userId - 要预填入输入框的用户ID。
     * @returns {void}
     */
    showAddContactModalWithId: function(userId) {
        this.toggleModal('newContactGroupModal', true);
        const peerIdInput = document.getElementById('newPeerIdInput');
        const peerNameInput = document.getElementById('newPeerNameInput');
        if (peerIdInput) {
            peerIdInput.value = userId;
        }
        if (peerNameInput) {
            peerNameInput.value = '';
            peerNameInput.focus(); // 自动聚焦到名称输入框
        }
    },

    // =================================================================
    // 内部逻辑方法 (Private)
    // =================================================================

    /**
     * @private
     * 集中绑定主菜单（设置）模态框中的所有操作按钮事件。
     * @function bindMainMenuActionButtons
     * @returns {void}
     */
    bindMainMenuActionButtons: function() {
        // NOTE: 此函数用于解决设置菜单中按钮点击事件失效的问题，将绑定逻辑集中管理。

        // 1. 绑定“复制我的ID”按钮
        const modalCopyIdBtn = document.getElementById('modalCopyIdBtn');
        if(modalCopyIdBtn) {
            modalCopyIdBtn.addEventListener('click', () => {
                if (modalCopyIdBtn.disabled) return;
                if (typeof SettingsUIManager !== 'undefined' && SettingsUIManager.copyUserIdFromModal) {
                    SettingsUIManager.copyUserIdFromModal();
                }
            });
        }

        // 2. 绑定“手动检查/重连网络”按钮
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

        // 3. 绑定 WebRTC 手动操作相关按钮
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

        // 4. 绑定数据清理相关按钮
        const modalClearContactsBtn = document.getElementById('modalClearContactsBtn');
        if (modalClearContactsBtn) modalClearContactsBtn.addEventListener('click', () => UserManager.clearAllContacts());
        const modalClearAllChatsBtn = document.getElementById('modalClearAllChatsBtn');
        if (modalClearAllChatsBtn) modalClearAllChatsBtn.addEventListener('click', () => ActionCreators.clearAllChatsRequest());
        const modalClearCacheBtn = document.getElementById('modalClearCacheBtn');
        if (modalClearCacheBtn) {
            modalClearCacheBtn.addEventListener('click', () => {
                this.showConfirmationModal(
                    '您确定要清除所有本地缓存吗？\n这将删除所有 localStorage 数据和 IndexedDB 数据库中的所有内容。\n操作完成后，页面将自动刷新。',
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

    /**
     * @private
     * 绑定开源信息模态框的内部事件（关闭、永久关闭）。
     * @function _bindOpenSourceInfoModalEvents
     * @returns {void}
     */
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
                // 点击背景关闭
                if (event.target === this.openSourceInfoModal) {
                    this.hideOpenSourceInfoModal();
                }
            });
        }
    },

    /**
     * @private
     * 在模态框内渲染记忆书列表。
     * @function _renderMemorySetList
     * @returns {void}
     */
    _renderMemorySetList: function() {
        if (!this.memorySetListContainerModal) return;
        this.memorySetListContainerModal.innerHTML = ''; // 清空旧列表
        const sets = MemoryBookManager.getElementSets();
        const template = document.getElementById('memory-set-list-item-modal-template');
        if (!template) {
            Utils.log("ModalUIManager: memory-set-list-item-modal-template 未找到。", Utils.logLevels.ERROR);
            return;
        }

        // 如果没有数据，显示提示信息
        if (sets.length === 0) {
            this.memorySetListContainerModal.innerHTML = `<p class="text-center text-muted">还没有记忆书。点击下方按钮添加一个吧！</p>`;
            return;
        }

        // 使用文档片段以提高性能
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

    /**
     * @private
     * 显示用于添加或编辑记忆书的表单。
     * @function _showMemorySetForm
     * @param {object|null} [set=null] - 要编辑的记忆书对象。如果为 null，则为添加新记忆书。
     * @returns {void}
     */
    _showMemorySetForm: function(set = null) {
        if (!this.memorySetFormContainerModal || !this.showAddMemorySetFormBtn) return;

        this._editingMemorySetId = set ? set.id : null;
        const template = document.getElementById('memory-set-form-modal-template');
        if (!template) {
            Utils.log("ModalUIManager: memory-set-form-modal-template 未找到。", Utils.logLevels.ERROR);
            return;
        }

        // 渲染表单
        const clone = template.content.cloneNode(true);
        const titleEl = clone.querySelector('.js-form-title');
        const nameInput = clone.querySelector('.js-set-name-input');
        const elementsInput = clone.querySelector('.js-set-elements-input');
        const saveBtn = clone.querySelector('.js-save-form-btn');
        const cancelBtn = clone.querySelector('.js-cancel-form-btn');

        // 根据是编辑还是新增，填充表单内容
        titleEl.textContent = set ? '编辑记忆书' : '添加记忆书';
        nameInput.value = set ? Utils.escapeHtml(set.name) : '';
        elementsInput.value = set ? Utils.escapeHtml(set.elements.join(', ')) : '';
        saveBtn.textContent = set ? '保存修改' : '确认添加';

        // 绑定表单按钮事件
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
                this._hideMemorySetForm(); // 操作成功后隐藏表单
            }
        });
        cancelBtn.addEventListener('click', () => this._hideMemorySetForm());

        // 显示表单，隐藏“添加”按钮
        this.memorySetFormContainerModal.innerHTML = '';
        this.memorySetFormContainerModal.appendChild(clone);
        this.memorySetFormContainerModal.style.display = 'block';
        this.showAddMemorySetFormBtn.style.display = 'none';
    },

    /**
     * @private
     * 隐藏记忆书编辑表单，并重置状态。
     * @function _hideMemorySetForm
     * @returns {void}
     */
    _hideMemorySetForm: function() {
        if (!this.memorySetFormContainerModal || !this.showAddMemorySetFormBtn) return;
        this.memorySetFormContainerModal.style.display = 'none';
        this.memorySetFormContainerModal.innerHTML = ''; // 清空表单内容
        this.showAddMemorySetFormBtn.style.display = 'block'; // 重新显示“添加”按钮
        this._editingMemorySetId = null; // 重置编辑状态
    }
};