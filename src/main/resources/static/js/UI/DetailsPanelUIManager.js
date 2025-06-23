/**
 * @file DetailsPanelUIManager.js
 * @description 管理应用右侧详情面板的 UI 元素和交互。此面板可以显示当前选定聊天的详细信息（包括联系人信息、群组成员、AI配置）或人员大厅。资源预览功能已移至 ResourcePreviewUIManager。
 *              新增: 群主可查看和编辑群内 AI 的特定提示词。
 *              优化: 当群主修改AI提示词后，会向群内发送系统消息通知。
 *              修复: 主题切换后，添加成员下拉列表现在能正确反映当前主题的AI角色。
 *              更新: 群组成员列表现在显示在线状态和与当前用户的连接状态，并提供重连按钮。
 *              新增: 定期自动刷新群成员状态，并对在线但未连接的成员尝试自动连接。 (定时器逻辑移至 TimerManager)
 *              优化：详情页的群成员顺序调整为：群主第一（无论在线状态），然后是在线人类成员，接着是AI成员，最后是离线人类成员。
 *              更新：群组详情页现在会显示资源预览模块，方便用户跳转到相关的媒体内容，该模块位于所有群组设置之后。
 *              更新：群组详情页的“群成员列表”和“群内AI行为指示”部分现在默认折叠，并可展开/收起。
 * @module DetailsPanelUIManager
 * @exports {object} DetailsPanelUIManager - 对外暴露的单例对象，包含管理右侧详情面板的所有方法。
 * @property {function} init - 初始化模块，获取DOM元素引用并绑定基础事件。
 * @property {function} showMainDetailsContent - 显示聊天详情视图。
 * @property {function} showPeopleLobbyContent - 显示人员大厅视图。
 * @property {function} toggleChatDetailsView - 切换聊天详情视图的显示/隐藏状态。
 * @property {function} togglePeopleLobbyView - 切换人员大厅视图的显示/隐藏状态。
 * @property {function} hideSidePanel - 隐藏整个右侧面板区域。
 * @property {function} updateDetailsPanel - 根据当前聊天ID和类型更新聊天详情面板的内容。
 * @property {function} updateDetailsPanelMembers - 更新群组详情中的成员列表和添加成员下拉框。
 * @property {function} handleAddMemberToGroupDetails - 处理从详情面板添加成员到当前群组的逻辑。
 * @dependencies UserManager, GroupManager, ChatManager, MessageManager, TtsUIManager, NotificationUIManager, Utils, ConnectionManager, PeopleLobbyManager, Config, LayoutUIManager, EventEmitter, DBManager, ResourcePreviewUIManager, TimerManager
 * @dependents AppInitializer (进行初始化), ChatAreaUIManager (通过按钮点击调用以切换面板显隐)
 */
const DetailsPanelUIManager = {
    isPanelAreaVisible: false,
    currentView: null,

    // DOM Element References
    detailsPanelEl: null,
    detailsPanelTitleEl: null,
    closeDetailsBtnMainEl: null,
    detailsPanelContentEl: null,
    detailsNameEl: null,
    detailsIdEl: null,
    detailsAvatarEl: null,
    detailsStatusEl: null,
    currentChatActionsDetailsEl: null,
    clearCurrentChatBtnDetailsEl: null,
    contactActionsDetailsEl: null,
    deleteContactBtnDetailsEl: null,
    aiContactAboutSectionEl: null,
    aiContactAboutNameEl: null,
    aiContactBasicInfoListEl: null,
    aiContactAboutNameSubEl: null,
    aiContactAboutTextEl: null,
    aiTtsConfigSectionEl: null,
    aiTtsConfigHeaderEl: null,
    aiTtsConfigContentEl: null,
    saveAiTtsSettingsBtnDetailsEl: null,
    ttsAttributionHeaderEl: null,
    ttsAttributionContentEl: null,
    detailsGroupManagementEl: null,
    groupMemberListHeaderEl: null,
    groupMemberListContainerEl: null,
    groupMemberListDetailsEl: null,
    groupMemberCountEl: null,
    addGroupMemberAreaEl: null,
    leftMembersAreaEl: null,
    contactsDropdownDetailsEl: null,
    addMemberBtnDetailsEl: null,
    groupAiPromptsSectionEl: null,
    groupAiPromptsHeaderEl: null,
    groupAiPromptsListContainerEl: null,
    groupActionsDetailsEl: null,
    leaveGroupBtnDetailsEl: null,
    dissolveGroupBtnDetailsEl: null,
    peopleLobbyContentEl: null,
    resourcePreviewSectionEl: null, // Still need this reference to show/hide the whole section

    // _groupMemberRefreshInterval: null, // Moved to TimerManager
    GROUP_MEMBER_REFRESH_INTERVAL_MS: 3000, // Interval value remains, used by TimerManager
    _GROUP_MEMBER_REFRESH_TASK_NAME: 'groupMemberStatusRefresh', // Unique name for the timer task

    /**
     * 初始化模块。
     */
    init: function() {
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

        this.bindEvents();

        EventEmitter.on('connectionEstablished', (peerId) => this._tryRefreshGroupMembersView(peerId));
        EventEmitter.on('connectionClosed', (peerId) => this._tryRefreshGroupMembersView(peerId));
        EventEmitter.on('connectionFailed', (peerId) => this._tryRefreshGroupMembersView(peerId));
        EventEmitter.on('onlineUsersUpdated', () => {
            if (this.currentView === 'details' && ChatManager.currentChatId && ChatManager.currentChatId.startsWith('group_')) {
                this.updateDetailsPanelMembers(ChatManager.currentChatId);
            }
        });
        Utils.log("DetailsPanelUIManager 初始化完成。", Utils.logLevels.INFO);
    },

    /**
     * 辅助函数，使元素可折叠。
     * @param {HTMLElement|null} headerEl - 点击的头部元素。
     * @param {HTMLElement|null} contentEl - 要折叠的内容元素。
     */
    _makeElementCollapsible: function(headerEl, contentEl) { // Keep this helper or move to Utils if not already there
        if (headerEl && contentEl) {
            Utils.makeElementCollapsible(headerEl, contentEl); // Delegate to Utils
        }
    },

    /**
     * 绑定事件监听器。
     */
    bindEvents: function() {
        if (this.closeDetailsBtnMainEl) {
            this.closeDetailsBtnMainEl.addEventListener('click', () => this.hideSidePanel());
        }
        if (this.addMemberBtnDetailsEl) {
            this.addMemberBtnDetailsEl.addEventListener('click', () => this.handleAddMemberToGroupDetails());
        }
        this._makeElementCollapsible(this.aiTtsConfigHeaderEl, this.aiTtsConfigContentEl);
        this._makeElementCollapsible(this.ttsAttributionHeaderEl, this.ttsAttributionContentEl);
        this._makeElementCollapsible(this.groupMemberListHeaderEl, this.groupMemberListContainerEl);
        this._makeElementCollapsible(this.groupAiPromptsHeaderEl, this.groupAiPromptsListContainerEl);
    },

    /**
     * @private
     * 尝试刷新群成员视图。
     */
    _tryRefreshGroupMembersView: function(peerId) {
        if (this.currentView === 'details' && ChatManager.currentChatId && ChatManager.currentChatId.startsWith('group_')) {
            const group = GroupManager.groups[ChatManager.currentChatId];
            if (group && group.members.includes(peerId)) {
                this.updateDetailsPanelMembers(ChatManager.currentChatId);
            }
        }
    },

    /**
     * @private
     * 设置详情面板的整体可见性及当前显示的视图类型。
     */
    _setPanelVisibility: function(show, viewType = null) {
        const appContainer = document.querySelector('.app-container');
        this.isPanelAreaVisible = show;

        if (this.detailsPanelContentEl) this.detailsPanelContentEl.style.display = 'none';
        if (this.peopleLobbyContentEl) this.peopleLobbyContentEl.style.display = 'none';
        // ResourcePreviewUIManager 将自行管理其内部元素的显隐

        // Stop timer if panel is hidden or view changes from group details
        if (!show || (show && viewType === 'details' && !(ChatManager.currentChatId && ChatManager.currentChatId.startsWith('group_'))) || (show && viewType === 'lobby') ) {
            if (typeof TimerManager !== 'undefined') {
                TimerManager.removePeriodicTask(this._GROUP_MEMBER_REFRESH_TASK_NAME);
            }
        }


        if (show) {
            if (this.detailsPanelEl) this.detailsPanelEl.style.display = 'flex';
            if (appContainer) appContainer.classList.add('show-details');

            if (viewType === 'details' && this.detailsPanelContentEl) {
                this.detailsPanelContentEl.style.display = 'block';
                if (this.resourcePreviewSectionEl && ChatManager.currentChatId) { // 确保有当前聊天
                    ResourcePreviewUIManager.loadResourcesForChat(ChatManager.currentChatId);
                }
                if (ChatManager.currentChatId && ChatManager.currentChatId.startsWith('group_')) {
                    this._startGroupMemberRefreshTimer(); // Start timer via TimerManager
                }
            } else if (viewType === 'lobby' && this.peopleLobbyContentEl) {
                this.peopleLobbyContentEl.style.display = 'flex';
                if (this.resourcePreviewSectionEl) this.resourcePreviewSectionEl.style.display = 'none'; // 大厅不显示资源预览
                ResourcePreviewUIManager.hide(); // 确保资源预览也隐藏
            }
            this.currentView = viewType;
        } else {
            if (this.detailsPanelEl) this.detailsPanelEl.style.display = 'none';
            if (appContainer) appContainer.classList.remove('show-details');
            this.currentView = null;
            ResourcePreviewUIManager.hide(); // 面板隐藏时，隐藏资源预览
        }
    },

    /**
     * 显示主详情内容区域。
     */
    showMainDetailsContent: function() {
        if (!ChatManager.currentChatId) {
            Utils.log("DetailsPanelUIManager: 无法显示详情，没有选中的聊天。", Utils.logLevels.INFO);
            this.hideSidePanel();
            return;
        }
        this.updateDetailsPanel(ChatManager.currentChatId, ChatManager.currentChatId.startsWith('group_') ? 'group' : 'contact');
        this._setPanelVisibility(true, 'details');
        Utils.log("DetailsPanelUIManager: 显示聊天详情视图。", Utils.logLevels.DEBUG);
    },

    /**
     * 显示人员大厅内容区域。
     */
    showPeopleLobbyContent: async function() {
        if (this.detailsPanelTitleEl) this.detailsPanelTitleEl.textContent = '人员大厅';
        if (this.resourcePreviewSectionEl) this.resourcePreviewSectionEl.style.display = 'none';
        if (this.groupAiPromptsSectionEl) this.groupAiPromptsSectionEl.style.display = 'none';
        if (this.detailsGroupManagementEl) this.detailsGroupManagementEl.style.display = 'none';
        if (PeopleLobbyManager) await PeopleLobbyManager.show();
        this._setPanelVisibility(true, 'lobby');
        Utils.log("DetailsPanelUIManager: 显示人员大厅视图。", Utils.logLevels.DEBUG);
    },

    /**
     * 切换聊天详情视图的显示/隐藏状态。
     */
    toggleChatDetailsView: function() {
        if (this.isPanelAreaVisible && this.currentView === 'details') {
            this.hideSidePanel();
        } else {
            this.showMainDetailsContent();
        }
    },

    /**
     * 切换人员大厅视图的显示/隐藏状态。
     */
    togglePeopleLobbyView: function() {
        if (this.isPanelAreaVisible && this.currentView === 'lobby') {
            this.hideSidePanel();
        } else {
            this.showPeopleLobbyContent();
        }
    },

    /**
     * 隐藏整个右侧详情面板。
     */
    hideSidePanel: function () {
        this._setPanelVisibility(false);
        if (this.detailsPanelTitleEl) this.detailsPanelTitleEl.textContent = '聊天信息';
        Utils.log("DetailsPanelUIManager: 右侧面板已隐藏。", Utils.logLevels.DEBUG);
    },

    /**
     * 根据指定的聊天ID和类型，更新右侧详情面板的内容。
     */
    updateDetailsPanel: function (chatId, type) {
        if (!this.detailsPanelEl || !this.detailsPanelContentEl) return;
        this.detailsPanelEl.className = 'details-panel';
        [this.contactActionsDetailsEl, this.detailsGroupManagementEl, this.groupActionsDetailsEl,
            this.aiContactAboutSectionEl, this.aiTtsConfigSectionEl,
            this.groupAiPromptsSectionEl]
            .forEach(el => { if (el) el.style.display = 'none'; });

        // 资源预览区现在总是尝试显示（如果当前是details视图），由ResourcePreviewUIManager内部管理内容
        if (this.resourcePreviewSectionEl) {
            this.resourcePreviewSectionEl.style.display = 'block';
        }


        if (this.currentChatActionsDetailsEl && this.clearCurrentChatBtnDetailsEl) {
            this.currentChatActionsDetailsEl.style.display = chatId ? 'block' : 'none';
            if (chatId) {
                const newBtn = this.clearCurrentChatBtnDetailsEl.cloneNode(true);
                this.clearCurrentChatBtnDetailsEl.parentNode.replaceChild(newBtn, this.clearCurrentChatBtnDetailsEl);
                this.clearCurrentChatBtnDetailsEl = newBtn;
                this.clearCurrentChatBtnDetailsEl.addEventListener('click', () => MessageManager.clearChat());
            }
        }
        if (type === 'contact') {
            this._updateForContact(chatId);
            // Stop timer if switching away from a group to a contact
            if (typeof TimerManager !== 'undefined') {
                TimerManager.removePeriodicTask(this._GROUP_MEMBER_REFRESH_TASK_NAME);
            }
        } else if (type === 'group') {
            this._updateForGroup(chatId);
        }

        // 调用 ResourcePreviewUIManager 更新其内容
        if (typeof ResourcePreviewUIManager !== 'undefined' && chatId && this.currentView === 'details') {
            ResourcePreviewUIManager.loadResourcesForChat(chatId);
        } else if (typeof ResourcePreviewUIManager !== 'undefined') {
            ResourcePreviewUIManager.hide();
        }
    },

    /**
     * @private
     * 更新详情面板以显示指定联系人的信息和相关操作。
     */
    _updateForContact: function(contactId) {
        const contact = UserManager.contacts[contactId];
        if (!contact || !this.detailsPanelEl) return;

        if (this.detailsPanelTitleEl) this.detailsPanelTitleEl.textContent = `${contact.name} 信息`;
        this.detailsPanelEl.classList.add('contact-details-active');
        if (UserManager.isSpecialContactInCurrentTheme(contactId)) {
            this.detailsPanelEl.classList.add(contact.id);
        } else if (contact.isAI) {
            this.detailsPanelEl.classList.add('historical-ai-contact-active');
        } else {
            this.detailsPanelEl.classList.add('human-contact-active');
        }
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

        if (UserManager.isSpecialContact(contactId)) {
            if (this.contactActionsDetailsEl) this.contactActionsDetailsEl.style.display = 'none';
            if (contact.isAI && contact.aboutDetails && this.aiContactAboutSectionEl) {
                this._populateAiAboutSection(contact);
                this.aiContactAboutSectionEl.style.display = 'block';
            }
            if (contact.isAI && this.aiTtsConfigSectionEl) {
                this._setupAiTtsConfigSection(contact);
                this.aiTtsConfigSectionEl.style.display = 'block';
            }
        } else {
            if (this.contactActionsDetailsEl) this.contactActionsDetailsEl.style.display = 'block';
            if (this.deleteContactBtnDetailsEl) {
                const newBtn = this.deleteContactBtnDetailsEl.cloneNode(true);
                this.deleteContactBtnDetailsEl.parentNode.replaceChild(newBtn, this.deleteContactBtnDetailsEl);
                this.deleteContactBtnDetailsEl = newBtn;
                this.deleteContactBtnDetailsEl.addEventListener('click', () => ChatManager.deleteChat(contactId, 'contact'));
            }
            if (this.aiTtsConfigSectionEl) this.aiTtsConfigSectionEl.style.display = 'none';
            if (this.aiContactAboutSectionEl) this.aiContactAboutSectionEl.style.display = 'none';
        }
        if (this.groupAiPromptsSectionEl) this.groupAiPromptsSectionEl.style.display = 'none';
        if (this.detailsGroupManagementEl) this.detailsGroupManagementEl.style.display = 'none';

        // Resource preview will be handled by ResourcePreviewUIManager via updateDetailsPanel
    },

    /**
     * @private
     * 填充 AI 联系人的 "关于" (About) 部分的UI元素。
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
     * @private
     * 设置 AI 联系人的 TTS (Text-to-Speech) 配置部分。
     */
    _setupAiTtsConfigSection: function(contact) {
        TtsUIManager.populateAiTtsConfigurationForm(contact, 'ttsConfigFormContainer');
        if (this.saveAiTtsSettingsBtnDetailsEl) {
            if (TtsUIManager._boundSaveTtsListener) {
                this.saveAiTtsSettingsBtnDetailsEl.removeEventListener('click', TtsUIManager._boundSaveTtsListener);
            }
            TtsUIManager._boundSaveTtsListener = TtsUIManager.handleSaveAiTtsSettings.bind(TtsUIManager, contact.id);
            this.saveAiTtsSettingsBtnDetailsEl.addEventListener('click', TtsUIManager._boundSaveTtsListener);
        }
    },

    /**
     * @private
     * 更新详情面板以显示指定群组的信息和相关操作。
     */
    _updateForGroup: function(groupId) {
        const group = GroupManager.groups[groupId];
        if (!group || !this.detailsPanelEl) return;

        if (this.detailsPanelTitleEl) this.detailsPanelTitleEl.textContent = `${group.name} 信息`;
        this.detailsPanelEl.classList.add('group-chat-active');
        Array.from(this.detailsPanelEl.classList).forEach(cls => {
            if (cls.startsWith('AI_') || cls.endsWith('-active')) {
                if (cls !== 'group-chat-active' && cls !== 'contact-details-active') {
                    this.detailsPanelEl.classList.remove(cls);
                }
            }
        });
        if (this.detailsNameEl) this.detailsNameEl.textContent = group.name;
        if (this.detailsIdEl) this.detailsIdEl.textContent = `群组 ID: ${group.id.substring(6)}`;
        if (this.detailsAvatarEl) {
            this.detailsAvatarEl.innerHTML = '👥';
            this.detailsAvatarEl.className = 'details-avatar group';
        }
        if (this.detailsStatusEl) this.detailsStatusEl.textContent = `${group.members.length} 名成员 (上限 ${GroupManager.MAX_GROUP_MEMBERS})`;

        if (this.detailsGroupManagementEl) this.detailsGroupManagementEl.style.display = 'block';
        if (this.groupActionsDetailsEl) this.groupActionsDetailsEl.style.display = 'block';

        const isOwner = group.owner === UserManager.userId;
        if (this.addGroupMemberAreaEl) this.addGroupMemberAreaEl.style.display = isOwner ? 'block' : 'none';
        if (this.leftMembersAreaEl) this.leftMembersAreaEl.style.display = isOwner && group.leftMembers && group.leftMembers.length > 0 ? 'block' : 'none';

        if (this.leaveGroupBtnDetailsEl) {
            this.leaveGroupBtnDetailsEl.style.display = isOwner ? 'none' : 'block';
            if(!isOwner) {
                const newBtn = this.leaveGroupBtnDetailsEl.cloneNode(true);
                this.leaveGroupBtnDetailsEl.parentNode.replaceChild(newBtn, this.leaveGroupBtnDetailsEl);
                this.leaveGroupBtnDetailsEl = newBtn;
                this.leaveGroupBtnDetailsEl.addEventListener('click', () => ChatManager.deleteChat(groupId, 'group'));
            }
        }
        if (this.dissolveGroupBtnDetailsEl) {
            this.dissolveGroupBtnDetailsEl.style.display = isOwner ? 'block' : 'none';
            if(isOwner) {
                const newBtn = this.dissolveGroupBtnDetailsEl.cloneNode(true);
                this.dissolveGroupBtnDetailsEl.parentNode.replaceChild(newBtn, this.dissolveGroupBtnDetailsEl);
                this.dissolveGroupBtnDetailsEl = newBtn;
                this.dissolveGroupBtnDetailsEl.addEventListener('click', () => ChatManager.deleteChat(groupId, 'group'));
            }
        }
        this.updateDetailsPanelMembers(groupId);

        if (this.groupAiPromptsSectionEl && isOwner) {
            const aiMembersInGroup = group.members.filter(memberId => UserManager.contacts[memberId]?.isAI);
            if (aiMembersInGroup.length > 0) {
                this.groupAiPromptsSectionEl.style.display = 'block';
                if(this.groupAiPromptsHeaderEl) this.groupAiPromptsHeaderEl.style.display = 'flex';
                this._populateGroupAiPromptsEditor(groupId, group, aiMembersInGroup);
            } else {
                this.groupAiPromptsSectionEl.style.display = 'none';
            }
        } else if (this.groupAiPromptsSectionEl) {
            this.groupAiPromptsSectionEl.style.display = 'none';
        }

        if (this.aiContactAboutSectionEl) this.aiContactAboutSectionEl.style.display = 'none';
        if (this.aiTtsConfigSectionEl) this.aiTtsConfigSectionEl.style.display = 'none';

        // Resource preview will be handled by ResourcePreviewUIManager via updateDetailsPanel
        // Ensure resource preview section is correctly ordered
        if (this.resourcePreviewSectionEl && this.detailsPanelContentEl && this.detailsPanelContentEl.lastChild !== this.resourcePreviewSectionEl) {
            this.detailsPanelContentEl.appendChild(this.resourcePreviewSectionEl);
        }

        if (ChatManager.currentChatId === groupId && this.isPanelAreaVisible && this.currentView === 'details') {
            this._startGroupMemberRefreshTimer();
        }
    },

    /**
     * @private
     * 为群组内的每个AI成员填充其特定行为指示（提示词）的编辑器。
     */
    _populateGroupAiPromptsEditor: function(groupId, group, aiMemberIds) {
        if (!this.groupAiPromptsListContainerEl) {
            Utils.log("DetailsPanelUIManager: groupAiPromptsListContainerEl 未找到，无法填充AI提示词编辑器。", Utils.logLevels.ERROR);
            return;
        }
        this.groupAiPromptsListContainerEl.innerHTML = '';
        aiMemberIds.forEach(aiId => {
            const aiContact = UserManager.contacts[aiId];
            if (!aiContact || !aiContact.isAI) return;

            const itemDiv = document.createElement('div');
            itemDiv.className = 'ai-prompt-editor-item';
            itemDiv.dataset.aiId = aiId;

            const nameHeader = document.createElement('h5');
            nameHeader.textContent = `AI角色: ${aiContact.name}`;
            itemDiv.appendChild(nameHeader);

            let currentPromptText = "";
            if (group.aiPrompts && group.aiPrompts[aiId] !== undefined) {
                currentPromptText = group.aiPrompts[aiId];
            } else if (aiContact.aiConfig && aiContact.aiConfig.systemPrompt !== undefined) {
                currentPromptText = aiContact.aiConfig.systemPrompt;
            }

            const promptTextarea = document.createElement('textarea');
            promptTextarea.value = currentPromptText;
            promptTextarea.placeholder = "输入此AI在群组中的特定行为指示...";
            promptTextarea.rows = 3;
            promptTextarea.className = 'group-ai-prompt-textarea';
            itemDiv.appendChild(promptTextarea);

            const buttonContainer = document.createElement('div');
            buttonContainer.style.marginTop = '8px';
            buttonContainer.style.display = 'flex';
            buttonContainer.style.gap = '8px';

            const saveBtn = document.createElement('button');
            saveBtn.textContent = '保存指示';
            saveBtn.className = 'btn btn-primary btn-sm';
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
            buttonContainer.appendChild(saveBtn);

            const resetBtn = document.createElement('button');
            resetBtn.textContent = '重置为默认';
            resetBtn.className = 'btn btn-secondary btn-sm';
            resetBtn.addEventListener('click', async () => {
                const defaultPrompt = (aiContact.aiConfig && aiContact.aiConfig.systemPrompt) ? aiContact.aiConfig.systemPrompt : "";
                let promptChanged = false;

                if (group.aiPrompts && group.aiPrompts[aiId] !== undefined && group.aiPrompts[aiId] !== defaultPrompt) {
                    group.aiPrompts[aiId] = defaultPrompt;
                    promptChanged = true;
                } else if (group.aiPrompts && group.aiPrompts[aiId] === undefined && defaultPrompt !== "") {
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
            buttonContainer.appendChild(resetBtn);
            itemDiv.appendChild(buttonContainer);
            this.groupAiPromptsListContainerEl.appendChild(itemDiv);
        });
    },

    /**
     * 更新群组详情面板中的成员列表显示。
     */
    updateDetailsPanelMembers: function (groupId) {
        const group = GroupManager.groups[groupId];
        if (!group || !this.groupMemberListDetailsEl || !this.groupMemberCountEl || !this.contactsDropdownDetailsEl || !document.getElementById('leftMemberListDetails')) return;
        const leftMemberListDetailsEl = document.getElementById('leftMemberListDetails');

        this.groupMemberListDetailsEl.innerHTML = '';
        this.groupMemberCountEl.textContent = group.members.length;

        const membersWithSortInfo = group.members.map(memberId => {
            const member = UserManager.contacts[memberId] || { id: memberId, name: `用户 ${memberId.substring(0, 4)}`, isAI: false };
            let sortCategory;
            const isOwner = memberId === group.owner;
            const isAI = member.isAI;
            const isOnline = (!isAI && !isOwner && PeopleLobbyManager.onlineUserIds && PeopleLobbyManager.onlineUserIds.includes(memberId));

            if (isOwner) sortCategory = 0;
            else if (!isAI && isOnline) sortCategory = 1;
            else if (isAI) sortCategory = 2;
            else sortCategory = 3;
            return { ...member, id: memberId, sortCategory, isOnlineForSort: isOnline };
        });

        membersWithSortInfo.sort((a, b) => {
            if (a.sortCategory !== b.sortCategory) {
                return a.sortCategory - b.sortCategory;
            }
            return (a.name || '').localeCompare(b.name || '', undefined, { sensitivity: 'base' });
        });

        membersWithSortInfo.forEach(memberData => {
            const memberId = memberData.id;
            const member = memberData;
            const item = document.createElement('div');
            item.className = 'member-item-detail';
            let memberInfoHtml = `<span class="member-name">${Utils.escapeHtml(member.name)} ${memberId === UserManager.userId ? '(您)' : ''} ${member.isAI ? '(AI)' : ''}</span>`;
            let statusHtml = '';
            let actionsHtml = '';

            if (memberId !== UserManager.userId && !member.isAI) {
                const isConnected = ConnectionManager.isConnectedTo(memberId);
                const isActuallyOnline = PeopleLobbyManager.onlineUserIds ? PeopleLobbyManager.onlineUserIds.includes(memberId) : false;
                let onlineStatusText = isActuallyOnline ? '在线' : '离线';
                let statusClass = 'offline';
                if(isActuallyOnline){
                    statusClass = isConnected ? 'connected' : 'online-not-connected';
                }
                if(isConnected) onlineStatusText = '已连接';
                statusHtml = `<span class="member-status ${statusClass}">(${onlineStatusText})</span>`;
                if (!isConnected && isActuallyOnline) {
                    actionsHtml += `<button class="reconnect-member-btn-detail" data-member-id="${memberId}" title="重新连接">🔄</button>`;
                }
            }

            if (memberId === group.owner) {
                memberInfoHtml += '<span class="owner-badge">群主</span>';
            } else if (group.owner === UserManager.userId) {
                actionsHtml += `<button class="remove-member-btn-detail" data-member-id="${memberId}" title="移除成员">✕</button>`;
            }
            item.innerHTML = `${memberInfoHtml} ${statusHtml} <span class="member-actions">${actionsHtml}</span>`;
            this.groupMemberListDetailsEl.appendChild(item);
        });

        this.groupMemberListDetailsEl.querySelectorAll('.remove-member-btn-detail').forEach(btn => {
            const newBtn = btn.cloneNode(true);
            btn.parentNode.replaceChild(newBtn, btn);
            newBtn.addEventListener('click', () => GroupManager.removeMemberFromGroup(groupId, newBtn.dataset.memberId));
        });

        this.groupMemberListDetailsEl.querySelectorAll('.reconnect-member-btn-detail').forEach(btn => {
            const newBtn = btn.cloneNode(true);
            btn.parentNode.replaceChild(newBtn, btn);
            newBtn.addEventListener('click', async () => {
                const targetMemberId = newBtn.dataset.memberId;
                NotificationUIManager.showNotification(`尝试重新连接到 ${UserManager.contacts[targetMemberId]?.name || targetMemberId.substring(0,4)}...`, 'info');
                await ConnectionManager.createOffer(targetMemberId, { isSilent: false });
            });
        });

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

        leftMemberListDetailsEl.innerHTML = '';
        if (group.owner === UserManager.userId && group.leftMembers && group.leftMembers.length > 0 && this.leftMembersAreaEl) {
            group.leftMembers.forEach(leftMember => {
                const item = document.createElement('div');
                item.className = 'left-member-item-detail';
                item.innerHTML = `<span>${Utils.escapeHtml(leftMember.name)} (离开于: ${Utils.formatDate(new Date(leftMember.leftTime))})</span>
<button class="re-add-member-btn-detail" data-member-id="${leftMember.id}" data-member-name="${Utils.escapeHtml(leftMember.name)}" title="重新添加成员">+</button>`;
                leftMemberListDetailsEl.appendChild(item);
            });
            leftMemberListDetailsEl.querySelectorAll('.re-add-member-btn-detail').forEach(btn => {
                const newBtn = btn.cloneNode(true);
                btn.parentNode.replaceChild(newBtn, btn);
                newBtn.addEventListener('click', () => GroupManager.addMemberToGroup(groupId, newBtn.dataset.memberId, newBtn.dataset.memberName));
            });
            this.leftMembersAreaEl.style.display = 'block';
        } else if (this.leftMembersAreaEl) {
            this.leftMembersAreaEl.style.display = 'none';
        }
    },

    /**
     * 处理从详情面板的下拉框中选择联系人并将其添加到当前群组的逻辑。
     */
    handleAddMemberToGroupDetails: function () {
        const groupId = ChatManager.currentChatId;
        if (!this.contactsDropdownDetailsEl) return;
        const memberId = this.contactsDropdownDetailsEl.value;
        const memberName = this.contactsDropdownDetailsEl.selectedOptions[0]?.text.replace(/\s*\(AI助手\)$/, '').trim();

        if (groupId && memberId) {
            GroupManager.addMemberToGroup(groupId, memberId, memberName).then(success => {
                if (success && this.contactsDropdownDetailsEl) this.contactsDropdownDetailsEl.value = "";
            });
        } else {
            NotificationUIManager.showNotification("请选择要添加的联系人。", "warning");
        }
    },

    /**
     * @private
     * 启动群成员状态的自动刷新定时器。
     */
    _startGroupMemberRefreshTimer: function() {
        if (typeof TimerManager !== 'undefined') {
            TimerManager.removePeriodicTask(this._GROUP_MEMBER_REFRESH_TASK_NAME); // Remove old if exists
            TimerManager.addPeriodicTask(
                this._GROUP_MEMBER_REFRESH_TASK_NAME,
                this._refreshGroupMembersAndAutoConnect.bind(this),
                this.GROUP_MEMBER_REFRESH_INTERVAL_MS,
                true // Run immediately
            );
        } else {
            Utils.log("DetailsPanelUIManager: TimerManager 未定义，无法启动群成员刷新定时器。", Utils.logLevels.ERROR);
        }
    },

    /**
     * @private
     * 刷新当前群组的成员状态，并尝试自动连接那些在线但尚未通过WebRTC连接的成员。
     */
    _refreshGroupMembersAndAutoConnect: async function() {
        const groupId = ChatManager.currentChatId;
        if (!groupId || !groupId.startsWith('group_')) {
            // If no longer a group chat, or no chat, stop the timer
            if (typeof TimerManager !== 'undefined') {
                TimerManager.removePeriodicTask(this._GROUP_MEMBER_REFRESH_TASK_NAME);
            }
            return;
        }
        const group = GroupManager.groups[groupId];
        if (!group) {
            if (typeof TimerManager !== 'undefined') {
                TimerManager.removePeriodicTask(this._GROUP_MEMBER_REFRESH_TASK_NAME);
            }
            return;
        }
        // Ensure panel is still visible and in correct view
        if (!this.isPanelAreaVisible || this.currentView !== 'details') {
            if (typeof TimerManager !== 'undefined') {
                TimerManager.removePeriodicTask(this._GROUP_MEMBER_REFRESH_TASK_NAME);
            }
            return;
        }


        if (PeopleLobbyManager && typeof PeopleLobbyManager.fetchOnlineUsers === 'function') {
            await PeopleLobbyManager.fetchOnlineUsers();
        }
        this.updateDetailsPanelMembers(groupId);
        Utils.log(`DetailsPanelUIManager: 定时刷新群成员 (${groupId}) 状态。`, Utils.logLevels.DEBUG);

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
    }
};