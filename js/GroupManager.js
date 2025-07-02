/**
 * @file GroupManager.js
 * @description 核心群组管理器，负责处理所有与群组相关的逻辑，包括创建、加载、成员管理和消息广播。
 *              群组邀请现在要求对方在线。当群成员发生变更时，会通知所有相关群成员。
 * @module GroupManager
 * @exports {object} GroupManager - 对外暴露的单例对象，包含所有群组管理功能。
 * @dependencies DBManager, UserManager, ChatManager, ConnectionManager, NotificationUIManager, Utils, DetailsPanelUIManager, ChatAreaUIManager, SidebarUIManager, MessageManager, EventEmitter, AppSettings
 */
const GroupManager = {
    groups: {}, // { groupId: groupObject }
    currentGroupId: null, // 当前打开的群组ID
    // 移除本地常量 MAX_GROUP_MEMBERS

    /**
     * 初始化群组管理器，从数据库加载所有群组数据。
     * @returns {Promise<void>}
     */
    init: async function() {
        await this.loadGroups();
    },

    // ... (loadGroups, saveGroup, renderGroupListForSidebar, createGroup 不变) ...
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

    renderGroupListForSidebar: function() {
        ChatManager.currentFilter = 'groups';
        if (typeof SidebarUIManager !== 'undefined') SidebarUIManager.setActiveTab('groups');
        ChatManager.renderChatList('groups');
    },

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
            // 使用 AppSettings 中的常量
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
     * 向群组中添加一个新成员。
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

        // 使用 AppSettings 中的常量
        if (group.members.length >= AppSettings.chat.maxGroupMembers) {
            NotificationUIManager.showNotification(`群组已满 (最多 ${AppSettings.chat.maxGroupMembers} 人)。`, "error");
            return false;
        }

        const contactToAdd = UserManager.contacts[memberId];
        const newMemberDisplayName = memberName || (contactToAdd ? contactToAdd.name : `用户 ${memberId.substring(0,4)}`);

        if (!(contactToAdd && contactToAdd.isAI) && !ConnectionManager.isConnectedTo(memberId)) {
            NotificationUIManager.showNotification(`无法添加成员: ${newMemberDisplayName} 当前不在线或未连接。`, 'error');
            return false;
        }

        group.members.push(memberId);
        group.leftMembers = group.leftMembers.filter(lm => lm.id !== memberId);

        if (contactToAdd && contactToAdd.isAI && group.owner === UserManager.userId) {
            if (!group.aiPrompts) {
                group.aiPrompts = {};
            }
            const defaultPrompt = (contactToAdd.aiConfig && contactToAdd.aiConfig.systemPrompt) ? contactToAdd.aiConfig.systemPrompt : "";
            group.aiPrompts[memberId] = defaultPrompt;
            Utils.log(`GroupManager: 已为 AI 成员 ${memberId} 在群组 ${groupId} 中设置初始提示词。`, Utils.logLevels.DEBUG);
        }

        await this.saveGroup(groupId);

        const inviterName = UserManager.contacts[UserManager.userId]?.name || UserManager.userId.substring(0,4);
        let systemMessageContent = `${inviterName} 邀请 ${newMemberDisplayName} 加入了群聊。`;
        if (contactToAdd && contactToAdd.isAI) {
            systemMessageContent += ` (${newMemberDisplayName} 是一个AI助手)`;
        }
        const systemMessage = {
            id: `sys_add_${memberId}_${Date.now()}`,
            type: 'user',
            content: systemMessageContent,
            timestamp: new Date().toISOString(),
            groupId: groupId
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
                sender: UserManager.userId,
                aiPrompts: group.aiPrompts || {},
                lastMessage: group.lastMessage,
                lastTime: group.lastTime
            };
            ConnectionManager.sendTo(memberId, inviteMessageToNewMember);
        }

        const contactDetailsForBroadcast = contactToAdd ? {
            id: contactToAdd.id,
            name: contactToAdd.name,
            isAI: contactToAdd.isAI,
            avatarText: contactToAdd.avatarText,
            avatarUrl: contactToAdd.avatarUrl,
            aiConfig: contactToAdd.aiConfig ? {
                systemPrompt: contactToAdd.aiConfig.systemPrompt,
                tts: contactToAdd.aiConfig.tts || { tts_mode: 'Preset', version: 'v4' }
            } : { tts: { tts_mode: 'Preset', version: 'v4' } }
        } : { id: memberId, name: newMemberDisplayName, isAI: false, aiConfig: {tts: { tts_mode: 'Preset', version: 'v4' }} };

        const memberAddedNotification = {
            type: 'group-member-added',
            groupId: groupId,
            addedMemberId: memberId,
            addedMemberDetails: contactDetailsForBroadcast,
            groupAiPrompt: (contactToAdd && contactToAdd.isAI && group.aiPrompts) ? group.aiPrompts[memberId] : undefined,
            sender: UserManager.userId,
            allMembers: [...group.members]
        };
        this.broadcastToGroup(groupId, memberAddedNotification, [memberId, UserManager.userId]);

        if (typeof DetailsPanelUIManager !== 'undefined' &&
            DetailsPanelUIManager.currentView === 'details' &&
            ChatManager.currentChatId === groupId) {
            DetailsPanelUIManager.updateDetailsPanelMembers(groupId);
            if (contactToAdd && contactToAdd.isAI && group.owner === UserManager.userId) {
                DetailsPanelUIManager._updateForGroup(groupId);
            }
        }
        if (ChatManager.currentChatId === groupId) this.openGroup(groupId);
        ChatManager.renderChatList(ChatManager.currentFilter);

        NotificationUIManager.showNotification(`${newMemberDisplayName} 已被添加到群组。`, 'success');
        return true;
    },

    // ... (其他方法保持不变) ...
    removeMemberFromGroup: async function(groupId, memberIdToRemove) {
        const group = this.groups[groupId];
        if (!group) { NotificationUIManager.showNotification("未找到群组。", "error"); return false; }
        if (group.owner !== UserManager.userId) { NotificationUIManager.showNotification("只有群主可以移除成员。", "error"); return false; }
        if (memberIdToRemove === UserManager.userId) { NotificationUIManager.showNotification("群主无法移除自己。请选择解散群组。", "warning"); return false; }
        const memberIndex = group.members.indexOf(memberIdToRemove);
        if (memberIndex === -1) { NotificationUIManager.showNotification("用户不在群组中。", "warning"); return false; }

        const removedContact = UserManager.contacts[memberIdToRemove];
        group.members.splice(memberIndex, 1);
        if (removedContact && removedContact.isAI && group.aiPrompts && group.aiPrompts[memberIdToRemove]) {
            delete group.aiPrompts[memberIdToRemove];
            Utils.log(`GroupManager: 已从群组 ${groupId} 的特定提示词中移除 AI ${memberIdToRemove}。`, Utils.logLevels.DEBUG);
        }

        await this.saveGroup(groupId);

        if (typeof DetailsPanelUIManager !== 'undefined' && DetailsPanelUIManager.currentView === 'details' && ChatManager.currentChatId === groupId) {
            DetailsPanelUIManager.updateDetailsPanelMembers(groupId);
            if (removedContact && removedContact.isAI && group.owner === UserManager.userId) {
                DetailsPanelUIManager._updateForGroup(groupId);
            }
        }
        if (ChatManager.currentChatId === groupId) this.openGroup(groupId);

        const removerName = UserManager.contacts[UserManager.userId]?.name || UserManager.userId.substring(0,4);
        const removedName = removedContact?.name || `用户 ${memberIdToRemove.substring(0,4)}`;
        const systemMessage = { id: `sys_remove_${memberIdToRemove}_${Date.now()}`, type: 'system', content: `${removerName} 已将 ${removedName} 移出群聊。`, timestamp: new Date().toISOString(), groupId: groupId };
        ChatManager.addMessage(groupId, systemMessage);

        const memberRemovedNotificationToGroup = {
            type: 'group-member-removed',
            groupId: groupId,
            removedMemberId: memberIdToRemove,
            sender: UserManager.userId,
            allMembers: [...group.members]
        };
        this.broadcastToGroup(groupId, memberRemovedNotificationToGroup, [memberIdToRemove, UserManager.userId]);

        if (!(removedContact && removedContact.isAI)) {
            const removalNotificationToRemovedUser = { type: 'group-removed', groupId: groupId, groupName: group.name, reason: 'removed_by_owner', sender: UserManager.userId, removedMemberId: memberIdToRemove };
            ConnectionManager.sendTo(memberIdToRemove, removalNotificationToRemovedUser);
            ConnectionManager.close(memberIdToRemove);
        }

        NotificationUIManager.showNotification(`${removedName} 已被移出群组。`, 'success');
        ChatManager.renderChatList(ChatManager.currentFilter);
        return true;
    },

    leaveGroup: async function(groupId) {
        const group = this.groups[groupId];
        if (!group) { NotificationUIManager.showNotification("未找到群组。", "error"); return; }
        if (group.owner === UserManager.userId) { NotificationUIManager.showNotification("群主不能离开。请选择解散群组。", "warning"); return; }
        const myId = UserManager.userId;
        if (!group.members.includes(myId)) return;

        const myName = UserManager.contacts[myId]?.name || `用户 ${myId.substring(0,4)}`;
        const leaveMessage = {
            type: 'group-member-left',
            groupId: groupId,
            leftMemberId: myId,
            leftMemberName: myName,
            sender: myId,
            allMembers: group.members.filter(id => id !== myId)
        };
        this.broadcastToGroup(groupId, leaveMessage, [myId]);

        group.members.forEach(memberId => {
            if (memberId !== myId) {
                ConnectionManager.close(memberId);
            }
        });

        delete this.groups[groupId];
        await DBManager.removeItem('groups', groupId);
        await ChatManager.clearChat(groupId);
        if (ChatManager.currentChatId === groupId) {
            ChatManager.currentChatId = null;
            if (typeof ChatAreaUIManager !== 'undefined') ChatAreaUIManager.showNoChatSelected();
        }
        ChatManager.renderChatList(ChatManager.currentFilter);
        NotificationUIManager.showNotification(`您已离开群组 "${group.name}"。`, 'success');
    },

    dissolveGroup: async function(groupId) {
        const group = this.groups[groupId];
        if (!group) return;
        if (group.owner !== UserManager.userId) { NotificationUIManager.showNotification("只有群主可以解散群组。", "error"); return; }

        const dissolveNotification = { type: 'group-dissolved', groupId: groupId, groupName: group.name, sender: UserManager.userId };
        this.broadcastToGroup(groupId, dissolveNotification, [UserManager.userId]);

        group.members.forEach(memberId => {
            if (memberId !== UserManager.userId) {
                ConnectionManager.close(memberId);
            }
        });

        delete this.groups[groupId];
        await DBManager.removeItem('groups', groupId);
        await ChatManager.clearChat(groupId);
        if (ChatManager.currentChatId === groupId) {
            ChatManager.currentChatId = null;
            if (typeof ChatAreaUIManager !== 'undefined') ChatAreaUIManager.showNoChatSelected();
        }
        ChatManager.renderChatList(ChatManager.currentFilter);
        NotificationUIManager.showNotification(`群组 "${group.name}" 已被解散。`, 'success');
    },

    broadcastToGroup: function(groupId, message, excludeIds = []) {
        const group = this.groups[groupId];
        if (!group) {
            Utils.log(`broadcastToGroup: 群组 ${groupId} 未找到。`, Utils.logLevels.WARN);
            return false;
        }
        message.groupId = groupId;
        message.sender = message.sender || UserManager.userId;
        message.originalSender = message.originalSender || message.sender;
        const originalSenderContact = UserManager.contacts[message.originalSender];
        message.originalSenderName = message.originalSenderName || (originalSenderContact ? originalSenderContact.name : `用户 ${String(message.originalSender).substring(0,4)}`);

        if (message.type === 'group-invite' || message.type === 'group-member-added' || message.type === 'group-ai-prompt-updated') {
            message.aiPrompts = group.aiPrompts || {};
        }
        if (['group-invite', 'group-member-added', 'group-member-removed', 'group-member-left'].includes(message.type)) {
            if (!message.allMembers) message.allMembers = [...group.members];
        }

        const membersToSendTo = group.members.filter(memberId => {
            const memberContact = UserManager.contacts[memberId];
            return !(memberContact && memberContact.isAI) &&
                memberId !== UserManager.userId &&
                !excludeIds.includes(memberId);
        });

        membersToSendTo.forEach(memberId => {
            if (ConnectionManager.isConnectedTo(memberId)) {
                ConnectionManager.sendTo(memberId, { ...message });
            } else {
                Utils.log(`broadcastToGroup: 与 ${memberId} 在群组 ${groupId} 中没有活动连接。消息未发送。`, Utils.logLevels.WARN);
            }
        });
        Utils.log(`尝试向群组 ${groupId} 发送消息 (人类成员), 类型: ${message.type}, 排除: ${excludeIds.join(',')}, 目标人数: ${membersToSendTo.length}`, Utils.logLevels.DEBUG);
        return true;
    },

    handleGroupMessage: async function(message) {
        const { groupId, type, sender, originalSender } = message;
        let group = this.groups[groupId];
        Utils.log(`正在处理群组消息: ${groupId}, 类型: ${type}, 来自: ${sender}, 原始发送者: ${originalSender}`, Utils.logLevels.DEBUG);

        if (type !== 'group-invite' && !group) {
            if (type === 'group-removed' && message.removedMemberId === UserManager.userId && message.reason === 'removed_by_owner') {
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
                        lastMessage: message.lastMessage || `您被 ${inviterName} 邀请加入群聊`,
                        lastTime: message.lastTime || new Date().toISOString(),
                        unread: 1,
                        leftMembers: message.leftMembers || [],
                        aiPrompts: message.aiPrompts || {}
                    };
                    await this.saveGroup(groupId);
                    ChatManager.renderChatList(ChatManager.currentFilter);
                    NotificationUIManager.showNotification(`您已被 ${inviterName} 邀请加入群组: ${message.groupName}`, 'success');

                    const myId = UserManager.userId;
                    if (this.groups[groupId].members.includes(myId)) {
                        this.groups[groupId].members.forEach(otherMemberId => {
                            if (otherMemberId !== myId && !(UserManager.contacts[otherMemberId] && UserManager.contacts[otherMemberId].isAI)) {
                                Utils.log(`新成员 ${myId} 尝试连接群成员 ${otherMemberId}`, Utils.logLevels.DEBUG);
                                ConnectionManager.createOffer(otherMemberId, { isSilent: true });
                            }
                        });
                    }
                } else {
                    group.members = message.members || group.members;
                    group.aiPrompts = message.aiPrompts || group.aiPrompts || {};
                    if (message.lastTime && (!group.lastTime || new Date(message.lastTime) > new Date(group.lastTime))) {
                        group.lastMessage = message.lastMessage || group.lastMessage;
                        group.lastTime = message.lastTime;
                    }
                    await this.saveGroup(groupId);
                    if (ChatManager.currentChatId === groupId) this.openGroup(groupId);
                    ChatManager.renderChatList(ChatManager.currentFilter);
                }
                break;
            case 'text': case 'file': case 'image': case 'audio': case 'system':
                if (group && (originalSender || sender) !== UserManager.userId && group.members.includes(UserManager.userId)) {
                    ChatManager.addMessage(groupId, message);
                }
                break;
            case 'group-member-left':
                if (group && group.members.includes(message.leftMemberId)) {
                    group.members = group.members.filter(id => id !== message.leftMemberId);
                    const leftMemberName = message.leftMemberName || `用户 ${String(message.leftMemberId).substring(0,4)}`;
                    if (group.owner === UserManager.userId) {
                        if(!group.leftMembers) group.leftMembers = [];
                        if(!group.leftMembers.find(lm => lm.id === message.leftMemberId)) {
                            group.leftMembers.push({ id: message.leftMemberId, name: leftMemberName, leftTime: new Date().toISOString() });
                        }
                        if (group.aiPrompts && group.aiPrompts[message.leftMemberId]) {
                            delete group.aiPrompts[message.leftMemberId];
                        }
                    }
                    await this.saveGroup(groupId);
                    if(group.members.includes(UserManager.userId)) {
                        ChatManager.addMessage(groupId, { id: `sys_left_${message.leftMemberId}_${Date.now()}`, type: 'system', content: `${leftMemberName} 离开了群聊。`, groupId: groupId, timestamp: new Date().toISOString()});
                        ConnectionManager.close(message.leftMemberId);
                    }
                    if (ChatManager.currentChatId === groupId) {
                        this.openGroup(groupId);
                        if (typeof DetailsPanelUIManager !== 'undefined') DetailsPanelUIManager.updateDetailsPanelMembers(groupId);
                    }
                    ChatManager.renderChatList(ChatManager.currentFilter);
                }
                break;
            case 'group-removed':
                if (message.removedMemberId === UserManager.userId && message.reason === 'removed_by_owner') {
                    const groupNameForNotification = message.groupName || (group ? group.name : null) || `群组 ${groupId}`;
                    NotificationUIManager.showNotification(
                        `您正在被移出群组 "${groupNameForNotification}"。此操作将在 5 秒后生效。`, 'info', 6000
                    );
                    const capturedGroupId = groupId;
                    const capturedGroupName = groupNameForNotification;
                    setTimeout(async () => {
                        const finalGroupName = (this.groups[capturedGroupId] ? this.groups[capturedGroupId].name : null) || capturedGroupName;
                        NotificationUIManager.showNotification(
                            `您已被移出群组 "${finalGroupName}"。`, 'warning'
                        );
                        if (this.groups[capturedGroupId]) {
                            this.groups[capturedGroupId].members.forEach(memberId => {
                                if (memberId !== UserManager.userId) ConnectionManager.close(memberId);
                            });
                        }
                        delete this.groups[capturedGroupId];
                        await DBManager.removeItem('groups', capturedGroupId);
                        await ChatManager.clearChat(capturedGroupId);
                        if (ChatManager.currentChatId === capturedGroupId) {
                            ChatManager.currentChatId = null;
                            if (typeof ChatAreaUIManager !== 'undefined') ChatAreaUIManager.showNoChatSelected();
                        }
                        ChatManager.renderChatList(ChatManager.currentFilter);
                    }, 5000);
                }
                break;
            case 'group-dissolved':
                if (group && sender !== UserManager.userId) {
                    NotificationUIManager.showNotification(`群组 "${group.name}" 已被群主解散。`, 'warning');
                    group.members.forEach(memberId => {
                        if (memberId !== UserManager.userId) ConnectionManager.close(memberId);
                    });
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
            case 'group-retract-message-request':
                if (group && group.members.includes(UserManager.userId)) {
                    const retractedByName = message.originalSenderName || UserManager.contacts[message.originalSender]?.name || `用户 ${String(message.originalSender).substring(0,4)}`;
                    MessageManager._updateMessageToRetractedState(
                        message.originalMessageId, groupId,
                        false,
                        retractedByName
                    );
                }
                break;
            case 'group-member-added':
                if (group && group.members.includes(UserManager.userId) && message.sender !== UserManager.userId) {
                    if (!group.members.includes(message.addedMemberId)) {
                        group.members = message.allMembers || group.members;

                        if (message.addedMemberDetails && !UserManager.contacts[message.addedMemberId]) {
                            const contactData = { ...message.addedMemberDetails };
                            if (!contactData.aiConfig) contactData.aiConfig = { tts: { tts_mode: 'Preset', version: 'v4' } };
                            else if (!contactData.aiConfig.tts) contactData.aiConfig.tts = { tts_mode: 'Preset', version: 'v4' };
                            else {
                                if(contactData.aiConfig.tts.tts_mode === undefined) contactData.aiConfig.tts.tts_mode = 'Preset';
                                if(contactData.aiConfig.tts.version === undefined) contactData.aiConfig.tts.version = 'v4';
                            }
                            UserManager.contacts[message.addedMemberId] = contactData;
                            await UserManager.saveContact(message.addedMemberId);
                        }

                        if (message.addedMemberDetails && message.addedMemberDetails.isAI && message.groupAiPrompt !== undefined) {
                            if (!group.aiPrompts) group.aiPrompts = {};
                            group.aiPrompts[message.addedMemberId] = message.groupAiPrompt;
                        }
                        await this.saveGroup(groupId);

                        const addedContactName = UserManager.contacts[message.addedMemberId]?.name || `用户 ${message.addedMemberId.substring(0,4)}`;
                        const inviterName = UserManager.contacts[message.sender]?.name || `用户 ${message.sender.substring(0,4)}`;
                        let systemContent = `${inviterName} 邀请 ${addedContactName} 加入了群聊。`;
                        if(UserManager.contacts[message.addedMemberId]?.isAI) systemContent += ` (${addedContactName} 是一个AI助手)`;

                        ChatManager.addMessage(groupId, {
                            id: `sys_added_${message.addedMemberId}_${Date.now()}`,
                            type: 'user',
                            content: systemContent,
                            timestamp: new Date().toISOString(),
                            groupId: groupId
                        });

                        if (!(UserManager.contacts[message.addedMemberId] && UserManager.contacts[message.addedMemberId].isAI)) {
                            ConnectionManager.createOffer(message.addedMemberId, { isSilent: true });
                        }

                        if (ChatManager.currentChatId === groupId) {
                            this.openGroup(groupId);
                            if (typeof DetailsPanelUIManager !== 'undefined') DetailsPanelUIManager.updateDetailsPanelMembers(groupId);
                        }
                        ChatManager.renderChatList(ChatManager.currentFilter);
                    }
                }
                break;
            case 'group-member-removed':
                if (group && group.members.includes(UserManager.userId) && message.sender !== UserManager.userId) {
                    if (group.members.includes(message.removedMemberId)) {
                        group.members = message.allMembers || group.members.filter(id => id !== message.removedMemberId);
                        if (group.aiPrompts && group.aiPrompts[message.removedMemberId]) {
                            delete group.aiPrompts[message.removedMemberId];
                        }
                        await this.saveGroup(groupId);

                        const removedContactName = UserManager.contacts[message.removedMemberId]?.name || `用户 ${message.removedMemberId.substring(0,4)}`;
                        const removerName = UserManager.contacts[message.sender]?.name || `用户 ${message.sender.substring(0,4)}`;
                        ChatManager.addMessage(groupId, {
                            id: `sys_removed_${message.removedMemberId}_${Date.now()}`,
                            type: 'system',
                            content: `${removerName} 已将 ${removedContactName} 移出群聊。`,
                            timestamp: new Date().toISOString(),
                            groupId: groupId
                        });

                        ConnectionManager.close(message.removedMemberId);

                        if (ChatManager.currentChatId === groupId) {
                            this.openGroup(groupId);
                            if (typeof DetailsPanelUIManager !== 'undefined') DetailsPanelUIManager.updateDetailsPanelMembers(groupId);
                        }
                        ChatManager.renderChatList(ChatManager.currentFilter);
                    }
                }
                break;
            case 'group-ai-prompt-updated':
                if (group && group.members.includes(UserManager.userId) && sender !== UserManager.userId) {
                    if (!group.aiPrompts) group.aiPrompts = {};
                    group.aiPrompts[message.aiMemberId] = message.newPrompt;
                    await this.saveGroup(groupId);
                    Utils.log(`群成员侧：AI ${message.aiMemberId} 在群组 ${groupId} 的提示词已由 ${sender} 更新。`, Utils.logLevels.INFO);

                    const aiName = UserManager.contacts[message.aiMemberId]?.name || "AI";
                    const updaterName = UserManager.contacts[sender]?.name || "群主";
                    ChatManager.addMessage(groupId, {
                        id: `sys_prompt_updated_${message.aiMemberId}_${Date.now()}`,
                        type: 'system',
                        content: `${updaterName} 更新了 AI "${aiName}" 在群组中的行为指示。`,
                        timestamp: new Date().toISOString(),
                        groupId: groupId
                    });

                    if (ChatManager.currentChatId === groupId && typeof DetailsPanelUIManager !== 'undefined' && DetailsPanelUIManager.isPanelAreaVisible && DetailsPanelUIManager.currentView === 'details') {
                        DetailsPanelUIManager._updateForGroup(groupId);
                    }
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
        if (message.isRetracted) { return message.content; }
        let preview;
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
    },

    notifyAiPromptChanged: function(groupId, aiMemberId, newPrompt) {
        if (!this.groups[groupId] || this.groups[groupId].owner !== UserManager.userId) {
            Utils.log(`notifyAiPromptChanged: 操作被拒绝。用户 ${UserManager.userId} 不是群组 ${groupId} 的所有者，或群组不存在。`, Utils.logLevels.WARN);
            return;
        }
        Utils.log(`群主 ${UserManager.userId} 正在通知群 ${groupId} 关于 AI ${aiMemberId} 的提示词变更。新提示词: "${String(newPrompt).substring(0,30)}..."`, Utils.logLevels.INFO);
        const promptUpdateMessage = {
            type: 'group-ai-prompt-updated',
            groupId: groupId,
            aiMemberId: aiMemberId,
            newPrompt: newPrompt,
            sender: UserManager.userId
        };
        this.broadcastToGroup(groupId, promptUpdateMessage, [UserManager.userId]);
        const aiName = UserManager.contacts[aiMemberId]?.name || `AI ${aiMemberId.substring(0,4)}`;
        const systemMessageContent = `您更新了 AI "${aiName}" 在群组中的行为指示。`;
        const systemMessage = {
            id: `sys_prompt_update_local_${aiMemberId}_${Date.now()}`, type: 'system',
            content: systemMessageContent, timestamp: new Date().toISOString(),
            groupId: groupId
        };
        ChatManager.addMessage(groupId, systemMessage);
    }
};