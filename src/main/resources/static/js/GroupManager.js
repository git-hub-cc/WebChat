/**
 * @file GroupManager.js
 * @description 核心群组管理器，负责处理所有与群组相关的逻辑，包括创建、加载、成员管理和消息广播。
 *              新增：支持群组内 AI 成员的特定提示词。当群主添加AI成员到群组，或修改群内AI提示词时，会进行相应处理。
 *              createGroup 方法现在支持通过提供群组ID来修改现有群组名称（如果用户是群主）。
 *              更新：群组连接方式改为 Mesh 架构，成员直接互连，群人数上限20人。移除了群主消息转发逻辑。
 * @module GroupManager
 * @exports {object} GroupManager - 对外暴露的单例对象，包含所有群组管理功能。
 * @property {object} groups - 存储所有群组数据的对象，格式为 { groupId: groupObject }。
 * @property {function} init - 初始化模块，从数据库加载群组数据。
 * @property {function} createGroup - 创建一个新群组，或修改现有群组的名称。
 * @property {function} addMemberToGroup - 向群组中添加一个新成员。
 * @property {function} removeMemberFromGroup - 从群组中移除一个成员。
 * @property {function} leaveGroup - 当前用户离开一个群组。
 * @property {function} dissolveGroup - 群主解散一个群组。
 * @property {function} broadcastToGroup - 向群组成员广播消息。
 * @property {function} handleGroupMessage - 处理接收到的群组相关消息。
 * @property {function} notifyAiPromptChanged - 通知群成员AI提示词已更改。
 * @dependencies DBManager, UserManager, ChatManager, ConnectionManager, NotificationUIManager, Utils, DetailsPanelUIManager, ChatAreaUIManager, SidebarUIManager, MessageManager, EventEmitter
 * @dependents AppInitializer (进行初始化), ChatManager (管理群组聊天), ModalUIManager (创建群组时调用), DetailsPanelUIManager
 */
const GroupManager = {
    groups: {},
    currentGroupId: null,
    MAX_GROUP_MEMBERS: 20, // 群组成员上限

    /**
     * 初始化群组管理器，从数据库加载所有群组数据。
     * @returns {Promise<void>}
     */
    init: async function() {
        await this.loadGroups();
    },

    /**
     * 从 IndexedDB 加载所有群组数据到内存中。
     * 确保每个群组对象都有 aiPrompts 字段。
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
                        aiPrompts: group.aiPrompts || {} // 确保 aiPrompts 字段存在
                    };
                });
            }
        } catch (error) { Utils.log(`加载群组失败: ${error}`, Utils.logLevels.ERROR); }
    },

    /**
     * 将指定的群组数据保存到数据库。
     * @param {string} groupId - 要保存的群组 ID。
     * @returns {Promise<void>}
     */
    saveGroup: async function(groupId) {
        if (this.groups[groupId]) {
            try {
                // 确保 aiPrompts 存在才保存
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
     * 创建一个新群组，或修改现有群组的名称（如果提供了groupIdInput且用户是群主）。
     * @param {string} name - 新群组的名称或要更新的名称。
     * @param {string|null} [groupIdInput=null] - (可选) 要创建或修改的群组的ID (用户输入，可能不带 'group_' 前缀)。如果为null或空，则创建新群组并自动生成ID。
     * @returns {Promise<string|null>} - 成功时返回群组ID (例如 "group_xxxx")，失败或仅修改名称时可能返回null或群组ID。
     */
    createGroup: async function(name, groupIdInput = null) {
        let effectiveGroupId = groupIdInput ? groupIdInput.trim() : null;

        // 确保群组ID有 'group_' 前缀，除非它是用户手动输入的且已包含 (同时也处理空字符串的情况)
        if (effectiveGroupId && effectiveGroupId !== "" && !effectiveGroupId.startsWith('group_')) {
            effectiveGroupId = 'group_' + effectiveGroupId;
        } else if (effectiveGroupId === "") { // 如果用户输入的是空字符串，则视为未提供ID
            effectiveGroupId = null;
        }

        if (effectiveGroupId && this.groups[effectiveGroupId]) {
            // 这是修改逻辑
            const group = this.groups[effectiveGroupId];
            if (group.owner === UserManager.userId) {
                if (group.name !== name) {
                    group.name = name;
                    group.lastTime = new Date().toISOString(); // 更新最后活动时间
                    // 可选：系统消息通知名称更改
                    ChatManager.addMessage(effectiveGroupId, {
                        id: `sys_name_change_${Date.now()}`,
                        type: 'system',
                        content: `群组名称已更改为 "${name}"`,
                        timestamp: new Date().toISOString(),
                        groupId: effectiveGroupId
                    });
                    this.broadcastToGroup(effectiveGroupId, {
                        type: 'system', // 消息类型保持不变，但广播逻辑已改为mesh
                        content: `群组名称已由群主更改为 "${name}"`,
                        timestamp: new Date().toISOString(),
                        groupId: effectiveGroupId,
                        sender: UserManager.userId // 明确发送者
                    }, [UserManager.userId]); // 广播给除自己外的所有成员

                    await this.saveGroup(effectiveGroupId);
                    ChatManager.renderChatList(ChatManager.currentFilter);
                    if (ChatManager.currentChatId === effectiveGroupId) {
                        this.openGroup(effectiveGroupId); // 刷新聊天头部
                    }
                    NotificationUIManager.showNotification(`群组 "${name}" 名称已更新。`, 'success');
                    return effectiveGroupId;
                } else {
                    NotificationUIManager.showNotification('群组名称未发生变化。', 'info');
                    return effectiveGroupId; // 名称未变，但操作认为是成功的（找到了群组）
                }
            } else {
                NotificationUIManager.showNotification('只有群主可以修改群组名称。', 'error');
                return null; // 修改失败
            }
        } else {
            // 这是创建新群组逻辑
            const finalGroupId = effectiveGroupId || ('group_' + Utils.generateId());
            if (this.groups[finalGroupId]) { // 即使是用户提供的ID，也再次检查是否已存在（防止并发或意外情况）
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
                aiPrompts: {} // 初始化 aiPrompts 为空对象
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
                group.name, `${group.members.length} 名成员 (上限 ${this.MAX_GROUP_MEMBERS})`, '👥', true
            );
            this.clearUnread(groupId);
            ChatAreaUIManager.setCallButtonsState(false);
        } else if (!group) {
            Utils.log(`未找到要打开的群组 ${groupId}。`, Utils.logLevels.WARN);
        }
    },

    /**
     * 向群组中添加一个新成员。
     * 如果添加的是AI成员，且操作者是群主，则将其默认提示词存入群组的aiPrompts中。
     * 新成员将尝试与其他成员建立连接。
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
        if (group.members.length >= this.MAX_GROUP_MEMBERS) {
            NotificationUIManager.showNotification(`群组已满 (最多 ${this.MAX_GROUP_MEMBERS} 人)。`, "error");
            return false;
        }

        const contactToAdd = UserManager.contacts[memberId];
        const oldMembers = [...group.members]; // 记录添加前的成员列表

        group.members.push(memberId);
        group.leftMembers = group.leftMembers.filter(lm => lm.id !== memberId);

        // 新增逻辑：如果添加的是AI成员，且操作者是群主，则缓存其默认提示词
        if (contactToAdd && contactToAdd.isAI && group.owner === UserManager.userId) {
            if (!group.aiPrompts) {
                group.aiPrompts = {};
            }
            const defaultPrompt = (contactToAdd.aiConfig && contactToAdd.aiConfig.systemPrompt) ? contactToAdd.aiConfig.systemPrompt : "";
            group.aiPrompts[memberId] = defaultPrompt;
            Utils.log(`GroupManager: 已为 AI 成员 ${memberId} 在群组 ${groupId} 中设置初始提示词。`, Utils.logLevels.DEBUG);
        }

        await this.saveGroup(groupId);

        if (typeof DetailsPanelUIManager !== 'undefined' &&
            DetailsPanelUIManager.currentView === 'details' &&
            ChatManager.currentChatId === groupId) {
            DetailsPanelUIManager.updateDetailsPanelMembers(groupId);
            if (contactToAdd && contactToAdd.isAI && group.owner === UserManager.userId) {
                // 触发详情面板更新群组内AI提示词编辑区
                DetailsPanelUIManager._updateForGroup(groupId);
            }
        }
        if (ChatManager.currentChatId === groupId) this.openGroup(groupId); // 更新群组头部信息（如成员数量）

        const inviterName = UserManager.contacts[UserManager.userId]?.name || UserManager.userId.substring(0,4);
        const newMemberDisplayName = memberName || UserManager.contacts[memberId]?.name || `用户 ${memberId.substring(0,4)}`;
        let systemMessageContent = `${inviterName} 邀请 ${newMemberDisplayName} 加入了群聊。`;
        if (contactToAdd && contactToAdd.isAI) {
            systemMessageContent += ` (${newMemberDisplayName} 是一个AI助手)`;
        }
        const systemMessage = { type: 'user', content: systemMessageContent, timestamp: new Date().toISOString(), groupId: groupId }; // 依然是 user 类型以便显示
        ChatManager.addMessage(groupId, systemMessage);

        // 广播给所有现有成员（除新成员外），新成员已加入
        const memberAddedNotification = {
            type: 'group-member-added',
            groupId: groupId,
            addedMemberId: memberId,
            addedMemberDetails: contactToAdd, // 包含其 aiConfig
            groupAiPrompt: (contactToAdd && contactToAdd.isAI) ? group.aiPrompts[memberId] : undefined,
            sender: UserManager.userId,
            allMembers: [...group.members] // 包含新成员后的完整列表
        };
        this.broadcastToGroup(groupId, memberAddedNotification, [memberId, UserManager.userId]); // 不发给新成员和自己

        // 向新成员发送完整的群组邀请信息，包含所有成员列表，以便新成员连接
        if (!(contactToAdd && contactToAdd.isAI)) { // AI成员不通过P2P连接
            const inviteMessageToNewMember = {
                type: 'group-invite', // 新成员接收的是邀请类型，包含所有信息
                groupId: groupId,
                groupName: group.name,
                owner: group.owner,
                members: [...group.members], // 发送包含新成员的完整列表
                invitedBy: UserManager.userId,
                sender: UserManager.userId,
                aiPrompts: group.aiPrompts,
                lastMessage: group.lastMessage,
                lastTime: group.lastTime
            };
            ConnectionManager.sendTo(memberId, inviteMessageToNewMember);
        }

        NotificationUIManager.showNotification(`${newMemberDisplayName} 已被添加到群组。`, 'success');
        ChatManager.renderChatList(ChatManager.currentFilter);
        return true;
    },

    /**
     * 从群组中移除一个成员。
     * 如果移除的是AI成员，也从群组的aiPrompts中删除其特定提示词。
     * @param {string} groupId - 目标群组的 ID。
     * @param {string} memberIdToRemove - 要移除的成员 ID。
     * @returns {Promise<boolean>} - 操作是否成功。
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
        // 新增逻辑：如果移除的是AI成员，也从aiPrompts中删除
        if (removedContact && removedContact.isAI && group.aiPrompts && group.aiPrompts[memberIdToRemove]) {
            delete group.aiPrompts[memberIdToRemove];
            Utils.log(`GroupManager: 已从群组 ${groupId} 的特定提示词中移除 AI ${memberIdToRemove}。`, Utils.logLevels.DEBUG);
        }

        await this.saveGroup(groupId);

        if (typeof DetailsPanelUIManager !== 'undefined' && DetailsPanelUIManager.currentView === 'details' && ChatManager.currentChatId === groupId) {
            DetailsPanelUIManager.updateDetailsPanelMembers(groupId);
            if (removedContact && removedContact.isAI && group.owner === UserManager.userId) {
                // 触发详情面板更新群组内AI提示词编辑区
                DetailsPanelUIManager._updateForGroup(groupId);
            }
        }
        if (ChatManager.currentChatId === groupId) this.openGroup(groupId);

        const removerName = UserManager.contacts[UserManager.userId]?.name || UserManager.userId.substring(0,4);
        const removedName = removedContact?.name || `用户 ${memberIdToRemove.substring(0,4)}`;
        const systemMessage = { id: `sys_${Date.now()}`, type: 'system', content: `${removerName} 已将 ${removedName} 移出群聊。`, timestamp: new Date().toISOString(), groupId: groupId };
        ChatManager.addMessage(groupId, systemMessage);

        // 广播给剩余成员，某人被移除了
        const memberRemovedNotificationToGroup = {
            type: 'group-member-removed',
            groupId: groupId,
            removedMemberId: memberIdToRemove,
            sender: UserManager.userId,
            allMembers: [...group.members] // 移除后的成员列表
        };
        this.broadcastToGroup(groupId, memberRemovedNotificationToGroup, [memberIdToRemove, UserManager.userId]); // 不发给被移除者和自己

        // 通知被移除的成员
        if (!(removedContact && removedContact.isAI)) {
            const removalNotificationToRemovedUser = { type: 'group-removed', groupId: groupId, groupName: group.name, reason: 'removed_by_owner', sender: UserManager.userId, removedMemberId: memberIdToRemove };
            ConnectionManager.sendTo(memberIdToRemove, removalNotificationToRemovedUser);
            // 断开与被移除成员的连接
            ConnectionManager.close(memberIdToRemove);
        }

        NotificationUIManager.showNotification(`${removedName} 已被移出群组。`, 'success');
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
        if (!group) { NotificationUIManager.showNotification("未找到群组。", "error"); return; }
        if (group.owner === UserManager.userId) { NotificationUIManager.showNotification("群主不能离开。请选择解散群组。", "warning"); return; }
        const myId = UserManager.userId;
        if (!group.members.includes(myId)) return;

        const myName = UserManager.contacts[myId]?.name || `用户 ${myId.substring(0,4)}`;
        // 通知其他成员此用户已离开
        const leaveMessage = {
            type: 'group-member-left',
            groupId: groupId,
            leftMemberId: myId,
            leftMemberName: myName,
            sender: myId,
            allMembers: group.members.filter(id => id !== myId) // 离开后的成员列表
        };
        this.broadcastToGroup(groupId, leaveMessage, [myId]); // 不发给自己

        // 断开与所有群成员的连接
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

    /**
     * 群主解散一个群组。
     * @param {string} groupId - 要解散的群组 ID。
     * @returns {Promise<void>}
     */
    dissolveGroup: async function(groupId) {
        const group = this.groups[groupId];
        if (!group) return;
        if (group.owner !== UserManager.userId) { NotificationUIManager.showNotification("只有群主可以解散群组。", "error"); return; }
        const dissolveNotification = { type: 'group-dissolved', groupId: groupId, groupName: group.name, sender: UserManager.userId };
        this.broadcastToGroup(groupId, dissolveNotification, [UserManager.userId]); // 不发给自己

        // 断开与所有群成员的连接（虽然他们收到解散通知后也会自行清理）
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

    /**
     * 向群组成员广播消息。现在直接发送给所有非AI成员。
     * AI 成员不会收到广播消息。
     * @param {string} groupId - 目标群组的 ID。
     * @param {object} message - 要广播的消息对象。
     * @param {string[]} [excludeIds=[]] - 要排除的用户 ID 列表。
     * @returns {boolean} - 操作是否成功。
     */
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

        // 确保消息中包含最新的aiPrompts（如果消息类型相关）
        if (message.type === 'group-invite' || message.type === 'group-member-added' || message.type === 'group-ai-prompt-updated') {
            message.aiPrompts = group.aiPrompts || {};
        }
        // 确保消息中包含最新的成员列表 (如果消息类型需要)
        if (['group-invite', 'group-member-added', 'group-member-removed', 'group-member-left'].includes(message.type)) {
            if (!message.allMembers) message.allMembers = [...group.members]; // 如果消息中没有，则使用当前群组的成员列表
        }

        const membersToSendTo = group.members.filter(memberId => {
            const memberContact = UserManager.contacts[memberId];
            return !(memberContact && memberContact.isAI) && // 不发给AI
                memberId !== UserManager.userId &&      // 不发给自己 (除非是测试或特殊情况，通常由调用者控制)
                !excludeIds.includes(memberId);         // 不发给排除列表中的人
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

    /**
     * 处理接收到的与群组相关的消息。
     * @param {object} message - 从数据通道接收到的消息对象。
     * @returns {Promise<void>}
     */
    handleGroupMessage: async function(message) {
        const { groupId, type, sender, originalSender } = message;
        let group = this.groups[groupId];
        Utils.log(`正在处理群组消息: ${groupId}, 类型: ${type}, 来自: ${sender}, 原始发送者: ${originalSender}`, Utils.logLevels.DEBUG);

        if (type === 'group-invite') {
            if (!this.groups[groupId]) { // 如果本地不存在此群组，则创建
                const inviterName = UserManager.contacts[message.invitedBy]?.name || message.invitedBy.substring(0,4);
                this.groups[groupId] = {
                    id: groupId, name: message.groupName, owner: message.owner,
                    members: message.members || [],
                    lastMessage: message.lastMessage || `您被 ${inviterName} 邀请加入群聊`,
                    lastTime: message.lastTime || new Date().toISOString(),
                    unread: 1,
                    leftMembers: message.leftMembers || [],
                    aiPrompts: message.aiPrompts || {} // 确保从邀请中获取aiPrompts
                };
                await this.saveGroup(groupId);
                ChatManager.renderChatList(ChatManager.currentFilter);
                NotificationUIManager.showNotification(`被邀请加入群组: ${message.groupName}`, 'success');

                // 新成员收到邀请后，尝试连接群内其他成员
                const myId = UserManager.userId;
                if (this.groups[groupId].members.includes(myId)) {
                    this.groups[groupId].members.forEach(memberId => {
                        if (memberId !== myId && !(UserManager.contacts[memberId] && UserManager.contacts[memberId].isAI)) {
                            Utils.log(`新成员 ${myId} 尝试连接群成员 ${memberId}`, Utils.logLevels.DEBUG);
                            ConnectionManager.createOffer(memberId, { isSilent: true });
                        }
                    });
                }

            } else { // 如果群组已存在 (例如，通过其他方式已加入或信息同步)
                group.members = message.members || group.members;
                group.aiPrompts = message.aiPrompts || group.aiPrompts || {}; // 合并或更新aiPrompts
                if (message.lastTime && (!group.lastTime || new Date(message.lastTime) > new Date(group.lastTime))) {
                    group.lastMessage = message.lastMessage || group.lastMessage;
                    group.lastTime = message.lastTime;
                }
                await this.saveGroup(groupId);
                if (ChatManager.currentChatId === groupId) this.openGroup(groupId);
                ChatManager.renderChatList(ChatManager.currentFilter);
            }
            return;
        }

        // 对于非邀请消息，如果群组不存在本地 (除非是被移除通知)，则忽略
        if (!group) {
            if (type === 'group-removed' && message.removedMemberId === UserManager.userId && message.reason === 'removed_by_owner') {
                // 允许处理被移除通知，即使群组在本地可能已被删除
            } else {
                Utils.log(`收到未知或本地已删除群组 ${groupId} 的消息。类型: ${type}。正在忽略。`, Utils.logLevels.WARN);
                return;
            }
        }

        // 移除中继逻辑，因为消息现在是直接发送的
        // if (message.needsRelay && group && group.owner === UserManager.userId) { ... }

        switch (type) {
            case 'text': case 'file': case 'image': case 'audio': case 'system':
                if (group && (originalSender || sender) !== UserManager.userId && group.members.includes(UserManager.userId)) {
                    ChatManager.addMessage(groupId, message);
                }
                break;
            case 'group-member-left': // 其他成员离开
                if (group && group.members.includes(message.leftMemberId)) {
                    group.members = group.members.filter(id => id !== message.leftMemberId);
                    const leftMemberName = message.leftMemberName || `用户 ${String(message.leftMemberId).substring(0,4)}`;
                    if (group.owner === UserManager.userId) { // 只有群主记录离开的成员
                        if(!group.leftMembers) group.leftMembers = [];
                        if(!group.leftMembers.find(lm => lm.id === message.leftMemberId)) {
                            group.leftMembers.push({ id: message.leftMemberId, name: leftMemberName, leftTime: new Date().toISOString() });
                        }
                        // 如果离开的成员是AI，也从特定提示词中移除
                        if (group.aiPrompts && group.aiPrompts[message.leftMemberId]) {
                            delete group.aiPrompts[message.leftMemberId];
                        }
                    }
                    await this.saveGroup(groupId);
                    if(group.members.includes(UserManager.userId)) { // 如果当前用户仍在群内
                        ChatManager.addMessage(groupId, { id: `sys_left_${Date.now()}`, type: 'system', content: `${leftMemberName} 离开了群聊。`, groupId: groupId, timestamp: new Date().toISOString()});
                        // 断开与离开成员的连接
                        ConnectionManager.close(message.leftMemberId);
                    }
                    if (ChatManager.currentChatId === groupId) {
                        this.openGroup(groupId);
                        if (typeof DetailsPanelUIManager !== 'undefined') DetailsPanelUIManager.updateDetailsPanelMembers(groupId);
                    }
                    ChatManager.renderChatList(ChatManager.currentFilter);
                }
                break;
            case 'group-removed': // 自己被群主移除
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
                        // 断开与所有剩余群成员的连接
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
            case 'group-dissolved': // 群组被解散
                if (group && sender !== UserManager.userId) { // 如果不是自己解散的
                    NotificationUIManager.showNotification(`群组 "${group.name}" 已被群主解散。`, 'warning');
                    // 断开与所有群成员（主要是群主）的连接
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
                        false, // 不是自己撤回的
                        retractedByName
                    );
                }
                break;
            case 'group-member-added': // 当其他成员（非自己）被添加时
                if (group && group.members.includes(UserManager.userId) && sender !== UserManager.userId) {
                    if (!group.members.includes(message.addedMemberId)) {
                        group.members.push(message.addedMemberId);
                        if (message.addedMemberDetails && !UserManager.contacts[message.addedMemberId]) { // 如果本地没有此联系人，则添加
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
                        // 更新群组特定提示词 (如果消息中携带了)
                        if (message.addedMemberDetails && message.addedMemberDetails.isAI && message.groupAiPrompt !== undefined) {
                            if (!group.aiPrompts) group.aiPrompts = {};
                            group.aiPrompts[message.addedMemberId] = message.groupAiPrompt;
                        }
                        await this.saveGroup(groupId);

                        const addedContactName = UserManager.contacts[message.addedMemberId]?.name || `用户 ${message.addedMemberId.substring(0,4)}`;
                        const inviterName = UserManager.contacts[sender]?.name || `用户 ${sender.substring(0,4)}`;
                        let systemContent = `${inviterName} 邀请 ${addedContactName} 加入了群聊。`;
                        if(UserManager.contacts[message.addedMemberId]?.isAI) systemContent += ` (${addedContactName} 是一个AI助手)`;

                        ChatManager.addMessage(groupId, { type: 'user', content: systemContent, timestamp: new Date().toISOString(), groupId: groupId });

                        // 当前用户尝试连接新加入的成员 (如果新成员不是AI)
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
            case 'group-member-removed': // 当其他成员（非自己）被移除时
                if (group && group.members.includes(UserManager.userId) && sender !== UserManager.userId) {
                    if (group.members.includes(message.removedMemberId)) {
                        group.members = group.members.filter(id => id !== message.removedMemberId);
                        // 如果移除的是AI成员，也从特定提示词中移除
                        if (group.aiPrompts && group.aiPrompts[message.removedMemberId]) {
                            delete group.aiPrompts[message.removedMemberId];
                        }
                        await this.saveGroup(groupId);

                        const removedContactName = UserManager.contacts[message.removedMemberId]?.name || `用户 ${message.removedMemberId.substring(0,4)}`;
                        const removerName = UserManager.contacts[sender]?.name || `用户 ${sender.substring(0,4)}`;
                        let systemContent = `${removerName} 已将 ${removedContactName} 移出群聊。`;

                        ChatManager.addMessage(groupId, { type: 'system', content: systemContent, timestamp: new Date().toISOString(), groupId: groupId });

                        // 断开与被移除成员的连接
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
                    const systemContent = `${updaterName} 更新了 AI "${aiName}" 在群组中的行为指示。`;
                    ChatManager.addMessage(groupId, { type: 'system', content: systemContent, timestamp: new Date().toISOString(), groupId: groupId });

                    // 如果当前聊天是此群组，且详情面板打开，则刷新详情面板
                    if (ChatManager.currentChatId === groupId && typeof DetailsPanelUIManager !== 'undefined' && DetailsPanelUIManager.isPanelAreaVisible && DetailsPanelUIManager.currentView === 'details') {
                        DetailsPanelUIManager._updateForGroup(groupId);
                    }
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

    /**
     * @description 通知群成员AI提示词已更改。
     *              此方法由 DetailsPanelUIManager 调用，当群主保存群组内AI的特定提示词后。
     * @param {string} groupId - 群组ID。
     * @param {string} aiMemberId - AI成员ID。
     * @param {string} newPrompt - 新的提示词。
     * @returns {void}
     */
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
        // 广播给除自己外的所有人类成员
        this.broadcastToGroup(groupId, promptUpdateMessage, [UserManager.userId]);

        const aiName = UserManager.contacts[aiMemberId]?.name || `AI ${aiMemberId.substring(0,4)}`;
        const systemMessageContent = `您更新了 AI "${aiName}" 在群组中的行为指示。`;
        const systemMessage = {
            id: `sys_prompt_update_local_${Date.now()}`, type: 'system',
            content: systemMessageContent, timestamp: new Date().toISOString(),
            groupId: groupId
        };
        ChatManager.addMessage(groupId, systemMessage); // 本地显示系统消息
    }
};