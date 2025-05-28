
const ChatManager = {
    // 当前打开的聊天ID
    currentChatId: null,

    // 所有聊天记录的存储对象，格式：{ chatId: [messages] }
    chats: {},

    /**
     * 初始化聊天管理器
     * 设置各种事件监听器，加载聊天记录
     */
    init: async function() {
        // 初始化联系人列表，从数据库加载历史聊天记录
        await this.loadChats();

        // 设置新建聊天按钮事件监听器
        document.getElementById('newChatBtn').addEventListener('click', () => {
            // 显示新建聊天表单
            document.getElementById('newChatForm').style.display = 'block';
        });

        // 设置清空联系人列表按钮事件监听器
        document.getElementById('clearContactsBtn').addEventListener('click', () => {
            // 调用用户管理器清空所有联系人
            UserManager.clearAllContacts();
        });

        // 设置取消新建聊天按钮事件监听器
        document.getElementById('cancelNewChatBtn').addEventListener('click', () => {
            // 隐藏新建聊天表单并清空输入框
            document.getElementById('newChatForm').style.display = 'none';
            document.getElementById('peerIdInput').value = '';
            document.getElementById('peerNameInput').value = '';
        });

        // 设置确认新建聊天按钮事件监听器
        document.getElementById('confirmNewChatBtn').addEventListener('click', () => {
            // 获取输入的对方ID和昵称
            const peerId = document.getElementById('peerIdInput').value.trim();
            const peerName = document.getElementById('peerNameInput').value.trim() || `用户${peerId.substring(0, 4)}`;

            // 验证对方ID是否为空
            if (!peerId) {
                UIManager.showNotification('请输入对方ID', 'warning');
                return;
            }

            // 尝试添加新联系人
            if (UserManager.addContact(peerId, peerName)) {
                // 添加成功后隐藏表单并清空输入框
                document.getElementById('newChatForm').style.display = 'none';
                document.getElementById('peerIdInput').value = '';
                document.getElementById('peerNameInput').value = '';

                // 切换到联系人列表选项卡
                document.querySelector('.connection-tab[data-tab="chats"]').click();
            }
        });

        // 设置选项卡切换功能（聊天列表、群组等）
        document.querySelectorAll('.connection-tab').forEach(tab => {
            tab.addEventListener('click', () => {
                // 移除所有选项卡的激活状态
                document.querySelectorAll('.connection-tab').forEach(t => t.classList.remove('active'));
                // 激活当前点击的选项卡
                tab.classList.add('active');

                // 获取选项卡名称并切换对应的面板
                const tabName = tab.getAttribute('data-tab');
                document.querySelectorAll('.connection-panel').forEach(panel => {
                    panel.classList.remove('active');
                });
                document.getElementById(`${tabName}Panel`).classList.add('active');
            });
        });
    },

    /**
     * 从数据库加载所有聊天记录
     * 优先从IndexedDB加载，失败时回退到localStorage
     */
    loadChats: async function() {
        try {
            // 初始化数据库管理器
            await DBManager.init();
            // 获取所有聊天记录
            const chatItems = await DBManager.getAllItems('chats');
            this.chats = {};

            // 如果有聊天记录，将其加载到内存中
            if (chatItems && chatItems.length > 0) {
                chatItems.forEach(item => {
                    this.chats[item.id] = item.messages || [];
                });
            }
        } catch (error) {
            // 数据库加载失败时记录错误日志
            Utils.log(`加载聊天记录失败: ${error}`, Utils.logLevels.ERROR);
            // 尝试从localStorage加载作为备选方案
            this.loadChatsFromLocalStorage();
        }
    },

    /**
     * 保存当前聊天记录到数据库
     * 只保存当前激活的聊天记录以提高性能
     */
    saveChats: async function() {
        if (this.currentChatId) {
            try {
                // 将当前聊天记录保存到IndexedDB
                await DBManager.setItem('chats', {
                    id: this.currentChatId,
                    messages: this.chats[this.currentChatId] || []
                });

            } catch (error) {
                // 保存失败时记录错误日志
                Utils.log(`保存聊天记录失败: ${error}`, Utils.logLevels.ERROR);
            }
        }
    },

    /**
     * 渲染聊天列表界面
     * 显示所有联系人和最近的聊天信息，按最后活动时间排序
     */
    renderChatList: function() {
        const chatList = document.getElementById('chatList');
        chatList.innerHTML = '';

        // 按最后活动时间对联系人进行排序（最新的在前）
        const sortedContacts = Object.values(UserManager.contacts).sort((a, b) => {
            return new Date(b.lastTime) - new Date(a.lastTime);
        });

        // 如果没有联系人，显示提示信息
        if (sortedContacts.length === 0) {
            chatList.innerHTML = '<div style="padding: 20px; text-align: center; color: #999;">暂无聊天，点击"添加新聊天"开始</div>';
            return;
        }

        // 为每个联系人创建聊天项目
        sortedContacts.forEach(contact => {
            const chatItem = document.createElement('div');
            // 设置聊天项目的样式类，当前聊天会添加active类
            chatItem.className = `chat-item ${contact.id === this.currentChatId ? 'active' : ''}`;
            chatItem.setAttribute('data-id', contact.id);

            // 格式化最后活动时间
            const lastTime = new Date(contact.lastTime);
            const formattedTime = Utils.formatDate(lastTime);

            // 构建聊天项目的HTML结构
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

            // 添加点击事件监听器
            chatItem.addEventListener('click', (e) => {
                // 如果点击的是删除按钮，执行删除操作而不是打开聊天
                if (e.target.classList.contains('delete-btn')) {
                    e.stopPropagation(); // 阻止事件冒泡
                    this.deleteChat(contact.id);
                    return;
                }
                // 否则打开对应的聊天
                this.openChat(contact.id);
            });

            // 添加鼠标悬浮事件，显示删除按钮
            chatItem.addEventListener('mouseenter', () => {
                chatItem.querySelector('.delete-btn').style.display = 'block';
            });

            // 添加鼠标离开事件，隐藏删除按钮
            chatItem.addEventListener('mouseleave', () => {
                chatItem.querySelector('.delete-btn').style.display = 'none';
            });

            // 将聊天项目添加到聊天列表中
            chatList.appendChild(chatItem);
        });
    },

    /**
     * 删除指定的聊天记录
     * @param {string} chatId - 要删除的聊天ID
     */
    deleteChat: function(chatId) {
        // 显示确认对话框
        if (confirm('确定要删除此聊天吗？此操作将清空聊天记录且不可撤销。')) {
            // 清空该聊天的所有消息记录
            this.clearChat(chatId);

            // 从联系人列表中移除该联系人
            UserManager.removeContact(chatId);

            // 如果删除的是当前正在查看的聊天，重置聊天界面
            if (chatId === this.currentChatId) {
                this.currentChatId = null;
                document.getElementById('currentChatTitle').textContent = '未选择聊天';
                document.getElementById('chatBox').innerHTML = '';

                // 禁用聊天界面的输入功能
                UIManager.enableChatInterface(false);
            }

            // 重新渲染联系人列表以反映删除操作
            this.renderChatList();

            // 显示删除成功的通知
            UIManager.showNotification('聊天已删除', 'info');
        }
    },

    /**
     * 打开指定的聊天
     * @param {string} chatId - 要打开的聊天ID
     */
    openChat: function(chatId) {
        // 如果当前有其他聊天打开，先保存其聊天记录
        if (this.currentChatId) {
            this.saveCurrentChat();
        }

        // 设置当前聊天ID
        this.currentChatId = chatId;

        // 检查是否是群聊（群聊ID以'group_'开头）
        if (chatId.startsWith('group_')) {
            // 如果是群聊，交给群聊管理器处理
            GroupManager.openGroup(chatId);
            return;
        }

        // 个人聊天处理逻辑
        // 清除该联系人的未读消息计数
        UserManager.clearUnread(chatId);

        // 更新聊天列表UI，标记当前活跃的聊天项目
        document.querySelectorAll('.chat-item').forEach(item => {
            item.classList.toggle('active', item.getAttribute('data-id') === chatId);
        });

        // 设置聊天窗口标题为联系人姓名
        const contact = UserManager.contacts[chatId];
        if (contact) {
            document.getElementById('currentChatTitle').textContent = contact.name;
        }

        // 隐藏群聊成员管理按钮（个人聊天不需要）
        document.getElementById('chatHeaderActions').style.display = 'none';

        // 加载并显示该聊天的历史消息记录
        this.loadChatHistory(chatId);

        // 在移动设备上切换到聊天界面（响应式设计）
        if (window.innerWidth <= 768) {
            document.querySelector('.container').classList.add('connected-mode');
        }

        // 启用聊天输入框和相关功能
        UIManager.enableChatInterface(true);

        // 检查与该联系人的连接状态
        const isConnected = ConnectionManager.isConnectedTo(chatId);

        // 根据连接状态更新视频通话按钮的可用性
        document.getElementById('videoCallButton').disabled = !isConnected;

        // 如果连接未建立，在聊天框中添加系统提示消息
        if (!isConnected) {
            const chatBox = document.getElementById('chatBox');
            const systemMessage = document.createElement('div');
            systemMessage.className = 'system-message';
            systemMessage.textContent = '连接未建立，发送消息时将提示重新连接';
            chatBox.appendChild(systemMessage);
            chatBox.scrollTop = chatBox.scrollHeight;
        }

        // 延迟聚焦到消息输入框，确保界面完全加载
        setTimeout(() => document.getElementById('messageInput').focus(), 100);
    },

    /**
     * 加载指定聊天的历史消息记录
     * @param {string} chatId - 聊天ID
     */
    loadChatHistory: function(chatId) {
        const chatBox = document.getElementById('chatBox');
        chatBox.innerHTML = ''; // 清空聊天框

        // 如果该聊天没有消息记录，初始化为空数组
        if (!this.chats[chatId]) {
            this.chats[chatId] = [];
            return;
        }

        // 遍历并显示所有历史消息
        this.chats[chatId].forEach(msg => {
            // 判断消息是否为当前用户发送（用于显示样式区分）
            MessageManager.displayMessage(msg, msg.sender === UserManager.userId);
        });

        // 滚动聊天框到底部显示最新消息
        chatBox.scrollTop = chatBox.scrollHeight;
    },

    /**
     * 保存当前打开的聊天记录
     */
    saveCurrentChat: function() {
        if (this.currentChatId) {
            this.saveChats();
        }
    },

    /**
     * 向指定聊天添加新消息
     * @param {string} chatId - 聊天ID
     * @param {Object} message - 消息对象
     */
    addMessage: async function(chatId, message) {
        // 如果该聊天没有消息数组，创建一个
        if (!this.chats[chatId]) {
            this.chats[chatId] = [];
        }

        // 将新消息添加到消息数组中
        this.chats[chatId].push(message);

        // 如果是当前打开的聊天，立即显示新消息
        if (chatId === this.currentChatId) {
            MessageManager.displayMessage(message, message.sender === UserManager.userId);
            // 滚动到聊天框底部显示新消息
            document.getElementById('chatBox').scrollTop = document.getElementById('chatBox').scrollHeight;
        } else {
            // 如果不是当前聊天，更新未读消息计数
            if (chatId.startsWith('group_')) {
                // 群聊消息处理
                GroupManager.updateGroupLastMessage(
                    chatId,
                    message.type === 'text' ? message.content : '[媒体消息]',
                    true
                );
            } else {
                // 个人聊天消息处理
                UserManager.updateContactLastMessage(
                    chatId,
                    message.type === 'text' ? message.content : '[媒体消息]',
                    true
                );
            }
        }

        try {
            // 将更新后的消息记录保存到IndexedDB
            await DBManager.setItem('chats', {
                id: chatId,
                messages: this.chats[chatId]
            });
        } catch (error) {
            // 保存失败时记录错误日志
            Utils.log(`保存消息失败: ${error}`, Utils.logLevels.ERROR);
        }
    },

    /**
     * 清空指定聊天的所有消息记录
     * @param {string} chatId - 聊天ID
     * @returns {boolean} 操作是否成功
     */
    clearChat: async function(chatId) {
        if (chatId) {
            // 清空内存中的消息记录
            this.chats[chatId] = [];

            try {
                // 将空的消息数组保存到数据库
                await DBManager.setItem('chats', {
                    id: chatId,
                    messages: []
                });

                // 如果是当前聊天，清空聊天框显示
                if (chatId === this.currentChatId) {
                    document.getElementById('chatBox').innerHTML = '';
                }

                return true;
            } catch (error) {
                // 即使数据库操作失败，也清空界面显示
                Utils.log(`清空聊天记录失败: ${error}`, Utils.logLevels.ERROR);

                if (chatId === this.currentChatId) {
                    document.getElementById('chatBox').innerHTML = '';
                }

                return true;
            }
        }
        return false;
    },

    /**
     * 清空所有聊天记录
     * 包括内存中的记录和数据库中的记录
     * @returns {boolean} 操作是否成功
     */
    clearAllChats: async function() {
        // 显示确认对话框
        if (!confirm('确定要清空所有聊天记录吗？此操作不可撤销。')) {
            return;
        }

        // 清空内存中的所有聊天记录
        this.chats = {};

        try {
            // 清空数据库中的聊天记录存储
            await DBManager.clearStore('chats');

            // 如果当前有打开的聊天，清空聊天框并显示提示
            if (this.currentChatId) {
                document.getElementById('chatBox').innerHTML = '';

                // 添加系统消息提示用户操作已完成
                const systemMessage = document.createElement('div');
                systemMessage.className = 'system-message';
                systemMessage.textContent = '所有聊天记录已清空';
                document.getElementById('chatBox').appendChild(systemMessage);
            }

            // 重置所有联系人的最后消息和未读计数
            for (const contactId in UserManager.contacts) {
                UserManager.contacts[contactId].lastMessage = '';
                UserManager.contacts[contactId].unread = 0;
            }
            UserManager.saveContacts();

            // 重置所有群组的最后消息和未读计数
            for (const groupId in GroupManager.groups) {
                GroupManager.groups[groupId].lastMessage = '';
                GroupManager.groups[groupId].unread = 0;
            }
            GroupManager.saveGroups();

            // 重新渲染联系人列表以反映更改
            this.renderChatList();

            // 显示成功通知给用户
            UIManager.showNotification('所有聊天记录已清空', 'info');
            Utils.log('所有聊天记录已清空', Utils.logLevels.INFO);

            return true;
        } catch (error) {
            // 即使数据库操作失败，也完成界面清理
            Utils.log(`清空所有聊天记录失败: ${error}`, Utils.logLevels.ERROR);

            // 清空当前聊天界面并显示提示
            if (this.currentChatId) {
                document.getElementById('chatBox').innerHTML = '';

                const systemMessage = document.createElement('div');
                systemMessage.className = 'system-message';
                systemMessage.textContent = '所有聊天记录已清空';
                document.getElementById('chatBox').appendChild(systemMessage);
            }

            // 重新渲染联系人列表
            this.renderChatList();

            return true;
        }
    }
};