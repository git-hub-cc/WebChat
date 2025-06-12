
/**
 * @file DetailsPanelUIManager.js
 * @description 管理右侧详情面板的 UI 元素和交互。
 *              根据当前选择的聊天类型（联系人、群组、AI联系人），动态显示和更新相关信息、操作按钮和配置项。
 * @module DetailsPanelUIManager
 * @exports {object} DetailsPanelUIManager - 对外暴露的单例对象，包含管理详情面板 UI 的所有方法。
 * @property {function} init - 初始化模块，获取 DOM 元素并绑定事件。
 * @property {function} toggleDetailsPanel - 显示或隐藏详情面板。
 * @property {function} updateDetailsPanel - 根据当前聊天 ID 和类型更新面板内容。
 * @dependencies UserManager, GroupManager, ChatManager, MessageManager, TtsUIManager, NotificationManager, Utils, ConnectionManager
 * @dependents AppInitializer (进行初始化), ChatManager (打开新聊天时调用), ChatAreaUIManager (点击详情按钮时调用)
 */
const DetailsPanelUIManager = {
    isDetailsPanelVisible: false,
    _boundTtsConfigCollapseListener: null, // 用于主 TTS 配置区域的可折叠事件监听器

    // 缓存的 DOM 元素引用
    detailsPanelEl: null,
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
    closeDetailsBtnMainEl: null,
    groupMemberListDetailsEl: null,
    groupMemberCountEl: null,
    addGroupMemberAreaEl: null,
    leftMembersAreaEl: null,
    contactsDropdownDetailsEl: null,
    addMemberBtnDetailsEl: null,
    leftMemberListDetailsEl: null,

    // 新增：用于 "致谢" 可折叠部分的元素
    ttsAttributionHeaderEl: null,
    ttsAttributionContentEl: null,


    /**
     * 初始化模块，获取所有需要的 DOM 元素引用并绑定核心事件。
     */
    init: function() {
        this.detailsPanelEl = document.getElementById('detailsPanel');
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
        this.closeDetailsBtnMainEl = document.getElementById('closeDetailsBtnMain');
        this.groupMemberListDetailsEl = document.getElementById('groupMemberListDetails');
        this.groupMemberCountEl = document.getElementById('groupMemberCount');
        this.addGroupMemberAreaEl = document.getElementById('addGroupMemberArea');
        this.leftMembersAreaEl = document.getElementById('leftMembersArea');
        this.contactsDropdownDetailsEl = document.getElementById('contactsDropdownDetails');
        this.addMemberBtnDetailsEl = document.getElementById('addMemberBtnDetails');
        this.leftMemberListDetailsEl = document.getElementById('leftMemberListDetails');

        // 初始化 "致谢" 可折叠部分的元素
        this.ttsAttributionHeaderEl = document.getElementById('ttsAttributionCollapsibleTrigger');
        this.ttsAttributionContentEl = document.getElementById('ttsAttributionCollapsibleContent');

        this.bindEvents();
    },

    /**
     * 绑定详情面板内的 UI 事件监听器。
     */
    bindEvents: function() {
        if (this.closeDetailsBtnMainEl) {
            this.closeDetailsBtnMainEl.addEventListener('click', () => this.toggleDetailsPanel(false));
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
    },

    /**
     * 显示或隐藏详情面板。
     * @param {boolean} show - true 为显示，false 为隐藏。
     */
    toggleDetailsPanel: function (show) {
        const appContainer = document.querySelector('.app-container');
        this.isDetailsPanelVisible = show;

        if (show) {
            if (!ChatManager.currentChatId) {
                this.isDetailsPanelVisible = false;
                return;
            }
            if (this.detailsPanelEl) this.detailsPanelEl.style.display = 'flex';
            if (appContainer) appContainer.classList.add('show-details');
            this.updateDetailsPanel(ChatManager.currentChatId, ChatManager.currentChatId.startsWith('group_') ? 'group' : 'contact');
        } else {
            if (appContainer) appContainer.classList.remove('show-details');
            // 使用 setTimeout 配合 CSS 过渡效果
            setTimeout(() => {
                if (!this.isDetailsPanelVisible && this.detailsPanelEl) this.detailsPanelEl.style.display = 'none';
            }, 300);
        }
    },

    /**
     * 根据当前聊天 ID 和类型更新详情面板的内容。
     * @param {string} chatId - 当前聊天的 ID。
     * @param {string} type - 聊天类型 ('contact' 或 'group')。
     */
    updateDetailsPanel: function (chatId, type) {
        if (!this.detailsPanelEl) return;
        this.detailsPanelEl.className = 'details-panel'; // 重置面板类名

        // 先隐藏所有可选部分，再根据类型显示
        [this.currentChatActionsDetailsEl, this.contactActionsDetailsEl, this.detailsGroupManagementEl,
            this.groupActionsDetailsEl, this.aiContactAboutSectionEl, this.aiTtsConfigSectionEl]
            .forEach(el => { if (el) el.style.display = 'none'; });

        // 显示通用操作（如清空聊天记录）
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

    /**
     * @private
     * 专用于更新联系人详情的内部方法。
     * @param {string} contactId - 联系人的 ID。
     */
    _updateForContact: function(contactId) {
        const contact = UserManager.contacts[contactId];
        if (!contact || !this.detailsPanelEl) return;

        this.detailsPanelEl.classList.add('contact-details-active');
        if (contact.isSpecial) this.detailsPanelEl.classList.add(contact.id);
        else this.detailsPanelEl.classList.add('human-contact-active');

        if (this.detailsNameEl) this.detailsNameEl.textContent = contact.name;
        if (this.detailsIdEl) this.detailsIdEl.textContent = `ID: ${contact.id}`;
        if (this.detailsAvatarEl) {
            this.detailsAvatarEl.className = 'details-avatar'; // 重置
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