/**
 * @file DetailsPanelUIManager.js
 * @description 管理应用右侧详情面板的 UI 元素和交互。此面板可以显示当前选定聊天的详细信息（包括联系人信息、群组成员、AI配置、资源预览）或人员大厅。
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
 * @dependencies UserManager, GroupManager, ChatManager, MessageManager, TtsUIManager, NotificationUIManager, Utils, ConnectionManager, PeopleLobbyManager, Config, LayoutUIManager
 * @dependents AppInitializer (进行初始化), ChatAreaUIManager (通过按钮点击调用以切换面板显隐)
 */
const DetailsPanelUIManager = {
    isPanelAreaVisible: false, // 标记右侧面板区域当前是否可见
    currentView: null, // 当前显示的视图类型: 'details' (聊天详情), 'lobby' (人员大厅), 或 null (隐藏时)
    _boundTtsConfigCollapseListener: null, // 用于AI TTS配置区域折叠功能的事件监听器绑定
    // _boundResourcePreviewCollapseListener 已移除，因为资源预览不再设计为可折叠

    detailsPanelEl: null, // 整个右侧详情面板的根元素
    detailsPanelTitleEl: null, // 面板顶部的标题元素
    closeDetailsBtnMainEl: null, // 关闭面板的按钮

    // 主聊天详情内容区域的元素
    detailsPanelContentEl: null, // 包裹聊天特定详情的容器
    detailsNameEl: null, // 显示联系人/群组名称的元素
    detailsIdEl: null, // 显示联系人/群组ID的元素
    detailsAvatarEl: null, // 显示联系人/群组头像的元素
    detailsStatusEl: null, // 显示联系人状态或群组成员数量的元素
    contactActionsDetailsEl: null, // 包含联系人操作按钮（如删除）的容器
    currentChatActionsDetailsEl: null, // 包含当前聊天操作按钮（如清空聊天）的容器
    clearCurrentChatBtnDetailsEl: null, // 清空当前聊天记录的按钮
    deleteContactBtnDetailsEl: null, // 删除联系人的按钮
    detailsGroupManagementEl: null, // 群组管理相关的UI容器
    groupActionsDetailsEl: null, // 包含群组操作按钮（如离开/解散）的容器
    leaveGroupBtnDetailsEl: null, // 离开群组的按钮
    dissolveGroupBtnDetailsEl: null, // 解散群组的按钮
    aiContactAboutSectionEl: null, // AI联系人“关于”信息部分的容器
    aiContactAboutNameEl: null, // AI联系人“关于”部分的名称显示
    aiContactBasicInfoListEl: null, // AI联系人“关于”部分的基础信息列表
    aiContactAboutNameSubEl: null, // AI联系人“关于”部分的副名称（重复名称，可能用于不同布局）
    aiContactAboutTextEl: null, // AI联系人“关于”部分的详细描述文本
    aiTtsConfigSectionEl: null, // AI联系人TTS（文本转语音）配置部分的容器
    aiTtsConfigHeaderEl: null, // AI TTS配置部分的折叠头部
    aiTtsConfigContentEl: null, // AI TTS配置部分的折叠内容区域
    saveAiTtsSettingsBtnDetailsEl: null, // 保存AI TTS设置的按钮
    groupMemberListDetailsEl: null, // 群组成员列表的容器
    groupMemberCountEl: null, // 显示群组成员数量的元素
    addGroupMemberAreaEl: null, // 添加群组成员区域的容器 (仅群主可见)
    leftMembersAreaEl: null, // 显示已离开群组成员列表的区域 (仅群主可见)
    contactsDropdownDetailsEl: null, // 添加新成员时选择联系人的下拉列表
    addMemberBtnDetailsEl: null, // 添加选中联系人到群组的按钮
    ttsAttributionHeaderEl: null, // TTS服务提供商标注信息的折叠头部
    ttsAttributionContentEl: null, // TTS服务提供商标注信息的折叠内容区域

    // 人员大厅内容区域的元素
    peopleLobbyContentEl: null, // 人员大厅视图的根容器

    // 聊天资源预览相关的元素 (现在是聊天详情的一部分，主要对联系人聊天可见)
    resourcePreviewSectionEl: null, // 整个资源预览部分的容器
    resourcePreviewHeaderTitleEl: null, // 资源预览部分的标题 (原 resourcePreviewHeaderEl)
    resourcePreviewPanelContentEl: null, // 资源预览面板实际内容的容器
    resourceCategoryTabsContainerEl: null, // 资源分类标签（图片、视频等）的容器
    resourceCategoryButtons: {}, // 存储按类型分类的资源标签按钮的引用
    resourceGridContainerEl: null, // 显示资源缩略图的网格容器
    resourceGridLoadingIndicatorEl: null, // 加载更多资源时显示的加载指示器
    _currentResourceChatId: null, // 当前正在预览资源的聊天ID
    _currentResourceType: 'image', // 当前选中的资源类型，默认为图片
    _resourceItems: [], // 当前已加载的资源消息对象数组
    _resourceGridRenderedItemsCount: 0, // 已在网格中渲染的资源项目数量
    _isResourceLoading: false, // 标记是否正在加载更多资源（防止重复加载）
    _resourceScrollListenerAttached: false, // 标记资源网格的滚动监听器是否已附加
    _boundHandleResourceGridScroll: null, // 绑定到this的资源网格滚动处理函数

    /**
     * 初始化模块。获取所有必要的DOM元素引用，并绑定初始事件监听器。
     */
    init: function() {
        this.detailsPanelEl = document.getElementById('detailsPanel');
        this.detailsPanelTitleEl = document.getElementById('detailsPanelTitle');
        this.closeDetailsBtnMainEl = document.getElementById('closeDetailsBtnMain');

        // 主聊天详情相关的DOM元素获取
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
        this.leftMembersAreaEl = document.getElementById('leftMembersArea'); // 假设HTML中已存在此ID
        this.contactsDropdownDetailsEl = document.getElementById('contactsDropdownDetails');
        this.addMemberBtnDetailsEl = document.getElementById('addMemberBtnDetails');
        this.ttsAttributionHeaderEl = document.getElementById('ttsAttributionCollapsibleTrigger');
        this.ttsAttributionContentEl = document.getElementById('ttsAttributionCollapsibleContent');

        // 人员大厅相关的DOM元素获取
        this.peopleLobbyContentEl = document.getElementById('peopleLobbyContent');

        // 聊天资源预览相关的DOM元素获取
        this.resourcePreviewSectionEl = document.getElementById('resourcePreviewSection');
        this.resourcePreviewHeaderTitleEl = document.getElementById('resourcePreviewHeaderTitle'); // 获取资源预览的标题元素
        this.resourcePreviewPanelContentEl = document.getElementById('resourcePreviewPanelContent');
        this.resourceCategoryTabsContainerEl = document.getElementById('resourceCategoryTabsContainer');
        this.resourceGridContainerEl = document.getElementById('resourceGridContainer');
        this.resourceGridLoadingIndicatorEl = document.getElementById('resourceGridLoadingIndicator');

        // 初始化资源分类标签按钮的事件监听
        if (this.resourceCategoryTabsContainerEl) {
            const buttons = this.resourceCategoryTabsContainerEl.querySelectorAll('.resource-category-tab');
            buttons.forEach(btn => {
                const type = btn.dataset.resourceType;
                if (type) {
                    this.resourceCategoryButtons[type] = btn; // 存储按钮引用
                    btn.addEventListener('click', () => this._switchResourceTypeAndLoad(type)); // 点击时切换类型并加载
                }
            });
        }
        this._boundHandleResourceGridScroll = this._handleResourceGridScroll.bind(this); // 绑定滚动处理函数

        this.bindEvents(); // 绑定其他通用事件
    },

    /**
     * 绑定模块所需的事件监听器。
     * 例如关闭按钮、添加群成员按钮、以及TTS信息和AI TTS配置的折叠功能。
     */
    bindEvents: function() {
        if (this.closeDetailsBtnMainEl) {
            this.closeDetailsBtnMainEl.addEventListener('click', () => this.hideSidePanel());
        }
        if (this.addMemberBtnDetailsEl) {
            this.addMemberBtnDetailsEl.addEventListener('click', () => this.handleAddMemberToGroupDetails());
        }
        // 资源预览部分已不再设计为可折叠，相关事件绑定已移除

        // TTS 服务提供商标注信息的折叠/展开逻辑
        if (this.ttsAttributionHeaderEl && this.ttsAttributionContentEl) {
            this.ttsAttributionHeaderEl.addEventListener('click', () => {
                const header = this.ttsAttributionHeaderEl;
                const content = this.ttsAttributionContentEl;
                header.classList.toggle('active'); // 切换激活状态的CSS类
                const icon = header.querySelector('.collapse-icon'); // 获取折叠图标
                if (content.style.display === "block" || content.style.display === "") { // 如果内容区是展开的
                    content.style.display = "none"; // 则折叠
                    if(icon) icon.textContent = '▶'; // 更新图标为指向右方
                } else { // 如果内容区是折叠的
                    content.style.display = "block"; // 则展开
                    if(icon) icon.textContent = '▼'; // 更新图标为指向下方
                }
            });
            // 初始化图标状态基于内容区域的初始显示状态
            const icon = this.ttsAttributionHeaderEl.querySelector('.collapse-icon');
            if (this.ttsAttributionContentEl.style.display === 'none') {
                if(icon) icon.textContent = '▶'; this.ttsAttributionHeaderEl.classList.remove('active');
            } else {
                if(icon) icon.textContent = '▼'; this.ttsAttributionHeaderEl.classList.add('active');
            }
        }
    },

    /**
     * @description 统一控制右侧详情面板的显示与隐藏，并管理当前视图状态。
     * @param {boolean} show - true 表示显示面板，false 表示隐藏。
     * @param {string} [viewType=null] - 如果显示面板，指定要显示的视图类型 ('details' 或 'lobby')。
     * @private
     */
    _setPanelVisibility: function(show, viewType = null) {
        const appContainer = document.querySelector('.app-container'); // 应用主容器，用于辅助布局调整
        this.isPanelAreaVisible = show; // 更新面板可见性状态

        // 默认隐藏所有可能的子视图内容区域
        if (this.detailsPanelContentEl) this.detailsPanelContentEl.style.display = 'none';
        if (this.peopleLobbyContentEl) this.peopleLobbyContentEl.style.display = 'none';
        // 资源预览面板的显隐由其父section (resourcePreviewSectionEl) 控制，
        // 而 resourcePreviewSectionEl 的显隐逻辑在 updateDetailsPanel 方法中根据聊天类型（联系人/群组）决定。

        if (show) { // 如果要显示面板
            if (this.detailsPanelEl) this.detailsPanelEl.style.display = 'flex'; // 显示面板的根元素
            if (appContainer) appContainer.classList.add('show-details'); // 给应用容器添加类名，辅助CSS进行布局调整

            // 根据 viewType 显示对应的子视图内容
            if (viewType === 'details' && this.detailsPanelContentEl) {
                this.detailsPanelContentEl.style.display = 'block';
            } else if (viewType === 'lobby' && this.peopleLobbyContentEl) {
                this.peopleLobbyContentEl.style.display = 'flex';
            }
            this.currentView = viewType; // 更新当前视图类型
        } else { // 如果要隐藏面板
            if (this.detailsPanelEl) this.detailsPanelEl.style.display = 'none'; // 隐藏面板的根元素
            if (appContainer) appContainer.classList.remove('show-details'); // 移除辅助布局的类名
            this.currentView = null; // 清空当前视图类型
            this._detachResourceScrollListener(); // 隐藏面板时，确保分离资源预览的滚动监听器，避免不必要的计算
        }
    },

    /**
     * @description 显示聊天详情视图（包含联系人/群组信息和资源预览区）。
     * 如果没有选中聊天，则隐藏面板。
     */
    showMainDetailsContent: function() {
        if (!ChatManager.currentChatId) { // 检查是否有当前聊天
            Utils.log("DetailsPanelUIManager: 无法显示详情，没有选中的聊天。", Utils.logLevels.INFO);
            this.hideSidePanel(); // 如果没有，则隐藏面板
            return;
        }
        // 更新面板内容为当前聊天的详情
        this.updateDetailsPanel(ChatManager.currentChatId, ChatManager.currentChatId.startsWith('group_') ? 'group' : 'contact');
        this._setPanelVisibility(true, 'details'); // 设置面板可见，视图类型为'details'
        Utils.log("DetailsPanelUIManager: 显示聊天详情视图。", Utils.logLevels.DEBUG);
    },

    /**
     * @description 显示人员大厅视图。
     * 会更新面板标题，并确保资源预览区被隐藏。
     * @returns {Promise<void>}
     */
    showPeopleLobbyContent: async function() {
        if (this.detailsPanelTitleEl) this.detailsPanelTitleEl.textContent = '人员大厅'; // 更新面板标题
        if (this.resourcePreviewSectionEl) this.resourcePreviewSectionEl.style.display = 'none'; // 人员大厅视图不显示资源预览
        if (PeopleLobbyManager) await PeopleLobbyManager.show(); // 调用人员大厅管理器显示其内容
        this._setPanelVisibility(true, 'lobby'); // 设置面板可见，视图类型为'lobby'
        Utils.log("DetailsPanelUIManager: 显示人员大厅视图。", Utils.logLevels.DEBUG);
    },

    /**
     * @description 切换聊天详情视图的显示/隐藏状态。
     * 如果当前已显示聊天详情，则隐藏面板；否则显示聊天详情。
     */
    toggleChatDetailsView: function() {
        if (this.isPanelAreaVisible && this.currentView === 'details') {
            this.hideSidePanel();
        } else {
            this.showMainDetailsContent();
        }
    },

    /**
     * @description 切换人员大厅视图的显示/隐藏状态。
     * 如果当前已显示人员大厅，则隐藏面板；否则显示人员大厅。
     */
    togglePeopleLobbyView: function() {
        if (this.isPanelAreaVisible && this.currentView === 'lobby') {
            this.hideSidePanel();
        } else {
            this.showPeopleLobbyContent();
        }
    },

    /**
     * @description 隐藏整个右侧详情面板区域，并重置面板标题。
     */
    hideSidePanel: function () {
        this._setPanelVisibility(false); // 调用内部方法隐藏面板
        if (this.detailsPanelTitleEl) this.detailsPanelTitleEl.textContent = '聊天信息'; // 重置面板标题为默认值
        Utils.log("DetailsPanelUIManager: 右侧面板已隐藏。", Utils.logLevels.DEBUG);
    },

    /**
     * 更新主聊天详情面板的内容，根据传入的聊天ID和类型（联系人或群组）。
     * @param {string} chatId - 当前选中的聊天ID。
     * @param {string} type - 聊天类型， 'contact' 或 'group'。
     */
    updateDetailsPanel: function (chatId, type) {
        if (!this.detailsPanelEl || !this.detailsPanelContentEl) return; // 确保关键DOM元素存在

        this.detailsPanelEl.className = 'details-panel'; // 重置面板根元素的类名

        // 默认隐藏所有特定于类型（联系人/群组/AI）的UI区域
        [this.contactActionsDetailsEl, this.detailsGroupManagementEl, this.groupActionsDetailsEl,
            this.aiContactAboutSectionEl, this.aiTtsConfigSectionEl, this.resourcePreviewSectionEl]
            .forEach(el => { if (el) el.style.display = 'none'; });

        // “清空当前聊天”按钮的显隐及事件绑定
        if (this.currentChatActionsDetailsEl && this.clearCurrentChatBtnDetailsEl) {
            this.currentChatActionsDetailsEl.style.display = chatId ? 'block' : 'none'; // 如果有chatId则显示
            if (chatId) {
                 // 移除旧监听器以防重复绑定
                const newBtn = this.clearCurrentChatBtnDetailsEl.cloneNode(true);
                this.clearCurrentChatBtnDetailsEl.parentNode.replaceChild(newBtn, this.clearCurrentChatBtnDetailsEl);
                this.clearCurrentChatBtnDetailsEl = newBtn;
                this.clearCurrentChatBtnDetailsEl.addEventListener('click', () => MessageManager.clearChat());
            }
        }

        // 根据聊天类型调用相应的更新方法
        if (type === 'contact') {
            this._updateForContact(chatId);
        } else if (type === 'group') {
            this._updateForGroup(chatId);
        }
    },

    /**
     * 更新详情面板以显示指定联系人的信息。
     * @param {string} contactId - 联系人的ID。
     * @private
     */
    _updateForContact: function(contactId) {
        const contact = UserManager.contacts[contactId]; // 从UserManager获取联系人对象
        if (!contact || !this.detailsPanelEl) return; // 如果联系人不存在或面板元素不存在，则返回

        if (this.detailsPanelTitleEl) this.detailsPanelTitleEl.textContent = `${contact.name} 信息`; // 设置面板标题

        this.detailsPanelEl.classList.add('contact-details-active'); // 添加CSS类以标识当前显示的是联系人详情
        if (contact.isSpecial) this.detailsPanelEl.classList.add(contact.id); // 如果是特殊联系人，添加其ID作为类名，方便主题化
        else this.detailsPanelEl.classList.add('human-contact-active'); // 否则标记为普通人类联系人

        // 更新联系人基本信息
        if (this.detailsNameEl) this.detailsNameEl.textContent = contact.name;
        if (this.detailsIdEl) this.detailsIdEl.textContent = `ID: ${contact.id}`;
        if (this.detailsAvatarEl) { // 更新头像
            this.detailsAvatarEl.className = 'details-avatar'; // 重置头像元素类名
            let fallbackText = (contact.avatarText) ? Utils.escapeHtml(contact.avatarText) :
                (contact.name && contact.name.length > 0) ? Utils.escapeHtml(contact.name.charAt(0).toUpperCase()) : '?'; // 计算头像的备用文本
            let avatarContentHtml;
            if (contact.isSpecial) this.detailsAvatarEl.classList.add('special-avatar', contact.id); // 特殊联系人头像的特定类名
            if (contact.avatarUrl) { // 如果有头像URL，则使用图片
                avatarContentHtml = `<img src="${contact.avatarUrl}" alt="${fallbackText}" class="avatar-image" data-fallback-text="${fallbackText}" data-entity-id="${contact.id}">`;
            } else { // 否则使用文本头像
                avatarContentHtml = fallbackText;
            }
            this.detailsAvatarEl.innerHTML = avatarContentHtml;
        }

        // 更新联系人状态
        if (this.detailsStatusEl) {
            if (contact.isSpecial) this.detailsStatusEl.textContent = (contact.isAI ? 'AI 助手' : '特殊联系人') ; // 特殊联系人的状态文本
            else this.detailsStatusEl.textContent = ConnectionManager.isConnectedTo(contactId) ? '已连接' : '离线'; // 普通联系人的在线/离线状态
        }

        // 联系人详情视图中，资源预览区域总是可见
        if (this.resourcePreviewSectionEl && this.resourcePreviewPanelContentEl) {
            this.resourcePreviewSectionEl.style.display = 'block'; // 显示资源预览的整个section
            this.resourcePreviewPanelContentEl.style.display = 'flex'; // 确保资源预览的内容面板也显示 (flex布局)
            this._currentResourceChatId = contactId; // 设置当前预览资源的聊天ID
            this._attachResourceScrollListener(); // 附加滚动加载更多资源的监听器
            // 切换或加载当前选定的资源类型（例如，如果之前是图片，保持图片；如果是新打开，默认加载图片）
            this._switchResourceTypeAndLoad(this._currentResourceType);
        }

        // 根据是否为特殊联系人，显示或隐藏不同的操作区域
        if (contact.isSpecial) { // 如果是特殊联系人
            if (this.contactActionsDetailsEl) this.contactActionsDetailsEl.style.display = 'none'; // 隐藏通用联系人操作（如删除）
            if (contact.isAI && contact.aboutDetails && this.aiContactAboutSectionEl) { // 如果是AI且有“关于”信息
                this._populateAiAboutSection(contact); //填充AI的“关于”信息
                this.aiContactAboutSectionEl.style.display = 'block'; // 显示“关于”区域
            }
            if (contact.isAI && this.aiTtsConfigSectionEl) { // 如果是AI，显示TTS配置区域
                this._setupAiTtsConfigSection(contact); // 设置TTS配置表单和事件
                this.aiTtsConfigSectionEl.style.display = 'block'; // 显示TTS配置区域
            }
        } else { // 如果是普通联系人
            if (this.contactActionsDetailsEl) this.contactActionsDetailsEl.style.display = 'block'; // 显示通用联系人操作
            if (this.deleteContactBtnDetailsEl) {
                const newBtn = this.deleteContactBtnDetailsEl.cloneNode(true);
                this.deleteContactBtnDetailsEl.parentNode.replaceChild(newBtn, this.deleteContactBtnDetailsEl);
                this.deleteContactBtnDetailsEl = newBtn;
                this.deleteContactBtnDetailsEl.addEventListener('click', () => ChatManager.deleteChat(contactId, 'contact'));
            }
            if (this.aiTtsConfigSectionEl) this.aiTtsConfigSectionEl.style.display = 'none'; // 隐藏AI TTS配置区域
            if (this.aiContactAboutSectionEl) this.aiContactAboutSectionEl.style.display = 'none'; // 隐藏AI“关于”区域
        }
    },

    /**
     * 填充AI联系人的“关于”信息部分。
     * @param {object} contact - AI联系人对象，应包含 aboutDetails 属性。
     * @private
     */
    _populateAiAboutSection: function(contact) {
        if (this.aiContactAboutNameEl) this.aiContactAboutNameEl.textContent = contact.aboutDetails.nameForAbout || contact.name;
        if (this.aiContactAboutNameSubEl) this.aiContactAboutNameSubEl.textContent = contact.aboutDetails.nameForAbout || contact.name;
        if (this.aiContactBasicInfoListEl) {
            this.aiContactBasicInfoListEl.innerHTML = ''; // 清空旧信息
            contact.aboutDetails.basicInfo.forEach(info => { // 遍历基础信息项并创建列表元素
                const li = document.createElement('li');
                li.innerHTML = `<strong>${Utils.escapeHtml(info.label)}:</strong> ${Utils.escapeHtml(info.value)}`;
                this.aiContactBasicInfoListEl.appendChild(li);
            });
        }
        if (this.aiContactAboutTextEl) this.aiContactAboutTextEl.textContent = contact.aboutDetails.aboutText; // 设置详细描述文本
    },

    /**
     * 设置AI联系人的TTS（文本转语音）配置部分，包括表单填充和事件绑定。
     * @param {object} contact - AI联系人对象。
     * @private
     */
    _setupAiTtsConfigSection: function(contact) {
        TtsUIManager.populateAiTtsConfigurationForm(contact, 'ttsConfigFormContainer'); // 调用TTS管理器填充表单
        // 绑定保存TTS设置按钮的事件
        if (this.saveAiTtsSettingsBtnDetailsEl) {
            if (TtsUIManager._boundSaveTtsListener) { // 如果已存在监听器，先移除旧的
                this.saveAiTtsSettingsBtnDetailsEl.removeEventListener('click', TtsUIManager._boundSaveTtsListener);
            }
            // 创建新的绑定监听器，并关联到当前联系人ID
            TtsUIManager._boundSaveTtsListener = TtsUIManager.handleSaveAiTtsSettings.bind(TtsUIManager, contact.id);
            this.saveAiTtsSettingsBtnDetailsEl.addEventListener('click', TtsUIManager._boundSaveTtsListener);
        }
        // 设置AI TTS配置区域的折叠/展开逻辑
        if (this.aiTtsConfigHeaderEl) {
            if (this._boundTtsConfigCollapseListener) { // 移除旧的折叠监听器
                this.aiTtsConfigHeaderEl.removeEventListener('click', this._boundTtsConfigCollapseListener);
            }
            // 定义新的折叠监听器
            this._boundTtsConfigCollapseListener = function() { // 使用普通函数以保留this指向header元素
                this.classList.toggle('active');
                const content = this.nextElementSibling; // 内容元素是头部的下一个兄弟元素
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
            // 初始化折叠图标状态
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

    /**
     * 更新详情面板以显示指定群组的信息。
     * @param {string} groupId - 群组的ID。
     * @private
     */
    _updateForGroup: function(groupId) {
        const group = GroupManager.groups[groupId]; // 从GroupManager获取群组对象
        if (!group || !this.detailsPanelEl) return; // 如果群组不存在或面板元素不存在，则返回

        if (this.detailsPanelTitleEl) this.detailsPanelTitleEl.textContent = `${group.name} 信息`; // 设置面板标题
        this.detailsPanelEl.classList.add('group-chat-active'); // 添加CSS类以标识当前显示的是群组详情

        // 更新群组基本信息
        if (this.detailsNameEl) this.detailsNameEl.textContent = group.name;
        if (this.detailsIdEl) this.detailsIdEl.textContent = `群组 ID: ${group.id.substring(6)}`; // 通常群组ID有前缀，截取后部分显示
        if (this.detailsAvatarEl) { // 群组头像通常是固定的图标
            this.detailsAvatarEl.innerHTML = '👥'; // 使用双人图标作为群组头像
            this.detailsAvatarEl.className = 'details-avatar group'; // 设置特定类名
        }
        if (this.detailsStatusEl) this.detailsStatusEl.textContent = `${group.members.length} 名成员`; // 显示成员数量

        // 显示群组管理和操作相关的UI区域
        if (this.detailsGroupManagementEl) this.detailsGroupManagementEl.style.display = 'block';
        if (this.groupActionsDetailsEl) this.groupActionsDetailsEl.style.display = 'block';

        const isOwner = group.owner === UserManager.userId; // 判断当前用户是否为群主
        // “添加成员”区域仅群主可见
        if (this.addGroupMemberAreaEl) this.addGroupMemberAreaEl.style.display = isOwner ? 'block' : 'none';
        // “已离开成员”区域仅群主可见且有已离开成员时显示
        if (this.leftMembersAreaEl) this.leftMembersAreaEl.style.display = isOwner && group.leftMembers && group.leftMembers.length > 0 ? 'block' : 'none';

        // “离开群组”按钮仅非群主成员可见
        if (this.leaveGroupBtnDetailsEl) {
            this.leaveGroupBtnDetailsEl.style.display = isOwner ? 'none' : 'block';
            if(!isOwner) {
                const newBtn = this.leaveGroupBtnDetailsEl.cloneNode(true);
                this.leaveGroupBtnDetailsEl.parentNode.replaceChild(newBtn, this.leaveGroupBtnDetailsEl);
                this.leaveGroupBtnDetailsEl = newBtn;
                this.leaveGroupBtnDetailsEl.addEventListener('click', () => ChatManager.deleteChat(groupId, 'group'));
            }
        }
        // “解散群组”按钮仅群主可见
        if (this.dissolveGroupBtnDetailsEl) {
            this.dissolveGroupBtnDetailsEl.style.display = isOwner ? 'block' : 'none';
            if(isOwner) {
                const newBtn = this.dissolveGroupBtnDetailsEl.cloneNode(true);
                this.dissolveGroupBtnDetailsEl.parentNode.replaceChild(newBtn, this.dissolveGroupBtnDetailsEl);
                this.dissolveGroupBtnDetailsEl = newBtn;
                this.dissolveGroupBtnDetailsEl.addEventListener('click', () => ChatManager.deleteChat(groupId, 'group'));
            }
        }

        this.updateDetailsPanelMembers(groupId); // 更新群成员列表

        // 隐藏AI联系人特有的区域
        if (this.aiContactAboutSectionEl) this.aiContactAboutSectionEl.style.display = 'none';
        if (this.aiTtsConfigSectionEl) this.aiTtsConfigSectionEl.style.display = 'none';

        // 群组详情视图中，资源预览区域总是隐藏
        if (this.resourcePreviewSectionEl) this.resourcePreviewSectionEl.style.display = 'none';
        if (this.resourcePreviewPanelContentEl) this.resourcePreviewPanelContentEl.style.display = 'none';
        this._detachResourceScrollListener(); // 为群组视图移除资源预览的滚动监听器
    },

    /**
     * 更新群组详情面板中的成员列表、已离开成员列表以及添加新成员的下拉框。
     * @param {string} groupId - 要更新成员信息的群组ID。
     */
    updateDetailsPanelMembers: function (groupId) {
        const group = GroupManager.groups[groupId]; // 获取群组对象
        // 确保必要的DOM元素都存在
        if (!group || !this.groupMemberListDetailsEl || !this.groupMemberCountEl || !this.contactsDropdownDetailsEl || !document.getElementById('leftMemberListDetails')) return; // 检查leftMemberListDetails的父元素是否存在

        const leftMemberListDetailsEl = document.getElementById('leftMemberListDetails'); // 获取已离开成员列表的容器

        this.groupMemberListDetailsEl.innerHTML = ''; // 清空当前成员列表
        this.groupMemberCountEl.textContent = group.members.length; // 更新成员计数

        // 遍历当前成员并添加到列表
        group.members.forEach(memberId => {
            const member = UserManager.contacts[memberId] || {id: memberId, name: `用户 ${memberId.substring(0, 4)}`}; // 获取成员信息，若无则用ID生成临时名
            const item = document.createElement('div');
            item.className = 'member-item-detail'; // 列表项CSS类
            let html = `<span>${Utils.escapeHtml(member.name)} ${memberId === UserManager.userId ? '(您)' : ''}</span>`; // 成员名，若是自己则标记
            if (memberId === group.owner) html += '<span class="owner-badge">群主</span>'; // 标记群主
            else if (group.owner === UserManager.userId) { // 如果当前用户是群主，则对其他成员显示移除按钮
                html += `<button class="remove-member-btn-detail" data-member-id="${memberId}" title="移除成员">✕</button>`;
            }
            item.innerHTML = html;
            this.groupMemberListDetailsEl.appendChild(item);
        });
        // 为所有移除成员按钮绑定点击事件
        this.groupMemberListDetailsEl.querySelectorAll('.remove-member-btn-detail').forEach(btn => {
             // 移除旧监听器
            const newBtn = btn.cloneNode(true);
            btn.parentNode.replaceChild(newBtn, btn);
            newBtn.addEventListener('click', () => GroupManager.removeMemberFromGroup(groupId, newBtn.dataset.memberId));
        });

        // 填充“添加新成员”的下拉列表
        this.contactsDropdownDetailsEl.innerHTML = '<option value="">选择要添加的联系人...</option>'; // 默认选项
        Object.values(UserManager.contacts).forEach(contact => {
            // 只添加不在群内、不在已离开列表、且非AI类型的联系人
            if (!group.members.includes(contact.id) && !(group.leftMembers?.find(lm => lm.id === contact.id)) && !(contact.isSpecial && contact.isAI)) {
                const option = document.createElement('option');
                option.value = contact.id;
                option.textContent = contact.name;
                this.contactsDropdownDetailsEl.appendChild(option);
            }
        });

        // 填充“已离开成员”列表 (仅群主可见)
        leftMemberListDetailsEl.innerHTML = ''; // 清空旧列表
        if (group.owner === UserManager.userId && group.leftMembers && group.leftMembers.length > 0 && this.leftMembersAreaEl) {
            group.leftMembers.forEach(leftMember => {
                const item = document.createElement('div');
                item.className = 'left-member-item-detail';
                item.innerHTML = `<span>${Utils.escapeHtml(leftMember.name)} (离开于: ${Utils.formatDate(new Date(leftMember.leftTime))})</span>
<button class="re-add-member-btn-detail" data-member-id="${leftMember.id}" data-member-name="${Utils.escapeHtml(leftMember.name)}" title="重新添加成员">+</button>`; // 显示离开成员信息和重新添加按钮
                leftMemberListDetailsEl.appendChild(item);
            });
            // 为所有重新添加成员按钮绑定点击事件
            leftMemberListDetailsEl.querySelectorAll('.re-add-member-btn-detail').forEach(btn => {
                // 移除旧监听器
                const newBtn = btn.cloneNode(true);
                btn.parentNode.replaceChild(newBtn, btn);
                newBtn.addEventListener('click', () => GroupManager.addMemberToGroup(groupId, newBtn.dataset.memberId, newBtn.dataset.memberName));
            });
            this.leftMembersAreaEl.style.display = 'block'; // 显示此区域
        } else if (this.leftMembersAreaEl) {
            this.leftMembersAreaEl.style.display = 'none'; // 隐藏此区域
        }
    },

    /**
     * 处理从详情面板点击“添加成员”按钮的逻辑。
     * 获取下拉框中选中的联系人，并调用GroupManager将其添加到当前群组。
     */
    handleAddMemberToGroupDetails: function () {
        const groupId = ChatManager.currentChatId; // 获取当前群组ID
        if (!this.contactsDropdownDetailsEl) return; // 确保下拉框元素存在
        const memberId = this.contactsDropdownDetailsEl.value; // 获取选中的成员ID
        const memberName = this.contactsDropdownDetailsEl.selectedOptions[0]?.text; // 获取选中的成员名称
        if (groupId && memberId) { // 如果群组ID和成员ID都有效
            GroupManager.addMemberToGroup(groupId, memberId, memberName).then(success => { // 调用GroupManager添加成员
                if (success && this.contactsDropdownDetailsEl) this.contactsDropdownDetailsEl.value = ""; // 如果成功，重置下拉框
            });
        } else {
            NotificationUIManager.showNotification("请选择要添加的联系人。", "warning"); // 如果未选择联系人，提示用户
        }
    },

    // --- 聊天资源预览相关方法 (现在是聊天详情的一部分) ---
    /**
     * 切换资源预览的类型（如图片、视频）并加载相应资源。
     * @param {string} resourceType - 要切换到的资源类型。
     * @private
     */
    _switchResourceTypeAndLoad: function(resourceType) {
        if (!this._currentResourceChatId || !this.resourceGridContainerEl) return; // 确保当前有聊天ID和网格容器
        Utils.log(`DetailsPanelUIManager: 切换到资源类型: ${resourceType} for chat ${this._currentResourceChatId}`, Utils.logLevels.DEBUG);

        this._currentResourceType = resourceType; // 更新当前资源类型
        this._resourceItems = []; // 清空已加载的资源项数组
        this._resourceGridRenderedItemsCount = 0; // 重置已渲染的计数
        this.resourceGridContainerEl.innerHTML = ''; // 清空网格容器的现有内容

        // 更新资源分类标签的激活状态
        for (const type in this.resourceCategoryButtons) {
            if (this.resourceCategoryButtons[type]) {
                this.resourceCategoryButtons[type].classList.toggle('active', type === resourceType);
            }
        }
        this._loadMoreResources(true); // 加载第一批新类型的资源 (isInitialLoad = true)
    },

    /**
     * 加载更多指定类型的资源并显示在预览网格中。
     * 实现无限滚动加载。
     * @param {boolean} [isInitialLoad=false] - 是否为初次加载（用于处理空状态显示）。
     * @private
     */
    _loadMoreResources: async function(isInitialLoad = false) {
        if (this._isResourceLoading || !this._currentResourceChatId) return; // 如果正在加载或没有聊天ID，则返回

        this._isResourceLoading = true; // 设置加载中标志
        if (this.resourceGridLoadingIndicatorEl) this.resourceGridLoadingIndicatorEl.style.display = 'flex'; // 显示加载指示器

        try {
            // 从ChatManager获取下一批资源消息
            const newItems = await ChatManager.getMessagesWithResources(
                this._currentResourceChatId,
                this._currentResourceType,
                this._resourceItems.length, // 从已加载项的末尾开始
                15 // 每次加载15项
            );

            if (newItems && newItems.length > 0) { // 如果成功加载到新项目
                this._resourceItems.push(...newItems); // 将新项目追加到内部数组
                // 仅渲染新加载的项目
                for (let i = this._resourceGridRenderedItemsCount; i < this._resourceItems.length; i++) {
                    const itemEl = this._createResourcePreviewItem(this._resourceItems[i]); // 创建DOM元素
                    if (itemEl && this.resourceGridContainerEl) {
                        this.resourceGridContainerEl.appendChild(itemEl); // 添加到网格
                    }
                }
                this._resourceGridRenderedItemsCount = this._resourceItems.length; // 更新已渲染计数
            } else if (isInitialLoad && this._resourceItems.length === 0) { // 如果是初次加载且没有加载到任何项目
                if (this.resourceGridContainerEl) { // 显示空状态消息
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
            this._isResourceLoading = false; // 清除加载中标志
            if (this.resourceGridLoadingIndicatorEl) this.resourceGridLoadingIndicatorEl.style.display = 'none'; // 隐藏加载指示器
        }
    },

    /**
     * 根据消息对象创建一个资源预览项的DOM元素。
     * @param {object} message - 包含资源信息的消息对象。
     * @returns {HTMLElement|null} 创建的DOM元素，或在失败时返回null。
     * @private
     */
    _createResourcePreviewItem: function(message) {
        const itemEl = document.createElement('div'); // 创建预览项容器
        itemEl.className = 'resource-preview-item'; // 设置CSS类
        itemEl.dataset.messageId = message.id; // 存储消息ID，用于点击跳转
        
        itemEl.addEventListener('click', () => { // 使用 addEventListener
            if (typeof ChatAreaUIManager !== 'undefined' && ChatAreaUIManager.scrollToMessage) {
                const appContainer = document.querySelector('.app-container');
                const isMobileView = window.innerWidth <= 768; // 判断是否为移动视图
                // 如果是移动视图且详情面板是打开的，则先切换回聊天区域视图
                if (isMobileView && appContainer && appContainer.classList.contains('show-details')) {
                    if (typeof LayoutUIManager !== 'undefined') LayoutUIManager.showChatAreaLayout(); // 切换布局
                    this.hideSidePanel(); // 隐藏详情面板
                }
                ChatAreaUIManager.scrollToMessage(message.id); // 执行滚动
            } else {
                Utils.log(`ChatAreaUIManager 或 scrollToMessage 方法未定义。无法跳转。`, Utils.logLevels.WARN);
            }
        });

        // 创建并添加时间戳元素
        const timestampEl = document.createElement('div');
        timestampEl.className = 'resource-timestamp';
        timestampEl.textContent = Utils.formatDate(new Date(message.timestamp), false); // 格式化时间戳
        itemEl.appendChild(timestampEl);

        // 根据当前选中的资源类型和消息内容，创建不同的预览内容
        if (this._currentResourceType === 'image' && (message.type === 'image' || (message.type === 'file' && message.fileType && message.fileType.startsWith('image/')))) {
            const img = document.createElement('img');
            img.src = message.data; // 图片的data URL或路径
            img.alt = message.fileName || '图片资源';
            img.className = 'thumbnail'; // 缩略图CSS类
            itemEl.appendChild(img);
        } else if (this._currentResourceType === 'video' && message.type === 'file' && message.fileType && message.fileType.startsWith('video/')) {
            const video = document.createElement('video');
            video.src = message.data; // 视频的data URL或路径
            video.className = 'thumbnail';
            video.muted = true; // 默认静音以自动播放（如果需要）或避免干扰
            const playIcon = document.createElement('div'); // 叠加播放图标
            playIcon.textContent = '▶';
            playIcon.style.position = 'absolute'; playIcon.style.fontSize = '2em'; playIcon.style.color = 'white'; playIcon.style.textShadow = '0 0 5px black'; // 简单样式
            itemEl.appendChild(video); itemEl.appendChild(playIcon);
        } else if (this._currentResourceType === 'audio' && (message.type === 'audio' || (message.type === 'file' && message.fileType && message.fileType.startsWith('audio/')))) {
            const icon = document.createElement('div'); icon.className = 'audio-icon'; icon.textContent = '🎵'; itemEl.appendChild(icon); // 音频图标
            const nameEl = document.createElement('div'); nameEl.className = 'resource-name'; // 文件名/描述
            nameEl.textContent = message.fileName || (message.type === 'audio' ? `语音 ${message.duration ? Utils.formatTime(message.duration) : ''}` : '音频文件');
            nameEl.title = nameEl.textContent; itemEl.appendChild(nameEl);
        } else if (this._currentResourceType === 'file') {
            const icon = document.createElement('div'); icon.className = 'file-icon'; icon.textContent = '📄'; itemEl.appendChild(icon); // 文件图标
            const nameEl = document.createElement('div'); nameEl.className = 'resource-name'; // 文件名
            nameEl.textContent = message.fileName || '文件';
            nameEl.title = nameEl.textContent; itemEl.appendChild(nameEl);
        } else { // 未知或不支持的资源类型
            itemEl.textContent = '未知资源';
        }
        return itemEl;
    },

    /**
     * 处理资源预览网格的滚动事件，用于实现无限滚动加载。
     * 当滚动接近底部时，调用 _loadMoreResources 加载更多项。
     * @private
     */
    _handleResourceGridScroll: function() {
        if (!this.resourceGridContainerEl || this._isResourceLoading) return; // 如果容器不存在或正在加载，则返回
        const { scrollTop, scrollHeight, clientHeight } = this.resourceGridContainerEl;
        // 当滚动条位置接近底部（100px阈值）时，加载更多
        if (scrollHeight - scrollTop - clientHeight < 100) {
            this._loadMoreResources();
        }
    },

    /**
     * 附加资源预览网格的滚动事件监听器。
     * @private
     */
    _attachResourceScrollListener: function() {
        if (this.resourceGridContainerEl && !this._resourceScrollListenerAttached) {
            this.resourceGridContainerEl.addEventListener('scroll', this._boundHandleResourceGridScroll);
            this._resourceScrollListenerAttached = true;
        }
    },

    /**
     * 分离资源预览网格的滚动事件监听器。
     * @private
     */
    _detachResourceScrollListener: function() {
        if (this.resourceGridContainerEl && this._resourceScrollListenerAttached) {
            this.resourceGridContainerEl.removeEventListener('scroll', this._boundHandleResourceGridScroll);
            this._resourceScrollListenerAttached = false;
        }
    }
};