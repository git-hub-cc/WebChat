// MODIFIED: GroupManager.js (已翻译为中文)
// - 对 UIManager 的面板更新调用现在转到 DetailsPanelUIManager。
// - 对 UIManager 的聊天头部更新调用现在转到 ChatAreaUIManager。
// - 当群主从群组中移除成员时，被移除的成员会收到通知，并且实际从其客户端移除的操作会延迟 5 秒。
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
            Utils.log(`加载群组失败: ${error}`, Utils.logLevels.ERROR);
        }
    },

    saveGroup: async function(groupId) {
        if (this.groups[groupId]) {
            try { await DBManager.setItem('groups', this.groups[groupId]); }
            catch (error) { Utils.log(`保存群组 ${groupId} 失败: ${error}`, Utils.logLevels.ERROR); }
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
            lastMessage: '群组已创建', lastTime: new Date().toISOString(), unread: 0, leftMembers: []
        };
        this.groups[groupId] = group;
        await this.saveGroup(groupId);
        ChatManager.renderChatList(ChatManager.currentFilter);
        NotificationManager.showNotification(`群组 "${name}" 已创建。`, 'success');
        ChatManager.openChat(groupId, 'group');
        return groupId;
    },

    openGroup: function(groupId) {
        this.currentGroupId = groupId;
        const group = this.groups[groupId];
        if (group && typeof ChatAreaUIManager !== 'undefined') {
            ChatAreaUIManager.updateChatHeader(
                group.name, `${group.members.length} 名成员`, '👥', true
            );
            this.clearUnread(groupId);
            ChatAreaUIManager.setCallButtonsState(false); // 对群组禁用 P2P 通话
        } else if (!group) {
            Utils.log(`未找到要打开的群组 ${groupId}。`, Utils.logLevels.WARN);
        }
        // DetailsPanelUIManager 将在 ChatManager.openChat 调用 updateDetailsPanel 时处理其自身的群组状态
    },

    addMemberToGroup: async function(groupId, memberId, memberName = null) {
        const group = this.groups[groupId];
        if (!group) { NotificationManager.showNotification("未找到群组。", "error"); return false; }
        if (group.owner !== UserManager.userId) { NotificationManager.showNotification("只有群主可以添加成员。", "error"); return false; }
        if (group.members.includes(memberId)) { NotificationManager.showNotification("用户已在群组中。", "warning"); return false; }

        const contactToAdd = UserManager.contacts[memberId];
        if (contactToAdd && contactToAdd.isSpecial && contactToAdd.isAI) {
            NotificationManager.showNotification(`${contactToAdd.name} 是 AI 助手，不能添加到群组。`, "warning");
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
        const newMemberDisplayName = memberName || UserManager.contacts[memberId]?.name || `用户 ${memberId.substring(0,4)}`;
        const systemMessage = { type: 'system', content: `${inviterName} 邀请 ${newMemberDisplayName} 加入了群聊。`, timestamp: new Date().toISOString(), groupId: groupId };
        ChatManager.addMessage(groupId, systemMessage);
        this.broadcastToGroup(groupId, systemMessage, [memberId]);

        const inviteMessage = { type: 'group-invite', groupId: groupId, groupName: group.name, owner: group.owner, members: group.members, invitedBy: UserManager.userId, sender: UserManager.userId };
        ConnectionManager.sendTo(memberId, inviteMessage);
        NotificationManager.showNotification(`${newMemberDisplayName} 已被添加到群组。`, 'success');
        ChatManager.renderChatList(ChatManager.currentFilter);
        return true;
    },

    removeMemberFromGroup: async function(groupId, memberIdToRemove) {
        const group = this.groups[groupId];
        if (!group) { NotificationManager.showNotification("未找到群组。", "error"); return false; } // 群主必须存在此群组
        if (group.owner !== UserManager.userId) { NotificationManager.showNotification("只有群主可以移除成员。", "error"); return false; }
        if (memberIdToRemove === UserManager.userId) { NotificationManager.showNotification("群主无法移除自己。请选择解散群组。", "warning"); return false; }
        const memberIndex = group.members.indexOf(memberIdToRemove);
        if (memberIndex === -1) { NotificationManager.showNotification("用户不在群组中。", "warning"); return false; }

        group.members.splice(memberIndex, 1);
        await this.saveGroup(groupId);
        if (typeof DetailsPanelUIManager !== 'undefined' && DetailsPanelUIManager.isDetailsPanelVisible && ChatManager.currentChatId === groupId) {
            DetailsPanelUIManager.updateDetailsPanelMembers(groupId);
        }
        if (ChatManager.currentChatId === groupId) this.openGroup(groupId); // 刷新群主视图

        const removerName = UserManager.contacts[UserManager.userId]?.name || UserManager.userId.substring(0,4);
        const removedName = UserManager.contacts[memberIdToRemove]?.name || `用户 ${memberIdToRemove.substring(0,4)}`;
        const systemMessage = { type: 'system', content: `${removerName} 已将 ${removedName} 移出群聊。`, timestamp: new Date().toISOString(), groupId: groupId };
        ChatManager.addMessage(groupId, systemMessage); // 群主看到此系统消息
        this.broadcastToGroup(groupId, systemMessage, [memberIdToRemove]); // 其他剩余成员看到此系统消息

        // 向被移除的成员发送通知
        const removalNotification = {
            type: 'group-removed',
            groupId: groupId,
            groupName: group.name,
            reason: 'removed_by_owner',
            sender: UserManager.userId, // 执行操作的群主
            removedMemberId: memberIdToRemove // 被移除成员的 ID
        };
        ConnectionManager.sendTo(memberIdToRemove, removalNotification);

        NotificationManager.showNotification(`${removedName} 已被移出群组。`, 'success'); // 给群主看
        ChatManager.renderChatList(ChatManager.currentFilter); // 群主的侧边栏更新
        return true;
    },

    leaveGroup: async function(groupId) {
        const group = this.groups[groupId];
        if (!group) { NotificationManager.showNotification("未找到群组。", "error"); return; }
        if (group.owner === UserManager.userId) { NotificationManager.showNotification("群主不能离开。请选择解散群组。", "warning"); return; }

        const myId = UserManager.userId;
        if (!group.members.includes(myId)) return;

        const myName = UserManager.contacts[myId]?.name || `用户 ${myId.substring(0,4)}`;
        const leaveMessage = { type: 'group-member-left', groupId: groupId, leftMemberId: myId, leftMemberName: myName, sender: myId };
        this.broadcastToGroup(groupId, leaveMessage, [myId], true); // forceDirect 确保消息能发出

        delete this.groups[groupId];
        await DBManager.removeItem('groups', groupId);
        await ChatManager.clearChat(groupId);
        if (ChatManager.currentChatId === groupId) {
            ChatManager.currentChatId = null;
            if (typeof ChatAreaUIManager !== 'undefined') ChatAreaUIManager.showNoChatSelected();
        }
        ChatManager.renderChatList(ChatManager.currentFilter);
        NotificationManager.showNotification(`您已离开群组 "${group.name}"。`, 'success');
    },

    dissolveGroup: async function(groupId) {
        const group = this.groups[groupId];
        if (!group) return;
        if (group.owner !== UserManager.userId) { NotificationManager.showNotification("只有群主可以解散群组。", "error"); return; }

        const dissolveNotification = { type: 'group-dissolved', groupId: groupId, groupName: group.name, sender: UserManager.userId };
        this.broadcastToGroup(groupId, dissolveNotification, [UserManager.userId]); // 不向自己广播，群主本地处理

        // 群主本地处理解散
        delete this.groups[groupId];
        await DBManager.removeItem('groups', groupId);
        await ChatManager.clearChat(groupId);
        if (ChatManager.currentChatId === groupId) {
            ChatManager.currentChatId = null;
            if (typeof ChatAreaUIManager !== 'undefined') ChatAreaUIManager.showNoChatSelected();
        }
        ChatManager.renderChatList(ChatManager.currentFilter);
        NotificationManager.showNotification(`群组 "${group.name}" 已被解散。`, 'success');
    },

    broadcastToGroup: function(groupId, message, excludeIds = [], forceDirect = false) {
        const group = this.groups[groupId];
        if (!group) return false;
        message.groupId = groupId;
        message.sender = message.sender || UserManager.userId;
        message.originalSender = message.originalSender || message.sender;
        const originalSenderContact = UserManager.contacts[message.originalSender];
        message.originalSenderName = message.originalSenderName || (originalSenderContact ? originalSenderContact.name : `用户 ${message.originalSender.substring(0,4)}`);

        if (group.owner === UserManager.userId || forceDirect) {
            group.members.forEach(memberId => {
                if (memberId !== UserManager.userId && !excludeIds.includes(memberId)) {
                    ConnectionManager.sendTo(memberId, { ...message });
                }
            });
        } else {
            // 如果不是群主且不是 forceDirect，发送给群主进行中继
            if (group.owner !== UserManager.userId && !excludeIds.includes(group.owner)) {
                ConnectionManager.sendTo(group.owner, { ...message, needsRelay: true });
            }
        }
        Utils.log(`正在向群组 ${groupId} 广播，类型: ${message.type}`, Utils.logLevels.DEBUG);
        return true;
    },

    handleGroupMessage: async function(message) {
        const { groupId, type, sender, originalSender } = message;
        let group = this.groups[groupId]; // 使用 'let' 因为它可能在处理邀请时被重新赋值
        Utils.log(`正在处理群组消息: ${groupId}, 类型: ${type}, 来自: ${sender}, 原始发送者: ${originalSender}`, Utils.logLevels.DEBUG);

        if (type === 'group-invite') {
            if (!this.groups[groupId]) { // 如果本地不存在该群组，则创建它
                const inviterName = UserManager.contacts[message.invitedBy]?.name || message.invitedBy.substring(0,4);
                this.groups[groupId] = {
                    id: groupId, name: message.groupName, owner: message.owner, members: message.members || [],
                    lastMessage: `您被 ${inviterName} 邀请加入群聊`, lastTime: new Date().toISOString(), unread: 1, leftMembers: []
                };
                group = this.groups[groupId]; // 赋值给局部 'group' 变量
                await this.saveGroup(groupId);
                ChatManager.renderChatList(ChatManager.currentFilter);
                NotificationManager.showNotification(`被邀请加入群组: ${message.groupName}`, 'success');
            } else { // 群组已存在，可能需要更新成员
                group.members = message.members || group.members;
                await this.saveGroup(groupId);
                if (ChatManager.currentChatId === groupId) this.openGroup(groupId);
            }
            return; // group-invite 处理完毕
        }

        // 对于大多数消息，如果群组上下文丢失或消息是针对一个（在此客户端上）不存在的群组。
        // 例外: 针对自己的 'group-removed'，它应该继续以显示通知。
        if (!group) {
            if (type === 'group-removed' && message.removedMemberId === UserManager.userId && message.reason === 'removed_by_owner') {
                // 允许针对自己的 'group-removed' 即使本地群组对象已消失也继续处理。
                // 这种情况下 'group' 变量将为 null/undefined。
            } else {
                Utils.log(`收到未知或本地已删除群组 ${groupId} 的消息。类型: ${type}。正在忽略。`, Utils.logLevels.WARN);
                return;
            }
        }

        if (message.needsRelay && group && group.owner === UserManager.userId) { // 确保群组存在以进行中继
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
                    const leftMemberName = message.leftMemberName || `用户 ${message.leftMemberId.substring(0,4)}`;
                    if (group.owner === UserManager.userId) {
                        if(!group.leftMembers) group.leftMembers = [];
                        if(!group.leftMembers.find(lm => lm.id === message.leftMemberId)) {
                            group.leftMembers.push({ id: message.leftMemberId, name: leftMemberName, leftTime: new Date().toISOString() });
                        }
                    }
                    await this.saveGroup(groupId);
                    if(group.members.includes(UserManager.userId)) { // 如果当前用户仍在群中
                        ChatManager.addMessage(groupId, { type: 'system', content: `${leftMemberName} 离开了群聊。`, groupId: groupId, timestamp: new Date().toISOString()});
                    }
                    if (ChatManager.currentChatId === groupId) {
                        this.openGroup(groupId);
                        if (typeof DetailsPanelUIManager !== 'undefined') DetailsPanelUIManager.updateDetailsPanelMembers(groupId);
                    }
                    ChatManager.renderChatList(ChatManager.currentFilter);
                }
                break;
            case 'group-removed':
                // 此消息 (类型为 'group-removed' 且原因为 'removed_by_owner')
                // 是由群主专门发送给被移除用户的。
                if (message.removedMemberId === UserManager.userId && message.reason === 'removed_by_owner') {
                    // 'group' 在此可能为 null，如果在此消息到达前本地已删除。
                    // 主要使用 message.groupName，如果 group 对象存在则回退到 group.name。
                    const groupNameForNotification = message.groupName || (group ? group.name : null) || `群组 ${groupId}`;

                    NotificationManager.showNotification(
                        `您正在被移出群组 "${groupNameForNotification}"。此操作将在 5 秒后生效。`,
                        'info', // 对待处理消息使用 'info' 或 'warning'
                        6000    // 通知显示 6 秒，比延迟略长
                    );

                    const capturedGroupId = groupId; // 捕获 groupId 以用于闭包
                    const capturedGroupName = groupNameForNotification; // 捕获 groupName 以用于闭包

                    setTimeout(async () => {
                        // 如果可用，从本地缓存重新检查群组名称，否则使用捕获的名称
                        // 如果在超时期间群组被其他进程删除，this.groups[capturedGroupId] 可能为 undefined
                        const finalGroupName = (this.groups[capturedGroupId] ? this.groups[capturedGroupId].name : null) || capturedGroupName;

                        NotificationManager.showNotification(
                            `您已被移出群组 "${finalGroupName}"。`,
                            'warning' // 对最终移除确认使用 'warning'
                        );

                        // 执行实际的本地数据和 UI 移除操作
                        delete this.groups[capturedGroupId]; // 从本地缓存中移除
                        await DBManager.removeItem('groups', capturedGroupId); // 从数据库中移除
                        await ChatManager.clearChat(capturedGroupId); // 清除相关消息

                        if (ChatManager.currentChatId === capturedGroupId) {
                            ChatManager.currentChatId = null;
                            if (typeof ChatAreaUIManager !== 'undefined') {
                                ChatAreaUIManager.showNoChatSelected();
                            }
                        }
                        // 更新聊天列表 (侧边栏) 以移除该群组
                        ChatManager.renderChatList(ChatManager.currentFilter);
                    }, 5000); // 执行移除前有 5 秒延迟
                }
                // 此处不需要 'else' 块，因为 reason 为 'removed_by_owner' 的 'group-removed'
                // 是点对点发送给 removedMemberId 的。其他成员会收到 'system' 消息。
                break;
            case 'group-dissolved':
                if (group && sender !== UserManager.userId) { // group 检查确保其在本地存在
                    NotificationManager.showNotification(`群组 "${group.name}" 已被群主解散。`, 'warning');
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
        const senderName = message.originalSenderName || (UserManager.contacts[message.originalSender || message.sender]?.name || '用户');
        switch (message.type) {
            case 'text': preview = `${senderName}: ${message.content}`; break;
            case 'image': preview = `${senderName}: [图片]`; break;
            case 'file':
                if (message.fileType?.startsWith('image/')) preview = `${senderName}: [图片]`;
                else if (message.fileType?.startsWith('video/')) preview = `${senderName}: [视频]`;
                else if (message.fileType?.startsWith('audio/')) preview = `${senderName}: [音频文件]`;
                else preview = `${senderName}: [文件] ${message.fileName || ''}`;
                break;
            case 'audio': preview = `${senderName}: [语音消息]`; break;
            case 'system': preview = message.content; break;
            default: preview = `${senderName}: [新消息]`;
        }
        return preview.length > 35 ? preview.substring(0, 32) + "..." : preview;
    }
};