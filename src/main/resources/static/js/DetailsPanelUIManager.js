// NEW FILE: DetailsPanelUIManager.js
// Responsibilities:
// - Managing UI elements and interactions within the details panel.
// - Displaying contact/group information.
// - Handling group member management UI.
// - Integrating TTSUIManager for AI contact TTS settings.
const DetailsPanelUIManager = {
    isDetailsPanelVisible: false,
    _boundTtsConfigCollapseListener: null, // Main TTS section collapsible

    // DOM Elements
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
    aiTtsConfigHeaderEl: null, // Header for the main TTS collapsible section
    aiTtsConfigContentEl: null, // Content area for TTS form
    saveAiTtsSettingsBtnDetailsEl: null,
    closeDetailsBtnMainEl: null,
    groupMemberListDetailsEl: null,
    groupMemberCountEl: null,
    addGroupMemberAreaEl: null,
    leftMembersAreaEl: null,
    contactsDropdownDetailsEl: null,
    addMemberBtnDetailsEl: null,
    leftMemberListDetailsEl: null,


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


        this.bindEvents();
    },

    bindEvents: function() {
        if (this.closeDetailsBtnMainEl) {
            this.closeDetailsBtnMainEl.addEventListener('click', () => this.toggleDetailsPanel(false));
        }
        if (this.addMemberBtnDetailsEl) {
            this.addMemberBtnDetailsEl.addEventListener('click', () => this.handleAddMemberToGroupDetails());
        }
        // Event listeners for clearCurrentChatBtnDetails, deleteContactBtnDetails, leaveGroupBtnDetails,
        // dissolveGroupBtnDetails, saveAiTtsSettingsBtnDetails are set dynamically in updateDetailsPanel.
    },

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
            setTimeout(() => {
                if (!this.isDetailsPanelVisible && this.detailsPanelEl) this.detailsPanelEl.style.display = 'none';
            }, 300);
        }
    },

    updateDetailsPanel: function (chatId, type) {
        if (!this.detailsPanelEl) return;
        this.detailsPanelEl.className = 'details-panel'; // Reset panel class list

        // Hide all sections initially
        [this.currentChatActionsDetailsEl, this.contactActionsDetailsEl, this.detailsGroupManagementEl,
            this.groupActionsDetailsEl, this.aiContactAboutSectionEl, this.aiTtsConfigSectionEl]
            .forEach(el => { if (el) el.style.display = 'none'; });

        if (chatId) { // Common actions for any selected chat
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

        this.detailsPanelEl.classList.add('contact-details-active');
        if (contact.isSpecial) this.detailsPanelEl.classList.add(contact.id);
        else this.detailsPanelEl.classList.add('human-contact-active');

        if (this.detailsNameEl) this.detailsNameEl.textContent = contact.name;
        if (this.detailsIdEl) this.detailsIdEl.textContent = `ID: ${contact.id}`;
        if (this.detailsAvatarEl) {
            this.detailsAvatarEl.className = 'details-avatar'; // Reset
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
            if (contact.isSpecial) this.detailsStatusEl.textContent = (contact.isAI ? 'AI Assistant' : 'Special Contact') + ' - Always available';
            else this.detailsStatusEl.textContent = ConnectionManager.isConnectedTo(contactId) ? 'Connected' : 'Offline';
        }

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
        } else {
            if (this.contactActionsDetailsEl) this.contactActionsDetailsEl.style.display = 'block';
            if (this.deleteContactBtnDetailsEl) this.deleteContactBtnDetailsEl.onclick = () => ChatManager.deleteChat(contactId, 'contact');
            if (this.aiTtsConfigSectionEl) this.aiTtsConfigSectionEl.style.display = 'none';
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
        TtsUIManager.populateAiTtsConfigurationForm(contact, 'ttsConfigFormContainer'); // Use TtsUIManager

        if (this.saveAiTtsSettingsBtnDetailsEl) {
            // Remove previous listener before adding new one to avoid duplicates
            if (TtsUIManager._boundSaveTtsListener) {
                this.saveAiTtsSettingsBtnDetailsEl.removeEventListener('click', TtsUIManager._boundSaveTtsListener);
            }
            TtsUIManager._boundSaveTtsListener = TtsUIManager.handleSaveAiTtsSettings.bind(TtsUIManager, contact.id);
            this.saveAiTtsSettingsBtnDetailsEl.addEventListener('click', TtsUIManager._boundSaveTtsListener);
        }

        if (this.aiTtsConfigHeaderEl) { // Main TTS section collapsible
            if (this._boundTtsConfigCollapseListener) {
                this.aiTtsConfigHeaderEl.removeEventListener('click', this._boundTtsConfigCollapseListener);
            }
            this._boundTtsConfigCollapseListener = function() {
                this.classList.toggle('active');
                const content = this.nextElementSibling; // aiTtsConfigContentEl
                const icon = this.querySelector('.collapse-icon');
                if (content) {
                    if (content.style.display === "block") {
                        content.style.display = "none";
                        if(icon) icon.textContent = '▶'; // Collapsed
                    } else {
                        content.style.display = "block";
                        if(icon) icon.textContent = '▼'; // Expanded
                    }
                }
            };
            this.aiTtsConfigHeaderEl.addEventListener('click', this._boundTtsConfigCollapseListener);
            const icon = this.aiTtsConfigHeaderEl.querySelector('.collapse-icon');
            if (this.aiTtsConfigContentEl) { // Ensure initial state matches
                if (!this.aiTtsConfigHeaderEl.classList.contains('active')) {
                    this.aiTtsConfigContentEl.style.display = 'none';
                    if(icon) icon.textContent = '▶';
                } else {
                    this.aiTtsConfigContentEl.style.display = 'block';
                    if(icon) icon.textContent = '▼';
                }
            }
        }
    },

    _updateForGroup: function(groupId) {
        const group = GroupManager.groups[groupId];
        if (!group || !this.detailsPanelEl) return;

        this.detailsPanelEl.classList.add('group-chat-active');
        if (this.detailsNameEl) this.detailsNameEl.textContent = group.name;
        if (this.detailsIdEl) this.detailsIdEl.textContent = `Group ID: ${group.id.substring(6)}`;
        if (this.detailsAvatarEl) {
            this.detailsAvatarEl.innerHTML = '👥';
            this.detailsAvatarEl.className = 'details-avatar group';
        }
        if (this.detailsStatusEl) this.detailsStatusEl.textContent = `${group.members.length} member${group.members.length === 1 ? '' : 's'}`;
        if (this.detailsGroupManagementEl) this.detailsGroupManagementEl.style.display = 'block';
        if (this.groupActionsDetailsEl) this.groupActionsDetailsEl.style.display = 'block';

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
        if (this.aiContactAboutSectionEl) this.aiContactAboutSectionEl.style.display = 'none';
        if (this.aiTtsConfigSectionEl) this.aiTtsConfigSectionEl.style.display = 'none';
    },

    updateDetailsPanelMembers: function (groupId) {
        const group = GroupManager.groups[groupId];
        if (!group || !this.groupMemberListDetailsEl || !this.groupMemberCountEl || !this.contactsDropdownDetailsEl || !this.leftMemberListDetailsEl) return;

        this.groupMemberListDetailsEl.innerHTML = '';
        this.groupMemberCountEl.textContent = group.members.length;

        group.members.forEach(memberId => {
            const member = UserManager.contacts[memberId] || {id: memberId, name: `User ${memberId.substring(0, 4)}`};
            const item = document.createElement('div');
            item.className = 'member-item-detail';
            let html = `<span>${Utils.escapeHtml(member.name)} ${memberId === UserManager.userId ? '(You)' : ''}</span>`;
            if (memberId === group.owner) html += '<span class="owner-badge">Owner</span>';
            else if (group.owner === UserManager.userId) {
                html += `<button class="remove-member-btn-detail" data-member-id="${memberId}" title="Remove member">✕</button>`;
            }
            item.innerHTML = html;
            this.groupMemberListDetailsEl.appendChild(item);
        });
        this.groupMemberListDetailsEl.querySelectorAll('.remove-member-btn-detail').forEach(btn => {
            btn.onclick = () => GroupManager.removeMemberFromGroup(groupId, btn.dataset.memberId);
        });

        this.contactsDropdownDetailsEl.innerHTML = '<option value="">Select contact to add...</option>';
        Object.values(UserManager.contacts).forEach(contact => {
            if (!group.members.includes(contact.id) && !(group.leftMembers?.find(lm => lm.id === contact.id)) && !(contact.isSpecial && contact.isAI)) {
                const option = document.createElement('option');
                option.value = contact.id;
                option.textContent = contact.name;
                this.contactsDropdownDetailsEl.appendChild(option);
            }
        });

        this.leftMemberListDetailsEl.innerHTML = '';
        if (group.owner === UserManager.userId && group.leftMembers && group.leftMembers.length > 0 && this.leftMembersAreaEl) {
            group.leftMembers.forEach(leftMember => {
                const item = document.createElement('div');
                item.className = 'left-member-item-detail';
                item.innerHTML = `<span>${Utils.escapeHtml(leftMember.name)} (Left: ${Utils.formatDate(new Date(leftMember.leftTime))})</span>
                                  <button class="re-add-member-btn-detail" data-member-id="${leftMember.id}" data-member-name="${Utils.escapeHtml(leftMember.name)}" title="Re-add member">+</button>`;
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
            NotificationManager.showNotification("Please select a contact to add.", "warning");
        }
    }
};