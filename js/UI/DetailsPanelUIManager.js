/**
 * @file DetailsPanelUIManager.js
 * @description 管理应用右侧详情面板的 UI 元素和交互。此面板可以显示当前选定聊天的详细信息（包括联系人信息、群组成员、AI配置）或人员大厅。资源预览功能已移至 ResourcePreviewUIManager。
 *              新增: 群主可查看和编辑群内 AI 的特定提示词。AI联系人现在可以支持选择不同的“词汇篇章”来改变其行为 (使用可搜索下拉框)。
 *              优化: 当群主修改AI提示词后，会向群内发送系统消息通知。
 *              修复: 主题切换后，添加成员下拉列表现在能正确反映当前主题的AI角色。
 *              更新: 群组成员列表现在显示在线状态和与当前用户的连接状态，并提供重连按钮。
 *              新增: 定期自动刷新群成员状态，并对在线但未连接的成员尝试自动连接。 (定时器逻辑移至 TimerManager)
 *              优化：详情页的群成员顺序调整为：群主第一（无论在线状态），然后是在线人类成员，接着是AI成员，最后是离线人类成员。
 *              更新：群组详情页现在会显示资源预览模块，方便用户跳转到相关的媒体内容，该模块位于所有群组设置之后。
 *              更新：群组详情页的“群成员列表”和“群内AI行为指示”部分现在默认折叠，并可展开/收起。
 *              修复(BUG): _setupAiTtsConfigSection 现在会正确初始化动态生成的嵌套折叠项（如高级选项）。
 *              修复(BUG): 更新了显示折叠容器的逻辑，使用 display: grid 替代 display: block，以确保高性能的折叠动画正常工作，解决折叠后仍占据空间的问题。
 *              修复(BUG): _makeElementCollapsible 现在使用 parentElement 替代 closest()，以正确处理嵌套的折叠项。
 *              FIXED: 增加了在与AI角色对话时显示记忆书模块的逻辑。
 *              FEATURE: 为记忆书添加了编辑功能。
 *              BUGFIX: 为记忆书的“启用记忆”复选框添加了唯一的ID和label的for属性，解决了多个复选框表现得像单选按钮的问题。
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
 * @dependencies UserManager, GroupManager, ChatManager, MessageManager, TtsUIManager, NotificationUIManager, Utils, ConnectionManager, PeopleLobbyManager, AppSettings, LayoutUIManager, EventEmitter, DBManager, ResourcePreviewUIManager, TimerManager, MemoryBookManager, ModalUIManager
 */
const DetailsPanelUIManager = {
    isPanelAreaVisible: false,
    currentView: null,
    currentChatId: null,

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
    resourcePreviewSectionEl: null,
    aiChapterSectionEl: null,
    memoryBookSectionEl: null,
    memoryBookListEl: null,

    GROUP_MEMBER_REFRESH_INTERVAL_MS: 3000,
    _GROUP_MEMBER_REFRESH_TASK_NAME: 'groupMemberStatusRefresh',

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
        this.aiChapterSectionEl = document.getElementById('aiChapterSection');
        this.memoryBookSectionEl = document.getElementById('memoryBookSection');
        this.memoryBookListEl = document.getElementById('memoryBookList');

        this.bindEvents();

        EventEmitter.on('connectionEstablished', (peerId) => this._tryRefreshGroupMembersView(peerId));
        EventEmitter.on('connectionClosed', (peerId) => this._tryRefreshGroupMembersView(peerId));
        EventEmitter.on('connectionFailed', (peerId) => this._tryRefreshGroupMembersView(peerId));
        EventEmitter.on('onlineUsersUpdated', () => {
            if (this.currentView === 'details' && ChatManager.currentChatId && ChatManager.currentChatId.startsWith('group_')) {
                this.updateDetailsPanelMembers(ChatManager.currentChatId);
            }
        });

        EventEmitter.on('memorySetsUpdated', () => this._renderMemoryBookSection(this.currentChatId));
        EventEmitter.on('memoryBookUpdated', ({ setId, chatId, content }) => this._updateMemoryBookUI(setId, chatId, content));
        EventEmitter.on('memoryBookGenerationStarted', ({ setId, chatId }) => this._setMemoryBookLoadingState(setId, chatId, true));
        EventEmitter.on('memoryBookGenerationFailed', ({ setId, chatId }) => this._setMemoryBookLoadingState(setId, chatId, false));

        Utils.log("DetailsPanelUIManager 初始化完成。", Utils.logLevels.INFO);
    },

    _makeElementCollapsible: function(headerEl) {
        if (!headerEl) return;
        const containerEl = headerEl.parentElement;
        if (!containerEl || !containerEl.classList.contains('collapsible-container')) {
            console.warn('Collapsible header is not a direct child of a .collapsible-container. Animation may not work.', headerEl);
            headerEl.addEventListener('click', function(e) {
                e.stopPropagation();
                this.classList.toggle('active');
                const content = this.nextElementSibling;
                if(content && content.classList.contains('collapsible-content')){
                    content.style.display = content.style.display === 'none' ? 'block' : 'none';
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

    bindEvents: function() {
        if (this.closeDetailsBtnMainEl) {
            this.closeDetailsBtnMainEl.addEventListener('click', () => this.hideSidePanel());
        }
        if (this.addMemberBtnDetailsEl) {
            this.addMemberBtnDetailsEl.addEventListener('click', () => this.handleAddMemberToGroupDetails());
        }
        this._makeElementCollapsible(this.aiTtsConfigHeaderEl);
        this._makeElementCollapsible(this.ttsAttributionHeaderEl);
        this._makeElementCollapsible(this.groupMemberListHeaderEl);
        this._makeElementCollapsible(this.groupAiPromptsHeaderEl);

        // REMOVED: Event bindings for moved elements
        // if (this.addMemorySetBtn) { ... }
        // if (this.confirmAddMemorySetBtn) { ... }
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
                const newBtn = this.deleteContactBtnDetailsEl.cloneNode(true);
                this.deleteContactBtnDetailsEl.parentNode.replaceChild(newBtn, this.deleteContactBtnDetailsEl);
                this.deleteContactBtnDetailsEl = newBtn;
                this.deleteContactBtnDetailsEl.addEventListener('click', () => ChatManager.deleteChat(contactId, 'contact'));
            }
            if (this.aiTtsConfigSectionEl) this.aiTtsConfigSectionEl.style.display = 'none';
            if (this.aiContactAboutSectionEl) this.aiContactAboutSectionEl.style.display = 'none';
            if (this.aiChapterSectionEl) this.aiChapterSectionEl.style.display = 'none';
        }
        if (this.groupAiPromptsSectionEl) this.groupAiPromptsSectionEl.style.display = 'none';
        if (this.detailsGroupManagementEl) this.detailsGroupManagementEl.style.display = 'none';
    },

    _updateMemoryBookUI: function(setId, chatId, content) {
        if (chatId !== this.currentChatId) return;
        const setItem = this.memoryBookListEl.querySelector(`.memory-set-item[data-set-id="${setId}"]`);
        if (setItem) {
            const textarea = setItem.querySelector('.memory-book-textarea');
            if (textarea) textarea.value = content;
            this._setMemoryBookLoadingState(setId, chatId, false);
        }
    },

    _setMemoryBookLoadingState: function(setId, chatId, isLoading) {
        if (chatId !== this.currentChatId) return;
        const setItem = this.memoryBookListEl.querySelector(`.memory-set-item[data-set-id="${setId}"]`);
        if (setItem) {
            const recordBtn = setItem.querySelector('.record-btn');
            if (recordBtn) {
                recordBtn.disabled = isLoading;
                recordBtn.textContent = isLoading ? '记录中...' : '记录';
            }
        }
    },

    /**
     * @private
     * Renders the entire Memory Book section UI.
     * REFACTORED: Removed set management buttons (add, edit, delete). This UI now only handles *using* the sets for the current chat.
     */
    _renderMemoryBookSection: function(chatId) {
        if (!this.memoryBookListEl || !chatId) {
            this.memoryBookListEl.innerHTML = '';
            return;
        }
        this.memoryBookListEl.innerHTML = '';
        const elementSets = MemoryBookManager.getElementSets();

        if (elementSets.length === 0) {
            this.memoryBookListEl.innerHTML = `<p style="font-size: 0.9em; color: var(--text-color-light); text-align: center;">请先在“交互管理”菜单的“记忆书”标签页中添加要记忆书。</p>`;
            return;
        }

        elementSets.forEach(set => {
            const setContainer = document.createElement('div');
            setContainer.className = 'memory-set-item';
            setContainer.dataset.setId = set.id;

            const header = document.createElement('div');
            header.className = 'memory-set-header';

            // MODIFIED: Removed edit and delete buttons
            header.innerHTML = `
                <span>${Utils.escapeHtml(set.name)}</span>
                <div class="memory-set-actions">
                    <button class="record-btn" title="记录本次对话">记录</button>
                </div>
            `;

            const bookContainer = document.createElement('div');
            bookContainer.className = 'memory-book-container';
            const bookContent = set.books?.[chatId]?.content || '尚未记录。';
            const isEnabled = set.books?.[chatId]?.enabled || false;

            const radioId = `enable-memory-book-radio-${set.id}`;
            const radioName = `memory-book-enabled-group-${chatId}`;

            bookContainer.innerHTML = `
                <textarea class="memory-book-textarea" rows="4" placeholder="点击“记录”以生成，或在此手动编辑...">${Utils.escapeHtml(bookContent)}</textarea>
                <div class="memory-book-controls">
                    <label for="${radioId}">
                        <input type="radio" id="${radioId}" name="${radioName}" class="enable-memory-book-toggle" ${isEnabled ? 'checked' : ''}> 启用记忆
                    </label>
                    <button class="save-memory-book-btn">保存修改</button>
                </div>
            `;

            setContainer.appendChild(header);
            setContainer.appendChild(bookContainer);
            this.memoryBookListEl.appendChild(setContainer);

            // MODIFIED: Event listeners for edit/delete are removed.
            header.querySelector('.record-btn').addEventListener('click', () => MemoryBookManager.generateMemoryBook(set.id, chatId));

            bookContainer.querySelector('.enable-memory-book-toggle').addEventListener('change', (e) => {
                MemoryBookManager.setMemoryBookEnabled(set.id, chatId, e.target.checked);
            });

            bookContainer.querySelector('.save-memory-book-btn').addEventListener('click', () => {
                const newContent = bookContainer.querySelector('.memory-book-textarea').value;
                MemoryBookManager.saveMemoryBookContent(set.id, chatId, newContent);
            });
        });
    },

    _tryRefreshGroupMembersView: function(peerId) {
        if (this.currentView === 'details' && ChatManager.currentChatId && ChatManager.currentChatId.startsWith('group_')) {
            const group = GroupManager.groups[ChatManager.currentChatId];
            if (group && group.members.includes(peerId)) {
                Utils.log(`DetailsPanelUIManager: 检测到群成员 ${peerId} 连接状态变化，刷新成员列表。`, Utils.logLevels.DEBUG);
                this.updateDetailsPanelMembers(ChatManager.currentChatId);
            }
        }
    },

    _setPanelVisibility: function(show, viewType = null) {
        const appContainer = document.querySelector('.app-container');
        this.isPanelAreaVisible = show;
        if (this.detailsPanelContentEl) this.detailsPanelContentEl.style.display = 'none';
        if (this.peopleLobbyContentEl) this.peopleLobbyContentEl.style.display = 'none';
        if (!show || (show && viewType === 'details' && !(ChatManager.currentChatId && ChatManager.currentChatId.startsWith('group_'))) || (show && viewType === 'lobby') ) {
            if (typeof TimerManager !== 'undefined') {
                TimerManager.removePeriodicTask(this._GROUP_MEMBER_REFRESH_TASK_NAME);
            }
        }
        if (show) {
            if (appContainer) appContainer.classList.add('show-details');
            if (viewType === 'details' && this.detailsPanelContentEl) {
                this.detailsPanelContentEl.style.display = 'block';
                if (this.resourcePreviewSectionEl && ChatManager.currentChatId) {
                    ResourcePreviewUIManager.loadResourcesForChat(ChatManager.currentChatId);
                }
                if (ChatManager.currentChatId && ChatManager.currentChatId.startsWith('group_')) {
                    this._startGroupMemberRefreshTimer();
                }
            } else if (viewType === 'lobby' && this.peopleLobbyContentEl) {
                this.peopleLobbyContentEl.style.display = 'flex';
                if (this.resourcePreviewSectionEl) this.resourcePreviewSectionEl.style.display = 'none';
                ResourcePreviewUIManager.hide();
            }
            this.currentView = viewType;
        } else {
            if (appContainer) appContainer.classList.remove('show-details');
            this.currentView = null;
            ResourcePreviewUIManager.hide();
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
        if (this.detailsGroupManagementEl) this.detailsGroupManagementEl.style.display = 'none';
        if (this.aiChapterSectionEl) this.aiChapterSectionEl.style.display = 'none';
        if (this.memoryBookSectionEl) this.memoryBookSectionEl.style.display = 'none';
        if (PeopleLobbyManager) await PeopleLobbyManager.show();
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
        this.currentChatId = chatId;

        [this.contactActionsDetailsEl, this.detailsGroupManagementEl, this.groupActionsDetailsEl,
            this.aiContactAboutSectionEl, this.aiTtsConfigSectionEl,
            this.groupAiPromptsSectionEl, this.aiChapterSectionEl, this.memoryBookSectionEl]
            .forEach(el => { if (el) el.style.display = 'none'; });

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
            if (typeof TimerManager !== 'undefined') {
                TimerManager.removePeriodicTask(this._GROUP_MEMBER_REFRESH_TASK_NAME);
            }
        } else if (type === 'group') {
            this._updateForGroup(chatId);
        }

        if (typeof ResourcePreviewUIManager !== 'undefined' && chatId && this.currentView === 'details') {
            ResourcePreviewUIManager.loadResourcesForChat(chatId);
        } else if (typeof ResourcePreviewUIManager !== 'undefined') {
            ResourcePreviewUIManager.hide();
        }
    },

    _showEditSetForm: function(setData = null) {
        if (!this.newMemorySetForm) return;

        const addBtn = this.addMemorySetBtn;
        const confirmBtn = this.confirmAddMemorySetBtn;

        if (setData) {
            this.newMemorySetNameInput.value = setData.name;
            this.newMemorySetElementsInput.value = setData.elements.join(', ');
            confirmBtn.textContent = '确认修改';
            if (addBtn) addBtn.style.display = 'none';
        } else {
            this.newMemorySetNameInput.value = '';
            this.newMemorySetElementsInput.value = '';
            confirmBtn.textContent = '确认添加';
            if (addBtn) addBtn.style.display = 'block';
        }

        this.newMemorySetForm.style.display = 'block';
        this.newMemorySetNameInput.focus();
    },

    _createSearchableChapterSelect: function(contactId, contactData, targetDiv) {
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
        const formContainerId = 'ttsConfigFormContainer';
        TtsUIManager.populateAiTtsConfigurationForm(contact, formContainerId);
        if (this.saveAiTtsSettingsBtnDetailsEl) {
            if (TtsUIManager._boundSaveTtsListener) {
                this.saveAiTtsSettingsBtnDetailsEl.removeEventListener('click', TtsUIManager._boundSaveTtsListener);
            }
            TtsUIManager._boundSaveTtsListener = TtsUIManager.handleSaveAiTtsSettings.bind(TtsUIManager, contact.id);
            this.saveAiTtsSettingsBtnDetailsEl.addEventListener('click', TtsUIManager._boundSaveTtsListener);
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

        if (this.detailsGroupManagementEl) {
            this.detailsGroupManagementEl.style.display = 'grid';
        }
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
                this.groupAiPromptsSectionEl.style.display = 'grid';
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
        if (this.aiChapterSectionEl) this.aiChapterSectionEl.style.display = 'none';

        if (this.resourcePreviewSectionEl && this.detailsPanelContentEl && this.detailsPanelContentEl.lastChild !== this.resourcePreviewSectionEl) {
            this.detailsPanelContentEl.appendChild(this.resourcePreviewSectionEl);
        }

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
     * 更新群组详情中的成员列表和添加成员下拉框。
     * (已使用 template 方案重构)
     * @param {string} groupId - 群组ID。
     */
    updateDetailsPanelMembers: function (groupId) {
        const group = GroupManager.groups[groupId];
        if (!group || !this.groupMemberListDetailsEl || !this.groupMemberCountEl || !this.contactsDropdownDetailsEl || !document.getElementById('leftMemberListDetails')) return;

        const leftMemberListDetailsEl = document.getElementById('leftMemberListDetails');

        // 1. 清空旧列表并更新成员数量
        this.groupMemberListDetailsEl.innerHTML = '';
        this.groupMemberCountEl.textContent = group.members.length;

        // 2. 获取排序后的成员数据
        const membersWithSortInfo = this._getSortedMembers(group);

        // 3. 获取模板并准备 DocumentFragment 以提高性能
        const template = document.getElementById('group-member-item-template');
        if (!template) {
            Utils.log('DetailsPanelUIManager Error: #group-member-item-template not found in HTML.', Utils.logLevels.ERROR);
            return;
        }
        const fragment = document.createDocumentFragment();

        // 4. 遍历成员数据，克隆模板并填充
        membersWithSortInfo.forEach(memberData => {
            const memberId = memberData.id;
            const itemClone = template.content.cloneNode(true);

            // 获取模板中的元素
            const nameEl = itemClone.querySelector('.member-name');
            const ownerBadge = itemClone.querySelector('.owner-badge');
            const statusEl = itemClone.querySelector('.member-status');
            const reconnectBtn = itemClone.querySelector('.reconnect-member-btn-detail');
            const removeBtn = itemClone.querySelector('.remove-member-btn-detail');

            // 填充名称
            nameEl.textContent = `${Utils.escapeHtml(memberData.name)} ${memberId === UserManager.userId ? '(您)' : ''} ${memberData.isAI ? '(AI)' : ''}`;

            // 处理群主徽章和移除按钮的可见性
            if (memberId === group.owner) {
                ownerBadge.style.display = 'inline-block';
                removeBtn.remove(); // 群主不能被移除
            } else {
                ownerBadge.remove(); // 不是群主则移除徽章
                if (group.owner === UserManager.userId) {
                    removeBtn.dataset.memberId = memberId;
                    removeBtn.addEventListener('click', () => GroupManager.removeMemberFromGroup(groupId, memberId));
                } else {
                    removeBtn.remove(); // 非群主不能移除成员
                }
            }

            // 处理非AI、非自己的成员状态和连接按钮
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
                // 如果是自己，也移除移除按钮（虽然上面已处理，双重保险）
                if (memberId === UserManager.userId) removeBtn.remove();
            }

            fragment.appendChild(itemClone);
        });

        // 5. 一次性将所有新列表项添加到 DOM
        this.groupMemberListDetailsEl.appendChild(fragment);

        // 6. 更新“添加成员”下拉框（这部分逻辑不涉及复杂模板，可以保留）
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

        // 7. 更新“已离开成员”列表（这部分逻辑也不涉及复杂模板，可以保留）
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

    _startGroupMemberRefreshTimer: function() {
        if (typeof TimerManager !== 'undefined') {
            TimerManager.removePeriodicTask(this._GROUP_MEMBER_REFRESH_TASK_NAME);
            TimerManager.addPeriodicTask(
                this._GROUP_MEMBER_REFRESH_TASK_NAME,
                this._refreshGroupMembersAndAutoConnect.bind(this),
                this.GROUP_MEMBER_REFRESH_INTERVAL_MS,
                false
            );
        } else {
            Utils.log("DetailsPanelUIManager: TimerManager 未定义，无法启动群成员刷新定时器。", Utils.logLevels.ERROR);
        }
    },

    _refreshGroupMembersAndAutoConnect: async function() {
        const groupId = ChatManager.currentChatId;
        if (!groupId || !groupId.startsWith('group_')) {
            if (typeof TimerManager !== 'undefined') TimerManager.removePeriodicTask(this._GROUP_MEMBER_REFRESH_TASK_NAME);
            return;
        }
        const group = GroupManager.groups[groupId];
        if (!group) {
            if (typeof TimerManager !== 'undefined') TimerManager.removePeriodicTask(this._GROUP_MEMBER_REFRESH_TASK_NAME);
            return;
        }
        if (!this.isPanelAreaVisible || this.currentView !== 'details') {
            if (typeof TimerManager !== 'undefined') TimerManager.removePeriodicTask(this._GROUP_MEMBER_REFRESH_TASK_NAME);
            return;
        }

        if (PeopleLobbyManager && typeof PeopleLobbyManager.fetchOnlineUsers === 'function') {
            await PeopleLobbyManager.fetchOnlineUsers(true);
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
    },

    /**
     * @private
     * 辅助方法：获取排序后的群组成员列表，包含渲染所需的信息。
     * @param {object} group - 群组对象。
     * @returns {Array<object>} - 排序后的成员信息数组。
     */
    _getSortedMembers: function(group) {
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