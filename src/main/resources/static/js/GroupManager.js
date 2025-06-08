// MODIFIED: GroupManager.js
// - Calls to UIManager for panel updates now go to DetailsPanelUIManager.
// - Calls to UIManager for chat header updates now go to ChatAreaUIManager.
// - When a member is removed from a group by the owner, the removed member receives a notification
//   and the actual removal from their client is delayed by 5 seconds.
const GroupManager = {
    groups: {},
    currentGroupId: null,

    init: async function() {
        await this.loadGroups();
    },

    loadGroups: async function() {
        try {
            await DBManager.init();
            const groupItems = await DBManager.getAllItems('groups');
            this.groups = {};
            if (groupItems && groupItems.length > 0) {
                groupItems.forEach(group => {
                    this.groups[group.id] = { ...group, members: group.members || [], leftMembers: group.leftMembers || [] };
                });
            }
        } catch (error) {
            Utils.log(`Failed to load groups: ${error}`, Utils.logLevels.ERROR);
        }
    },

    saveGroup: async function(groupId) {
        if (this.groups[groupId]) {
            try { await DBManager.setItem('groups', this.groups[groupId]); }
            catch (error) { Utils.log(`Failed to save group ${groupId}: ${error}`, Utils.logLevels.ERROR); }
        }
    },

    renderGroupListForSidebar: function() {
        ChatManager.currentFilter = 'groups';
        if (typeof SidebarUIManager !== 'undefined') SidebarUIManager.setActiveTab('groups');
        ChatManager.renderChatList('groups');
    },

    createGroup: async function(name) {
        const groupId = 'group_' + Utils.generateId();
        const group = {
            id: groupId, name: name, owner: UserManager.userId, members: [UserManager.userId],
            lastMessage: 'Group created', lastTime: new Date().toISOString(), unread: 0, leftMembers: []
        };
        this.groups[groupId] = group;
        await this.saveGroup(groupId);
        ChatManager.renderChatList(ChatManager.currentFilter);
        NotificationManager.showNotification(`Group "${name}" created.`, 'success');
        ChatManager.openChat(groupId, 'group');
        return groupId;
    },

    openGroup: function(groupId) {
        this.currentGroupId = groupId;
        const group = this.groups[groupId];
        if (group && typeof ChatAreaUIManager !== 'undefined') {
            ChatAreaUIManager.updateChatHeader(
                group.name, `${group.members.length} member${group.members.length === 1 ? '' : 's'}`, '👥', true
            );
            this.clearUnread(groupId);
            ChatAreaUIManager.setCallButtonsState(false); // Disable P2P calls for groups
        } else if (!group) {
            Utils.log(`Group ${groupId} not found for opening.`, Utils.logLevels.WARN);
        }
        // DetailsPanelUIManager will handle its own state for groups when updateDetailsPanel is called by ChatManager.openChat
    },

    addMemberToGroup: async function(groupId, memberId, memberName = null) {
        const group = this.groups[groupId];
        if (!group) { NotificationManager.showNotification("Group not found.", "error"); return false; }
        if (group.owner !== UserManager.userId) { NotificationManager.showNotification("Only group owner can add members.", "error"); return false; }
        if (group.members.includes(memberId)) { NotificationManager.showNotification("User is already in the group.", "warning"); return false; }

        const contactToAdd = UserManager.contacts[memberId];
        if (contactToAdd && contactToAdd.isSpecial && contactToAdd.isAI) {
            NotificationManager.showNotification(`${contactToAdd.name} is an AI assistant and cannot be added to groups.`, "warning");
            return false;
        }

        group.members.push(memberId);
        group.leftMembers = group.leftMembers.filter(lm => lm.id !== memberId);
        await this.saveGroup(groupId);

        if (typeof DetailsPanelUIManager !== 'undefined' && DetailsPanelUIManager.isDetailsPanelVisible && ChatManager.currentChatId === groupId) {
            DetailsPanelUIManager.updateDetailsPanelMembers(groupId);
        }
        if (ChatManager.currentChatId === groupId) this.openGroup(groupId);

        const inviterName = UserManager.contacts[UserManager.userId]?.name || UserManager.userId.substring(0,4);
        const newMemberDisplayName = memberName || UserManager.contacts[memberId]?.name || `User ${memberId.substring(0,4)}`;
        const systemMessage = { type: 'system', content: `${newMemberDisplayName} was added by ${inviterName}.`, timestamp: new Date().toISOString(), groupId: groupId };
        ChatManager.addMessage(groupId, systemMessage);
        this.broadcastToGroup(groupId, systemMessage, [memberId]);

        const inviteMessage = { type: 'group-invite', groupId: groupId, groupName: group.name, owner: group.owner, members: group.members, invitedBy: UserManager.userId, sender: UserManager.userId };
        ConnectionManager.sendTo(memberId, inviteMessage);
        NotificationManager.showNotification(`${newMemberDisplayName} added to group.`, 'success');
        ChatManager.renderChatList(ChatManager.currentFilter);
        return true;
    },

    removeMemberFromGroup: async function(groupId, memberIdToRemove) {
        const group = this.groups[groupId];
        if (!group) { NotificationManager.showNotification("Group not found.", "error"); return false; } // Group must exist for owner
        if (group.owner !== UserManager.userId) { NotificationManager.showNotification("Only group owner can remove members.", "error"); return false; }
        if (memberIdToRemove === UserManager.userId) { NotificationManager.showNotification("Owner cannot remove themselves. Dissolve group instead.", "warning"); return false; }
        const memberIndex = group.members.indexOf(memberIdToRemove);
        if (memberIndex === -1) { NotificationManager.showNotification("User not in group.", "warning"); return false; }

        group.members.splice(memberIndex, 1);
        await this.saveGroup(groupId);
        if (typeof DetailsPanelUIManager !== 'undefined' && DetailsPanelUIManager.isDetailsPanelVisible && ChatManager.currentChatId === groupId) {
            DetailsPanelUIManager.updateDetailsPanelMembers(groupId);
        }
        if (ChatManager.currentChatId === groupId) this.openGroup(groupId); // Refresh owner's view

        const removerName = UserManager.contacts[UserManager.userId]?.name || UserManager.userId.substring(0,4);
        const removedName = UserManager.contacts[memberIdToRemove]?.name || `User ${memberIdToRemove.substring(0,4)}`;
        const systemMessage = { type: 'system', content: `${removedName} was removed by ${removerName}.`, timestamp: new Date().toISOString(), groupId: groupId };
        ChatManager.addMessage(groupId, systemMessage); // Owner sees this system message
        this.broadcastToGroup(groupId, systemMessage, [memberIdToRemove]); // Other remaining members see this system message

        // Notification to the removed member
        const removalNotification = {
            type: 'group-removed',
            groupId: groupId,
            groupName: group.name,
            reason: 'removed_by_owner',
            sender: UserManager.userId, // The owner who performed the action
            removedMemberId: memberIdToRemove // ID of the member being removed
        };
        ConnectionManager.sendTo(memberIdToRemove, removalNotification);

        NotificationManager.showNotification(`${removedName} removed from group.`, 'success'); // For the owner
        ChatManager.renderChatList(ChatManager.currentFilter); // Owner's sidebar update
        return true;
    },

    leaveGroup: async function(groupId) {
        const group = this.groups[groupId];
        if (!group) { NotificationManager.showNotification("Group not found.", "error"); return; }
        if (group.owner === UserManager.userId) { NotificationManager.showNotification("Owner cannot leave. Dissolve group instead.", "warning"); return; }

        const myId = UserManager.userId;
        if (!group.members.includes(myId)) return;

        const myName = UserManager.contacts[myId]?.name || `User ${myId.substring(0,4)}`;
        const leaveMessage = { type: 'group-member-left', groupId: groupId, leftMemberId: myId, leftMemberName: myName, sender: myId };
        this.broadcastToGroup(groupId, leaveMessage, [myId], true); // forceDirect to ensure it goes out

        delete this.groups[groupId];
        await DBManager.removeItem('groups', groupId);
        await ChatManager.clearChat(groupId);
        if (ChatManager.currentChatId === groupId) {
            ChatManager.currentChatId = null;
            if (typeof ChatAreaUIManager !== 'undefined') ChatAreaUIManager.showNoChatSelected();
        }
        ChatManager.renderChatList(ChatManager.currentFilter);
        NotificationManager.showNotification(`You have left group "${group.name}".`, 'success');
    },

    dissolveGroup: async function(groupId) {
        const group = this.groups[groupId];
        if (!group) return;
        if (group.owner !== UserManager.userId) { NotificationManager.showNotification("Only group owner can dissolve.", "error"); return; }

        const dissolveNotification = { type: 'group-dissolved', groupId: groupId, groupName: group.name, sender: UserManager.userId };
        this.broadcastToGroup(groupId, dissolveNotification, [UserManager.userId]); // Exclude self from broadcast, owner handles locally.

        // Owner handles dissolution locally
        delete this.groups[groupId];
        await DBManager.removeItem('groups', groupId);
        await ChatManager.clearChat(groupId);
        if (ChatManager.currentChatId === groupId) {
            ChatManager.currentChatId = null;
            if (typeof ChatAreaUIManager !== 'undefined') ChatAreaUIManager.showNoChatSelected();
        }
        ChatManager.renderChatList(ChatManager.currentFilter);
        NotificationManager.showNotification(`Group "${group.name}" has been dissolved.`, 'success');
    },

    broadcastToGroup: function(groupId, message, excludeIds = [], forceDirect = false) {
        const group = this.groups[groupId];
        if (!group) return false;
        message.groupId = groupId;
        message.sender = message.sender || UserManager.userId;
        message.originalSender = message.originalSender || message.sender;
        const originalSenderContact = UserManager.contacts[message.originalSender];
        message.originalSenderName = message.originalSenderName || (originalSenderContact ? originalSenderContact.name : `User ${message.originalSender.substring(0,4)}`);

        if (group.owner === UserManager.userId || forceDirect) {
            group.members.forEach(memberId => {
                if (memberId !== UserManager.userId && !excludeIds.includes(memberId)) {
                    ConnectionManager.sendTo(memberId, { ...message });
                }
            });
        } else {
            // If not owner and not forceDirect, send to owner for relay
            if (group.owner !== UserManager.userId && !excludeIds.includes(group.owner)) {
                ConnectionManager.sendTo(group.owner, { ...message, needsRelay: true });
            }
        }
        Utils.log(`Broadcasting to group ${groupId}, type: ${message.type}`, Utils.logLevels.DEBUG);
        return true;
    },

    handleGroupMessage: async function(message) {
        const { groupId, type, sender, originalSender } = message;
        let group = this.groups[groupId]; // Use 'let' as it might be reassigned for invites
        Utils.log(`Handling group message for ${groupId}, type: ${type}, from: ${sender}, original: ${originalSender}`, Utils.logLevels.DEBUG);

        if (type === 'group-invite') {
            if (!this.groups[groupId]) { // If group doesn't exist locally, create it
                const inviterName = UserManager.contacts[message.invitedBy]?.name || message.invitedBy.substring(0,4);
                this.groups[groupId] = {
                    id: groupId, name: message.groupName, owner: message.owner, members: message.members || [],
                    lastMessage: `You were invited by ${inviterName}`, lastTime: new Date().toISOString(), unread: 1, leftMembers: []
                };
                group = this.groups[groupId]; // Assign to local 'group' variable
                await this.saveGroup(groupId);
                ChatManager.renderChatList(ChatManager.currentFilter);
                NotificationManager.showNotification(`Invited to group: ${message.groupName}`, 'success');
            } else { // Group exists, maybe update members
                group.members = message.members || group.members;
                await this.saveGroup(groupId);
                if (ChatManager.currentChatId === groupId) this.openGroup(groupId);
            }
            return; // Finished handling group-invite
        }

        // For most messages, if group context is lost or message is for a non-existent group (for this client).
        // Exception: 'group-removed' for self, which should proceed to show notifications.
        if (!group) {
            if (type === 'group-removed' && message.removedMemberId === UserManager.userId && message.reason === 'removed_by_owner') {
                // Allow 'group-removed' for self to proceed even if local group object is gone.
                // The 'group' variable will be null/undefined in this case.
            } else {
                Utils.log(`Received message for unknown or locally deleted group ${groupId}. Type: ${type}. Ignoring.`, Utils.logLevels.WARN);
                return;
            }
        }

        if (message.needsRelay && group && group.owner === UserManager.userId) { // Ensure group exists for relay
            delete message.needsRelay;
            this.broadcastToGroup(groupId, message, [originalSender || sender]);
            if(originalSender !== UserManager.userId) ChatManager.addMessage(groupId, message);
            return;
        }

        switch (type) {
            case 'text': case 'file': case 'image': case 'audio': case 'system':
                if (group && (originalSender || sender) !== UserManager.userId && group.members.includes(UserManager.userId)) {
                    ChatManager.addMessage(groupId, message);
                }
                break;
            case 'group-member-left':
                if (group && group.members.includes(message.leftMemberId)) {
                    group.members = group.members.filter(id => id !== message.leftMemberId);
                    const leftMemberName = message.leftMemberName || `User ${message.leftMemberId.substring(0,4)}`;
                    if (group.owner === UserManager.userId) {
                        if(!group.leftMembers) group.leftMembers = [];
                        if(!group.leftMembers.find(lm => lm.id === message.leftMemberId)) {
                            group.leftMembers.push({ id: message.leftMemberId, name: leftMemberName, leftTime: new Date().toISOString() });
                        }
                    }
                    await this.saveGroup(groupId);
                    if(group.members.includes(UserManager.userId)) { // If current user is still in the group
                        ChatManager.addMessage(groupId, { type: 'system', content: `${leftMemberName} left the group.`, groupId: groupId, timestamp: new Date().toISOString()});
                    }
                    if (ChatManager.currentChatId === groupId) {
                        this.openGroup(groupId);
                        if (typeof DetailsPanelUIManager !== 'undefined') DetailsPanelUIManager.updateDetailsPanelMembers(groupId);
                    }
                    ChatManager.renderChatList(ChatManager.currentFilter);
                }
                break;
            case 'group-removed':
                // This message (type 'group-removed' with reason 'removed_by_owner') is sent specifically
                // by the owner to the user being removed.
                if (message.removedMemberId === UserManager.userId && message.reason === 'removed_by_owner') {
                    // 'group' might be null here if it was deleted locally before this message arrived.
                    // Use message.groupName as primary, fallback to group.name if group object exists.
                    const groupNameForNotification = message.groupName || (group ? group.name : null) || `Group ${groupId}`;

                    NotificationManager.showNotification(
                        `You are being removed from group "${groupNameForNotification}". This will take effect in 5 seconds.`,
                        'info', // 'info' or 'warning' for the pending message
                        6000    // Notification visible for 6 seconds, slightly longer than the delay
                    );

                    const capturedGroupId = groupId; // Capture groupId for the closure
                    const capturedGroupName = groupNameForNotification; // Capture groupName for the closure

                    setTimeout(async () => {
                        // Re-check group name from local cache if available, otherwise use captured name
                        // this.groups[capturedGroupId] might be undefined if group was deleted by another process during the timeout
                        const finalGroupName = (this.groups[capturedGroupId] ? this.groups[capturedGroupId].name : null) || capturedGroupName;

                        NotificationManager.showNotification(
                            `You have been removed from group "${finalGroupName}".`,
                            'warning' // 'warning' for the final removal confirmation
                        );

                        // Perform the actual removal from local data and UI
                        delete this.groups[capturedGroupId]; // Remove from local cache
                        await DBManager.removeItem('groups', capturedGroupId); // Remove from DB
                        await ChatManager.clearChat(capturedGroupId); // Clear associated messages

                        if (ChatManager.currentChatId === capturedGroupId) {
                            ChatManager.currentChatId = null;
                            if (typeof ChatAreaUIManager !== 'undefined') {
                                ChatAreaUIManager.showNoChatSelected();
                            }
                        }
                        // Update the chat list (sidebar) to remove the group
                        ChatManager.renderChatList(ChatManager.currentFilter);
                    }, 5000); // 5-second delay before executing removal
                }
                // No 'else' block needed here as 'group-removed' with 'removed_by_owner' reason
                // is sent point-to-point to the removedMemberId. Other members get a 'system' message.
                break;
            case 'group-dissolved':
                if (group && sender !== UserManager.userId) { // group check ensures it exists locally
                    NotificationManager.showNotification(`Group "${group.name}" was dissolved by the owner.`, 'warning');
                    delete this.groups[groupId];
                    await DBManager.removeItem('groups', groupId);
                    await ChatManager.clearChat(groupId);
                    if (ChatManager.currentChatId === groupId) {
                        ChatManager.currentChatId = null;
                        if (typeof ChatAreaUIManager !== 'undefined') ChatAreaUIManager.showNoChatSelected();
                    }
                    ChatManager.renderChatList(ChatManager.currentFilter);
                }
                break;
        }
    },

    updateGroupLastMessage: async function(groupId, messageText, incrementUnread = false, forceNoUnread = false) {
        const group = this.groups[groupId];
        if (group) {
            group.lastMessage = messageText.length > 30 ? messageText.substring(0, 27) + "..." : messageText;
            group.lastTime = new Date().toISOString();
            if (forceNoUnread) group.unread = 0;
            else if (incrementUnread && (ChatManager.currentChatId !== groupId || !document.hasFocus())) group.unread = (group.unread || 0) + 1;
            await this.saveGroup(groupId);
            ChatManager.renderChatList(ChatManager.currentFilter);
        }
    },

    clearUnread: async function(groupId) {
        const group = this.groups[groupId];
        if (group && group.unread > 0) {
            group.unread = 0;
            await this.saveGroup(groupId);
            ChatManager.renderChatList(ChatManager.currentFilter);
        }
    },

    formatMessagePreview: function(message) {
        let preview = '';
        const senderName = message.originalSenderName || (UserManager.contacts[message.originalSender || message.sender]?.name || 'User');
        switch (message.type) {
            case 'text': preview = `${senderName}: ${message.content}`; break;
            case 'image': preview = `${senderName}: [Image]`; break;
            case 'file':
                if (message.fileType?.startsWith('image/')) preview = `${senderName}: [Image]`;
                else if (message.fileType?.startsWith('video/')) preview = `${senderName}: [Video]`;
                else if (message.fileType?.startsWith('audio/')) preview = `${senderName}: [Audio File]`;
                else preview = `${senderName}: [File] ${message.fileName || ''}`;
                break;
            case 'audio': preview = `${senderName}: [Voice Message]`; break;
            case 'system': preview = message.content; break;
            default: preview = `${senderName}: [New Message]`;
        }
        return preview.length > 35 ? preview.substring(0, 32) + "..." : preview;
    }
};