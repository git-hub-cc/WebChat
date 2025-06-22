/**
 * @file DetailsPanelUIManager.js
 * @description 管理应用右侧详情面板的 UI 元素和交互。此面板可以显示当前选定聊天的详细信息（包括联系人信息、群组成员、AI配置、资源预览【对联系人和群组均可用】）或人员大厅。
 *              新增: 群主可查看和编辑群内 AI 的特定提示词。
 *              优化: 当群主修改AI提示词后，会向群内发送系统消息通知。
 *              修复: 主题切换后，添加成员下拉列表现在能正确反映当前主题的AI角色。
 *              更新: 群组成员列表现在显示在线状态和与当前用户的连接状态，并提供重连按钮。
 *              新增: 定期自动刷新群成员状态，并对在线但未连接的成员尝试自动连接。
 *              优化：详情页的群成员顺序调整为：群主第一（无论在线状态），然后是在线人类成员，接着是AI成员，最后是离线人类成员。
 *              更新：群组详情页现在会显示资源预览模块，方便用户跳转到相关的媒体内容，该模块位于所有群组设置之后。
 *              更新：群组详情页的“群成员列表”和“群内AI行为指示”部分现在默认折叠，并可展开/收起。
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
    currentView: null, // 'details' 或 'lobby'
    // _boundTtsConfigCollapseListener: null, // 不再需要，统一处理

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
    groupMemberListHeaderEl: null, // 新增：群成员列表的头部元素
    groupMemberListContainerEl: null, // 新增：群成员列表的容器元素
    groupAiPromptsSectionEl: null, // 新增：群AI提示词部分的容器元素
    groupAiPromptsHeaderEl: null,  // 新增：群AI提示词部分的头部元素
    groupAiPromptsListContainerEl: null, // 新增：群AI提示词列表的容器元素
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

    _groupMemberRefreshInterval: null,
    GROUP_MEMBER_REFRESH_INTERVAL_MS: 3000,

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
        this.groupMemberListHeaderEl = document.getElementById('groupMemberListHeader'); // 获取头部
        this.groupMemberListContainerEl = document.getElementById('groupMemberListContainer'); // 获取内容容器
        this.groupMemberListDetailsEl = document.getElementById('groupMemberListDetails');
        this.groupMemberCountEl = document.getElementById('groupMemberCount');
        this.addGroupMemberAreaEl = document.getElementById('addGroupMemberArea');
        this.leftMembersAreaEl = document.getElementById('leftMembersArea');
        this.contactsDropdownDetailsEl = document.getElementById('contactsDropdownDetails');
        this.addMemberBtnDetailsEl = document.getElementById('addMemberBtnDetails');

        this.groupAiPromptsSectionEl = document.getElementById('groupAiPromptsSection'); // 获取AI提示词区
        this.groupAiPromptsHeaderEl = document.getElementById('groupAiPromptsHeader');   // 获取AI提示词头部
        this.groupAiPromptsListContainerEl = document.getElementById('groupAiPromptsListContainer'); // 获取AI提示词内容容器


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
        this.bindEvents(); // 绑定事件

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
                this.updateDetailsPanelMembers(ChatManager.currentChatId); // 调用更新成员列表的函数
            }
        }
    },

    /**
     * @private
     * 通用的使元素可折叠的辅助函数。
     * @param {HTMLElement|null} headerEl - 点击以触发展开/折叠的头部元素。
     * @param {HTMLElement|null} contentEl - 要展开/折叠的内容元素。
     */
    _makeElementCollapsible: function(headerEl, contentEl) {
        if (headerEl && contentEl) {
            // 确保内容元素有 collapsible-content 类
            contentEl.classList.add('collapsible-content');

            // 确保头部元素有 collapsible-header 类和图标span
            headerEl.classList.add('collapsible-header');
            let icon = headerEl.querySelector('.collapse-icon');
            if (!icon) {
                icon = document.createElement('span');
                icon.className = 'collapse-icon';
                // 尝试智能插入图标，如果header有文本节点，插在其后，否则作为最后一个子节点
                let textNodeFound = false;
                for (let i = 0; i < headerEl.childNodes.length; i++) {
                    if (headerEl.childNodes[i].nodeType === Node.TEXT_NODE && headerEl.childNodes[i].textContent.trim() !== '') {
                        if (headerEl.childNodes[i].nextSibling) {
                            headerEl.insertBefore(icon, headerEl.childNodes[i].nextSibling);
                        } else {
                            headerEl.appendChild(icon);
                        }
                        textNodeFound = true;
                        break;
                    }
                }
                if (!textNodeFound) { // 如果没有文本节点或只有空白文本节点，则直接追加
                    headerEl.appendChild(icon);
                }
            }
            // 根据初始display状态设置图标和active类
            if (contentEl.style.display === 'none' || getComputedStyle(contentEl).display === 'none') {
                icon.textContent = '▶'; // 折叠状态图标
                headerEl.classList.remove('active');
            } else {
                icon.textContent = '▼'; // 展开状态图标
                headerEl.classList.add('active');
            }

            // 移除可能存在的旧监听器，以防重复绑定
            const oldListener = headerEl._collapsibleListener;
            if (oldListener) {
                headerEl.removeEventListener('click', oldListener);
            }

            const newListener = function() { // 定义新的监听器
                this.classList.toggle('active');
                const currentIcon = this.querySelector('.collapse-icon');
                if (contentEl.style.display === "block" || contentEl.style.display === "") {
                    contentEl.style.display = "none";
                    if(currentIcon) currentIcon.textContent = '▶'; // 更新为折叠图标
                } else {
                    contentEl.style.display = "block";
                    if(currentIcon) currentIcon.textContent = '▼'; // 更新为展开图标
                }
            };
            headerEl.addEventListener('click', newListener);
            headerEl._collapsibleListener = newListener; // 保存监听器引用，以便将来移除
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

        // 使用新的辅助函数处理静态可折叠部分
        // 注意: TTS高级选项的折叠将在 TtsUIManager.js 中动态创建时处理
        this._makeElementCollapsible(this.aiTtsConfigHeaderEl, this.aiTtsConfigContentEl);
        this._makeElementCollapsible(this.ttsAttributionHeaderEl, this.ttsAttributionContentEl);
        this._makeElementCollapsible(this.groupMemberListHeaderEl, this.groupMemberListContainerEl); // 新增：群成员列表折叠
        this._makeElementCollapsible(this.groupAiPromptsHeaderEl, this.groupAiPromptsListContainerEl); // 新增：群AI提示词折叠
    },

    /**
     * @private
     * 设置详情面板的可见性及当前视图类型。
     * @param {boolean} show - 是否显示面板。
     * @param {string|null} [viewType=null] - 视图类型 ('details' 或 'lobby')。
     */
    _setPanelVisibility: function(show, viewType = null) {
        const appContainer = document.querySelector('.app-container'); // 获取应用容器
        this.isPanelAreaVisible = show;

        // 先隐藏所有主要内容区域
        if (this.detailsPanelContentEl) this.detailsPanelContentEl.style.display = 'none';
        if (this.peopleLobbyContentEl) this.peopleLobbyContentEl.style.display = 'none';

        // 清除旧的群成员刷新定时器
        if (this._groupMemberRefreshInterval) {
            clearInterval(this._groupMemberRefreshInterval);
            this._groupMemberRefreshInterval = null;
            Utils.log("DetailsPanelUIManager: 已清除群成员刷新定时器。", Utils.logLevels.DEBUG);
        }

        if (show) { // 如果要显示面板
            if (this.detailsPanelEl) this.detailsPanelEl.style.display = 'flex'; // 显示面板本身
            if (appContainer) appContainer.classList.add('show-details'); // 添加类以调整布局

            if (viewType === 'details' && this.detailsPanelContentEl) { // 如果是详情视图
                this.detailsPanelContentEl.style.display = 'block'; // 显示详情内容区
                // 如果当前是群组聊天，启动群成员刷新定时器
                if (ChatManager.currentChatId && ChatManager.currentChatId.startsWith('group_')) {
                    this._startGroupMemberRefreshTimer();
                }
            } else if (viewType === 'lobby' && this.peopleLobbyContentEl) { // 如果是人员大厅视图
                this.peopleLobbyContentEl.style.display = 'flex'; // 显示大厅内容区
            }
            this.currentView = viewType; // 更新当前视图类型
        } else { // 如果要隐藏面板
            if (this.detailsPanelEl) this.detailsPanelEl.style.display = 'none'; // 隐藏面板
            if (appContainer) appContainer.classList.remove('show-details'); // 移除布局调整类
            this.currentView = null; // 清空当前视图类型
            this._detachResourceScrollListener(); // 解绑资源预览滚动监听
        }
    },

    /**
     * 显示主详情内容区域（联系人/群组详情）。
     */
    showMainDetailsContent: function() {
        if (!ChatManager.currentChatId) { // 如果没有选中聊天
            Utils.log("DetailsPanelUIManager: 无法显示详情，没有选中的聊天。", Utils.logLevels.INFO);
            this.hideSidePanel(); // 隐藏面板
            return;
        }
        // 更新面板内容
        this.updateDetailsPanel(ChatManager.currentChatId, ChatManager.currentChatId.startsWith('group_') ? 'group' : 'contact');
        this._setPanelVisibility(true, 'details'); // 设置面板可见，视图类型为详情
        Utils.log("DetailsPanelUIManager: 显示聊天详情视图。", Utils.logLevels.DEBUG);
    },

    /**
     * 显示人员大厅内容区域。
     * @returns {Promise<void>}
     */
    showPeopleLobbyContent: async function() {
        if (this.detailsPanelTitleEl) this.detailsPanelTitleEl.textContent = '人员大厅'; // 设置标题
        // 隐藏聊天详情相关的部分
        if (this.resourcePreviewSectionEl) this.resourcePreviewSectionEl.style.display = 'none';
        if (this.groupAiPromptsSectionEl) this.groupAiPromptsSectionEl.style.display = 'none';
        if (this.detailsGroupManagementEl) this.detailsGroupManagementEl.style.display = 'none';
        if (PeopleLobbyManager) await PeopleLobbyManager.show(); // 调用 PeopleLobbyManager 显示并获取数据
        this._setPanelVisibility(true, 'lobby'); // 设置面板可见，视图类型为大厅
        Utils.log("DetailsPanelUIManager: 显示人员大厅视图。", Utils.logLevels.DEBUG);
    },

    /**
     * 切换聊天详情视图的显示/隐藏状态。
     */
    toggleChatDetailsView: function() {
        if (this.isPanelAreaVisible && this.currentView === 'details') {
            this.hideSidePanel(); // 如果已显示详情，则隐藏
        } else {
            this.showMainDetailsContent(); // 否则显示详情
        }
    },

    /**
     * 切换人员大厅视图的显示/隐藏状态。
     */
    togglePeopleLobbyView: function() {
        if (this.isPanelAreaVisible && this.currentView === 'lobby') {
            this.hideSidePanel(); // 如果已显示大厅，则隐藏
        } else {
            this.showPeopleLobbyContent(); // 否则显示大厅
        }
    },

    /**
     * 隐藏整个右侧详情面板。
     */
    hideSidePanel: function () {
        this._setPanelVisibility(false); // 设置面板不可见
        if (this.detailsPanelTitleEl) this.detailsPanelTitleEl.textContent = '聊天信息'; // 重置标题
        Utils.log("DetailsPanelUIManager: 右侧面板已隐藏。", Utils.logLevels.DEBUG);
    },

    /**
     * 根据当前聊天ID和类型更新聊天详情面板的内容。
     * @param {string} chatId - 当前聊天ID。
     * @param {string} type - 聊天类型 ('contact' 或 'group')。
     */
    updateDetailsPanel: function (chatId, type) {
        if (!this.detailsPanelEl || !this.detailsPanelContentEl) return; // 防御性检查
        this.detailsPanelEl.className = 'details-panel'; // 重置面板类名
        // 先隐藏所有可能显示的特定区域
        [this.contactActionsDetailsEl, this.detailsGroupManagementEl, this.groupActionsDetailsEl,
            this.aiContactAboutSectionEl, this.aiTtsConfigSectionEl,
            this.groupAiPromptsSectionEl, this.resourcePreviewSectionEl]
            .forEach(el => { if (el) el.style.display = 'none'; });

        // 处理通用聊天操作（如清空聊天记录）
        if (this.currentChatActionsDetailsEl && this.clearCurrentChatBtnDetailsEl) {
            this.currentChatActionsDetailsEl.style.display = chatId ? 'block' : 'none';
            if (chatId) { // 重新绑定事件，避免重复
                const newBtn = this.clearCurrentChatBtnDetailsEl.cloneNode(true);
                this.clearCurrentChatBtnDetailsEl.parentNode.replaceChild(newBtn, this.clearCurrentChatBtnDetailsEl);
                this.clearCurrentChatBtnDetailsEl = newBtn;
                this.clearCurrentChatBtnDetailsEl.addEventListener('click', () => MessageManager.clearChat());
            }
        }
        // 根据类型更新特定内容
        if (type === 'contact') {
            this._updateForContact(chatId);
            // 如果是联系人详情，停止群成员刷新
            if (this._groupMemberRefreshInterval) {
                clearInterval(this._groupMemberRefreshInterval);
                this._groupMemberRefreshInterval = null;
            }
        } else if (type === 'group') {
            this._updateForGroup(chatId);
        }
    },

    /**
     * @private
     * 更新面板以显示联系人详情。
     * @param {string} contactId - 联系人ID。
     */
    _updateForContact: function(contactId) {
        const contact = UserManager.contacts[contactId];
        if (!contact || !this.detailsPanelEl) return;
        if (this.detailsPanelTitleEl) this.detailsPanelTitleEl.textContent = `${contact.name} 信息`;
        this.detailsPanelEl.classList.add('contact-details-active');
        // 添加特定主题或状态的类
        if (UserManager.isSpecialContactInCurrentTheme(contactId)) {
            this.detailsPanelEl.classList.add(contact.id); // 用于角色特定样式
        } else if (contact.isAI) { // 历史AI联系人
            this.detailsPanelEl.classList.add('historical-ai-contact-active');
        } else { // 普通人类联系人
            this.detailsPanelEl.classList.add('human-contact-active');
        }
        // 更新名称、ID、头像、状态
        if (this.detailsNameEl) this.detailsNameEl.textContent = contact.name;
        if (this.detailsIdEl) this.detailsIdEl.textContent = `ID: ${contact.id}`;
        if (this.detailsAvatarEl) {
            this.detailsAvatarEl.className = 'details-avatar'; // 重置头像类
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
            if (UserManager.isSpecialContact(contactId)) { // 包括当前主题定义的和历史AI
                this.detailsStatusEl.textContent = (contact.isAI ? 'AI 助手' : '特殊联系人') ;
            } else {
                this.detailsStatusEl.textContent = ConnectionManager.isConnectedTo(contactId) ? '已连接' : '离线';
            }
        }

        // 根据联系人类型显示/隐藏不同操作区
        if (UserManager.isSpecialContact(contactId)) { // 特殊联系人（主题定义或历史AI）
            if (this.contactActionsDetailsEl) this.contactActionsDetailsEl.style.display = 'none'; // 隐藏通用联系人操作
            if (contact.isAI && contact.aboutDetails && this.aiContactAboutSectionEl) { // AI 且有 "关于" 信息
                this._populateAiAboutSection(contact);
                this.aiContactAboutSectionEl.style.display = 'block';
            }
            if (contact.isAI && this.aiTtsConfigSectionEl) { // AI 可配置 TTS
                this._setupAiTtsConfigSection(contact);
                this.aiTtsConfigSectionEl.style.display = 'block';
            }
        } else { // 普通联系人
            if (this.contactActionsDetailsEl) this.contactActionsDetailsEl.style.display = 'block';
            if (this.deleteContactBtnDetailsEl) { // 重新绑定删除按钮事件
                const newBtn = this.deleteContactBtnDetailsEl.cloneNode(true);
                this.deleteContactBtnDetailsEl.parentNode.replaceChild(newBtn, this.deleteContactBtnDetailsEl);
                this.deleteContactBtnDetailsEl = newBtn;
                this.deleteContactBtnDetailsEl.addEventListener('click', () => ChatManager.deleteChat(contactId, 'contact'));
            }
            if (this.aiTtsConfigSectionEl) this.aiTtsConfigSectionEl.style.display = 'none';
            if (this.aiContactAboutSectionEl) this.aiContactAboutSectionEl.style.display = 'none';
        }
        // 隐藏群组相关部分
        if (this.groupAiPromptsSectionEl) this.groupAiPromptsSectionEl.style.display = 'none';
        if (this.detailsGroupManagementEl) this.detailsGroupManagementEl.style.display = 'none';

        // 联系人详情页也显示资源预览
        if (this.resourcePreviewSectionEl && this.resourcePreviewPanelContentEl) {
            this.resourcePreviewSectionEl.style.display = 'block';
            this.resourcePreviewPanelContentEl.style.display = 'flex'; // 确保flex布局
            this._currentResourceChatId = contactId; // 设置当前资源预览的聊天ID
            this._attachResourceScrollListener(); // 附加滚动监听
            this._switchResourceTypeAndLoad(this._currentResourceType); // 加载当前类型的资源
        } else {
            if(this.resourcePreviewSectionEl) this.resourcePreviewSectionEl.style.display = 'none';
            this._detachResourceScrollListener();
        }
    },

    /**
     * @private
     * 填充 AI 联系人的 "关于" 部分。
     * @param {object} contact - AI 联系人对象。
     */
    _populateAiAboutSection: function(contact) {
        if (this.aiContactAboutNameEl) this.aiContactAboutNameEl.textContent = contact.aboutDetails.nameForAbout || contact.name;
        if (this.aiContactAboutNameSubEl) this.aiContactAboutNameSubEl.textContent = contact.aboutDetails.nameForAbout || contact.name;
        if (this.aiContactBasicInfoListEl) {
            this.aiContactBasicInfoListEl.innerHTML = ''; // 清空旧信息
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
     * 设置 AI 联系人的 TTS 配置部分，包括表单填充和折叠逻辑。
     * @param {object} contact - AI 联系人对象。
     */
    _setupAiTtsConfigSection: function(contact) {
        // 使用 TtsUIManager 填充表单
        TtsUIManager.populateAiTtsConfigurationForm(contact, 'ttsConfigFormContainer');
        // 重新绑定保存按钮事件
        if (this.saveAiTtsSettingsBtnDetailsEl) {
            if (TtsUIManager._boundSaveTtsListener) { // 移除旧监听器
                this.saveAiTtsSettingsBtnDetailsEl.removeEventListener('click', TtsUIManager._boundSaveTtsListener);
            }
            TtsUIManager._boundSaveTtsListener = TtsUIManager.handleSaveAiTtsSettings.bind(TtsUIManager, contact.id);
            this.saveAiTtsSettingsBtnDetailsEl.addEventListener('click', TtsUIManager._boundSaveTtsListener);
        }
        // 折叠逻辑已通过 _makeElementCollapsible 在 bindEvents 中处理
        // 但需确保 aiTtsConfigHeaderEl 和 aiTtsConfigContentEl 已被正确获取并在HTML中存在
    },

    /**
     * @private
     * 更新面板以显示群组详情。
     * @param {string} groupId - 群组ID。
     */
    _updateForGroup: function(groupId) {
        const group = GroupManager.groups[groupId];
        if (!group || !this.detailsPanelEl) return;
        if (this.detailsPanelTitleEl) this.detailsPanelTitleEl.textContent = `${group.name} 信息`;
        this.detailsPanelEl.classList.add('group-chat-active');
        // 移除可能存在的旧的联系人特定类
        Array.from(this.detailsPanelEl.classList).forEach(cls => {
            if (cls.startsWith('AI_') || cls.endsWith('-active')) {
                if (cls !== 'group-chat-active' && cls !== 'contact-details-active') { // 保留基础激活类
                    this.detailsPanelEl.classList.remove(cls);
                }
            }
        });
        // 更新名称、ID、头像、状态
        if (this.detailsNameEl) this.detailsNameEl.textContent = group.name;
        if (this.detailsIdEl) this.detailsIdEl.textContent = `群组 ID: ${group.id.substring(6)}`; // 去掉 "group_" 前缀
        if (this.detailsAvatarEl) {
            this.detailsAvatarEl.innerHTML = '👥';
            this.detailsAvatarEl.className = 'details-avatar group'; // 群组特定头像样式
        }
        if (this.detailsStatusEl) this.detailsStatusEl.textContent = `${group.members.length} 名成员 (上限 ${GroupManager.MAX_GROUP_MEMBERS})`;

        // 显示群组管理相关部分
        if (this.detailsGroupManagementEl) this.detailsGroupManagementEl.style.display = 'block';
        if (this.groupActionsDetailsEl) this.groupActionsDetailsEl.style.display = 'block';

        const isOwner = group.owner === UserManager.userId; // 判断是否为群主
        // 控制添加成员和已离开成员区域的显隐
        if (this.addGroupMemberAreaEl) this.addGroupMemberAreaEl.style.display = isOwner ? 'block' : 'none';
        if (this.leftMembersAreaEl) this.leftMembersAreaEl.style.display = isOwner && group.leftMembers && group.leftMembers.length > 0 ? 'block' : 'none';

        // 重新绑定离开/解散按钮事件
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
        this.updateDetailsPanelMembers(groupId); // 更新成员列表

        // AI提示词管理部分
        if (this.groupAiPromptsSectionEl && isOwner) { // 只有群主能看到和编辑
            const aiMembersInGroup = group.members.filter(memberId => UserManager.contacts[memberId]?.isAI);
            if (aiMembersInGroup.length > 0) {
                this.groupAiPromptsSectionEl.style.display = 'block';
                // 确保折叠头部是可见的
                if(this.groupAiPromptsHeaderEl) this.groupAiPromptsHeaderEl.style.display = 'flex'; // 或 'block'
                this._populateGroupAiPromptsEditor(groupId, group, aiMembersInGroup);
            } else {
                this.groupAiPromptsSectionEl.style.display = 'none';
            }
        } else if (this.groupAiPromptsSectionEl) { // 非群主隐藏
            this.groupAiPromptsSectionEl.style.display = 'none';
        }

        // 隐藏联系人特定部分
        if (this.aiContactAboutSectionEl) this.aiContactAboutSectionEl.style.display = 'none';
        if (this.aiTtsConfigSectionEl) this.aiTtsConfigSectionEl.style.display = 'none';

        // 显示资源预览 (群组详情页也显示) - 将其移动到所有群组操作按钮之后
        if (this.resourcePreviewSectionEl && this.resourcePreviewPanelContentEl) {
            this.resourcePreviewSectionEl.style.display = 'block';
            this.resourcePreviewPanelContentEl.style.display = 'flex';
            this._currentResourceChatId = groupId;
            this._attachResourceScrollListener();
            this._switchResourceTypeAndLoad(this._currentResourceType);

            // 确保资源预览部分在所有其他内容之后
            // 将 resourcePreviewSectionEl 移动到 detailsPanelContentEl 的末尾
            if (this.detailsPanelContentEl && this.detailsPanelContentEl.lastChild !== this.resourcePreviewSectionEl) {
                this.detailsPanelContentEl.appendChild(this.resourcePreviewSectionEl);
            }

        } else {
            if(this.resourcePreviewSectionEl) this.resourcePreviewSectionEl.style.display = 'none';
            this._detachResourceScrollListener();
        }

        // 如果当前是这个群组且面板可见，启动群成员刷新
        if (ChatManager.currentChatId === groupId && this.isPanelAreaVisible && this.currentView === 'details') {
            this._startGroupMemberRefreshTimer();
        }
    },

    /**
     * @private
     * 填充群组内AI提示词的编辑器。
     * @param {string} groupId - 群组ID。
     * @param {object} group - 群组对象。
     * @param {Array<string>} aiMemberIds - 群内AI成员的ID列表。
     */
    _populateGroupAiPromptsEditor: function(groupId, group, aiMemberIds) {
        if (!this.groupAiPromptsListContainerEl) {
            Utils.log("DetailsPanelUIManager: groupAiPromptsListContainerEl 未找到，无法填充AI提示词编辑器。", Utils.logLevels.ERROR);
            return;
        }
        this.groupAiPromptsListContainerEl.innerHTML = ''; // 清空旧的编辑器项
        aiMemberIds.forEach(aiId => {
            const aiContact = UserManager.contacts[aiId];
            if (!aiContact || !aiContact.isAI) return; // 跳过无效的AI成员

            const itemDiv = document.createElement('div');
            itemDiv.className = 'ai-prompt-editor-item';
            itemDiv.dataset.aiId = aiId; // 存储AI ID 以便保存时使用

            const nameHeader = document.createElement('h5');
            nameHeader.textContent = `AI角色: ${aiContact.name}`;
            itemDiv.appendChild(nameHeader);

            // 获取当前提示词 (群组特定 > AI默认)
            let currentPromptText = "";
            if (group.aiPrompts && group.aiPrompts[aiId] !== undefined) {
                currentPromptText = group.aiPrompts[aiId];
            } else if (aiContact.aiConfig && aiContact.aiConfig.systemPrompt !== undefined) {
                currentPromptText = aiContact.aiConfig.systemPrompt;
            }

            const promptTextarea = document.createElement('textarea');
            promptTextarea.value = currentPromptText;
            promptTextarea.placeholder = "输入此AI在群组中的特定行为指示...";
            promptTextarea.rows = 3; // 合理的默认行数
            promptTextarea.className = 'group-ai-prompt-textarea'; // 用于可能的特定样式
            itemDiv.appendChild(promptTextarea);

            const buttonContainer = document.createElement('div'); // 用于按钮布局
            buttonContainer.style.marginTop = '8px';
            buttonContainer.style.display = 'flex';
            buttonContainer.style.gap = '8px';


            const saveBtn = document.createElement('button');
            saveBtn.textContent = '保存指示';
            saveBtn.className = 'btn btn-primary btn-sm'; // 使用小号按钮
            saveBtn.addEventListener('click', async () => {
                const newPrompt = promptTextarea.value.trim();
                let promptChanged = false;
                if (!group.aiPrompts) group.aiPrompts = {}; // 确保aiPrompts对象存在

                // 检查提示词是否真的改变
                if ((group.aiPrompts[aiId] === undefined && newPrompt !== "") || (group.aiPrompts[aiId] !== undefined && group.aiPrompts[aiId] !== newPrompt)) {
                    group.aiPrompts[aiId] = newPrompt;
                    promptChanged = true;
                }

                if (promptChanged) {
                    await GroupManager.saveGroup(groupId); // 保存到数据库
                    // 通知群成员提示词已更改
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

                // 检查是否需要更新/删除群组特定提示词
                if (group.aiPrompts && group.aiPrompts[aiId] !== undefined && group.aiPrompts[aiId] !== defaultPrompt) {
                    group.aiPrompts[aiId] = defaultPrompt; // 重置为默认
                    promptChanged = true;
                } else if (group.aiPrompts && group.aiPrompts[aiId] === undefined && defaultPrompt !== "") {
                    // 如果之前没有群组特定，现在要设置为非空的默认值
                    group.aiPrompts[aiId] = defaultPrompt;
                    promptChanged = true;
                } else if (group.aiPrompts && group.aiPrompts[aiId] !== undefined && defaultPrompt === "" && group.aiPrompts[aiId] !== "") {
                    // 如果默认是空，但之前有群组特定，则删除群组特定
                    delete group.aiPrompts[aiId];
                    promptChanged = true;
                }

                promptTextarea.value = defaultPrompt; // 更新文本框
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
     * 更新群组详情中的成员列表和添加成员下拉框。
     * @param {string} groupId - 群组ID。
     */
    updateDetailsPanelMembers: function (groupId) {
        const group = GroupManager.groups[groupId];
        if (!group || !this.groupMemberListDetailsEl || !this.groupMemberCountEl || !this.contactsDropdownDetailsEl || !document.getElementById('leftMemberListDetails')) return;
        const leftMemberListDetailsEl = document.getElementById('leftMemberListDetails');
        this.groupMemberListDetailsEl.innerHTML = ''; // 清空现有成员列表
        this.groupMemberCountEl.textContent = group.members.length; // 更新成员数量

        // 准备成员数据以便排序
        const membersWithSortInfo = group.members.map(memberId => {
            const member = UserManager.contacts[memberId] || { id: memberId, name: `用户 ${memberId.substring(0, 4)}`, isAI: false }; // 默认值
            let sortCategory;
            const isOwner = memberId === group.owner;
            const isAI = member.isAI;
            // 检查是否在大厅的在线用户列表中 (非AI且非群主)
            const isOnline = (!isAI && !isOwner && PeopleLobbyManager.onlineUserIds && PeopleLobbyManager.onlineUserIds.includes(memberId));

            // 分类排序：0-群主, 1-在线人类, 2-AI, 3-离线人类
            if (isOwner) {
                sortCategory = 0;
            } else if (!isAI && isOnline) {
                sortCategory = 1;
            } else if (isAI) {
                sortCategory = 2;
            } else { // 离线人类
                sortCategory = 3;
            }
            return { ...member, id: memberId, sortCategory, isOnlineForSort: isOnline }; // 包含排序类别和在线状态
        });

        // 排序
        membersWithSortInfo.sort((a, b) => {
            if (a.sortCategory !== b.sortCategory) { // 先按类别排序
                return a.sortCategory - b.sortCategory;
            }
            return (a.name || '').localeCompare(b.name || '', undefined, { sensitivity: 'base' }); // 同类别内按名称排序
        });

        // 渲染排序后的成员列表
        membersWithSortInfo.forEach(memberData => {
            const memberId = memberData.id;
            const member = memberData; // 已包含排序信息

            const item = document.createElement('div');
            item.className = 'member-item-detail';

            let memberInfoHtml = `<span class="member-name">${Utils.escapeHtml(member.name)} ${memberId === UserManager.userId ? '(您)' : ''} ${member.isAI ? '(AI)' : ''}</span>`;
            let statusHtml = '';
            let actionsHtml = '';

            // 处理非AI、非当前用户的成员状态和操作
            if (memberId !== UserManager.userId && !member.isAI) {
                const isConnected = ConnectionManager.isConnectedTo(memberId);
                const isActuallyOnline = PeopleLobbyManager.onlineUserIds ? PeopleLobbyManager.onlineUserIds.includes(memberId) : false;

                let onlineStatusText = isActuallyOnline ? '在线' : '离线';
                let statusClass = 'offline'; // 默认离线样式

                if(isActuallyOnline){ // 如果在大厅中在线
                    statusClass = isConnected ? 'connected' : 'online-not-connected'; // 根据连接状态设置样式
                }
                if(isConnected) onlineStatusText = '已连接'; // 如果已连接，状态文本覆盖

                statusHtml = `<span class="member-status ${statusClass}">(${onlineStatusText})</span>`;
                if (!isConnected && isActuallyOnline) { // 如果在线但未连接，显示重连按钮
                    actionsHtml += `<button class="reconnect-member-btn-detail" data-member-id="${memberId}" title="重新连接">🔄</button>`;
                }
            }

// 如果当前用户是群主，且成员不是群主自己，则显示移除按钮
            if (memberId === group.owner) {
                memberInfoHtml += '<span class="owner-badge">群主</span>';
            } else if (group.owner === UserManager.userId) {
                actionsHtml += `<button class="remove-member-btn-detail" data-member-id="${memberId}" title="移除成员">✕</button>`;
            }
            item.innerHTML = `${memberInfoHtml} ${statusHtml} <span class="member-actions">${actionsHtml}</span>`;
            this.groupMemberListDetailsEl.appendChild(item);
        });


// 重新绑定移除成员按钮事件
        this.groupMemberListDetailsEl.querySelectorAll('.remove-member-btn-detail').forEach(btn => {
            const newBtn = btn.cloneNode(true); // 克隆以移除旧监听器
            btn.parentNode.replaceChild(newBtn, btn);
            newBtn.addEventListener('click', () => GroupManager.removeMemberFromGroup(groupId, newBtn.dataset.memberId));
        });

// 重新绑定重连成员按钮事件
        this.groupMemberListDetailsEl.querySelectorAll('.reconnect-member-btn-detail').forEach(btn => {
            const newBtn = btn.cloneNode(true);
            btn.parentNode.replaceChild(newBtn, btn);
            newBtn.addEventListener('click', async () => {
                const targetMemberId = newBtn.dataset.memberId;
                NotificationUIManager.showNotification(`尝试重新连接到 ${UserManager.contacts[targetMemberId]?.name || targetMemberId.substring(0,4)}...`, 'info');
                await ConnectionManager.createOffer(targetMemberId, { isSilent: false }); // 非静默尝试连接
            });
        });

// 填充添加成员下拉框
        this.contactsDropdownDetailsEl.innerHTML = '<option value="">选择要添加的联系人...</option>';
        Object.values(UserManager.contacts).forEach(contact => {
            const isAlreadyMember = group.members.includes(contact.id);
            const hasLeft = group.leftMembers?.some(lm => lm.id === contact.id); // 是否已离开过
            // 可添加的AI：当前主题定义的特殊AI
            const isAddableCurrentThemeAI = UserManager.isSpecialContactInCurrentTheme(contact.id) && contact.isAI;
            // 可添加的普通联系人
            const isRegularContact = !contact.isSpecial && !contact.isAI;

            if (!isAlreadyMember && !hasLeft && (isAddableCurrentThemeAI || isRegularContact)) {
                const option = document.createElement('option');
                option.value = contact.id;
                option.textContent = `${contact.name} ${contact.isAI ? '(AI助手)' : ''}`;
                this.contactsDropdownDetailsEl.appendChild(option);
            }
        });

// 填充已离开成员列表
        leftMemberListDetailsEl.innerHTML = '';
        if (group.owner === UserManager.userId && group.leftMembers && group.leftMembers.length > 0 && this.leftMembersAreaEl) {
            group.leftMembers.forEach(leftMember => {
                const item = document.createElement('div');
                item.className = 'left-member-item-detail';
                item.innerHTML = `<span>${Utils.escapeHtml(leftMember.name)} (离开于: ${Utils.formatDate(new Date(leftMember.leftTime))})</span>
<button class="re-add-member-btn-detail" data-member-id="${leftMember.id}" data-member-name="${Utils.escapeHtml(leftMember.name)}" title="重新添加成员">+</button>`;
                leftMemberListDetailsEl.appendChild(item);
            });
            // 重新绑定重新添加按钮事件
            leftMemberListDetailsEl.querySelectorAll('.re-add-member-btn-detail').forEach(btn => {
                const newBtn = btn.cloneNode(true);
                btn.parentNode.replaceChild(newBtn, btn);
                newBtn.addEventListener('click', () => GroupManager.addMemberToGroup(groupId, newBtn.dataset.memberId, newBtn.dataset.memberName));
            });
            this.leftMembersAreaEl.style.display = 'block'; // 显示已离开成员区域
        } else if (this.leftMembersAreaEl) {
            this.leftMembersAreaEl.style.display = 'none'; // 隐藏区域
        }
    },

    /**
     * 处理从详情面板添加成员到当前群组的逻辑。
     */
    handleAddMemberToGroupDetails: function () {
        const groupId = ChatManager.currentChatId;
        if (!this.contactsDropdownDetailsEl) return;
        const memberId = this.contactsDropdownDetailsEl.value;
        const memberName = this.contactsDropdownDetailsEl.selectedOptions[0]?.text.replace(/\s*\(AI助手\)$/, '').trim(); // 获取名称并移除AI助手后缀
        if (groupId && memberId) {
            GroupManager.addMemberToGroup(groupId, memberId, memberName).then(success => {
                if (success && this.contactsDropdownDetailsEl) this.contactsDropdownDetailsEl.value = ""; // 成功后清空下拉框
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
        if (this._groupMemberRefreshInterval) { // 如果已有定时器，先清除
            clearInterval(this._groupMemberRefreshInterval);
            this._groupMemberRefreshInterval = null;
        }
        this._refreshGroupMembersAndAutoConnect(); // 立即执行一次
        this._groupMemberRefreshInterval = setInterval(() => {
            // 检查是否仍需刷新（面板可见、详情视图、群聊）
            if (this.isPanelAreaVisible && this.currentView === 'details' &&
                ChatManager.currentChatId && ChatManager.currentChatId.startsWith('group_')) {
                this._refreshGroupMembersAndAutoConnect();
            } else { // 如果条件不满足，则停止定时器
                if (this._groupMemberRefreshInterval) {
                    clearInterval(this._groupMemberRefreshInterval);
                    this._groupMemberRefreshInterval = null;
                    Utils.log("DetailsPanelUIManager: 群组成员自动刷新定时器已停止（条件不满足）。", Utils.logLevels.DEBUG);
                }
            }
        }, this.GROUP_MEMBER_REFRESH_INTERVAL_MS); // 按设定的间隔执行
        Utils.log("DetailsPanelUIManager: 已启动群成员状态自动刷新和连接定时器。", Utils.logLevels.DEBUG);
    },

    /**
     * @private
     * 刷新群成员状态并对在线但未连接的成员尝试自动连接。
     * @returns {Promise<void>}
     */
    _refreshGroupMembersAndAutoConnect: async function() {
        const groupId = ChatManager.currentChatId;
        if (!groupId || !groupId.startsWith('group_')) return; // 确保是群聊
        const group = GroupManager.groups[groupId];
        if (!group) return; // 确保群组存在

        // 获取最新的在线用户列表
        if (PeopleLobbyManager && typeof PeopleLobbyManager.fetchOnlineUsers === 'function') {
            await PeopleLobbyManager.fetchOnlineUsers();
        }
        this.updateDetailsPanelMembers(groupId); // 更新成员列表UI
        Utils.log(`DetailsPanelUIManager: 定时刷新群成员 (${groupId}) 状态。`, Utils.logLevels.DEBUG);

        // 尝试自动连接在线但未连接的成员
        group.members.forEach(memberId => {
            // 跳过自己和AI成员
            if (memberId === UserManager.userId || (UserManager.contacts[memberId] && UserManager.contacts[memberId].isAI)) {
                return;
            }
            const isConnected = ConnectionManager.isConnectedTo(memberId);
            const isOnline = PeopleLobbyManager.onlineUserIds ? PeopleLobbyManager.onlineUserIds.includes(memberId) : false;

            if (isOnline && !isConnected) { // 如果在线但未连接
                Utils.log(`DetailsPanelUIManager: 自动尝试连接到群成员 ${memberId} (在线但未连接)。`, Utils.logLevels.INFO);
                ConnectionManager.createOffer(memberId, { isSilent: true }); // 静默尝试连接
            }
        });
    },


    /**
     * @private
     * 切换资源预览的类型并加载数据。
     * @param {string} resourceType - 要切换到的资源类型。
     */
    _switchResourceTypeAndLoad: function(resourceType) {
        if (!this._currentResourceChatId || !this.resourceGridContainerEl) return;
        Utils.log(`DetailsPanelUIManager: 切换到资源类型: ${resourceType} for chat ${this._currentResourceChatId}`, Utils.logLevels.DEBUG);
        this._currentResourceType = resourceType; // 更新当前资源类型
        this._resourceItems = []; // 清空已加载项
        this._resourceGridRenderedItemsCount = 0; // 重置已渲染计数
        this.resourceGridContainerEl.innerHTML = ''; // 清空网格
        // 更新标签页的激活状态
        for (const type in this.resourceCategoryButtons) {
            if (this.resourceCategoryButtons[type]) {
                this.resourceCategoryButtons[type].classList.toggle('active', type === resourceType);
            }
        }
        this._loadMoreResources(true); // 初始加载新类型的资源
    },
    /**
     * @private
     * 异步加载更多资源并渲染到网格中。
     * @param {boolean} [isInitialLoad=false] - 是否为初始加载。
     */
    _loadMoreResources: async function(isInitialLoad = false) {
        if (this._isResourceLoading || !this._currentResourceChatId) return; // 防止重复加载或在无聊天时加载
        this._isResourceLoading = true; // 设置加载状态
        if (this.resourceGridLoadingIndicatorEl) this.resourceGridLoadingIndicatorEl.style.display = 'flex'; // 显示加载指示器
        try {
            const newItems = await ChatManager.getMessagesWithResources( // 从ChatManager获取资源消息
                this._currentResourceChatId, this._currentResourceType,
                this._resourceItems.length, 15 // 从当前已加载数量开始，每次加载15个
            );
            if (newItems && newItems.length > 0) { // 如果有新项目
                this._resourceItems.push(...newItems); // 添加到总列表
                // 渲染新加载的项目
                for (let i = this._resourceGridRenderedItemsCount; i < this._resourceItems.length; i++) {
                    const itemEl = this._createResourcePreviewItem(this._resourceItems[i]);
                    if (itemEl && this.resourceGridContainerEl) {
                        this.resourceGridContainerEl.appendChild(itemEl);
                    }
                }
                this._resourceGridRenderedItemsCount = this._resourceItems.length; // 更新已渲染计数
            } else if (isInitialLoad && this._resourceItems.length === 0) { // 如果是初始加载且无项目
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
            this._isResourceLoading = false; // 重置加载状态
            if (this.resourceGridLoadingIndicatorEl) this.resourceGridLoadingIndicatorEl.style.display = 'none'; // 隐藏加载指示器
        }
    },
    /**
     * @private
     * 根据消息对象创建资源预览项的 DOM 元素。
     * @param {object} message - 包含资源的消息对象。
     * @returns {HTMLElement|null} - 创建的 DOM 元素，或在无法创建时返回 null。
     */
    _createResourcePreviewItem: function(message) {
        const itemEl = document.createElement('div');
        itemEl.className = 'resource-preview-item';
        itemEl.dataset.messageId = message.id; // 存储消息ID，用于跳转
        // 点击预览项时跳转到聊天中的对应消息
        itemEl.addEventListener('click', () => {
            if (typeof ChatAreaUIManager !== 'undefined' && ChatAreaUIManager.scrollToMessage) {
                const appContainer = document.querySelector('.app-container');
                const isMobileView = window.innerWidth <= 768; // 判断是否为移动端视图
                // 如果在移动端且详情面板可见，则先切换回聊天视图并隐藏面板
                if (isMobileView && appContainer && appContainer.classList.contains('show-details')) {
                    if (typeof LayoutUIManager !== 'undefined') LayoutUIManager.showChatAreaLayout();
                    this.hideSidePanel();
                }
                ChatAreaUIManager.scrollToMessage(message.id); // 调用滚动方法
            } else {
                Utils.log(`ChatAreaUIManager 或 scrollToMessage 方法未定义。无法跳转。`, Utils.logLevels.WARN);
            }
        });
        // 显示时间戳
        const timestampEl = document.createElement('div');
        timestampEl.className = 'resource-timestamp';
        timestampEl.textContent = Utils.formatDate(new Date(message.timestamp), false); // 格式化时间戳 (不含时间)
        itemEl.appendChild(timestampEl);
        // 根据资源类型创建不同的预览内容
        if (this._currentResourceType === 'image' && (message.type === 'image' || (message.type === 'file' && message.fileType && message.fileType.startsWith('image/')))) {
            const img = document.createElement('img');
            img.src = message.data; // 图片数据URL
            img.alt = message.fileName || '图片资源';
            img.className = 'thumbnail'; // 应用缩略图样式
            itemEl.appendChild(img);
        } else if (this._currentResourceType === 'video' && message.type === 'file' && message.fileType && message.fileType.startsWith('video/')) {
            const video = document.createElement('video');
            video.src = message.data; // 视频数据URL
            video.className = 'thumbnail';
            video.muted = true; // 默认静音
            const playIcon = document.createElement('div'); // 播放图标覆盖层
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
        } else { // 未知类型
            itemEl.textContent = '未知资源';
        }
        return itemEl;
    },
    /**
     * @private
     * 处理资源网格的滚动事件，用于无限加载。
     */
    _handleResourceGridScroll: function() {
        if (!this.resourceGridContainerEl || this._isResourceLoading) return;
        const { scrollTop, scrollHeight, clientHeight } = this.resourceGridContainerEl;
        // 当滚动到底部附近时加载更多
        if (scrollHeight - scrollTop - clientHeight < 100) {
            this._loadMoreResources();
        }
    },
    /**
     * @private
     * 附加资源网格的滚动事件监听器。
     */
    _attachResourceScrollListener: function() {
        if (this.resourceGridContainerEl && !this._resourceScrollListenerAttached) {
            this.resourceGridContainerEl.addEventListener('scroll', this._boundHandleResourceGridScroll);
            this._resourceScrollListenerAttached = true;
        }
    },
    /**
     * @private
     * 解绑资源网格的滚动事件监听器。
     */
    _detachResourceScrollListener: function() {
        if (this.resourceGridContainerEl && this._resourceScrollListenerAttached) {
            this.resourceGridContainerEl.removeEventListener('scroll', this._boundHandleResourceGridScroll);
            this._resourceScrollListenerAttached = false;
        }
    }
};