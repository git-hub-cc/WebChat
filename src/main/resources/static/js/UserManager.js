const UserManager = {
    // 当前用户的唯一标识符
    userId: null,
    // 当前用户显示名称，默认为"我"
    userName: '我',
    // 联系人列表对象，以联系人ID为键
    contacts: {},

    /**
     * 初始化用户管理模块
     * 获取/生成用户ID，设置UI事件，加载联系人列表
     */
    init: async function() {
        try {
            // 确保数据库已初始化并可用
            await DBManager.init();

            // 尝试从数据库获取现有用户信息，若不存在则创建新用户
            const userData = await DBManager.getItem('user', 'current');
            if (userData) {
                // 用户已存在，加载用户ID
                this.userId = userData.userId;
            } else {
                // 生成新用户ID并保存到数据库
                this.userId = Utils.generateId();
                await DBManager.setItem('user', {
                    id: 'current',
                    userId: this.userId
                });
            }

            // 在UI上显示用户ID
            document.getElementById('userIdValue').textContent = this.userId;
            this.userName = this.userId;

            // 设置"复制ID"按钮的点击事件处理
            document.getElementById('copyIdBtn').addEventListener('click', () => {
                navigator.clipboard.writeText(this.userId)
                    .then(() => UIManager.showNotification('ID已复制到剪贴板', 'success'))
                    .catch(() => UIManager.showNotification('复制失败，请手动复制', 'error'));
            });

            // 从数据库加载用户的联系人列表
            await this.loadContacts();
        } catch (error) {
            // 初始化失败时的错误处理
            Utils.log(`用户初始化失败: ${error}`, Utils.logLevels.ERROR);

            // 回退方案：生成临时用户ID并显示
            this.userId = Utils.generateId();
            document.getElementById('userIdValue').textContent = this.userId;

            // 尝试从localStorage加载联系人作为备用方案
            this.loadContactsFromLocalStorage();
        }
    },

    /**
     * 从数据库加载联系人列表
     * 成功后会更新聊天列表UI
     */
    loadContacts: async function() {
        try {
            // 从数据库获取所有联系人记录
            const contacts = await DBManager.getAllItems('contacts');
            // 重置联系人对象
            this.contacts = {};

            // 如果存在联系人记录，填充联系人对象
            if (contacts && contacts.length > 0) {
                contacts.forEach(contact => {
                    this.contacts[contact.id] = contact;
                });
                // 更新聊天列表UI
                ChatManager.renderChatList();
            }
        } catch (error) {
            // 加载失败时的错误处理
            Utils.log(`加载联系人失败: ${error}`, Utils.logLevels.ERROR);
            this.contacts = {};

            // 尝试从localStorage加载作为备用方案
            this.loadContactsFromLocalStorage();
        }
    },

    /**
     * 将联系人列表保存到数据库
     * 作为其他操作的辅助函数
     */
    saveContacts: async function() {
        try {
            // 遍历所有联系人并逐个保存到数据库
            for (const id in this.contacts) {
                await DBManager.setItem('contacts', this.contacts[id]);
            }
        } catch (error) {
            // 保存失败时记录错误
            Utils.log(`保存联系人失败: ${error}`, Utils.logLevels.ERROR);
        }
    },

    /**
     * 添加新联系人
     * @param {string} id - 联系人的唯一ID
     * @param {string} name - 联系人显示名称（可选）
     * @return {boolean} - 添加是否成功
     */
    addContact: async function(id, name) {
        // 检查是否尝试添加自己为联系人
        if (id === this.userId) {
            UIManager.showNotification('不能添加自己为联系人', 'error');
            return false;
        }

        // 检查联系人是否已存在
        if (this.contacts[id]) {
            UIManager.showNotification('该联系人已存在', 'warning');
            return false;
        }

        // 创建新联系人对象
        const contact = {
            id: id,
            // 如果未提供名称，使用ID的前4个字符作为默认名
            name: name || `用户${id.substring(0, 4)}`,
            lastMessage: '',
            lastTime: new Date().toISOString(),
            unread: 0
        };

        // 添加到内存中的联系人列表
        this.contacts[id] = contact;

        try {
            // 保存到数据库
            await DBManager.setItem('contacts', contact);
            // 更新聊天列表UI
            ChatManager.renderChatList();
            return true;
        } catch (error) {
            // 保存失败时的错误处理
            Utils.log(`添加联系人失败: ${error}`, Utils.logLevels.ERROR);

            // 备份策略：尝试保存到localStorage
            this.saveContacts();
            ChatManager.renderChatList();
            return true; // 即使数据库操作失败，内存中已添加成功
        }
    },

    /**
     * 删除联系人
     * @param {string} id - 要删除的联系人ID
     * @return {boolean} - 删除是否成功
     */
    removeContact: async function(id) {
        if (this.contacts[id]) {
            // 从内存中删除
            delete this.contacts[id];

            try {
                // 从数据库中删除
                await DBManager.removeItem('contacts', id);
                // 更新聊天列表UI
                ChatManager.renderChatList();
                return true;
            } catch (error) {
                // 数据库操作失败时的错误处理
                Utils.log(`删除联系人失败: ${error}`, Utils.logLevels.ERROR);

                // 备份策略：保存当前内存状态到localStorage
                await this.saveContacts();
                ChatManager.renderChatList();
                return true; // 即使数据库操作失败，内存中已删除成功
            }
        }
        return false; // 联系人不存在
    },

    /**
     * 更新联系人的最后消息信息
     * @param {string} id - 联系人ID
     * @param {string} message - 最后一条消息内容
     * @param {boolean} isUnread - 是否为未读消息
     */
    updateContactLastMessage: async function(id, message, isUnread = false) {
        if (this.contacts[id]) {
            // 更新联系人的最后消息和时间
            this.contacts[id].lastMessage = message;
            this.contacts[id].lastTime = new Date().toISOString();

            // 如果是未读消息，增加未读计数
            if (isUnread) {
                this.contacts[id].unread = (this.contacts[id].unread || 0) + 1;
            }

            try {
                // 保存更新到数据库
                await DBManager.setItem('contacts', this.contacts[id]);
                // 更新聊天列表UI
                ChatManager.renderChatList();
            } catch (error) {
                // 更新失败时的错误处理
                Utils.log(`更新联系人最后消息失败: ${error}`, Utils.logLevels.ERROR);

                // 备份策略：保存到localStorage
                this.saveContacts();
                ChatManager.renderChatList();
            }
        }
    },

    /**
     * 清除联系人的未读消息计数
     * @param {string} id - 联系人ID
     */
    clearUnread: async function(id) {
        if (this.contacts[id]) {
            // 重置未读计数
            this.contacts[id].unread = 0;

            try {
                // 保存更新到数据库
                await DBManager.setItem('contacts', this.contacts[id]);
                // 更新聊天列表UI
                ChatManager.renderChatList();
            } catch (error) {
                // 更新失败时的错误处理
                Utils.log(`清除未读数失败: ${error}`, Utils.logLevels.ERROR);

                // 备份策略：保存到localStorage
                this.saveContacts();
                ChatManager.renderChatList();
            }
        }
    },

    /**
     * 清空所有联系人列表
     * 需用户确认后执行
     * @return {boolean} - 清空是否成功
     */
    clearAllContacts: async function() {
        // 用户确认对话框
        if (!confirm('确定要清空所有聊天吗？此操作不可撤销。')) {
            return false;
        }

        // 备份当前联系人ID列表，用于后续关闭连接
        const contactIds = Object.keys(this.contacts);

        // 清空内存中的联系人对象
        this.contacts = {};

        try {
            // 清空数据库中的联系人存储
            await DBManager.clearStore('contacts');

            // 关闭所有活跃的连接
            contactIds.forEach(peerId => {
                if (ConnectionManager.connections[peerId]) {
                    ConnectionManager.close(peerId);
                }
            });

            // 更新聊天列表UI
            ChatManager.renderChatList();

            // 清空当前聊天界面
            if (ChatManager.currentChatId) {
                ChatManager.currentChatId = null;
                document.getElementById('currentChatTitle').textContent = '未选择聊天';
                document.getElementById('chatBox').innerHTML = '';

                // 禁用聊天界面交互
                UIManager.enableChatInterface(false);
            }

            // 通知用户操作成功
            UIManager.showNotification('所有联系人已清空', 'info');
            Utils.log('所有联系人已清空', Utils.logLevels.INFO);

            return true;
        } catch (error) {
            // 清空失败时的错误处理
            Utils.log(`清空联系人失败: ${error}`, Utils.logLevels.ERROR);
            return true; // 内存中已清空，即使数据库操作失败
        }
    }
};