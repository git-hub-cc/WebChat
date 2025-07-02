/**
 * @file 核心群组管理器 (GroupManager.js)
 * @description 负责处理所有与群组相关的业务逻辑，包括群组的创建、加载、成员管理和消息广播。
 *              该模块已重构，不再直接操作UI，而是通过分发 `Store` action 来通知UI层进行更新，实现了数据与视图的分离。
 * @module GroupManager
 * @exports {object} GroupManager - 对外暴露的单例对象，包含所有群组管理功能。
 * @dependency DBManager - 用于群组数据的持久化存储。
 * @dependency UserManager - 用于获取用户及联系人信息。
 * @dependency ChatManager - 用于在群组内添加系统消息或聊天消息。
 * @dependency ConnectionManager - 用于向群组成员发送实时信令。
 * @dependency NotificationUIManager - 用于显示操作结果的通知。
 * @dependency MessageManager - 用于处理消息撤回等。
 * @dependency EventEmitter - 用于事件通信。
 * @dependency Store - 用于状态管理和数据变更通知。
 * @dependency AppSettings - 用于获取应用配置，如群组最大成员数。
 */
const GroupManager = {
    // 内存中的群组数据缓存，以群组ID为键。格式: { [groupId: string]: GroupObject }
    groups: {},

    /**
     * 初始化群组管理器，从数据库加载所有群组数据到内存。
     * @function init
     * @returns {Promise<void>}
     */
    init: async function() {
        await this.loadGroups();
    },

    /**
     * 创建一个新群组，或修改现有群组的名称。
     * @function createGroup
     * @param {string} name - 新群组的名称或要更新的名称。
     * @param {string|null} [groupIdInput=null] - (可选) 要创建或修改的群组的ID。如果提供，则尝试修改；否则创建新群组。
     * @returns {Promise<string|null>} 成功时返回群组ID，失败则返回 null。
     */
    createGroup: async function(name, groupIdInput = null) {
        // 1. 规范化群组ID
        let effectiveGroupId = groupIdInput ? groupIdInput.trim() : null;
        if (effectiveGroupId && effectiveGroupId !== "" && !effectiveGroupId.startsWith('group_')) {
            effectiveGroupId = 'group_' + effectiveGroupId;
        } else if (effectiveGroupId === "") {
            effectiveGroupId = null;
        }

        // 2. 检查是修改现有群组还是创建新群组
        if (effectiveGroupId && this.groups[effectiveGroupId]) {
            // --- 修改现有群组 ---
            const group = this.groups[effectiveGroupId];
            if (group.owner === UserManager.userId) { // 校验权限
                if (group.name !== name) { // 检查名称是否有变化
                    group.name = name;
                    group.lastTime = new Date().toISOString();
                    // 在本地聊天记录中添加一条系统消息
                    ChatManager.addMessage(effectiveGroupId, {
                        id: `sys_name_change_${Date.now()}`, type: 'system',
                        content: `群组名称已更改为 "${name}"`, timestamp: new Date().toISOString(),
                        groupId: effectiveGroupId
                    });
                    // 向其他群成员广播名称变更的通知
                    this.broadcastToGroup(effectiveGroupId, {
                        type: 'system', content: `群组名称已由群主更改为 "${name}"`,
                        timestamp: new Date().toISOString(), groupId: effectiveGroupId,
                        sender: UserManager.userId
                    }, [UserManager.userId]); // 排除自己
                    await this.saveGroup(effectiveGroupId);
                    Store.dispatch('DATA_MODIFIED'); // 通知UI更新
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
            // --- 创建新群组 ---
            const finalGroupId = effectiveGroupId || ('group_' + Utils.generateId());
            if (this.groups[finalGroupId]) {
                NotificationUIManager.showNotification(`ID为 "${finalGroupId.replace('group_','')}" 的群组已存在。`, 'error');
                return null;
            }
            this.groups[finalGroupId] = {
                id: finalGroupId, name: name, owner: UserManager.userId,
                members: [UserManager.userId], lastMessage: '群组已创建',
                lastTime: new Date().toISOString(), unread: 0,
                leftMembers: [], aiPrompts: {}
            };
            await this.saveGroup(finalGroupId);
            Store.dispatch('DATA_MODIFIED'); // 通知UI更新
            NotificationUIManager.showNotification(`群组 "${name}" 已创建。`, 'success');
            return finalGroupId;
        }
    },

    /**
     * 向指定群组中添加一个新成员。
     * @function addMemberToGroup
     * @param {string} groupId - 目标群组的ID。
     * @param {string} memberId - 要添加的成员ID。
     * @param {string|null} [memberName=null] - (可选) 成员的显示名称。
     * @returns {Promise<boolean>} 添加成功返回 true，否则返回 false。
     */
    addMemberToGroup: async function(groupId, memberId, memberName = null) {
        // 流程说明:
        // 1. 校验：群组是否存在、操作者是否为群主、成员是否已存在、群组是否已满、非AI成员是否在线。
        // 2. 更新本地数据：将成员ID添加到 `members` 列表，如果是AI则设置默认提示词。
        // 3. 持久化存储：将更新后的群组数据保存到数据库。
        // 4. 发送系统消息：在本地聊天窗口显示 "xxx 邀请 xxx 加入群聊"。
        // 5. 通知新成员：向新成员发送 'group-invite' 消息，使其加入群组。
        // 6. 广播通知：向群内其他成员广播 'group-member-added' 消息，同步成员列表。
        // 7. 触发UI更新。

        const group = this.groups[groupId];
        if (!group) { NotificationUIManager.showNotification("未找到群组。", "error"); return false; }
        if (group.owner !== UserManager.userId) { NotificationUIManager.showNotification("只有群主可以添加成员。", "error"); return false; }
        if (group.members.includes(memberId)) { NotificationUIManager.showNotification("用户已在群组中。", "warning"); return false; }
        if (group.members.length >= AppSettings.group.maxMembers) {
            NotificationUIManager.showNotification(`群组已满 (最多 ${AppSettings.group.maxMembers} 人)。`, "error");
            return false;
        }

        const contactToAdd = UserManager.contacts[memberId];
        const newMemberDisplayName = memberName || (contactToAdd ? contactToAdd.name : `用户 ${memberId.substring(0,4)}`);

        // 非AI成员必须在线才能被邀请
        if (!(contactToAdd && contactToAdd.isAI) && !ConnectionManager.isConnectedTo(memberId)) {
            NotificationUIManager.showNotification(`无法添加成员: ${newMemberDisplayName} 当前不在线或未连接。`, 'error');
            return false;
        }

        group.members.push(memberId);
        group.leftMembers = group.leftMembers.filter(lm => lm.id !== memberId); // 如果是重新邀请，从已离开列表移除

        // 如果添加的是AI助手，且操作者是群主，则设置默认的AI行为指示
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
        ChatManager.addMessage(groupId, {
            id: `sys_add_${memberId}_${Date.now()}`, type: 'user', // NOTE: 'user' type to make it more visible
            content: systemMessageContent, timestamp: new Date().toISOString(), groupId: groupId
        });

        // 如果不是AI，则发送邀请信令
        if (!(contactToAdd && contactToAdd.isAI)) {
            ConnectionManager.sendTo(memberId, {
                type: 'group-invite', groupId: groupId, groupName: group.name, owner: group.owner,
                members: [...group.members], invitedBy: UserManager.userId, sender: UserManager.userId,
                aiPrompts: group.aiPrompts || {}, lastMessage: group.lastMessage, lastTime: group.lastTime
            });
        }

        // 准备广播给其他成员的联系人信息
        const contactDetailsForBroadcast = contactToAdd ? {
            id: contactToAdd.id, name: contactToAdd.name, isAI: contactToAdd.isAI,
            avatarText: contactToAdd.avatarText, avatarUrl: contactToAdd.avatarUrl,
            aiConfig: contactToAdd.aiConfig ? {
                systemPrompt: contactToAdd.aiConfig.systemPrompt,
                tts: contactToAdd.aiConfig.tts || { tts_mode: 'Preset', version: 'v4' }
            } : { tts: { tts_mode: 'Preset', version: 'v4' } }
        } : { id: memberId, name: newMemberDisplayName, isAI: false, aiConfig: {tts: { tts_mode: 'Preset', version: 'v4' }} };

        // 广播成员变动
        this.broadcastToGroup(groupId, {
            type: 'group-member-added', groupId: groupId, addedMemberId: memberId,
            addedMemberDetails: contactDetailsForBroadcast,
            groupAiPrompt: (contactToAdd && contactToAdd.isAI && group.aiPrompts) ? group.aiPrompts[memberId] : undefined,
            sender: UserManager.userId, allMembers: [...group.members]
        }, [memberId, UserManager.userId]); // 排除自己和新成员

        Store.dispatch('DATA_MODIFIED');
        NotificationUIManager.showNotification(`${newMemberDisplayName} 已被添加到群组。`, 'success');
        return true;
    },

    /**
     * 从群组中移除一个成员（仅群主可操作）。
     * @function removeMemberFromGroup
     * @param {string} groupId - 目标群组的ID。
     * @param {string} memberIdToRemove - 要移除的成员ID。
     * @returns {Promise<boolean>} 移除成功返回 true，否则返回 false。
     */
    removeMemberFromGroup: async function(groupId, memberIdToRemove) {
        const group = this.groups[groupId];
        if (!group) { NotificationUIManager.showNotification("未找到群组。", "error"); return false; }
        if (group.owner !== UserManager.userId) { NotificationUIManager.showNotification("只有群主可以移除成员。", "error"); return false; }
        if (memberIdToRemove === UserManager.userId) { NotificationUIManager.showNotification("群主无法移除自己。请选择解散群组。", "warning"); return false; }

        const memberIndex = group.members.indexOf(memberIdToRemove);
        if (memberIndex === -1) { NotificationUIManager.showNotification("用户不在群组中。", "warning"); return false; }

        const removedContact = UserManager.contacts[memberIdToRemove];
        group.members.splice(memberIndex, 1);

        // 如果移除的是AI，也删除其对应的提示词
        if (removedContact && removedContact.isAI && group.aiPrompts && group.aiPrompts[memberIdToRemove]) {
            delete group.aiPrompts[memberIdToRemove];
        }

        await this.saveGroup(groupId);
        Store.dispatch('DATA_MODIFIED');

        const removerName = UserManager.contacts[UserManager.userId]?.name || UserManager.userId.substring(0,4);
        const removedName = removedContact?.name || `用户 ${memberIdToRemove.substring(0,4)}`;
        ChatManager.addMessage(groupId, { id: `sys_remove_${memberIdToRemove}_${Date.now()}`, type: 'system', content: `${removerName} 已将 ${removedName} 移出群聊。`, timestamp: new Date().toISOString(), groupId: groupId });

        // 广播成员移除事件
        this.broadcastToGroup(groupId, {
            type: 'group-member-removed', groupId: groupId, removedMemberId: memberIdToRemove,
            sender: UserManager.userId, allMembers: [...group.members]
        }, [memberIdToRemove, UserManager.userId]);

        // 通知被移除的用户
        if (!(removedContact && removedContact.isAI)) {
            ConnectionManager.sendTo(memberIdToRemove, { type: 'group-removed', groupId: groupId, groupName: group.name, reason: 'removed_by_owner', sender: UserManager.userId, removedMemberId: memberIdToRemove });
            ConnectionManager.close(memberIdToRemove); // 关闭与该用户的连接
        }

        NotificationUIManager.showNotification(`${removedName} 已被移出群组。`, 'success');
        return true;
    },

    /**
     * 当前用户主动离开一个群组。
     * @function leaveGroup
     * @param {string} groupId - 要离开的群组ID。
     * @returns {Promise<void>}
     */
    leaveGroup: async function(groupId) {
        const group = this.groups[groupId];
        if (!group) { NotificationUIManager.showNotification("未找到群组。", "error"); return; }
        if (group.owner === UserManager.userId) { NotificationUIManager.showNotification("群主不能离开。请选择解散群组。", "warning"); return; }

        const myId = UserManager.userId;
        if (!group.members.includes(myId)) return; // 如果已经不在群内，则静默返回

        const myName = UserManager.contacts[myId]?.name || `用户 ${myId.substring(0,4)}`;

        // 1. 向群内其他成员广播自己离开的消息
        this.broadcastToGroup(groupId, {
            type: 'group-member-left', groupId: groupId, leftMemberId: myId,
            leftMemberName: myName, sender: myId,
            allMembers: group.members.filter(id => id !== myId)
        }, [myId]);

        // 2. 关闭与群内所有成员的WebRTC连接
        group.members.forEach(memberId => {
            if (memberId !== myId) ConnectionManager.close(memberId);
        });

        // 3. 从本地删除群组数据和聊天记录
        delete this.groups[groupId];
        await DBManager.removeItem('groups', groupId);
        await ChatManager.clearChat(groupId);

        // 4. 如果当前正停留在该群聊界面，则切换到空白页
        if (Store.getState().currentChatId === groupId) {
            Store.dispatch('OPEN_CHAT', { chatId: null });
        }

        // 5. 更新UI
        Store.dispatch('DATA_MODIFIED');
        NotificationUIManager.showNotification(`您已离开群组 "${group.name}"。`, 'success');
    },

    /**
     * 群主解散一个群组。
     * @function dissolveGroup
     * @param {string} groupId - 要解散的群组ID。
     * @returns {Promise<void>}
     */
    dissolveGroup: async function(groupId) {
        const group = this.groups[groupId];
        if (!group) return;
        if (group.owner !== UserManager.userId) { NotificationUIManager.showNotification("只有群主可以解散群组。", "error"); return; }

        // 1. 向所有成员（不包括自己）广播群组解散的消息
        this.broadcastToGroup(groupId, { type: 'group-dissolved', groupId: groupId, groupName: group.name, sender: UserManager.userId }, [UserManager.userId]);

        // 2. 关闭与所有成员的连接
        group.members.forEach(memberId => {
            if (memberId !== UserManager.userId) ConnectionManager.close(memberId);
        });

        // 3. 删除本地数据
        delete this.groups[groupId];
        await DBManager.removeItem('groups', groupId);
        await ChatManager.clearChat(groupId);

        // 4. 更新UI状态
        if (Store.getState().currentChatId === groupId) {
            Store.dispatch('OPEN_CHAT', { chatId: null });
        }
        Store.dispatch('DATA_MODIFIED');
        NotificationUIManager.showNotification(`群组 "${group.name}" 已被解散。`, 'success');
    },

    /**
     * 向群组内所有符合条件的成员广播消息。
     * @function broadcastToGroup
     * @param {string} groupId - 目标群组的ID。
     * @param {object} message - 要广播的消息对象。
     * @param {Array<string>} [excludeIds=[]] - 需要排除的成员ID列表。
     * @returns {boolean} 是否成功发起广播。
     */
    broadcastToGroup: function(groupId, message, excludeIds = []) {
        const group = this.groups[groupId];
        if (!group) {
            Utils.log(`broadcastToGroup: 群组 ${groupId} 未找到。`, Utils.logLevels.WARN);
            return false;
        }

        // 完善消息体
        message.groupId = groupId;
        message.sender = message.sender || UserManager.userId;
        message.originalSender = message.originalSender || message.sender;
        const originalSenderContact = UserManager.contacts[message.originalSender];
        message.originalSenderName = message.originalSenderName || (originalSenderContact ? originalSenderContact.name : `用户 ${String(message.originalSender).substring(0,4)}`);

        // 对于特定类型的消息，附加额外信息
        if (message.type === 'group-invite' || message.type === 'group-member-added' || message.type === 'group-ai-prompt-updated') {
            message.aiPrompts = group.aiPrompts || {};
        }
        if (['group-invite', 'group-member-added', 'group-member-removed', 'group-member-left'].includes(message.type)) {
            if (!message.allMembers) message.allMembers = [...group.members];
        }

        // 筛选出要发送消息的成员：非AI、非自己、未被排除且当前在线
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
        return true;
    },

    /**
     * 处理接收到的各类群组相关消息。
     * @function handleGroupMessage
     * @param {object} message - 从对端接收到的消息对象。
     * @returns {Promise<void>}
     */
    handleGroupMessage: async function(message) {
        const { groupId, type, sender, originalSender } = message;
        let group = this.groups[groupId];

        // 对于除邀请外的消息，如果本地不存在该群组，则直接忽略（特殊情况除外）
        if (type !== 'group-invite' && !group) {
            // NOTE: 特殊处理：即使群组已删除，也要响应被踢出群组的最终通知
            if (type === 'group-removed' && message.removedMemberId === UserManager.userId && message.reason === 'removed_by_owner') {
                // fall-through to switch
            } else {
                return;
            }
        }

        switch (type) {
            // case 'group-invite': 处理被邀请加入新群组的逻辑
            case 'group-invite':
                if (!this.groups[groupId]) { // 如果是全新的邀请
                    const inviterName = UserManager.contacts[message.invitedBy]?.name || message.invitedBy.substring(0,4);
                    this.groups[groupId] = {
                        id: groupId, name: message.groupName, owner: message.owner,
                        members: message.members || [],
                        lastMessage: message.lastMessage || `您被 ${inviterName} 邀请加入群聊`,
                        lastTime: message.lastTime || new Date().toISOString(),
                        unread: 1, leftMembers: message.leftMembers || [],
                        aiPrompts: message.aiPrompts || {}
                    };
                    await this.saveGroup(groupId);
                    Store.dispatch('DATA_MODIFIED');
                    NotificationUIManager.showNotification(`您已被 ${inviterName} 邀请加入群组: ${message.groupName}`, 'success');

                    // 主动与其他群成员建立P2P连接
                    const myId = UserManager.userId;
                    if (this.groups[groupId].members.includes(myId)) {
                        this.groups[groupId].members.forEach(otherMemberId => {
                            if (otherMemberId !== myId && !(UserManager.contacts[otherMemberId] && UserManager.contacts[otherMemberId].isAI)) {
                                ConnectionManager.createOffer(otherMemberId, { isSilent: true });
                            }
                        });
                    }
                } else { // 如果是群信息同步（例如，在我离线时有成员变动）
                    group.members = message.members || group.members;
                    group.aiPrompts = message.aiPrompts || group.aiPrompts || {};
                    if (message.lastTime && (!group.lastTime || new Date(message.lastTime) > new Date(group.lastTime))) {
                        group.lastMessage = message.lastMessage || group.lastMessage;
                        group.lastTime = message.lastTime;
                    }
                    await this.saveGroup(groupId);
                    Store.dispatch('DATA_MODIFIED');
                }
                break;

            // case (chat messages): 处理聊天消息
            case 'text': case 'file': case 'image': case 'audio': case 'system': case 'sticker':
                if (group && (originalSender || sender) !== UserManager.userId && group.members.includes(UserManager.userId)) {
                    ChatManager.addMessage(groupId, message);
                }
                break;

            // case 'group-retract-message-request': 处理消息撤回请求
            case 'group-retract-message-request':
                if (group && group.members.includes(UserManager.userId)) {
                    const retractedByName = message.originalSenderName || UserManager.contacts[message.originalSender]?.name || `用户 ${String(message.originalSender).substring(0,4)}`;
                    MessageManager._updateMessageToRetractedState(message.originalMessageId, groupId, false, retractedByName);
                }
                break;

            // case 'group-member-left': 处理成员主动离开群组
            case 'group-member-left':
                if (group && group.members.includes(message.leftMemberId)) {
                    group.members = group.members.filter(id => id !== message.leftMemberId);
                    const leftMemberName = message.leftMemberName || `用户 ${String(message.leftMemberId).substring(0,4)}`;
                    // 如果我是群主，记录离开的成员信息
                    if (group.owner === UserManager.userId) {
                        if(!group.leftMembers) group.leftMembers = [];
                        if(!group.leftMembers.find(lm => lm.id === message.leftMemberId)) {
                            group.leftMembers.push({ id: message.leftMemberId, name: leftMemberName, leftTime: new Date().toISOString() });
                        }
                        if (group.aiPrompts && group.aiPrompts[message.leftMemberId]) delete group.aiPrompts[message.leftMemberId];
                    }
                    await this.saveGroup(groupId);
                    if(group.members.includes(UserManager.userId)) {
                        ChatManager.addMessage(groupId, { id: `sys_left_${message.leftMemberId}_${Date.now()}`, type: 'system', content: `${leftMemberName} 离开了群聊。`, groupId: groupId, timestamp: new Date().toISOString()});
                        ConnectionManager.close(message.leftMemberId);
                    }
                    Store.dispatch('DATA_MODIFIED');
                }
                break;

            // case 'group-removed': 处理自己被群主移出群组
            case 'group-removed':
                if (message.removedMemberId === UserManager.userId && message.reason === 'removed_by_owner') {
                    const groupNameForNotification = message.groupName || (group ? group.name : null) || `群组 ${groupId}`;
                    NotificationUIManager.showNotification(`您正在被移出群组 "${groupNameForNotification}"。此操作将在 5 秒后生效。`, 'info', 6000);
                    // 使用闭包捕获当前变量，延迟执行清理操作
                    const capturedGroupId = groupId;
                    const capturedGroupName = groupNameForNotification;
                    setTimeout(async () => {
                        const finalGroupName = (this.groups[capturedGroupId] ? this.groups[capturedGroupId].name : null) || capturedGroupName;
                        NotificationUIManager.showNotification(`您已被移出群组 "${finalGroupName}"。`, 'warning');
                        if (this.groups[capturedGroupId]) {
                            this.groups[capturedGroupId].members.forEach(memberId => {
                                if (memberId !== UserManager.userId) ConnectionManager.close(memberId);
                            });
                        }
                        delete this.groups[capturedGroupId];
                        await DBManager.removeItem('groups', capturedGroupId);
                        await ChatManager.clearChat(capturedGroupId);
                        if (Store.getState().currentChatId === capturedGroupId) {
                            Store.dispatch('OPEN_CHAT', { chatId: null });
                        }
                        Store.dispatch('DATA_MODIFIED');
                    }, 5000);
                }
                break;

            // case 'group-dissolved': 处理群组被解散
            case 'group-dissolved':
                if (group && sender !== UserManager.userId) {
                    NotificationUIManager.showNotification(`群组 "${group.name}" 已被群主解散。`, 'warning');
                    group.members.forEach(memberId => {
                        if (memberId !== UserManager.userId) ConnectionManager.close(memberId);
                    });
                    delete this.groups[groupId];
                    await DBManager.removeItem('groups', groupId);
                    await ChatManager.clearChat(groupId);
                    if (Store.getState().currentChatId === groupId) {
                        Store.dispatch('OPEN_CHAT', { chatId: null });
                    }
                    Store.dispatch('DATA_MODIFIED');
                }
                break;

            // case 'group-member-added': 处理有新成员加入
            case 'group-member-added':
                if (group && group.members.includes(UserManager.userId) && message.sender !== UserManager.userId) {
                    if (!group.members.includes(message.addedMemberId)) {
                        group.members = message.allMembers || group.members;
                        // 如果新成员是陌生人，则自动添加到联系人列表
                        if (message.addedMemberDetails && !UserManager.contacts[message.addedMemberId]) {
                            const contactData = { ...message.addedMemberDetails };
                            // TODO: 这部分AI配置的默认值填充逻辑可以优化得更健壮
                            if (!contactData.aiConfig) contactData.aiConfig = { tts: { tts_mode: 'Preset', version: 'v4' } };
                            else if (!contactData.aiConfig.tts) contactData.aiConfig.tts = { tts_mode: 'Preset', version: 'v4' };
                            else {
                                if(contactData.aiConfig.tts.tts_mode === undefined) contactData.aiConfig.tts.tts_mode = 'Preset';
                                if(contactData.aiConfig.tts.version === undefined) contactData.aiConfig.tts.version = 'v4';
                            }
                            UserManager.addContact(contactData);
                        }
                        // 同步AI提示词
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
                            type: 'user', content: systemContent,
                            timestamp: new Date().toISOString(), groupId: groupId
                        });
                        // 主动与新加入的非AI成员建立连接
                        if (!(UserManager.contacts[message.addedMemberId] && UserManager.contacts[message.addedMemberId].isAI)) {
                            ConnectionManager.createOffer(message.addedMemberId, { isSilent: true });
                        }
                        Store.dispatch('DATA_MODIFIED');
                    }
                }
                break;

            // case 'group-member-removed': 处理有成员被移出
            case 'group-member-removed':
                if (group && group.members.includes(UserManager.userId) && message.sender !== UserManager.userId) {
                    if (group.members.includes(message.removedMemberId)) {
                        group.members = message.allMembers || group.members.filter(id => id !== message.removedMemberId);
                        if (group.aiPrompts && group.aiPrompts[message.removedMemberId]) delete group.aiPrompts[message.removedMemberId];
                        await this.saveGroup(groupId);
                        const removedContactName = UserManager.contacts[message.removedMemberId]?.name || `用户 ${message.removedMemberId.substring(0,4)}`;
                        const removerName = UserManager.contacts[message.sender]?.name || `用户 ${message.sender.substring(0,4)}`;
                        ChatManager.addMessage(groupId, {
                            id: `sys_removed_${message.removedMemberId}_${Date.now()}`,
                            type: 'system', content: `${removerName} 已将 ${removedContactName} 移出群聊。`,
                            timestamp: new Date().toISOString(), groupId: groupId
                        });
                        ConnectionManager.close(message.removedMemberId);
                        Store.dispatch('DATA_MODIFIED');
                    }
                }
                break;

            // case 'group-ai-prompt-updated': 处理群内AI提示词被更新
            case 'group-ai-prompt-updated':
                if (group && group.members.includes(UserManager.userId) && sender !== UserManager.userId) {
                    if (!group.aiPrompts) group.aiPrompts = {};
                    group.aiPrompts[message.aiMemberId] = message.newPrompt;
                    await this.saveGroup(groupId);
                    const aiName = UserManager.contacts[message.aiMemberId]?.name || "AI";
                    const updaterName = UserManager.contacts[sender]?.name || "群主";
                    ChatManager.addMessage(groupId, {
                        id: `sys_prompt_updated_${message.aiMemberId}_${Date.now()}`,
                        type: 'system', content: `${updaterName} 更新了 AI "${aiName}" 在群组中的行为指示。`,
                        timestamp: new Date().toISOString(), groupId: groupId
                    });
                    Store.dispatch('DATA_MODIFIED');
                }
                break;
        }
    },

    /**
     * 更新群组的最后一条消息预览和时间。
     * @function updateGroupLastMessage
     * @param {string} groupId - 群组ID。
     * @param {string} messageText - 消息预览文本。
     * @param {boolean} [incrementUnread=false] - 是否增加未读计数。
     * @param {boolean} [forceNoUnread=false] - 是否强制将未读数清零。
     * @returns {Promise<void>}
     */
    updateGroupLastMessage: async function(groupId, messageText, incrementUnread = false, forceNoUnread = false) {
        const group = this.groups[groupId];
        if (group) {
            group.lastMessage = messageText.length > 30 ? messageText.substring(0, 27) + "..." : messageText;
            group.lastTime = new Date().toISOString();
            if (forceNoUnread) {
                group.unread = 0;
            } else if (incrementUnread && (Store.getState().currentChatId !== groupId || !document.hasFocus())) {
                // 只有当聊天窗口非当前窗口或页面失焦时，才增加未读数
                group.unread = (group.unread || 0) + 1;
            }
            await this.saveGroup(groupId);
            Store.dispatch('DATA_MODIFIED');
        }
    },

    /**
     * 清除指定群组的未读消息计数。
     * @function clearUnread
     * @param {string} groupId - 群组ID。
     * @returns {Promise<void>}
     */
    clearUnread: async function(groupId) {
        const group = this.groups[groupId];
        if (group && group.unread > 0) {
            group.unread = 0;
            await this.saveGroup(groupId);
            Store.dispatch('DATA_MODIFIED');
        }
    },

    /**
     * 将群组AI成员的行为指示变更通知给其他群成员。
     * @function notifyAiPromptChanged
     * @param {string} groupId - 群组ID。
     * @param {string} aiMemberId - AI成员的ID。
     * @param {string} newPrompt - 新的行为指示文本。
     */
    notifyAiPromptChanged: function(groupId, aiMemberId, newPrompt) {
        // 权限校验：只有群主能修改
        if (!this.groups[groupId] || this.groups[groupId].owner !== UserManager.userId) {
            return;
        }
        const promptUpdateMessage = {
            type: 'group-ai-prompt-updated',
            groupId: groupId,
            aiMemberId: aiMemberId,
            newPrompt: newPrompt,
            sender: UserManager.userId
        };
        // 广播给除自己外的所有成员
        this.broadcastToGroup(groupId, promptUpdateMessage, [UserManager.userId]);

        // 在本地也添加一条系统消息以作记录
        const aiName = UserManager.contacts[aiMemberId]?.name || `AI ${aiMemberId.substring(0,4)}`;
        const systemMessageContent = `您更新了 AI "${aiName}" 在群组中的行为指示。`;
        ChatManager.addMessage(groupId, {
            id: `sys_prompt_update_local_${aiMemberId}_${Date.now()}`, type: 'system',
            content: systemMessageContent, timestamp: new Date().toISOString(),
            groupId: groupId
        });
    },

    /**
     * (内部工具方法) 从数据库加载所有群组数据到内存中。
     * @private
     * @function loadGroups
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
     * (内部工具方法) 将指定的群组数据保存到数据库。
     * @private
     * @function saveGroup
     * @param {string} groupId - 要保存的群组ID。
     * @returns {Promise<void>}
     */
    saveGroup: async function(groupId) {
        if (this.groups[groupId]) {
            try {
                // 确保要保存的数据结构完整
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
     * (内部工具方法) 格式化消息，用于在侧边栏生成预览文本。
     * @private
     * @function formatMessagePreview
     * @param {object} message - 消息对象。
     * @returns {string} 格式化后的预览字符串。
     */
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
            case 'sticker': preview = `${senderName}: [贴图]`; break;
            case 'system': preview = message.content; break; // 系统消息直接显示内容
            default: preview = `${senderName}: [新消息]`;
        }
        // 截断过长的预览文本
        return preview.length > 35 ? preview.substring(0, 32) + "..." : preview;
    },
};