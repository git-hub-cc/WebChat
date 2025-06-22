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
 *              优化：资源预览中的图片和视频现在显示缩略图。
 *              更新：资源预览分类调整为影像、文本、其它、日期。新增资源搜索框。日期分类提供日历导航。
 *              优化：资源预览中的文本消息项现在以类似聊天气泡的样式显示。
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
 * @dependencies UserManager, GroupManager, ChatManager, MessageManager, TtsUIManager, NotificationUIManager, Utils, ConnectionManager, PeopleLobbyManager, Config, LayoutUIManager, EventEmitter, DBManager
 * @dependents AppInitializer (进行初始化), ChatAreaUIManager (通过按钮点击调用以切换面板显隐)
 */
const DetailsPanelUIManager = {
    isPanelAreaVisible: false, // 标记面板区域是否可见
    currentView: null, // 当前视图类型: 'details' 或 'lobby'
    // _boundTtsConfigCollapseListener: null, // 不再需要，统一使用 _makeElementCollapsible 处理

    // --- DOM Element References ---
    detailsPanelEl: null, // 详情面板的根元素
    detailsPanelTitleEl: null, // 详情面板的标题元素
    closeDetailsBtnMainEl: null, // 关闭详情面板的主按钮

    // --- 聊天/联系人详情通用元素 ---
    detailsPanelContentEl: null, // 详情面板的主要内容容器
    detailsNameEl: null, // 显示名称的元素 (联系人/群组)
    detailsIdEl: null, // 显示ID的元素 (联系人/群组)
    detailsAvatarEl: null, // 显示头像的元素 (联系人/群组)
    detailsStatusEl: null, // 显示状态的元素 (联系人/群组)
    currentChatActionsDetailsEl: null, // 当前聊天通用操作区域 (如清空聊天)
    clearCurrentChatBtnDetailsEl: null, // 清空当前聊天记录按钮

    // --- 联系人详情特定元素 ---
    contactActionsDetailsEl: null, // 联系人特定操作区域 (如删除联系人)
    deleteContactBtnDetailsEl: null, // 删除联系人按钮
    aiContactAboutSectionEl: null, // AI联系人 "关于" 信息部分
    aiContactAboutNameEl: null, // AI联系人 "关于" 部分的名称显示
    aiContactBasicInfoListEl: null, // AI联系人 "关于" 部分的基本信息列表
    aiContactAboutNameSubEl: null, // AI联系人 "关于" 部分的副名称/重复名称
    aiContactAboutTextEl: null, // AI联系人 "关于" 部分的详细描述文本
    aiTtsConfigSectionEl: null, // AI联系人 TTS 配置部分
    aiTtsConfigHeaderEl: null, // AI联系人 TTS 配置部分的头部 (用于折叠)
    aiTtsConfigContentEl: null, // AI联系人 TTS 配置部分的内容
    saveAiTtsSettingsBtnDetailsEl: null, // 保存AI TTS设置的按钮
    ttsAttributionHeaderEl: null, // TTS 版权信息部分的头部 (用于折叠)
    ttsAttributionContentEl: null, // TTS 版权信息部分的内容

    // --- 群组详情特定元素 ---
    detailsGroupManagementEl: null, // 群组管理区域的容器
    groupMemberListHeaderEl: null, // 群成员列表的头部元素 (用于折叠)
    groupMemberListContainerEl: null, // 群成员列表的容器元素 (被折叠的内容)
    groupMemberListDetailsEl: null, // 实际显示群成员列表的元素
    groupMemberCountEl: null, // 显示群成员数量的元素
    addGroupMemberAreaEl: null, // 添加群成员的区域
    leftMembersAreaEl: null, // 显示已离开群成员的区域
    contactsDropdownDetailsEl: null, // 添加群成员时选择联系人的下拉列表
    addMemberBtnDetailsEl: null, // 添加群成员的按钮
    groupAiPromptsSectionEl: null, // 群内AI特定提示词设置区域
    groupAiPromptsHeaderEl: null,  // 群内AI提示词区域的头部 (用于折叠)
    groupAiPromptsListContainerEl: null, // 群内AI提示词列表的容器
    groupActionsDetailsEl: null, // 群组特定操作区域 (如离开/解散群)
    leaveGroupBtnDetailsEl: null, // 离开群组按钮
    dissolveGroupBtnDetailsEl: null, // 解散群组按钮

    // --- 人员大厅元素 ---
    peopleLobbyContentEl: null, // 人员大厅内容的容器

    // --- 资源预览相关元素和状态 ---
    resourcePreviewSectionEl: null, // 资源预览模块的根元素
    resourcePreviewHeaderTitleEl: null, // 资源预览模块的标题元素
    resourceSearchInputEl: null, // 资源搜索框
    resourcePreviewPanelContentEl: null, // 资源预览面板的内容容器 (包含tabs和grid/calendar)
    resourceCategoryTabsContainerEl: null, // 资源分类标签页的容器
    resourceCategoryButtons: {}, // 存储资源分类标签按钮的引用
    resourceGridContainerEl: null, // 资源网格布局的容器
    calendarContainerEl: null, // 日历视图的容器
    resourceGridLoadingIndicatorEl: null, // 资源网格加载指示器
    _currentResourceChatId: null, // 当前正在预览资源的聊天ID
    _currentResourceType: 'imagery', // 当前选中的资源类型 (imagery, text, other, date)，默认影像
    _resourceItems: [], // 当前已加载的资源项目 (原始消息对象)
    _resourceGridRenderedItemsCount: 0, // 网格中已渲染的资源项目数量
    _rawItemsFetchedCount: 0, // 已从数据库获取的原始项目数量 (用于搜索时的分页)
    _currentSearchQuery: '', // 当前资源搜索框中的查询字符串
    _isResourceLoading: false, // 标记是否正在加载资源
    _resourceScrollListenerAttached: false, // 标记资源网格滚动监听器是否已附加
    _boundHandleResourceGridScroll: null, // 绑定的滚动处理函数

    // --- 群成员状态刷新相关 ---
    _groupMemberRefreshInterval: null, // 群成员状态刷新定时器的ID
    GROUP_MEMBER_REFRESH_INTERVAL_MS: 3000, // 群成员状态刷新间隔 (毫秒)
    _lastFetchWasEmptySearch: false, // 标记上一次获取资源时，是否因为搜索而没有立即渲染项目（用于避免无限加载）

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
        this.groupMemberListHeaderEl = document.getElementById('groupMemberListHeader'); // 获取群成员列表头部
        this.groupMemberListContainerEl = document.getElementById('groupMemberListContainer'); // 获取群成员列表内容容器
        this.groupMemberListDetailsEl = document.getElementById('groupMemberListDetails');
        this.groupMemberCountEl = document.getElementById('groupMemberCount');
        this.addGroupMemberAreaEl = document.getElementById('addGroupMemberArea');
        this.leftMembersAreaEl = document.getElementById('leftMembersArea'); // 获取已离开成员区域
        this.contactsDropdownDetailsEl = document.getElementById('contactsDropdownDetails');
        this.addMemberBtnDetailsEl = document.getElementById('addMemberBtnDetails');

        this.groupAiPromptsSectionEl = document.getElementById('groupAiPromptsSection'); // 获取群AI提示词区
        this.groupAiPromptsHeaderEl = document.getElementById('groupAiPromptsHeader');   // 获取群AI提示词头部
        this.groupAiPromptsListContainerEl = document.getElementById('groupAiPromptsListContainer'); // 获取群AI提示词内容容器


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
        this.peopleLobbyContentEl = document.getElementById('peopleLobbyContent'); // 获取人员大厅内容容器
        this.resourcePreviewSectionEl = document.getElementById('resourcePreviewSection');
        this.resourcePreviewHeaderTitleEl = document.getElementById('resourcePreviewHeaderTitle');
        this.resourceSearchInputEl = document.getElementById('resourceSearchInputDetailsPanel'); // 获取资源搜索框
        this.resourcePreviewPanelContentEl = document.getElementById('resourcePreviewPanelContent');
        this.resourceCategoryTabsContainerEl = document.getElementById('resourceCategoryTabsContainer');
        this.resourceGridContainerEl = document.getElementById('resourceGridContainer');
        this.calendarContainerEl = document.getElementById('calendarContainerDetailsPanel'); // 获取日历容器
        this.resourceGridLoadingIndicatorEl = document.getElementById('resourceGridLoadingIndicator');

        // 绑定资源搜索框输入事件
        if (this.resourceSearchInputEl) {
            this.resourceSearchInputEl.addEventListener('input', (e) => {
                this._currentSearchQuery = e.target.value.toLowerCase().trim();
                // 只有当资源预览面板可见且当前不是日期标签时才重新加载以应用搜索
                if (this.isPanelAreaVisible && this.currentView === 'details' && this._currentResourceChatId && this._currentResourceType !== 'date') {
                    this._switchResourceTypeAndLoad(this._currentResourceType, true); // 强制重新加载以应用过滤器
                }
            });
        }

        // 绑定资源分类标签点击事件
        if (this.resourceCategoryTabsContainerEl) {
            const buttons = this.resourceCategoryTabsContainerEl.querySelectorAll('.resource-category-tab');
            buttons.forEach(btn => {
                const type = btn.dataset.resourceType;
                if (type) {
                    this.resourceCategoryButtons[type] = btn;
                    btn.addEventListener('click', () => this._switchResourceTypeAndLoad(type, true)); // 点击tab也视为强制重载
                }
            });
        }
        this._boundHandleResourceGridScroll = this._handleResourceGridScroll.bind(this); // 预绑定滚动处理函数
        this.bindEvents(); // 绑定其他主要事件

        // 监听连接状态变化以更新群成员视图 (如果相关)
        EventEmitter.on('connectionEstablished', (peerId) => {
            this._tryRefreshGroupMembersView(peerId);
        });
        EventEmitter.on('connectionClosed', (peerId) => {
            this._tryRefreshGroupMembersView(peerId);
        });
        EventEmitter.on('connectionFailed', (peerId) => {
            this._tryRefreshGroupMembersView(peerId);
        });
        // 监听在线用户列表变化，以实时更新群成员状态
        EventEmitter.on('onlineUsersUpdated', () => {
            if (this.currentView === 'details' && ChatManager.currentChatId && ChatManager.currentChatId.startsWith('group_')) {
                this.updateDetailsPanelMembers(ChatManager.currentChatId);
            }
        });

    },

    /**
     * @private
     * 尝试刷新群成员视图，通常在某个成员的连接状态发生变化后调用。
     * 仅当当前正在查看该群组的详情时才执行刷新。
     * @param {string} peerId - 发生连接状态变化的成员ID。
     */
    _tryRefreshGroupMembersView: function(peerId) {
        if (this.currentView === 'details' && ChatManager.currentChatId && ChatManager.currentChatId.startsWith('group_')) {
            const group = GroupManager.groups[ChatManager.currentChatId];
            // 如果群组存在且发生变化的peerId是群成员之一
            if (group && group.members.includes(peerId)) {
                this.updateDetailsPanelMembers(ChatManager.currentChatId); // 调用更新成员列表的函数
            }
        }
    },

    /**
     * @private
     * 通用的使指定头部和内容元素可折叠的辅助函数。
     * 会给头部添加一个展开/收起图标，并处理点击事件。
     * @param {HTMLElement|null} headerEl - 点击以触发展开/折叠的头部元素。
     * @param {HTMLElement|null} contentEl - 要展开/折叠的内容元素。
     */
    _makeElementCollapsible: function(headerEl, contentEl) {
        if (headerEl && contentEl) {
            // 确保内容元素有 'collapsible-content' 类
            contentEl.classList.add('collapsible-content');
            // 确保头部元素有 'collapsible-header' 类
            headerEl.classList.add('collapsible-header');

            // 查找或创建折叠图标
            let icon = headerEl.querySelector('.collapse-icon');
            if (!icon) {
                icon = document.createElement('span');
                icon.className = 'collapse-icon';
                // 尝试将图标插入到头部文本之后，如果找不到文本节点，则追加到末尾
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
                if (!textNodeFound) { // 如果没有有效文本节点，则直接追加图标
                    headerEl.appendChild(icon);
                }
            }
            // 根据内容元素的初始显示状态设置图标和头部的 'active' 类
            if (contentEl.style.display === 'none' || getComputedStyle(contentEl).display === 'none') {
                icon.textContent = '▶'; // 折叠状态图标
                headerEl.classList.remove('active');
            } else {
                icon.textContent = '▼'; // 展开状态图标
                headerEl.classList.add('active');
            }

            // 移除可能存在的旧监听器，防止重复绑定
            const oldListener = headerEl._collapsibleListener;
            if (oldListener) {
                headerEl.removeEventListener('click', oldListener);
            }

            // 定义并绑定新的点击监听器
            const newListener = function() {
                this.classList.toggle('active'); // 切换头部 'active' 类
                const currentIcon = this.querySelector('.collapse-icon');
                if (contentEl.style.display === "block" || contentEl.style.display === "") {
                    contentEl.style.display = "none"; // 折叠内容
                    if(currentIcon) currentIcon.textContent = '▶'; // 更新为折叠图标
                } else {
                    contentEl.style.display = "block"; // 展开内容
                    if(currentIcon) currentIcon.textContent = '▼'; // 更新为展开图标
                }
            };
            headerEl.addEventListener('click', newListener);
            headerEl._collapsibleListener = newListener; // 保存监听器引用，以便将来移除
        }
    },


    /**
     * 绑定模块所需的全局或持久事件监听器。
     * 例如关闭按钮、添加成员按钮，以及初始化可折叠区域。
     */
    bindEvents: function() {
        if (this.closeDetailsBtnMainEl) {
            this.closeDetailsBtnMainEl.addEventListener('click', () => this.hideSidePanel());
        }
        if (this.addMemberBtnDetailsEl) {
            this.addMemberBtnDetailsEl.addEventListener('click', () => this.handleAddMemberToGroupDetails());
        }

        // 初始化各个可折叠部分的UI
        this._makeElementCollapsible(this.aiTtsConfigHeaderEl, this.aiTtsConfigContentEl);
        this._makeElementCollapsible(this.ttsAttributionHeaderEl, this.ttsAttributionContentEl);
        this._makeElementCollapsible(this.groupMemberListHeaderEl, this.groupMemberListContainerEl); // 使群成员列表可折叠
        this._makeElementCollapsible(this.groupAiPromptsHeaderEl, this.groupAiPromptsListContainerEl); // 使群AI提示词部分可折叠
    },

    /**
     * @private
     * 设置详情面板的整体可见性及当前显示的视图类型。
     * 负责管理DOM元素的显示/隐藏，以及相关定时器的启动/停止。
     * @param {boolean} show - 是否显示面板。true为显示，false为隐藏。
     * @param {string|null} [viewType=null] - 要显示的视图类型 ('details' 或 'lobby')。隐藏时此参数通常为null。
     */
    _setPanelVisibility: function(show, viewType = null) {
        const appContainer = document.querySelector('.app-container'); // 获取应用主容器
        this.isPanelAreaVisible = show; // 更新面板可见状态

        // 默认隐藏所有主要内容区和特定视图组件
        if (this.detailsPanelContentEl) this.detailsPanelContentEl.style.display = 'none';
        if (this.peopleLobbyContentEl) this.peopleLobbyContentEl.style.display = 'none';
        if (this.resourceGridContainerEl) this.resourceGridContainerEl.style.display = 'none'; // 隐藏资源网格
        if (this.calendarContainerEl) this.calendarContainerEl.style.display = 'none'; // 隐藏日历

        // 如果之前有群成员刷新定时器，则清除
        if (this._groupMemberRefreshInterval) {
            clearInterval(this._groupMemberRefreshInterval);
            this._groupMemberRefreshInterval = null;
            Utils.log("DetailsPanelUIManager: 已清除群成员刷新定时器。", Utils.logLevels.DEBUG);
        }

        if (show) { // 如果要显示面板
            if (this.detailsPanelEl) this.detailsPanelEl.style.display = 'flex'; // 显示面板的根元素
            if (appContainer) appContainer.classList.add('show-details'); // 主容器添加class以调整布局

            if (viewType === 'details' && this.detailsPanelContentEl) { // 如果是显示聊天详情视图
                this.detailsPanelContentEl.style.display = 'block'; // 显示详情内容区域
                // 如果是群聊，启动群成员定时刷新
                if (ChatManager.currentChatId && ChatManager.currentChatId.startsWith('group_')) {
                    this._startGroupMemberRefreshTimer();
                }
                // 资源预览部分总是尝试显示，除非当前资源类型是 'date' (此时应显示日历)
                if (this.resourcePreviewSectionEl && this._currentResourceType !== 'date') {
                    if(this.resourceGridContainerEl) this.resourceGridContainerEl.style.display = 'grid'; // 显示资源网格
                } else if (this.resourcePreviewSectionEl && this._currentResourceType === 'date' && this.calendarContainerEl) {
                    this.calendarContainerEl.style.display = 'block'; // 显示日历
                }

            } else if (viewType === 'lobby' && this.peopleLobbyContentEl) { // 如果是显示人员大厅视图
                this.peopleLobbyContentEl.style.display = 'flex'; // 显示大厅内容区域
                if (this.resourcePreviewSectionEl) this.resourcePreviewSectionEl.style.display = 'none'; // 人员大厅不显示资源预览
            }
            this.currentView = viewType; // 更新当前视图类型
        } else { // 如果要隐藏面板
            if (this.detailsPanelEl) this.detailsPanelEl.style.display = 'none'; // 隐藏面板的根元素
            if (appContainer) appContainer.classList.remove('show-details'); // 主容器移除class
            this.currentView = null; // 清空当前视图类型
            this._detachResourceScrollListener(); // 解绑资源网格的滚动监听器
        }
    },

    /**
     * 显示主详情内容区域，即当前选定聊天（联系人或群组）的详细信息和资源预览。
     * 如果没有选定聊天，则隐藏面板。
     */
    showMainDetailsContent: function() {
        if (!ChatManager.currentChatId) { // 检查是否有当前聊天
            Utils.log("DetailsPanelUIManager: 无法显示详情，没有选中的聊天。", Utils.logLevels.INFO);
            this.hideSidePanel(); // 没有则隐藏面板
            return;
        }
        // 根据当前聊天ID和类型更新面板内容
        this.updateDetailsPanel(ChatManager.currentChatId, ChatManager.currentChatId.startsWith('group_') ? 'group' : 'contact');
        this._setPanelVisibility(true, 'details'); // 设置面板可见，并指定为 'details' 视图
        Utils.log("DetailsPanelUIManager: 显示聊天详情视图。", Utils.logLevels.DEBUG);
    },

    /**
     * 显示人员大厅内容区域。
     * 会隐藏聊天详情特有的部分（如资源预览、群AI提示词等）。
     * @async
     * @returns {Promise<void>}
     */
    showPeopleLobbyContent: async function() {
        if (this.detailsPanelTitleEl) this.detailsPanelTitleEl.textContent = '人员大厅'; // 更新面板标题
        // 确保聊天详情相关的UI部分被隐藏
        if (this.resourcePreviewSectionEl) this.resourcePreviewSectionEl.style.display = 'none';
        if (this.groupAiPromptsSectionEl) this.groupAiPromptsSectionEl.style.display = 'none';
        if (this.detailsGroupManagementEl) this.detailsGroupManagementEl.style.display = 'none';
        if (PeopleLobbyManager) await PeopleLobbyManager.show(); // 调用 PeopleLobbyManager 来准备和显示大厅数据
        this._setPanelVisibility(true, 'lobby'); // 设置面板可见，并指定为 'lobby' 视图
        Utils.log("DetailsPanelUIManager: 显示人员大厅视图。", Utils.logLevels.DEBUG);
    },

    /**
     * 切换聊天详情视图的显示/隐藏状态。
     * 如果已显示聊天详情，则隐藏面板；否则，显示聊天详情。
     */
    toggleChatDetailsView: function() {
        if (this.isPanelAreaVisible && this.currentView === 'details') {
            this.hideSidePanel(); // 如果当前是详情视图且可见，则隐藏
        } else {
            this.showMainDetailsContent(); // 否则显示主详情内容
        }
    },

    /**
     * 切换人员大厅视图的显示/隐藏状态。
     * 如果已显示人员大厅，则隐藏面板；否则，显示人员大厅。
     */
    togglePeopleLobbyView: function() {
        if (this.isPanelAreaVisible && this.currentView === 'lobby') {
            this.hideSidePanel(); // 如果当前是人员大厅视图且可见，则隐藏
        } else {
            this.showPeopleLobbyContent(); // 否则显示人员大厅
        }
    },

    /**
     * 隐藏整个右侧详情面板。
     * 会重置面板标题。
     */
    hideSidePanel: function () {
        this._setPanelVisibility(false); // 设置面板为不可见
        if (this.detailsPanelTitleEl) this.detailsPanelTitleEl.textContent = '聊天信息'; // 重置标题为默认
        Utils.log("DetailsPanelUIManager: 右侧面板已隐藏。", Utils.logLevels.DEBUG);
    },

    /**
     * 根据指定的聊天ID和类型，更新右侧详情面板的内容。
     * 此方法会根据是联系人还是群组，调用相应的私有更新函数。
     * @param {string} chatId - 当前聊天会话的ID。
     * @param {string} type - 聊天类型， 'contact' 或 'group'。
     */
    updateDetailsPanel: function (chatId, type) {
        if (!this.detailsPanelEl || !this.detailsPanelContentEl) return; // 防御：确保核心元素存在
        this.detailsPanelEl.className = 'details-panel'; // 重置面板根元素的类名
        // 统一隐藏所有可能在不同视图中显示的特定区域
        [this.contactActionsDetailsEl, this.detailsGroupManagementEl, this.groupActionsDetailsEl,
            this.aiContactAboutSectionEl, this.aiTtsConfigSectionEl,
            this.groupAiPromptsSectionEl, this.resourcePreviewSectionEl]
            .forEach(el => { if (el) el.style.display = 'none'; });

        // 处理当前聊天通用的操作按钮（如清空聊天记录）
        if (this.currentChatActionsDetailsEl && this.clearCurrentChatBtnDetailsEl) {
            this.currentChatActionsDetailsEl.style.display = chatId ? 'block' : 'none'; // 如果有chatId则显示
            if (chatId) { // 为清空按钮重新绑定事件，避免重复监听
                const newBtn = this.clearCurrentChatBtnDetailsEl.cloneNode(true);
                this.clearCurrentChatBtnDetailsEl.parentNode.replaceChild(newBtn, this.clearCurrentChatBtnDetailsEl);
                this.clearCurrentChatBtnDetailsEl = newBtn;
                this.clearCurrentChatBtnDetailsEl.addEventListener('click', () => MessageManager.clearChat());
            }
        }
        // 根据聊天类型调用具体的更新逻辑
        if (type === 'contact') {
            this._updateForContact(chatId);
            // 如果切换到联系人详情，确保停止群成员刷新定时器
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
     * 更新详情面板以显示指定联系人的信息和相关操作。
     * @param {string} contactId - 要显示的联系人的ID。
     */
    _updateForContact: function(contactId) {
        const contact = UserManager.contacts[contactId]; // 获取联系人对象
        if (!contact || !this.detailsPanelEl) return; // 防御：确保联系人数据和面板元素存在

        if (this.detailsPanelTitleEl) this.detailsPanelTitleEl.textContent = `${contact.name} 信息`; // 设置面板标题
        this.detailsPanelEl.classList.add('contact-details-active'); // 添加联系人详情激活状态的类
        // 根据联系人类型（主题AI、历史AI、普通人类）添加特定类名，用于样式区分
        if (UserManager.isSpecialContactInCurrentTheme(contactId)) {
            this.detailsPanelEl.classList.add(contact.id); // 主题AI，使用其ID作为类名
        } else if (contact.isAI) {
            this.detailsPanelEl.classList.add('historical-ai-contact-active'); // 非主题的历史AI
        } else {
            this.detailsPanelEl.classList.add('human-contact-active'); // 普通人类联系人
        }
        // 更新基本信息：名称、ID、头像、状态
        if (this.detailsNameEl) this.detailsNameEl.textContent = contact.name;
        if (this.detailsIdEl) this.detailsIdEl.textContent = `ID: ${contact.id}`;
        if (this.detailsAvatarEl) {
            this.detailsAvatarEl.className = 'details-avatar'; // 重置头像容器类名
            let fallbackText = (contact.avatarText) ? Utils.escapeHtml(contact.avatarText) :
                (contact.name && contact.name.length > 0) ? Utils.escapeHtml(contact.name.charAt(0).toUpperCase()) : '?';
            let avatarContentHtml;
            // 为头像添加特定类名
            if (UserManager.isSpecialContactInCurrentTheme(contactId)) {
                this.detailsAvatarEl.classList.add('special-avatar', contact.id);
            } else if (contact.isAI) {
                this.detailsAvatarEl.classList.add('historical-ai-avatar');
            }
            // 设置头像内容 (图片或文本)
            if (contact.avatarUrl) {
                avatarContentHtml = `<img src="${contact.avatarUrl}" alt="${fallbackText}" class="avatar-image" data-fallback-text="${fallbackText}" data-entity-id="${contact.id}">`;
            } else {
                avatarContentHtml = fallbackText;
            }
            this.detailsAvatarEl.innerHTML = avatarContentHtml;
        }
        if (this.detailsStatusEl) { // 更新状态文本
            if (UserManager.isSpecialContact(contactId)) { // 包括主题AI和历史AI
                this.detailsStatusEl.textContent = (contact.isAI ? 'AI 助手' : '特殊联系人') ;
            } else { // 普通人类联系人
                this.detailsStatusEl.textContent = ConnectionManager.isConnectedTo(contactId) ? '已连接' : '离线';
            }
        }

        // 根据联系人类型（特殊/AI vs 普通）显示或隐藏特定UI区域
        if (UserManager.isSpecialContact(contactId)) { // 如果是特殊联系人 (AI或主题定义)
            if (this.contactActionsDetailsEl) this.contactActionsDetailsEl.style.display = 'none'; // 隐藏通用联系人操作
            if (contact.isAI && contact.aboutDetails && this.aiContactAboutSectionEl) { // 如果是AI且有"关于"信息
                this._populateAiAboutSection(contact); // 填充"关于"区域
                this.aiContactAboutSectionEl.style.display = 'block'; // 显示"关于"区域
            }
            if (contact.isAI && this.aiTtsConfigSectionEl) { // 如果是AI且可配置TTS
                this._setupAiTtsConfigSection(contact); // 设置TTS配置区域
                this.aiTtsConfigSectionEl.style.display = 'block'; // 显示TTS配置区域
            }
        } else { // 如果是普通联系人
            if (this.contactActionsDetailsEl) this.contactActionsDetailsEl.style.display = 'block'; // 显示通用联系人操作
            if (this.deleteContactBtnDetailsEl) { // 重新绑定删除联系人按钮事件
                const newBtn = this.deleteContactBtnDetailsEl.cloneNode(true);
                this.deleteContactBtnDetailsEl.parentNode.replaceChild(newBtn, this.deleteContactBtnDetailsEl);
                this.deleteContactBtnDetailsEl = newBtn;
                this.deleteContactBtnDetailsEl.addEventListener('click', () => ChatManager.deleteChat(contactId, 'contact'));
            }
            // 隐藏AI相关区域
            if (this.aiTtsConfigSectionEl) this.aiTtsConfigSectionEl.style.display = 'none';
            if (this.aiContactAboutSectionEl) this.aiContactAboutSectionEl.style.display = 'none';
        }
        // 确保群组相关的UI区域被隐藏
        if (this.groupAiPromptsSectionEl) this.groupAiPromptsSectionEl.style.display = 'none';
        if (this.detailsGroupManagementEl) this.detailsGroupManagementEl.style.display = 'none';

        // 对于联系人详情，同样显示资源预览模块
        if (this.resourcePreviewSectionEl && (this.resourceGridContainerEl || this.calendarContainerEl)) {
            this.resourcePreviewSectionEl.style.display = 'block'; // 显示资源预览模块
            this._currentResourceChatId = contactId; // 设置当前预览的聊天ID
            this._attachResourceScrollListener(); // 附加滚动加载监听器 (如果适用)
            this._switchResourceTypeAndLoad(this._currentResourceType, true); // 切换联系人时强制重新加载资源
        } else { // 如果资源预览相关元素不存在
            if(this.resourcePreviewSectionEl) this.resourcePreviewSectionEl.style.display = 'none'; // 隐藏模块
            this._detachResourceScrollListener(); // 解绑监听器
        }
    },

    /**
     * @private
     * 填充 AI 联系人的 "关于" (About) 部分的UI元素。
     * @param {object} contact - AI 联系人对象，应包含 `aboutDetails` 属性。
     */
    _populateAiAboutSection: function(contact) {
        if (this.aiContactAboutNameEl) this.aiContactAboutNameEl.textContent = contact.aboutDetails.nameForAbout || contact.name;
        if (this.aiContactAboutNameSubEl) this.aiContactAboutNameSubEl.textContent = contact.aboutDetails.nameForAbout || contact.name;
        if (this.aiContactBasicInfoListEl) {
            this.aiContactBasicInfoListEl.innerHTML = ''; // 清空旧的基本信息
            contact.aboutDetails.basicInfo.forEach(info => { // 遍历并添加新的基本信息项
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
     * 会调用 TtsUIManager 来填充配置表单，并绑定保存设置的按钮事件。
     * @param {object} contact - AI 联系人对象。
     */
    _setupAiTtsConfigSection: function(contact) {
        // 使用 TtsUIManager 动态填充TTS配置表单内容到 'ttsConfigFormContainer' 元素内
        TtsUIManager.populateAiTtsConfigurationForm(contact, 'ttsConfigFormContainer');
        // 重新绑定保存TTS设置按钮的事件监听器
        if (this.saveAiTtsSettingsBtnDetailsEl) {
            if (TtsUIManager._boundSaveTtsListener) { // 如果已存在绑定的监听器，先移除
                this.saveAiTtsSettingsBtnDetailsEl.removeEventListener('click', TtsUIManager._boundSaveTtsListener);
            }
            // 创建新的绑定监听器，并关联到当前AI联系人ID
            TtsUIManager._boundSaveTtsListener = TtsUIManager.handleSaveAiTtsSettings.bind(TtsUIManager, contact.id);
            this.saveAiTtsSettingsBtnDetailsEl.addEventListener('click', TtsUIManager._boundSaveTtsListener);
        }
        // 注意: 此区域的折叠功能由 _makeElementCollapsible 在 bindEvents 中统一处理
    },

    /**
     * @private
     * 更新详情面板以显示指定群组的信息和相关操作。
     * @param {string} groupId - 要显示的群组的ID。
     */
    _updateForGroup: function(groupId) {
        const group = GroupManager.groups[groupId]; // 获取群组对象
        if (!group || !this.detailsPanelEl) return; // 防御：确保群组数据和面板元素存在

        if (this.detailsPanelTitleEl) this.detailsPanelTitleEl.textContent = `${group.name} 信息`; // 设置面板标题
        this.detailsPanelEl.classList.add('group-chat-active'); // 添加群组详情激活状态的类
        // 移除之前可能存在的联系人特定类名 (保留 'group-chat-active' 和 'contact-details-active' 等基础类)
        Array.from(this.detailsPanelEl.classList).forEach(cls => {
            if (cls.startsWith('AI_') || cls.endsWith('-active')) { // 检查特定格式的类名
                if (cls !== 'group-chat-active' && cls !== 'contact-details-active') {
                    this.detailsPanelEl.classList.remove(cls);
                }
            }
        });
        // 更新基本信息：名称、ID、头像、状态
        if (this.detailsNameEl) this.detailsNameEl.textContent = group.name;
        if (this.detailsIdEl) this.detailsIdEl.textContent = `群组 ID: ${group.id.substring(6)}`; // 去掉 "group_" 前缀显示
        if (this.detailsAvatarEl) { // 设置群组头像
            this.detailsAvatarEl.innerHTML = '👥'; // 使用群组图标
            this.detailsAvatarEl.className = 'details-avatar group'; // 应用群组特定头像样式
        }
        if (this.detailsStatusEl) this.detailsStatusEl.textContent = `${group.members.length} 名成员 (上限 ${GroupManager.MAX_GROUP_MEMBERS})`; // 显示成员数量和上限

        // 显示群组管理和操作相关的UI区域
        if (this.detailsGroupManagementEl) this.detailsGroupManagementEl.style.display = 'block';
        if (this.groupActionsDetailsEl) this.groupActionsDetailsEl.style.display = 'block';

        const isOwner = group.owner === UserManager.userId; // 判断当前用户是否为群主
        // 根据是否群主，控制添加成员区域和已离开成员列表的显示
        if (this.addGroupMemberAreaEl) this.addGroupMemberAreaEl.style.display = isOwner ? 'block' : 'none';
        if (this.leftMembersAreaEl) this.leftMembersAreaEl.style.display = isOwner && group.leftMembers && group.leftMembers.length > 0 ? 'block' : 'none';

        // 重新绑定离开群组/解散群组按钮的事件和显隐状态
        if (this.leaveGroupBtnDetailsEl) {
            this.leaveGroupBtnDetailsEl.style.display = isOwner ? 'none' : 'block'; // 群主不显示离开，显示解散
            if(!isOwner) { // 非群主绑定离开事件
                const newBtn = this.leaveGroupBtnDetailsEl.cloneNode(true);
                this.leaveGroupBtnDetailsEl.parentNode.replaceChild(newBtn, this.leaveGroupBtnDetailsEl);
                this.leaveGroupBtnDetailsEl = newBtn;
                this.leaveGroupBtnDetailsEl.addEventListener('click', () => ChatManager.deleteChat(groupId, 'group'));
            }
        }
        if (this.dissolveGroupBtnDetailsEl) {
            this.dissolveGroupBtnDetailsEl.style.display = isOwner ? 'block' : 'none'; // 仅群主显示解散
            if(isOwner) { // 群主绑定解散事件
                const newBtn = this.dissolveGroupBtnDetailsEl.cloneNode(true);
                this.dissolveGroupBtnDetailsEl.parentNode.replaceChild(newBtn, this.dissolveGroupBtnDetailsEl);
                this.dissolveGroupBtnDetailsEl = newBtn;
                this.dissolveGroupBtnDetailsEl.addEventListener('click', () => ChatManager.deleteChat(groupId, 'group'));
            }
        }
        this.updateDetailsPanelMembers(groupId); // 更新群成员列表的显示

        // 群内AI提示词编辑部分：仅群主可见，且群内有AI成员时
        if (this.groupAiPromptsSectionEl && isOwner) {
            const aiMembersInGroup = group.members.filter(memberId => UserManager.contacts[memberId]?.isAI); // 筛选出群内的AI成员
            if (aiMembersInGroup.length > 0) { // 如果有AI成员
                this.groupAiPromptsSectionEl.style.display = 'block'; // 显示该区域
                if(this.groupAiPromptsHeaderEl) this.groupAiPromptsHeaderEl.style.display = 'flex'; // 确保折叠头部可见
                this._populateGroupAiPromptsEditor(groupId, group, aiMembersInGroup); // 填充编辑器内容
            } else { // 没有AI成员则隐藏
                this.groupAiPromptsSectionEl.style.display = 'none';
            }
        } else if (this.groupAiPromptsSectionEl) { // 非群主或元素不存在，则隐藏
            this.groupAiPromptsSectionEl.style.display = 'none';
        }

        // 确保联系人特有的UI区域被隐藏
        if (this.aiContactAboutSectionEl) this.aiContactAboutSectionEl.style.display = 'none';
        if (this.aiTtsConfigSectionEl) this.aiTtsConfigSectionEl.style.display = 'none';

        // 对于群组详情，同样显示资源预览模块
        if (this.resourcePreviewSectionEl && (this.resourceGridContainerEl || this.calendarContainerEl)) {
            this.resourcePreviewSectionEl.style.display = 'block'; // 显示资源预览模块
            this._currentResourceChatId = groupId; // 设置当前预览的聊天ID
            this._attachResourceScrollListener(); // 附加滚动加载监听器 (如果适用)
            this._switchResourceTypeAndLoad(this._currentResourceType, true); // 切换群组时强制重新加载资源

            // 确保资源预览模块位于所有群组设置之后 (即父容器的最后一个子元素)
            if (this.detailsPanelContentEl && this.detailsPanelContentEl.lastChild !== this.resourcePreviewSectionEl) {
                this.detailsPanelContentEl.appendChild(this.resourcePreviewSectionEl);
            }

        } else { // 如果资源预览相关元素不存在
            if(this.resourcePreviewSectionEl) this.resourcePreviewSectionEl.style.display = 'none'; // 隐藏模块
            this._detachResourceScrollListener(); // 解绑监听器
        }

        // 如果当前聊天就是此群组，且面板可见并处于详情视图，则启动群成员状态刷新定时器
        if (ChatManager.currentChatId === groupId && this.isPanelAreaVisible && this.currentView === 'details') {
            this._startGroupMemberRefreshTimer();
        }
    },

    /**
     * @private
     * 为群组内的每个AI成员填充其特定行为指示（提示词）的编辑器。
     * 仅群主可操作。
     * @param {string} groupId - 当前群组的ID。
     * @param {object} group - 当前群组对象。
     * @param {Array<string>} aiMemberIds - 群组内所有AI成员的ID列表。
     */
    _populateGroupAiPromptsEditor: function(groupId, group, aiMemberIds) {
        if (!this.groupAiPromptsListContainerEl) { // 防御：确保容器元素存在
            Utils.log("DetailsPanelUIManager: groupAiPromptsListContainerEl 未找到，无法填充AI提示词编辑器。", Utils.logLevels.ERROR);
            return;
        }
        this.groupAiPromptsListContainerEl.innerHTML = ''; // 清空已有的编辑器项
        aiMemberIds.forEach(aiId => { // 遍历群内每个AI成员
            const aiContact = UserManager.contacts[aiId]; // 获取AI联系人对象
            if (!aiContact || !aiContact.isAI) return; // 跳过无效或非AI的成员

            // 创建单个AI提示词编辑项的容器
            const itemDiv = document.createElement('div');
            itemDiv.className = 'ai-prompt-editor-item';
            itemDiv.dataset.aiId = aiId; // 将AI ID存储在元素上，便于后续操作

            // 显示AI角色名称
            const nameHeader = document.createElement('h5');
            nameHeader.textContent = `AI角色: ${aiContact.name}`;
            itemDiv.appendChild(nameHeader);

            // 确定当前AI的提示词文本
            // 优先级：群组特定提示词 > AI默认系统提示词 > 空字符串
            let currentPromptText = "";
            if (group.aiPrompts && group.aiPrompts[aiId] !== undefined) {
                currentPromptText = group.aiPrompts[aiId]; // 使用群组特定提示词
            } else if (aiContact.aiConfig && aiContact.aiConfig.systemPrompt !== undefined) {
                currentPromptText = aiContact.aiConfig.systemPrompt; // 使用AI默认系统提示词
            }

            // 创建文本输入区域
            const promptTextarea = document.createElement('textarea');
            promptTextarea.value = currentPromptText;
            promptTextarea.placeholder = "输入此AI在群组中的特定行为指示...";
            promptTextarea.rows = 3; // 合理的默认行数
            promptTextarea.className = 'group-ai-prompt-textarea'; // 用于可能的特定样式
            itemDiv.appendChild(promptTextarea);

            // 创建按钮容器 (保存、重置)
            const buttonContainer = document.createElement('div');
            buttonContainer.style.marginTop = '8px';
            buttonContainer.style.display = 'flex';
            buttonContainer.style.gap = '8px'; // 按钮间距

            // 创建保存按钮
            const saveBtn = document.createElement('button');
            saveBtn.textContent = '保存指示';
            saveBtn.className = 'btn btn-primary btn-sm'; // 使用Bootstrap样式 (小号按钮)
            saveBtn.addEventListener('click', async () => {
                const newPrompt = promptTextarea.value.trim(); // 获取并清理输入的新提示词
                let promptChanged = false; // 标记提示词是否实际发生变化
                if (!group.aiPrompts) group.aiPrompts = {}; // 确保群组对象上有aiPrompts属性

                // 判断提示词是否真的改变了
                if ((group.aiPrompts[aiId] === undefined && newPrompt !== "") || // 之前无特定提示，新提示非空
                    (group.aiPrompts[aiId] !== undefined && group.aiPrompts[aiId] !== newPrompt)) { // 之前有特定提示，且与新提示不同
                    group.aiPrompts[aiId] = newPrompt; // 更新群组对象中的提示词
                    promptChanged = true;
                }

                if (promptChanged) { // 如果提示词已改变
                    await GroupManager.saveGroup(groupId); // 保存群组数据 (通常会持久化到存储)
                    // 如果GroupManager有通知方法，则调用以通知其他成员或系统
                    if (typeof GroupManager.notifyAiPromptChanged === 'function') {
                        GroupManager.notifyAiPromptChanged(groupId, aiId, newPrompt);
                    }
                    NotificationUIManager.showNotification(`AI "${aiContact.name}" 在此群组的行为指示已更新。`, 'success');
                } else { // 如果未发生变化
                    NotificationUIManager.showNotification('行为指示未发生变化。', 'info');
                }
            });
            buttonContainer.appendChild(saveBtn);

            // 创建重置为默认按钮
            const resetBtn = document.createElement('button');
            resetBtn.textContent = '重置为默认';
            resetBtn.className = 'btn btn-secondary btn-sm';
            resetBtn.addEventListener('click', async () => {
                // 获取AI的默认系统提示词
                const defaultPrompt = (aiContact.aiConfig && aiContact.aiConfig.systemPrompt) ? aiContact.aiConfig.systemPrompt : "";
                let promptChanged = false; // 标记提示词是否实际发生变化

                // 判断是否需要更新或删除群组特定提示词以恢复默认
                if (group.aiPrompts && group.aiPrompts[aiId] !== undefined && group.aiPrompts[aiId] !== defaultPrompt) {
                    // 当前有特定提示，且与默认不同 -> 重置为默认
                    group.aiPrompts[aiId] = defaultPrompt;
                    promptChanged = true;
                } else if (group.aiPrompts && group.aiPrompts[aiId] === undefined && defaultPrompt !== "") {
                    // 当前无特定提示，但默认提示非空 -> 设置为默认 (理论上不应发生，因为已优先使用默认)
                    group.aiPrompts[aiId] = defaultPrompt;
                    promptChanged = true;
                } else if (group.aiPrompts && group.aiPrompts[aiId] !== undefined && defaultPrompt === "" && group.aiPrompts[aiId] !== "") {
                    // 默认提示为空，但当前有特定提示 -> 删除特定提示以恢复空默认
                    delete group.aiPrompts[aiId];
                    promptChanged = true;
                }

                promptTextarea.value = defaultPrompt; // 更新文本区域显示为默认提示词
                if (promptChanged) { // 如果提示词已改变
                    await GroupManager.saveGroup(groupId); // 保存群组数据
                    if (typeof GroupManager.notifyAiPromptChanged === 'function') {
                        GroupManager.notifyAiPromptChanged(groupId, aiId, defaultPrompt);
                    }
                    NotificationUIManager.showNotification(`AI "${aiContact.name}" 在此群组的行为指示已重置为默认。`, 'success');
                } else { // 如果未发生变化
                    NotificationUIManager.showNotification(`AI "${aiContact.name}" 已在使用默认指示或无变化。`, 'info');
                }
            });
            buttonContainer.appendChild(resetBtn);
            itemDiv.appendChild(buttonContainer); // 将按钮容器添加到编辑项

            this.groupAiPromptsListContainerEl.appendChild(itemDiv); // 将编辑项添加到总容器
        });
    },

    /**
     * 更新群组详情面板中的成员列表显示，包括成员名称、状态、操作按钮，
     * 以及添加成员的下拉框和已离开成员列表（如果适用）。
     * 成员会按照特定顺序排序（群主 > 在线人类 > AI > 离线人类）。
     * @param {string} groupId - 当前群组的ID。
     */
    updateDetailsPanelMembers: function (groupId) {
        const group = GroupManager.groups[groupId]; // 获取群组对象
        // 防御：确保群组数据和所需DOM元素存在
        if (!group || !this.groupMemberListDetailsEl || !this.groupMemberCountEl || !this.contactsDropdownDetailsEl || !document.getElementById('leftMemberListDetails')) return;
        const leftMemberListDetailsEl = document.getElementById('leftMemberListDetails'); // 获取已离开成员列表的容器

        this.groupMemberListDetailsEl.innerHTML = ''; // 清空现有成员列表
        this.groupMemberCountEl.textContent = group.members.length; // 更新成员数量显示

        // 准备成员数据，附加排序所需信息
        const membersWithSortInfo = group.members.map(memberId => {
            const member = UserManager.contacts[memberId] || { id: memberId, name: `用户 ${memberId.substring(0, 4)}`, isAI: false }; // 获取成员对象，或提供默认值
            let sortCategory; // 用于排序的类别
            const isOwner = memberId === group.owner; // 是否为群主
            const isAI = member.isAI; // 是否为AI
            // 判断是否在线 (非AI、非群主，且在PeopleLobbyManager的在线用户列表中)
            const isOnline = (!isAI && !isOwner && PeopleLobbyManager.onlineUserIds && PeopleLobbyManager.onlineUserIds.includes(memberId));

            // 定义排序类别：0=群主, 1=在线人类, 2=AI, 3=离线人类
            if (isOwner) {
                sortCategory = 0;
            } else if (!isAI && isOnline) {
                sortCategory = 1;
            } else if (isAI) {
                sortCategory = 2;
            } else { // 离线人类成员
                sortCategory = 3;
            }
            return { ...member, id: memberId, sortCategory, isOnlineForSort: isOnline }; // 返回包含排序信息的成员对象
        });

        // 对成员列表进行排序
        membersWithSortInfo.sort((a, b) => {
            if (a.sortCategory !== b.sortCategory) { // 首先按排序类别排序
                return a.sortCategory - b.sortCategory;
            }
            // 同类别内，按名称排序 (不区分大小写)
            return (a.name || '').localeCompare(b.name || '', undefined, { sensitivity: 'base' });
        });

        // 遍历排序后的成员列表并渲染到DOM
        membersWithSortInfo.forEach(memberData => {
            const memberId = memberData.id;
            const member = memberData; // memberData已包含排序信息和原始成员信息

            const item = document.createElement('div'); // 创建单个成员项的容器
            item.className = 'member-item-detail';

            // 构建成员信息HTML (名称、是否自己、是否AI)
            let memberInfoHtml = `<span class="member-name">${Utils.escapeHtml(member.name)} ${memberId === UserManager.userId ? '(您)' : ''} ${member.isAI ? '(AI)' : ''}</span>`;
            let statusHtml = ''; // 成员状态HTML (在线/离线/已连接)
            let actionsHtml = ''; // 成员操作HTML (移除/重连按钮)

            // 处理非当前用户且非AI的成员状态和操作
            if (memberId !== UserManager.userId && !member.isAI) {
                const isConnected = ConnectionManager.isConnectedTo(memberId); // 是否已通过WebRTC连接
                const isActuallyOnline = PeopleLobbyManager.onlineUserIds ? PeopleLobbyManager.onlineUserIds.includes(memberId) : false; // 是否在全局在线列表

                let onlineStatusText = isActuallyOnline ? '在线' : '离线';
                let statusClass = 'offline'; // 默认状态样式

                if(isActuallyOnline){ // 如果在全局在线列表
                    statusClass = isConnected ? 'connected' : 'online-not-connected'; // 根据连接状态设置特定样式
                }
                if(isConnected) onlineStatusText = '已连接'; // 如果已连接，状态文本优先显示'已连接'

                statusHtml = `<span class="member-status ${statusClass}">(${onlineStatusText})</span>`;
                // 如果在线但未连接，显示重连按钮
                if (!isConnected && isActuallyOnline) {
                    actionsHtml += `<button class="reconnect-member-btn-detail" data-member-id="${memberId}" title="重新连接">🔄</button>`;
                }
            }

            // 如果是群主，添加群主徽章；如果是群主在查看，为其他成员添加移除按钮
            if (memberId === group.owner) {
                memberInfoHtml += '<span class="owner-badge">群主</span>';
            } else if (group.owner === UserManager.userId) { // 当前用户是群主，且此成员不是群主
                actionsHtml += `<button class="remove-member-btn-detail" data-member-id="${memberId}" title="移除成员">✕</button>`;
            }
            item.innerHTML = `${memberInfoHtml} ${statusHtml} <span class="member-actions">${actionsHtml}</span>`; // 组合HTML并设置
            this.groupMemberListDetailsEl.appendChild(item); // 添加到成员列表容器
        });


        // 重新绑定所有移除成员按钮的事件
        this.groupMemberListDetailsEl.querySelectorAll('.remove-member-btn-detail').forEach(btn => {
            const newBtn = btn.cloneNode(true); // 克隆按钮以移除旧监听器
            btn.parentNode.replaceChild(newBtn, btn); // 替换旧按钮
            newBtn.addEventListener('click', () => GroupManager.removeMemberFromGroup(groupId, newBtn.dataset.memberId));
        });

        // 重新绑定所有重连成员按钮的事件
        this.groupMemberListDetailsEl.querySelectorAll('.reconnect-member-btn-detail').forEach(btn => {
            const newBtn = btn.cloneNode(true);
            btn.parentNode.replaceChild(newBtn, btn);
            newBtn.addEventListener('click', async () => {
                const targetMemberId = newBtn.dataset.memberId;
                NotificationUIManager.showNotification(`尝试重新连接到 ${UserManager.contacts[targetMemberId]?.name || targetMemberId.substring(0,4)}...`, 'info');
                await ConnectionManager.createOffer(targetMemberId, { isSilent: false }); // 非静默尝试连接 (会显示通知)
            });
        });

        // 填充添加成员的下拉框
        this.contactsDropdownDetailsEl.innerHTML = '<option value="">选择要添加的联系人...</option>'; // 清空并添加默认选项
        Object.values(UserManager.contacts).forEach(contact => { // 遍历所有联系人
            const isAlreadyMember = group.members.includes(contact.id); // 是否已是成员
            const hasLeft = group.leftMembers?.some(lm => lm.id === contact.id); // 是否曾离开过该群
            // 定义可添加的AI：当前主题中定义的特殊AI角色
            const isAddableCurrentThemeAI = UserManager.isSpecialContactInCurrentTheme(contact.id) && contact.isAI;
            // 定义可添加的普通联系人：非特殊且非AI
            const isRegularContact = !contact.isSpecial && !contact.isAI;

            // 如果联系人未在群内、未曾离开，并且是可添加的AI或普通联系人，则加入下拉列表
            if (!isAlreadyMember && !hasLeft && (isAddableCurrentThemeAI || isRegularContact)) {
                const option = document.createElement('option');
                option.value = contact.id;
                option.textContent = `${contact.name} ${contact.isAI ? '(AI助手)' : ''}`;
                this.contactsDropdownDetailsEl.appendChild(option);
            }
        });

        // 填充已离开成员列表 (仅群主可见)
        leftMemberListDetailsEl.innerHTML = ''; // 清空列表
        if (group.owner === UserManager.userId && group.leftMembers && group.leftMembers.length > 0 && this.leftMembersAreaEl) {
            group.leftMembers.forEach(leftMember => { // 遍历已离开成员
                const item = document.createElement('div');
                item.className = 'left-member-item-detail';
                item.innerHTML = `<span>${Utils.escapeHtml(leftMember.name)} (离开于: ${Utils.formatDate(new Date(leftMember.leftTime))})</span>
<button class="re-add-member-btn-detail" data-member-id="${leftMember.id}" data-member-name="${Utils.escapeHtml(leftMember.name)}" title="重新添加成员">+</button>`;
                leftMemberListDetailsEl.appendChild(item);
            });
            // 重新绑定重新添加离开成员按钮的事件
            leftMemberListDetailsEl.querySelectorAll('.re-add-member-btn-detail').forEach(btn => {
                const newBtn = btn.cloneNode(true);
                btn.parentNode.replaceChild(newBtn, btn);
                newBtn.addEventListener('click', () => GroupManager.addMemberToGroup(groupId, newBtn.dataset.memberId, newBtn.dataset.memberName));
            });
            this.leftMembersAreaEl.style.display = 'block'; // 显示已离开成员区域
        } else if (this.leftMembersAreaEl) { // 否则隐藏
            this.leftMembersAreaEl.style.display = 'none';
        }
    },

    /**
     * 处理从详情面板的下拉框中选择联系人并将其添加到当前群组的逻辑。
     * 仅当群组ID和选定的成员ID都有效时才执行操作。
     */
    handleAddMemberToGroupDetails: function () {
        const groupId = ChatManager.currentChatId; // 获取当前群组ID
        if (!this.contactsDropdownDetailsEl) return; // 防御：确保下拉框元素存在
        const memberId = this.contactsDropdownDetailsEl.value; // 获取选中的成员ID
        // 获取选中成员的名称 (从option的文本中提取，并移除可能的 "(AI助手)" 后缀)
        const memberName = this.contactsDropdownDetailsEl.selectedOptions[0]?.text.replace(/\s*\(AI助手\)$/, '').trim();

        if (groupId && memberId) { // 如果群组ID和成员ID都有效
            GroupManager.addMemberToGroup(groupId, memberId, memberName).then(success => {
                // 如果添加成功，清空下拉框的选中状态
                if (success && this.contactsDropdownDetailsEl) this.contactsDropdownDetailsEl.value = "";
            });
        } else { // 如果未选择联系人
            NotificationUIManager.showNotification("请选择要添加的联系人。", "warning");
        }
    },

    /**
     * @private
     * 启动群成员状态的自动刷新定时器。
     * 定时器会定期调用 `_refreshGroupMembersAndAutoConnect` 方法。
     * 如果已有定时器在运行，会先清除旧的再创建新的。
     */
    _startGroupMemberRefreshTimer: function() {
        if (this._groupMemberRefreshInterval) { // 如果已有定时器，先清除
            clearInterval(this._groupMemberRefreshInterval);
            this._groupMemberRefreshInterval = null;
        }
        this._refreshGroupMembersAndAutoConnect(); // 立即执行一次刷新和自动连接逻辑
        // 设置新的定时器
        this._groupMemberRefreshInterval = setInterval(() => {
            // 检查是否仍满足刷新条件 (面板可见、当前是详情视图、当前是群聊)
            if (this.isPanelAreaVisible && this.currentView === 'details' &&
                ChatManager.currentChatId && ChatManager.currentChatId.startsWith('group_')) {
                this._refreshGroupMembersAndAutoConnect(); // 满足条件则执行
            } else { // 如果条件不满足，清除定时器
                if (this._groupMemberRefreshInterval) {
                    clearInterval(this._groupMemberRefreshInterval);
                    this._groupMemberRefreshInterval = null;
                    Utils.log("DetailsPanelUIManager: 群组成员自动刷新定时器已停止（条件不满足）。", Utils.logLevels.DEBUG);
                }
            }
        }, this.GROUP_MEMBER_REFRESH_INTERVAL_MS); // 按预设间隔执行
        Utils.log("DetailsPanelUIManager: 已启动群成员状态自动刷新和连接定时器。", Utils.logLevels.DEBUG);
    },

    /**
     * @private
     * 刷新当前群组的成员状态，并尝试自动连接那些在线但尚未通过WebRTC连接的成员。
     * 会先获取最新的全局在线用户列表，然后更新UI，最后尝试连接。
     * @async
     * @returns {Promise<void>}
     */
    _refreshGroupMembersAndAutoConnect: async function() {
        const groupId = ChatManager.currentChatId;
        if (!groupId || !groupId.startsWith('group_')) return; // 确保当前是群聊
        const group = GroupManager.groups[groupId];
        if (!group) return; // 确保群组数据存在

        // 获取最新的全局在线用户列表
        if (PeopleLobbyManager && typeof PeopleLobbyManager.fetchOnlineUsers === 'function') {
            await PeopleLobbyManager.fetchOnlineUsers();
        }
        this.updateDetailsPanelMembers(groupId); // 更新群成员列表的UI显示
        Utils.log(`DetailsPanelUIManager: 定时刷新群成员 (${groupId}) 状态。`, Utils.logLevels.DEBUG);

        // 遍历群成员，尝试自动连接在线但未连接的（非AI、非自己）
        group.members.forEach(memberId => {
            // 跳过当前用户和AI成员
            if (memberId === UserManager.userId || (UserManager.contacts[memberId] && UserManager.contacts[memberId].isAI)) {
                return;
            }
            const isConnected = ConnectionManager.isConnectedTo(memberId); // 是否已WebRTC连接
            const isOnline = PeopleLobbyManager.onlineUserIds ? PeopleLobbyManager.onlineUserIds.includes(memberId) : false; // 是否在全局在线列表

            if (isOnline && !isConnected) { // 如果在全局在线但未WebRTC连接
                Utils.log(`DetailsPanelUIManager: 自动尝试连接到群成员 ${memberId} (在线但未连接)。`, Utils.logLevels.INFO);
                ConnectionManager.createOffer(memberId, { isSilent: true }); // 静默尝试发起连接 (不主动显示通知)
            }
        });
    },

    /**
     * @private
     * 切换资源预览的类型（如影像、文本、日期等）并加载相应数据。
     * @param {string} resourceType - 要切换到的资源类型。
     * @param {boolean} [forceReload=false] - 是否强制重新加载数据，即使类型未变。通常在搜索或切换聊天时使用。
     */
    _switchResourceTypeAndLoad: function(resourceType, forceReload = false) {
        // 防御：确保有当前聊天ID和必要的DOM元素
        if (!this._currentResourceChatId || (!this.resourceGridContainerEl && resourceType !== 'date') || (!this.calendarContainerEl && resourceType === 'date')) return;
        Utils.log(`DetailsPanelUIManager: 切换到资源类型: ${resourceType} for chat ${this._currentResourceChatId}`, Utils.logLevels.DEBUG);

        const prevResourceType = this._currentResourceType; // 保存切换前的类型
        this._currentResourceType = resourceType; // 更新当前资源类型

        // 更新分类标签按钮的激活状态
        for (const type in this.resourceCategoryButtons) {
            if (this.resourceCategoryButtons[type]) {
                this.resourceCategoryButtons[type].classList.toggle('active', type === resourceType);
            }
        }

        // 根据新的资源类型显示/隐藏资源网格或日历容器
        if (this.resourceGridContainerEl) {
            this.resourceGridContainerEl.style.display = (resourceType !== 'date') ? 'grid' : 'none'; // 非日期类型显示网格
        }
        if (this.calendarContainerEl) {
            this.calendarContainerEl.style.display = (resourceType === 'date') ? 'block' : 'none'; // 日期类型显示日历
        }
        // 如果切换到日期类型
        if (resourceType === 'date') {
            this._renderCalendar(); // 渲染日历视图
            if (this.resourceGridLoadingIndicatorEl) this.resourceGridLoadingIndicatorEl.style.display = 'none'; // 隐藏网格加载指示器
            this._detachResourceScrollListener(); // 日历视图不需要滚动加载，解绑监听器
            return; // 日期类型处理完毕，直接返回
        } else { // 其他类型（影像、文本、其它）
            this._attachResourceScrollListener(); // 需要网格滚动加载，附加监听器
        }

        // 如果强制重新加载，或者资源类型确实发生了变化，则重置资源列表和计数器
        if (forceReload || prevResourceType !== resourceType) {
            this._resourceItems = []; // 清空已加载的资源项
            this._resourceGridRenderedItemsCount = 0; // 重置已渲染的资源项计数
            this._rawItemsFetchedCount = 0; // 重置已从DB获取的原始项目计数（用于搜索分页）
            if (this.resourceGridContainerEl) this.resourceGridContainerEl.innerHTML = ''; // 清空资源网格的现有内容
        }
        this._lastFetchWasEmptySearch = false; // 重置空搜索标记
        this._loadMoreResources(true); // 初始加载新类型或过滤后的资源
    },

    /**
     * @private
     * 异步加载更多资源消息并渲染到资源预览网格中。
     * 支持分页加载和基于当前搜索查询的过滤。
     * @param {boolean} [isInitialLoad=false] - 标记是否为初始加载（例如切换类型或首次打开）。
     */
    _loadMoreResources: async function(isInitialLoad = false) {
        // 防止重复加载、在无聊天ID时加载、或在日期视图下加载网格资源
        if (this._isResourceLoading || !this._currentResourceChatId || this._currentResourceType === 'date') return;
        this._isResourceLoading = true; // 设置加载状态，防止并发调用
        if (this.resourceGridLoadingIndicatorEl) this.resourceGridLoadingIndicatorEl.style.display = 'flex'; // 显示加载动画

        try {
            // 从ChatManager获取一批原始资源消息 (分页)
            const newRawItems = await ChatManager.getMessagesWithResources(
                this._currentResourceChatId, this._currentResourceType,
                this._rawItemsFetchedCount, // 跳过的项目数 (偏移量)
                15 // 每批获取数量 (限制)
            );

            if (newRawItems && newRawItems.length > 0) { // 如果成功获取到新的原始项目
                this._rawItemsFetchedCount += newRawItems.length; // 更新已获取的原始项目总数

                let itemsToRenderThisBatch = newRawItems; // 默认情况下，本批获取的所有项目都准备渲染
                // 如果存在搜索查询，则过滤本批获取的项目
                if (this._currentSearchQuery) {
                    itemsToRenderThisBatch = newRawItems.filter(msg => {
                        if (this._currentResourceType === 'text' && msg.content) { // 文本类型按内容搜索
                            return msg.content.toLowerCase().includes(this._currentSearchQuery);
                        } else if ((this._currentResourceType === 'imagery' || this._currentResourceType === 'other') && msg.fileName) { // 影像和其它类型按文件名搜索
                            return msg.fileName.toLowerCase().includes(this._currentSearchQuery);
                        }
                        return false; // 其他情况或无匹配字段，不包含
                    });
                }

                if (itemsToRenderThisBatch.length > 0) { // 如果本批中有项目需要渲染 (原始项目或过滤后的项目)
                    const fragment = document.createDocumentFragment(); // 使用文档片段优化DOM操作
                    itemsToRenderThisBatch.forEach(itemData => {
                        const itemEl = this._createResourcePreviewItem(itemData); // 创建预览项DOM元素
                        if (itemEl) {
                            fragment.appendChild(itemEl); // 添加到片段
                            this._resourceItems.push(itemData); // 将成功渲染的项目数据添加到内部列表
                        }
                    });
                    if (this.resourceGridContainerEl) this.resourceGridContainerEl.appendChild(fragment); // 将片段一次性添加到网格
                    this._resourceGridRenderedItemsCount = this._resourceItems.length; // 更新已渲染总数
                    this._lastFetchWasEmptySearch = false; // 重置空搜索标记
                } else if (newRawItems.length > 0 && this._currentSearchQuery) {
                    // 如果获取了原始项目，但经过搜索过滤后本批无项目可渲染
                    // 并且当前网格内容未填满可视区域，则尝试加载下一批原始项目
                    // 这是为了确保在搜索时，如果当前批次没有匹配项，能继续查找直到填满屏幕或无更多数据
                    if(this.resourceGridContainerEl && this.resourceGridContainerEl.scrollHeight <= this.resourceGridContainerEl.clientHeight + 100) {
                        Utils.log("搜索：此批次无匹配项，尝试加载更多原始项目。", Utils.logLevels.DEBUG);
                        // 使用 _lastFetchWasEmptySearch 避免因连续空搜索批次导致无限递归加载
                        if (!this._lastFetchWasEmptySearch) {
                            this._lastFetchWasEmptySearch = true; // 标记本次为空搜索获取
                            setTimeout(() => this._loadMoreResources(false), 50); // 延迟加载下一批
                        } else {
                            this._lastFetchWasEmptySearch = false; // 如果上一次也是空搜索，则停止，避免死循环
                        }
                    } else {
                        // 如果网格已滚动，即使本批搜索无结果，也等待用户滚动到底部再加载
                        this._lastFetchWasEmptySearch = false;
                    }
                }
                // 如果是初始加载，但过滤后没有任何项目可渲染 (列表为空)
                if (isInitialLoad && this._resourceItems.length === 0 && this.resourceGridContainerEl) {
                    const emptyMsg = document.createElement('div');
                    emptyMsg.className = 'resource-grid-empty-message';
                    emptyMsg.textContent = this._currentSearchQuery ? '未找到符合搜索条件的资源。' : '此分类下暂无资源。';
                    this.resourceGridContainerEl.innerHTML = ''; // 清空网格
                    this.resourceGridContainerEl.appendChild(emptyMsg); // 显示空状态消息
                }

            } else if (isInitialLoad && this._resourceItems.length === 0) { // 如果是初始加载且未获取到任何项目
                if (this.resourceGridContainerEl) {
                    const emptyMsg = document.createElement('div');
                    emptyMsg.className = 'resource-grid-empty-message';
                    emptyMsg.textContent = this._currentSearchQuery ? '未找到符合搜索条件的资源。' : '此分类下暂无资源。';
                    this.resourceGridContainerEl.innerHTML = ''; // 清空网格
                    this.resourceGridContainerEl.appendChild(emptyMsg); // 显示空状态消息
                }
            }
        } catch (error) { // 捕获加载过程中的错误
            Utils.log(`_loadMoreResources: 加载资源失败 - ${error}`, Utils.logLevels.ERROR);
            NotificationUIManager.showNotification('加载资源失败。', 'error');
        } finally { // 无论成功或失败，都重置加载状态并隐藏加载动画
            this._isResourceLoading = false;
            if (this.resourceGridLoadingIndicatorEl) this.resourceGridLoadingIndicatorEl.style.display = 'none';
        }
    },

    /**
     * @private
     * 异步为指定的图片或视频消息渲染缩略图。
     * 它会尝试从 IndexedDB (DBManager) 获取文件 Blob，然后创建对象URL并设置到 img/video 元素。
     * @param {HTMLDivElement} placeholderDiv - 用于显示缩略图或加载状态的占位符元素。它应有 data-hash 和 data-filetype 属性。
     * @param {object} message - 包含文件信息（如 fileName）的消息对象，用于 alt 文本等。
     * @returns {Promise<void>}
     */
    _renderResourceThumbnail: async function(placeholderDiv, message) {
        const fileHash = placeholderDiv.dataset.hash; // 文件哈希，用作缓存键
        const fileType = placeholderDiv.dataset.filetype; // 文件MIME类型

        try {
            // 从 IndexedDB 获取缓存的文件 Blob
            const cachedItem = await DBManager.getItem('fileCache', fileHash);
            if (!cachedItem || !cachedItem.fileBlob) { // 如果缓存未找到或 Blob 无效
                placeholderDiv.innerHTML = '⚠️'; // 显示错误图标
                placeholderDiv.title = '无法加载预览：文件缓存未找到。';
                return;
            }

            const blob = cachedItem.fileBlob; // 获取 Blob 对象
            const objectURL = URL.createObjectURL(blob); // 创建对象URL

            let mediaElement; // img 或 video 元素
            let loadEventName; // 'load' (img) 或 'loadedmetadata' (video)

            // 根据文件类型创建相应的媒体元素
            if (fileType.startsWith('image/')) {
                mediaElement = document.createElement('img');
                mediaElement.alt = message.fileName || '图片预览';
                loadEventName = 'load';
            } else if (fileType.startsWith('video/')) {
                mediaElement = document.createElement('video');
                mediaElement.muted = true; // 视频默认静音
                mediaElement.preload = "metadata"; // 仅加载元数据以获取尺寸和第一帧
                mediaElement.alt = message.fileName || '视频预览';
                loadEventName = 'loadedmetadata';
            } else { // 非图片或视频类型，不处理缩略图
                URL.revokeObjectURL(objectURL); // 释放对象URL
                return;
            }

            mediaElement.classList.add('message-thumbnail-resource'); // 添加样式类

            // 使用 Promise 封装媒体元素的加载过程
            const loadPromise = new Promise((resolve, reject) => {
                mediaElement.addEventListener(loadEventName, () => { // 监听加载成功事件
                    // 获取媒体的自然尺寸或视频尺寸
                    const dimensions = fileType.startsWith('image/') ?
                        { width: mediaElement.naturalWidth, height: mediaElement.naturalHeight } :
                        { width: mediaElement.videoWidth, height: mediaElement.videoHeight };
                    resolve(dimensions);
                }, { once: true }); // 事件只触发一次
                mediaElement.addEventListener('error', () => reject(new Error(`${fileType.startsWith('image/') ? 'Image' : 'Video'} load error for resource preview`)), { once: true }); // 监听加载错误事件
            });

            mediaElement.src = objectURL; // 设置媒体源为对象URL
            if (fileType.startsWith('video/')) {
                mediaElement.load(); // 对于 video 元素，需要调用 load() 方法
            }

            try {
                await loadPromise; // 等待媒体加载完成（或元数据加载完成）
                placeholderDiv.innerHTML = ''; // 清空占位符内容
                placeholderDiv.appendChild(mediaElement); // 将加载好的媒体元素添加到占位符
                URL.revokeObjectURL(objectURL); // 加载完成后，释放对象URL以节省内存
            } catch (error) { // 捕获媒体加载过程中的错误
                Utils.log(`加载媒体资源预览缩略图失败 (hash: ${fileHash}): ${error.message}`, Utils.logLevels.ERROR);
                placeholderDiv.innerHTML = '⚠️'; // 显示错误图标
                placeholderDiv.title = '预览加载失败。';
                URL.revokeObjectURL(objectURL); // 同样需要释放对象URL
            }
        } catch (dbError) { // 捕获从 IndexedDB 获取文件时的错误
            Utils.log(`从DB获取媒体资源失败 (hash: ${fileHash}): ${dbError.message}`, Utils.logLevels.ERROR);
            placeholderDiv.innerHTML = '⚠️'; // 显示错误图标
            placeholderDiv.title = '无法获取资源。';
        }
    },

    /**
     * @private
     * 根据给定的消息对象创建一个资源预览项的 DOM 元素。
     * 元素的具体内容和样式会根据当前选中的资源类型 (`_currentResourceType`) 和消息类型而变化。
     * @param {object} message - 包含资源信息的消息对象。
     * @returns {HTMLElement|null} - 创建的 DOM 元素，如果无法创建或不适用则返回 null。
     */
    _createResourcePreviewItem: function(message) {
        const itemEl = document.createElement('div'); // 创建预览项的根容器
        itemEl.className = 'resource-preview-item'; // 设置基础样式类
        itemEl.dataset.messageId = message.id; // 将消息ID存储在元素上，用于后续的点击跳转

        // 为预览项添加点击事件监听器，用于跳转到聊天区域中对应的消息位置
        itemEl.addEventListener('click', () => {
            if (typeof ChatAreaUIManager !== 'undefined' && ChatAreaUIManager.scrollToMessage) {
                const appContainer = document.querySelector('.app-container');
                const isMobileView = window.innerWidth <= 768; // 判断是否为移动设备视图
                // 如果是移动视图且详情面板当前可见，则先切换布局到聊天区域并隐藏详情面板
                if (isMobileView && appContainer && appContainer.classList.contains('show-details')) {
                    if (typeof LayoutUIManager !== 'undefined') LayoutUIManager.showChatAreaLayout();
                    this.hideSidePanel();
                }
                ChatAreaUIManager.scrollToMessage(message.id); // 执行跳转
            } else {
                Utils.log(`ChatAreaUIManager 或 scrollToMessage 方法未定义。无法跳转。`, Utils.logLevels.WARN);
            }
        });

        let contentSpecificHtml = ''; // 用于存储特定于资源类型的内容HTML
        let initialIcon = ''; // 占位符的初始图标
        let overlayIcon = ''; // 媒体文件上的覆盖图标 (如播放按钮)

        // 根据当前选中的资源类型生成不同的预览内容
        if (this._currentResourceType === 'imagery') { // 如果是影像类型 (图片/视频)
            itemEl.classList.remove('text-message-preview'); // 确保移除文本消息特有的类
            if (message.fileType?.startsWith('image/')) { // 如果是图片
                initialIcon = '🖼️'; overlayIcon = '👁️'; // 设置图标
            } else if (message.fileType?.startsWith('video/')) { // 如果是视频
                initialIcon = '🎬'; overlayIcon = '▶'; // 设置图标
            }
            // 创建缩略图占位符，实际缩略图将由 _renderResourceThumbnail 异步加载
            contentSpecificHtml = `
                <div class="thumbnail-placeholder-resource" 
                     data-hash="${message.fileHash}" 
                     data-filetype="${message.fileType}"
                     data-filename="${Utils.escapeHtml(message.fileName || '媒体文件')}">
                    ${initialIcon}
                    ${overlayIcon ? `<span class="play-overlay-icon">${overlayIcon}</span>` : ''}
                </div>`;
            // 使用 setTimeout 将缩略图渲染推迟到下一个事件循环，以避免阻塞主线程
            setTimeout(() => {
                const placeholderDiv = itemEl.querySelector('.thumbnail-placeholder-resource');
                if (placeholderDiv) {
                    this._renderResourceThumbnail(placeholderDiv, message); // 调用异步渲染函数
                }
            }, 0);
        } else if (this._currentResourceType === 'text') { // 如果是文本类型
            itemEl.classList.add('text-message-preview'); // 添加文本消息特有的类
            // 获取发送者名称
            const senderName = message.originalSenderName || UserManager.contacts[message.sender]?.name || `用户 ${String(message.sender).substring(0,4)}`;
            // 构建类似聊天气泡的HTML结构
            const senderHtml = `<div class="resource-text-sender-preview">${Utils.escapeHtml(senderName)}:</div>`;
            const textContentHtml = `<div class="resource-text-content-preview" title="${Utils.escapeHtml(message.content || '')}">${Utils.escapeHtml(message.content || '')}</div>`;
            contentSpecificHtml = senderHtml + textContentHtml;
        } else if (this._currentResourceType === 'other') { // 如果是其它文件类型
            itemEl.classList.remove('text-message-preview'); // 确保移除文本消息特有的类
            // 根据文件具体类型设置图标
            if (message.type === 'audio' || (message.type === 'file' && message.fileType?.startsWith('audio/'))) {
                initialIcon = '🎵'; // 音频文件图标
            } else {
                initialIcon = '📎'; // 通用文件图标
            }
            // 构建文件图标和文件名的HTML结构
            contentSpecificHtml = `<div class="file-icon-resource">${initialIcon}</div>
                                  <div class="resource-name" title="${Utils.escapeHtml(message.fileName || '文件')}">
                                    ${Utils.truncateFileName(message.fileName || (message.type === 'audio' ? `语音 ${message.duration ? Utils.formatTime(message.duration) : ''}` : '文件'), 15)}
                                  </div>`;
        }

        // 创建并添加时间戳元素
        const timestampEl = document.createElement('div');
        timestampEl.className = 'resource-timestamp';
        timestampEl.textContent = Utils.formatDate(new Date(message.timestamp), false); // 格式化时间戳 (日期，不含时间)

        itemEl.innerHTML = contentSpecificHtml; // 设置内容HTML
        itemEl.appendChild(timestampEl); // 添加时间戳

        return itemEl; // 返回创建的预览项元素
    },

    /**
     * @private
     * 处理资源预览网格的滚动事件。
     * 当滚动到接近底部时，会调用 `_loadMoreResources` 来加载更多内容 (实现无限滚动)。
     * 此函数通常作为事件监听器绑定到网格容器的 'scroll' 事件。
     */
    _handleResourceGridScroll: function() {
        // 如果网格容器不存在、正在加载中、或当前是日期视图，则不执行
        if (!this.resourceGridContainerEl || this._isResourceLoading || this._currentResourceType === 'date') return;
        const { scrollTop, scrollHeight, clientHeight } = this.resourceGridContainerEl;
        // 判断是否滚动到距离底部小于100px的区域
        if (scrollHeight - scrollTop - clientHeight < 100) {
            this._loadMoreResources(false); // 加载更多资源 (非初始加载)
        }
    },

    /**
     * @private
     * 附加资源预览网格的滚动事件监听器。
     * 仅在网格容器存在、监听器尚未附加、且当前非日期视图时执行。
     */
    _attachResourceScrollListener: function() {
        if (this.resourceGridContainerEl && !this._resourceScrollListenerAttached && this._currentResourceType !== 'date') {
            this.resourceGridContainerEl.addEventListener('scroll', this._boundHandleResourceGridScroll);
            this._resourceScrollListenerAttached = true; // 标记监听器已附加
        }
    },

    /**
     * @private
     * 解绑资源预览网格的滚动事件监听器。
     * 仅在网格容器存在且监听器已附加时执行。
     */
    _detachResourceScrollListener: function() {
        if (this.resourceGridContainerEl && this._resourceScrollListenerAttached) {
            this.resourceGridContainerEl.removeEventListener('scroll', this._boundHandleResourceGridScroll);
            this._resourceScrollListenerAttached = false; // 标记监听器已解绑
        }
    },

    /**
     * @private
     * 异步渲染日历视图，用于按日期导航聊天消息。
     * 它会从 `ChatManager` 获取所有包含消息的日期，并在日历上高亮显示这些日期。
     * 用户点击高亮的日期可以跳转到聊天记录中该日期的第一条消息。
     * @async
     * @returns {Promise<void>}
     */
    _renderCalendar: async function() {
        // 防御：确保日历容器和当前聊天ID已设置
        if (!this.calendarContainerEl || !this._currentResourceChatId) {
            Utils.log("日历容器或当前聊天ID未设置，无法渲染日历。", Utils.logLevels.WARN);
            return;
        }
        this.calendarContainerEl.innerHTML = '<div class="calendar-loading">加载日历数据...</div>'; // 显示加载提示

        try {
            // 从ChatManager获取当前聊天中所有有消息记录的日期 (格式: "YYYY-MM-DD")
            const datesWithMessages = await ChatManager.getDatesWithMessages(this._currentResourceChatId);
            this.calendarContainerEl.innerHTML = ''; // 清空加载提示或旧日历

            const now = new Date(); // 当前日期
            // 获取或设置当前日历显示的月份和年份 (用于月份导航)
            let currentDisplayMonth = this.calendarContainerEl.dataset.currentDisplayMonth ? parseInt(this.calendarContainerEl.dataset.currentDisplayMonth, 10) : now.getMonth();
            let currentDisplayYear = this.calendarContainerEl.dataset.currentDisplayYear ? parseInt(this.calendarContainerEl.dataset.currentDisplayYear, 10) : now.getFullYear();

            // 创建日历头部 (包含月份导航按钮和年月显示)
            const calendarHeader = document.createElement('div');
            calendarHeader.className = 'calendar-header-rps'; // RPS: Resource Preview Section
            const prevMonthBtn = document.createElement('button'); // 上个月按钮
            prevMonthBtn.textContent = '‹';
            prevMonthBtn.className = 'calendar-nav-btn-rps';
            const nextMonthBtn = document.createElement('button'); // 下个月按钮
            nextMonthBtn.textContent = '›';
            nextMonthBtn.className = 'calendar-nav-btn-rps';
            const monthYearSpan = document.createElement('span'); // 显示 "YYYY年 M月"
            monthYearSpan.className = 'calendar-monthyear-rps';

            // 定义渲染指定月份视图的函数
            const renderMonthView = (month, year) => {
                // 将当前显示的月份和年份存储在日历容器的dataset中，以便持久化状态
                this.calendarContainerEl.dataset.currentDisplayMonth = month;
                this.calendarContainerEl.dataset.currentDisplayYear = year;

                monthYearSpan.textContent = `${year}年 ${month + 1}月`; // 更新年月显示
                const daysInMonth = new Date(year, month + 1, 0).getDate(); // 获取当月天数
                const firstDayOfMonth = new Date(year, month, 1).getDay(); // 获取当月第一天是周几 (0=周日, 6=周六)

                // 移除旧的日历网格 (如果存在)
                let calendarGrid = this.calendarContainerEl.querySelector('.calendar-grid-rps');
                if (calendarGrid) calendarGrid.remove();

                calendarGrid = document.createElement('div'); // 创建新的日历网格容器
                calendarGrid.className = 'calendar-grid-rps';

                // 添加星期头部 (日, 一, ..., 六)
                const weekdays = ['日', '一', '二', '三', '四', '五', '六'];
                weekdays.forEach(wd => {
                    const dayHeaderEl = document.createElement('div');
                    dayHeaderEl.className = 'calendar-day-header-rps';
                    dayHeaderEl.textContent = wd;
                    calendarGrid.appendChild(dayHeaderEl);
                });

                // 在第一天前填充空白单元格
                for (let i = 0; i < firstDayOfMonth; i++) {
                    const emptyCell = document.createElement('div');
                    emptyCell.className = 'calendar-day-rps empty';
                    calendarGrid.appendChild(emptyCell);
                }

                // 遍历当月所有日期并创建单元格
                for (let day = 1; day <= daysInMonth; day++) {
                    const dayCell = document.createElement('div'); // 日期单元格
                    dayCell.className = 'calendar-day-rps';
                    dayCell.textContent = day; // 显示日期数字
                    // 构建 YYYY-MM-DD 格式的日期字符串
                    const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

                    // 如果该日期有消息记录
                    if (datesWithMessages.includes(dateStr)) {
                        dayCell.classList.add('has-messages-rps'); // 添加高亮样式
                        dayCell.title = "有消息记录"; // 设置鼠标悬停提示
                        // 为有消息的日期添加点击事件，用于跳转
                        dayCell.addEventListener('click', () => {
                            if (typeof ChatAreaUIManager !== 'undefined' && ChatAreaUIManager.scrollToDate) {
                                ChatAreaUIManager.scrollToDate(this._currentResourceChatId, dateStr); // 调用跳转方法
                                // 在移动视图下，如果详情面板可见，则切换布局并隐藏面板
                                const appContainer = document.querySelector('.app-container');
                                const isMobileView = window.innerWidth <= 768;
                                if (isMobileView && appContainer && appContainer.classList.contains('show-details')) {
                                    if (typeof LayoutUIManager !== 'undefined') LayoutUIManager.showChatAreaLayout();
                                    this.hideSidePanel();
                                }
                            }
                        });
                    } else { // 如果该日期无消息记录
                        dayCell.classList.add('no-messages-rps'); // 添加无消息样式 (通常是灰色或禁用外观)
                    }
                    calendarGrid.appendChild(dayCell); // 将日期单元格添加到网格
                }
                this.calendarContainerEl.appendChild(calendarGrid); // 将完成的日历网格添加到主容器
            };

            // 为月份导航按钮绑定点击事件
            prevMonthBtn.onclick = () => { // 上个月
                currentDisplayMonth--;
                if (currentDisplayMonth < 0) { currentDisplayMonth = 11; currentDisplayYear--; } // 处理跨年
                renderMonthView(currentDisplayMonth, currentDisplayYear); // 重新渲染日历
            };
            nextMonthBtn.onclick = () => { // 下个月
                currentDisplayMonth++;
                if (currentDisplayMonth > 11) { currentDisplayMonth = 0; currentDisplayYear++; } // 处理跨年
                renderMonthView(currentDisplayMonth, currentDisplayYear); // 重新渲染日历
            };

            // 组装日历头部
            calendarHeader.appendChild(prevMonthBtn);
            calendarHeader.appendChild(monthYearSpan);
            calendarHeader.appendChild(nextMonthBtn);
            this.calendarContainerEl.prepend(calendarHeader); // 将头部添加到日历容器的开头

            renderMonthView(currentDisplayMonth, currentDisplayYear); // 初始渲染当前月份的日历视图
        } catch (error) { // 捕获渲染过程中的错误
            Utils.log("渲染日历失败: " + error, Utils.logLevels.ERROR);
            this.calendarContainerEl.innerHTML = '<div class="calendar-error">无法加载日历。</div>'; // 显示错误信息
        }
    }
};