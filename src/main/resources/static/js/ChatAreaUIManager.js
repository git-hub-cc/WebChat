/**
 * @file ChatAreaUIManager.js
 * @description 管理主聊天区域的 UI 元素和交互，包括聊天头部、消息框、输入区以及通话和截图按钮。
 *              支持消息的右键/双击上下文菜单，用于删除或撤回消息。
 *              支持消息列表的虚拟滚动，以及从资源预览跳转到特定消息。
 *              加载更晚的消息现在使用与加载更早消息相同的阈值 (Config.ui.virtualScrollThreshold)，并实现滚动回弹。
 *              新增逻辑以防止用户在还有更多未加载消息时将滚动条停留在绝对底部。
 *              新增：在群聊输入框中输入 @ 时，显示 AI 成员提及建议。
 *              优化：AI提及建议列表现在精确显示在输入框上方。
 *              修复: 正则表达式 @-提及 现在限制较少。
 *              功能增强：当用户复制文件后，在输入框ctrl+v时，将用户剪切板的文件，当作需要上传的文件，在预览文件中显示，用户点击发送后能将文件进行发送。
 *              新增：聊天头部的状态文本现在会根据连接或AI服务状态显示一个彩色圆点指示器。
 *              新增：scrollToDate 方法，用于从资源预览的日期导航跳转到指定日期的第一条消息。
 * @module ChatAreaUIManager
 * @exports {object} ChatAreaUIManager - 对外暴露的单例对象，包含管理聊天区域 UI 的所有方法。
 * @property {function} init - 初始化模块，获取 DOM 元素并绑定事件。
 * @property {function} showChatArea - 显示聊天区域并隐藏“未选择聊天”的占位屏幕。
 * @property {function} showNoChatSelected - 显示“未选择聊天”的占位视图并重置相关UI状态。
 * @property {function} updateChatHeader - 更新聊天头部的标题、状态（包括彩色圆点指示器）和头像。
 * @property {function} updateChatHeaderStatus - 更新聊天头部的状态文本（不改变彩色圆点指示器）。
 * @property {function} enableChatInterface - 启用或禁用聊天输入框和相关按钮。
 * @property {function} setCallButtonsState - 根据连接状态和聊天类型设置通话按钮的可用性。
 * @property {function} setCallButtonsStateForPeer - 为特定对方ID更新通话按钮状态（仅当其为当前聊天时）。
 * @property {function} showReconnectPrompt - 当与对方断开连接时，在聊天框中显示重连提示。
 * @property {function} setupForChat - 为指定聊天设置聊天区域，包括初始化虚拟滚动。
 * @property {function} handleNewMessageForCurrentChat - 处理当前聊天的新消息，将其添加到虚拟滚动列表。
 * @property {function} scrollToMessage - 滚动到指定的消息ID并加载其上下文。
 * @property {function} scrollToDate - 滚动到指定日期的第一条消息。
 * @dependencies LayoutUIManager, MessageManager, VideoCallManager, ChatManager, ConnectionManager, UserManager, DetailsPanelUIManager, NotificationUIManager, Utils, MediaManager, PeopleLobbyManager, EventEmitter, UIManager, Config
 * @dependents AppInitializer (进行初始化)
 */
const ChatAreaUIManager = {
    // DOM 元素引用
    chatAreaEl: null, // 主聊天区域元素
    chatHeaderTitleEl: null, // 聊天头部标题元素
    chatHeaderStatusEl: null, // 聊天头部状态文本元素
    chatHeaderAvatarEl: null, // 聊天头部头像元素
    chatHeaderMainEl: null, // 聊天头部主容器元素
    chatBoxEl: null, // 消息显示框元素
    noChatSelectedScreenEl: null, // “未选择聊天”占位屏幕元素
    messageInputEl: null, // 消息输入框元素
    sendButtonEl: null, // 发送按钮元素
    attachButtonEl: null, // 附件按钮元素
    voiceButtonEl: null, // 语音按钮元素
    videoCallButtonEl: null, // 视频通话按钮元素
    audioCallButtonEl: null, // 语音通话按钮元素
    screenShareButtonEl: null, // 屏幕共享按钮元素
    chatDetailsButtonEl: null, // 聊天详情按钮元素
    peopleLobbyButtonEl: null, // 人员大厅按钮元素
    screenshotMainBtnEl: null, // 截图按钮元素

    // 上下文菜单相关
    contextMenuEl: null, // 自定义右键菜单元素
    activeContextMenuMessageElement: null, // 当前显示上下文菜单的消息元素
    contextMenuAutoHideTimer: null, // 上下文菜单自动隐藏的定时器
    aiMentionSuggestionsEl: null, // AI @提及建议列表元素

    // 常量
    MESSAGE_RETRACTION_WINDOW: 5 * 60 * 1000, // 消息可撤回时间窗口 (5分钟，毫秒数)
    CONTEXT_MENU_AUTOHIDE_DURATION: 3000, // 右键菜单自动隐藏延迟 (3秒，毫秒数)

    // 虚拟滚动相关状态
    _currentChatIdForVirtualScroll: null, // 当前用于虚拟滚动的聊天ID
    _allMessagesForCurrentChat: [],       // 当前聊天的所有消息数组（内存中的副本）
    _renderedOldestMessageArrayIndex: -1, // 已渲染消息中，在 _allMessagesForCurrentChat 中最旧消息的索引
    _renderedNewestMessageArrayIndex: -1, // 已渲染消息中，在 _allMessagesForCurrentChat 中最新消息的索引
    _isLoadingOlderMessages: false,       // 标记是否正在加载更早的消息
    _isLoadingNewerMessages: false,       // 标记是否正在加载更新的消息
    _loadingIndicatorEl: null,            // 消息加载指示器元素 (通常用于加载更早消息时显示在顶部)
    _scrollListenerAttached: false,       // 标记滚动事件监听器是否已附加到 chatBoxEl
    _debounceScrollTimer: null,           // 滚动事件的防抖定时器
    _boundHandleChatScroll: null,         // 绑定的滚动处理函数 (为了方便移除监听器)
    _lastScrollTop: 0,                    // 上一次的滚动位置 (scrollTop)

    // 其他UI状态
    _scrollToLatestBtnEl: null,           // “滚动到最新消息”按钮元素
    CONTEXT_LOAD_COUNT: 10,               // 通过资源预览跳转到某条消息时，其上下文加载的消息数量 (前后各加载此数量)
    MESSAGES_TO_LOAD_ON_SCROLL: 15,       // 滚动到顶部或底部时，每次加载的消息数量

    /**
     * 初始化模块，获取所有需要的 DOM 元素引用并绑定核心事件。
     */
    init: function () {
        // 获取聊天区域核心 DOM 元素的引用
        this.chatAreaEl = document.getElementById('chatArea');
        this.chatHeaderTitleEl = document.getElementById('currentChatTitleMain');
        this.chatHeaderStatusEl = document.getElementById('currentChatStatusMain');
        this.chatHeaderAvatarEl = document.getElementById('currentChatAvatarMain');
        this.chatHeaderMainEl = document.querySelector('.chat-header-main');
        this.chatBoxEl = document.getElementById('chatBox');
        this.noChatSelectedScreenEl = document.getElementById('noChatSelectedScreen');
        this.messageInputEl = document.getElementById('messageInput');
        this.sendButtonEl = document.getElementById('sendButtonMain');
        this.attachButtonEl = document.getElementById('attachBtnMain');
        this.voiceButtonEl = document.getElementById('voiceButtonMain');
        this.videoCallButtonEl = document.getElementById('videoCallButtonMain');
        this.audioCallButtonEl = document.getElementById('audioCallButtonMain');
        this.screenShareButtonEl = document.getElementById('screenShareButtonMain');
        this.chatDetailsButtonEl = document.getElementById('chatDetailsBtnMain');
        this.peopleLobbyButtonEl = document.getElementById('peopleLobbyButtonMain');
        this.screenshotMainBtnEl = document.getElementById('screenshotMainBtn');

        this._initContextMenu(); // 初始化消息右键上下文菜单
        this._initAiMentionSuggestions(); // 初始化AI提及建议的UI

        // 如果聊天框存在，创建加载指示器元素
        if (this.chatBoxEl) {
            this._loadingIndicatorEl = document.createElement('div');
            this._loadingIndicatorEl.className = 'loading-indicator-older-messages'; // 加载旧消息的指示器
            this._loadingIndicatorEl.innerHTML = '<div class="spinner"></div>'; // 加载动画
        }
        // 绑定 `this` 上下文到滚动处理函数，以便在事件监听器中正确使用
        this._boundHandleChatScroll = this._debouncedHandleChatScroll.bind(this);
        this.bindEvents(); // 绑定所有相关的UI事件
    },

    /**
     * @private
     * 初始化AI提及建议的UI元素。
     * 它将被添加到聊天输入区域的父容器中，以便能正确定位在输入框上方。
     */
    _initAiMentionSuggestions: function() {
        // 创建建议列表的 div 元素
        this.aiMentionSuggestionsEl = document.createElement('div');
        this.aiMentionSuggestionsEl.id = 'aiMentionSuggestions';
        this.aiMentionSuggestionsEl.className = 'ai-mention-suggestions'; // 设置 CSS 类名
        this.aiMentionSuggestionsEl.style.display = 'none'; // 默认隐藏
        this.aiMentionSuggestionsEl.style.position = 'absolute'; // 使用绝对定位

        // 尝试将建议列表附加到输入框的父容器 `.chat-input-container`
        // 这是为了更好地控制建议列表相对于整个输入区域的定位
        const chatInputContainer = this.messageInputEl ? this.messageInputEl.closest('.chat-input-container') : null;
        if (chatInputContainer) {
            chatInputContainer.style.position = 'relative'; // 确保父容器是相对定位的，以便绝对定位的子元素正确显示
            chatInputContainer.appendChild(this.aiMentionSuggestionsEl);
        } else if (this.messageInputEl && this.messageInputEl.parentNode) {
            // 如果找不到 `.chat-input-container`，则作为备选方案，附加到输入框的直接父级
            Utils.log("ChatAreaUIManager: 无法找到理想的 .chat-input-container 来附加提及建议。尝试添加到输入框的父级。", Utils.logLevels.WARN);
            this.messageInputEl.parentNode.style.position = 'relative'; // 同样确保父容器是相对定位
            this.messageInputEl.parentNode.appendChild(this.aiMentionSuggestionsEl);
        } else {
            // 如果连输入框的父级都找不到，则记录错误并退出，因为无法附加建议列表
            Utils.log("ChatAreaUIManager: 无法找到附加提及建议列表的合适位置。", Utils.logLevels.ERROR);
            return;
        }

        // 添加全局点击事件监听器，用于在点击建议列表外部时隐藏它
        document.addEventListener('click', (event) => {
            // 如果建议列表已显示，并且点击的目标不是建议列表本身，也不是输入框，则隐藏建议列表
            if (this.aiMentionSuggestionsEl && this.aiMentionSuggestionsEl.style.display === 'block' &&
                !this.aiMentionSuggestionsEl.contains(event.target) && event.target !== this.messageInputEl) {
                this.aiMentionSuggestionsEl.style.display = 'none';
            }
        });
    },


    /**
     * 绑定聊天区域内的所有 UI 事件监听器。
     */
    bindEvents: function () {
        // 消息输入框事件
        if (this.messageInputEl) {
            // 监听键盘按下事件
            this.messageInputEl.addEventListener('keydown', (e) => {
                // 如果按下 Enter 键，且没有同时按下 Shift 或 Ctrl 键，则发送消息
                if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey) {
                    e.preventDefault(); // 阻止默认的回车换行行为
                    MessageManager.sendMessage(); // 调用消息发送逻辑
                    if (this.aiMentionSuggestionsEl) this.aiMentionSuggestionsEl.style.display = 'none'; // 发送后隐藏提及建议
                } else if (e.key === 'Escape') { // 如果按下 Escape 键
                    if (this.aiMentionSuggestionsEl) this.aiMentionSuggestionsEl.style.display = 'none'; // 隐藏提及建议
                }
            });
            // 监听输入事件，用于处理 @ 提及
            this.messageInputEl.addEventListener('input', this._handleMessageInputForMentions.bind(this));
            // 新增：监听粘贴事件，用于处理从剪贴板粘贴文件
            this.messageInputEl.addEventListener('paste', this._handlePasteEvent.bind(this));
        }
        // 发送按钮点击事件
        if (this.sendButtonEl) {
            this.sendButtonEl.addEventListener('click', () => {
                MessageManager.sendMessage(); // 调用消息发送逻辑
                if (this.aiMentionSuggestionsEl) this.aiMentionSuggestionsEl.style.display = 'none'; // 发送后隐藏提及建议
            });
        }
        // 附件按钮点击事件
        if (this.attachButtonEl) {
            this.attachButtonEl.addEventListener('click', () => {
                const fileInput = document.getElementById('fileInput'); // 获取隐藏的文件输入框
                if (fileInput) fileInput.click(); // 触发文件输入框的点击事件，打开文件选择对话框
            });
        }
        // 语音按钮事件 (支持触摸和鼠标)
        if (this.voiceButtonEl) {
            if ('ontouchstart' in window) { // 判断是否为触摸设备
                // 触摸开始事件：开始录音
                this.voiceButtonEl.addEventListener('touchstart', (e) => { e.preventDefault(); if (!this.voiceButtonEl.disabled) MediaManager.startRecording(); });
                // 触摸结束事件：停止录音
                this.voiceButtonEl.addEventListener('touchend', (e) => { e.preventDefault(); if (!this.voiceButtonEl.disabled) MediaManager.stopRecording(); });
            } else { // 鼠标设备
                // 鼠标按下事件：开始录音
                this.voiceButtonEl.addEventListener('mousedown', () => { if (!this.voiceButtonEl.disabled) MediaManager.startRecording(); });
                // 鼠标松开事件：停止录音
                this.voiceButtonEl.addEventListener('mouseup', () => { if (!this.voiceButtonEl.disabled) MediaManager.stopRecording(); });
                // 鼠标移开按钮事件：如果仍在录音，则停止
                this.voiceButtonEl.addEventListener('mouseleave', () => {
                    if (!this.voiceButtonEl.disabled && MediaManager.mediaRecorder && MediaManager.mediaRecorder.state === 'recording') {
                        MediaManager.stopRecording();
                    }
                });
            }
        }
        // 截图按钮点击事件
        if (this.screenshotMainBtnEl) {
            this.screenshotMainBtnEl.addEventListener('click', () => MediaManager.captureScreen()); // 调用截图逻辑
        }
        // 视频通话按钮点击事件
        if (this.videoCallButtonEl) {
            this.videoCallButtonEl.addEventListener('click', () => { if (!this.videoCallButtonEl.disabled) VideoCallManager.initiateCall(ChatManager.currentChatId); });
        }
        // 语音通话按钮点击事件
        if (this.audioCallButtonEl) {
            this.audioCallButtonEl.addEventListener('click', () => { if (!this.audioCallButtonEl.disabled) VideoCallManager.initiateAudioCall(ChatManager.currentChatId); });
        }
        // 屏幕共享按钮点击事件
        if (this.screenShareButtonEl) {
            this.screenShareButtonEl.addEventListener('click', () => { if (!this.screenShareButtonEl.disabled) VideoCallManager.initiateScreenShare(ChatManager.currentChatId); });
        }
        // 聊天详情按钮点击事件
        if (this.chatDetailsButtonEl) {
            this.chatDetailsButtonEl.addEventListener('click', () => { if (typeof DetailsPanelUIManager !== 'undefined') DetailsPanelUIManager.toggleChatDetailsView(); });
        }
        // 人员大厅按钮点击事件
        if (this.peopleLobbyButtonEl) {
            this.peopleLobbyButtonEl.addEventListener('click', () => { if (typeof DetailsPanelUIManager !== 'undefined') DetailsPanelUIManager.togglePeopleLobbyView(); });
        }
        // 聊天区域的拖放事件，用于文件上传
        if (this.chatAreaEl) {
            let dragCounter = 0; // 用于正确处理嵌套元素的 dragenter 和 dragleave 事件
            // 文件拖入聊天区域
            this.chatAreaEl.addEventListener('dragenter', (e) => {
                e.preventDefault(); e.stopPropagation(); // 阻止默认行为和事件冒泡
                // 只有在当前有选定聊天，并且拖入的是文件时才响应
                if (ChatManager.currentChatId && e.dataTransfer && e.dataTransfer.types.includes('Files')) {
                    dragCounter++;
                    if (dragCounter === 1) this.chatAreaEl.classList.add('drag-over'); // 显示拖放遮罩层
                }
            });
            // 文件在聊天区域上方移动
            this.chatAreaEl.addEventListener('dragover', (e) => {
                e.preventDefault(); e.stopPropagation();
                if (ChatManager.currentChatId && e.dataTransfer && e.dataTransfer.types.includes('Files')) {
                    e.dataTransfer.dropEffect = 'copy'; // 设置拖放效果为复制
                } else {
                    e.dataTransfer.dropEffect = 'none'; // 否则不允许拖放
                }
            });
            // 文件拖离聊天区域
            this.chatAreaEl.addEventListener('dragleave', (e) => {
                e.preventDefault(); e.stopPropagation();
                dragCounter--;
                if (dragCounter === 0) this.chatAreaEl.classList.remove('drag-over'); // 隐藏拖放遮罩层
            });
            // 文件在聊天区域释放（放下）
            this.chatAreaEl.addEventListener('drop', (e) => {
                e.preventDefault(); e.stopPropagation();
                dragCounter = 0; this.chatAreaEl.classList.remove('drag-over'); // 隐藏遮罩
                if (!ChatManager.currentChatId) { // 如果未选择聊天
                    NotificationUIManager.showNotification('发送文件前请先选择一个聊天。', 'warning');
                    return;
                }
                if (e.dataTransfer && e.dataTransfer.files.length > 0) { // 如果有拖放的文件
                    const file = e.dataTransfer.files[0]; // 通常只处理第一个文件
                    MediaManager.processFile(file); // 交给 MediaManager 处理文件
                }
            });
        }
        // 聊天框内的消息交互事件 (右键和双击)
        if (this.chatBoxEl) {
            // 右键点击消息，显示上下文菜单
            this.chatBoxEl.addEventListener('contextmenu', this._handleMessageInteraction.bind(this));
            // 双击消息，也显示上下文菜单 (除非双击的是消息内的可交互元素)
            this.chatBoxEl.addEventListener('dblclick', function (event) {
                const messageElement = event.target.closest('.message:not(.system):not(.retracted)'); // 找到非系统消息、非已撤回消息的元素
                if (messageElement) {
                    // 如果双击的目标是链接、按钮、输入框、图片、音视频控件等，则不显示菜单
                    if (event.target.closest('a, button, input, textarea, select, .file-preview-img, .play-voice-btn, .download-btn, video[controls], audio[controls]')) return;
                    this._showContextMenu(event, messageElement); // 显示自定义上下文菜单
                }
            }.bind(this));
        }
    },

    /**
     * @private
     * 处理粘贴事件，用于从剪贴板获取文件。
     * @param {ClipboardEvent} event - 粘贴事件对象。
     */
    _handlePasteEvent: async function(event) {
        // 如果当前没有选定聊天，或者输入框被禁用，则忽略粘贴操作
        if (!ChatManager.currentChatId || (this.messageInputEl && this.messageInputEl.disabled)) {
            Utils.log("ChatAreaUIManager._handlePasteEvent: 聊天未激活或输入框禁用，粘贴操作忽略。", Utils.logLevels.DEBUG);
            return;
        }

        // 获取剪贴板中的项目
        const items = (event.clipboardData || event.originalEvent?.clipboardData)?.items;
        if (!items) {
            Utils.log("ChatAreaUIManager._handlePasteEvent: 无法访问剪贴板项目。", Utils.logLevels.WARN);
            return;
        }

        let fileFoundAndProcessed = false; // 标记是否找到并处理了文件
        // 遍历剪贴板中的所有项目
        for (let i = 0; i < items.length; i++) {
            const item = items[i];
            if (item.kind === 'file') { // 如果项目类型是文件
                const file = item.getAsFile(); // 获取文件对象
                if (file) {
                    // 只有当我们确定要处理一个文件时，才阻止默认的文本粘贴行为
                    event.preventDefault(); // 阻止默认的粘贴行为（如粘贴文本）
                    Utils.log(`ChatAreaUIManager: 从剪贴板粘贴文件: ${file.name}, 类型: ${file.type}, 大小: ${file.size}`, Utils.logLevels.INFO);

                    // 检查是否已有待发送的文件或语音，如果有，则提示用户并返回
                    if (MessageManager.selectedFile) {
                        NotificationUIManager.showNotification('已有待发送的文件，请先发送或取消。', 'warning');
                        return; // 停止处理后续项目
                    }
                    if (MessageManager.audioData) {
                        NotificationUIManager.showNotification('已有待发送的语音，请先发送或取消。', 'warning');
                        return; // 停止处理后续项目
                    }

                    // 委托给 MediaManager 处理文件（例如显示预览）
                    await MediaManager.processFile(file);
                    fileFoundAndProcessed = true;
                    break; // 通常只处理剪贴板中的第一个文件项
                }
            }
        }

        if (fileFoundAndProcessed) {
            Utils.log("ChatAreaUIManager: 剪贴板中的文件已处理并设置预览。", Utils.logLevels.DEBUG);
        } else {
            Utils.log("ChatAreaUIManager: 在粘贴事件中未找到文件，或文件无法检索。将执行默认粘贴行为（文本）。", Utils.logLevels.DEBUG);
            // 如果没有文件被处理，不调用 event.preventDefault()，允许正常的文本粘贴
        }
    },


    /**
     * @private
     * 处理消息输入框的输入事件，用于检测和显示 @ 提及建议。
     * 仅在群聊中且输入 `@` 符号后触发。
     */
    _handleMessageInputForMentions: function() {
        // 检查是否满足显示提及建议的条件：
        // 1. 消息输入框存在
        // 2. AI提及建议的UI元素存在
        // 3. 当前已选定一个聊天
        // 4. 当前聊天是群聊 (ID以 'group_' 开头)
        if (!this.messageInputEl || !this.aiMentionSuggestionsEl || !ChatManager.currentChatId || !ChatManager.currentChatId.startsWith('group_')) {
            if (this.aiMentionSuggestionsEl) this.aiMentionSuggestionsEl.style.display = 'none'; // 如果不满足条件，隐藏建议列表 (如果已显示)
            return;
        }

        const text = this.messageInputEl.value; // 获取当前输入框的完整文本
        const cursorPos = this.messageInputEl.selectionStart; // 获取光标在文本中的位置
        const textBeforeCursor = text.substring(0, cursorPos); // 获取光标前的文本内容

        // 在光标前的文本中查找最后一个 '@' 符号的位置
        const lastAtSymbolIndex = textBeforeCursor.lastIndexOf('@');

        if (lastAtSymbolIndex !== -1) { // 如果找到了 '@' 符号
            // 提取 '@' 符号之后到光标位置的文本作为查询词，并转换为小写
            const query = textBeforeCursor.substring(lastAtSymbolIndex + 1).toLowerCase();
            // 计算从 '@' 符号开始到当前光标位置的子字符串长度 (包括 '@' 本身)
            // 这个长度用于后续替换选中的提及项
            const lengthOfAtAndQuery = textBeforeCursor.length - lastAtSymbolIndex;

            const group = GroupManager.groups[ChatManager.currentChatId]; // 获取当前群组的详细信息
            if (group && group.members) { // 如果群组信息和成员列表存在
                // 从群成员中筛选出 AI 角色，并且其名称包含查询词
                const aiMembers = group.members.reduce((acc, memberId) => {
                    const contact = UserManager.contacts[memberId]; // 获取成员的联系人信息
                    // 条件：是AI角色 (contact.isAI)，并且其名称 (转小写后) 包含查询词
                    if (contact && contact.isAI && contact.name.toLowerCase().includes(query)) {
                        acc.push(contact); // 将匹配的AI角色添加到结果数组
                    }
                    return acc;
                }, []);

                if (aiMembers.length > 0) { // 如果有匹配的AI成员
                    this._populateAiMentionSuggestions(aiMembers, lengthOfAtAndQuery); // 填充并显示提及建议列表
                } else {
                    this.aiMentionSuggestionsEl.style.display = 'none'; // 没有匹配项则隐藏建议列表
                }
            } else {
                this.aiMentionSuggestionsEl.style.display = 'none'; // 群组信息不存在则隐藏建议列表
            }
        } else {
            this.aiMentionSuggestionsEl.style.display = 'none'; // 如果光标前没有 '@' 符号，则隐藏建议列表
        }
    },

    /**
     * @private
     * 填充 AI @ 提及建议列表，并正确定位在输入框上方。
     * @param {Array<object>} aiContacts - 匹配的 AI 联系人对象数组。
     * @param {number} lengthOfAtAndQuery - `@` 符号加上查询词的长度，用于在选择建议后替换输入框中的文本。
     */
    _populateAiMentionSuggestions: function(aiContacts, lengthOfAtAndQuery) {
        // 确保提及建议列表元素和消息输入框元素都存在
        if (!this.aiMentionSuggestionsEl || !this.messageInputEl) return;

        this.aiMentionSuggestionsEl.innerHTML = ''; // 清空之前的建议项
        // 遍历匹配到的AI联系人，为每个联系人创建一个建议项
        aiContacts.forEach(contact => {
            const itemEl = document.createElement('div');
            itemEl.className = 'mention-suggestion-item'; // 设置CSS类名以便样式化
            itemEl.textContent = contact.name; // 显示AI联系人的名称
            // 为建议项添加点击事件监听器
            itemEl.addEventListener('click', () => {
                const currentText = this.messageInputEl.value; // 获取当前输入框的完整文本
                const cursorPos = this.messageInputEl.selectionStart; // 获取当前光标位置
                // 构造新的输入框文本：
                // 1. 光标位置之前、但在 `@查询词` 之前的部分
                const textBefore = currentText.substring(0, cursorPos - lengthOfAtAndQuery);
                // 2. 光标位置之后的部分
                const textAfter = currentText.substring(cursorPos);

                // 将 `@查询词` 替换为 `@AI名称 ` (注意末尾的空格，方便用户继续输入)
                this.messageInputEl.value = textBefore + '@' + contact.name + ' ' + textAfter;
                this.messageInputEl.focus(); // 重新聚焦到输入框
                // 计算新的光标位置：在插入的 `@AI名称 ` 之后
                const newCursorPos = textBefore.length + 1 + contact.name.length + 1; // +1 for '@', +1 for space
                this.messageInputEl.setSelectionRange(newCursorPos, newCursorPos); // 设置新的光标位置
                this.aiMentionSuggestionsEl.style.display = 'none'; // 隐藏建议列表
            });
            this.aiMentionSuggestionsEl.appendChild(itemEl); // 将创建的建议项添加到列表中
        });

        // 定位建议列表在输入框的上方
        // 优先尝试相对于 .input-row (输入框及其按钮所在的行) 定位
        const inputRow = this.messageInputEl.closest('.input-row');
        if (inputRow) {
            // 设置建议列表的底部边缘紧贴 .input-row 的顶部
            this.aiMentionSuggestionsEl.style.bottom = inputRow.offsetHeight + 'px';
            this.aiMentionSuggestionsEl.style.left = '0px'; // 左侧与 .input-row 对齐
            this.aiMentionSuggestionsEl.style.right = '0px';// 右侧与 .input-row 对齐 (如果父容器宽度固定，这会导致宽度自动撑满)
            this.aiMentionSuggestionsEl.style.width = 'auto'; // 宽度自动，由内容或左右约束决定
        } else {
            // 如果找不到 .input-row，则相对于输入框本身定位
            this.aiMentionSuggestionsEl.style.bottom = this.messageInputEl.offsetHeight + 5 + 'px'; // 在输入框上方，留5px间距
            this.aiMentionSuggestionsEl.style.left = this.messageInputEl.offsetLeft + 'px'; // 左侧与输入框对齐
            this.aiMentionSuggestionsEl.style.width = this.messageInputEl.offsetWidth + 'px'; // 宽度与输入框相同
        }
        this.aiMentionSuggestionsEl.style.display = 'block'; // 显示填充好的建议列表
    },

    /**
     * @private
     * 初始化消息的右键上下文菜单。
     */
    _initContextMenu: function () {
        // 创建上下文菜单的 div 元素
        this.contextMenuEl = document.createElement('div');
        this.contextMenuEl.id = 'customMessageContextMenu'; // 设置 ID
        this.contextMenuEl.className = 'custom-context-menu'; // 设置 CSS 类名
        this.contextMenuEl.style.display = 'none'; // 默认隐藏
        document.body.appendChild(this.contextMenuEl); // 将菜单添加到 body 中，确保在最顶层显示

        // 添加全局点击事件监听器，用于在点击菜单外部时隐藏菜单
        document.addEventListener('click', function (event) {
            // 如果菜单已显示，并且点击的目标不是菜单本身或其子元素
            if (this.contextMenuEl && this.contextMenuEl.style.display === 'block' && !this.contextMenuEl.contains(event.target)) {
                this._hideContextMenu(); // 隐藏菜单
            }
        }.bind(this)); // 绑定 this 上下文

        // 添加全局键盘按下事件监听器，用于通过 Esc 键隐藏菜单
        document.addEventListener('keydown', function (event) {
            if (event.key === 'Escape' && this.contextMenuEl && this.contextMenuEl.style.display === 'block') {
                this._hideContextMenu(); // 隐藏菜单
            }
        }.bind(this)); // 绑定 this 上下文
    },

    /**
     * @private
     * 处理消息元素的交互事件（当前主要用于右键点击）。
     * @param {MouseEvent} event - 鼠标事件对象。
     */
    _handleMessageInteraction: function (event) {
        // 查找事件目标最近的父级消息元素，排除系统消息和已撤回消息
        const messageElement = event.target.closest('.message:not(.system):not(.retracted)');
        if (!messageElement) return; // 如果没有找到相关的消息元素，则不做任何操作

        if (event.type === 'contextmenu') { // 如果是右键点击事件
            event.preventDefault(); // 阻止浏览器默认的右键菜单
            this._showContextMenu(event, messageElement); // 显示自定义的上下文菜单
        }
        // 双击逻辑已在 bindEvents 中单独处理，因为它有不同的触发条件（不应在链接等元素上触发）
    },

    /**
     * @private
     * 显示消息的上下文菜单。
     * @param {MouseEvent} event - 触发菜单的事件对象 (用于获取点击位置以定位菜单)。
     * @param {HTMLElement} messageElement - 被操作的消息元素。
     */
    _showContextMenu: function (event, messageElement) {
        // 确保上下文菜单元素和消息元素都存在
        if (!this.contextMenuEl || !messageElement) return;

        this._clearContextMenuAutoHideTimer(); // 清除可能存在的上一个菜单的自动隐藏定时器

        // 如果当前有图片查看器模态框打开，先将其移除，避免菜单被遮挡或交互冲突
        const imageViewerModal = document.querySelector('.modal-like.image-viewer');
        if (imageViewerModal) imageViewerModal.remove();


        this.contextMenuEl.innerHTML = ''; // 清空菜单的现有内容
        this.activeContextMenuMessageElement = messageElement; // 记录当前激活上下文菜单的消息元素

        // 从消息元素的数据属性中获取消息ID和时间戳
        const messageId = messageElement.dataset.messageId;
        const messageTimestamp = parseInt(messageElement.dataset.timestamp, 10);
        // 判断消息是否由当前用户发送 (通过 'sent' 类名)
        const isMyMessage = messageElement.classList.contains('sent');

        // 如果消息ID不存在，则无法进行操作，隐藏菜单并返回
        if (!messageId) {
            this._hideContextMenu();
            return;
        }

        // 创建“删除”按钮
        const deleteBtn = document.createElement('button');
        deleteBtn.textContent = '删除';
        deleteBtn.className = 'context-menu-button'; // CSS类名
        deleteBtn.onclick = function () {
            this._clearContextMenuAutoHideTimer(); // 点击后清除自动隐藏定时器
            MessageManager.deleteMessageLocally(messageId); // 调用消息管理器进行本地删除
            this._hideContextMenu(); // 操作完成后隐藏菜单
        }.bind(this); // 绑定this上下文
        this.contextMenuEl.appendChild(deleteBtn);

        // 如果是自己发送的消息，并且消息时间戳有效，且在可撤回时间窗口内，则添加“撤回”按钮
        if (isMyMessage && !isNaN(messageTimestamp) && (Date.now() - messageTimestamp < this.MESSAGE_RETRACTION_WINDOW)) {
            const retractBtn = document.createElement('button');
            retractBtn.textContent = '撤回';
            retractBtn.className = 'context-menu-button'; // CSS类名
            retractBtn.onclick = function () {
                this._clearContextMenuAutoHideTimer(); // 点击后清除自动隐藏定时器
                MessageManager.requestRetractMessage(messageId); // 调用消息管理器请求撤回消息
                this._hideContextMenu(); // 操作完成后隐藏菜单
            }.bind(this); // 绑定this上下文
            this.contextMenuEl.appendChild(retractBtn);
        }

        // 如果菜单中没有任何操作项 (例如，非自己的消息且已过撤回时间)，则不显示菜单
        if (this.contextMenuEl.children.length === 0) {
            this._hideContextMenu();
            return;
        }

        // 定位并显示菜单
        this.contextMenuEl.style.display = 'block'; // 先设为block以获取其尺寸
        const menuRect = this.contextMenuEl.getBoundingClientRect(); // 获取菜单的尺寸
        const menuWidth = menuRect.width;
        const menuHeight = menuRect.height;
        this.contextMenuEl.style.display = 'none'; // 获取尺寸后先隐藏，再进行定位

        let x = event.clientX; // 菜单的初始X坐标 (鼠标点击位置)
        let y = event.clientY; // 菜单的初始Y坐标 (鼠标点击位置)

        // 调整菜单位置，防止其超出窗口边界
        if (x + menuWidth > window.innerWidth) x = window.innerWidth - menuWidth - 5; // 如果右侧超出，向左移
        if (y + menuHeight > window.innerHeight) y = window.innerHeight - menuHeight - 5; // 如果底部超出，向上移
        if (x < 0) x = 5; // 如果左侧超出 (不太可能)，向右移
        if (y < 0) y = 5; // 如果顶部超出 (不太可能)，向下移

        this.contextMenuEl.style.top = y + 'px'; // 设置菜单的最终top位置
        this.contextMenuEl.style.left = x + 'px'; // 设置菜单的最终left位置
        this.contextMenuEl.style.display = 'block'; // 显示菜单

        // 设置定时器，在一段时间后自动隐藏菜单 (如果用户未进行操作)
        this.contextMenuAutoHideTimer = setTimeout(this._hideContextMenu.bind(this), this.CONTEXT_MENU_AUTOHIDE_DURATION);
    },

    /**
     * @private
     * 隐藏消息的上下文菜单。
     */
    _hideContextMenu: function () {
        this._clearContextMenuAutoHideTimer(); // 清除自动隐藏定时器
        if (this.contextMenuEl) this.contextMenuEl.style.display = 'none'; // 隐藏菜单元素
        this.activeContextMenuMessageElement = null; // 清除对当前激活菜单的消息元素的引用
    },

    /**
     * @private
     * 清除上下文菜单的自动隐藏定时器。
     */
    _clearContextMenuAutoHideTimer: function() {
        if (this.contextMenuAutoHideTimer) {
            clearTimeout(this.contextMenuAutoHideTimer); // 清除定时器
            this.contextMenuAutoHideTimer = null; // 重置定时器ID
        }
    },


    /**
     * 显示聊天区域，并隐藏“未选择聊天”的占位屏幕。
     */
    showChatArea: function () {
        // 如果 LayoutUIManager 存在，则调用其方法来调整布局 (主要用于移动端响应式)
        if (typeof LayoutUIManager !== 'undefined') LayoutUIManager.showChatAreaLayout();
        // 隐藏“未选择聊天”的占位屏幕
        if (this.noChatSelectedScreenEl) this.noChatSelectedScreenEl.style.display = 'none';
        // 显示聊天消息框 (使用 flex 布局)
        if (this.chatBoxEl) this.chatBoxEl.style.display = 'flex';
        // 切换到聊天区域时，隐藏可能存在的上下文菜单
        this._hideContextMenu();
    },

    /**
     * 显示“未选择聊天”的占位视图，并重置相关UI状态。
     */
    showNoChatSelected: function () {
        // 重置聊天头部信息
        if (this.chatHeaderTitleEl) this.chatHeaderTitleEl.textContent = '选择一个聊天'; // 设置默认标题
        if (this.chatHeaderStatusEl) {
            this.chatHeaderStatusEl.textContent = ''; // 清空状态文本
            this.chatHeaderStatusEl.className = 'chat-status-main status-indicator-neutral'; // 重置状态指示器为中性
        }
        if (this.chatHeaderAvatarEl) {
            this.chatHeaderAvatarEl.innerHTML = ''; // 清空头像内容
            this.chatHeaderAvatarEl.className = 'chat-avatar-main'; // 重置头像样式
        }
        if (this.chatHeaderMainEl) this.chatHeaderMainEl.className = 'chat-header-main'; // 重置头部主容器样式

        // 清空并隐藏聊天消息框
        if (this.chatBoxEl) {
            this.chatBoxEl.innerHTML = ''; // 清空消息
            this.chatBoxEl.style.display = 'none'; // 隐藏消息框
        }
        // 显示“未选择聊天”的占位屏幕
        if (this.noChatSelectedScreenEl) this.noChatSelectedScreenEl.style.display = 'flex';

        this.enableChatInterface(false); // 禁用聊天输入框和相关按钮
        // 如果详情面板UI管理器存在，则隐藏侧边面板
        if (typeof DetailsPanelUIManager !== 'undefined') DetailsPanelUIManager.hideSidePanel();
        // 如果布局UI管理器存在，则显示聊天列表区域 (主要用于移动端)
        if (typeof LayoutUIManager !== 'undefined') LayoutUIManager.showChatListArea();

        // 控制人员大厅按钮和聊天详情按钮的显隐与可用状态
        if (this.peopleLobbyButtonEl) {
            this.peopleLobbyButtonEl.style.display = 'block'; // 显示人员大厅按钮
            this.peopleLobbyButtonEl.disabled = false;    // 启用人员大厅按钮
        }
        if (this.chatDetailsButtonEl) {
            this.chatDetailsButtonEl.style.display = 'none';  // 隐藏聊天详情按钮
            this.chatDetailsButtonEl.disabled = true;     // 禁用聊天详情按钮
        }

        this._hideContextMenu(); // 隐藏可能存在的上下文菜单
        this._detachScrollListener(); // 解绑聊天框的滚动事件监听器
        // 重置虚拟滚动相关的状态变量
        this._currentChatIdForVirtualScroll = null;
        this._allMessagesForCurrentChat = [];
        this._renderedOldestMessageArrayIndex = -1;
        this._renderedNewestMessageArrayIndex = -1;
        this._hideScrollToLatestButton(); // 隐藏“滚动到最新消息”按钮
    },

    /**
     * 更新聊天头部的标题、状态（包括状态指示圆点）和头像。
     * @param {string} title - 聊天标题。
     * @param {string} statusText - 状态文本 (如 "在线", "离线", "AI 服务正常" 等)。
     * @param {string} avatarTextParam - 用于头像的文本（通常是名称首字母，在没有头像URL时使用）。
     * @param {boolean} [isGroup=false] - 指示当前聊天是否为群组聊天。
     */
    updateChatHeader: function (title, statusText, avatarTextParam, isGroup = false) {
        // 更新聊天标题，进行HTML转义以防XSS
        if (this.chatHeaderTitleEl) this.chatHeaderTitleEl.textContent = Utils.escapeHtml(title);

        // 更新聊天状态文本和指示圆点
        if (this.chatHeaderStatusEl) {
            this.chatHeaderStatusEl.textContent = Utils.escapeHtml(statusText); // 设置状态文本

            // 首先移除所有可能的状态指示器CSS类
            this.chatHeaderStatusEl.classList.remove('status-indicator-active', 'status-indicator-inactive', 'status-indicator-neutral');

            const currentId = ChatManager.currentChatId; // 获取当前聊天对象的ID

            if (!currentId) { // 如果没有选中任何聊天 (理论上此时应显示 showNoChatSelected 视图)
                this.chatHeaderStatusEl.classList.add('status-indicator-neutral'); // 中性状态 (无颜色圆点)
            } else if (isGroup) { // 如果是群聊
                this.chatHeaderStatusEl.classList.add('status-indicator-neutral'); // 群聊通常不显示单一的在线/离线状态，设为中性
            } else { // 如果是单聊 (联系人)
                const contact = UserManager.contacts[currentId]; // 获取联系人信息
                if (contact) {
                    if (contact.isAI) { // 如果是AI联系人
                        // AI的状态取决于AI服务的健康状况
                        if (UserManager.isAiServiceHealthy) {
                            this.chatHeaderStatusEl.classList.add('status-indicator-active'); // AI服务正常 (绿色圆点)
                        } else {
                            this.chatHeaderStatusEl.classList.add('status-indicator-inactive'); // AI服务异常 (红色圆点)
                        }
                    } else if (contact.isSpecial) { // 如果是特殊类型的非AI联系人 (例如某些内置角色)
                        this.chatHeaderStatusEl.classList.add('status-indicator-active'); // 特殊联系人通常视为“活跃” (绿色圆点)
                    } else { // 普通人类联系人
                        // 状态取决于与该联系人的连接状况
                        if (ConnectionManager.isConnectedTo(currentId)) {
                            this.chatHeaderStatusEl.classList.add('status-indicator-active'); // 已连接 (绿色圆点)
                        } else {
                            this.chatHeaderStatusEl.classList.add('status-indicator-inactive'); // 未连接/离线 (红色圆点)
                        }
                    }
                } else { // 如果找不到联系人信息 (异常情况)
                    this.chatHeaderStatusEl.classList.add('status-indicator-neutral'); // 设为中性
                }
            }
        }

        // 重置聊天头部和头像的特定主题类名 (如有)
        if (this.chatHeaderMainEl) this.chatHeaderMainEl.className = 'chat-header-main';
        if (this.chatHeaderAvatarEl) this.chatHeaderAvatarEl.className = 'chat-avatar-main';

        // 如果是群聊，为头像添加 'group' 类以应用群组特定样式
        if (isGroup && this.chatHeaderAvatarEl) {
            this.chatHeaderAvatarEl.classList.add('group');
        }

        // 更新头像内容
        const currentContactForAvatar = UserManager.contacts[ChatManager.currentChatId]; // 获取当前聊天联系人的信息
        // 决定头像的文本内容：优先使用传入的 avatarTextParam，其次是标题首字母，最后是 '?'
        let finalAvatarText = avatarTextParam ? Utils.escapeHtml(avatarTextParam) : (title && title.length > 0) ? Utils.escapeHtml(title.charAt(0).toUpperCase()) : '?';
        let avatarContentHtml; // 用于存储头像的HTML内容

        if (currentContactForAvatar && currentContactForAvatar.avatarUrl) { // 如果联系人有头像URL
            // 设置图片加载失败时的后备文本
            let imgFallback = (currentContactForAvatar.avatarText) ? Utils.escapeHtml(currentContactForAvatar.avatarText) :
                (currentContactForAvatar.name && currentContactForAvatar.name.length > 0) ? Utils.escapeHtml(currentContactForAvatar.name.charAt(0).toUpperCase()) : '?';
            avatarContentHtml = `<img src="${currentContactForAvatar.avatarUrl}" alt="${imgFallback}" class="avatar-image" data-fallback-text="${imgFallback}" data-entity-id="${currentContactForAvatar.id}">`;

            // 如果是特殊联系人，并且应用了主题，添加特殊头像和头部样式
            if (currentContactForAvatar.isSpecial) {
                if(this.chatHeaderAvatarEl) this.chatHeaderAvatarEl.classList.add('special-avatar', currentContactForAvatar.id);
                if(this.chatHeaderMainEl) this.chatHeaderMainEl.classList.add('character-active', `current-chat-${currentContactForAvatar.id}`);
            }
        } else { // 如果没有头像URL，使用文本头像
            avatarContentHtml = finalAvatarText;
            // 即使是文本头像，如果联系人是特殊类型且应用了主题，也添加特殊样式
            if (currentContactForAvatar && currentContactForAvatar.isSpecial) {
                if(this.chatHeaderAvatarEl) this.chatHeaderAvatarEl.classList.add('special-avatar', currentContactForAvatar.id);
                if(this.chatHeaderMainEl) this.chatHeaderMainEl.classList.add('character-active', `current-chat-${currentContactForAvatar.id}`);
            }
        }
        if (this.chatHeaderAvatarEl) this.chatHeaderAvatarEl.innerHTML = avatarContentHtml; // 设置头像内容


        // 根据是否选中了聊天，更新聊天详情按钮的显隐和可用状态
        const chatSelected = !!ChatManager.currentChatId;
        if (this.chatDetailsButtonEl) {
            this.chatDetailsButtonEl.style.display = chatSelected ? 'block' : 'none'; // 选中则显示，否则隐藏
            this.chatDetailsButtonEl.disabled = !chatSelected; // 选中则启用，否则禁用
        }
        // 人员大厅按钮通常保持可见和可用
        if (this.peopleLobbyButtonEl) {
            this.peopleLobbyButtonEl.style.display = 'block';
            this.peopleLobbyButtonEl.disabled = false;
        }
    },

    /**
     * 更新聊天头部的状态文本。此方法仅更新文本，不改变状态指示圆点。
     * 主要用于显示如 "对方正在输入..." 这类临时的、次要的状态信息。
     * @param {string} statusText - 要显示的状态文本。
     */
    updateChatHeaderStatus: function (statusText) {
        if (this.chatHeaderStatusEl) {
            // 设置状态文本，进行HTML转义
            this.chatHeaderStatusEl.textContent = Utils.escapeHtml(statusText);
            // 注意: 此方法不修改状态指示圆点的CSS类。
            // 圆点的状态（在线/离线/AI服务状态）由 `updateChatHeader` 方法管理，
            // 该方法在打开新聊天或发生需要重新评估圆点状态的重大状态变更时调用。
            // 此函数 `updateChatHeaderStatus` 仅用于更新次要的、动态的状态文本，
            // 如输入状态提示，而不影响主要的连接/服务状态指示。
        }
    },


    /**
     * 启用或禁用聊天输入框和相关按钮。
     * @param {boolean} enabled - true 表示启用，false 表示禁用。
     */
    enableChatInterface: function (enabled) {
        // 定义需要切换启用/禁用状态的元素列表
        const elementsToToggle = [
            this.messageInputEl, this.sendButtonEl, this.attachButtonEl,
            this.voiceButtonEl, this.chatDetailsButtonEl, this.screenshotMainBtnEl
        ];
        // 遍历列表，设置各元素的 disabled 属性
        elementsToToggle.forEach(el => {
            if (el) el.disabled = !enabled; // 如果 enabled 为 true，则 disabled 为 false (启用)；反之亦然
        });

        // 人员大厅按钮通常保持可用状态，不受此函数影响（除非有特殊逻辑）
        if (this.peopleLobbyButtonEl) this.peopleLobbyButtonEl.disabled = false;

        // 设置通话相关按钮（视频、音频、屏幕共享）的可用状态
        // 通话按钮的可用性取决于：
        // 1. 聊天界面是否启用 (enabled 参数)
        // 2. 当前是否有选中的聊天 (ChatManager.currentChatId)
        // 3. 与当前聊天对象的连接状态 (ConnectionManager.isConnectedTo)
        this.setCallButtonsState(enabled && ChatManager.currentChatId ? ConnectionManager.isConnectedTo(ChatManager.currentChatId) : false, ChatManager.currentChatId);

        // 如果是启用操作，并且消息输入框存在，则尝试聚焦到输入框
        if (enabled && this.messageInputEl) {
            setTimeout(() => { // 使用 setTimeout 确保在UI更新和元素变为可用后再聚焦
                if (this.messageInputEl) this.messageInputEl.focus();
            }, 100); // 延迟100毫秒
        }
    },

    /**
     * 根据连接状态和聊天类型设置通话按钮（视频、音频、屏幕共享）的可用性。
     * @param {boolean} enabled - 指示是否已连接到对方 (对于非特殊联系人)。
     * @param {string|null} [peerIdContext=null] - 当前聊天对象的ID。如果为null，则使用 ChatManager.currentChatId。
     */
    setCallButtonsState: function (enabled, peerIdContext = null) {
        // 确定通话的目标对方ID
        const targetPeerForCall = peerIdContext || ChatManager.currentChatId;
        // 判断是否为群聊 (群聊ID通常有特定前缀，如 'group_')
        const isGroupChat = targetPeerForCall?.startsWith('group_');
        // 获取当前聊天对象的联系人信息
        const currentContact = UserManager.contacts[targetPeerForCall];
        // 判断是否为特殊类型的联系人 (例如AI助手，它们通常不支持P2P通话)
        const isSpecialChat = currentContact && currentContact.isSpecial;
        // 检查浏览器是否支持屏幕共享API
        const canShareScreen = !!(navigator.mediaDevices && navigator.mediaDevices.getDisplayMedia);

        // 通话按钮最终的启用条件：
        // 1. 传入的 enabled 参数为 true (通常表示已连接或聊天界面已启用)
        // 2. 有有效的 targetPeerForCall (即当前有选中的聊天对象)
        // 3. 不是群聊 (isGroupChat 为 false)
        // 4. 不是特殊联系人 (isSpecialChat 为 false)
        const finalEnabledState = enabled && targetPeerForCall && !isGroupChat && !isSpecialChat;

        // 设置视频通话按钮的禁用状态
        if (this.videoCallButtonEl) this.videoCallButtonEl.disabled = !finalEnabledState;
        // 设置语音通话按钮的禁用状态
        if (this.audioCallButtonEl) this.audioCallButtonEl.disabled = !finalEnabledState;
        // 设置屏幕共享按钮的禁用状态 (除了上述条件，还需浏览器支持屏幕共享)
        if (this.screenShareButtonEl) this.screenShareButtonEl.disabled = !finalEnabledState || !canShareScreen;
    },

    /**
     * 为特定对方ID更新通话按钮状态（仅当该对方是当前正在进行的聊天时）。
     * @param {string} peerId - 对方的ID。
     * @param {boolean} enabled - 是否已连接到该对方。
     */
    setCallButtonsStateForPeer: function (peerId, enabled) {
        // 仅当传入的 peerId 是当前正在聊天的对象时，才更新通话按钮状态
        if (ChatManager.currentChatId === peerId) {
            this.setCallButtonsState(enabled, peerId);
        }
    },

    /**
     * 当与对方断开连接时，在聊天框中显示重连提示。
     * @param {string} peerId - 断开连接的对方ID。
     * @param {function} onReconnectSuccess - 重新连接成功后执行的回调函数。
     */
    showReconnectPrompt: function (peerId, onReconnectSuccess) {
        // 如果聊天框元素不存在，则无法显示提示，直接返回
        if (!this.chatBoxEl) return;

        // 尝试查找聊天框中是否已存在针对该 peerId 的重连提示
        let promptDiv = this.chatBoxEl.querySelector(`.system-message.reconnect-prompt[data-peer-id="${peerId}"]`);
        // 获取对方的名称，如果联系人信息中没有，则使用部分ID作为占位符
        const peerName = UserManager.contacts[peerId]?.name || `用户 ${peerId.substring(0, 4)}`;

        // 如果已存在提示，则更新其文本内容和按钮状态，然后返回
        if (promptDiv) {
            const textElement = promptDiv.querySelector('.reconnect-prompt-text');
            if (textElement) textElement.textContent = `与 ${Utils.escapeHtml(peerName)} 的连接已断开。`;
            const recBtn = promptDiv.querySelector('.message-inline-action-button:not(.secondary-action)'); // 重连按钮
            if (recBtn) recBtn.disabled = false; // 确保重连按钮是可用的
            return;
        }

        // 如果不存在提示，则创建一个新的提示元素
        promptDiv = document.createElement('div');
        promptDiv.setAttribute('data-message-id', `reconnect_prompt_${peerId}_${Date.now()}`); // 设置唯一ID
        promptDiv.className = 'message system reconnect-prompt'; // 设置CSS类名
        promptDiv.setAttribute('data-peer-id', peerId); // 存储peerId，方便查找
        // 设置提示的HTML结构，包含文本和两个按钮（“重新连接”，“忽略”）
        promptDiv.innerHTML = `
<div class="message-content system-text">
    <span class="reconnect-prompt-text">与 ${Utils.escapeHtml(peerName)} 的连接已断开。</span>
<button class="message-inline-action-button">重新连接</button>
<button class="message-inline-action-button secondary-action">忽略</button>
</div>`;
        this.chatBoxEl.appendChild(promptDiv); // 将提示添加到聊天框
        this.chatBoxEl.scrollTop = this.chatBoxEl.scrollHeight; // 滚动到底部，确保提示可见

        // 获取提示中的按钮和文本元素
        const reconnectButton = promptDiv.querySelector('.message-inline-action-button:not(.secondary-action)');
        const cancelButton = promptDiv.querySelector('.message-inline-action-button.secondary-action');
        const textElement = promptDiv.querySelector('.reconnect-prompt-text');

        let successHandler, failHandler; // 用于存储事件处理器的引用，以便后续移除

        // 定义清理函数，用于移除提示和相关的事件监听器
        const cleanupPrompt = (removeImmediately = false) => {
            EventEmitter.off('connectionEstablished', successHandler); // 移除连接成功事件的监听
            EventEmitter.off('connectionFailed', failHandler);       // 移除连接失败事件的监听
            if (promptDiv && promptDiv.parentNode) { // 如果提示元素仍然存在于DOM中
                if (removeImmediately) { // 如果要求立即移除
                    promptDiv.remove();
                } else { // 否则，延迟移除 (给用户时间阅读最终状态)
                    // 如果提示文本包含“失败”，则延迟时间长一些
                    setTimeout(() => {
                        if (promptDiv && promptDiv.parentNode) promptDiv.remove();
                    }, textElement.textContent.includes("失败") ? 5000 : 3000);
                }
            }
        };

        // 定义连接成功时的事件处理器
        successHandler = (connectedPeerId) => {
            if (connectedPeerId === peerId) { // 如果成功连接的是目标peer
                if (textElement) textElement.textContent = `已重新连接到 ${Utils.escapeHtml(peerName)}。`;
                if (reconnectButton) reconnectButton.style.display = 'none'; // 隐藏“重新连接”按钮
                if (cancelButton) {
                    cancelButton.textContent = '好的'; // 将“忽略”按钮文本改为“好的”
                    cancelButton.onclick = () => cleanupPrompt(true); // 点击“好的”后立即移除提示
                }
                if (typeof onReconnectSuccess === 'function') onReconnectSuccess(); // 执行传入的成功回调
                cleanupPrompt(); // 延迟移除提示
            }
        };

        // 定义连接失败时的事件处理器
        failHandler = (failedPeerId) => {
            if (failedPeerId === peerId) { // 如果连接失败的是目标peer
                if (textElement) textElement.textContent = `无法重新连接到 ${Utils.escapeHtml(peerName)}。请尝试手动连接或刷新页面。`;
                if (reconnectButton) {
                    reconnectButton.style.display = 'initial'; // 重新显示“重新连接”按钮
                    reconnectButton.disabled = false;        // 并使其可用
                }
                if (cancelButton) cancelButton.textContent = '忽略'; // 保持“忽略”按钮文本
                // 注意：这里不调用 cleanupPrompt，允许用户再次尝试或忽略
            }
        };

        // 监听连接成功和失败的全局事件
        EventEmitter.on('connectionEstablished', successHandler);
        EventEmitter.on('connectionFailed', failHandler);

        // 为“重新连接”按钮绑定点击事件
        if (reconnectButton) {
            reconnectButton.onclick = async () => {
                if (textElement) textElement.textContent = `正在检查信令服务器连接...`;
                reconnectButton.disabled = true; // 禁用按钮，防止重复点击

                let signalingServerNowConnected;
                // 检查与信令服务器的WebSocket连接是否已建立
                if (ConnectionManager.isWebSocketConnected && ConnectionManager.websocket?.readyState === WebSocket.OPEN) {
                    signalingServerNowConnected = true;
                } else { // 如果未连接，尝试重新连接
                    if (textElement) textElement.textContent = `信令服务器未连接。正在尝试连接...`;
                    try {
                        await ConnectionManager.connectWebSocket(); // 异步连接WebSocket
                        signalingServerNowConnected = ConnectionManager.isWebSocketConnected && ConnectionManager.websocket?.readyState === WebSocket.OPEN;
                    } catch (wsError) {
                        Utils.log(`showReconnectPrompt: 重新连接信令服务器失败: ${wsError.message || wsError}`, Utils.logLevels.ERROR);
                        signalingServerNowConnected = false;
                    }
                }

                if (signalingServerNowConnected) { // 如果信令服务器连接成功
                    if (textElement) textElement.textContent = `信令服务器已连接。正在尝试重新连接到 ${Utils.escapeHtml(peerName)} ...`;
                    await ConnectionManager.autoConnectToContacts(); // 尝试自动连接到所有联系人 (包括目标peer)
                } else { // 如果信令服务器连接失败
                    if (textElement) textElement.innerHTML = `无法连接到信令服务器。请检查您的网络，或尝试使用“菜单与设置”中的<br>“AI 与 API 配置 > 高级选项”进行手动连接。`;
                    NotificationUIManager.showNotification('尝试使用“菜单与设置”中的“AI 与 API 配置 > 高级选项”进行手动连接。', 'error');
                    reconnectButton.disabled = false; // 重新启用“重新连接”按钮，允许用户再次尝试
                }
            };
        }
        // 为“忽略”按钮绑定点击事件
        if (cancelButton) {
            cancelButton.onclick = () => cleanupPrompt(true); // 点击后立即移除提示
        }
    },


    /**
     * 为指定的聊天设置聊天区域，包括初始化虚拟滚动。
     * 当用户切换到另一个聊天时调用此方法。
     * @param {string} chatId - 要设置的聊天ID。
     */
    setupForChat: function (chatId) {
        this._detachScrollListener(); // 首先，如果之前有附加的滚动监听器，则移除它
        this.showChatArea(); // 确保聊天区域是可见的
        this._currentChatIdForVirtualScroll = chatId; // 设置当前用于虚拟滚动的聊天ID
        // 从 ChatManager 获取该聊天的所有消息，并创建副本存储在本模块中
        this._allMessagesForCurrentChat = [...(ChatManager.chats[chatId] || [])];
        // 重置加载状态标记
        this._isLoadingOlderMessages = false;
        this._isLoadingNewerMessages = false;
        // 重置已渲染消息的边界索引
        this._renderedOldestMessageArrayIndex = -1;
        this._renderedNewestMessageArrayIndex = -1;
        this._lastScrollTop = 0; // 重置上一次的滚动位置
        this._renderInitialMessageBatch(); // 渲染初始的一批消息 (通常是最新的消息)
        this._attachScrollListener(); // 为新的聊天内容附加滚动事件监听器
        this._hideScrollToLatestButton(); // 初始时，通常已滚动到底部，所以隐藏“滚动到最新消息”按钮
    },

    /**
     * @private
     * 附加聊天框的滚动事件监听器。
     */
    _attachScrollListener: function () {
        // 如果聊天框元素存在，且尚未附加滚动监听器
        if (this.chatBoxEl && !this._scrollListenerAttached) {
            // 添加滚动事件监听器，使用已绑定的防抖处理函数
            this.chatBoxEl.addEventListener('scroll', this._boundHandleChatScroll);
            this._scrollListenerAttached = true; // 标记监听器已附加
        }
    },

    /**
     * @private
     * 解绑聊天框的滚动事件监听器。
     */
    _detachScrollListener: function () {
        // 如果聊天框元素存在，已附加滚动监听器，并且绑定的处理函数存在
        if (this.chatBoxEl && this._scrollListenerAttached && this._boundHandleChatScroll) {
            this.chatBoxEl.removeEventListener('scroll', this._boundHandleChatScroll); // 移除监听器
            this._scrollListenerAttached = false; // 标记监听器已解绑
            clearTimeout(this._debounceScrollTimer); // 清除可能存在的防抖定时器
            this._debounceScrollTimer = null; // 重置防抖定时器ID
        }
    },

    /**
     * @private
     * 滚动事件的防抖处理函数。
     * 目的是在用户连续滚动时，只在滚动停止一段时间后才执行实际的滚动处理逻辑，以提高性能。
     */
    _debouncedHandleChatScroll: function () {
        clearTimeout(this._debounceScrollTimer); // 清除上一个防抖定时器 (如果存在)
        // 设置新的定时器，在 150ms 后执行 _handleChatScroll
        this._debounceScrollTimer = setTimeout(() => {
            this._handleChatScroll();
        }, 150);
    },

    /**
     * @private
     * 处理聊天框的滚动事件，用于触发加载更多消息（虚拟滚动）和管理“滚动到最新”按钮的显隐。
     */
    _handleChatScroll: function () {
        if (!this.chatBoxEl) return; // 如果聊天框不存在，则不执行任何操作

        const { scrollTop, scrollHeight, clientHeight } = this.chatBoxEl; // 获取滚动相关属性
        this._lastScrollTop = scrollTop; // 记录当前的滚动位置

        // 检查是否滚动到顶部附近，需要加载更早的消息
        // 条件：滚动条位置小于阈值，当前没有正在加载旧消息，并且还有更早的消息未渲染
        if (scrollTop < Config.ui.virtualScrollThreshold && !this._isLoadingOlderMessages && this._renderedOldestMessageArrayIndex > 0) {
            this._loadOlderMessages(); // 调用加载更早消息的函数
            // 如果加载了旧消息，且当前并非显示所有最新消息 (即用户向上滚动了)，则显示“滚动到最新消息”按钮
            if (this._allMessagesForCurrentChat.length > 0 && this._renderedNewestMessageArrayIndex < this._allMessagesForCurrentChat.length - 1) {
                this._showScrollToLatestButton();
            }
        }

        const distanceToBottom = scrollHeight - scrollTop - clientHeight; // 计算滚动条距离底部的距离
        const hasMoreNewerMessages = this._renderedNewestMessageArrayIndex < this._allMessagesForCurrentChat.length - 1; // 判断是否还有更新的消息未渲染

        // 检查是否滚动到底部附近，需要加载更新的消息
        // 条件：还有更新的消息未渲染，当前没有正在加载新消息，并且滚动条距离底部小于阈值
        if (hasMoreNewerMessages && !this._isLoadingNewerMessages && distanceToBottom < Config.ui.virtualScrollThreshold) {
            this._loadNewerMessages(); // 调用加载更新消息的函数
        }

        // 使用 requestAnimationFrame 确保在浏览器下一次重绘前执行以下逻辑
        // 这有助于获取滚动操作完成后的最终状态，并进行相应的UI调整
        requestAnimationFrame(() => {
            if (!this.chatBoxEl) return; // 再次检查聊天框是否存在
            // 获取最新的滚动状态
            const finalScrollTop = this.chatBoxEl.scrollTop;
            const finalScrollHeight = this.chatBoxEl.scrollHeight;
            const finalClientHeight = this.chatBoxEl.clientHeight;
            const finalDistanceToBottom = finalScrollHeight - finalScrollTop - finalClientHeight;
            const stillHasMoreNewerMessages = this._renderedNewestMessageArrayIndex < this._allMessagesForCurrentChat.length - 1;

            // 新增逻辑：防止用户在还有更多未加载的较新消息时，将滚动条停留在绝对底部
            // 如果还有更新的消息未加载，且当前没有在加载新消息，并且滚动条已到达绝对底部 (距离 < 1px)
            if (stillHasMoreNewerMessages && !this._isLoadingNewerMessages && finalDistanceToBottom < 1) {
                // 计算一个目标滚动位置，使其稍微离开底部 (例如向上20px)
                const targetScrollTop = finalScrollHeight - finalClientHeight - 20;
                // 仅当当前滚动位置确实低于目标位置时才调整，避免不必要的滚动
                if (this.chatBoxEl.scrollTop < targetScrollTop) {
                    this.chatBoxEl.scrollTop = targetScrollTop; // 执行微调
                    Utils.log("ChatAreaUIManager: _handleChatScroll 防止停留在底部，强制向上微调。", Utils.logLevels.DEBUG);
                }
            }

            // 根据最终的滚动状态和是否有更多新消息，决定“滚动到最新消息”按钮的显隐
            const isEffectivelyAtBottom = finalScrollHeight - finalScrollTop - finalClientHeight < 1; // 是否已滚动到有效底部
            if (isEffectivelyAtBottom && !stillHasMoreNewerMessages) { // 如果在底部且没有更多新消息了
                this._hideScrollToLatestButton(); // 隐藏按钮
            } else if (stillHasMoreNewerMessages && !isEffectivelyAtBottom) { // 如果还有新消息且不在底部
                this._showScrollToLatestButton(); // 显示按钮
            }
        });
    },


    /**
     * @private
     * 渲染初始批次的消息到聊天框 (通常是最新的消息)。
     * 在 `setupForChat` 或点击“滚动到最新消息”按钮时调用。
     */
    _renderInitialMessageBatch: function () {
        // 确保聊天框元素存在且当前有选定的聊天ID
        if (!this.chatBoxEl || !this._currentChatIdForVirtualScroll) return;

        this.chatBoxEl.innerHTML = ''; // 清空聊天框的现有内容
        this._hideLoadingIndicator(); // 隐藏可能正在显示的加载指示器

        const totalMessages = this._allMessagesForCurrentChat.length; // 获取当前聊天的总消息数
        if (totalMessages === 0) { // 如果没有消息
            // 显示占位提示信息
            const placeholder = document.createElement('div');
            placeholder.className = "system-message"; // 使用系统消息样式
            const contact = UserManager.contacts[this._currentChatIdForVirtualScroll]; // 获取当前聊天对象的信息
            // 根据聊天类型设置不同的提示文本
            if (contact && contact.isSpecial) { // 特殊联系人
                placeholder.textContent = `与 ${contact.name} 开始对话吧！`;
            } else if (this._currentChatIdForVirtualScroll.startsWith('group_') && // 群聊
                GroupManager.groups[this._currentChatIdForVirtualScroll]?.owner === UserManager.userId && // 且当前用户是群主
                GroupManager.groups[this._currentChatIdForVirtualScroll]?.members.length === 1) { // 且群里只有群主自己
                placeholder.textContent = "您创建了此群组。邀请成员开始聊天吧！";
            } else { // 其他情况 (普通联系人或已有成员的群聊)
                placeholder.textContent = "暂无消息。开始对话吧！";
            }
            this.chatBoxEl.appendChild(placeholder); // 添加占位提示到聊天框
            // 重置已渲染消息的边界索引
            this._renderedOldestMessageArrayIndex = -1;
            this._renderedNewestMessageArrayIndex = -1;
            return;
        }

        // 计算要渲染的最新一批消息的起始和结束索引
        // 结束索引是消息数组的最后一个元素
        const endIndexInArray = totalMessages - 1;
        // 起始索引是从结束索引向前数 `MESSAGES_TO_LOAD_ON_SCROLL` 条，但不小于0
        const startIndexInArray = Math.max(0, endIndexInArray - this.MESSAGES_TO_LOAD_ON_SCROLL + 1);

        // 遍历并渲染这批消息
        for (let i = startIndexInArray; i <= endIndexInArray; i++) {
            // 调用 MessageManager 的 displayMessage 方法来渲染单条消息
            // `false` 表示消息是追加到底部 (对于初始加载，虽然是清空后添加，但逻辑上是新消息)
            MessageManager.displayMessage(this._allMessagesForCurrentChat[i], false);
        }

        // 更新已渲染消息的边界索引
        this._renderedOldestMessageArrayIndex = startIndexInArray;
        this._renderedNewestMessageArrayIndex = endIndexInArray;
        // 将聊天框滚动到底部，以显示最新的消息
        this.chatBoxEl.scrollTop = this.chatBoxEl.scrollHeight;
    },

    /**
     * @private
     * 异步加载并渲染更早的一批消息。
     * 当用户向上滚动到聊天框顶部附近时触发。
     */
    _loadOlderMessages: async function () {
        // 如果正在加载旧消息，或者已渲染到最旧的消息 (索引为0)，或者聊天框不存在，则直接返回
        if (this._isLoadingOlderMessages || this._renderedOldestMessageArrayIndex === 0 || !this.chatBoxEl) return;

        this._isLoadingOlderMessages = true; // 标记开始加载旧消息
        this._showLoadingIndicatorAtTop(); // 在聊天框顶部显示加载指示器

        const currentOldestLoadedIndex = this._renderedOldestMessageArrayIndex; // 当前已渲染的最旧消息的索引
        // 计算新一批要加载的旧消息的结束索引 (即当前最旧消息的前一条)
        const newBatchEndIndexInArray = currentOldestLoadedIndex - 1;
        // 计算新一批旧消息的起始索引 (从结束索引向前数 `MESSAGES_TO_LOAD_ON_SCROLL` 条，但不小于0)
        const newBatchStartIndexInArray = Math.max(0, newBatchEndIndexInArray - this.MESSAGES_TO_LOAD_ON_SCROLL + 1);

        // 如果计算出的结束索引小于0，说明没有更早的消息了
        if (newBatchEndIndexInArray < 0) {
            this._hideLoadingIndicator(); // 隐藏加载指示器
            this._isLoadingOlderMessages = false; // 标记加载结束
            this._renderedOldestMessageArrayIndex = 0; // 确保索引正确标记为已到最顶
            return;
        }

        // 记录加载前的滚动高度和滚动位置，以便在加载后恢复视图，防止跳动
        const oldScrollHeight = this.chatBoxEl.scrollHeight;
        const oldScrollTop = this.chatBoxEl.scrollTop;

        // 从后往前遍历新一批旧消息 (即从较新的旧消息到更旧的旧消息)
        // 并将它们插入到聊天框的顶部
        for (let i = newBatchEndIndexInArray; i >= newBatchStartIndexInArray; i--) {
            // 调用 MessageManager 的 displayMessage 方法渲染消息
            // `true` 表示消息是前置插入 (即添加到聊天框顶部)
            MessageManager.displayMessage(this._allMessagesForCurrentChat[i], true);
        }
        // 更新已渲染的最旧消息的索引
        this._renderedOldestMessageArrayIndex = newBatchStartIndexInArray;

        // 使用 requestAnimationFrame 确保在DOM更新完成后再调整滚动位置
        requestAnimationFrame(() => {
            const newScrollHeight = this.chatBoxEl.scrollHeight; // 获取加载新消息后的滚动总高度
            // 调整滚动位置：新的 scrollTop = 原 scrollTop + (新总高度 - 旧总高度)
            // 这样可以保持用户之前看到的旧消息在屏幕上的相对位置不变
            this.chatBoxEl.scrollTop = oldScrollTop + (newScrollHeight - oldScrollHeight);
            this._hideLoadingIndicator(); // 隐藏加载指示器
            this._isLoadingOlderMessages = false; // 标记加载结束
        });
    },

    /**
     * @private
     * 异步加载并渲染更新的一批消息。
     * 当用户向下滚动到聊天框底部附近，且仍有未显示的更新消息时触发。
     */
    _loadNewerMessages: async function () {
        // 如果正在加载新消息，或者已渲染到最新的消息，或者聊天框不存在，则直接返回
        if (this._isLoadingNewerMessages || this._renderedNewestMessageArrayIndex === this._allMessagesForCurrentChat.length - 1 || !this.chatBoxEl) return;
        this._isLoadingNewerMessages = true; // 标记开始加载新消息

        // 记录加载前的滚动状态
        const oldScrollHeight = this.chatBoxEl.scrollHeight;
        const oldScrollTop = this.chatBoxEl.scrollTop;
        const clientHeight = this.chatBoxEl.clientHeight;
        // 判断在加载前，用户是否已滚动到接近底部的位置
        const wasAtBottomBeforeLoad = (oldScrollHeight - oldScrollTop - clientHeight) < 5; // 阈值设为5px

        const currentNewestLoadedIndex = this._renderedNewestMessageArrayIndex; // 当前已渲染的最新消息的索引
        // 计算新一批要加载的新消息的起始索引 (即当前最新消息的后一条)
        const newBatchStartIndexInArray = currentNewestLoadedIndex + 1;
        // 计算新一批新消息的结束索引 (从起始索引向后数 `MESSAGES_TO_LOAD_ON_SCROLL` 条，但不超过数组末尾)
        const newBatchEndIndexInArray = Math.min(this._allMessagesForCurrentChat.length - 1, newBatchStartIndexInArray + this.MESSAGES_TO_LOAD_ON_SCROLL - 1);

        // 如果计算出的起始索引已超出消息数组范围，说明没有更新的消息了
        if (newBatchStartIndexInArray >= this._allMessagesForCurrentChat.length) {
            this._isLoadingNewerMessages = false; // 标记加载结束
            return;
        }

        // 遍历并渲染新一批新消息 (追加到聊天框底部)
        for (let i = newBatchStartIndexInArray; i <= newBatchEndIndexInArray; i++) {
            // `false` 表示消息是追加到底部
            MessageManager.displayMessage(this._allMessagesForCurrentChat[i], false);
        }
        // 更新已渲染的最新消息的索引
        this._renderedNewestMessageArrayIndex = newBatchEndIndexInArray;
        const newScrollHeight = this.chatBoxEl.scrollHeight; // 获取加载新消息后的滚动总高度

        // 调整滚动位置
        if (wasAtBottomBeforeLoad) { // 如果加载前就在底部，则保持在底部 (滚动到新的底部)
            this.chatBoxEl.scrollTop = newScrollHeight;
        } else { // 否则，保持原来的滚动位置 (用户可能正在向上看历史消息)
            this.chatBoxEl.scrollTop = oldScrollTop;
        }

        // 实现滚动回弹逻辑：如果加载了新消息后，滚动条仍然非常接近底部，
        // 并且还有更多更新的消息未加载，则将滚动条稍微向上移动一点，
        // 以避免用户无法察觉到新消息的加载，并防止卡在“绝对底部”。
        const currentScrollTopAfterInitialAdjust = this.chatBoxEl.scrollTop;
        const currentDistanceToBottom = newScrollHeight - currentScrollTopAfterInitialAdjust - clientHeight;
        const stillHasMoreNewerMessagesAfterLoad = this._renderedNewestMessageArrayIndex < this._allMessagesForCurrentChat.length - 1;

        if (stillHasMoreNewerMessagesAfterLoad && currentDistanceToBottom < Config.ui.virtualScrollThreshold) {
            // 计算一个目标回弹位置，使其离开底部一段距离 (阈值 + 10px)
            let targetReboundScrollTop = newScrollHeight - clientHeight - (Config.ui.virtualScrollThreshold + 10);
            targetReboundScrollTop = Math.max(0, targetReboundScrollTop); // 确保不滚动到负值
            // 只有当目标回弹位置比当前位置更靠上 (即确实需要向上回弹)，或者加载前就在底部时，才执行回弹
            if (wasAtBottomBeforeLoad || targetReboundScrollTop > currentScrollTopAfterInitialAdjust) {
                this.chatBoxEl.scrollTop = targetReboundScrollTop;
                Utils.log(`ChatAreaUIManager: _loadNewerMessages 执行了滚动回弹。目标 scrollTop: ${targetReboundScrollTop.toFixed(0)}`, Utils.logLevels.DEBUG);
            }
        }

        this._isLoadingNewerMessages = false; // 标记加载结束
        // 根据是否已加载完所有最新消息，更新“滚动到最新”按钮的显隐状态
        if (this._renderedNewestMessageArrayIndex === this._allMessagesForCurrentChat.length - 1) {
            this._hideScrollToLatestButton(); // 已到最新，隐藏按钮
        } else {
            this._showScrollToLatestButton(); // 还有更新的，显示按钮
        }
    },

    /**
     * @private
     * 在聊天框顶部显示加载指示器 (通常用于加载更早的消息时)。
     */
    _showLoadingIndicatorAtTop: function () {
        // 确保聊天框和加载指示器元素都存在
        if (this.chatBoxEl && this._loadingIndicatorEl) {
            this._loadingIndicatorEl.style.display = 'block'; // 显示指示器
            // 确保加载指示器是聊天框的第一个子元素
            if (this.chatBoxEl.firstChild !== this._loadingIndicatorEl) {
                this.chatBoxEl.insertBefore(this._loadingIndicatorEl, this.chatBoxEl.firstChild);
            }
        }
    },

    /**
     * @private
     * 隐藏加载指示器。
     */
    _hideLoadingIndicator: function () {
        if (this._loadingIndicatorEl) {
            this._loadingIndicatorEl.style.display = 'none'; // 隐藏指示器
            // 从DOM中移除，而不仅仅是隐藏，以避免影响布局或后续的 firstChild 判断
            if (this._loadingIndicatorEl.parentNode === this.chatBoxEl) {
                this.chatBoxEl.removeChild(this._loadingIndicatorEl);
            }
        }
    },

    /**
     * 处理当前聊天的新消息，将其添加到虚拟滚动列表并显示。
     * @param {object} message - 新接收到的消息对象。
     */
    handleNewMessageForCurrentChat: function (message) {
        // 防御性检查：确保聊天框存在，当前有选定的虚拟滚动聊天ID，且该ID与当前活动聊天ID一致
        if (!this.chatBoxEl || !this._currentChatIdForVirtualScroll || this._currentChatIdForVirtualScroll !== ChatManager.currentChatId) return;

        // 将新消息添加到内存中的消息数组
        this._allMessagesForCurrentChat.push(message);

        // 判断在添加新消息之前，用户是否已滚动到接近聊天框底部的位置
        // 阈值设为150px，如果距离底部小于此值，则认为用户正在查看最新消息
        const isNearBottom = this.chatBoxEl.scrollHeight - this.chatBoxEl.scrollTop - this.chatBoxEl.clientHeight < 150;

        // 调用 MessageManager 显示新消息 (false 表示追加到聊天框底部)
        MessageManager.displayMessage(message, false);

        if (isNearBottom) { // 如果用户之前接近底部
            this.chatBoxEl.scrollTop = this.chatBoxEl.scrollHeight; // 自动滚动到新的底部，以显示新消息
            // 更新已渲染的最新消息的索引为新消息的索引
            this._renderedNewestMessageArrayIndex = this._allMessagesForCurrentChat.length - 1;
            this._hideScrollToLatestButton(); // 由于已滚动到底部，隐藏“滚动到最新消息”按钮
        } else { // 如果用户之前不在底部 (例如正在向上查看历史消息)
            this._showScrollToLatestButton(); // 显示“滚动到最新消息”按钮，提示用户有新消息
        }

        // 维护 _renderedNewestMessageArrayIndex 的准确性：
        // 如果在收到这条新消息之前，已渲染的最新消息是数组的倒数第二条
        // (即 this._allMessagesForCurrentChat.length - 2，因为数组长度刚因新消息增加了1)
        // 那么现在这条新消息已显示，它就是最新的已渲染消息。
        if (this._renderedNewestMessageArrayIndex === this._allMessagesForCurrentChat.length - 2) {
            this._renderedNewestMessageArrayIndex = this._allMessagesForCurrentChat.length - 1;
        }
    },

    /**
     * 滚动到指定的消息ID并加载其上下文。
     * 此方法会处理消息可能在不同聊天中的情况。
     * @param {string} targetMessageId - 目标消息的ID。
     */
    scrollToMessage: function (targetMessageId) {
        // 如果没有当前聊天或聊天框元素，则提示用户并返回
        if (!this._currentChatIdForVirtualScroll || !this.chatBoxEl) {
            NotificationUIManager.showNotification("请先打开一个聊天。", "warning");
            return;
        }

        let chatIdForMessage = this._currentChatIdForVirtualScroll; // 默认假设消息在当前聊天中
        // 检查目标消息是否存在于当前聊天的消息数组中
        let messageExistsInCurrentChat = ChatManager.chats[chatIdForMessage]?.some(m => m.id === targetMessageId);

        // 如果消息不在当前聊天中，则遍历所有聊天记录查找该消息
        if (!messageExistsInCurrentChat) {
            const foundChatId = Object.keys(ChatManager.chats).find(cid =>
                ChatManager.chats[cid].some(m => m.id === targetMessageId)
            );
            if (foundChatId) { // 如果找到了包含该消息的聊天
                chatIdForMessage = foundChatId; // 更新为目标消息所在的聊天ID
            } else { // 如果在所有聊天中都未找到该消息
                NotificationUIManager.showNotification("未找到目标消息。", "error");
                return;
            }
        }

        // 如果目标消息所在的聊天 (chatIdForMessage) 不是当前正在显示的聊天
        if (this._currentChatIdForVirtualScroll !== chatIdForMessage) {
            // 调用 ChatManager 打开目标聊天
            ChatManager.openChat(chatIdForMessage, chatIdForMessage.startsWith('group_') ? 'group' : 'contact');
            // 延迟执行实际的滚动操作，以等待聊天切换和初始消息渲染完成
            setTimeout(() => {
                this._performScrollToMessage(targetMessageId);
            }, 100); // 100ms 延迟，可根据实际情况调整，原150ms，尝试减少
            return;
        }

        // 如果目标消息就在当前聊天中，直接执行滚动操作
        this._performScrollToMessage(targetMessageId);
    },

    /**
     * @private
     * 执行实际的滚动到指定消息的操作。
     * 此方法假设当前聊天已是包含目标消息的聊天。
     * @param {string} targetMessageId - 目标消息的ID。
     */
    _performScrollToMessage: function (targetMessageId) {
        // 确保使用最新的消息列表副本
        this._allMessagesForCurrentChat = [...(ChatManager.chats[this._currentChatIdForVirtualScroll] || [])];
        // 在当前聊天的消息列表中查找目标消息的索引
        const targetMessageIndex = this._allMessagesForCurrentChat.findIndex(msg => msg.id === targetMessageId);

        if (targetMessageIndex === -1) { // 如果在当前聊天中未找到目标消息 (理论上不应发生，因为上层已检查)
            NotificationUIManager.showNotification("在当前聊天中未找到目标消息。", "error");
            return;
        }

        // 清空聊天框，准备重新渲染包含目标消息及其上下文的批次
        this.chatBoxEl.innerHTML = '';
        this._detachScrollListener(); // 临时移除滚动监听器，避免在渲染过程中触发不必要的加载
        this._hideLoadingIndicator(); // 隐藏加载指示器
        // 重置加载状态标记
        this._isLoadingOlderMessages = false;
        this._isLoadingNewerMessages = false;

        // 计算要渲染的消息范围 (目标消息及其前后各 CONTEXT_LOAD_COUNT 条消息)
        let startIndex = Math.max(0, targetMessageIndex - this.CONTEXT_LOAD_COUNT);
        let endIndex = Math.min(this._allMessagesForCurrentChat.length - 1, targetMessageIndex + this.CONTEXT_LOAD_COUNT);
        let currentBatchSize = endIndex - startIndex + 1; // 当前计算出的批次大小

        // 如果计算出的批次大小小于虚拟滚动的标准加载量 (MESSAGES_TO_LOAD_ON_SCROLL)，
        // 则尝试扩展批次，使其达到标准加载量，以提供更好的滚动体验。
        if (currentBatchSize < this.MESSAGES_TO_LOAD_ON_SCROLL) {
            const diff = this.MESSAGES_TO_LOAD_ON_SCROLL - currentBatchSize; // 需要额外加载的数量
            let extendForward = Math.ceil(diff / 2);  // 尝试向前扩展的数量
            let extendBackward = Math.floor(diff / 2); // 尝试向后扩展的数量

            const potentialStart = Math.max(0, startIndex - extendForward);
            const potentialEnd = Math.min(this._allMessagesForCurrentChat.length - 1, endIndex + extendBackward);

            // 调整逻辑：如果扩展后到达了消息列表的任一端，则优先从另一端补齐数量
            if (potentialStart === 0 && potentialEnd < this._allMessagesForCurrentChat.length - 1) { // 已到顶部，向后扩展满
                endIndex = Math.min(this._allMessagesForCurrentChat.length - 1, startIndex + (this.MESSAGES_TO_LOAD_ON_SCROLL - 1));
            } else if (potentialEnd === this._allMessagesForCurrentChat.length - 1 && potentialStart > 0) { // 已到底部，向前扩展满
                startIndex = Math.max(0, endIndex - (this.MESSAGES_TO_LOAD_ON_SCROLL - 1));
            } else { // 正常双向扩展
                startIndex = potentialStart;
                endIndex = potentialEnd;
            }
        }
        // 再次确保索引不越界
        startIndex = Math.max(0, startIndex);
        endIndex = Math.min(this._allMessagesForCurrentChat.length - 1, endIndex);

        // 渲染选定范围的消息
        for (let i = startIndex; i <= endIndex; i++) {
            MessageManager.displayMessage(this._allMessagesForCurrentChat[i], false); // false表示追加
        }
        // 更新已渲染消息的边界索引
        this._renderedOldestMessageArrayIndex = startIndex;
        this._renderedNewestMessageArrayIndex = endIndex;

        // 查找目标消息的DOM元素
        const targetElement = this.chatBoxEl.querySelector(`.message[data-message-id="${targetMessageId}"]`);
        if (targetElement) {
            // 延迟执行滚动，确保DOM元素已完全渲染并计算好布局
            setTimeout(() => {
                // 将目标消息滚动到视图中央
                targetElement.scrollIntoView({ behavior: 'auto', block: 'center' });
                this._lastScrollTop = this.chatBoxEl.scrollTop; // 更新上次滚动位置的记录
            }, 50); // 50ms 延迟
        } else { // 如果目标元素未找到 (异常情况)
            // 将聊天框滚动到大致中间位置作为后备
            this.chatBoxEl.scrollTop = this.chatBoxEl.scrollHeight / 2;
            this._lastScrollTop = this.chatBoxEl.scrollTop;
        }

        this._attachScrollListener(); // 重新附加滚动监听器
        // 根据是否还有未加载的最新消息，决定是否显示“滚动到最新消息”按钮
        if (this._renderedNewestMessageArrayIndex < this._allMessagesForCurrentChat.length - 1) {
            this._showScrollToLatestButton();
        } else {
            this._hideScrollToLatestButton();
        }
    },

    /**
     * 新增：滚动到指定日期的第一条消息。
     * @param {string} chatId - 聊天ID。
     * @param {string} dateString - YYYY-MM-DD格式的日期字符串。
     */
    scrollToDate: function(chatId, dateString) {
        Utils.log(`ChatAreaUIManager: scrollToDate 调用， chatId: ${chatId}, date: ${dateString}`, Utils.logLevels.DEBUG);
        // 如果没有当前聊天或聊天框元素，则提示用户并返回
        if (!this._currentChatIdForVirtualScroll || !this.chatBoxEl) {
            NotificationUIManager.showNotification("请先打开一个聊天。", "warning");
            return;
        }

        let targetChatId = chatId;
        // 检查是否需要切换聊天：如果请求的 chatId 与当前显示的聊天不同
        if (this._currentChatIdForVirtualScroll !== targetChatId) {
            // 调用 ChatManager 打开目标聊天
            ChatManager.openChat(targetChatId, targetChatId.startsWith('group_') ? 'group' : 'contact');
            // 延迟执行实际的滚动到日期操作，以等待聊天切换和初始消息渲染完成
            setTimeout(() => {
                this._performScrollToDate(targetChatId, dateString);
            }, 100); // 100ms 延迟，原150ms，尝试减少
            return;
        }
        // 如果目标日期所在的聊天已是当前聊天，直接执行滚动到日期操作
        this._performScrollToDate(targetChatId, dateString);
    },

    /**
     * @private
     * 执行实际的滚动到指定日期第一条消息的操作。
     * @param {string} chatId - 聊天ID。
     * @param {string} dateString - YYYY-MM-DD格式的日期字符串。
     */
    _performScrollToDate: function(chatId, dateString) {
        // 确保使用最新的消息列表副本
        this._allMessagesForCurrentChat = [...(ChatManager.chats[chatId] || [])];
        let firstMessageOfDate = null; // 用于存储找到的当天第一条消息

        // 将目标日期字符串 (YYYY-MM-DD) 转换为当天的开始和结束时间戳 (UTC)
        // 消息时间戳通常是ISO格式，可以方便地转换为UTC毫秒数进行比较
        const targetDate = new Date(dateString + "T00:00:00.000Z"); // 指定日期当天的 UTC 午夜零点
        const targetDateStart = targetDate.getTime(); // 当天开始的毫秒数 (UTC)
        targetDate.setUTCDate(targetDate.getUTCDate() + 1); // 将日期对象移到下一天
        const targetDateEnd = targetDate.getTime() -1; // 下一天开始的前一毫秒，即指定日期的最后一毫秒 (UTC)

        // 遍历当前聊天的所有消息，查找在指定日期范围内的第一条消息
        for (let i = 0; i < this._allMessagesForCurrentChat.length; i++) {
            const msg = this._allMessagesForCurrentChat[i];
            // 跳过正在发送中 (isThinking) 或已撤回 (isRetracted) 的消息
            if (msg.isThinking || msg.isRetracted) continue;
            // 将消息的时间戳 (通常是ISO字符串) 转换为毫秒数进行比较
            const msgTimestamp = new Date(msg.timestamp).getTime();
            // 如果消息时间戳在目标日期的开始和结束时间戳之间
            if (msgTimestamp >= targetDateStart && msgTimestamp <= targetDateEnd) {
                firstMessageOfDate = msg; // 找到了当天的第一条消息
                break; // 停止查找
            }
        }

        if (!firstMessageOfDate) { // 如果未找到指定日期的任何消息
            NotificationUIManager.showNotification(`日期 ${dateString} 没有消息。`, "info");
            return;
        }

        Utils.log(`正在滚动到 ${dateString} 的第一条消息, ID: ${firstMessageOfDate.id}`, Utils.logLevels.DEBUG);
        // 复用现有的 `_performScrollToMessage` 逻辑，通过找到的消息ID来滚动到该消息及其上下文
        this._performScrollToMessage(firstMessageOfDate.id);
    },

    /**
     * @private
     * 显示“滚动到最新消息”按钮。
     * 此按钮通常在用户向上滚动查看历史消息，且有未显示的更新消息时出现。
     */
    _showScrollToLatestButton: function () {
        // 确保聊天框及其父元素存在
        if (!this.chatBoxEl || !this.chatBoxEl.parentElement) return;

        // 如果按钮元素尚未创建，则创建它
        if (!this._scrollToLatestBtnEl) {
            this._scrollToLatestBtnEl = document.createElement('button');
            this._scrollToLatestBtnEl.id = 'scrollToLatestBtn'; // 设置ID
            this._scrollToLatestBtnEl.className = 'scroll-to-latest-btn'; // 设置CSS类名
            this._scrollToLatestBtnEl.innerHTML = '▼'; // 按钮内显示的图标或文本
            this._scrollToLatestBtnEl.title = '滚动到最新消息'; // 鼠标悬停提示
            // 绑定点击事件，调用 scrollToLatestMessages 方法
            this._scrollToLatestBtnEl.onclick = this.scrollToLatestMessages.bind(this);
            // 将按钮添加到聊天框的父容器中 (通常是包含聊天框和输入区的区域)
            this.chatBoxEl.parentElement.appendChild(this._scrollToLatestBtnEl);
        }
        // 显示按钮 (使用 flex 布局可以方便地垂直居中按钮内的图标/文本)
        this._scrollToLatestBtnEl.style.display = 'flex';
    },

    /**
     * @private
     * 隐藏“滚动到最新消息”按钮。
     * 当用户已滚动到聊天底部，或没有更多新消息时调用。
     */
    _hideScrollToLatestButton: function () {
        if (this._scrollToLatestBtnEl) { // 如果按钮元素存在
            this._scrollToLatestBtnEl.style.display = 'none'; // 隐藏按钮
        }
    },

    /**
     * 滚动到最新的消息。
     * 用户点击“滚动到最新消息”按钮时调用此方法。
     */
    scrollToLatestMessages: function () {
        Utils.log("ChatAreaUIManager: 滚动到最新消息...", Utils.logLevels.DEBUG);
        if (!this.chatBoxEl) return; // 添加检查，确保 chatBoxEl 存在
        this._detachScrollListener(); // 临时移除滚动监听器
        // 重置加载状态标记
        this._isLoadingOlderMessages = false;
        this._isLoadingNewerMessages = false;
        this._renderInitialMessageBatch(); // 重新渲染最新的消息批次 (这将自动滚动到底部)
        this._lastScrollTop = this.chatBoxEl.scrollTop; // 更新上次滚动位置的记录
        this._attachScrollListener(); // 重新附加滚动监听器
        this._hideScrollToLatestButton(); // 操作完成后隐藏按钮
    }
};