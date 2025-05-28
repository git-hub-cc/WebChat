/**
 * 群聊管理器 - 负责群聊的创建、管理、消息处理等功能
 */
const GroupManager = {
    // 存储所有群聊信息的对象，键为群聊ID，值为群聊数据
    groups: {},
    // 当前选中的群聊ID
    currentGroupId: null,

    /**
     * 初始化群聊管理器
     * 加载群聊数据并设置相关事件监听器
     */
    init: async function() {
        // 从数据库加载群聊
        await this.loadGroups();

        // 设置新建群聊按钮事件
        document.getElementById('newGroupBtn').addEventListener('click', () => {
            document.getElementById('newGroupForm').style.display = 'block';
        });

        // 取消新建群聊按钮事件
        document.getElementById('cancelNewGroupBtn').addEventListener('click', () => {
            document.getElementById('newGroupForm').style.display = 'none';
            document.getElementById('groupNameInput').value = '';
        });

        // 确认新建群聊按钮事件
        document.getElementById('confirmNewGroupBtn').addEventListener('click', () => {
            const groupName = document.getElementById('groupNameInput').value.trim();

            if (!groupName) {
                UIManager.showNotification('请输入群聊名称', 'warning');
                return;
            }

            this.createGroup(groupName);
            document.getElementById('newGroupForm').style.display = 'none';
            document.getElementById('groupNameInput').value = '';
        });

        // 设置成员管理按钮事件
        document.getElementById('manageMembersBtn').addEventListener('click', () => {
            this.showMemberManagement();
        });

        // 添加成员按钮事件
        document.getElementById('addMemberBtn').addEventListener('click', () => {
            const contactId = document.getElementById('contactsDropdown').value;
            if (contactId) {
                this.addMemberToGroup(this.currentGroupId, contactId);
            }
        });

        // 关闭模态窗口事件
        document.querySelector('.close-modal').addEventListener('click', () => {
            document.getElementById('memberManagementModal').style.display = 'none';
        });

        // 点击模态窗口外部关闭事件
        window.addEventListener('click', (event) => {
            const modal = document.getElementById('memberManagementModal');
            if (event.target === modal) {
                modal.style.display = 'none';
            }
        });
    },

    /**
     * 从数据库加载所有群聊数据
     */
    loadGroups: async function() {
        try {
            await DBManager.init();
            const groupItems = await DBManager.getAllItems('groups');
            this.groups = {};

            if (groupItems && groupItems.length > 0) {
                groupItems.forEach(group => {
                    this.groups[group.id] = group;
                });
                this.renderGroupList();
            }
        } catch (error) {
            Utils.log(`加载群聊失败: ${error}`, Utils.logLevels.ERROR);
            // 尝试从localStorage加载
            this.loadGroupsFromLocalStorage();
        }
    },

    /**
     * 保存所有群聊数据到数据库
     */
    saveGroups: async function() {
        try {
            for (const id in this.groups) {
                await DBManager.setItem('groups', this.groups[id]);
            }
        } catch (error) {
            Utils.log(`保存群聊失败: ${error}`, Utils.logLevels.ERROR);
        }
    },

    /**
     * 创建新群聊
     * @param {string} name - 群聊名称
     * @returns {string} 返回新创建的群聊ID
     */
    createGroup: async function(name) {
        // 生成唯一的群聊ID
        const groupId = 'group_' + Utils.generateId();
        // 创建群聊对象
        const group = {
            id: groupId,
            name: name,
            owner: UserManager.userId, // 创建者为群主
            members: [UserManager.userId], // 初始成员只有创建者
            lastMessage: '',
            lastTime: new Date().toISOString(),
            unread: 0
        };

        this.groups[groupId] = group;

        try {
            // 保存到数据库
            await DBManager.setItem('groups', group);
            this.renderGroupList();
            UIManager.showNotification(`群聊"${name}"已创建`, 'success');
            return groupId;
        } catch (error) {
            Utils.log(`创建群聊失败: ${error}`, Utils.logLevels.ERROR);
            // 备份到localStorage
            this.saveGroups();
            this.renderGroupList();
            UIManager.showNotification(`群聊"${name}"已创建`, 'success');
            return groupId;
        }
    },

    /**
     * 渲染聊天列表（私聊）
     * 注意：这个方法似乎放错了位置，应该在ChatManager中
     */
    renderChatList: function() {
        const chatList = document.getElementById('chatList');
        chatList.innerHTML = '';

        // 按最后消息时间排序联系人
        const sortedContacts = Object.values(UserManager.contacts).sort((a, b) => {
            return new Date(b.lastTime) - new Date(a.lastTime);
        });

        if (sortedContacts.length === 0) {
            chatList.innerHTML = '<div style="padding: 20px; text-align: center; color: #999;">暂无聊天，点击"添加新聊天"开始</div>';
            return;
        }

        // 渲染每个联系人的聊天项
        sortedContacts.forEach(contact => {
            const chatItem = document.createElement('div');
            chatItem.className = `chat-item ${contact.id === this.currentChatId ? 'active' : ''}`;
            chatItem.setAttribute('data-id', contact.id);

            const lastTime = new Date(contact.lastTime);
            const formattedTime = Utils.formatDate(lastTime);

            chatItem.innerHTML = `
            <div class="chat-avatar">${contact.name.charAt(0)}</div>
            <div class="chat-info">
                <div class="chat-name">${contact.name}</div>
                <div class="chat-preview">${contact.lastMessage || '暂无消息'}</div>
            </div>
            <div class="chat-meta">
                <div class="chat-time">${formattedTime}</div>
                ${contact.unread ? `<div class="chat-badge">${contact.unread > 99 ? '99+' : contact.unread}</div>` : ''}
            </div>
            <div class="delete-btn" style="display: none;">删除</div>
        `;

            // 点击聊天项事件
            chatItem.addEventListener('click', (e) => {
                // 如果点击的是删除按钮，不打开聊天
                if (e.target.classList.contains('delete-btn')) {
                    e.stopPropagation();
                    this.deleteChat(contact.id);
                    return;
                }
                this.openChat(contact.id);
            });

            // 鼠标悬浮显示删除按钮
            chatItem.addEventListener('mouseenter', () => {
                chatItem.querySelector('.delete-btn').style.display = 'block';
            });

            chatItem.addEventListener('mouseleave', () => {
                chatItem.querySelector('.delete-btn').style.display = 'none';
            });

            chatList.appendChild(chatItem);
        });
    },

    /**
     * 删除聊天记录
     * @param {string} chatId - 聊天ID
     */
    deleteChat: function(chatId) {
        // 确认对话框
        if (confirm('确定要删除此聊天吗？此操作将清空聊天记录且不可撤销。')) {
            // 清空聊天记录
            this.clearChat(chatId);

            // 从联系人列表中移除
            UserManager.removeContact(chatId);

            // 如果删除的是当前聊天，重置聊天界面
            if (chatId === this.currentChatId) {
                this.currentChatId = null;
                document.getElementById('currentChatTitle').textContent = '未选择聊天';
                document.getElementById('chatBox').innerHTML = '';

                // 禁用聊天界面
                UIManager.enableChatInterface(false);
            }

            // 更新联系人列表
            this.renderChatList();

            // 显示通知
            UIManager.showNotification('聊天已删除', 'info');
        }
    },

    /**
     * 打开群聊
     * @param {string} groupId - 群聊ID
     */
    openGroup: function(groupId) {
        // 保存之前的聊天记录
        if (ChatManager.currentChatId) {
            ChatManager.saveCurrentChat();
        }

        // 设置当前聊天和群聊ID
        ChatManager.currentChatId = groupId;
        this.currentGroupId = groupId;
        this.clearUnread(groupId);

        // 更新UI选中状态
        document.querySelectorAll('.group-item').forEach(item => {
            item.classList.toggle('active', item.getAttribute('data-id') === groupId);
        });

        // 设置聊天标题
        const group = this.groups[groupId];
        if (group) {
            document.getElementById('currentChatTitle').textContent = `${group.name} (${group.members.length}人)`;

            // 显示成员管理按钮（仅群主可见）
            const chatHeaderActions = document.getElementById('chatHeaderActions');
            if (group.owner === UserManager.userId) {
                chatHeaderActions.style.display = 'flex';
            } else {
                chatHeaderActions.style.display = 'none';
            }
        }

        // 加载聊天记录
        ChatManager.loadChatHistory(groupId);

        // 在移动设备上切换到聊天界面
        if (window.innerWidth <= 768) {
            document.querySelector('.container').classList.add('connected-mode');
        }

        // 启用聊天输入
        UIManager.enableChatInterface(true);

        // 聚焦输入框
        setTimeout(() => document.getElementById('messageInput').focus(), 100);
    },

    /**
     * 向群聊添加成员
     * @param {string} groupId - 群聊ID
     * @param {string} memberId - 要添加的成员ID
     * @returns {boolean} 是否添加成功
     */
    addMemberToGroup: async function(groupId, memberId) {
        const group = this.groups[groupId];
        if (!group) return false;

        // 检查是否已经是成员
        if (group.members.includes(memberId)) {
            UIManager.showNotification('该用户已在群聊中', 'warning');
            return false;
        }

        // 检查是否已连接
        if (!ConnectionManager.isConnectedTo(memberId)) {
            UIManager.showNotification('请先与该用户建立连接', 'warning');
            return false;
        }

        // 添加成员到群聊
        group.members.push(memberId);

        try {
            await DBManager.setItem('groups', group);

            // 更新成员管理界面
            this.showMemberManagement();

            // 更新群聊标题
            if (this.currentGroupId === groupId) {
                document.getElementById('currentChatTitle').textContent = `${group.name} (${group.members.length}人)`;
            }

            // 发送系统消息通知群内成员
            const systemMessage = {
                type: 'system',
                content: `${UserManager.contacts[memberId]?.name || memberId} 已加入群聊`,
                timestamp: new Date().toISOString()
            };

            // 添加到聊天记录
            ChatManager.addMessage(groupId, systemMessage);

            // 通知新成员已加入群聊
            const groupInfo = {
                type: 'group-invite',
                groupId: groupId,
                groupName: group.name,
                members: group.members,
                owner: group.owner,
                sender: UserManager.userId,
                timestamp: new Date().toISOString()
            };

            ConnectionManager.sendTo(memberId, groupInfo);

            // 通知其他成员有新成员加入
            const memberUpdate = {
                type: 'group-member-added',
                groupId: groupId,
                newMemberId: memberId,
                sender: UserManager.userId,
                timestamp: new Date().toISOString()
            };

            this.broadcastToGroup(groupId, memberUpdate, [memberId]);

            UIManager.showNotification(`已将 ${UserManager.contacts[memberId]?.name || memberId} 添加到群聊`, 'success');
            return true;
        } catch (error) {
            Utils.log(`添加群聊成员失败: ${error}`, Utils.logLevels.ERROR);
            // 备份到localStorage
            this.saveGroups();
            return true;
        }
    },

    /**
     * 从群聊中移除成员（仅群主可操作）
     * @param {string} groupId - 群聊ID
     * @param {string} memberId - 要移除的成员ID
     * @returns {boolean} 是否移除成功
     */
    removeMemberFromGroup: async function(groupId, memberId) {
        const group = this.groups[groupId];
        if (!group) return false;

        // 检查是否是群主
        if (group.owner !== UserManager.userId) {
            UIManager.showNotification('只有群主可以移除成员', 'error');
            return false;
        }

        // 从成员列表中移除
        const index = group.members.indexOf(memberId);
        if (index !== -1) {
            group.members.splice(index, 1);

            try {
                await DBManager.setItem('groups', group);

                // 更新成员管理界面
                this.showMemberManagement();

                // 更新群聊标题
                if (this.currentGroupId === groupId) {
                    document.getElementById('currentChatTitle').textContent = `${group.name} (${group.members.length}人)`;
                }

                // 发送系统消息
                const systemMessage = {
                    type: 'system',
                    content: `${UserManager.contacts[memberId]?.name || memberId} 已被移出群聊`,
                    timestamp: new Date().toISOString()
                };

                // 添加到聊天记录
                ChatManager.addMessage(groupId, systemMessage);

                // 通知被移除的成员
                const removeNotification = {
                    type: 'group-removed',
                    groupId: groupId,
                    reason: 'removed_by_owner',
                    sender: UserManager.userId,
                    timestamp: new Date().toISOString()
                };

                if (ConnectionManager.isConnectedTo(memberId)) {
                    ConnectionManager.sendTo(memberId, removeNotification);
                }

                // 通知其他成员
                const memberUpdate = {
                    type: 'group-member-removed',
                    groupId: groupId,
                    removedMemberId: memberId,
                    sender: UserManager.userId,
                    timestamp: new Date().toISOString()
                };

                this.broadcastToGroup(groupId, memberUpdate);

                UIManager.showNotification(`已将 ${UserManager.contacts[memberId]?.name || memberId} 移出群聊`, 'success');
                return true;
            } catch (error) {
                Utils.log(`移除群聊成员失败: ${error}`, Utils.logLevels.ERROR);
                // 备份到localStorage
                this.saveGroups();
                return true;
            }
        }

        return false;
    },

    /**
     * 清除群聊未读消息数
     * @param {string} groupId - 群聊ID
     */
    clearUnread: async function(groupId) {
        if (this.groups[groupId]) {
            this.groups[groupId].unread = 0;

            try {
                await DBManager.setItem('groups', this.groups[groupId]);
                this.renderGroupList();
            } catch (error) {
                Utils.log(`清除群聊未读数失败: ${error}`, Utils.logLevels.ERROR);
                // 备份到localStorage
                this.saveGroups();
                this.renderGroupList();
            }
        }
    },

    /**
     * 更新群聊最后一条消息
     * @param {string} groupId - 群聊ID
     * @param {string} message - 消息内容
     * @param {boolean} isUnread - 是否增加未读数
     */
    updateGroupLastMessage: async function(groupId, message, isUnread = false) {
        if (this.groups[groupId]) {
            this.groups[groupId].lastMessage = message;
            this.groups[groupId].lastTime = new Date().toISOString();
            if (isUnread) {
                this.groups[groupId].unread = (this.groups[groupId].unread || 0) + 1;
            }

            try {
                await DBManager.setItem('groups', this.groups[groupId]);
                this.renderGroupList();
            } catch (error) {
                Utils.log(`更新群聊最后消息失败: ${error}`, Utils.logLevels.ERROR);
                // 备份到localStorage
                this.saveGroups();
                this.renderGroupList();
            }
        }
    },

    /**
     * 处理群聊邀请消息
     * @param {Object} message - 邀请消息对象
     */
    handleGroupInvite: async function(message) {
        // 创建或更新本地群组信息
        this.groups[message.groupId] = {
            id: message.groupId,
            name: message.groupName,
            owner: message.owner,
            members: message.members,
            lastMessage: '您被邀请加入群聊',
            lastTime: message.timestamp,
            unread: 1
        };

        try {
            await DBManager.setItem('groups', this.groups[message.groupId]);
            this.renderGroupList();

            // 显示通知
            UIManager.showNotification(`您已被邀请加入群聊"${message.groupName}"`, 'info');
        } catch (error) {
            Utils.log(`保存群聊邀请失败: ${error}`, Utils.logLevels.ERROR);
            // 备份到localStorage
            this.saveGroups();
            this.renderGroupList();

            // 显示通知
            UIManager.showNotification(`您已被邀请加入群聊"${message.groupName}"`, 'info');
        }
    },

    /**
     * 处理被移出群聊的消息
     * @param {Object} message - 移除消息对象
     */
    handleGroupRemoval: async function(message) {
        const groupId = message.groupId;

        // 如果群组存在，移除它
        if (this.groups[groupId]) {
            // 如果当前正在查看该群组，关闭它
            if (this.currentGroupId === groupId) {
                this.currentGroupId = null;
                ChatManager.currentChatId = null;
                document.getElementById('currentChatTitle').textContent = '未选择聊天';
                document.getElementById('chatBox').innerHTML = '';
                document.getElementById('chatHeaderActions').style.display = 'none';
            }

            try {
                // 删除群组
                await DBManager.removeItem('groups', groupId);
                delete this.groups[groupId];
                this.renderGroupList();

                // 显示通知
                UIManager.showNotification('您已被移出群聊', 'warning');
            } catch (error) {
                Utils.log(`处理群聊移除失败: ${error}`, Utils.logLevels.ERROR);
                // 备份到localStorage
                delete this.groups[groupId];
                this.saveGroups();
                this.renderGroupList();

                // 显示通知
                UIManager.showNotification('您已被移出群聊', 'warning');
            }
        }
    },

    /**
     * 向群聊广播消息
     * @param {string} groupId - 群聊ID
     * @param {Object} message - 要广播的消息
     * @param {Array} excludeMembers - 排除的成员ID列表
     * @returns {boolean} 是否广播成功
     */
    broadcastToGroup: function(groupId, message, excludeMembers = []) {
        const group = this.groups[groupId];
        if (!group) return false;

        // 确保消息有发送者信息
        if (!message.sender) {
            message.sender = UserManager.userId;
        }

        // 添加原始发送者信息，用于追踪消息真实来源
        message.originalSender = message.sender;
        message.originalSenderName = UserManager.userName;

        // 确保消息有时间戳
        if (!message.timestamp) {
            message.timestamp = new Date().toISOString();
        }

        // 添加群组ID
        message.groupId = groupId;

        // 如果是群主，直接向所有成员广播
        if (group.owner === UserManager.userId) {
            let successCount = 0;

            // 向每个成员发送消息（排除自己和可能的排除列表）
            group.members.forEach(memberId => {
                if (memberId !== UserManager.userId && !excludeMembers.includes(memberId)) {
                    if (ConnectionManager.isConnectedTo(memberId)) {
                        // 发送文件消息需要使用sendInChunks
                        if (message.type === 'file' || message.type === 'image' || message.type === 'audio') {
                            Utils.sendInChunks(JSON.stringify(message),
                                (data) => ConnectionManager.connections[memberId].dataChannel.send(data));
                        } else {
                            ConnectionManager.sendTo(memberId, message);
                        }
                        successCount++;
                    }
                }
            });

            return successCount > 0;
        }
        // 如果不是群主，将消息发送给群主，由群主转发
        else if (ConnectionManager.isConnectedTo(group.owner)) {
            // 添加转发标记，表示这是需要群主转发的消息
            message.needsRelay = true;

            // 发送文件消息需要使用sendInChunks
            if (message.type === 'file' || message.type === 'image' || message.type === 'audio') {
                Utils.sendInChunks(JSON.stringify(message),
                    (data) => ConnectionManager.connections[group.owner].dataChannel.send(data));
                return true;
            } else {
                return ConnectionManager.sendTo(group.owner, message);
            }
        }

        return false;
    },

    /**
     * 渲染群聊列表
     */
    renderGroupList: function() {
        const groupList = document.getElementById('groupList');
        groupList.innerHTML = '';

        // 按最后消息时间排序群聊
        const sortedGroups = Object.values(this.groups).sort((a, b) => {
            return new Date(b.lastTime) - new Date(a.lastTime);
        });

        if (sortedGroups.length === 0) {
            groupList.innerHTML = '<div style="padding: 20px; text-align: center; color: #999;">暂无群聊，点击"创建新群聊"开始</div>';
            return;
        }

        // 渲染每个群聊项
        sortedGroups.forEach(group => {
            const groupItem = document.createElement('div');
            groupItem.className = `group-item ${group.id === this.currentGroupId ? 'active' : ''}`;
            groupItem.setAttribute('data-id', group.id);

            const lastTime = new Date(group.lastTime);
            const formattedTime = Utils.formatDate(lastTime);

            // 判断是群主还是普通成员，显示不同的操作按钮
            const isOwner = group.owner === UserManager.userId;
            const buttonText = isOwner ? '群解散' : '退群';
            const buttonClass = isOwner ? 'dissolve-btn' : 'leave-btn';

            groupItem.innerHTML = `
            <div class="group-avatar">👥</div>
            <div class="group-info">
                <div class="group-name">${group.name}</div>
                <div class="group-preview">${group.members.length}人 | ${group.lastMessage || '暂无消息'}</div>
            </div>
            <div class="group-meta">
                <div class="group-time">${formattedTime}</div>
                ${group.unread ? `<div class="chat-badge">${group.unread > 99 ? '99+' : group.unread}</div>` : ''}
            </div>
            <div class="${buttonClass}" style="display: none;">${buttonText}</div>
        `;

            // 点击群聊项事件
            groupItem.addEventListener('click', (e) => {
                // 如果点击的是按钮，不打开群聊
                if (e.target.classList.contains('leave-btn')) {
                    e.stopPropagation();
                    this.leaveGroup(group.id);
                    return;
                } else if (e.target.classList.contains('dissolve-btn')) {
                    e.stopPropagation();
                    this.dissolveGroup(group.id);
                    return;
                }
                this.openGroup(group.id);
            });

            // 鼠标悬浮显示操作按钮
            groupItem.addEventListener('mouseenter', () => {
                groupItem.querySelector(`.${buttonClass}`).style.display = 'block';
            });

            groupItem.addEventListener('mouseleave', () => {
                groupItem.querySelector(`.${buttonClass}`).style.display = 'none';
            });

            groupList.appendChild(groupItem);
        });
    },

    /**
     * 退出群聊（普通成员操作）
     * @param {string} groupId - 群聊ID
     */
    leaveGroup: async function(groupId) {
        if (confirm('确定要退出此群聊吗？此操作不可撤销。')) {
            const group = this.groups[groupId];
            if (!group) return;

            // 获取用户名称
            let userName = UserManager.userName;
            if (UserManager.contacts[UserManager.userId]) {
                userName = UserManager.contacts[UserManager.userId].name;
            }

            // 从成员列表中移除自己
            const index = group.members.indexOf(UserManager.userId);
            if (index !== -1) {
                // 创建系统消息，通知其他成员
                const systemMessage = {
                    type: 'system',
                    content: `${userName} 已退出群聊`,
                    timestamp: new Date().toISOString(),
                    sender: UserManager.userId
                };

                // 广播系统消息给群组其他成员
                this.broadcastToGroup(groupId, systemMessage);

                // 通知群主此成员已退出（便于群主识别并可以重新添加）
                const leaveMessage = {
                    type: 'group-member-left',
                    groupId: groupId,
                    leftMemberId: UserManager.userId,
                    leftMemberName: userName,
                    timestamp: new Date().toISOString(),
                    sender: UserManager.userId
                };
                this.broadcastToGroup(groupId, leaveMessage);

                // 清空群聊记录
                await ChatManager.clearChat(groupId);

                // 从群组中删除
                await DBManager.removeItem('groups', groupId);
                delete this.groups[groupId];

                // 如果当前正在查看该群聊，重置聊天界面
                if (this.currentGroupId === groupId) {
                    this.currentGroupId = null;
                    ChatManager.currentChatId = null;
                    document.getElementById('currentChatTitle').textContent = '未选择聊天';
                    document.getElementById('chatBox').innerHTML = '';
                    document.getElementById('chatHeaderActions').style.display = 'none';

                    // 禁用聊天界面
                    UIManager.enableChatInterface(false);
                }

                // 更新群聊列表
                this.renderGroupList();

                // 显示通知
                UIManager.showNotification('已退出群聊', 'info');
            }
        }
    },

    /**
     * 处理群聊成员变更消息
     * @param {Object} message - 成员变更消息
     */
    handleMembershipUpdate: async function(message) {
        const groupId = message.groupId;
        const group = this.groups[groupId];

        if (!group) return;

        // 根据消息类型更新成员列表
        if (message.type === 'group-member-added' && message.newMemberId) {
            // 添加新成员
            if (!group.members.includes(message.newMemberId)) {
                group.members.push(message.newMemberId);
            }
        } else if (message.type === 'group-member-removed' && message.removedMemberId) {
            // 移除成员
            const index = group.members.indexOf(message.removedMemberId);
            if (index !== -1) {
                group.members.splice(index, 1);
            }
        } else if (message.type === 'group-member-left' && message.leftMemberId) {
            // 成员主动退出
            const index = group.members.indexOf(message.leftMemberId);
            if (index !== -1) {
                group.members.splice(index, 1);

                // 如果当前用户是群主，记录退出成员的信息，以便重新添加
                if (group.owner === UserManager.userId) {
                    // 保存退出成员信息到群组数据中
                    if (!group.leftMembers) {
                        group.leftMembers = [];
                    }

                    group.leftMembers.push({
                        id: message.leftMemberId,
                        name: message.leftMemberName || `用户${message.leftMemberId.substring(0, 4)}`,
                        leftTime: message.timestamp
                    });
                }
            }
        }

        try {
            await DBManager.setItem('groups', group);

            // 如果当前正在查看该群组，更新标题
            if (this.currentGroupId === groupId) {
                document.getElementById('currentChatTitle').textContent = `${group.name} (${group.members.length}人)`;
            }
        } catch (error) {
            Utils.log(`更新群聊成员失败: ${error}`, Utils.logLevels.ERROR);
            // 备份到localStorage
            this.saveGroups();

            // 如果当前正在查看该群组，更新标题
            if (this.currentGroupId === groupId) {
                document.getElementById('currentChatTitle').textContent = `${group.name} (${group.members.length}人)`;
            }
        }
    },

    /**
     * 显示成员管理界面
     */
    showMemberManagement: function() {
        if (!this.currentGroupId) return;

        const group = this.groups[this.currentGroupId];
        if (!group) return;

        // 填充当前成员列表
        const memberList = document.getElementById('groupMemberList');
        memberList.innerHTML = '';

        group.members.forEach(memberId => {
            const memberItem = document.createElement('div');
            memberItem.className = 'member-item';

            // 确定成员名称
            let memberName = memberId;
            if (memberId === UserManager.userId) {
                memberName = `${UserManager.userName} (我)`;
            } else if (UserManager.contacts[memberId]) {
                memberName = UserManager.contacts[memberId].name;
            }

            // 标记群主
            const isOwner = memberId === group.owner;

            memberItem.innerHTML = `
            <div class="member-name">${memberName} ${isOwner ? '<span class="owner-badge">群主</span>' : ''}</div>
            ${!isOwner && group.owner === UserManager.userId ?
                `<button class="remove-member-btn" data-id="${memberId}">移除</button>` : ''}
        `;

            memberList.appendChild(memberItem);
        });

        // 为移除按钮添加事件
        memberList.querySelectorAll('.remove-member-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const memberId = e.target.getAttribute('data-id');
                this.removeMemberFromGroup(this.currentGroupId, memberId);
            });
        });

        // 添加已退出成员列表（仅群主可见）
        if (group.owner === UserManager.userId && group.leftMembers && group.leftMembers.length > 0) {
            const leftMembersSection = document.createElement('div');
            leftMembersSection.className = 'left-members-section';
            leftMembersSection.innerHTML = '<h4>已退出成员</h4>';

            const leftMembersList = document.createElement('div');
            leftMembersList.className = 'left-members-list';

            group.leftMembers.forEach(member => {
                const leftMemberItem = document.createElement('div');
                leftMemberItem.className = 'left-member-item';

                // 格式化退出时间
                const leftTime = new Date(member.leftTime);
                const formattedTime = Utils.formatDate(leftTime);

                leftMemberItem.innerHTML = `
                <div class="left-member-info">
                    <div class="left-member-name">${member.name}</div>
                    <div class="left-member-time">退出时间: ${formattedTime}</div>
                </div>
                <button class="readd-member-btn" data-id="${member.id}" data-name="${member.name}">重新添加</button>
            `;

                leftMembersList.appendChild(leftMemberItem);
            });

            leftMembersSection.appendChild(leftMembersList);
            memberList.appendChild(leftMembersSection);

            // 为重新添加按钮添加事件
            memberList.querySelectorAll('.readd-member-btn').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    const memberId = e.target.getAttribute('data-id');
                    const memberName = e.target.getAttribute('data-name');
                    this.readdMemberToGroup(this.currentGroupId, memberId, memberName);
                });
            });
        }

        // 填充联系人下拉列表（用于添加新成员）
        const contactsDropdown = document.getElementById('contactsDropdown');
        contactsDropdown.innerHTML = '<option value="">选择联系人...</option>';

        Object.values(UserManager.contacts).forEach(contact => {
            // 只显示未加入群的联系人
            if (!group.members.includes(contact.id)) {
                const option = document.createElement('option');
                option.value = contact.id;
                option.textContent = contact.name;
                contactsDropdown.appendChild(option);
            }
        });

        // 显示模态窗口
        document.getElementById('memberManagementModal').style.display = 'block';
    },

    /**
     * 重新添加已退出的成员到群聊
     * @param {string} groupId - 群聊ID
     * @param {string} memberId - 成员ID
     * @param {string} memberName - 成员名称
     * @returns {boolean} 是否添加成功
     */
    readdMemberToGroup: async function(groupId, memberId, memberName) {
        const group = this.groups[groupId];
        if (!group) return false;

        // 检查是否是群主
        if (group.owner !== UserManager.userId) {
            UIManager.showNotification('只有群主可以添加成员', 'error');
            return false;
        }

        // 检查是否已经是成员
        if (group.members.includes(memberId)) {
            UIManager.showNotification('该用户已在群聊中', 'warning');
            return false;
        }

        // 检查是否已连接
        if (!ConnectionManager.isConnectedTo(memberId)) {
            UIManager.showNotification('请先与该用户建立连接', 'warning');
            return false;
        }

        // 添加成员
        group.members.push(memberId);

        // 从leftMembers中移除
        if (group.leftMembers) {
            group.leftMembers = group.leftMembers.filter(member => member.id !== memberId);
        }

        try {
            await DBManager.setItem('groups', group);

            // 更新成员管理界面
            this.showMemberManagement();

            // 更新群聊标题
            if (this.currentGroupId === groupId) {
                document.getElementById('currentChatTitle').textContent = `${group.name} (${group.members.length}人)`;
            }

            // 发送系统消息
            const systemMessage = {
                type: 'system',
                content: `${memberName || memberId} 已被重新添加到群聊`,
                timestamp: new Date().toISOString()
            };

            // 添加到聊天记录
            ChatManager.addMessage(groupId, systemMessage);

            // 通知新成员已加入群聊
            const groupInfo = {
                type: 'group-invite',
                groupId: groupId,
                groupName: group.name,
                members: group.members,
                owner: group.owner,
                sender: UserManager.userId,
                timestamp: new Date().toISOString()
            };

            ConnectionManager.sendTo(memberId, groupInfo);

            // 通知其他成员有新成员加入
            const memberUpdate = {
                type: 'group-member-added',
                groupId: groupId,
                newMemberId: memberId,
                newMemberName: memberName,
                sender: UserManager.userId,
                timestamp: new Date().toISOString()
            };

            this.broadcastToGroup(groupId, memberUpdate, [memberId]);

            UIManager.showNotification(`已将 ${memberName || memberId} 重新添加到群聊`, 'success');
            return true;
        } catch (error) {
            Utils.log(`重新添加群聊成员失败: ${error}`, Utils.logLevels.ERROR);
            // 备份到localStorage
            this.saveGroups();
            return true;
        }
    },

    /**
     * 解散群聊（仅群主可操作）
     * @param {string} groupId - 群聊ID
     */
    dissolveGroup: async function(groupId) {
        if (confirm('确定要解散此群聊吗？所有成员将被移出，且此操作不可撤销。')) {
            const group = this.groups[groupId];
            if (!group || group.owner !== UserManager.userId) return;

            // 通知所有成员群聊已解散
            const dissolveMessage = {
                type: 'group-dissolved',
                groupId: groupId,
                timestamp: new Date().toISOString(),
                sender: UserManager.userId
            };
            this.broadcastToGroup(groupId, dissolveMessage);

            // 清空群聊记录
            await ChatManager.clearChat(groupId);

            // 从群组中删除
            await DBManager.removeItem('groups', groupId);
            delete this.groups[groupId];

            // 如果当前正在查看该群聊，重置聊天界面
            if (this.currentGroupId === groupId) {
                this.currentGroupId = null;
                ChatManager.currentChatId = null;
                document.getElementById('currentChatTitle').textContent = '未选择聊天';
                document.getElementById('chatBox').innerHTML = '';
                document.getElementById('chatHeaderActions').style.display = 'none';

                // 禁用聊天界面
                UIManager.enableChatInterface(false);
            }

            // 更新群聊列表
            this.renderGroupList();

            // 显示通知
            UIManager.showNotification('群聊已解散', 'info');
        }
    },

    /**
     * 处理群聊消息的主要入口函数
     * @param {Object} message - 接收到的消息对象
     * @returns {boolean} 是否成功处理消息
     */
    handleGroupMessage: function(message) {
        const groupId = message.groupId;

        // 检查是否是群组消息
        if (!groupId || !message.type) return false;

        // 如果是群主收到的消息，且需要转发
        if (message.needsRelay) {
            const group = this.groups[groupId];
            if (group && group.owner === UserManager.userId) {
                // 移除转发标记，防止循环转发
                delete message.needsRelay;

                // 转发时保留原始发送者信息
                // 群主转发消息时，不修改sender，确保消息显示的是真实发送者
                this.broadcastToGroup(groupId, message, [message.originalSender]);
            }
        }

        // 根据消息类型进行不同处理
        switch (message.type) {
            case 'group-invite':
                // 处理群组邀请
                this.handleGroupInvite(message);
                break;

            case 'group-removed':
                // 处理被移出群组
                this.handleGroupRemoval(message);
                break;

            case 'group-dissolved':
                // 处理群组解散
                this.handleGroupDissolved(message);
                break;

            case 'group-member-added':
            case 'group-member-removed':
            case 'group-member-left':
                // 更新群组成员信息
                this.handleMembershipUpdate(message);
                break;

            case 'text':
            case 'file':
            case 'image':
            case 'audio':
                // 处理普通消息
                if (this.groups[groupId]) {
                    // 添加到聊天记录，保留原始发送者信息
                    ChatManager.addMessage(groupId, message);

                    // 更新群组最后消息预览
                    let previewText = '';
                    const displayName = message.originalSenderName ||
                        (UserManager.contacts[message.originalSender]?.name) ||
                        '用户';

                    if (message.type === 'text') {
                        previewText = `${displayName}: ${message.content}`;
                    } else if (message.type === 'file' || message.type === 'image') {
                        if (message.fileType?.startsWith('image/')) {
                            previewText = `${displayName}: [图片]`;
                        } else if (message.fileType?.startsWith('video/')) {
                            previewText = `${displayName}: [视频]`;
                        } else if (message.fileType?.startsWith('audio/')) {
                            previewText = `${displayName}: [音频]`;
                        } else {
                            previewText = `${displayName}: [文件]`;
                        }
                    } else if (message.type === 'audio') {
                        previewText = `${displayName}: [语音]`;
                    }

                    this.updateGroupLastMessage(
                        groupId,
                        previewText,
                        this.currentGroupId !== groupId
                    );
                }
                break;

            case 'system':
                // 处理系统消息
                if (this.groups[groupId]) {
                    ChatManager.addMessage(groupId, message);
                }
                break;
        }

        return true;
    },

    /**
     * 处理群聊解散消息
     * @param {Object} message - 解散消息对象
     */
    handleGroupDissolved: async function(message) {
        const groupId = message.groupId;

        // 如果群组存在且不是自己解散的，则处理解散消息
        if (this.groups[groupId] && message.sender !== UserManager.userId) {
            // 如果当前正在查看该群组，关闭它
            if (this.currentGroupId === groupId) {
                this.currentGroupId = null;
                ChatManager.currentChatId = null;
                document.getElementById('currentChatTitle').textContent = '未选择聊天';
                document.getElementById('chatBox').innerHTML = '';
                document.getElementById('chatHeaderActions').style.display = 'none';

                // 禁用聊天界面
                UIManager.enableChatInterface(false);
            }

            try {
                // 清空群聊记录
                await ChatManager.clearChat(groupId);

                // 删除群组
                await DBManager.removeItem('groups', groupId);
                delete this.groups[groupId];
                this.renderGroupList();

                // 显示通知
                UIManager.showNotification('群主已解散群聊', 'warning');
            } catch (error) {
                Utils.log(`处理群聊解散失败: ${error}`, Utils.logLevels.ERROR);
                // 备份到localStorage
                delete this.groups[groupId];
                this.saveGroups();
                this.renderGroupList();

                // 显示通知
                UIManager.showNotification('群主已解散群聊', 'warning');
            }
        }
    }

};