/**
 * @file 管理应用右侧详情面板的 UI 元素和交互
 * @description 该模块负责渲染和管理右侧详情面板。此面板根据当前选择的聊天，动态显示联系人详情、群组信息（成员列表、AI行为配置）、或人员大厅。它还集成了 AI 的特定配置（如词汇篇章、TTS 设置、记忆书）和群组管理功能。
 * @module DetailsPanelUIManager
 * @exports {object} DetailsPanelUIManager - 对外暴露的单例对象，包含管理右侧详情面板的所有方法。
 * @dependency UserManager, GroupManager, ChatManager, MessageManager, TtsUIManager, NotificationUIManager, Utils, ConnectionManager, PeopleLobbyManager, AppSettings, LayoutUIManager, EventEmitter, DBManager, ResourcePreviewUIManager, TimerManager, MemoryBookManager, ModalUIManager, Store, ActionCreators
 */
const DetailsPanelUIManager = {
    // 当前详情面板展示的聊天 ID
    currentChatId: null,

    // NOTE: 定时器任务名称
    // 用于 TimerManager 的群组成员状态刷新任务的唯一名称
    _GROUP_MEMBER_REFRESH_TASK_NAME: 'groupMemberStatusRefresh',

    // --- DOM 元素引用 ---
    detailsPanelEl: null, // 详情面板的根元素
    detailsPanelTitleEl: null, // 详情面板的标题元素
    closeDetailsBtnMainEl: null, // 关闭详情面板的按钮
    detailsPanelContentEl: null, // 包含联系人或群组具体信息的容器
    detailsNameEl: null, // 显示名称的元素
    detailsIdEl: null, // 显示 ID 的元素
    detailsAvatarEl: null, // 显示头像的元素
    detailsStatusEl: null, // 显示状态（如在线、离线）的元素
    currentChatActionsDetailsEl: null, // 当前聊天操作区域（如清空聊天记录）
    clearCurrentChatBtnDetailsEl: null, // 清空聊天记录按钮
    contactActionsDetailsEl: null, // 联系人操作区域（如删除联系人）
    deleteContactBtnDetailsEl: null, // 删除联系人按钮
    aiContactAboutSectionEl: null, // AI 联系人“关于”信息区域
    aiContactAboutNameEl: null, // AI“关于”区域中的名称
    aiContactBasicInfoListEl: null, // AI“关于”区域中的基础信息列表
    aiContactAboutNameSubEl: null, // AI“关于”区域中的副标题名称
    aiContactAboutTextEl: null, // AI“关于”区域中的详细描述文本
    aiTtsConfigSectionEl: null, // AI TTS（语音合成）配置区域
    aiTtsConfigHeaderEl: null, // AI TTS 配置区域的折叠头部
    aiTtsConfigContentEl: null, // AI TTS 配置区域的内容容器
    saveAiTtsSettingsBtnDetailsEl: null, // 保存 AI TTS 设置的按钮
    ttsAttributionHeaderEl: null, // TTS 版权信息的折叠头部
    ttsAttributionContentEl: null, // TTS 版权信息的内容容器
    detailsGroupManagementEl: null, // 群组管理的总容器
    groupMemberListHeaderEl: null, // 群成员列表的折叠头部
    groupMemberListContainerEl: null, // 群成员列表的容器
    groupMemberListDetailsEl: null, // 群成员列表的 ul 元素
    groupMemberCountEl: null, // 显示群成员数量的元素
    addGroupMemberAreaEl: null, // 添加群成员的操作区域
    leftMembersAreaEl: null, // 已离开群成员的显示区域
    contactsDropdownDetailsEl: null, // 添加成员时选择联系人的下拉列表
    addMemberBtnDetailsEl: null, // “添加成员”按钮
    groupAiPromptsSectionEl: null, // 群内 AI 行为指示（Prompts）配置区域
    groupAiPromptsHeaderEl: null, // 群内 AI Prompts 配置区域的折叠头部
    groupAiPromptsListContainerEl: null, // 群内 AI Prompts 编辑器列表容器
    groupActionsDetailsEl: null, // 群组操作区域（如离开、解散）
    leaveGroupBtnDetailsEl: null, // 离开群组按钮
    dissolveGroupBtnDetailsEl: null, // 解散群组按钮
    peopleLobbyContentEl: null, // 人员大厅内容的容器
    resourcePreviewSectionEl: null, // 资源预览模块容器
    aiChapterSectionEl: null, // AI 词汇篇章（Chapter）选择区域
    memoryBookSectionEl: null, // AI 记忆书模块容器
    memoryBookListEl: null, // AI 记忆书列表元素

    /**
     * 初始化模块
     * @function init
     * @description 获取所有必需的 DOM 元素引用，绑定核心事件监听器，并订阅全局状态和事件。
     * @returns {void}
     */
    init: function() {
        // 流程如下：
        // 1. 缓存所有需要的 DOM 元素引用
        this.detailsPanelEl = document.getElementById('detailsPanel');
        this.detailsPanelTitleEl = document.getElementById('detailsPanelTitle');
        this.closeDetailsBtnMainEl = document.getElementById('closeDetailsBtnMain');
        this.detailsPanelContentEl = document.getElementById('detailsPanelContent');
        this.detailsNameEl = document.getElementById('detailsName');
        this.detailsIdEl = document.getElementById('detailsId');
        this.detailsAvatarEl = document.getElementById('detailsAvatar');
        this.detailsStatusEl = document.getElementById('detailsStatus');
        this.contactActionsDetailsEl = document.getElementById('contactActionsDetails');
        this.currentChatActionsDetailsEl = document.getElementById('currentChatActionsDetails');
        this.clearCurrentChatBtnDetailsEl = document.getElementById('clearCurrentChatBtnDetails');
        this.deleteContactBtnDetailsEl = document.getElementById('deleteContactBtnDetails');
        this.detailsGroupManagementEl = document.getElementById('detailsGroupManagement');
        this.groupMemberListHeaderEl = document.getElementById('groupMemberListHeader');
        this.groupMemberListContainerEl = document.getElementById('groupMemberListContainer');
        this.groupMemberListDetailsEl = document.getElementById('groupMemberListDetails');
        this.groupMemberCountEl = document.getElementById('groupMemberCount');
        this.addGroupMemberAreaEl = document.getElementById('addGroupMemberArea');
        this.leftMembersAreaEl = document.getElementById('leftMembersArea');
        this.contactsDropdownDetailsEl = document.getElementById('contactsDropdownDetails');
        this.addMemberBtnDetailsEl = document.getElementById('addMemberBtnDetails');
        this.groupAiPromptsSectionEl = document.getElementById('groupAiPromptsSection');
        this.groupAiPromptsHeaderEl = document.getElementById('groupAiPromptsHeader');
        this.groupAiPromptsListContainerEl = document.getElementById('groupAiPromptsListContainer');
        this.groupActionsDetailsEl = document.getElementById('groupActionsDetails');
        this.leaveGroupBtnDetailsEl = document.getElementById('leaveGroupBtnDetails');
        this.dissolveGroupBtnDetailsEl = document.getElementById('dissolveGroupBtnDetails');
        this.aiContactAboutSectionEl = document.getElementById('aiContactAboutSection');
        this.aiContactAboutNameEl = document.getElementById('aiContactAboutName');
        this.aiContactBasicInfoListEl = document.getElementById('aiContactBasicInfoList');
        this.aiContactAboutNameSubEl = document.getElementById('aiContactAboutNameSub');
        this.aiContactAboutTextEl = document.getElementById('aiContactAboutText');
        this.aiTtsConfigSectionEl = document.getElementById('aiTtsConfigSection');
        this.aiTtsConfigHeaderEl = document.getElementById('aiTtsConfigHeader');
        this.aiTtsConfigContentEl = document.getElementById('aiTtsConfigContent');
        this.saveAiTtsSettingsBtnDetailsEl = document.getElementById('saveAiTtsSettingsBtnDetails');
        this.ttsAttributionHeaderEl = document.getElementById('ttsAttributionCollapsibleTrigger');
        this.ttsAttributionContentEl = document.getElementById('ttsAttributionCollapsibleContent');
        this.peopleLobbyContentEl = document.getElementById('peopleLobbyContent');
        this.resourcePreviewSectionEl = document.getElementById('resourcePreviewSection');
        this.aiChapterSectionEl = document.getElementById('aiChapterSection');
        this.memoryBookSectionEl = document.getElementById('memoryBookSection');
        this.memoryBookListEl = document.getElementById('memoryBookList');

        // 2. 绑定 UI 交互事件
        this.bindEvents();

        // 3. 订阅 Store，以响应应用状态的变化自动更新视图
        Store.subscribe(this.handleStateChange.bind(this));

        // 4. 监听底层事件，用于实时更新群成员连接状态等
        EventEmitter.on('connectionEstablished', (peerId) => this._tryRefreshGroupMembersView(peerId));
        EventEmitter.on('connectionClosed', (peerId) => this._tryRefreshGroupMembersView(peerId));
        EventEmitter.on('connectionFailed', (peerId) => this._tryRefreshGroupMembersView(peerId));
        EventEmitter.on('onlineUsersUpdated', () => {
            const state = Store.getState();
            if (state.detailsPanelContent === 'details' && state.currentChatId && state.currentChatId.startsWith('group_')) {
                this.updateDetailsPanelMembers(state.currentChatId);
            }
        });

        // 5. 监听记忆书相关的事件，以更新UI
        EventEmitter.on('memorySetsUpdated', () => this._renderMemoryBookSection(this.currentChatId));
        EventEmitter.on('memoryBookUpdated', ({ setId, chatId, content }) => this._updateMemoryBookUI(setId, chatId, content));
        EventEmitter.on('memoryBookGenerationStarted', ({ setId, chatId }) => this._setMemoryBookLoadingState(setId, chatId, true));
        EventEmitter.on('memoryBookGenerationFailed', ({ setId, chatId }) => this._setMemoryBookLoadingState(setId, chatId, false));

        Utils.log("DetailsPanelUIManager 初始化完成。", Utils.logLevels.INFO);
    },

    /**
     * 处理全局状态变更
     * @function handleStateChange
     * @description 订阅 Store 后的回调函数，根据新的状态更新面板的可见性和内容。
     * @param {object} newState - Store 提供的最新应用状态。
     * @returns {void}
     */
    handleStateChange: async function(newState) {
        // 1. 根据 isDetailsPanelVisible 状态更新面板的整体可见性
        this._setPanelVisibility(newState.isDetailsPanelVisible, newState.detailsPanelContent);

        // 2. 如果面板可见且内容为“人员大厅”，则渲染大厅内容
        if (newState.isDetailsPanelVisible && newState.detailsPanelContent === 'lobby') {
            if (this.detailsPanelTitleEl) this.detailsPanelTitleEl.textContent = '人员大厅';
            if (PeopleLobbyManager) await PeopleLobbyManager.show();
        }

        // 3. 如果当前聊天 ID 发生变化，则更新详情面板内容
        if (newState.currentChatId !== this.currentChatId) {
            const chatType = newState.currentChatId ? (newState.currentChatId.startsWith('group_') ? 'group' : 'contact') : null;
            this.updateDetailsPanel(newState.currentChatId, chatType);
        }
    },

    /**
     * 更新详情面板内容
     * @function updateDetailsPanel
     * @description 根据传入的聊天ID和类型，决定显示联系人详情还是群组详情。
     * @param {string|null} chatId - 当前聊天ID。如果为 null，则清空面板。
     * @param {string|null} type - 聊天类型，'contact' 或 'group'。
     * @returns {void}
     */
    updateDetailsPanel: function (chatId, type) {
        if (!this.detailsPanelEl || !this.detailsPanelContentEl) return;
        this.currentChatId = chatId;

        // 1. 重置所有可选区域的显示状态
        [this.contactActionsDetailsEl, this.detailsGroupManagementEl, this.groupActionsDetailsEl,
            this.aiContactAboutSectionEl, this.aiTtsConfigSectionEl,
            this.groupAiPromptsSectionEl, this.aiChapterSectionEl, this.memoryBookSectionEl]
            .forEach(el => { if (el) el.style.display = 'none'; });

        // 2. 默认显示资源预览区域
        if (this.resourcePreviewSectionEl) {
            this.resourcePreviewSectionEl.style.display = 'block';
        }

        // 3. 根据是否存在 chatId，显示或隐藏通用聊天操作
        this.currentChatActionsDetailsEl.style.display = chatId ? 'block' : 'none';

        // 4. 根据聊天类型，调用相应的更新函数
        if (type === 'contact') {
            this._updateForContact(chatId);
            // NOTE: 从群组切换到联系人时，停止群成员状态的定时刷新
            if (typeof TimerManager !== 'undefined') {
                TimerManager.removePeriodicTask(this._GROUP_MEMBER_REFRESH_TASK_NAME);
            }
        } else if (type === 'group') {
            this._updateForGroup(chatId);
        }

        // 5. 如果详情面板可见，加载对应的资源预览
        const state = Store.getState();
        if (typeof ResourcePreviewUIManager !== 'undefined' && chatId && state.isDetailsPanelVisible && state.detailsPanelContent === 'details') {
            ResourcePreviewUIManager.loadResourcesForChat(chatId);
        } else if (typeof ResourcePreviewUIManager !== 'undefined') {
            ResourcePreviewUIManager.hide();
        }
    },

    /**
     * 更新群组详情中的成员列表和添加成员下拉框
     * @function updateDetailsPanelMembers
     * @description 重新渲染群组成员列表（包括在线状态、重连按钮等）和可添加成员的下拉列表。
     * @param {string} groupId - 要更新的群组ID。
     * @returns {void}
     */
    updateDetailsPanelMembers: function (groupId) {
        const group = GroupManager.groups[groupId];
        if (!group || !this.groupMemberListDetailsEl || !this.groupMemberCountEl || !this.contactsDropdownDetailsEl) return;
        const leftMemberListDetailsEl = document.getElementById('leftMemberListDetails');
        if (!leftMemberListDetailsEl) return;

        // 1. 清空并更新成员数量
        this.groupMemberListDetailsEl.innerHTML = '';
        this.groupMemberCountEl.textContent = group.members.length;

        // 2. 获取排序后的成员列表
        const membersWithSortInfo = this._getSortedMembers(group);
        const memberTemplate = document.getElementById('group-member-item-template');
        const leftMemberTemplate = document.getElementById('left-member-item-template');

        if (!memberTemplate || !leftMemberTemplate) {
            Utils.log('DetailsPanelUIManager Error: 模板未找到。', Utils.logLevels.ERROR);
            return;
        }

        // 3. 渲染当前成员列表
        const fragment = document.createDocumentFragment();
        membersWithSortInfo.forEach(memberData => {
            // ... (内部渲染逻辑保持不变)
            const memberId = memberData.id;
            const itemClone = memberTemplate.content.cloneNode(true);
            const nameEl = itemClone.querySelector('.member-name');
            const ownerBadge = itemClone.querySelector('.owner-badge');
            const statusEl = itemClone.querySelector('.member-status');
            const reconnectBtn = itemClone.querySelector('.reconnect-member-btn-detail');
            const removeBtn = itemClone.querySelector('.remove-member-btn-detail');
            nameEl.textContent = `${Utils.escapeHtml(memberData.name)} ${memberId === UserManager.userId ? '(您)' : ''} ${memberData.isAI ? '(AI)' : ''}`;
            if (memberId === group.owner) {
                ownerBadge.style.display = 'inline-block';
                removeBtn.remove();
            } else {
                ownerBadge.remove();
                if (group.owner === UserManager.userId) {
                    removeBtn.dataset.memberId = memberId;
                    removeBtn.addEventListener('click', () => {
                        ActionCreators.removeGroupMemberRequest({ groupId, memberId });
                    });
                } else {
                    removeBtn.remove();
                }
            }
            if (memberId !== UserManager.userId && !memberData.isAI) {
                const isConnected = ConnectionManager.isConnectedTo(memberId);
                const isActuallyOnline = PeopleLobbyManager.onlineUserIds ? PeopleLobbyManager.onlineUserIds.includes(memberId) : false;
                statusEl.textContent = isActuallyOnline ? (isConnected ? '(已连接)' : '(在线)') : '(离线)';
                statusEl.className = 'member-status ' + (isActuallyOnline ? (isConnected ? 'connected' : 'online-not-connected') : 'offline');
                if (isActuallyOnline && !isConnected) {
                    reconnectBtn.dataset.memberId = memberId;
                    reconnectBtn.addEventListener('click', () => ConnectionManager.createOffer(memberId, { isSilent: false }));
                } else {
                    reconnectBtn.remove();
                }
            } else {
                statusEl.remove();
                reconnectBtn.remove();
                if (memberId === UserManager.userId) removeBtn.remove();
            }
            fragment.appendChild(itemClone);
        });
        this.groupMemberListDetailsEl.appendChild(fragment);

        // 4. 渲染可添加的联系人下拉列表
        this.contactsDropdownDetailsEl.innerHTML = '<option value="">选择要添加的联系人...</option>';
        Object.values(UserManager.contacts).forEach(contact => {
            const isAlreadyMember = group.members.includes(contact.id);
            const hasLeft = group.leftMembers?.some(lm => lm.id === contact.id);
            const isAddableCurrentThemeAI = UserManager.isSpecialContactInCurrentTheme(contact.id) && contact.isAI;
            const isRegularContact = !contact.isSpecial && !contact.isAI;
            if (!isAlreadyMember && !hasLeft && (isAddableCurrentThemeAI || isRegularContact)) {
                const option = document.createElement('option');
                option.value = contact.id;
                option.textContent = `${contact.name} ${contact.isAI ? '(AI助手)' : ''}`;
                this.contactsDropdownDetailsEl.appendChild(option);
            }
        });

        // 5. 渲染已离开的成员列表（仅群主可见）
        leftMemberListDetailsEl.innerHTML = '';
        if (group.owner === UserManager.userId && group.leftMembers && group.leftMembers.length > 0 && this.leftMembersAreaEl) {
            const leftFragment = document.createDocumentFragment();
            group.leftMembers.forEach(leftMember => {
                // ... (内部渲染逻辑保持不变)
                const itemClone = leftMemberTemplate.content.cloneNode(true);
                itemClone.querySelector('.js-left-member-name').textContent = `${Utils.escapeHtml(leftMember.name)} (离开于: ${Utils.formatDate(new Date(leftMember.leftTime))})`;
                const reAddBtn = itemClone.querySelector('.js-re-add-btn');
                reAddBtn.dataset.memberId = leftMember.id;
                reAddBtn.dataset.memberName = Utils.escapeHtml(leftMember.name);
                reAddBtn.addEventListener('click', () => {
                    ActionCreators.addGroupMemberRequest({
                        groupId: groupId,
                        memberId: reAddBtn.dataset.memberId,
                        memberName: reAddBtn.dataset.memberName
                    });
                });
                leftFragment.appendChild(itemClone);
            });
            leftMemberListDetailsEl.appendChild(leftFragment);
            this.leftMembersAreaEl.style.display = 'block';
        } else if (this.leftMembersAreaEl) {
            this.leftMembersAreaEl.style.display = 'none';
        }
    },

    /**
     * 处理从详情面板添加成员到当前群组的逻辑
     * @function handleAddMemberToGroupDetails
     * @description 从下拉列表中获取选定的联系人，并调用 ActionCreator 发起添加成员请求。
     * @returns {void}
     */
    handleAddMemberToGroupDetails: function () {
        const state = Store.getState();
        const groupId = state.currentChatId;
        if (!this.contactsDropdownDetailsEl) return;
        const memberId = this.contactsDropdownDetailsEl.value;
        const memberName = this.contactsDropdownDetailsEl.selectedOptions[0]?.text.replace(/\s*\(AI助手\)$/, '').trim();
        if (groupId && memberId) {
            ActionCreators.addGroupMemberRequest({ groupId, memberId, memberName });
            if (this.contactsDropdownDetailsEl) this.contactsDropdownDetailsEl.value = "";
        } else {
            NotificationUIManager.showNotification("请选择要添加的联系人。", "warning");
        }
    },

    /**
     * 绑定模块内的所有事件监听器
     * @function bindEvents
     * @description 统一管理所有DOM事件的绑定，通过调用 ActionCreators 来派发意图。
     * @returns {void}
     * @private
     */
    bindEvents: function() {
        if (this.closeDetailsBtnMainEl) {
            this.closeDetailsBtnMainEl.addEventListener('click', () => Store.dispatch('HIDE_DETAILS_PANEL'));
        }
        if (this.addMemberBtnDetailsEl) {
            this.addMemberBtnDetailsEl.addEventListener('click', () => this.handleAddMemberToGroupDetails());
        }
        if (this.clearCurrentChatBtnDetailsEl) {
            this.clearCurrentChatBtnDetailsEl.addEventListener('click', () => ActionCreators.clearChatRequest());
        }
        // NOTE: 为所有可折叠区域绑定事件
        this._makeElementCollapsible(this.aiTtsConfigHeaderEl);
        this._makeElementCollapsible(this.ttsAttributionHeaderEl);
        this._makeElementCollapsible(this.groupMemberListHeaderEl);
        this._makeElementCollapsible(this.groupAiPromptsHeaderEl);
    },

    /**
     * 为指定的头部元素添加折叠/展开功能
     * @function _makeElementCollapsible
     * @description 点击 headerEl 会切换其父容器 `.collapsible-container` 的 `active` 类，以触发 CSS 动画。
     * @param {HTMLElement} headerEl - 作为折叠触发器的头部元素。
     * @returns {void}
     * @private
     */
    _makeElementCollapsible: function(headerEl) {
        if (!headerEl) return;
        // NOTE: 使用 parentElement 而非 closest 是为了确保只作用于直接父级，避免嵌套折叠项的冲突。
        const containerEl = headerEl.parentElement;
        if (!containerEl || !containerEl.classList.contains('collapsible-container')) {
            console.warn('Collapsible header is not a direct child of a .collapsible-container. Animation may not work.', headerEl);
            // Fallback for non-standard structure
            headerEl.addEventListener('click', function(e) {
                e.stopPropagation();
                this.classList.toggle('active');
                const content = this.nextElementSibling;
                if(content && content.classList.contains('collapsible-content')){
                    if (content.style.display === 'none' || !content.style.display) {
                        content.style.display = 'grid';
                    } else {
                        content.style.display = 'none';
                    }
                }
            });
            return;
        }
        headerEl.addEventListener('click', function(event) {
            event.stopPropagation();
            containerEl.classList.toggle('active');
            headerEl.classList.toggle('active');
        });
    },

    /**
     * 根据联系人信息更新详情面板
     * @function _updateForContact
     * @description 填充联系人的基本信息、操作按钮和 AI 相关的特定配置。
     * @param {string} contactId - 要显示的联系人ID。
     * @returns {void}
     * @private
     */
    _updateForContact: function(contactId) {
        // ... (内部渲染逻辑保持不变)
        const contact = UserManager.contacts[contactId];
        if (!contact || !this.detailsPanelEl) return;
        // 渲染流程：
        // 1. 设置标题和面板的 CSS 类
        if (this.detailsPanelTitleEl) this.detailsPanelTitleEl.textContent = `${contact.name} 信息`;
        this.detailsPanelEl.classList.add('contact-details-active');
        if (UserManager.isSpecialContactInCurrentTheme(contactId)) {
            this.detailsPanelEl.classList.add(contact.id);
        } else if (contact.isAI) {
            this.detailsPanelEl.classList.add('historical-ai-contact-active');
        } else {
            this.detailsPanelEl.classList.add('human-contact-active');
        }
        // 2. 填充基本信息：名称、ID、头像、状态
        if (this.detailsNameEl) this.detailsNameEl.textContent = contact.name;
        if (this.detailsIdEl) this.detailsIdEl.textContent = `ID: ${contact.id}`;
        if (this.detailsAvatarEl) {
            this.detailsAvatarEl.className = 'details-avatar';
            let fallbackText = (contact.avatarText) ? Utils.escapeHtml(contact.avatarText) :
                (contact.name && contact.name.length > 0) ? Utils.escapeHtml(contact.name.charAt(0).toUpperCase()) : '?';
            let avatarContentHtml;
            if (UserManager.isSpecialContactInCurrentTheme(contactId)) {
                this.detailsAvatarEl.classList.add('special-avatar', contact.id);
            } else if (contact.isAI) {
                this.detailsAvatarEl.classList.add('historical-ai-avatar');
            }
            if (contact.avatarUrl) {
                avatarContentHtml = `<img src="${contact.avatarUrl}" alt="${fallbackText}" class="avatar-image" data-fallback-text="${fallbackText}" data-entity-id="${contact.id}">`;
            } else {
                avatarContentHtml = fallbackText;
            }
            this.detailsAvatarEl.innerHTML = avatarContentHtml;
        }
        if (this.detailsStatusEl) {
            if (UserManager.isSpecialContact(contactId)) {
                this.detailsStatusEl.textContent = (contact.isAI ? 'AI 助手' : '特殊联系人') ;
            } else {
                this.detailsStatusEl.textContent = ConnectionManager.isConnectedTo(contactId) ? '已连接' : '离线';
            }
        }
        // 3. 根据联系人类型（特殊/普通/AI）显示或隐藏不同的功能区域
        if (UserManager.isSpecialContact(contactId)) {
            if (this.contactActionsDetailsEl) this.contactActionsDetailsEl.style.display = 'none';
            if (contact.isAI && contact.aboutDetails && this.aiContactAboutSectionEl) {
                this._populateAiAboutSection(contact);
                this.aiContactAboutSectionEl.style.display = 'block';
            }
            if (contact.isAI && this.aiTtsConfigSectionEl) {
                this._setupAiTtsConfigSection(contact);
                this.aiTtsConfigSectionEl.style.display = 'grid';
            }
            if (contact.isAI && this.aiChapterSectionEl) {
                this._renderChapterSelector(contactId, contact);
            } else if (this.aiChapterSectionEl) {
                this.aiChapterSectionEl.style.display = 'none';
            }
            if (contact.isAI && this.memoryBookSectionEl) {
                this._renderMemoryBookSection(contactId);
                this.memoryBookSectionEl.style.display = 'block';
            }

        } else {
            if (this.contactActionsDetailsEl) this.contactActionsDetailsEl.style.display = 'block';
            if (this.deleteContactBtnDetailsEl) {
                // NOTE: 克隆并替换按钮以移除旧的事件监听器，确保每次只绑定一个事件。
                const newBtn = this.deleteContactBtnDetailsEl.cloneNode(true);
                this.deleteContactBtnDetailsEl.parentNode.replaceChild(newBtn, this.deleteContactBtnDetailsEl);
                this.deleteContactBtnDetailsEl = newBtn;
                this.deleteContactBtnDetailsEl.addEventListener('click', () => {
                    ActionCreators.deleteContactRequest({ contactId });
                });
            }
            if (this.aiTtsConfigSectionEl) this.aiTtsConfigSectionEl.style.display = 'none';
            if (this.aiContactAboutSectionEl) this.aiContactAboutSectionEl.style.display = 'none';
            if (this.aiChapterSectionEl) this.aiChapterSectionEl.style.display = 'none';
        }
        // 4. 隐藏群组相关区域
        if (this.groupAiPromptsSectionEl) this.groupAiPromptsSectionEl.style.display = 'none';
        if (this.detailsGroupManagementEl) this.detailsGroupManagementEl.style.display = 'none';
    },

    /**
     * 根据群组信息更新详情面板
     * @function _updateForGroup
     * @description 填充群组的基本信息、成员列表、管理操作和群内 AI 特定配置。
     * @param {string} groupId - 要显示的群组ID。
     * @returns {void}
     * @private
     */
    _updateForGroup: function(groupId) {
        const group = GroupManager.groups[groupId];
        if (!group || !this.detailsPanelEl) return;

        // 渲染流程：
        // 1. 设置标题、CSS 类，并清理之前联系人详情可能添加的特定类
        if (this.detailsPanelTitleEl) this.detailsPanelTitleEl.textContent = `${group.name} 信息`;
        this.detailsPanelEl.classList.add('group-chat-active');
        Array.from(this.detailsPanelEl.classList).forEach(cls => {
            if (cls.startsWith('AI_') || cls.endsWith('-active')) {
                if (cls !== 'group-chat-active' && cls !== 'contact-details-active') {
                    this.detailsPanelEl.classList.remove(cls);
                }
            }
        });

        // 2. 填充基本信息：名称、ID、头像、成员数量
        if (this.detailsNameEl) this.detailsNameEl.textContent = group.name;
        if (this.detailsIdEl) this.detailsIdEl.textContent = `群组 ID: ${group.id.substring(6)}`;
        if (this.detailsAvatarEl) {
            this.detailsAvatarEl.innerHTML = '👥';
            this.detailsAvatarEl.className = 'details-avatar group';
        }
        if (this.detailsStatusEl) this.detailsStatusEl.textContent = `${group.members.length} 名成员 (上限 ${AppSettings.group.maxMembers})`;

        // 3. 显示群组管理和操作区域
        if (this.detailsGroupManagementEl) {
            this.detailsGroupManagementEl.style.display = 'grid';
        }
        if (this.groupActionsDetailsEl) this.groupActionsDetailsEl.style.display = 'block';

        // 4. 根据用户是否为群主，显示不同的管理功能（如添加成员、解散群组）
        const isOwner = group.owner === UserManager.userId;
        if (this.addGroupMemberAreaEl) this.addGroupMemberAreaEl.style.display = isOwner ? 'block' : 'none';
        if (this.leftMembersAreaEl) this.leftMembersAreaEl.style.display = isOwner && group.leftMembers && group.leftMembers.length > 0 ? 'block' : 'none';

        // 5. 绑定离开或解散群组按钮的事件
        if (this.leaveGroupBtnDetailsEl) {
            this.leaveGroupBtnDetailsEl.style.display = isOwner ? 'none' : 'block';
            if(!isOwner) {
                const newBtn = this.leaveGroupBtnDetailsEl.cloneNode(true);
                this.leaveGroupBtnDetailsEl.parentNode.replaceChild(newBtn, this.leaveGroupBtnDetailsEl);
                this.leaveGroupBtnDetailsEl = newBtn;
                this.leaveGroupBtnDetailsEl.addEventListener('click', () => {
                    ActionCreators.leaveGroupRequest({ groupId });
                });
            }
        }
        if (this.dissolveGroupBtnDetailsEl) {
            this.dissolveGroupBtnDetailsEl.style.display = isOwner ? 'block' : 'none';
            if(isOwner) {
                const newBtn = this.dissolveGroupBtnDetailsEl.cloneNode(true);
                this.dissolveGroupBtnDetailsEl.parentNode.replaceChild(newBtn, this.dissolveGroupBtnDetailsEl);
                this.dissolveGroupBtnDetailsEl = newBtn;
                this.dissolveGroupBtnDetailsEl.addEventListener('click', () => {
                    ActionCreators.dissolveGroupRequest({ groupId });
                });
            }
        }

        // 6. 更新成员列表
        this.updateDetailsPanelMembers(groupId);

        // 7. 如果是群主且群内有 AI，显示 AI 行为指示编辑器
        if (this.groupAiPromptsSectionEl && isOwner) {
            const aiMembersInGroup = group.members.filter(memberId => UserManager.contacts[memberId]?.isAI);
            if (aiMembersInGroup.length > 0) {
                this.groupAiPromptsSectionEl.style.display = 'grid';
                if(this.groupAiPromptsHeaderEl) this.groupAiPromptsHeaderEl.style.display = 'flex';
                this._populateGroupAiPromptsEditor(groupId, group, aiMembersInGroup);
            } else {
                this.groupAiPromptsSectionEl.style.display = 'none';
            }
        } else if (this.groupAiPromptsSectionEl) {
            this.groupAiPromptsSectionEl.style.display = 'none';
        }

        // 8. 隐藏所有联系人专属的区域
        if (this.aiContactAboutSectionEl) this.aiContactAboutSectionEl.style.display = 'none';
        if (this.aiTtsConfigSectionEl) this.aiTtsConfigSectionEl.style.display = 'none';
        if (this.aiChapterSectionEl) this.aiChapterSectionEl.style.display = 'none';

        // 9. 确保资源预览模块在底部
        if (this.resourcePreviewSectionEl && this.detailsPanelContentEl && this.detailsPanelContentEl.lastChild !== this.resourcePreviewSectionEl) {
            this.detailsPanelContentEl.appendChild(this.resourcePreviewSectionEl);
        }

        // 10. 如果当前正在查看此群组详情，启动定时刷新任务
        const state = Store.getState();
        if (state.currentChatId === groupId && state.isDetailsPanelVisible && state.detailsPanelContent === 'details') {
            this._startGroupMemberRefreshTimer();
        }
    },

    /**
     * 更新记忆书UI中的特定条目
     * @function _updateMemoryBookUI
     * @description 当记忆书内容更新时，局部更新对应的文本域并移除加载状态。
     * @param {string} setId - 记忆书集合的ID。
     * @param {string} chatId - 关联的聊天ID。
     * @param {string} content - 新的记忆内容。
     * @returns {void}
     * @private
     */
    _updateMemoryBookUI: function(setId, chatId, content) {
        if (chatId !== this.currentChatId) return;
        const setItem = this.memoryBookListEl.querySelector(`.memory-set-item[data-set-id="${setId}"]`);
        if (setItem) {
            const textarea = setItem.querySelector('.js-memory-textarea');
            if (textarea) textarea.value = content;
            this._setMemoryBookLoadingState(setId, chatId, false);
        }
    },

    /**
     * 设置记忆书条目的加载状态
     * @function _setMemoryBookLoadingState
     * @description 控制“记录”按钮的禁用状态和文本，以向用户展示正在生成记忆。
     * @param {string} setId - 记忆书集合的ID。
     * @param {string} chatId - 关联的聊天ID。
     * @param {boolean} isLoading - 是否处于加载状态。
     * @returns {void}
     * @private
     */
    _setMemoryBookLoadingState: function(setId, chatId, isLoading) {
        if (chatId !== this.currentChatId) return;
        const setItem = this.memoryBookListEl.querySelector(`.memory-set-item[data-set-id="${setId}"]`);
        if (setItem) {
            const recordBtn = setItem.querySelector('.js-record-btn');
            if (recordBtn) {
                recordBtn.disabled = isLoading;
                recordBtn.textContent = isLoading ? '记录中...' : '记录';
            }
        }
    },

    /**
     * 渲染与当前 AI 角色关联的记忆书区域
     * @function _renderMemoryBookSection
     * @description 根据 MemoryBookManager 提供的数据，动态生成记忆书的编辑界面。
     * @param {string} chatId - 当前 AI 角色的ID。
     * @returns {void}
     * @private
     */
    _renderMemoryBookSection: function(chatId) {
        // ... (内部渲染逻辑保持不变)
        if (!this.memoryBookListEl || !chatId) {
            if (this.memoryBookListEl) this.memoryBookListEl.innerHTML = '';
            return;
        }
        this.memoryBookListEl.innerHTML = '';
        const elementSets = MemoryBookManager.getElementSets();
        const template = document.getElementById('memory-set-item-details-template');

        if (!template) {
            Utils.log("DetailsPanelUIManager: memory-set-item-details-template 未找到。", Utils.logLevels.ERROR);
            return;
        }

        if (elementSets.length === 0) {
            this.memoryBookListEl.innerHTML = `<p style="font-size: 0.9em; color: var(--text-color-light); text-align: center;">请先在“交互管理”菜单的“记忆书”标签页中添加要记忆书。</p>`;
            return;
        }

        elementSets.forEach(set => {
            const clone = template.content.cloneNode(true);
            const setContainer = clone.querySelector('.memory-set-item');
            const nameEl = clone.querySelector('.js-set-name');
            const recordBtn = clone.querySelector('.js-record-btn');
            const textareaEl = clone.querySelector('.js-memory-textarea');
            const enableToggle = clone.querySelector('.js-enable-toggle');
            const saveBtn = clone.querySelector('.js-save-btn');
            const labelEl = clone.querySelector('label');

            setContainer.dataset.setId = set.id;
            nameEl.textContent = Utils.escapeHtml(set.name);

            const bookContent = set.books?.[chatId]?.content || '尚未记录。';
            const isEnabled = set.books?.[chatId]?.enabled || false;
            // NOTE: 确保每个复选框的 ID 是唯一的，以避免多个复选框联动的问题。
            const checkboxId = `enable-memory-book-checkbox-${set.id}-${chatId}`;

            textareaEl.value = bookContent;
            enableToggle.checked = isEnabled;
            enableToggle.id = checkboxId;
            if (labelEl) labelEl.htmlFor = checkboxId;

            recordBtn.addEventListener('click', () => MemoryBookManager.generateMemoryBook(set.id, chatId));
            enableToggle.addEventListener('change', (e) => MemoryBookManager.setMemoryBookEnabled(set.id, chatId, e.target.checked));
            saveBtn.addEventListener('click', () => MemoryBookManager.saveMemoryBookContent(set.id, chatId, textareaEl.value));

            this.memoryBookListEl.appendChild(clone);
        });
    },

    /**
     * 尝试刷新群成员视图
     * @function _tryRefreshGroupMembersView
     * @description 在连接状态变化时，检查当前是否正在查看该群组的详情，如果是则刷新成员列表。
     * @param {string} peerId - 连接状态发生变化的对方ID。
     * @returns {void}
     * @private
     */
    _tryRefreshGroupMembersView: function(peerId) {
        const state = Store.getState();
        if (state.detailsPanelContent === 'details' && state.currentChatId && state.currentChatId.startsWith('group_')) {
            const group = GroupManager.groups[state.currentChatId];
            if (group && group.members.includes(peerId)) {
                Utils.log(`DetailsPanelUIManager: 检测到群成员 ${peerId} 连接状态变化，刷新成员列表。`, Utils.logLevels.DEBUG);
                this.updateDetailsPanelMembers(state.currentChatId);
            }
        }
    },

    /**
     * 设置详情面板的可见性
     * @function _setPanelVisibility
     * @description 控制详情面板的显示与隐藏，并管理相关内容的切换和定时器的启停。
     * @param {boolean} show - 是否显示面板。
     * @param {string|null} [viewType=null] - 面板显示的内容类型 ('details' 或 'lobby')。
     * @returns {void}
     * @private
     */
    _setPanelVisibility: function(show, viewType = null) {
        const appContainer = document.querySelector('.app-container');
        // 1. 先隐藏所有内容区域
        if (this.detailsPanelContentEl) this.detailsPanelContentEl.style.display = 'none';
        if (this.peopleLobbyContentEl) this.peopleLobbyContentEl.style.display = 'none';

        // 2. 如果面板将要隐藏，或者显示的是非群组内容，则移除群成员刷新定时器
        const state = Store.getState();
        const chatId = state.currentChatId;
        if (!show || (show && viewType === 'details' && !(chatId && chatId.startsWith('group_'))) || (show && viewType === 'lobby') ) {
            if (typeof TimerManager !== 'undefined') {
                TimerManager.removePeriodicTask(this._GROUP_MEMBER_REFRESH_TASK_NAME);
            }
        }

        // 3. 根据 show 和 viewType 控制面板和内容的显示
        if (show) {
            if (appContainer) appContainer.classList.add('show-details');
            if (viewType === 'details' && this.detailsPanelContentEl) {
                this.detailsPanelContentEl.style.display = 'block';
                if (this.resourcePreviewSectionEl && chatId) {
                    ResourcePreviewUIManager.loadResourcesForChat(chatId);
                }
                if (chatId && chatId.startsWith('group_')) {
                    this._startGroupMemberRefreshTimer();
                }
            } else if (viewType === 'lobby' && this.peopleLobbyContentEl) {
                this.peopleLobbyContentEl.style.display = 'flex';
                if (this.resourcePreviewSectionEl) this.resourcePreviewSectionEl.style.display = 'none';
                ResourcePreviewUIManager.hide();
            }
        } else {
            if (appContainer) appContainer.classList.remove('show-details');
            ResourcePreviewUIManager.hide();
        }
    },

    /**
     * 创建一个可搜索的 AI 词汇篇章（Chapter）下拉选择器
     * @function _createSearchableChapterSelect
     * @description 动态生成一个包含搜索输入框和选项列表的自定义组件。
     * @param {string} contactId - AI 联系人的 ID。
     * @param {object} contactData - AI 联系人的数据对象。
     * @param {HTMLElement} targetDiv - 用于承载该选择器的容器元素。
     * @returns {void}
     * @private
     */
    _createSearchableChapterSelect: function(contactId, contactData, targetDiv) {
        // ... (内部渲染逻辑保持不变)
        targetDiv.innerHTML = '';
        const container = document.createElement('div');
        container.className = 'details-searchable-select';
        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'details-searchable-select-input';
        input.placeholder = '搜索或选择关卡...';
        input.id = 'aiChapterSelectInput';
        const optionsContainer = document.createElement('div');
        optionsContainer.className = 'details-searchable-select-options-container';
        optionsContainer.style.display = 'none';
        container.appendChild(input);
        container.appendChild(optionsContainer);
        targetDiv.appendChild(container);
        const chapters = [{ id: "", name: "默认行为" }, ...contactData.chapters];
        let highlightedOptionIndex = -1;
        const updateSelected = (chapter) => {
            input.value = chapter.name;
            input.dataset.selectedValue = chapter.id;
            optionsContainer.style.display = 'none';
            UserManager.setSelectedChapterForAI(contactId, chapter.id === "" ? null : chapter.id);
            if (typeof EventEmitter !== 'undefined') {
                EventEmitter.emit('aiChapterSelected', {
                    contactId: contactId,
                    chapterId: chapter.id === "" ? null : chapter.id
                });
            }
            input.style.backgroundImage = `url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="%23757575" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>')`;
        };
        const scrollOptionIntoView = (optionElement) => {
            if (optionElement) {
                optionElement.scrollIntoView({ block: 'nearest', inline: 'nearest' });
            }
        };
        const populateOptions = (filter = "") => {
            optionsContainer.innerHTML = '';
            highlightedOptionIndex = -1;
            const lowerFilter = filter.toLowerCase();
            const filteredChapters = chapters.filter(ch => ch.name.toLowerCase().includes(lowerFilter));
            if (filteredChapters.length === 0) {
                const noResultsOption = document.createElement('div');
                noResultsOption.className = 'details-searchable-select-option no-results';
                noResultsOption.textContent = '无匹配结果';
                optionsContainer.appendChild(noResultsOption);
                return;
            }
            filteredChapters.forEach((chapter) => {
                const optionDiv = document.createElement('div');
                optionDiv.className = 'details-searchable-select-option';
                optionDiv.textContent = chapter.name;
                optionDiv.dataset.value = chapter.id;
                optionDiv.addEventListener('mousedown', (e) => {
                    e.preventDefault();
                    updateSelected(chapter);
                });
                optionsContainer.appendChild(optionDiv);
            });
        };
        const currentChapterId = UserManager.getSelectedChapterForAI(contactId);
        const currentChapter = chapters.find(ch => ch.id === (currentChapterId || ""));
        if (currentChapter) {
            input.value = currentChapter.name;
            input.dataset.selectedValue = currentChapter.id;
        } else {
            input.value = "默认行为";
            input.dataset.selectedValue = "";
        }
        input.addEventListener('focus', () => {
            const preSelectedChapter = chapters.find(ch => ch.id === input.dataset.selectedValue);
            if (input.value === "" || (preSelectedChapter && input.value === preSelectedChapter.name)) {
                populateOptions("");
            } else {
                populateOptions(input.value);
            }
            optionsContainer.style.display = 'block';
            input.style.backgroundImage = `url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="%230088CC" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 15 12 9 18 15"></polyline></svg>')`;
        });
        input.addEventListener('input', () => {
            populateOptions(input.value);
            optionsContainer.style.display = 'block';
        });
        input.addEventListener('keydown', (e) => {
            const options = Array.from(optionsContainer.querySelectorAll('.details-searchable-select-option:not(.no-results)'));
            if (!options.length) return;
            if (e.key === 'ArrowDown') {
                e.preventDefault();
                if (highlightedOptionIndex < options.length - 1) highlightedOptionIndex++;
                else highlightedOptionIndex = 0;
            } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                if (highlightedOptionIndex > 0) highlightedOptionIndex--;
                else highlightedOptionIndex = options.length - 1;
            } else if (e.key === 'Enter') {
                e.preventDefault();
                if (highlightedOptionIndex !== -1 && options[highlightedOptionIndex]) {
                    const selectedChapterData = chapters.find(ch => ch.id === options[highlightedOptionIndex].dataset.value);
                    if (selectedChapterData) updateSelected(selectedChapterData);
                } else if (options.length === 1 && options[0].dataset.value) {
                    const selectedChapterData = chapters.find(ch => ch.id === options[0].dataset.value);
                    if (selectedChapterData) updateSelected(selectedChapterData);
                }
                optionsContainer.style.display = 'none';
                return;
            } else if (e.key === 'Escape') {
                optionsContainer.style.display = 'none';
                input.blur();
                return;
            } else {
                return;
            }
            options.forEach((opt, i) => opt.classList.toggle('highlighted', i === highlightedOptionIndex));
            if (options[highlightedOptionIndex]) {
                scrollOptionIntoView(options[highlightedOptionIndex]);
            }
        });
        input.addEventListener('blur', () => {
            setTimeout(() => {
                if (optionsContainer.style.display !== 'none' && !container.contains(document.activeElement)) {
                    optionsContainer.style.display = 'none';
                }
                const lastConfirmedSelection = chapters.find(ch => ch.id === input.dataset.selectedValue);
                if (lastConfirmedSelection && input.value !== lastConfirmedSelection.name) {
                    input.value = lastConfirmedSelection.name;
                } else if (!lastConfirmedSelection && input.dataset.selectedValue === "") {
                    input.value = "默认行为";
                }
                if (optionsContainer.style.display === 'none') {
                    input.style.backgroundImage = `url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="%23757575" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>')`;
                }
            }, 150);
        });
    },

    /**
     * 渲染 AI 词汇篇章（Chapter）选择器区域
     * @function _renderChapterSelector
     * @description 决定是否为 AI 联系人显示词汇篇章选择器，并调用 `_createSearchableChapterSelect` 来生成它。
     * @param {string} contactId - AI 联系人的 ID。
     * @param {object} contactData - AI 联系人的数据对象。
     * @returns {void}
     * @private
     */
    _renderChapterSelector: function(contactId, contactData) {
        if (!this.aiChapterSectionEl) {
            Utils.log("DetailsPanelUIManager: aiChapterSectionEl 未找到。", Utils.logLevels.ERROR);
            return;
        }
        const selectContainer = this.aiChapterSectionEl.querySelector('#aiChapterSelectContainer');
        if (!selectContainer) {
            Utils.log("DetailsPanelUIManager: aiChapterSelectContainer 未找到。", Utils.logLevels.ERROR);
            this.aiChapterSectionEl.style.display = 'none';
            return;
        }
        if (contactData.isAI && contactData.chapters && contactData.chapters.length > 0) {
            this._createSearchableChapterSelect(contactId, contactData, selectContainer);
            this.aiChapterSectionEl.style.display = 'block';
        } else {
            selectContainer.innerHTML = '';
            this.aiChapterSectionEl.style.display = 'none';
        }
    },

    /**
     * 填充 AI 联系人的“关于”信息区域
     * @function _populateAiAboutSection
     * @description 将 AI 联系人的详细信息填充到对应的 DOM 元素中。
     * @param {object} contact - AI 联系人对象。
     * @returns {void}
     * @private
     */
    _populateAiAboutSection: function(contact) {
        if (this.aiContactAboutNameEl) this.aiContactAboutNameEl.textContent = contact.aboutDetails.nameForAbout || contact.name;
        if (this.aiContactAboutNameSubEl) this.aiContactAboutNameSubEl.textContent = contact.aboutDetails.nameForAbout || contact.name;
        if (this.aiContactBasicInfoListEl) {
            this.aiContactBasicInfoListEl.innerHTML = '';
            contact.aboutDetails.basicInfo.forEach(info => {
                const li = document.createElement('li');
                li.innerHTML = `<strong>${Utils.escapeHtml(info.label)}:</strong> ${Utils.escapeHtml(info.value)}`;
                this.aiContactBasicInfoListEl.appendChild(li);
            });
        }
        if (this.aiContactAboutTextEl) this.aiContactAboutTextEl.textContent = contact.aboutDetails.aboutText;
    },

    /**
     * 设置 AI 的 TTS（语音合成）配置区域
     * @function _setupAiTtsConfigSection
     * @description 委托 TtsUIManager 来填充配置表单，并绑定保存按钮的事件。
     * @param {object} contact - AI 联系人对象。
     * @returns {void}
     * @private
     */
    _setupAiTtsConfigSection: function(contact) {
        const formContainerId = 'ttsConfigFormContainer';
        TtsUIManager.populateAiTtsConfigurationForm(contact, formContainerId);
        if (this.saveAiTtsSettingsBtnDetailsEl) {
            // NOTE: 先移除旧监听器，再绑定新监听器，防止内存泄漏和重复调用
            if (TtsUIManager._boundSaveTtsListener) {
                this.saveAiTtsSettingsBtnDetailsEl.removeEventListener('click', TtsUIManager._boundSaveTtsListener);
            }
            TtsUIManager._boundSaveTtsListener = TtsUIManager.handleSaveAiTtsSettings.bind(TtsUIManager, contact.id);
            this.saveAiTtsSettingsBtnDetailsEl.addEventListener('click', TtsUIManager._boundSaveTtsListener);
        }
    },

    /**
     * 填充群内 AI 行为指示（Prompts）的编辑器
     * @function _populateGroupAiPromptsEditor
     * @description 为群内的每个 AI 角色动态创建独立的 prompt 编辑器。
     * @param {string} groupId - 群组ID。
     * @param {object} group - 群组对象。
     * @param {string[]} aiMemberIds - 群内所有 AI 成员的 ID 列表。
     * @returns {void}
     * @private
     */
    _populateGroupAiPromptsEditor: function(groupId, group, aiMemberIds) {
        if (!this.groupAiPromptsListContainerEl) return;
        this.groupAiPromptsListContainerEl.innerHTML = '';
        const template = document.getElementById('group-ai-prompt-editor-template');
        if (!template) {
            Utils.log("DetailsPanelUIManager: group-ai-prompt-editor-template 未找到。", Utils.logLevels.ERROR);
            return;
        }

        aiMemberIds.forEach(aiId => {
            // ... (内部渲染逻辑保持不变)
            const aiContact = UserManager.contacts[aiId];
            if (!aiContact || !aiContact.isAI) return;

            const clone = template.content.cloneNode(true);
            const itemDiv = clone.querySelector('.ai-prompt-editor-item');
            const nameHeader = clone.querySelector('.js-ai-name-header');
            const promptTextarea = clone.querySelector('.js-prompt-textarea');
            const saveBtn = clone.querySelector('.js-save-prompt-btn');
            const resetBtn = clone.querySelector('.js-reset-prompt-btn');

            itemDiv.dataset.aiId = aiId;
            nameHeader.textContent = `AI角色: ${aiContact.name}`;

            let currentPromptText = "";
            if (group.aiPrompts && group.aiPrompts[aiId] !== undefined) {
                currentPromptText = group.aiPrompts[aiId];
            } else if (aiContact.aiConfig && aiContact.aiConfig.systemPrompt !== undefined) {
                currentPromptText = aiContact.aiConfig.systemPrompt;
            }
            promptTextarea.value = currentPromptText;

            saveBtn.addEventListener('click', async () => {
                const newPrompt = promptTextarea.value.trim();
                let promptChanged = false;
                if (!group.aiPrompts) group.aiPrompts = {};
                if ((group.aiPrompts[aiId] === undefined && newPrompt !== "") ||
                    (group.aiPrompts[aiId] !== undefined && group.aiPrompts[aiId] !== newPrompt)) {
                    group.aiPrompts[aiId] = newPrompt;
                    promptChanged = true;
                }
                if (promptChanged) {
                    await GroupManager.saveGroup(groupId);
                    if (typeof GroupManager.notifyAiPromptChanged === 'function') {
                        GroupManager.notifyAiPromptChanged(groupId, aiId, newPrompt);
                    }
                    NotificationUIManager.showNotification(`AI "${aiContact.name}" 在此群组的行为指示已更新。`, 'success');
                } else {
                    NotificationUIManager.showNotification('行为指示未发生变化。', 'info');
                }
            });

            resetBtn.addEventListener('click', async () => {
                const defaultPrompt = (aiContact.aiConfig && aiContact.aiConfig.systemPrompt) ? aiContact.aiConfig.systemPrompt : "";
                let promptChanged = false;
                if (group.aiPrompts && group.aiPrompts[aiId] !== undefined && group.aiPrompts[aiId] !== defaultPrompt) {
                    group.aiPrompts[aiId] = defaultPrompt;
                    promptChanged = true;
                } else if (group.aiPrompts && group.aiPrompts[aiId] !== undefined && defaultPrompt === "" && group.aiPrompts[aiId] !== "") {
                    delete group.aiPrompts[aiId];
                    promptChanged = true;
                }
                promptTextarea.value = defaultPrompt;
                if (promptChanged) {
                    await GroupManager.saveGroup(groupId);
                    if (typeof GroupManager.notifyAiPromptChanged === 'function') {
                        GroupManager.notifyAiPromptChanged(groupId, aiId, defaultPrompt);
                    }
                    NotificationUIManager.showNotification(`AI "${aiContact.name}" 在此群组的行为指示已重置为默认。`, 'success');
                } else {
                    NotificationUIManager.showNotification(`AI "${aiContact.name}" 已在使用默认指示或无变化。`, 'info');
                }
            });

            this.groupAiPromptsListContainerEl.appendChild(clone);
        });
    },

    /**
     * 启动群组成员状态的周期性刷新定时器
     * @function _startGroupMemberRefreshTimer
     * @description 使用 TimerManager 添加一个周期性任务，用于刷新群成员状态和尝试自动连接。
     * @returns {void}
     * @private
     */
    _startGroupMemberRefreshTimer: function() {
        if (typeof TimerManager !== 'undefined') {
            TimerManager.removePeriodicTask(this._GROUP_MEMBER_REFRESH_TASK_NAME);
            TimerManager.addPeriodicTask(
                this._GROUP_MEMBER_REFRESH_TASK_NAME,
                this._refreshGroupMembersAndAutoConnect.bind(this),
                AppSettings.timers.groupMemberRefresh
            );
        } else {
            Utils.log("DetailsPanelUIManager: TimerManager 未定义，无法启动群成员刷新定时器。", Utils.logLevels.ERROR);
        }
    },

    /**
     * 刷新群成员状态并尝试自动连接
     * @function _refreshGroupMembersAndAutoConnect
     * @description 定时任务的具体执行内容：获取最新在线用户，更新成员列表，并对在线但未连接的成员发起静默连接请求。
     * @returns {void}
     * @private
     */
    _refreshGroupMembersAndAutoConnect: async function() {
        const state = Store.getState();
        const groupId = state.currentChatId;

        // 1. 校验当前是否仍在查看群组详情，否则停止任务
        if (!groupId || !groupId.startsWith('group_')) {
            if (typeof TimerManager !== 'undefined') TimerManager.removePeriodicTask(this._GROUP_MEMBER_REFRESH_TASK_NAME);
            return;
        }
        const group = GroupManager.groups[groupId];
        if (!group) {
            if (typeof TimerManager !== 'undefined') TimerManager.removePeriodicTask(this._GROUP_MEMBER_REFRESH_TASK_NAME);
            return;
        }
        const currentState = Store.getState();
        if (!currentState.isDetailsPanelVisible || currentState.detailsPanelContent !== 'details') {
            if (typeof TimerManager !== 'undefined') TimerManager.removePeriodicTask(this._GROUP_MEMBER_REFRESH_TASK_NAME);
            return;
        }

        // 2. 获取最新的在线用户列表
        if (PeopleLobbyManager && typeof PeopleLobbyManager.fetchOnlineUsers === 'function') {
            await PeopleLobbyManager.fetchOnlineUsers(true);
        }

        // 3. 更新成员列表UI
        this.updateDetailsPanelMembers(groupId);
        Utils.log(`DetailsPanelUIManager: 定时刷新群成员 (${groupId}) 状态。`, Utils.logLevels.DEBUG);

        // 4. 遍历成员，对在线但未连接的成员发起自动重连
        group.members.forEach(memberId => {
            if (memberId === UserManager.userId || (UserManager.contacts[memberId] && UserManager.contacts[memberId].isAI)) {
                return;
            }
            const isConnected = ConnectionManager.isConnectedTo(memberId);
            const isOnline = PeopleLobbyManager.onlineUserIds ? PeopleLobbyManager.onlineUserIds.includes(memberId) : false;
            if (isOnline && !isConnected) {
                Utils.log(`DetailsPanelUIManager: 自动尝试连接到群成员 ${memberId} (在线但未连接)。`, Utils.logLevels.INFO);
                ConnectionManager.createOffer(memberId, { isSilent: true });
            }
        });
    },

    /**
     * 获取经过排序的群组成员列表
     * @function _getSortedMembers
     * @description 对群成员进行排序，以优化显示顺序。
     * @param {object} group - 群组对象。
     * @returns {object[]} 排序后的成员对象数组。
     * @private
     */
    _getSortedMembers: function(group) {
        // 排序规则:
        // 1. 群主 (category 0)
        // 2. 在线的人类成员 (category 1)
        // 3. AI 成员 (category 2)
        // 4. 离线的人类成员 (category 3)
        // 在同一类别内，按名称字母顺序排序。
        return group.members.map(memberId => {
            const member = UserManager.contacts[memberId] || { id: memberId, name: `用户 ${memberId.substring(0, 4)}`, isAI: false };
            let sortCategory;
            const isOwner = memberId === group.owner;
            const isAI = member.isAI;
            const isOnline = !isAI && !isOwner && PeopleLobbyManager.onlineUserIds && PeopleLobbyManager.onlineUserIds.includes(memberId);
            if (isOwner) sortCategory = 0;
            else if (!isAI && isOnline) sortCategory = 1;
            else if (isAI) sortCategory = 2;
            else sortCategory = 3;
            return { ...member, id: memberId, sortCategory, isOnlineForSort: isOnline };
        }).sort((a, b) => {
            if (a.sortCategory !== b.sortCategory) {
                return a.sortCategory - b.sortCategory;
            }
            return (a.name || '').localeCompare(b.name || '', undefined, { sensitivity: 'base' });
        });
    },
};