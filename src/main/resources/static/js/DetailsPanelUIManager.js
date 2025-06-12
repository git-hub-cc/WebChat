/**
 * @file DetailsPanelUIManager.js
 * @description 管理右侧面板的 UI 元素和交互，包括聊天详情和人员大厅。
 * @module DetailsPanelUIManager
 * @exports {object} DetailsPanelUIManager - 对外暴露的单例对象。
 * @property {function} init - 初始化模块。
 * @property {function} showMainDetailsContent - 显示聊天详情内容。
 * @property {function} showPeopleLobbyContent - 显示人员大厅内容。
 * @property {function} hideSidePanel - 隐藏整个右侧面板区域。
 * @property {function} updateDetailsPanel - 更新主聊天详情面板内容。
 * @dependencies UserManager, GroupManager, ChatManager, MessageManager, TtsUIManager, NotificationManager, Utils, ConnectionManager, PeopleLobbyManager
 * @dependents AppInitializer (进行初始化), ChatAreaUIManager (点击按钮时调用)
 */
const DetailsPanelUIManager = {
    isPanelAreaVisible: false, // 指示整个右侧面板区域是否可见
    currentView: null, // 'details' 或 'lobby' 或 null
    _boundTtsConfigCollapseListener: null,

    detailsPanelEl: null,
    detailsPanelTitleEl: null,
    detailsPanelContentEl: null, // 主详情内容容器
    peopleLobbyContentEl: null, // 人员大厅内容容器
    closeDetailsBtnMainEl: null, // 通用的关闭按钮

    // 主详情面板内的元素
    detailsNameEl: null,
    detailsIdEl: null,
    detailsAvatarEl: null,
    detailsStatusEl: null,
    contactActionsDetailsEl: null,
    currentChatActionsDetailsEl: null,
    clearCurrentChatBtnDetailsEl: null,
    deleteContactBtnDetailsEl: null,
    detailsGroupManagementEl: null,
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
    leftMemberListDetailsEl: null,
    ttsAttributionHeaderEl: null,
    ttsAttributionContentEl: null,


    /**
     * 初始化模块。
     */
    init: function() {
        this.detailsPanelEl = document.getElementById('detailsPanel');
        this.detailsPanelTitleEl = document.getElementById('detailsPanelTitle');
        this.detailsPanelContentEl = document.getElementById('detailsPanelContent');
        this.peopleLobbyContentEl = document.getElementById('peopleLobbyContent');
        this.closeDetailsBtnMainEl = document.getElementById('closeDetailsBtnMain');

        // 初始化主详情面板的元素引用
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
        this.leftMembersAreaEl = document.getElementById('leftMembersArea');
        this.contactsDropdownDetailsEl = document.getElementById('contactsDropdownDetails');
        this.addMemberBtnDetailsEl = document.getElementById('addMemberBtnDetails');
        this.leftMemberListDetailsEl = document.getElementById('leftMemberListDetails');
        this.ttsAttributionHeaderEl = document.getElementById('ttsAttributionCollapsibleTrigger');
        this.ttsAttributionContentEl = document.getElementById('ttsAttributionCollapsibleContent');

        this.bindEvents();
    },

    /**
     * 绑定事件。
     */
    bindEvents: function() {
        if (this.closeDetailsBtnMainEl) {
            this.closeDetailsBtnMainEl.addEventListener('click', () => this.hideSidePanel());
        }
        if (this.addMemberBtnDetailsEl) {
            this.addMemberBtnDetailsEl.addEventListener('click', () => this.handleAddMemberToGroupDetails());
        }
        // 其他按钮的事件监听器在 updateDetailsPanel 中根据上下文动态设置。

        // 为 TTS "致谢" 可折叠部分绑定点击事件
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
            // 确保初始图标状态与内容显示状态一致
            const icon = this.ttsAttributionHeaderEl.querySelector('.collapse-icon');
            if (this.ttsAttributionContentEl.style.display === 'none') {
                if(icon) icon.textContent = '▶';
                this.ttsAttributionHeaderEl.classList.remove('active');
            } else {
                if(icon) icon.textContent = '▼';
                this.ttsAttributionHeaderEl.classList.add('active');
            }
        }
        // 事件监听器在 ChatAreaUIManager 中处理，这里不再重复绑定
    },

    /**
     * @description 统一控制右侧面板的显示。
     * @param {boolean} show - 是否显示面板。
     * @param {string} [viewType=null] - 要显示的视图类型 ('details' 或 'lobby')。
     */
    _setPanelVisibility: function(show, viewType = null) {
        const appContainer = document.querySelector('.app-container');
        this.isPanelAreaVisible = show;

        if (show) {
            if (this.detailsPanelEl) this.detailsPanelEl.style.display = 'flex';
            if (appContainer) appContainer.classList.add('show-details');

            if (viewType === 'details') {
                if (this.peopleLobbyContentEl) this.peopleLobbyContentEl.style.display = 'none';
                if (PeopleLobbyManager) PeopleLobbyManager.hide(); // 确保 PeopleLobbyManager 内部状态也更新
                if (this.detailsPanelContentEl) this.detailsPanelContentEl.style.display = 'block'; // 或者 'flex'
                this.currentView = 'details';
            } else if (viewType === 'lobby') {
                if (this.detailsPanelContentEl) this.detailsPanelContentEl.style.display = 'none';
                if (this.peopleLobbyContentEl) this.peopleLobbyContentEl.style.display = 'flex'; // lobby-content 使用 flex
                this.currentView = 'lobby';
            }
        } else {
            if (this.detailsPanelEl) this.detailsPanelEl.style.display = 'none';
            if (appContainer) appContainer.classList.remove('show-details');
            this.currentView = null;
        }
    },

    /**
     * @description 显示聊天详情内容。
     */
    showMainDetailsContent: function() {
        if (!ChatManager.currentChatId) {
            Utils.log("DetailsPanelUIManager: 无法显示详情，没有选中的聊天。", Utils.logLevels.INFO);
            this.hideSidePanel(); // 如果没有当前聊天，则隐藏整个面板
            return;
        }
        this.updateDetailsPanel(ChatManager.currentChatId, ChatManager.currentChatId.startsWith('group_') ? 'group' : 'contact');
        this._setPanelVisibility(true, 'details');
        Utils.log("DetailsPanelUIManager: 显示聊天详情视图。", Utils.logLevels.DEBUG);
    },

    /**
     * @description 显示人员大厅内容。
     * @returns {Promise<void>}
     */
    showPeopleLobbyContent: async function() {
        if (this.detailsPanelTitleEl) this.detailsPanelTitleEl.textContent = '人员大厅';
        if (PeopleLobbyManager) {
            await PeopleLobbyManager.show(); // PeopleLobbyManager.show() 会处理其内容的显示
        }
        this._setPanelVisibility(true, 'lobby');
        Utils.log("DetailsPanelUIManager: 显示人员大厅视图。", Utils.logLevels.DEBUG);
    },

    /**
     * @description 切换聊天详情面板的可见性（如果当前显示的是大厅，则切换到详情）。
     */
    toggleChatDetailsView: function() {
        if (this.isPanelAreaVisible && this.currentView === 'details') {
            this.hideSidePanel();
        } else {
            this.showMainDetailsContent();
        }
    },

    /**
     * @description 切换人员大厅的可见性（如果当前显示的是详情，则切换到大厅）。
     */
    togglePeopleLobbyView: function() {
        if (this.isPanelAreaVisible && this.currentView === 'lobby') {
            this.hideSidePanel();
        } else {
            this.showPeopleLobbyContent();
        }
    },


    /**
     * @description 隐藏整个右侧面板区域。
     */
    hideSidePanel: function () {
        this._setPanelVisibility(false);
        // 恢复默认标题，或根据需要清除
        if (this.detailsPanelTitleEl) this.detailsPanelTitleEl.textContent = '聊天信息';
        Utils.log("DetailsPanelUIManager: 右侧面板已隐藏。", Utils.logLevels.DEBUG);
    },

    /**
     * @description （旧方法，重命名为 toggleChatDetailsView 以明确其功能）
     * @param {boolean} show - true 为显示，false 为隐藏。
     * @deprecated Prefer toggleChatDetailsView or hideSidePanel.
     */
    toggleDetailsPanel: function (show) {
        this.toggleChatDetailsView();
    },


    /**
     * 更新主聊天详情面板的内容。
     * @param {string} chatId - 当前聊天的 ID。
     * @param {string} type - 聊天类型 ('contact' 或 'group')。
     */
    updateDetailsPanel: function (chatId, type) {
        if (!this.detailsPanelEl || !this.detailsPanelContentEl) return;

        this.detailsPanelEl.className = 'details-panel'; // 重置面板类名

        [this.currentChatActionsDetailsEl, this.contactActionsDetailsEl, this.detailsGroupManagementEl,
            this.groupActionsDetailsEl, this.aiContactAboutSectionEl, this.aiTtsConfigSectionEl]
            .forEach(el => { if (el) el.style.display = 'none'; });

        if (chatId) {
            if (this.currentChatActionsDetailsEl && this.clearCurrentChatBtnDetailsEl) {
                this.currentChatActionsDetailsEl.style.display = 'block';
                this.clearCurrentChatBtnDetailsEl.onclick = () => MessageManager.clearChat();
            }
        }

        if (type === 'contact') {
            this._updateForContact(chatId);
        } else if (type === 'group') {
            this._updateForGroup(chatId);
        }
    },

    _updateForContact: function(contactId) {
        const contact = UserManager.contacts[contactId];
        if (!contact || !this.detailsPanelEl) return;

        if (this.detailsPanelTitleEl) this.detailsPanelTitleEl.textContent = `${contact.name} 信息`;

        this.detailsPanelEl.classList.add('contact-details-active');
        if (contact.isSpecial) this.detailsPanelEl.classList.add(contact.id);
        else this.detailsPanelEl.classList.add('human-contact-active');

        if (this.detailsNameEl) this.detailsNameEl.textContent = contact.name;
        if (this.detailsIdEl) this.detailsIdEl.textContent = `ID: ${contact.id}`;
        if (this.detailsAvatarEl) {
            this.detailsAvatarEl.className = 'details-avatar';
            let fallbackText = (contact.avatarText) ? Utils.escapeHtml(contact.avatarText) :
                (contact.name && contact.name.length > 0) ? Utils.escapeHtml(contact.name.charAt(0).toUpperCase()) : '?';
            let avatarContentHtml;
            if (contact.isSpecial) this.detailsAvatarEl.classList.add('special-avatar', contact.id);
            if (contact.avatarUrl) {
                avatarContentHtml = `<img src="${contact.avatarUrl}" alt="${fallbackText}" class="avatar-image" data-fallback-text="${fallbackText}" data-entity-id="${contact.id}">`;
            } else {
                avatarContentHtml = fallbackText;
            }
            this.detailsAvatarEl.innerHTML = avatarContentHtml;
        }

        if (this.detailsStatusEl) {
            if (contact.isSpecial) this.detailsStatusEl.textContent = (contact.isAI ? 'AI 助手' : '特殊联系人') + ' - 始终可用';
            else this.detailsStatusEl.textContent = ConnectionManager.isConnectedTo(contactId) ? '已连接' : '离线';
        }

        // 根据联系人类型显示/隐藏特定区域
        if (contact.isSpecial) {
            if (this.contactActionsDetailsEl) this.contactActionsDetailsEl.style.display = 'none';
            if (contact.isAI && contact.aboutDetails && this.aiContactAboutSectionEl) {
                this._populateAiAboutSection(contact);
                this.aiContactAboutSectionEl.style.display = 'block';
            }
            if (contact.isAI && this.aiTtsConfigSectionEl) {
                this._setupAiTtsConfigSection(contact);
                this.aiTtsConfigSectionEl.style.display = 'block';
            }
        } else { // 普通联系人
            if (this.contactActionsDetailsEl) this.contactActionsDetailsEl.style.display = 'block';
            if (this.deleteContactBtnDetailsEl) this.deleteContactBtnDetailsEl.onclick = () => ChatManager.deleteChat(contactId, 'contact');
            if (this.aiTtsConfigSectionEl) this.aiTtsConfigSectionEl.style.display = 'none';
            if (this.aiContactAboutSectionEl) this.aiContactAboutSectionEl.style.display = 'none';
        }
    },

    /**
     * @private
     * 填充 AI 联系人的“关于”部分。
     * @param {object} contact - AI 联系人对象。
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
     * 设置 AI 联系人的 TTS 配置部分，包括表单和可折叠区域。
     * @param {object} contact - AI 联系人对象。
     */
    _setupAiTtsConfigSection: function(contact) {
        // 委托 TtsUIManager 填充表单
        TtsUIManager.populateAiTtsConfigurationForm(contact, 'ttsConfigFormContainer');

        // 绑定保存按钮事件
        if (this.saveAiTtsSettingsBtnDetailsEl) {
            // 为避免重复绑定，先移除旧的监听器
            if (TtsUIManager._boundSaveTtsListener) {
                this.saveAiTtsSettingsBtnDetailsEl.removeEventListener('click', TtsUIManager._boundSaveTtsListener);
            }
            TtsUIManager._boundSaveTtsListener = TtsUIManager.handleSaveAiTtsSettings.bind(TtsUIManager, contact.id);
            this.saveAiTtsSettingsBtnDetailsEl.addEventListener('click', TtsUIManager._boundSaveTtsListener);
        }

        // 绑定主 TTS 配置区域的可折叠事件
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

            // 确保初始图标状态正确
            const icon = this.aiTtsConfigHeaderEl.querySelector('.collapse-icon');
            if (this.aiTtsConfigContentEl) {
                if (this.aiTtsConfigContentEl.style.display === 'none') {
                    if(icon) icon.textContent = '▶';
                    this.aiTtsConfigHeaderEl.classList.remove('active');
                } else {
                    if(icon) icon.textContent = '▼';
                    this.aiTtsConfigHeaderEl.classList.add('active');
                }
            }
        }
    },

    /**
     * @private
     * 专用于更新群组详情的内部方法。
     * @param {string} groupId - 群组的 ID。
     */
    _updateForGroup: function(groupId) {
        const group = GroupManager.groups[groupId];
        if (!group || !this.detailsPanelEl) return;

        if (this.detailsPanelTitleEl) this.detailsPanelTitleEl.textContent = `${group.name} 信息`;

        this.detailsPanelEl.classList.add('group-chat-active');
        if (this.detailsNameEl) this.detailsNameEl.textContent = group.name;
        if (this.detailsIdEl) this.detailsIdEl.textContent = `群组 ID: ${group.id.substring(6)}`;
        if (this.detailsAvatarEl) {
            this.detailsAvatarEl.innerHTML = '👥';
            this.detailsAvatarEl.className = 'details-avatar group';
        }
        if (this.detailsStatusEl) this.detailsStatusEl.textContent = `${group.members.length} 名成员`;
        if (this.detailsGroupManagementEl) this.detailsGroupManagementEl.style.display = 'block';
        if (this.groupActionsDetailsEl) this.groupActionsDetailsEl.style.display = 'block';

        // 根据用户是否为群主，显示不同的操作
        const isOwner = group.owner === UserManager.userId;
        if (this.addGroupMemberAreaEl) this.addGroupMemberAreaEl.style.display = isOwner ? 'block' : 'none';
        if (this.leftMembersAreaEl) this.leftMembersAreaEl.style.display = isOwner && group.leftMembers && group.leftMembers.length > 0 ? 'block' : 'none';

        if (this.leaveGroupBtnDetailsEl) {
            this.leaveGroupBtnDetailsEl.style.display = isOwner ? 'none' : 'block';
            if(!isOwner) this.leaveGroupBtnDetailsEl.onclick = () => ChatManager.deleteChat(groupId, 'group');
        }
        if (this.dissolveGroupBtnDetailsEl) {
            this.dissolveGroupBtnDetailsEl.style.display = isOwner ? 'block' : 'none';
            if(isOwner) this.dissolveGroupBtnDetailsEl.onclick = () => ChatManager.deleteChat(groupId, 'group');
        }
        this.updateDetailsPanelMembers(groupId);
        // 群组聊天不显示 AI 相关部分
        if (this.aiContactAboutSectionEl) this.aiContactAboutSectionEl.style.display = 'none';
        if (this.aiTtsConfigSectionEl) this.aiTtsConfigSectionEl.style.display = 'none';
    },

    /**
     * 更新详情面板中的群组成员列表。
     * @param {string} groupId - 群组的 ID。
     */
    updateDetailsPanelMembers: function (groupId) {
        const group = GroupManager.groups[groupId];
        if (!group || !this.groupMemberListDetailsEl || !this.groupMemberCountEl || !this.contactsDropdownDetailsEl || !this.leftMemberListDetailsEl) return;

        this.groupMemberListDetailsEl.innerHTML = '';
        this.groupMemberCountEl.textContent = group.members.length;

        // 渲染当前成员列表
        group.members.forEach(memberId => {
            const member = UserManager.contacts[memberId] || {id: memberId, name: `用户 ${memberId.substring(0, 4)}`};
            const item = document.createElement('div');
            item.className = 'member-item-detail';
            let html = `<span>${Utils.escapeHtml(member.name)} ${memberId === UserManager.userId ? '(您)' : ''}</span>`;
            if (memberId === group.owner) html += '<span class="owner-badge">群主</span>';
            else if (group.owner === UserManager.userId) {
                html += `<button class="remove-member-btn-detail" data-member-id="${memberId}" title="移除成员">✕</button>`;
            }
            item.innerHTML = html;
            this.groupMemberListDetailsEl.appendChild(item);
        });
        this.groupMemberListDetailsEl.querySelectorAll('.remove-member-btn-detail').forEach(btn => {
            btn.onclick = () => GroupManager.removeMemberFromGroup(groupId, btn.dataset.memberId);
        });

        // 填充可添加的联系人下拉列表
        this.contactsDropdownDetailsEl.innerHTML = '<option value="">选择要添加的联系人...</option>';
        Object.values(UserManager.contacts).forEach(contact => {
            if (!group.members.includes(contact.id) && !(group.leftMembers?.find(lm => lm.id === contact.id)) && !(contact.isSpecial && contact.isAI)) {
                const option = document.createElement('option');
                option.value = contact.id;
                option.textContent = contact.name;
                this.contactsDropdownDetailsEl.appendChild(option);
            }
        });

        // 渲染已离开的成员列表（仅群主可见）
        this.leftMemberListDetailsEl.innerHTML = '';
        if (group.owner === UserManager.userId && group.leftMembers && group.leftMembers.length > 0 && this.leftMembersAreaEl) {
            group.leftMembers.forEach(leftMember => {
                const item = document.createElement('div');
                item.className = 'left-member-item-detail';
                item.innerHTML = `<span>${Utils.escapeHtml(leftMember.name)} (离开于: ${Utils.formatDate(new Date(leftMember.leftTime))})</span>
<button class="re-add-member-btn-detail" data-member-id="${leftMember.id}" data-member-name="${Utils.escapeHtml(leftMember.name)}" title="重新添加成员">+</button>`;
                this.leftMemberListDetailsEl.appendChild(item);
            });
            this.leftMemberListDetailsEl.querySelectorAll('.re-add-member-btn-detail').forEach(btn => {
                btn.onclick = () => GroupManager.addMemberToGroup(groupId, btn.dataset.memberId, btn.dataset.memberName);
            });
            this.leftMembersAreaEl.style.display = 'block';
        } else if (this.leftMembersAreaEl) {
            this.leftMembersAreaEl.style.display = 'none';
        }
    },

    /**
     * 处理从详情面板添加成员到群组的操作。
     */
    handleAddMemberToGroupDetails: function () {
        const groupId = ChatManager.currentChatId;
        if (!this.contactsDropdownDetailsEl) return;
        const memberId = this.contactsDropdownDetailsEl.value;
        const memberName = this.contactsDropdownDetailsEl.selectedOptions[0]?.text;

        if (groupId && memberId) {
            GroupManager.addMemberToGroup(groupId, memberId, memberName).then(success => {
                if (success && this.contactsDropdownDetailsEl) this.contactsDropdownDetailsEl.value = "";
            });
        } else {
            NotificationManager.showNotification("请选择要添加的联系人。", "warning");
        }
    }
};