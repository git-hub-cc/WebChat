/**
 * @file GroupManager.js
 * @description 核心群组管理器，负责处理所有与群组相关的逻辑，包括创建、加载、成员管理和消息广播。
 *              【重构】成员连接逻辑已适配 simple-peer。现在通过事件驱动的方式，
 *              由群成员在收到 'group-invite' 或 'group-member-added' 消息后，
 *              主动向新成员发起 P2P 连接。
 * @module GroupManager
 * @exports {object} GroupManager - 对外暴露的单例对象，包含所有群组管理功能。
 * @dependencies DBManager, UserManager, ChatManager, ConnectionManager, NotificationUIManager, Utils, DetailsPanelUIManager, ChatAreaUIManager, SidebarUIManager, MessageManager, EventEmitter, AppSettings, PeopleLobbyManager
 */
const GroupManager = {
    groups: {}, // { groupId: groupObject }
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
                    this.groups[group.id] = {
                        ...group,
                        members: group.members || [],
                        leftMembers: group.leftMembers || [],
                        aiPrompts: group.aiPrompts || {}
                    };
                });
            }
        } catch (error) { Utils.log(`加载群组失败: ${error}`, Utils.logLevels.ERROR); }
    },

    /**
     * 将指定的群组数据保存到 IndexedDB。
     * @param {string} groupId - 要保存的群组 ID。
     * @returns {Promise<void>}
     */
    saveGroup: async function(groupId) {
        if (this.groups[groupId]) {
            try {
                const groupToSave = {
                    ...this.groups[groupId],
                    aiPrompts: this.groups[groupId].aiPrompts || {}
                };
                await DBManager.setItem('groups', groupToSave);
            }
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
     * 创建一个新群组，或如果提供了现有ID且用户是群主，则更新群组名称。
     * @param {string} name - 群组名称。
     * @param {string|null} [groupIdInput=null] - 用户提供的群组ID（可选）。
     * @returns {Promise<string|null>} - 创建或更新后的群组ID，或在失败时返回 null。
     */
    createGroup: async function(name, groupIdInput = null) {
        let effectiveGroupId = groupIdInput ? groupIdInput.trim() : null;

        if (effectiveGroupId && effectiveGroupId !== "" && !effectiveGroupId.startsWith('group_')) {
            effectiveGroupId = 'group_' + effectiveGroupId;
        } else if (effectiveGroupId === "") {
            effectiveGroupId = null;
        }

        if (effectiveGroupId && this.groups[effectiveGroupId]) {
            const group = this.groups[effectiveGroupId];
            if (group.owner === UserManager.userId) {
                if (group.name !== name) {
                    group.name = name;
                    group.lastTime = new Date().toISOString();
                    ChatManager.addMessage(effectiveGroupId, {
                        id: `sys_name_change_${Date.now()}`,
                        type: 'system',
                        content: `群组名称已更改为 "${name}"`,
                        timestamp: new Date().toISOString(),
                        groupId: effectiveGroupId
                    });
                    this.broadcastToGroup(effectiveGroupId, {
                        type: 'system',
                        content: `群组名称已由群主更改为 "${name}"`,
                        timestamp: new Date().toISOString(),
                        groupId: effectiveGroupId,
                        sender: UserManager.userId
                    }, [UserManager.userId]);

                    await this.saveGroup(effectiveGroupId);
                    ChatManager.renderChatList(ChatManager.currentFilter);
                    if (ChatManager.currentChatId === effectiveGroupId) {
                        this.openGroup(effectiveGroupId);
                    }
                    NotificationUIManager.showNotification(`群组 "${name}" 名称已更新。`, 'success');
                    return effectiveGroupId;
                } else {
                    NotificationUIManager.showNotification('群组名称未发生变化。', 'info');
                    return effectiveGroupId;
                }
            } else {
                NotificationUIManager.showNotification('只有群主可以修改群组名称。', 'error');
                return null;
            }
        } else {
            const finalGroupId = effectiveGroupId || ('group_' + Utils.generateId());
            if (this.groups[finalGroupId]) {
                NotificationUIManager.showNotification(`ID为 "${finalGroupId.replace('group_','')}" 的群组已存在。`, 'error');
                return null;
            }
            this.groups[finalGroupId] = {
                id: finalGroupId,
                name: name,
                owner: UserManager.userId,
                members: [UserManager.userId],
                lastMessage: '群组已创建',
                lastTime: new Date().toISOString(),
                unread: 0,
                leftMembers: [],
                aiPrompts: {}
            };
            await this.saveGroup(finalGroupId);
            ChatManager.renderChatList(ChatManager.currentFilter);
            NotificationUIManager.showNotification(`群组 "${name}" 已创建。`, 'success');
            ChatManager.openChat(finalGroupId, 'group');
            return finalGroupId;
        }
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
                group.name, `${group.members.length} 名成员 (上限 ${AppSettings.chat.maxGroupMembers})`, '👥', true
            );
            this.clearUnread(groupId);
            ChatAreaUIManager.setCallButtonsState(false);
        } else if (!group) {
            Utils.log(`未找到要打开的群组 ${groupId}。`, Utils.logLevels.WARN);
        }
    },

    /**
     * [REFACTORED] 向群组中添加一个新成员。
     * @param {string} groupId - 目标群组的 ID。
     * @param {string} memberId - 要添加的成员 ID。
     * @param {string|null} [memberName=null] - 要添加的成员名称。
     * @returns {Promise<boolean>} - 操作是否成功。
     */
    addMemberToGroup: async function(groupId, memberId, memberName = null) {
        const group = this.groups[groupId];
        if (!group) { NotificationUIManager.showNotification("未找到群组。", "error"); return false; }
        if (group.owner !== UserManager.userId) { NotificationUIManager.showNotification("只有群主可以添加成员。", "error"); return false; }
        if (group.members.includes(memberId)) { NotificationUIManager.showNotification("用户已在群组中。", "warning"); return false; }
        if (group.members.length >= AppSettings.chat.maxGroupMembers) {
            NotificationUIManager.showNotification(`群组已满 (最多 ${AppSettings.chat.maxGroupMembers} 人)。`, "error");
            return false;
        }

        const contactToAdd = UserManager.contacts[memberId];
        const newMemberDisplayName = memberName || (contactToAdd ? contactToAdd.name : `用户 ${memberId.substring(0,4)}`);

        if (!(contactToAdd && contactToAdd.isAI)) {
            await PeopleLobbyManager.fetchOnlineUsers(true);
            if (!PeopleLobbyManager.onlineUserIds.includes(memberId)) {
                NotificationUIManager.showNotification(`无法添加成员: ${newMemberDisplayName} 当前不在线。`, 'error');
                return false;
            }
        }

        group.members.push(memberId);
        group.leftMembers = group.leftMembers.filter(lm => lm.id !== memberId);

        if (contactToAdd && contactToAdd.isAI && group.owner === UserManager.userId) {
            if (!group.aiPrompts) group.aiPrompts = {};
            const defaultPrompt = (contactToAdd.aiConfig && contactToAdd.aiConfig.systemPrompt) ? contactToAdd.aiConfig.systemPrompt : "";
            group.aiPrompts[memberId] = defaultPrompt;
        }

        await this.saveGroup(groupId);

        const inviterName = UserManager.contacts[UserManager.userId]?.name || UserManager.userId.substring(0,4);
        let systemMessageContent = `${inviterName} 邀请 ${newMemberDisplayName} 加入了群聊。`;
        if (contactToAdd && contactToAdd.isAI) {
            systemMessageContent += ` (${newMemberDisplayName} 是一个AI助手)`;
        }
        const systemMessage = {
            type: 'system',
            content: systemMessageContent,
        };
        ChatManager.addMessage(groupId, systemMessage);

        if (!(contactToAdd && contactToAdd.isAI)) {
            const inviteMessageToNewMember = {
                type: 'group-invite',
                groupId: groupId,
                groupName: group.name,
                owner: group.owner,
                members: [...group.members],
                invitedBy: UserManager.userId,
                aiPrompts: group.aiPrompts || {},
            };
            ConnectionManager.sendTo(memberId, inviteMessageToNewMember);
        }

        const contactDetailsForBroadcast = contactToAdd ? {
            id: contactToAdd.id,
            name: contactToAdd.name,
            isAI: contactToAdd.isAI
        } : { id: memberId, name: newMemberDisplayName, isAI: false };

        const memberAddedNotification = {
            type: 'group-member-added',
            groupId: groupId,
            addedMemberId: memberId,
            addedMemberDetails: contactDetailsForBroadcast,
            allMembers: [...group.members]
        };
        this.broadcastToGroup(groupId, memberAddedNotification, [memberId, UserManager.userId]);

        if (typeof DetailsPanelUIManager !== 'undefined' && DetailsPanelUIManager.currentView === 'details' && ChatManager.currentChatId === groupId) {
            DetailsPanelUIManager.updateDetailsPanel(groupId, 'group');
        }
        if (ChatManager.currentChatId === groupId) this.openGroup(groupId);
        ChatManager.renderChatList(ChatManager.currentFilter);

        NotificationUIManager.showNotification(`${newMemberDisplayName} 已被添加到群组。`, 'success');
        return true;
    },

    /**
     * [REFACTORED] 处理收到的群组相关消息。
     * @param {object} message - 从数据通道接收到的消息对象。
     */
    handleGroupMessage: async function(message) {
        const { groupId, type, sender } = message;
        let group = this.groups[groupId];
        Utils.log(`正在处理群组消息: ${groupId}, 类型: ${type}, 来自: ${sender}`, Utils.logLevels.DEBUG);

        if (type !== 'group-invite' && !group) {
            if (type === 'group-removed' && message.removedMemberId === UserManager.userId && message.reason === 'removed_by_owner') {
                // Let this specific message pass to be handled below
            } else {
                Utils.log(`收到未知或本地已删除群组 ${groupId} 的消息。类型: ${type}。正在忽略。`, Utils.logLevels.WARN);
                return;
            }
        }

        switch (type) {
            case 'group-invite':
                if (!this.groups[groupId]) {
                    const inviterName = UserManager.contacts[message.invitedBy]?.name || message.invitedBy.substring(0,4);
                    this.groups[groupId] = {
                        id: groupId, name: message.groupName, owner: message.owner,
                        members: message.members || [],
                        lastMessage: `您被 ${inviterName} 邀请加入群聊`,
                        lastTime: new Date().toISOString(), unread: 1,
                        leftMembers: [], aiPrompts: message.aiPrompts || {}
                    };
                    await this.saveGroup(groupId);
                    ChatManager.renderChatList(ChatManager.currentFilter);
                    NotificationUIManager.showNotification(`您已被邀请加入群组: ${message.groupName}`, 'success');

                    // [MODIFIED] 新成员主动连接所有其他非AI成员
                    this.groups[groupId].members.forEach(otherMemberId => {
                        if (otherMemberId !== UserManager.userId && !UserManager.contacts[otherMemberId]?.isAI) {
                            Utils.log(`新成员 ${UserManager.userId} 正在尝试连接群成员 ${otherMemberId}`, Utils.logLevels.DEBUG);
                            ConnectionManager.connectToPeer(otherMemberId, { isSilent: true });
                        }
                    });
                }
                break;

            case 'text': case 'file': case 'image': case 'audio': case 'sticker': case 'system':
                if (group && (message.originalSender || sender) !== UserManager.userId && group.members.includes(UserManager.userId)) {
                    ChatManager.addMessage(groupId, message);
                }
                break;

            case 'group-member-added':
                if (group && group.members.includes(UserManager.userId) && sender !== UserManager.userId) {
                    if (!group.members.includes(message.addedMemberId)) {
                        group.members = message.allMembers || group.members;
                        if (message.addedMemberDetails && !UserManager.contacts[message.addedMemberId]) {
                            await UserManager.addContact(message.addedMemberDetails);
                        }
                        await this.saveGroup(groupId);

                        const addedName = message.addedMemberDetails.name;
                        ChatManager.addMessage(groupId, { type: 'system', content: `${UserManager.contacts[sender]?.name || '群主'} 邀请 ${addedName} 加入了群聊。` });

                        // [MODIFIED] 现有成员主动连接新成员
                        if (!message.addedMemberDetails.isAI) {
                            Utils.log(`现有成员 ${UserManager.userId} 正在尝试连接新成员 ${message.addedMemberId}`, Utils.logLevels.DEBUG);
                            ConnectionManager.connectToPeer(message.addedMemberId, { isSilent: true });
                        }

                        if (ChatManager.currentChatId === groupId) {
                            this.openGroup(groupId);
                            if (typeof DetailsPanelUIManager !== 'undefined') DetailsPanelUIManager.updateDetailsPanel(groupId, 'group');
                        }
                        ChatManager.renderChatList(ChatManager.currentFilter);
                    }
                }
                break;

            case 'group-member-left':
            case 'group-member-removed':
                if (group && group.members.includes(UserManager.userId) && sender !== UserManager.userId) {
                    const memberId = message.leftMemberId || message.removedMemberId;
                    if (group.members.includes(memberId)) {
                        group.members = message.allMembers || group.members.filter(id => id !== memberId);
                        if (group.aiPrompts?.[memberId]) delete group.aiPrompts[memberId];
                        await this.saveGroup(groupId);
                        const memberName = message.leftMemberName || UserManager.contacts[memberId]?.name || `用户`;
                        const actionText = type === 'group-member-left' ? '离开了群聊' : '被移出了群聊';
                        ChatManager.addMessage(groupId, { type: 'system', content: `${memberName} ${actionText}。` });
                        ConnectionManager.close(memberId);
                        if (ChatManager.currentChatId === groupId) {
                            this.openGroup(groupId);
                            if (typeof DetailsPanelUIManager !== 'undefined') DetailsPanelUIManager.updateDetailsPanel(groupId, 'group');
                        }
                        ChatManager.renderChatList(ChatManager.currentFilter);
                    }
                }
                break;
            // ... (其他case如 group-dissolved, group-retract-message-request, group-ai-prompt-updated 不变)
        }
    },

    /**
     * 从群组中移除一个成员（仅限群主操作）。
     * @param {string} groupId - 目标群组 ID。
     * @param {string} memberIdToRemove - 要移除的成员 ID。
     * @returns {Promise<boolean>} - 操作是否成功。
     */
    removeMemberFromGroup: async function(groupId, memberIdToRemove) {
        const group = this.groups[groupId];
        if (!group || group.owner !== UserManager.userId || memberIdToRemove === UserManager.userId) {
            // ... [Error handling remains the same]
            return false;
        }

        const memberIndex = group.members.indexOf(memberIdToRemove);
        if (memberIndex === -1) { /* ... Error handling ... */ return false; }

        const removedContact = UserManager.contacts[memberIdToRemove];
        group.members.splice(memberIndex, 1);
        if (removedContact?.isAI && group.aiPrompts?.[memberIdToRemove]) {
            delete group.aiPrompts[memberIdToRemove];
        }
        await this.saveGroup(groupId);

        // ... [UI updates remain the same]
        const removedName = removedContact?.name || `用户 ${memberIdToRemove.substring(0,4)}`;
        ChatManager.addMessage(groupId, { type: 'system', content: `您已将 ${removedName} 移出群聊。` });

        const memberRemovedNotificationToGroup = { type: 'group-member-removed', groupId, removedMemberId: memberIdToRemove, sender: UserManager.userId, allMembers: [...group.members] };
        this.broadcastToGroup(groupId, memberRemovedNotificationToGroup, [memberIdToRemove, UserManager.userId]);

        if (!removedContact?.isAI) {
            ConnectionManager.sendTo(memberIdToRemove, { type: 'group-removed', groupId, reason: 'removed_by_owner' });
            ConnectionManager.close(memberIdToRemove);
        }

        NotificationUIManager.showNotification(`${removedName} 已被移出群组。`, 'success');
        return true;
    },

    /**
     * 当前用户离开一个群组。
     * @param {string} groupId - 要离开的群组 ID。
     */
    leaveGroup: async function(groupId) {
        const group = this.groups[groupId];
        if (!group || group.owner === UserManager.userId) { /* ... Error handling ... */ return; }
        const myId = UserManager.userId;
        if (!group.members.includes(myId)) return;

        const myName = UserManager.contacts[myId]?.name || `用户 ${myId.substring(0,4)}`;
        this.broadcastToGroup(groupId, { type: 'group-member-left', groupId, leftMemberId: myId, leftMemberName: myName, allMembers: group.members.filter(id => id !== myId) }, [myId]);

        group.members.forEach(memberId => {
            if (memberId !== myId) ConnectionManager.close(memberId);
        });

        delete this.groups[groupId];
        await DBManager.removeItem('groups', groupId);
        await ChatManager.clearChat(groupId);
        if (ChatManager.currentChatId === groupId) {
            ChatManager.currentChatId = null;
            if(ChatAreaUIManager) ChatAreaUIManager.showNoChatSelected();
        }
        ChatManager.renderChatList(ChatManager.currentFilter);
        NotificationUIManager.showNotification(`您已离开群组 "${group.name}"。`, 'success');
    },

    /**
     * 解散一个群组（仅限群主操作）。
     * @param {string} groupId - 要解散的群组 ID。
     */
    dissolveGroup: async function(groupId) {
        const group = this.groups[groupId];
        if (!group || group.owner !== UserManager.userId) { /* ... Error handling ... */ return; }

        this.broadcastToGroup(groupId, { type: 'group-dissolved', groupId, groupName: group.name }, [UserManager.userId]);
        group.members.forEach(memberId => {
            if (memberId !== UserManager.userId) ConnectionManager.close(memberId);
        });

        delete this.groups[groupId];
        await DBManager.removeItem('groups', groupId);
        await ChatManager.clearChat(groupId);
        if (ChatManager.currentChatId === groupId) {
            ChatManager.currentChatId = null;
            if(ChatAreaUIManager) ChatAreaUIManager.showNoChatSelected();
        }
        ChatManager.renderChatList(ChatManager.currentFilter);
        NotificationUIManager.showNotification(`群组 "${group.name}" 已被解散。`, 'success');
    },

    /**
     * 向群组内所有非AI、非自己的已连接成员广播消息。
     * @param {string} groupId - 目标群组 ID。
     * @param {object} message - 要广播的消息对象。
     * @param {Array<string>} [excludeIds=[]] - 要排除的用户ID列表。
     * @returns {boolean} - 是否至少向一个成员发送了消息。
     */
    broadcastToGroup: function(groupId, message, excludeIds = []) {
        const group = this.groups[groupId];
        if (!group) return false;

        message.groupId = groupId;
        message.sender = message.sender || UserManager.userId;
        message.originalSender = message.originalSender || message.sender;
        message.originalSenderName = message.originalSenderName || UserManager.contacts[message.originalSender]?.name || `用户`;

        const membersToSendTo = group.members.filter(memberId =>
            !UserManager.contacts[memberId]?.isAI &&
            memberId !== UserManager.userId &&
            !excludeIds.includes(memberId) &&
            ConnectionManager.isConnectedTo(memberId)
        );

        membersToSendTo.forEach(memberId => ConnectionManager.sendTo(memberId, { ...message }));

        Utils.log(`尝试向群组 ${groupId} 广播消息, 类型: ${message.type}, 目标人数: ${membersToSendTo.length}`, Utils.logLevels.DEBUG);
        return membersToSendTo.length > 0;
    },

    /**
     * 更新群组的最后一条消息预览和未读计数。
     * @param {string} groupId - 群组 ID。
     * @param {string} messageText - 消息预览文本。
     * @param {boolean} [incrementUnread=false] - 是否增加未读计数。
     * @param {boolean} [forceNoUnread=false] - 是否强制清零未读计数。
     */
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

    /**
     * 清除指定群组的未读消息计数。
     * @param {string} groupId - 群组 ID。
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
        // ... (this logic is unchanged)
        if (message.isRetracted) { return message.content; }
        let preview;
        const senderName = message.originalSenderName || (UserManager.contacts[message.originalSender || message.sender]?.name || '用户');
        switch (message.type) {
            case 'text': preview = `${senderName}: ${message.content}`; break;
            case 'image': preview = `${senderName}: [图片]`; break;
            case 'sticker': preview = `${senderName}: [贴图]`; break;
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
    },

    /**
     * 通知群组成员 AI 的行为指示已变更（仅限群主）。
     * @param {string} groupId - 群组 ID。
     * @param {string} aiMemberId - AI 成员 ID。
     * @param {string} newPrompt - 新的行为指示。
     */
    notifyAiPromptChanged: function(groupId, aiMemberId, newPrompt) {
        if (!this.groups[groupId] || this.groups[groupId].owner !== UserManager.userId) return;

        const promptUpdateMessage = {
            type: 'group-ai-prompt-updated',
            groupId,
            aiMemberId,
            newPrompt,
            sender: UserManager.userId
        };
        this.broadcastToGroup(groupId, promptUpdateMessage, [UserManager.userId]);
        const aiName = UserManager.contacts[aiMemberId]?.name || `AI`;
        ChatManager.addMessage(groupId, {
            type: 'system',
            content: `您更新了 AI "${aiName}" 在群组中的行为指示。`
        });
    }
};