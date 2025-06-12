/**
 * @file GroupManager.js
 * @description 核心群组管理器，负责处理所有与群组相关的逻辑，包括创建、加载、成员管理和消息广播。
 * @module GroupManager
 * @exports {object} GroupManager - 对外暴露的单例对象，包含所有群组管理功能。
 * @property {object} groups - 存储所有群组数据的对象，格式为 { groupId: groupObject }。
 * @property {function} init - 初始化模块，从数据库加载群组数据。
 * @property {function} createGroup - 创建一个新群组。
 * @property {function} addMemberToGroup - 向群组中添加一个新成员。
 * @property {function} removeMemberFromGroup - 从群组中移除一个成员。
 * @property {function} leaveGroup - 当前用户离开一个群组。
 * @property {function} dissolveGroup - 群主解散一个群组。
 * @property {function} broadcastToGroup - 向群组成员广播消息。
 * @property {function} handleGroupMessage - 处理接收到的群组相关消息。
 * @dependencies DBManager, UserManager, ChatManager, ConnectionManager, NotificationManager, Utils, DetailsPanelUIManager, ChatAreaUIManager, SidebarUIManager
 * @dependents AppInitializer (进行初始化), ChatManager (管理群组聊天), ModalManager (创建群组时调用)
 */
const GroupManager = {
    groups: {}, // 存储所有群组信息: { groupId: { id, name, owner, members, ... } }
    currentGroupId: null,

    /**
     * 初始化群组管理器，从数据库加载所有群组数据。
     * @returns {Promise<void>}
     */
    init: async function() {
        await this.loadGroups();
    },

    /**
     * 从 IndexedDB 加载所有群组数据到内存中。
     * @returns {Promise<void>}
     */
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

    /**
     * 将指定的群组数据保存到数据库。
     * @param {string} groupId - 要保存的群组 ID。
     * @returns {Promise<void>}
     */
    saveGroup: async function(groupId) {
        if (this.groups[groupId]) {
            try { await DBManager.setItem('groups', this.groups[groupId]); }
            catch (error) { Utils.log(`保存群组 ${groupId} 失败: ${error}`, Utils.logLevels.ERROR); }
        }
    },

    /**
     * 触发侧边栏重新渲染，只显示群组列表。
     */
    renderGroupListForSidebar: function() {
        ChatManager.currentFilter = 'groups';
        if (typeof SidebarUIManager !== 'undefined') SidebarUIManager.setActiveTab('groups');
        ChatManager.renderChatList('groups');
    },

    /**
     * 创建一个新群组。
     * @param {string} name - 新群组的名称。
     * @returns {Promise<string>} - 返回新创建的群组 ID。
     */
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

    /**
     * 打开指定的群组聊天界面。
     * @param {string} groupId - 要打开的群组 ID。
     */
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
    },

    /**
     * 向群组中添加一个新成员。
     * @param {string} groupId - 目标群组的 ID。
     * @param {string} memberId - 要添加的成员 ID。
     * @param {string|null} [memberName=null] - 要添加的成员名称。
     * @returns {Promise<boolean>} - 操作是否成功。
     */
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

        // 更新 UI
        if (typeof DetailsPanelUIManager !== 'undefined' && DetailsPanelUIManager.isDetailsPanelVisible && ChatManager.currentChatId === groupId) {
            DetailsPanelUIManager.updateDetailsPanelMembers(groupId);
        }
        if (ChatManager.currentChatId === groupId) this.openGroup(groupId);

        // 发送系统消息和邀请
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

    /**
     * 从群组中移除一个成员。
     * @param {string} groupId - 目标群组的 ID。
     * @param {string} memberIdToRemove - 要移除的成员 ID。
     * @returns {Promise<boolean>} - 操作是否成功。
     */
    removeMemberFromGroup: async function(groupId, memberIdToRemove) {
        const group = this.groups[groupId];
        if (!group) { NotificationManager.showNotification("未找到群组。", "error"); return false; }
        if (group.owner !== UserManager.userId) { NotificationManager.showNotification("只有群主可以移除成员。", "error"); return false; }
        if (memberIdToRemove === UserManager.userId) { NotificationManager.showNotification("群主无法移除自己。请选择解散群组。", "warning"); return false; }
        const memberIndex = group.members.indexOf(memberIdToRemove);
        if (memberIndex === -1) { NotificationManager.showNotification("用户不在群组中。", "warning"); return false; }

        group.members.splice(memberIndex, 1);
        await this.saveGroup(groupId);
        // 更新 UI
        if (typeof DetailsPanelUIManager !== 'undefined' && DetailsPanelUIManager.isDetailsPanelVisible && ChatManager.currentChatId === groupId) {
            DetailsPanelUIManager.updateDetailsPanelMembers(groupId);
        }
        if (ChatManager.currentChatId === groupId) this.openGroup(groupId);

        // 发送系统消息通知
        const removerName = UserManager.contacts[UserManager.userId]?.name || UserManager.userId.substring(0,4);
        const removedName = UserManager.contacts[memberIdToRemove]?.name || `用户 ${memberIdToRemove.substring(0,4)}`;
        const systemMessage = { type: 'system', content: `${removerName} 已将 ${removedName} 移出群聊。`, timestamp: new Date().toISOString(), groupId: groupId };
        ChatManager.addMessage(groupId, systemMessage);
        this.broadcastToGroup(groupId, systemMessage, [memberIdToRemove]);

        // 向被移除的成员发送一个专门的移除通知
        const removalNotification = {
            type: 'group-removed',
            groupId: groupId,
            groupName: group.name,
            reason: 'removed_by_owner',
            sender: UserManager.userId,
            removedMemberId: memberIdToRemove
        };
        ConnectionManager.sendTo(memberIdToRemove, removalNotification);

        NotificationManager.showNotification(`${removedName} 已被移出群组。`, 'success');
        ChatManager.renderChatList(ChatManager.currentFilter);
        return true;
    },

    /**
     * 当前用户离开一个群组。
     * @param {string} groupId - 要离开的群组 ID。
     * @returns {Promise<void>}
     */
    leaveGroup: async function(groupId) {
        const group = this.groups[groupId];
        if (!group) { NotificationManager.showNotification("未找到群组。", "error"); return; }
        if (group.owner === UserManager.userId) { NotificationManager.showNotification("群主不能离开。请选择解散群组。", "warning"); return; }
        const myId = UserManager.userId;
        if (!group.members.includes(myId)) return;

        // 广播离开消息
        const myName = UserManager.contacts[myId]?.name || `用户 ${myId.substring(0,4)}`;
        const leaveMessage = { type: 'group-member-left', groupId: groupId, leftMemberId: myId, leftMemberName: myName, sender: myId };
        this.broadcastToGroup(groupId, leaveMessage, [myId], true); // forceDirect 确保消息能发出

        // 本地清理
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

    /**
     * 群主解散一个群组。
     * @param {string} groupId - 要解散的群组 ID。
     * @returns {Promise<void>}
     */
    dissolveGroup: async function(groupId) {
        const group = this.groups[groupId];
        if (!group) return;
        if (group.owner !== UserManager.userId) { NotificationManager.showNotification("只有群主可以解散群组。", "error"); return; }

        // 广播解散通知
        const dissolveNotification = { type: 'group-dissolved', groupId: groupId, groupName: group.name, sender: UserManager.userId };
        this.broadcastToGroup(groupId, dissolveNotification, [UserManager.userId]);

        // 群主本地清理
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

    /**
     * 向群组成员广播消息。
     * 如果当前用户是群主，直接向所有成员发送。
     * 如果不是群主，将消息发送给群主进行中继。
     * @param {string} groupId - 目标群组的 ID。
     * @param {object} message - 要广播的消息对象。
     * @param {string[]} [excludeIds=[]] - 要排除的用户 ID 列表。
     * @param {boolean} [forceDirect=false] - 是否强制直接发送（即使不是群主）。
     * @returns {boolean} - 操作是否成功。
     */
    broadcastToGroup: function(groupId, message, excludeIds = [], forceDirect = false) {
        const group = this.groups[groupId];
        if (!group) return false;
        message.groupId = groupId;
        message.sender = message.sender || UserManager.userId;
        message.originalSender = message.originalSender || message.sender;
        const originalSenderContact = UserManager.contacts[message.originalSender];
        message.originalSenderName = message.originalSenderName || (originalSenderContact ? originalSenderContact.name : `用户 ${message.originalSender.substring(0,4)}`);

        if (group.owner === UserManager.userId || forceDirect) {
            // 群主直接广播
            group.members.forEach(memberId => {
                if (memberId !== UserManager.userId && !excludeIds.includes(memberId)) {
                    ConnectionManager.sendTo(memberId, { ...message });
                }
            });
        } else {
            // 非群主，发送给群主中继
            if (group.owner !== UserManager.userId && !excludeIds.includes(group.owner)) {
                ConnectionManager.sendTo(group.owner, { ...message, needsRelay: true });
            }
        }
        Utils.log(`正在向群组 ${groupId} 广播，类型: ${message.type}`, Utils.logLevels.DEBUG);
        return true;
    },

    /**
     * 处理接收到的与群组相关的 P2P 消息。
     * @param {object} message - 从数据通道接收到的消息对象。
     * @returns {Promise<void>}
     */
    handleGroupMessage: async function(message) {
        const { groupId, type, sender, originalSender } = message;
        let group = this.groups[groupId];
        Utils.log(`正在处理群组消息: ${groupId}, 类型: ${type}, 来自: ${sender}, 原始发送者: ${originalSender}`, Utils.logLevels.DEBUG);

        if (type === 'group-invite') {
            if (!this.groups[groupId]) { // 如果本地不存在，则创建
                const inviterName = UserManager.contacts[message.invitedBy]?.name || message.invitedBy.substring(0,4);
                this.groups[groupId] = {
                    id: groupId, name: message.groupName, owner: message.owner, members: message.members || [],
                    lastMessage: `您被 ${inviterName} 邀请加入群聊`, lastTime: new Date().toISOString(), unread: 1, leftMembers: []
                };
                group = this.groups[groupId];
                await this.saveGroup(groupId);
                ChatManager.renderChatList(ChatManager.currentFilter);
                NotificationManager.showNotification(`被邀请加入群组: ${message.groupName}`, 'success');
            } else { // 如果已存在，更新成员列表
                group.members = message.members || group.members;
                await this.saveGroup(groupId);
                if (ChatManager.currentChatId === groupId) this.openGroup(groupId);
            }
            return;
        }

        // 确保群组存在才能处理后续消息，除非是针对自己的移除通知
        if (!group) {
            if (type === 'group-removed' && message.removedMemberId === UserManager.userId && message.reason === 'removed_by_owner') {
                // 允许处理自己的移除通知，即使本地群组已不存在
            } else {
                Utils.log(`收到未知或本地已删除群组 ${groupId} 的消息。类型: ${type}。正在忽略。`, Utils.logLevels.WARN);
                return;
            }
        }

        // 如果是群主，处理需要中继的消息
        if (message.needsRelay && group && group.owner === UserManager.userId) {
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
                    if(group.members.includes(UserManager.userId)) {
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
                // 当收到自己被移除的通知时
                if (message.removedMemberId === UserManager.userId && message.reason === 'removed_by_owner') {
                    const groupNameForNotification = message.groupName || (group ? group.name : null) || `群组 ${groupId}`;
                    NotificationManager.showNotification(
                        `您正在被移出群组 "${groupNameForNotification}"。此操作将在 5 秒后生效。`,
                        'info', 6000
                    );
                    const capturedGroupId = groupId;
                    const capturedGroupName = groupNameForNotification;
                    // 延迟 5 秒执行，给用户一个反应时间
                    setTimeout(async () => {
                        const finalGroupName = (this.groups[capturedGroupId] ? this.groups[capturedGroupId].name : null) || capturedGroupName;
                        NotificationManager.showNotification(
                            `您已被移出群组 "${finalGroupName}"。`, 'warning'
                        );
                        // 执行本地清理
                        delete this.groups[capturedGroupId];
                        await DBManager.removeItem('groups', capturedGroupId);
                        await ChatManager.clearChat(capturedGroupId);
                        if (ChatManager.currentChatId === capturedGroupId) {
                            ChatManager.currentChatId = null;
                            if (typeof ChatAreaUIManager !== 'undefined') {
                                ChatAreaUIManager.showNoChatSelected();
                            }
                        }
                        ChatManager.renderChatList(ChatManager.currentFilter);
                    }, 5000);
                }
                break;
            case 'group-dissolved':
                if (group && sender !== UserManager.userId) {
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

    /**
     * 更新群组的最后一条消息预览和未读计数。
     * @param {string} groupId - 目标群组的 ID。
     * @param {string} messageText - 消息预览文本。
     * @param {boolean} [incrementUnread=false] - 是否增加未读计数。
     * @param {boolean} [forceNoUnread=false] - 是否强制将未读计数清零。
     * @returns {Promise<void>}
     */
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

    /**
     * 清除指定群组的未读消息计数。
     * @param {string} groupId - 目标群组的 ID。
     * @returns {Promise<void>}
     */
    clearUnread: async function(groupId) {
        const group = this.groups[groupId];
        if (group && group.unread > 0) {
            group.unread = 0;
            await this.saveGroup(groupId);
            ChatManager.renderChatList(ChatManager.currentFilter);
        }
    },

    /**
     * 格式化群组消息的预览文本。
     * @param {object} message - 消息对象。
     * @returns {string} - 格式化后的预览文本。
     */
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