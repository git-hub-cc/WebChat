
const GroupManager = {
    groups: {}, // { groupId: {id, name, owner, members:[], lastMessage, lastTime, unread, leftMembers: []} }
    currentGroupId: null, // This might be redundant if ChatManager.currentChatId is primary

    init: async function() {
        await this.loadGroups();
        // Event listeners for creating groups are now in UIManager or AppInitializer
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
            // Initial rendering of group list will be handled by ChatManager or UIManager
        } catch (error) {
            Utils.log(`Failed to load groups: ${error}`, Utils.logLevels.ERROR);
        }
    },

    saveGroup: async function(groupId) {
        if (this.groups[groupId]) {
            try {
                await DBManager.setItem('groups', this.groups[groupId]);
            } catch (error) {
                Utils.log(`Failed to save group ${groupId}: ${error}`, Utils.logLevels.ERROR);
            }
        }
    },

    renderGroupListForSidebar: function() { // New function for specific tab
        ChatManager.currentFilter = 'groups';
        UIManager.setActiveTab('groups');
        ChatManager.renderChatList('groups');
    },

    createGroup: async function(name) {
        const groupId = 'group_' + Utils.generateId();
        const group = {
            id: groupId,
            name: name,
            owner: UserManager.userId,
            members: [UserManager.userId], // Creator is the first member
            lastMessage: 'Group created',
            lastTime: new Date().toISOString(),
            unread: 0,
            leftMembers: []
        };
        this.groups[groupId] = group;
        await this.saveGroup(groupId);

        ChatManager.renderChatList(ChatManager.currentFilter); // Re-render the current list
        UIManager.showNotification(`Group "${name}" created.`, 'success');
        ChatManager.openChat(groupId, 'group'); // Optionally open the new group
        return groupId;
    },

    openGroup: function(groupId) {
        this.currentGroupId = groupId; // Keep track if needed for group-specific logic
        const group = this.groups[groupId];
        if (group) {
            UIManager.updateChatHeader(
                group.name,
                `${group.members.length} member${group.members.length === 1 ? '' : 's'}`,
                '👥', // Group avatar icon
                true, // isGroup
                group.owner === UserManager.userId // isOwner
            );
            this.clearUnread(groupId);
            UIManager.setCallButtonsState(false); // P2P calls are 1-to-1, disable for groups for now.
            // Group calls would require an SFU/MCU.
            document.getElementById('detailsGroupManagement').style.display = 'block';
            document.getElementById('groupActionsDetails').style.display = 'block';
            const dissolveBtn = document.getElementById('dissolveGroupBtnDetails');
            if(dissolveBtn) dissolveBtn.style.display = group.owner === UserManager.userId ? 'inline-block' : 'none';
            const leaveBtn = document.getElementById('leaveGroupBtnDetails');
            if(leaveBtn) leaveBtn.textContent = group.owner === UserManager.userId ? 'Manage Members (Dissolve Below)' : 'Leave Group';

            if(group.owner === UserManager.userId) {
                document.getElementById('addGroupMemberArea').style.display = 'block';
                if(group.leftMembers && group.leftMembers.length > 0) {
                    document.getElementById('leftMembersArea').style.display = 'block';
                } else {
                    document.getElementById('leftMembersArea').style.display = 'none';
                }
            } else {
                document.getElementById('addGroupMemberArea').style.display = 'none';
                document.getElementById('leftMembersArea').style.display = 'none';
            }

        } else {
            Utils.log(`Group ${groupId} not found for opening.`, Utils.logLevels.WARN);
        }
    },

    addMemberToGroup: async function(groupId, memberId, memberName = null) {
        const group = this.groups[groupId];
        if (!group) { UIManager.showNotification("Group not found.", "error"); return false; }
        if (group.owner !== UserManager.userId) { UIManager.showNotification("Only group owner can add members.", "error"); return false; }
        if (group.members.includes(memberId)) { UIManager.showNotification("User is already in the group.", "warning"); return false; }

        // Prevent adding special AI contacts to groups
        const contactToAdd = UserManager.contacts[memberId];
        if (contactToAdd && contactToAdd.isSpecial && contactToAdd.isAI) {
            UIManager.showNotification(`${contactToAdd.name} is an AI assistant and cannot be added to groups.`, "warning");
            return false;
        }


        group.members.push(memberId);
        // If member was in leftMembers, remove them
        group.leftMembers = group.leftMembers.filter(lm => lm.id !== memberId);

        await this.saveGroup(groupId);
        UIManager.updateDetailsPanelMembers(groupId); // Update members list in details panel
        if (ChatManager.currentChatId === groupId) this.openGroup(groupId); // Refresh header member count

        const inviterName = UserManager.contacts[UserManager.userId]?.name || UserManager.userId.substring(0,4);
        const newMemberDisplayName = memberName || UserManager.contacts[memberId]?.name || `User ${memberId.substring(0,4)}`;

        // System message for the group chat
        const systemMessage = {
            type: 'system',
            content: `${newMemberDisplayName} was added by ${inviterName}.`,
            timestamp: new Date().toISOString(),
            groupId: groupId,
        };
        ChatManager.addMessage(groupId, systemMessage); // Add to local chat
        this.broadcastToGroup(groupId, systemMessage, [memberId]); // Notify existing members (excluding the new one yet)

        // Invitation message to the new member
        const inviteMessage = {
            type: 'group-invite',
            groupId: groupId,
            groupName: group.name,
            owner: group.owner,
            members: group.members, // Send full member list
            invitedBy: UserManager.userId,
            sender: UserManager.userId, // Signaling server might use this
        };
        ConnectionManager.sendTo(memberId, inviteMessage);

        UIManager.showNotification(`${newMemberDisplayName} added to group.`, 'success');
        ChatManager.renderChatList(ChatManager.currentFilter);
        return true;
    },

    removeMemberFromGroup: async function(groupId, memberIdToRemove) {
        const group = this.groups[groupId];
        if (!group) return false;
        if (group.owner !== UserManager.userId) { UIManager.showNotification("Only group owner can remove members.", "error"); return false; }
        if (memberIdToRemove === UserManager.userId) { UIManager.showNotification("Owner cannot remove themselves. Dissolve group instead.", "warning"); return false; }

        const memberIndex = group.members.indexOf(memberIdToRemove);
        if (memberIndex === -1) { UIManager.showNotification("User not in group.", "warning"); return false; }

        group.members.splice(memberIndex, 1);
        await this.saveGroup(groupId);
        UIManager.updateDetailsPanelMembers(groupId);
        if (ChatManager.currentChatId === groupId) this.openGroup(groupId);

        const removerName = UserManager.contacts[UserManager.userId]?.name || UserManager.userId.substring(0,4);
        const removedName = UserManager.contacts[memberIdToRemove]?.name || `User ${memberIdToRemove.substring(0,4)}`;

        // System message for the group
        const systemMessage = {
            type: 'system',
            content: `${removedName} was removed by ${removerName}.`,
            timestamp: new Date().toISOString(),
            groupId: groupId,
        };
        ChatManager.addMessage(groupId, systemMessage);
        this.broadcastToGroup(groupId, systemMessage, [memberIdToRemove]);

        // Notification to the removed member
        const removalNotification = {
            type: 'group-removed', // You were removed from group
            groupId: groupId,
            groupName: group.name,
            reason: 'removed_by_owner',
            sender: UserManager.userId,
        };
        ConnectionManager.sendTo(memberIdToRemove, removalNotification);

        UIManager.showNotification(`${removedName} removed from group.`, 'success');
        ChatManager.renderChatList(ChatManager.currentFilter);
        return true;
    },

    leaveGroup: async function(groupId) {
        const group = this.groups[groupId];
        if (!group) { UIManager.showNotification("Group not found.", "error"); return; }
        if (group.owner === UserManager.userId) { UIManager.showNotification("Owner cannot leave. Dissolve group instead or transfer ownership (not implemented).", "warning"); return; }

        const myId = UserManager.userId;
        const memberIndex = group.members.indexOf(myId);
        if (memberIndex === -1) { /* Already not a member, or error */ return; }

        const myName = UserManager.contacts[myId]?.name || `User ${myId.substring(0,4)}`;
        const leaveMessage = {
            type: 'group-member-left',
            groupId: groupId,
            leftMemberId: myId,
            leftMemberName: myName,
            sender: myId,
        };
        this.broadcastToGroup(groupId, leaveMessage, [myId], true);

        delete this.groups[groupId];
        await DBManager.removeItem('groups', groupId);
        await ChatManager.clearChat(groupId);

        if (ChatManager.currentChatId === groupId) {
            ChatManager.currentChatId = null;
            UIManager.showNoChatSelected();
        }
        ChatManager.renderChatList(ChatManager.currentFilter);
        UIManager.showNotification(`You have left group "${group.name}".`, 'success');
    },

    dissolveGroup: async function(groupId) {
        const group = this.groups[groupId];
        if (!group) return;
        if (group.owner !== UserManager.userId) { UIManager.showNotification("Only group owner can dissolve the group.", "error"); return; }

        const dissolveNotification = {
            type: 'group-dissolved',
            groupId: groupId,
            groupName: group.name,
            sender: UserManager.userId,
        };
        this.broadcastToGroup(groupId, dissolveNotification, [UserManager.userId]);

        delete this.groups[groupId];
        await DBManager.removeItem('groups', groupId);
        await ChatManager.clearChat(groupId);

        if (ChatManager.currentChatId === groupId) {
            ChatManager.currentChatId = null;
            UIManager.showNoChatSelected();
        }
        ChatManager.renderChatList(ChatManager.currentFilter);
        UIManager.showNotification(`Group "${group.name}" has been dissolved.`, 'success');
    },

    broadcastToGroup: function(groupId, message, excludeIds = [], forceDirect = false) {
        const group = this.groups[groupId];
        if (!group) return false;

        message.groupId = groupId;
        message.sender = message.sender || UserManager.userId;
        message.originalSender = message.originalSender || message.sender;

        const originalSenderContact = UserManager.contacts[message.originalSender];
        message.originalSenderName = message.originalSenderName ||
            (originalSenderContact ? originalSenderContact.name : `User ${message.originalSender.substring(0,4)}`);


        if (group.owner === UserManager.userId || forceDirect) {
            group.members.forEach(memberId => {
                if (memberId !== UserManager.userId && !excludeIds.includes(memberId)) {
                    ConnectionManager.sendTo(memberId, { ...message });
                }
            });
        } else {
            if (group.owner !== UserManager.userId && !excludeIds.includes(group.owner)) {
                ConnectionManager.sendTo(group.owner, { ...message, needsRelay: true });
            }
        }
        Utils.log(`Broadcasting to group ${groupId}, type: ${message.type}`, Utils.logLevels.DEBUG);
        return true;
    },

    handleGroupMessage: async function(message) {
        const { groupId, type, sender, originalSender } = message;
        const group = this.groups[groupId];

        Utils.log(`Handling group message for ${groupId}, type: ${type}, from: ${sender}, original: ${originalSender}`, Utils.logLevels.DEBUG);

        if (type === 'group-invite') {
            if (!this.groups[groupId]) {
                const inviterName = UserManager.contacts[message.invitedBy]?.name || message.invitedBy.substring(0,4);
                this.groups[groupId] = {
                    id: groupId,
                    name: message.groupName,
                    owner: message.owner,
                    members: message.members || [],
                    lastMessage: `You were invited by ${inviterName}`,
                    lastTime: new Date().toISOString(),
                    unread: 1,
                    leftMembers: []
                };
                await this.saveGroup(groupId);
                ChatManager.renderChatList(ChatManager.currentFilter);
                UIManager.showNotification(`Invited to group: ${message.groupName}`, 'success');
            } else {
                group.members = message.members || group.members;
                await this.saveGroup(groupId);
                if (ChatManager.currentChatId === groupId) this.openGroup(groupId);
            }
            return;
        }

        if (!group) {
            Utils.log(`Received message for unknown group ${groupId}. Ignoring.`, Utils.logLevels.WARN);
            return;
        }

        if (message.needsRelay && group.owner === UserManager.userId) {
            delete message.needsRelay;
            this.broadcastToGroup(groupId, message, [originalSender || sender]);
            if(originalSender !== UserManager.userId) ChatManager.addMessage(groupId, message);
            return;
        }


        switch (type) {
            case 'text':
            case 'file':
            case 'image':
            case 'audio':
            case 'system':
                if ((originalSender || sender) !== UserManager.userId && group.members.includes(UserManager.userId)) {
                    ChatManager.addMessage(groupId, message);
                }
                break;

            case 'group-member-left':
                if (group.members.includes(message.leftMemberId)) {
                    group.members = group.members.filter(id => id !== message.leftMemberId);
                    const leftMemberName = message.leftMemberName || `User ${message.leftMemberId.substring(0,4)}`;
                    if (group.owner === UserManager.userId) {
                        if(!group.leftMembers) group.leftMembers = [];
                        if(!group.leftMembers.find(lm => lm.id === message.leftMemberId)) {
                            group.leftMembers.push({ id: message.leftMemberId, name: leftMemberName, leftTime: new Date().toISOString() });
                        }
                    }
                    await this.saveGroup(groupId);

                    if(group.members.includes(UserManager.userId)) {
                        const sysMsg = { type: 'system', content: `${leftMemberName} left the group.`, groupId: groupId, timestamp: new Date().toISOString()};
                        ChatManager.addMessage(groupId, sysMsg);
                    }

                    if (ChatManager.currentChatId === groupId) {
                        this.openGroup(groupId);
                        UIManager.updateDetailsPanelMembers(groupId);
                    }
                    ChatManager.renderChatList(ChatManager.currentFilter);
                }
                break;

            case 'group-removed':
                const targetUserIdForRemoval = message.targetUserId || message.removedMemberId; // Handle old and new property
                if (targetUserIdForRemoval === UserManager.userId || (message.reason === 'removed_by_owner' && sender !== UserManager.userId && targetUserIdForRemoval === UserManager.userId)) {
                    UIManager.showNotification(`You were removed from group: ${group.name}`, 'warning');
                    delete this.groups[groupId];
                    await DBManager.removeItem('groups', groupId);
                    await ChatManager.clearChat(groupId);
                    if (ChatManager.currentChatId === groupId) {
                        ChatManager.currentChatId = null; UIManager.showNoChatSelected();
                    }
                    ChatManager.renderChatList(ChatManager.currentFilter);
                } else if (group.members.includes(targetUserIdForRemoval)) {
                    group.members = group.members.filter(id => id !== targetUserIdForRemoval);
                    await this.saveGroup(groupId);
                    if (ChatManager.currentChatId === groupId) {
                        this.openGroup(groupId);
                        UIManager.updateDetailsPanelMembers(groupId);
                    }
                    ChatManager.renderChatList(ChatManager.currentFilter);
                }
                break;

            case 'group-dissolved':
                if (sender !== UserManager.userId) {
                    UIManager.showNotification(`Group "${group.name}" was dissolved by the owner.`, 'warning');
                    delete this.groups[groupId];
                    await DBManager.removeItem('groups', groupId);
                    await ChatManager.clearChat(groupId);
                    if (ChatManager.currentChatId === groupId) {
                        ChatManager.currentChatId = null; UIManager.showNoChatSelected();
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
            if (forceNoUnread) {
                group.unread = 0;
            } else if (incrementUnread && (ChatManager.currentChatId !== groupId || !document.hasFocus())) {
                group.unread = (group.unread || 0) + 1;
            }
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
        // Use originalSenderName if available (set by broadcastToGroup)
        // otherwise, fetch from UserManager or default.
        const senderName = message.originalSenderName ||
            (UserManager.contacts[message.originalSender || message.sender]?.name || 'User');


        switch (message.type) {
            case 'text':
                preview = `${senderName}: ${message.content}`;
                break;
            case 'image':
                preview = `${senderName}: [Image]`;
                break;
            case 'file':
                if (message.fileType && message.fileType.startsWith('image/')) preview = `${senderName}: [Image]`;
                else if (message.fileType && message.fileType.startsWith('video/')) preview = `${senderName}: [Video]`;
                else if (message.fileType && message.fileType.startsWith('audio/')) preview = `${senderName}: [Audio File]`;
                else preview = `${senderName}: [File] ${message.fileName || ''}`;
                break;
            case 'audio':
                preview = `${senderName}: [Voice Message]`;
                break;
            case 'system':
                preview = message.content;
                break;
            default:
                preview = `${senderName}: [New Message]`;
        }
        return preview.length > 35 ? preview.substring(0, 32) + "..." : preview;
    }
};