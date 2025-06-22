/**
 * @file DetailsPanelUIManager.js
 * @description 管理应用右侧详情面板的 UI 元素和交互。此面板可以显示当前选定聊天的详细信息（包括联系人信息、群组成员、AI配置、资源预览）或人员大厅。
 *              新增: 群主可查看和编辑群内 AI 的特定提示词。
 *              优化: 当群主修改AI提示词后，会向群内发送系统消息通知。
 *              修复: 主题切换后，添加成员下拉列表现在能正确反映当前主题的AI角色。
 *              更新: 群组成员列表现在显示在线状态和与当前用户的连接状态，并提供重连按钮。
 *              新增: 定期自动刷新群成员状态，并对在线但未连接的成员尝试自动连接。
 * @module DetailsPanelUIManager
 * @exports {object} DetailsPanelUIManager - 对外暴露的单例对象，包含管理右侧详情面板的所有方法。
 * @property {function} init - 初始化模块，获取DOM元素引用并绑定基础事件。
 * @property {function} showMainDetailsContent - 显示聊天详情视图（包括联系人/群组信息和资源预览）。
 * @property {function} showPeopleLobbyContent - 显示人员大厅视图。
 * @property {function} toggleChatDetailsView - 切换聊天详情视图的显示/隐藏状态。
 * @property {function} togglePeopleLobbyView - 切换人员大厅视图的显示/隐藏状态。
 * @property {function} hideSidePanel - 隐藏整个右侧面板区域。
 * @property {function} updateDetailsPanel - 根据当前聊天ID和类型更新聊天详情面板的内容。
 * @property {function} updateDetailsPanelMembers - 更新群组详情中的成员列表和添加成员下拉框。
 * @property {function} handleAddMemberToGroupDetails - 处理从详情面板添加成员到当前群组的逻辑。
 * @dependencies UserManager, GroupManager, ChatManager, MessageManager, TtsUIManager, NotificationUIManager, Utils, ConnectionManager, PeopleLobbyManager, Config, LayoutUIManager, EventEmitter
 * @dependents AppInitializer (进行初始化), ChatAreaUIManager (通过按钮点击调用以切换面板显隐)
 */
const DetailsPanelUIManager = {
    isPanelAreaVisible: false,
    currentView: null,
    _boundTtsConfigCollapseListener: null,

    detailsPanelEl: null,
    detailsPanelTitleEl: null,
    closeDetailsBtnMainEl: null,

    detailsPanelContentEl: null,
    detailsNameEl: null,
    detailsIdEl: null,
    detailsAvatarEl: null,
    detailsStatusEl: null,
    contactActionsDetailsEl: null,
    currentChatActionsDetailsEl: null,
    clearCurrentChatBtnDetailsEl: null,
    deleteContactBtnDetailsEl: null,
    detailsGroupManagementEl: null,
    groupAiPromptsSectionEl: null,
    groupAiPromptsListContainerEl: null, // 将在这里动态创建
    groupActionsDetailsEl: null,
    leaveGroupBtnDetailsEl: null,
    dissolveGroupBtnDetailsEl: null,
    aiContactAboutSectionEl: null,
    aiContactAboutNameEl: null,
    aiContactBasicInfoListEl: null,
    aiContactAboutNameSubEl: null,
    aiContactAboutTextEl: null,
    aiTtsConfigSectionEl: null,
    aiTtsConfigHeaderEl: null,
    aiTtsConfigContentEl: null,
    saveAiTtsSettingsBtnDetailsEl: null,
    groupMemberListDetailsEl: null,
    groupMemberCountEl: null,
    addGroupMemberAreaEl: null,
    leftMembersAreaEl: null,
    contactsDropdownDetailsEl: null,
    addMemberBtnDetailsEl: null,
    ttsAttributionHeaderEl: null,
    ttsAttributionContentEl: null,

    peopleLobbyContentEl: null,

    resourcePreviewSectionEl: null,
    resourcePreviewHeaderTitleEl: null,
    resourcePreviewPanelContentEl: null,
    resourceCategoryTabsContainerEl: null,
    resourceCategoryButtons: {},
    resourceGridContainerEl: null,
    resourceGridLoadingIndicatorEl: null,
    _currentResourceChatId: null,
    _currentResourceType: 'image',
    _resourceItems: [],
    _resourceGridRenderedItemsCount: 0,
    _isResourceLoading: false,
    _resourceScrollListenerAttached: false,
    _boundHandleResourceGridScroll: null,

    _groupMemberRefreshInterval: null, // 用于存储群成员刷新定时器
    GROUP_MEMBER_REFRESH_INTERVAL_MS: 3000, // 3秒刷新间隔

    /**
     * 初始化模块。获取所有必要的DOM元素引用，并绑定初始事件监听器。
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

        // 动态创建群组AI提示词管理区域的容器，如果它不存在
        this.groupAiPromptsSectionEl = document.getElementById('groupAiPromptsSection');
        if (!this.groupAiPromptsSectionEl && this.detailsGroupManagementEl) { // 确保在群组管理部分之后插入
            this.groupAiPromptsSectionEl = document.createElement('div');
            this.groupAiPromptsSectionEl.className = 'details-section';
            this.groupAiPromptsSectionEl.id = 'groupAiPromptsSection';
            this.groupAiPromptsSectionEl.style.display = 'none'; // 初始隐藏
            const header = document.createElement('h4');
            header.textContent = '群内AI行为指示';
            this.groupAiPromptsSectionEl.appendChild(header);
            this.groupAiPromptsListContainerEl = document.createElement('div');
            this.groupAiPromptsListContainerEl.id = 'groupAiPromptsListContainer'; // 用于容纳每个AI的编辑项
            this.groupAiPromptsSectionEl.appendChild(this.groupAiPromptsListContainerEl);

            // 插入到群组管理部分之后
            this.detailsGroupManagementEl.parentNode.insertBefore(this.groupAiPromptsSectionEl, this.detailsGroupManagementEl.nextSibling);
        } else if (this.groupAiPromptsSectionEl) { // 如果已存在，获取其内部列表容器
            this.groupAiPromptsListContainerEl = this.groupAiPromptsSectionEl.querySelector('#groupAiPromptsListContainer');
            if (!this.groupAiPromptsListContainerEl) { // 如果容器内没有列表，也创建它
                this.groupAiPromptsListContainerEl = document.createElement('div');
                this.groupAiPromptsListContainerEl.id = 'groupAiPromptsListContainer';
                this.groupAiPromptsSectionEl.appendChild(this.groupAiPromptsListContainerEl);
            }
        }


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
        this.groupMemberListDetailsEl = document.getElementById('groupMemberListDetails');
        this.groupMemberCountEl = document.getElementById('groupMemberCount');
        this.addGroupMemberAreaEl = document.getElementById('addGroupMemberArea');
        this.leftMembersAreaEl = document.getElementById('leftMembersArea');
        this.contactsDropdownDetailsEl = document.getElementById('contactsDropdownDetails');
        this.addMemberBtnDetailsEl = document.getElementById('addMemberBtnDetails');
        this.ttsAttributionHeaderEl = document.getElementById('ttsAttributionCollapsibleTrigger');
        this.ttsAttributionContentEl = document.getElementById('ttsAttributionCollapsibleContent');
        this.peopleLobbyContentEl = document.getElementById('peopleLobbyContent');
        this.resourcePreviewSectionEl = document.getElementById('resourcePreviewSection');
        this.resourcePreviewHeaderTitleEl = document.getElementById('resourcePreviewHeaderTitle');
        this.resourcePreviewPanelContentEl = document.getElementById('resourcePreviewPanelContent');
        this.resourceCategoryTabsContainerEl = document.getElementById('resourceCategoryTabsContainer');
        this.resourceGridContainerEl = document.getElementById('resourceGridContainer');
        this.resourceGridLoadingIndicatorEl = document.getElementById('resourceGridLoadingIndicator');

        if (this.resourceCategoryTabsContainerEl) {
            const buttons = this.resourceCategoryTabsContainerEl.querySelectorAll('.resource-category-tab');
            buttons.forEach(btn => {
                const type = btn.dataset.resourceType;
                if (type) {
                    this.resourceCategoryButtons[type] = btn;
                    btn.addEventListener('click', () => this._switchResourceTypeAndLoad(type));
                }
            });
        }
        this._boundHandleResourceGridScroll = this._handleResourceGridScroll.bind(this);
        this.bindEvents();

        // 监听连接状态变化以更新群成员状态
        EventEmitter.on('connectionEstablished', (peerId) => {
            this._tryRefreshGroupMembersView(peerId);
        });
        EventEmitter.on('connectionClosed', (peerId) => {
            this._tryRefreshGroupMembersView(peerId);
        });
        EventEmitter.on('connectionFailed', (peerId) => {
            this._tryRefreshGroupMembersView(peerId);
        });
        // 监听在线用户列表变化，以更新状态
        EventEmitter.on('onlineUsersUpdated', () => {
            if (this.currentView === 'details' && ChatManager.currentChatId && ChatManager.currentChatId.startsWith('group_')) {
                this.updateDetailsPanelMembers(ChatManager.currentChatId);
            }
        });

    },

    /**
     * @private
     * 尝试刷新群成员视图，如果当前正在查看该群组的详情。
     * @param {string} peerId - 发生连接状态变化的成员ID。
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
     * 绑定模块所需的事件监听器。
     */
    bindEvents: function() {
        if (this.closeDetailsBtnMainEl) {
            this.closeDetailsBtnMainEl.addEventListener('click', () => this.hideSidePanel());
        }
        if (this.addMemberBtnDetailsEl) {
            this.addMemberBtnDetailsEl.addEventListener('click', () => this.handleAddMemberToGroupDetails());
        }
        if (this.ttsAttributionHeaderEl && this.ttsAttributionContentEl) {
            this.ttsAttributionHeaderEl.addEventListener('click', () => {
                const header = this.ttsAttributionHeaderEl;
                const content = this.ttsAttributionContentEl;
                header.classList.toggle('active');
                const icon = header.querySelector('.collapse-icon');
                if (content.style.display === "block" || content.style.display === "") {
                    content.style.display = "none";
                    if(icon) icon.textContent = '▶';
                } else {
                    content.style.display = "block";
                    if(icon) icon.textContent = '▼';
                }
            });
            const icon = this.ttsAttributionHeaderEl.querySelector('.collapse-icon');
            if (this.ttsAttributionContentEl.style.display === 'none') {
                if(icon) icon.textContent = '▶'; this.ttsAttributionHeaderEl.classList.remove('active');
            } else {
                if(icon) icon.textContent = '▼'; this.ttsAttributionHeaderEl.classList.add('active');
            }
        }
    },

    _setPanelVisibility: function(show, viewType = null) {
        const appContainer = document.querySelector('.app-container');
        this.isPanelAreaVisible = show;
        if (this.detailsPanelContentEl) this.detailsPanelContentEl.style.display = 'none';
        if (this.peopleLobbyContentEl) this.peopleLobbyContentEl.style.display = 'none';

        // 清除旧的定时器
        if (this._groupMemberRefreshInterval) {
            clearInterval(this._groupMemberRefreshInterval);
            this._groupMemberRefreshInterval = null;
            Utils.log("DetailsPanelUIManager: 已清除群成员刷新定时器。", Utils.logLevels.DEBUG);
        }

        if (show) {
            if (this.detailsPanelEl) this.detailsPanelEl.style.display = 'flex';
            if (appContainer) appContainer.classList.add('show-details');
            if (viewType === 'details' && this.detailsPanelContentEl) {
                this.detailsPanelContentEl.style.display = 'block';
                // 如果是群组详情，启动定时刷新
                if (ChatManager.currentChatId && ChatManager.currentChatId.startsWith('group_')) {
                    this._startGroupMemberRefreshTimer();
                }
            } else if (viewType === 'lobby' && this.peopleLobbyContentEl) {
                this.peopleLobbyContentEl.style.display = 'flex';
            }
            this.currentView = viewType;
        } else {
            if (this.detailsPanelEl) this.detailsPanelEl.style.display = 'none';
            if (appContainer) appContainer.classList.remove('show-details');
            this.currentView = null;
            this._detachResourceScrollListener();
        }
    },

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

    showPeopleLobbyContent: async function() {
        if (this.detailsPanelTitleEl) this.detailsPanelTitleEl.textContent = '人员大厅';
        if (this.resourcePreviewSectionEl) this.resourcePreviewSectionEl.style.display = 'none';
        if (this.groupAiPromptsSectionEl) this.groupAiPromptsSectionEl.style.display = 'none';
        if (PeopleLobbyManager) await PeopleLobbyManager.show(); // show会获取最新数据
        this._setPanelVisibility(true, 'lobby');
        Utils.log("DetailsPanelUIManager: 显示人员大厅视图。", Utils.logLevels.DEBUG);
    },

    toggleChatDetailsView: function() {
        if (this.isPanelAreaVisible && this.currentView === 'details') {
            this.hideSidePanel();
        } else {
            this.showMainDetailsContent();
        }
    },

    togglePeopleLobbyView: function() {
        if (this.isPanelAreaVisible && this.currentView === 'lobby') {
            this.hideSidePanel();
        } else {
            this.showPeopleLobbyContent();
        }
    },

    hideSidePanel: function () {
        this._setPanelVisibility(false);
        if (this.detailsPanelTitleEl) this.detailsPanelTitleEl.textContent = '聊天信息';
        Utils.log("DetailsPanelUIManager: 右侧面板已隐藏。", Utils.logLevels.DEBUG);
    },

    updateDetailsPanel: function (chatId, type) {
        if (!this.detailsPanelEl || !this.detailsPanelContentEl) return;
        this.detailsPanelEl.className = 'details-panel';
        [this.contactActionsDetailsEl, this.detailsGroupManagementEl, this.groupActionsDetailsEl,
            this.aiContactAboutSectionEl, this.aiTtsConfigSectionEl, this.resourcePreviewSectionEl,
            this.groupAiPromptsSectionEl]
            .forEach(el => { if (el) el.style.display = 'none'; });

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
            // 联系人详情不需要定时刷新成员状态
            if (this._groupMemberRefreshInterval) {
                clearInterval(this._groupMemberRefreshInterval);
                this._groupMemberRefreshInterval = null;
            }
        } else if (type === 'group') {
            this._updateForGroup(chatId);
            // _updateForGroup 内部会决定是否启动定时器
        }
    },

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
        if (this.resourcePreviewSectionEl && this.resourcePreviewPanelContentEl) {
            this.resourcePreviewSectionEl.style.display = 'block';
            this.resourcePreviewPanelContentEl.style.display = 'flex';
            this._currentResourceChatId = contactId;
            this._attachResourceScrollListener();
            this._switchResourceTypeAndLoad(this._currentResourceType);
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
    },

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

    _setupAiTtsConfigSection: function(contact) {
        TtsUIManager.populateAiTtsConfigurationForm(contact, 'ttsConfigFormContainer');
        if (this.saveAiTtsSettingsBtnDetailsEl) {
            if (TtsUIManager._boundSaveTtsListener) {
                this.saveAiTtsSettingsBtnDetailsEl.removeEventListener('click', TtsUIManager._boundSaveTtsListener);
            }
            TtsUIManager._boundSaveTtsListener = TtsUIManager.handleSaveAiTtsSettings.bind(TtsUIManager, contact.id);
            this.saveAiTtsSettingsBtnDetailsEl.addEventListener('click', TtsUIManager._boundSaveTtsListener);
        }
        if (this.aiTtsConfigHeaderEl) {
            if (this._boundTtsConfigCollapseListener) {
                this.aiTtsConfigHeaderEl.removeEventListener('click', this._boundTtsConfigCollapseListener);
            }
            this._boundTtsConfigCollapseListener = function() {
                this.classList.toggle('active');
                const content = this.nextElementSibling;
                const icon = this.querySelector('.collapse-icon');
                if (content) {
                    if (content.style.display === "block" || content.style.display === "") {
                        content.style.display = "none";
                        if(icon) icon.textContent = '▶';
                    } else {
                        content.style.display = "block";
                        if(icon) icon.textContent = '▼';
                    }
                }
            };
            this.aiTtsConfigHeaderEl.addEventListener('click', this._boundTtsConfigCollapseListener);
            const icon = this.aiTtsConfigHeaderEl.querySelector('.collapse-icon');
            if (this.aiTtsConfigContentEl) {
                if (this.aiTtsConfigContentEl.style.display === 'none') {
                    if(icon) icon.textContent = '▶'; this.aiTtsConfigHeaderEl.classList.remove('active');
                } else {
                    if(icon) icon.textContent = '▼'; this.aiTtsConfigHeaderEl.classList.add('active');
                }
            }
        }
    },

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
        this.updateDetailsPanelMembers(groupId); // 初始渲染成员列表

        // AI提示词管理部分
        if (this.groupAiPromptsSectionEl && isOwner) { // 确保容器存在
            const aiMembersInGroup = group.members.filter(memberId => {
                const contact = UserManager.contacts[memberId];
                return contact && contact.isAI;
            });
            if (aiMembersInGroup.length > 0) {
                this.groupAiPromptsSectionEl.style.display = 'block';
                this._populateGroupAiPromptsEditor(groupId, group, aiMembersInGroup);
            } else {
                this.groupAiPromptsSectionEl.style.display = 'none';
                if(this.groupAiPromptsListContainerEl) this.groupAiPromptsListContainerEl.innerHTML = ''; // 清空内容
            }
        } else if (this.groupAiPromptsSectionEl) {
            this.groupAiPromptsSectionEl.style.display = 'none';
            if(this.groupAiPromptsListContainerEl) this.groupAiPromptsListContainerEl.innerHTML = '';
        }

        if (this.aiContactAboutSectionEl) this.aiContactAboutSectionEl.style.display = 'none';
        if (this.aiTtsConfigSectionEl) this.aiTtsConfigSectionEl.style.display = 'none';
        if (this.resourcePreviewSectionEl) {
            this.resourcePreviewSectionEl.style.display = 'none';
            if (this.resourcePreviewPanelContentEl) this.resourcePreviewPanelContentEl.style.display = 'none';
        }
        this._detachResourceScrollListener();
        // 在这里决定是否启动定时器，而不是在 _setPanelVisibility 中
        // 确保只有当当前聊天是群组且详情面板为此群组打开时才启动
        if (ChatManager.currentChatId === groupId && this.isPanelAreaVisible && this.currentView === 'details') {
            this._startGroupMemberRefreshTimer();
        }
    },

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
            promptTextarea.className = 'group-ai-prompt-textarea'; // 添加类名方便选择
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

                // 只有当新提示词与当前存储的群组特定提示词不同时，才算改变
                // 或者如果之前没有特定提示词，而新提示词非空
                if ((group.aiPrompts[aiId] === undefined && newPrompt !== "") || (group.aiPrompts[aiId] !== undefined && group.aiPrompts[aiId] !== newPrompt)) {
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
                    // 如果存在特定提示词且与默认不同，则重置为默认
                    group.aiPrompts[aiId] = defaultPrompt;
                    promptChanged = true;
                } else if (group.aiPrompts && group.aiPrompts[aiId] === undefined && defaultPrompt !== "") {
                    // 如果不存在特定提示词，但默认提示词非空（理论上第一次添加AI时已设置，但作为保险）
                    group.aiPrompts[aiId] = defaultPrompt;
                    promptChanged = true;
                } else if (group.aiPrompts && group.aiPrompts[aiId] !== undefined && defaultPrompt === "" && group.aiPrompts[aiId] !== "") {
                    // 如果默认提示词为空，但存在特定提示词，则应删除特定提示词记录
                    delete group.aiPrompts[aiId];
                    promptChanged = true;
                }


                promptTextarea.value = defaultPrompt; // 更新UI显示
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

    updateDetailsPanelMembers: function (groupId) {
        const group = GroupManager.groups[groupId];
        if (!group || !this.groupMemberListDetailsEl || !this.groupMemberCountEl || !this.contactsDropdownDetailsEl || !document.getElementById('leftMemberListDetails')) return;
        const leftMemberListDetailsEl = document.getElementById('leftMemberListDetails');
        this.groupMemberListDetailsEl.innerHTML = '';
        this.groupMemberCountEl.textContent = group.members.length;

        group.members.forEach(memberId => {
            const member = UserManager.contacts[memberId] || {id: memberId, name: `用户 ${memberId.substring(0, 4)}`};
            const item = document.createElement('div');
            item.className = 'member-item-detail';

            let memberInfoHtml = `<span class="member-name">${Utils.escapeHtml(member.name)} ${memberId === UserManager.userId ? '(您)' : ''} ${member.isAI ? '(AI)' : ''}</span>`;
            let statusHtml = '';
            let actionsHtml = '';

            if (memberId !== UserManager.userId && !member.isAI) { // 非当前用户且非AI，显示连接状态和重连按钮
                const isConnected = ConnectionManager.isConnectedTo(memberId);
                // 优先使用 PeopleLobbyManager 的在线状态，如果不可用则默认离线
                const isOnline = PeopleLobbyManager.onlineUserIds ? PeopleLobbyManager.onlineUserIds.includes(memberId) : false;
                let onlineStatusText = isOnline ? '在线' : '离线';
                let statusClass = isOnline ? 'online-not-connected' : 'offline'; // 默认为未连接的在线或离线

                if (isConnected) {
                    onlineStatusText = '已连接';
                    statusClass = 'connected';
                }

                statusHtml = `<span class="member-status ${statusClass}">(${onlineStatusText})</span>`;
                if (!isConnected && isOnline) { // 仅当在线但未连接时显示重连按钮
                    actionsHtml += `<button class="reconnect-member-btn-detail" data-member-id="${memberId}" title="重新连接">🔄</button>`;
                }
            }

            if (memberId === group.owner) {
                memberInfoHtml += '<span class="owner-badge">群主</span>';
            } else if (group.owner === UserManager.userId) { // 当前用户是群主，可以移除其他成员
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
                await ConnectionManager.createOffer(targetMemberId, { isSilent: false }); // isSilent: false 以便用户看到连接尝试
                // 按钮将通过事件监听器自动更新状态
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
     * 启动一个定时器，定期刷新群组成员列表和尝试自动连接。
     */
    _startGroupMemberRefreshTimer: function() {
        // 清除任何已存在的定时器，以防重复启动
        if (this._groupMemberRefreshInterval) {
            clearInterval(this._groupMemberRefreshInterval);
            this._groupMemberRefreshInterval = null;
        }

        // 立即执行一次
        this._refreshGroupMembersAndAutoConnect();

        // 设置定时器
        this._groupMemberRefreshInterval = setInterval(() => {
            // 确保只在群组详情仍然可见且是当前聊天时执行
            if (this.isPanelAreaVisible && this.currentView === 'details' &&
                ChatManager.currentChatId && ChatManager.currentChatId.startsWith('group_')) {
                this._refreshGroupMembersAndAutoConnect();
            } else {
                // 如果条件不满足，清除定时器
                if (this._groupMemberRefreshInterval) {
                    clearInterval(this._groupMemberRefreshInterval);
                    this._groupMemberRefreshInterval = null;
                    Utils.log("DetailsPanelUIManager: 群组成员自动刷新定时器已停止（条件不满足）。", Utils.logLevels.DEBUG);
                }
            }
        }, this.GROUP_MEMBER_REFRESH_INTERVAL_MS);
        Utils.log("DetailsPanelUIManager: 已启动群成员状态自动刷新和连接定时器。", Utils.logLevels.DEBUG);
    },

    /**
     * @private
     * 刷新群组成员列表UI，并对在线但未连接的成员尝试自动发起连接。
     */
    _refreshGroupMembersAndAutoConnect: async function() {
        const groupId = ChatManager.currentChatId;
        if (!groupId || !groupId.startsWith('group_')) return;

        const group = GroupManager.groups[groupId];
        if (!group) return;

        // 1. (可选但推荐) 获取最新的在线用户列表
        // 如果 PeopleLobbyManager 不会自动更新，或者更新频率不够，可以在这里调用
        if (PeopleLobbyManager && typeof PeopleLobbyManager.fetchOnlineUsers === 'function') {
            // Utils.log("DetailsPanelUIManager: 正在为群成员状态刷新获取最新在线用户列表...", Utils.logLevels.DEBUG);
            await PeopleLobbyManager.fetchOnlineUsers(); // 等待获取完成
        }

        // 2. 刷新成员列表UI (updateDetailsPanelMembers 内部会使用 PeopleLobbyManager.onlineUserIds)
        this.updateDetailsPanelMembers(groupId);
        Utils.log(`DetailsPanelUIManager: 定时刷新群成员 (${groupId}) 状态。`, Utils.logLevels.DEBUG);

        // 3. 尝试自动连接在线但未连接的成员
        group.members.forEach(memberId => {
            if (memberId === UserManager.userId || (UserManager.contacts[memberId] && UserManager.contacts[memberId].isAI)) {
                return; // 不连接自己或AI
            }
            const isConnected = ConnectionManager.isConnectedTo(memberId);
            const isOnline = PeopleLobbyManager.onlineUserIds ? PeopleLobbyManager.onlineUserIds.includes(memberId) : false;

            if (isOnline && !isConnected) {
                Utils.log(`DetailsPanelUIManager: 自动尝试连接到群成员 ${memberId} (在线但未连接)。`, Utils.logLevels.INFO);
                ConnectionManager.createOffer(memberId, { isSilent: true }); // 静默尝试连接
            }
        });
    },


    _switchResourceTypeAndLoad: function(resourceType) {
        if (!this._currentResourceChatId || !this.resourceGridContainerEl) return;
        Utils.log(`DetailsPanelUIManager: 切换到资源类型: ${resourceType} for chat ${this._currentResourceChatId}`, Utils.logLevels.DEBUG);
        this._currentResourceType = resourceType;
        this._resourceItems = [];
        this._resourceGridRenderedItemsCount = 0;
        this.resourceGridContainerEl.innerHTML = '';
        for (const type in this.resourceCategoryButtons) {
            if (this.resourceCategoryButtons[type]) {
                this.resourceCategoryButtons[type].classList.toggle('active', type === resourceType);
            }
        }
        this._loadMoreResources(true);
    },
    _loadMoreResources: async function(isInitialLoad = false) {
        if (this._isResourceLoading || !this._currentResourceChatId) return;
        this._isResourceLoading = true;
        if (this.resourceGridLoadingIndicatorEl) this.resourceGridLoadingIndicatorEl.style.display = 'flex';
        try {
            const newItems = await ChatManager.getMessagesWithResources(
                this._currentResourceChatId, this._currentResourceType,
                this._resourceItems.length, 15
            );
            if (newItems && newItems.length > 0) {
                this._resourceItems.push(...newItems);
                for (let i = this._resourceGridRenderedItemsCount; i < this._resourceItems.length; i++) {
                    const itemEl = this._createResourcePreviewItem(this._resourceItems[i]);
                    if (itemEl && this.resourceGridContainerEl) {
                        this.resourceGridContainerEl.appendChild(itemEl);
                    }
                }
                this._resourceGridRenderedItemsCount = this._resourceItems.length;
            } else if (isInitialLoad && this._resourceItems.length === 0) {
                if (this.resourceGridContainerEl) {
                    const emptyMsg = document.createElement('div');
                    emptyMsg.className = 'resource-grid-empty-message';
                    emptyMsg.textContent = '此分类下暂无资源。';
                    this.resourceGridContainerEl.appendChild(emptyMsg);
                }
            }
        } catch (error) {
            Utils.log(`_loadMoreResources: 加载资源失败 - ${error}`, Utils.logLevels.ERROR);
            NotificationUIManager.showNotification('加载资源失败。', 'error');
        } finally {
            this._isResourceLoading = false;
            if (this.resourceGridLoadingIndicatorEl) this.resourceGridLoadingIndicatorEl.style.display = 'none';
        }
    },
    _createResourcePreviewItem: function(message) {
        const itemEl = document.createElement('div');
        itemEl.className = 'resource-preview-item';
        itemEl.dataset.messageId = message.id;
        itemEl.addEventListener('click', () => {
            if (typeof ChatAreaUIManager !== 'undefined' && ChatAreaUIManager.scrollToMessage) {
                const appContainer = document.querySelector('.app-container');
                const isMobileView = window.innerWidth <= 768;
                if (isMobileView && appContainer && appContainer.classList.contains('show-details')) {
                    if (typeof LayoutUIManager !== 'undefined') LayoutUIManager.showChatAreaLayout();
                    this.hideSidePanel();
                }
                ChatAreaUIManager.scrollToMessage(message.id);
            } else {
                Utils.log(`ChatAreaUIManager 或 scrollToMessage 方法未定义。无法跳转。`, Utils.logLevels.WARN);
            }
        });
        const timestampEl = document.createElement('div');
        timestampEl.className = 'resource-timestamp';
        timestampEl.textContent = Utils.formatDate(new Date(message.timestamp), false);
        itemEl.appendChild(timestampEl);
        if (this._currentResourceType === 'image' && (message.type === 'image' || (message.type === 'file' && message.fileType && message.fileType.startsWith('image/')))) {
            const img = document.createElement('img');
            img.src = message.data;
            img.alt = message.fileName || '图片资源';
            img.className = 'thumbnail';
            itemEl.appendChild(img);
        } else if (this._currentResourceType === 'video' && message.type === 'file' && message.fileType && message.fileType.startsWith('video/')) {
            const video = document.createElement('video');
            video.src = message.data;
            video.className = 'thumbnail';
            video.muted = true;
            const playIcon = document.createElement('div');
            playIcon.textContent = '▶';
            playIcon.style.position = 'absolute'; playIcon.style.fontSize = '2em'; playIcon.style.color = 'white'; playIcon.style.textShadow = '0 0 5px black';
            itemEl.appendChild(video); itemEl.appendChild(playIcon);
        } else if (this._currentResourceType === 'audio' && (message.type === 'audio' || (message.type === 'file' && message.fileType && message.fileType.startsWith('audio/')))) {
            const icon = document.createElement('div'); icon.className = 'audio-icon'; icon.textContent = '🎵'; itemEl.appendChild(icon);
            const nameEl = document.createElement('div'); nameEl.className = 'resource-name';
            nameEl.textContent = message.fileName || (message.type === 'audio' ? `语音 ${message.duration ? Utils.formatTime(message.duration) : ''}` : '音频文件');
            nameEl.title = nameEl.textContent; itemEl.appendChild(nameEl);
        } else if (this._currentResourceType === 'file') {
            const icon = document.createElement('div'); icon.className = 'file-icon'; icon.textContent = '📄'; itemEl.appendChild(icon);
            const nameEl = document.createElement('div'); nameEl.className = 'resource-name';
            nameEl.textContent = message.fileName || '文件';
            nameEl.title = nameEl.textContent; itemEl.appendChild(nameEl);
        } else {
            itemEl.textContent = '未知资源';
        }
        return itemEl;
    },
    _handleResourceGridScroll: function() {
        if (!this.resourceGridContainerEl || this._isResourceLoading) return;
        const { scrollTop, scrollHeight, clientHeight } = this.resourceGridContainerEl;
        if (scrollHeight - scrollTop - clientHeight < 100) {
            this._loadMoreResources();
        }
    },
    _attachResourceScrollListener: function() {
        if (this.resourceGridContainerEl && !this._resourceScrollListenerAttached) {
            this.resourceGridContainerEl.addEventListener('scroll', this._boundHandleResourceGridScroll);
            this._resourceScrollListenerAttached = true;
        }
    },
    _detachResourceScrollListener: function() {
        if (this.resourceGridContainerEl && this._resourceScrollListenerAttached) {
            this.resourceGridContainerEl.removeEventListener('scroll', this._boundHandleResourceGridScroll);
            this._resourceScrollListenerAttached = false;
        }
    }
};