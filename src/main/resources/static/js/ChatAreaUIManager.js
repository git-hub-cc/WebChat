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
 * @dependencies LayoutUIManager, MessageManager, VideoCallManager, ChatManager, ConnectionManager, UserManager, DetailsPanelUIManager, NotificationUIManager, Utils, MediaManager, PeopleLobbyManager, EventEmitter, UIManager, Config
 * @dependents AppInitializer (进行初始化)
 */
const ChatAreaUIManager = {
    chatAreaEl: null,
    chatHeaderTitleEl: null,
    chatHeaderStatusEl: null,
    chatHeaderAvatarEl: null,
    chatHeaderMainEl: null,
    chatBoxEl: null,
    noChatSelectedScreenEl: null,
    messageInputEl: null,
    sendButtonEl: null,
    attachButtonEl: null,
    voiceButtonEl: null,
    videoCallButtonEl: null,
    audioCallButtonEl: null,
    screenShareButtonEl: null,
    chatDetailsButtonEl: null,
    peopleLobbyButtonEl: null,
    screenshotMainBtnEl: null,

    contextMenuEl: null,
    activeContextMenuMessageElement: null,
    contextMenuAutoHideTimer: null,
    aiMentionSuggestionsEl: null, // AI @提及建议列表元素

    MESSAGE_RETRACTION_WINDOW: 5 * 60 * 1000, // 消息可撤回时间窗口 (5分钟)
    CONTEXT_MENU_AUTOHIDE_DURATION: 3000, // 右键菜单自动隐藏延迟 (3秒)

    _currentChatIdForVirtualScroll: null, // 当前用于虚拟滚动的聊天ID
    _allMessagesForCurrentChat: [],       // 当前聊天的所有消息数组（内存中的副本）
    _renderedOldestMessageArrayIndex: -1, // 已渲染消息中，在 _allMessagesForCurrentChat 中最旧消息的索引
    _renderedNewestMessageArrayIndex: -1, // 已渲染消息中，在 _allMessagesForCurrentChat 中最新消息的索引
    _isLoadingOlderMessages: false,       // 是否正在加载更早的消息
    _isLoadingNewerMessages: false,       // 是否正在加载更新的消息
    _loadingIndicatorEl: null,            // 加载指示器元素
    _scrollListenerAttached: false,       // 滚动事件监听器是否已附加
    _debounceScrollTimer: null,           // 滚动事件的防抖定时器
    _boundHandleChatScroll: null,         // 绑定的滚动处理函数
    _lastScrollTop: 0,                    // 上一次的滚动位置

    _scrollToLatestBtnEl: null,           // “滚动到最新消息”按钮元素
    CONTEXT_LOAD_COUNT: 10,               // 通过资源预览跳转时，上下文加载的消息数量
    MESSAGES_TO_LOAD_ON_SCROLL: 15,       // 滚动时加载的消息数量

    /**
     * 初始化模块，获取所有需要的 DOM 元素引用并绑定核心事件。
     */
    init: function () {
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

        this._initContextMenu(); // 初始化右键菜单
        this._initAiMentionSuggestions(); // 初始化AI提及建议UI

        if (this.chatBoxEl) {
            this._loadingIndicatorEl = document.createElement('div');
            this._loadingIndicatorEl.className = 'loading-indicator-older-messages'; // 加载旧消息的指示器
            this._loadingIndicatorEl.innerHTML = '<div class="spinner"></div>';
        }
        this._boundHandleChatScroll = this._debouncedHandleChatScroll.bind(this); // 绑定防抖的滚动处理函数
        this.bindEvents(); // 绑定所有事件
    },

    /**
     * @private
     * 初始化AI提及建议的UI元素。
     * 它将被添加到聊天输入区域的父容器中，以便能正确定位在输入框上方。
     */
    _initAiMentionSuggestions: function() {
        this.aiMentionSuggestionsEl = document.createElement('div');
        this.aiMentionSuggestionsEl.id = 'aiMentionSuggestions';
        this.aiMentionSuggestionsEl.className = 'ai-mention-suggestions'; // CSS类名
        this.aiMentionSuggestionsEl.style.display = 'none'; // 默认隐藏
        this.aiMentionSuggestionsEl.style.position = 'absolute'; // 绝对定位

        // 尝试将建议列表附加到 .chat-input-container 以便正确定位
        const chatInputContainer = this.messageInputEl ? this.messageInputEl.closest('.chat-input-container') : null;
        if (chatInputContainer) {
            chatInputContainer.style.position = 'relative'; // 确保父容器是相对定位的
            chatInputContainer.appendChild(this.aiMentionSuggestionsEl);
        } else if (this.messageInputEl && this.messageInputEl.parentNode) {
            // 作为备选方案，附加到输入框的直接父级
            Utils.log("ChatAreaUIManager: 无法找到理想的 .chat-input-container 来附加提及建议。尝试添加到输入框的父级。", Utils.logLevels.WARN);
            this.messageInputEl.parentNode.style.position = 'relative';
            this.messageInputEl.parentNode.appendChild(this.aiMentionSuggestionsEl);
        } else {
            Utils.log("ChatAreaUIManager: 无法找到附加提及建议列表的合适位置。", Utils.logLevels.ERROR);
            return; // 如果无法附加，则退出
        }

        // 全局点击监听器，用于在点击建议列表外部时隐藏它
        document.addEventListener('click', (event) => {
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
        if (this.messageInputEl) {
            // 消息输入框事件
            this.messageInputEl.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey) { // 回车发送消息 (除非同时按Shift或Ctrl)
                    e.preventDefault();
                    MessageManager.sendMessage();
                    if (this.aiMentionSuggestionsEl) this.aiMentionSuggestionsEl.style.display = 'none'; // 发送后隐藏建议
                } else if (e.key === 'Escape') { // Esc键隐藏建议
                    if (this.aiMentionSuggestionsEl) this.aiMentionSuggestionsEl.style.display = 'none';
                }
            });
            this.messageInputEl.addEventListener('input', this._handleMessageInputForMentions.bind(this)); // 监听输入以处理@提及
            this.messageInputEl.addEventListener('paste', this._handlePasteEvent.bind(this)); // 新增：监听粘贴事件
        }
        if (this.sendButtonEl) {
            // 发送按钮点击事件
            this.sendButtonEl.addEventListener('click', () => {
                MessageManager.sendMessage();
                if (this.aiMentionSuggestionsEl) this.aiMentionSuggestionsEl.style.display = 'none'; // 发送后隐藏建议
            });
        }
        if (this.attachButtonEl) {
            // 附件按钮点击事件
            this.attachButtonEl.addEventListener('click', () => {
                const fileInput = document.getElementById('fileInput');
                if (fileInput) fileInput.click(); // 触发隐藏的文件输入框
            });
        }
        if (this.voiceButtonEl) {
            // 语音按钮事件 (支持触摸和鼠标)
            if ('ontouchstart' in window) { // 触摸设备
                this.voiceButtonEl.addEventListener('touchstart', (e) => { e.preventDefault(); if (!this.voiceButtonEl.disabled) MediaManager.startRecording(); });
                this.voiceButtonEl.addEventListener('touchend', (e) => { e.preventDefault(); if (!this.voiceButtonEl.disabled) MediaManager.stopRecording(); });
            } else { // 鼠标设备
                this.voiceButtonEl.addEventListener('mousedown', () => { if (!this.voiceButtonEl.disabled) MediaManager.startRecording(); });
                this.voiceButtonEl.addEventListener('mouseup', () => { if (!this.voiceButtonEl.disabled) MediaManager.stopRecording(); });
                this.voiceButtonEl.addEventListener('mouseleave', () => {
                    // 如果鼠标移开时仍在录音，则停止录音
                    if (!this.voiceButtonEl.disabled && MediaManager.mediaRecorder && MediaManager.mediaRecorder.state === 'recording') {
                        MediaManager.stopRecording();
                    }
                });
            }
        }
        if (this.screenshotMainBtnEl) {
            // 截图按钮点击事件
            this.screenshotMainBtnEl.addEventListener('click', () => MediaManager.captureScreen());
        }
        if (this.videoCallButtonEl) {
            // 视频通话按钮
            this.videoCallButtonEl.addEventListener('click', () => { if (!this.videoCallButtonEl.disabled) VideoCallManager.initiateCall(ChatManager.currentChatId); });
        }
        if (this.audioCallButtonEl) {
            // 语音通话按钮
            this.audioCallButtonEl.addEventListener('click', () => { if (!this.audioCallButtonEl.disabled) VideoCallManager.initiateAudioCall(ChatManager.currentChatId); });
        }
        if (this.screenShareButtonEl) {
            // 屏幕共享按钮
            this.screenShareButtonEl.addEventListener('click', () => { if (!this.screenShareButtonEl.disabled) VideoCallManager.initiateScreenShare(ChatManager.currentChatId); });
        }
        if (this.chatDetailsButtonEl) {
            // 聊天详情按钮
            this.chatDetailsButtonEl.addEventListener('click', () => { if (typeof DetailsPanelUIManager !== 'undefined') DetailsPanelUIManager.toggleChatDetailsView(); });
        }
        if (this.peopleLobbyButtonEl) {
            // 人员大厅按钮
            this.peopleLobbyButtonEl.addEventListener('click', () => { if (typeof DetailsPanelUIManager !== 'undefined') DetailsPanelUIManager.togglePeopleLobbyView(); });
        }
        if (this.chatAreaEl) {
            // 聊天区域的拖放事件，用于文件上传
            let dragCounter = 0; // 用于正确处理 dragenter 和 dragleave
            this.chatAreaEl.addEventListener('dragenter', (e) => {
                e.preventDefault(); e.stopPropagation();
                if (ChatManager.currentChatId && e.dataTransfer && e.dataTransfer.types.includes('Files')) { // 只在有聊天和拖入文件时响应
                    dragCounter++;
                    if (dragCounter === 1) this.chatAreaEl.classList.add('drag-over'); // 显示拖放遮罩
                }
            });
            this.chatAreaEl.addEventListener('dragover', (e) => {
                e.preventDefault(); e.stopPropagation();
                if (ChatManager.currentChatId && e.dataTransfer && e.dataTransfer.types.includes('Files')) {
                    e.dataTransfer.dropEffect = 'copy'; // 设置拖放效果为复制
                } else {
                    e.dataTransfer.dropEffect = 'none'; // 否则不允许拖放
                }
            });
            this.chatAreaEl.addEventListener('dragleave', (e) => {
                e.preventDefault(); e.stopPropagation();
                dragCounter--;
                if (dragCounter === 0) this.chatAreaEl.classList.remove('drag-over'); // 隐藏拖放遮罩
            });
            this.chatAreaEl.addEventListener('drop', (e) => {
                e.preventDefault(); e.stopPropagation();
                dragCounter = 0; this.chatAreaEl.classList.remove('drag-over');
                if (!ChatManager.currentChatId) {
                    NotificationUIManager.showNotification('发送文件前请先选择一个聊天。', 'warning');
                    return;
                }
                if (e.dataTransfer && e.dataTransfer.files.length > 0) {
                    const file = e.dataTransfer.files[0]; // 通常只处理第一个文件
                    MediaManager.processFile(file); // 交给 MediaManager 处理文件
                }
            });
        }
        if (this.chatBoxEl) {
            // 聊天框内的消息交互事件 (右键和双击)
            this.chatBoxEl.addEventListener('contextmenu', this._handleMessageInteraction.bind(this)); // 右键
            this.chatBoxEl.addEventListener('dblclick', function (event) { // 双击
                const messageElement = event.target.closest('.message:not(.system):not(.retracted)'); // 找到非系统/非撤回消息元素
                if (messageElement) {
                    // 忽略对消息内链接、按钮等的双击
                    if (event.target.closest('a, button, input, textarea, select, .file-preview-img, .play-voice-btn, .download-btn, video[controls], audio[controls]')) return;
                    this._showContextMenu(event, messageElement); // 显示上下文菜单
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

        let fileFoundAndProcessed = false;
        for (let i = 0; i < items.length; i++) {
            const item = items[i];
            if (item.kind === 'file') { // 如果项目是文件类型
                const file = item.getAsFile(); // 获取文件对象
                if (file) {
                    // 只有当我们确定要处理一个文件时，才阻止默认的文本粘贴行为
                    event.preventDefault();
                    Utils.log(`ChatAreaUIManager: 从剪贴板粘贴文件: ${file.name}, 类型: ${file.type}, 大小: ${file.size}`, Utils.logLevels.INFO);

                    // 检查是否已有待发送文件或语音
                    if (MessageManager.selectedFile) {
                        NotificationUIManager.showNotification('已有待发送的文件，请先发送或取消。', 'warning');
                        return; // 停止处理后续项目
                    }
                    if (MessageManager.audioData) {
                        NotificationUIManager.showNotification('已有待发送的语音，请先发送或取消。', 'warning');
                        return; // 停止处理后续项目
                    }

                    // 委托给 MediaManager 处理文件
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
        // 检查是否可以显示建议：输入框存在、建议元素存在、当前是群聊
        if (!this.messageInputEl || !this.aiMentionSuggestionsEl || !ChatManager.currentChatId || !ChatManager.currentChatId.startsWith('group_')) {
            if (this.aiMentionSuggestionsEl) this.aiMentionSuggestionsEl.style.display = 'none'; // 隐藏建议（如果已显示）
            return;
        }

        const text = this.messageInputEl.value; // 获取当前输入框文本
        const cursorPos = this.messageInputEl.selectionStart; // 获取光标位置
        const textBeforeCursor = text.substring(0, cursorPos); // 获取光标前的文本

        const lastAtSymbolIndex = textBeforeCursor.lastIndexOf('@'); // 查找最后一个 '@' 符号的位置

        if (lastAtSymbolIndex !== -1) {
            // 提取 '@' 符号后的查询词（到光标位置）
            const query = textBeforeCursor.substring(lastAtSymbolIndex + 1).toLowerCase();
            // 计算 '@' 和查询词的总长度，用于后续替换
            const lengthOfAtAndQuery = textBeforeCursor.length - lastAtSymbolIndex;

            const group = GroupManager.groups[ChatManager.currentChatId]; // 获取当前群组信息
            if (group && group.members) {
                // 筛选群成员中匹配查询词的 AI 角色
                const aiMembers = group.members.reduce((acc, memberId) => {
                    const contact = UserManager.contacts[memberId];
                    // 条件：是AI角色，且其名称（转小写后）包含查询词
                    if (contact && contact.isAI && contact.name.toLowerCase().includes(query)) {
                        acc.push(contact);
                    }
                    return acc;
                }, []);

                if (aiMembers.length > 0) {
                    this._populateAiMentionSuggestions(aiMembers, lengthOfAtAndQuery); // 填充并显示建议
                } else {
                    this.aiMentionSuggestionsEl.style.display = 'none'; // 没有匹配项则隐藏
                }
            } else {
                this.aiMentionSuggestionsEl.style.display = 'none'; // 群组信息不存在则隐藏
            }
        } else {
            this.aiMentionSuggestionsEl.style.display = 'none'; // 没有 '@' 符号则隐藏
        }
    },

    /**
     * @private
     * 填充 AI @ 提及建议列表，并正确定位在输入框上方。
     * @param {Array<object>} aiContacts - 匹配的 AI 联系人对象数组。
     * @param {number} lengthOfAtAndQuery - `@` 符号加上查询词的长度，用于替换。
     */
    _populateAiMentionSuggestions: function(aiContacts, lengthOfAtAndQuery) {
        if (!this.aiMentionSuggestionsEl || !this.messageInputEl) return; // 确保元素存在

        this.aiMentionSuggestionsEl.innerHTML = ''; // 清空之前的建议
        aiContacts.forEach(contact => {
            const itemEl = document.createElement('div');
            itemEl.className = 'mention-suggestion-item'; // CSS类名
            itemEl.textContent = contact.name; // 显示AI名称
            itemEl.addEventListener('click', () => { // 点击建议项的事件
                const currentText = this.messageInputEl.value;
                const cursorPos = this.messageInputEl.selectionStart;
                // 构造新文本：光标前的文本（去掉@和查询词） + "@AI名称 " + 光标后的文本
                const textBefore = currentText.substring(0, cursorPos - lengthOfAtAndQuery);
                const textAfter = currentText.substring(cursorPos);

                this.messageInputEl.value = textBefore + '@' + contact.name + ' ' + textAfter; // 更新输入框文本
                this.messageInputEl.focus(); // 重新聚焦输入框
                // 将光标移动到插入的AI名称和空格之后
                const newCursorPos = textBefore.length + 1 + contact.name.length + 1;
                this.messageInputEl.setSelectionRange(newCursorPos, newCursorPos);
                this.aiMentionSuggestionsEl.style.display = 'none'; // 隐藏建议列表
            });
            this.aiMentionSuggestionsEl.appendChild(itemEl);
        });

        // 定位建议列表在输入框的上方
        const inputRow = this.messageInputEl.closest('.input-row'); // 获取输入框所在的 .input-row 元素
        if (inputRow) {
            // 相对于 .input-row 定位
            this.aiMentionSuggestionsEl.style.bottom = inputRow.offsetHeight + 'px'; // 在 input-row 上方
            this.aiMentionSuggestionsEl.style.left = '0px'; // 与 input-row 左对齐
            this.aiMentionSuggestionsEl.style.right = '0px';// 与 input-row 右对齐
            this.aiMentionSuggestionsEl.style.width = 'auto'; // 宽度自动
        } else {
            // 作为备选，如果找不到 .input-row，则相对于输入框本身定位
            this.aiMentionSuggestionsEl.style.bottom = this.messageInputEl.offsetHeight + 5 + 'px'; // 在输入框上方，加5px间距
            this.aiMentionSuggestionsEl.style.left = this.messageInputEl.offsetLeft + 'px'; // 与输入框左对齐
            this.aiMentionSuggestionsEl.style.width = this.messageInputEl.offsetWidth + 'px'; // 与输入框同宽
        }
        this.aiMentionSuggestionsEl.style.display = 'block'; // 显示建议列表
    },

    /**
     * @private
     * 初始化消息的右键上下文菜单。
     */
    _initContextMenu: function () {
        this.contextMenuEl = document.createElement('div');
        this.contextMenuEl.id = 'customMessageContextMenu';
        this.contextMenuEl.className = 'custom-context-menu'; // CSS类名
        this.contextMenuEl.style.display = 'none'; // 默认隐藏
        document.body.appendChild(this.contextMenuEl); // 添加到body

        // 全局点击监听，用于隐藏菜单
        document.addEventListener('click', function (event) {
            if (this.contextMenuEl && this.contextMenuEl.style.display === 'block' && !this.contextMenuEl.contains(event.target)) {
                this._hideContextMenu();
            }
        }.bind(this));

        // Esc键隐藏菜单
        document.addEventListener('keydown', function (event) {
            if (event.key === 'Escape' && this.contextMenuEl && this.contextMenuEl.style.display === 'block') {
                this._hideContextMenu();
            }
        }.bind(this));
    },

    /**
     * @private
     * 处理消息元素的交互事件（右键点击）。
     * @param {MouseEvent} event - 鼠标事件对象。
     */
    _handleMessageInteraction: function (event) {
        const messageElement = event.target.closest('.message:not(.system):not(.retracted)'); // 查找非系统、非撤回的消息
        if (!messageElement) return; // 如果没找到，则忽略

        if (event.type === 'contextmenu') { // 如果是右键点击
            event.preventDefault(); // 阻止浏览器默认的右键菜单
            this._showContextMenu(event, messageElement); // 显示自定义菜单
        }
        // 双击逻辑已在 bindEvents 中处理
    },

    /**
     * @private
     * 显示消息的上下文菜单。
     * @param {MouseEvent} event - 触发菜单的事件对象 (用于定位)。
     * @param {HTMLElement} messageElement - 被操作的消息元素。
     */
    _showContextMenu: function (event, messageElement) {
        if (!this.contextMenuEl || !messageElement) return; // 防御性检查

        this._clearContextMenuAutoHideTimer(); // 清除之前的自动隐藏定时器

        // 如果有图片查看器模态框，先移除它
        const imageViewerModal = document.querySelector('.modal-like.image-viewer');
        if (imageViewerModal) imageViewerModal.remove();


        this.contextMenuEl.innerHTML = ''; // 清空菜单内容
        this.activeContextMenuMessageElement = messageElement; // 记录当前活动的消息元素

        const messageId = messageElement.dataset.messageId; // 获取消息ID
        const messageTimestamp = parseInt(messageElement.dataset.timestamp, 10); // 获取消息时间戳
        const isMyMessage = messageElement.classList.contains('sent'); // 判断是否是自己发送的消息

        if (!messageId) { // 如果没有消息ID，无法操作，隐藏菜单
            this._hideContextMenu();
            return;
        }

        // 创建“删除”按钮
        const deleteBtn = document.createElement('button');
        deleteBtn.textContent = '删除';
        deleteBtn.className = 'context-menu-button';
        deleteBtn.onclick = function () {
            this._clearContextMenuAutoHideTimer();
            MessageManager.deleteMessageLocally(messageId); // 调用删除逻辑
            this._hideContextMenu();
        }.bind(this);
        this.contextMenuEl.appendChild(deleteBtn);

        // 如果是自己发送的，且在可撤回时间窗口内，创建“撤回”按钮
        if (isMyMessage && !isNaN(messageTimestamp) && (Date.now() - messageTimestamp < this.MESSAGE_RETRACTION_WINDOW)) {
            const retractBtn = document.createElement('button');
            retractBtn.textContent = '撤回';
            retractBtn.className = 'context-menu-button';
            retractBtn.onclick = function () {
                this._clearContextMenuAutoHideTimer();
                MessageManager.requestRetractMessage(messageId); // 调用撤回逻辑
                this._hideContextMenu();
            }.bind(this);
            this.contextMenuEl.appendChild(retractBtn);
        }

        // 如果菜单没有可操作项，则不显示
        if (this.contextMenuEl.children.length === 0) {
            this._hideContextMenu();
            return;
        }

        // 定位并显示菜单
        this.contextMenuEl.style.display = 'block'; // 先显示以便获取尺寸
        const menuRect = this.contextMenuEl.getBoundingClientRect();
        const menuWidth = menuRect.width;
        const menuHeight = menuRect.height;
        this.contextMenuEl.style.display = 'none'; // 获取尺寸后先隐藏，再定位

        let x = event.clientX;
        let y = event.clientY;

        // 防止菜单超出窗口边界
        if (x + menuWidth > window.innerWidth) x = window.innerWidth - menuWidth - 5;
        if (y + menuHeight > window.innerHeight) y = window.innerHeight - menuHeight - 5;
        if (x < 0) x = 5;
        if (y < 0) y = 5;

        this.contextMenuEl.style.top = y + 'px';
        this.contextMenuEl.style.left = x + 'px';
        this.contextMenuEl.style.display = 'block';

        // 设置定时器自动隐藏菜单
        this.contextMenuAutoHideTimer = setTimeout(this._hideContextMenu.bind(this), this.CONTEXT_MENU_AUTOHIDE_DURATION);
    },

    /**
     * @private
     * 隐藏消息的上下文菜单。
     */
    _hideContextMenu: function () {
        this._clearContextMenuAutoHideTimer(); // 清除自动隐藏定时器
        if (this.contextMenuEl) this.contextMenuEl.style.display = 'none'; // 隐藏菜单
        this.activeContextMenuMessageElement = null; // 清除活动消息元素记录
    },

    /**
     * @private
     * 清除上下文菜单的自动隐藏定时器。
     */
    _clearContextMenuAutoHideTimer: function() {
        if (this.contextMenuAutoHideTimer) {
            clearTimeout(this.contextMenuAutoHideTimer);
            this.contextMenuAutoHideTimer = null;
        }
    },


    /**
     * 显示聊天区域，并隐藏“未选择聊天”的占位屏幕。
     */
    showChatArea: function () {
        if (typeof LayoutUIManager !== 'undefined') LayoutUIManager.showChatAreaLayout(); // 适配移动端布局
        if (this.noChatSelectedScreenEl) this.noChatSelectedScreenEl.style.display = 'none'; // 隐藏占位屏幕
        if (this.chatBoxEl) this.chatBoxEl.style.display = 'flex'; // 显示聊天消息框 (flex布局)
        this._hideContextMenu(); // 切换聊天时隐藏右键菜单
    },

    /**
     * 显示“未选择聊天”的占位视图，并重置相关UI状态。
     */
    showNoChatSelected: function () {
        // 重置聊天头部信息
        if (this.chatHeaderTitleEl) this.chatHeaderTitleEl.textContent = '选择一个聊天';
        if (this.chatHeaderStatusEl) {
            this.chatHeaderStatusEl.textContent = '';
            this.chatHeaderStatusEl.className = 'chat-status-main status-indicator-neutral'; // 重置状态指示器
        }
        if (this.chatHeaderAvatarEl) {
            this.chatHeaderAvatarEl.innerHTML = '';
            this.chatHeaderAvatarEl.className = 'chat-avatar-main'; // 重置头像样式
        }
        if (this.chatHeaderMainEl) this.chatHeaderMainEl.className = 'chat-header-main'; // 重置头部主题样式

        // 清空并隐藏聊天消息框，显示占位屏幕
        if (this.chatBoxEl) {
            this.chatBoxEl.innerHTML = '';
            this.chatBoxEl.style.display = 'none';
        }
        if (this.noChatSelectedScreenEl) this.noChatSelectedScreenEl.style.display = 'flex';

        this.enableChatInterface(false); // 禁用聊天输入和按钮
        if (typeof DetailsPanelUIManager !== 'undefined') DetailsPanelUIManager.hideSidePanel(); // 隐藏详情面板
        if (typeof LayoutUIManager !== 'undefined') LayoutUIManager.showChatListArea(); // 在移动端显示聊天列表

        // 处理人员大厅和聊天详情按钮的显隐
        if (this.peopleLobbyButtonEl) {
            this.peopleLobbyButtonEl.style.display = 'block';
            this.peopleLobbyButtonEl.disabled = false;
        }
        if (this.chatDetailsButtonEl) {
            this.chatDetailsButtonEl.style.display = 'none';
            this.chatDetailsButtonEl.disabled = true;
        }

        this._hideContextMenu(); // 隐藏右键菜单
        this._detachScrollListener(); // 解绑滚动监听
        // 重置虚拟滚动相关状态
        this._currentChatIdForVirtualScroll = null;
        this._allMessagesForCurrentChat = [];
        this._renderedOldestMessageArrayIndex = -1;
        this._renderedNewestMessageArrayIndex = -1;
        this._hideScrollToLatestButton(); // 隐藏“滚动到最新”按钮
    },

    /**
     * 更新聊天头部的标题、状态（包括状态指示圆点）和头像。
     * @param {string} title - 聊天标题。
     * @param {string} statusText - 状态文本。
     * @param {string} avatarTextParam - 用于头像的文本（通常是名称首字母）。
     * @param {boolean} [isGroup=false] - 是否为群组聊天。
     */
    updateChatHeader: function (title, statusText, avatarTextParam, isGroup = false) {
        if (this.chatHeaderTitleEl) this.chatHeaderTitleEl.textContent = Utils.escapeHtml(title);

        // 处理状态文本和指示圆点
        if (this.chatHeaderStatusEl) {
            this.chatHeaderStatusEl.textContent = Utils.escapeHtml(statusText); // 设置状态文本

            // 首先重置指示器的CSS类
            this.chatHeaderStatusEl.classList.remove('status-indicator-active', 'status-indicator-inactive', 'status-indicator-neutral');

            const currentId = ChatManager.currentChatId; // 当前聊天实体的ID

            if (!currentId) { // 如果没有选中聊天
                this.chatHeaderStatusEl.classList.add('status-indicator-neutral');
            } else if (isGroup) { // 如果是群聊头部
                this.chatHeaderStatusEl.classList.add('status-indicator-neutral'); // 群聊头部不显示在线/离线圆点
            } else { // 如果是联系人聊天
                const contact = UserManager.contacts[currentId];
                if (contact) {
                    if (contact.isAI) { // 如果是AI联系人
                        if (UserManager.isAiServiceHealthy) { // AI服务健康
                            this.chatHeaderStatusEl.classList.add('status-indicator-active'); // 绿色圆点
                        } else { // AI服务不可用
                            this.chatHeaderStatusEl.classList.add('status-indicator-inactive'); // 红色圆点
                        }
                    } else if (contact.isSpecial) { // 如果是特殊（非AI）联系人
                        this.chatHeaderStatusEl.classList.add('status-indicator-active'); // 假设特殊联系人总是“活跃”，显示绿色圆点
                    } else { // 普通人类联系人
                        if (ConnectionManager.isConnectedTo(currentId)) { // 已连接
                            this.chatHeaderStatusEl.classList.add('status-indicator-active'); // 绿色圆点
                        } else { // 离线
                            this.chatHeaderStatusEl.classList.add('status-indicator-inactive'); // 红色圆点
                        }
                    }
                } else { // 未找到联系人详情 (理论上在打开聊天时应存在)
                    this.chatHeaderStatusEl.classList.add('status-indicator-neutral');
                }
            }
        }

        // 处理头像和头部主题
        if (this.chatHeaderMainEl) this.chatHeaderMainEl.className = 'chat-header-main'; // 重置头部主题类
        if (this.chatHeaderAvatarEl) this.chatHeaderAvatarEl.className = 'chat-avatar-main'; // 重置头像主题类

        if (isGroup && this.chatHeaderAvatarEl) {
            this.chatHeaderAvatarEl.classList.add('group'); // 群聊头像特定样式
        }

        const currentContactForAvatar = UserManager.contacts[ChatManager.currentChatId]; // 使用当前聊天ID获取头像上下文
        let finalAvatarText = avatarTextParam ? Utils.escapeHtml(avatarTextParam) : (title && title.length > 0) ? Utils.escapeHtml(title.charAt(0).toUpperCase()) : '?';
        let avatarContentHtml;

        if (currentContactForAvatar && currentContactForAvatar.avatarUrl) { // 如果有头像URL
            let imgFallback = (currentContactForAvatar.avatarText) ? Utils.escapeHtml(currentContactForAvatar.avatarText) :
                (currentContactForAvatar.name && currentContactForAvatar.name.length > 0) ? Utils.escapeHtml(currentContactForAvatar.name.charAt(0).toUpperCase()) : '?';
            avatarContentHtml = `<img src="${currentContactForAvatar.avatarUrl}" alt="${imgFallback}" class="avatar-image" data-fallback-text="${imgFallback}" data-entity-id="${currentContactForAvatar.id}">`;

            // 如果是特殊联系人 (由UserManager根据当前主题判断)，应用特殊主题样式
            if (currentContactForAvatar.isSpecial) {
                if(this.chatHeaderAvatarEl) this.chatHeaderAvatarEl.classList.add('special-avatar', currentContactForAvatar.id);
                if(this.chatHeaderMainEl) this.chatHeaderMainEl.classList.add('character-active', `current-chat-${currentContactForAvatar.id}`);
            }
        } else { // 如果没有头像URL，使用文本头像
            avatarContentHtml = finalAvatarText;
            // 即使是文本头像，也应用特殊主题样式
            if (currentContactForAvatar && currentContactForAvatar.isSpecial) {
                if(this.chatHeaderAvatarEl) this.chatHeaderAvatarEl.classList.add('special-avatar', currentContactForAvatar.id);
                if(this.chatHeaderMainEl) this.chatHeaderMainEl.classList.add('character-active', `current-chat-${currentContactForAvatar.id}`);
            }
        }
        if (this.chatHeaderAvatarEl) this.chatHeaderAvatarEl.innerHTML = avatarContentHtml;


        // 根据是否选中聊天，控制聊天详情按钮的显隐和可用性
        const chatSelected = !!ChatManager.currentChatId;
        if (this.chatDetailsButtonEl) {
            this.chatDetailsButtonEl.style.display = chatSelected ? 'block' : 'none';
            this.chatDetailsButtonEl.disabled = !chatSelected;
        }
        // 确保人员大厅按钮始终可见且可用 (如果存在)
        if (this.peopleLobbyButtonEl) {
            this.peopleLobbyButtonEl.style.display = 'block';
            this.peopleLobbyButtonEl.disabled = false;
        }
    },

    /**
     * 更新聊天头部的状态文本。此方法仅更新文本，不改变状态指示圆点。
     * 用于显示如 "对方正在输入..." 这类次要状态。
     * @param {string} statusText - 要显示的状态文本。
     */
    updateChatHeaderStatus: function (statusText) {
        if (this.chatHeaderStatusEl) {
            this.chatHeaderStatusEl.textContent = Utils.escapeHtml(statusText);
            // 注意: 此处不修改状态指示圆点的CSS类。圆点的状态由 updateChatHeader 管理，
            // 该方法在打开聊天或发生需要重新评估圆点状态（如AI服务状态变化）的重大状态变更时调用。
            // 此函数用于更新次要状态文本，如“正在输入...”。
        }
    },


    /**
     * 启用或禁用聊天输入框和相关按钮。
     * @param {boolean} enabled - true 为启用，false 为禁用。
     */
    enableChatInterface: function (enabled) {
        const elementsToToggle = [
            this.messageInputEl, this.sendButtonEl, this.attachButtonEl,
            this.voiceButtonEl, this.chatDetailsButtonEl, this.screenshotMainBtnEl
        ];
        elementsToToggle.forEach(el => {
            if (el) el.disabled = !enabled; // 设置禁用状态
        });

        // 人员大厅按钮通常保持可用
        if (this.peopleLobbyButtonEl) this.peopleLobbyButtonEl.disabled = false;

        // 设置通话按钮状态 (基于连接和聊天类型)
        this.setCallButtonsState(enabled && ChatManager.currentChatId ? ConnectionManager.isConnectedTo(ChatManager.currentChatId) : false, ChatManager.currentChatId);

        // 如果启用，聚焦到输入框
        if (enabled && this.messageInputEl) {
            setTimeout(() => { // 延迟聚焦以确保UI已渲染
                if (this.messageInputEl) this.messageInputEl.focus();
            }, 100);
        }
    },

    /**
     * 根据连接状态和聊天类型设置通话按钮的可用性。
     * @param {boolean} enabled - 是否已连接到对方 (对于非特殊联系人)。
     * @param {string|null} [peerIdContext=null] - 当前聊天对象的ID (用于判断是否为群聊/特殊联系人)。
     */
    setCallButtonsState: function (enabled, peerIdContext = null) {
        const targetPeerForCall = peerIdContext || ChatManager.currentChatId; // 获取目标ID
        const isGroupChat = targetPeerForCall?.startsWith('group_'); // 是否为群聊
        const currentContact = UserManager.contacts[targetPeerForCall]; // 获取联系人信息
        const isSpecialChat = currentContact && currentContact.isSpecial; // 是否为特殊联系人
        const canShareScreen = !!(navigator.mediaDevices && navigator.mediaDevices.getDisplayMedia); // 浏览器是否支持屏幕共享

        // 通话按钮的最终可用状态：已连接、有目标ID、非群聊、非特殊联系人
        const finalEnabledState = enabled && targetPeerForCall && !isGroupChat && !isSpecialChat;

        if (this.videoCallButtonEl) this.videoCallButtonEl.disabled = !finalEnabledState;
        if (this.audioCallButtonEl) this.audioCallButtonEl.disabled = !finalEnabledState;
        if (this.screenShareButtonEl) this.screenShareButtonEl.disabled = !finalEnabledState || !canShareScreen; // 屏幕共享还需浏览器支持
    },

    /**
     * 为特定对方ID更新通话按钮状态（仅当该对方是当前聊天时）。
     * @param {string} peerId - 对方的ID。
     * @param {boolean} enabled - 是否已连接。
     */
    setCallButtonsStateForPeer: function (peerId, enabled) {
        if (ChatManager.currentChatId === peerId) { // 仅当是当前聊天时更新
            this.setCallButtonsState(enabled, peerId);
        }
    },

    /**
     * 当与对方断开连接时，在聊天框中显示重连提示。
     * @param {string} peerId - 断开连接的对方ID。
     * @param {function} onReconnectSuccess - 重新连接成功后的回调。
     */
    showReconnectPrompt: function (peerId, onReconnectSuccess) {
        if (!this.chatBoxEl) return; // 聊天框不存在则返回

        let promptDiv = this.chatBoxEl.querySelector(`.system-message.reconnect-prompt[data-peer-id="${peerId}"]`); // 查找现有提示
        const peerName = UserManager.contacts[peerId]?.name || `用户 ${peerId.substring(0, 4)}`; // 获取对方名称

        if (promptDiv) { // 如果提示已存在，只更新文本和按钮状态
            const textElement = promptDiv.querySelector('.reconnect-prompt-text');
            if (textElement) textElement.textContent = `与 ${Utils.escapeHtml(peerName)} 的连接已断开。`;
            const recBtn = promptDiv.querySelector('.message-inline-action-button:not(.secondary-action)');
            if (recBtn) recBtn.disabled = false; // 确保重连按钮可用
            return;
        }

        // 创建新的提示元素
        promptDiv = document.createElement('div');
        promptDiv.setAttribute('data-message-id', `reconnect_prompt_${peerId}_${Date.now()}`);
        promptDiv.className = 'message system reconnect-prompt';
        promptDiv.setAttribute('data-peer-id', peerId);
        promptDiv.innerHTML = `
<div class="message-content system-text">
    <span class="reconnect-prompt-text">与 ${Utils.escapeHtml(peerName)} 的连接已断开。</span>
<button class="message-inline-action-button">重新连接</button>
<button class="message-inline-action-button secondary-action">忽略</button>
</div>`;
        this.chatBoxEl.appendChild(promptDiv);
        this.chatBoxEl.scrollTop = this.chatBoxEl.scrollHeight; // 滚动到底部

        const reconnectButton = promptDiv.querySelector('.message-inline-action-button:not(.secondary-action)');
        const cancelButton = promptDiv.querySelector('.message-inline-action-button.secondary-action');
        const textElement = promptDiv.querySelector('.reconnect-prompt-text');

        let successHandler, failHandler; // 事件处理器引用

        // 清理提示和事件监听器的函数
        const cleanupPrompt = (removeImmediately = false) => {
            EventEmitter.off('connectionEstablished', successHandler); // 解绑成功事件
            EventEmitter.off('connectionFailed', failHandler);       // 解绑失败事件
            if (promptDiv && promptDiv.parentNode) {
                if (removeImmediately) {
                    promptDiv.remove();
                } else {
                    // 延迟移除，给用户时间看提示
                    setTimeout(() => {
                        if (promptDiv && promptDiv.parentNode) promptDiv.remove();
                    }, textElement.textContent.includes("失败") ? 5000 : 3000);
                }
            }
        };

        // 连接成功时的处理器
        successHandler = (connectedPeerId) => {
            if (connectedPeerId === peerId) { // 如果是目标对方
                if (textElement) textElement.textContent = `已重新连接到 ${Utils.escapeHtml(peerName)}。`;
                if (reconnectButton) reconnectButton.style.display = 'none'; // 隐藏重连按钮
                if (cancelButton) {
                    cancelButton.textContent = '好的'; // 将“忽略”改为“好的”
                    cancelButton.onclick = () => cleanupPrompt(true); // 点击“好的”立即移除
                }
                if (typeof onReconnectSuccess === 'function') onReconnectSuccess(); // 执行成功回调
                cleanupPrompt(); // 延迟移除提示
            }
        };

        // 连接失败时的处理器
        failHandler = (failedPeerId) => {
            if (failedPeerId === peerId) { // 如果是目标对方
                if (textElement) textElement.textContent = `无法重新连接到 ${Utils.escapeHtml(peerName)}。请尝试手动连接或刷新页面。`;
                if (reconnectButton) {
                    reconnectButton.style.display = 'initial'; // 重新显示重连按钮
                    reconnectButton.disabled = false;        // 启用按钮
                }
                if (cancelButton) cancelButton.textContent = '忽略'; // 保持“忽略”
            }
        };

        // 绑定事件
        EventEmitter.on('connectionEstablished', successHandler);
        EventEmitter.on('connectionFailed', failHandler);

        if (reconnectButton) {
            // “重新连接”按钮的点击逻辑
            reconnectButton.onclick = async () => {
                if (textElement) textElement.textContent = `正在检查信令服务器连接...`;
                reconnectButton.disabled = true; // 禁用按钮，防止重复点击

                let signalingServerNowConnected;
                // 检查WebSocket是否已连接
                if (ConnectionManager.isWebSocketConnected && ConnectionManager.websocket?.readyState === WebSocket.OPEN) {
                    signalingServerNowConnected = true;
                } else {
                    if (textElement) textElement.textContent = `信令服务器未连接。正在尝试连接...`;
                    try {
                        await ConnectionManager.connectWebSocket(); // 尝试连接WebSocket
                        signalingServerNowConnected = ConnectionManager.isWebSocketConnected && ConnectionManager.websocket?.readyState === WebSocket.OPEN;
                    } catch (wsError) {
                        Utils.log(`showReconnectPrompt: 重新连接信令服务器失败: ${wsError.message || wsError}`, Utils.logLevels.ERROR);
                        signalingServerNowConnected = false;
                    }
                }

                if (signalingServerNowConnected) { // 如果信令服务器连接成功
                    if (textElement) textElement.textContent = `信令服务器已连接。正在尝试重新连接到 ${Utils.escapeHtml(peerName)} ...`;
                    await ConnectionManager.autoConnectToContacts();
                } else { // 如果信令服务器连接失败
                    if (textElement) textElement.innerHTML = `无法连接到信令服务器。请检查您的网络，或尝试使用“菜单与设置”中的<br>“AI 与 API 配置 > 高级选项”进行手动连接。`;
                    NotificationUIManager.showNotification('尝试使用“菜单与设置”中的“AI 与 API 配置 > 高级选项”进行手动连接。', 'error');
                    reconnectButton.disabled = false; // 重新启用按钮
                }
            };
        }
        if (cancelButton) {
            // “忽略”按钮的点击逻辑
            cancelButton.onclick = () => cleanupPrompt(true); // 立即移除提示
        }
    },


    /**
     * 为指定的聊天设置聊天区域，包括初始化虚拟滚动。
     * @param {string} chatId - 要设置的聊天ID。
     */
    setupForChat: function (chatId) {
        this._detachScrollListener(); // 先解绑旧的监听器
        this.showChatArea(); // 确保聊天区域可见
        this._currentChatIdForVirtualScroll = chatId; // 设置当前虚拟滚动上下文的聊天ID
        this._allMessagesForCurrentChat = [...(ChatManager.chats[chatId] || [])]; // 获取该聊天的所有消息副本
        this._isLoadingOlderMessages = false; // 重置加载状态
        this._isLoadingNewerMessages = false;
        this._renderedOldestMessageArrayIndex = -1; // 重置已渲染消息的边界索引
        this._renderedNewestMessageArrayIndex = -1;
        this._lastScrollTop = 0; // 重置上次滚动位置
        this._renderInitialMessageBatch(); // 渲染初始消息批次 (通常是最新的消息)
        this._attachScrollListener(); // 重新附加滚动监听器
        this._hideScrollToLatestButton(); // 初始时隐藏“滚动到最新”按钮
    },

    /**
     * @private
     * 附加聊天框的滚动事件监听器。
     */
    _attachScrollListener: function () {
        if (this.chatBoxEl && !this._scrollListenerAttached) {
            this.chatBoxEl.addEventListener('scroll', this._boundHandleChatScroll); // 使用防抖函数
            this._scrollListenerAttached = true;
        }
    },

    /**
     * @private
     * 解绑聊天框的滚动事件监听器。
     */
    _detachScrollListener: function () {
        if (this.chatBoxEl && this._scrollListenerAttached && this._boundHandleChatScroll) {
            this.chatBoxEl.removeEventListener('scroll', this._boundHandleChatScroll);
            this._scrollListenerAttached = false;
            clearTimeout(this._debounceScrollTimer); // 清除防抖定时器
            this._debounceScrollTimer = null;
        }
    },

    /**
     * @private
     * 滚动事件的防抖处理函数。
     */
    _debouncedHandleChatScroll: function () {
        clearTimeout(this._debounceScrollTimer);
        this._debounceScrollTimer = setTimeout(() => {
            this._handleChatScroll();
        }, 150); // 150ms 的防抖延迟
    },

    /**
     * @private
     * 处理聊天框的滚动事件，用于触发加载更多消息和管理“滚动到最新”按钮。
     */
    _handleChatScroll: function () {
        if (!this.chatBoxEl) return; // 聊天框不存在则返回

        const { scrollTop, scrollHeight, clientHeight } = this.chatBoxEl;
        this._lastScrollTop = scrollTop; // 记录当前滚动位置

        // 如果滚动到顶部附近，且不在加载中，且还有更早的消息未渲染，则加载更早的消息
        if (scrollTop < Config.ui.virtualScrollThreshold && !this._isLoadingOlderMessages && this._renderedOldestMessageArrayIndex > 0) {
            this._loadOlderMessages();
            // 如果加载了旧消息，且当前并非显示所有最新消息，则显示“滚动到最新”按钮
            if (this._allMessagesForCurrentChat.length > 0 && this._renderedNewestMessageArrayIndex < this._allMessagesForCurrentChat.length - 1) {
                this._showScrollToLatestButton();
            }
        }

        const distanceToBottom = scrollHeight - scrollTop - clientHeight; // 计算距离底部的距离
        const hasMoreNewerMessages = this._renderedNewestMessageArrayIndex < this._allMessagesForCurrentChat.length - 1; // 是否还有更新的消息未渲染

        // 如果滚动到底部附近，且不在加载中，且还有更新的消息未渲染，则加载更新的消息
        if (hasMoreNewerMessages && !this._isLoadingNewerMessages && distanceToBottom < Config.ui.virtualScrollThreshold) {
            this._loadNewerMessages();
        }

        // 使用 requestAnimationFrame 确保在下一次绘制前执行，获取最终的滚动状态
        requestAnimationFrame(() => {
            if (!this.chatBoxEl) return;
            const finalScrollTop = this.chatBoxEl.scrollTop;
            const finalScrollHeight = this.chatBoxEl.scrollHeight;
            const finalClientHeight = this.chatBoxEl.clientHeight;
            const finalDistanceToBottom = finalScrollHeight - finalScrollTop - finalClientHeight;
            const stillHasMoreNewerMessages = this._renderedNewestMessageArrayIndex < this._allMessagesForCurrentChat.length - 1;

            // 如果还有更新的消息未加载，并且用户试图滚动到绝对底部，则轻微向上回弹，防止卡住
            if (stillHasMoreNewerMessages && !this._isLoadingNewerMessages && finalDistanceToBottom < 1) {
                const targetScrollTop = finalScrollHeight - finalClientHeight - 20; // 向上回弹20px
                if (this.chatBoxEl.scrollTop < targetScrollTop) { // 确保只在需要时调整
                    this.chatBoxEl.scrollTop = targetScrollTop;
                    Utils.log("ChatAreaUIManager: _handleChatScroll 防止停留在底部，强制向上微调。", Utils.logLevels.DEBUG);
                }
            }

            // 根据是否已滚动到底部且所有最新消息已加载，决定显隐“滚动到最新”按钮
            const isEffectivelyAtBottom = finalScrollHeight - finalScrollTop - finalClientHeight < 1;
            if (isEffectivelyAtBottom && !stillHasMoreNewerMessages) {
                this._hideScrollToLatestButton();
            } else if (stillHasMoreNewerMessages && !isEffectivelyAtBottom) {
                this._showScrollToLatestButton();
            }
        });
    },


    /**
     * @private
     * 渲染初始批次的消息到聊天框 (通常是最新的消息)。
     */
    _renderInitialMessageBatch: function () {
        if (!this.chatBoxEl || !this._currentChatIdForVirtualScroll) return; // 防御性检查

        this.chatBoxEl.innerHTML = ''; // 清空聊天框
        this._hideLoadingIndicator(); // 隐藏加载指示器

        const totalMessages = this._allMessagesForCurrentChat.length;
        if (totalMessages === 0) { // 如果没有消息
            const placeholder = document.createElement('div');
            placeholder.className = "system-message"; // 系统消息样式
            const contact = UserManager.contacts[this._currentChatIdForVirtualScroll];
            // 根据聊天类型设置占位文本
            if (contact && contact.isSpecial) {
                placeholder.textContent = `与 ${contact.name} 开始对话吧！`;
            } else if (this._currentChatIdForVirtualScroll.startsWith('group_') &&
                GroupManager.groups[this._currentChatIdForVirtualScroll]?.owner === UserManager.userId &&
                GroupManager.groups[this._currentChatIdForVirtualScroll]?.members.length === 1) {
                placeholder.textContent = "您创建了此群组。邀请成员开始聊天吧！";
            } else {
                placeholder.textContent = "暂无消息。开始对话吧！";
            }
            this.chatBoxEl.appendChild(placeholder);
            this._renderedOldestMessageArrayIndex = -1; // 重置索引
            this._renderedNewestMessageArrayIndex = -1;
            return;
        }

        // 计算要渲染的最新消息的起始和结束索引
        const endIndexInArray = totalMessages - 1;
        const startIndexInArray = Math.max(0, endIndexInArray - this.MESSAGES_TO_LOAD_ON_SCROLL + 1);

        // 渲染消息
        for (let i = startIndexInArray; i <= endIndexInArray; i++) {
            MessageManager.displayMessage(this._allMessagesForCurrentChat[i], false); // false表示追加到底部
        }

        this._renderedOldestMessageArrayIndex = startIndexInArray; // 更新已渲染消息的边界索引
        this._renderedNewestMessageArrayIndex = endIndexInArray;
        this.chatBoxEl.scrollTop = this.chatBoxEl.scrollHeight; // 滚动到底部
    },

    /**
     * @private
     * 异步加载并渲染更早的一批消息。
     */
    _loadOlderMessages: async function () {
        // 如果正在加载、已到最顶或聊天框不存在，则返回
        if (this._isLoadingOlderMessages || this._renderedOldestMessageArrayIndex === 0 || !this.chatBoxEl) return;

        this._isLoadingOlderMessages = true; // 设置加载状态
        this._showLoadingIndicatorAtTop(); // 在顶部显示加载指示器

        const currentOldestLoadedIndex = this._renderedOldestMessageArrayIndex;
        // 计算新批次消息的起止索引
        const newBatchEndIndexInArray = currentOldestLoadedIndex - 1;
        const newBatchStartIndexInArray = Math.max(0, newBatchEndIndexInArray - this.MESSAGES_TO_LOAD_ON_SCROLL + 1);

        if (newBatchEndIndexInArray < 0) { // 如果没有更早的消息了
            this._hideLoadingIndicator();
            this._isLoadingOlderMessages = false;
            this._renderedOldestMessageArrayIndex = 0; // 标记已到最顶
            return;
        }

        // 记录加载前的滚动高度和位置，用于恢复视图
        const oldScrollHeight = this.chatBoxEl.scrollHeight;
        const oldScrollTop = this.chatBoxEl.scrollTop;

        // 渲染新批次的消息 (从后往前，即从旧到新，但插入到顶部)
        for (let i = newBatchEndIndexInArray; i >= newBatchStartIndexInArray; i--) {
            MessageManager.displayMessage(this._allMessagesForCurrentChat[i], true); // true表示前置插入
        }
        this._renderedOldestMessageArrayIndex = newBatchStartIndexInArray; // 更新最旧消息索引

        // 使用 requestAnimationFrame 确保在DOM更新后调整滚动位置
        requestAnimationFrame(() => {
            const newScrollHeight = this.chatBoxEl.scrollHeight;
            // 恢复滚动位置，使用户感觉不到加载过程中的跳动
            this.chatBoxEl.scrollTop = oldScrollTop + (newScrollHeight - oldScrollHeight);
            this._hideLoadingIndicator(); // 隐藏加载指示器
            this._isLoadingOlderMessages = false; // 重置加载状态
        });
    },

    /**
     * @private
     * 异步加载并渲染更新的一批消息。
     */
    _loadNewerMessages: async function () {
        // 如果正在加载、已到最新或聊天框不存在，则返回
        if (this._isLoadingNewerMessages || this._renderedNewestMessageArrayIndex === this._allMessagesForCurrentChat.length - 1 || !this.chatBoxEl) return;
        this._isLoadingNewerMessages = true; // 设置加载状态

        // 记录加载前的滚动状态，用于恢复视图或决定是否滚动到底部
        const oldScrollHeight = this.chatBoxEl.scrollHeight;
        const oldScrollTop = this.chatBoxEl.scrollTop;
        const clientHeight = this.chatBoxEl.clientHeight;
        const wasAtBottomBeforeLoad = (oldScrollHeight - oldScrollTop - clientHeight) < 5; // 是否在加载前已接近底部

        // 计算新批次消息的起止索引
        const currentNewestLoadedIndex = this._renderedNewestMessageArrayIndex;
        const newBatchStartIndexInArray = currentNewestLoadedIndex + 1;
        const newBatchEndIndexInArray = Math.min(this._allMessagesForCurrentChat.length - 1, newBatchStartIndexInArray + this.MESSAGES_TO_LOAD_ON_SCROLL - 1);

        if (newBatchStartIndexInArray >= this._allMessagesForCurrentChat.length) { // 如果没有更新的消息了
            this._isLoadingNewerMessages = false;
            return;
        }

        // 渲染新批次的消息 (追加到底部)
        for (let i = newBatchStartIndexInArray; i <= newBatchEndIndexInArray; i++) {
            MessageManager.displayMessage(this._allMessagesForCurrentChat[i], false);
        }
        this._renderedNewestMessageArrayIndex = newBatchEndIndexInArray; // 更新最新消息索引
        const newScrollHeight = this.chatBoxEl.scrollHeight; // 获取新的滚动高度

        // 调整滚动位置
        if (wasAtBottomBeforeLoad) { // 如果加载前就在底部，则保持在底部
            this.chatBoxEl.scrollTop = newScrollHeight;
        } else { // 否则，保持原来的滚动位置
            this.chatBoxEl.scrollTop = oldScrollTop;
        }

        // 检查加载后是否需要回弹 (防止卡在底部)
        const currentScrollTopAfterInitialAdjust = this.chatBoxEl.scrollTop;
        const currentDistanceToBottom = newScrollHeight - currentScrollTopAfterInitialAdjust - clientHeight;
        const stillHasMoreNewerMessagesAfterLoad = this._renderedNewestMessageArrayIndex < this._allMessagesForCurrentChat.length - 1;

        if (stillHasMoreNewerMessagesAfterLoad && currentDistanceToBottom < Config.ui.virtualScrollThreshold) {
            let targetReboundScrollTop = newScrollHeight - clientHeight - (Config.ui.virtualScrollThreshold + 10); // 目标回弹位置
            targetReboundScrollTop = Math.max(0, targetReboundScrollTop); // 防止滚动到负数
            // 只有当目标回弹位置比当前位置更靠上，或之前就在底部时，才执行回弹
            if (wasAtBottomBeforeLoad || targetReboundScrollTop > currentScrollTopAfterInitialAdjust) {
                this.chatBoxEl.scrollTop = targetReboundScrollTop;
                Utils.log(`ChatAreaUIManager: _loadNewerMessages 执行了滚动回弹。目标 scrollTop: ${targetReboundScrollTop.toFixed(0)}`, Utils.logLevels.DEBUG);
            }
        }

        this._isLoadingNewerMessages = false; // 重置加载状态
        // 根据是否已加载完所有最新消息，更新“滚动到最新”按钮的显隐
        if (this._renderedNewestMessageArrayIndex === this._allMessagesForCurrentChat.length - 1) {
            this._hideScrollToLatestButton();
        } else {
            this._showScrollToLatestButton();
        }
    },

    /**
     * @private
     * 在聊天框顶部显示加载指示器。
     */
    _showLoadingIndicatorAtTop: function () {
        if (this.chatBoxEl && this._loadingIndicatorEl) {
            this._loadingIndicatorEl.style.display = 'block';
            // 确保加载指示器是第一个子元素
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
            this._loadingIndicatorEl.style.display = 'none';
            // 从DOM中移除，而不是仅仅隐藏，以避免影响布局
            if (this._loadingIndicatorEl.parentNode === this.chatBoxEl) {
                this.chatBoxEl.removeChild(this._loadingIndicatorEl);
            }
        }
    },

    /**
     * 处理当前聊天的新消息，将其添加到虚拟滚动列表。
     * @param {object} message - 新消息对象。
     */
    handleNewMessageForCurrentChat: function (message) {
        // 防御性检查
        if (!this.chatBoxEl || !this._currentChatIdForVirtualScroll || this._currentChatIdForVirtualScroll !== ChatManager.currentChatId) return;

        this._allMessagesForCurrentChat.push(message); // 将新消息添加到内存中的消息列表

        // 判断在添加消息前，用户是否已接近聊天框底部
        const isNearBottom = this.chatBoxEl.scrollHeight - this.chatBoxEl.scrollTop - this.chatBoxEl.clientHeight < 150;

        MessageManager.displayMessage(message, false); // 调用MessageManager显示消息 (追加到底部)

        if (isNearBottom) { // 如果之前接近底部，则自动滚动到底部
            this.chatBoxEl.scrollTop = this.chatBoxEl.scrollHeight;
            this._renderedNewestMessageArrayIndex = this._allMessagesForCurrentChat.length - 1; // 更新最新消息索引
            this._hideScrollToLatestButton(); // 隐藏“滚动到最新”按钮
        } else { // 如果之前不在底部，则显示“滚动到最新”按钮
            this._showScrollToLatestButton();
        }

        // 如果之前已渲染到倒数第二条，现在新消息来了，更新最新索引
        if (this._renderedNewestMessageArrayIndex === this._allMessagesForCurrentChat.length - 2) {
            this._renderedNewestMessageArrayIndex = this._allMessagesForCurrentChat.length - 1;
        }
    },

    /**
     * 滚动到指定的消息ID并加载其上下文。
     * @param {string} targetMessageId - 目标消息的ID。
     */
    scrollToMessage: function (targetMessageId) {
        // 如果没有当前聊天或聊天框，则提示用户
        if (!this._currentChatIdForVirtualScroll || !this.chatBoxEl) {
            NotificationUIManager.showNotification("请先打开一个聊天。", "warning");
            return;
        }

        let chatIdForMessage = this._currentChatIdForVirtualScroll; // 默认使用当前聊天的ID
        // 检查目标消息是否在当前聊天记录中
        let messageExistsInCurrentChat = ChatManager.chats[chatIdForMessage]?.some(m => m.id === targetMessageId);

        // 如果不在当前聊天中，则查找包含该消息的聊天
        if (!messageExistsInCurrentChat) {
            const foundChatId = Object.keys(ChatManager.chats).find(cid =>
                ChatManager.chats[cid].some(m => m.id === targetMessageId)
            );
            if (foundChatId) {
                chatIdForMessage = foundChatId; // 更新为找到的聊天ID
            } else {
                NotificationUIManager.showNotification("未找到目标消息。", "error");
                return;
            }
        }

        // 如果目标消息所在的聊天不是当前打开的聊天，则先切换聊天
        if (this._currentChatIdForVirtualScroll !== chatIdForMessage) {
            ChatManager.openChat(chatIdForMessage, chatIdForMessage.startsWith('group_') ? 'group' : 'contact');
            // 延迟执行滚动，等待聊天切换和初始渲染完成
            setTimeout(() => {
                this._performScrollToMessage(targetMessageId);
            }, 100); // 100ms延迟，可根据实际情况调整
            return;
        }

        // 如果目标消息在当前聊天中，直接执行滚动
        this._performScrollToMessage(targetMessageId);
    },

    /**
     * @private
     * 执行实际的滚动到消息操作。
     * @param {string} targetMessageId - 目标消息的ID。
     */
    _performScrollToMessage: function (targetMessageId) {
        // 更新当前聊天的所有消息 (以防在 `openChat` 后有变化)
        this._allMessagesForCurrentChat = [...(ChatManager.chats[this._currentChatIdForVirtualScroll] || [])];
        const targetMessageIndex = this._allMessagesForCurrentChat.findIndex(msg => msg.id === targetMessageId); // 找到目标消息的索引

        if (targetMessageIndex === -1) { // 如果未找到消息
            NotificationUIManager.showNotification("在当前聊天中未找到目标消息。", "error");
            return;
        }

        // 清空聊天框，准备重新渲染上下文
        this.chatBoxEl.innerHTML = '';
        this._detachScrollListener(); // 临时解绑滚动监听
        this._hideLoadingIndicator(); // 隐藏加载指示器
        this._isLoadingOlderMessages = false; // 重置加载状态
        this._isLoadingNewerMessages = false;

        // 计算要渲染的上下文消息的范围
        let startIndex = Math.max(0, targetMessageIndex - this.CONTEXT_LOAD_COUNT); // 目标消息前的上下文数量
        let endIndex = Math.min(this._allMessagesForCurrentChat.length - 1, targetMessageIndex + this.CONTEXT_LOAD_COUNT); // 目标消息后的上下文数量
        let currentBatchSize = endIndex - startIndex + 1; // 当前批次大小

        // 如果当前批次小于期望的最小滚动加载批次，则尝试扩展范围
        if (currentBatchSize < this.MESSAGES_TO_LOAD_ON_SCROLL) {
            const diff = this.MESSAGES_TO_LOAD_ON_SCROLL - currentBatchSize;
            let extendForward = Math.ceil(diff / 2); // 向前扩展数量
            let extendBackward = Math.floor(diff / 2); // 向后扩展数量

            const potentialStart = Math.max(0, startIndex - extendForward);
            const potentialEnd = Math.min(this._allMessagesForCurrentChat.length - 1, endIndex + extendBackward);

            // 调整逻辑：优先保证总数，并避免超出边界
            if (potentialStart === 0 && potentialEnd < this._allMessagesForCurrentChat.length - 1) { // 如果已到顶部，则向后扩展满
                endIndex = Math.min(this._allMessagesForCurrentChat.length - 1, startIndex + (this.MESSAGES_TO_LOAD_ON_SCROLL - 1));
            } else if (potentialEnd === this._allMessagesForCurrentChat.length - 1 && potentialStart > 0) { // 如果已到底部，则向前扩展满
                startIndex = Math.max(0, endIndex - (this.MESSAGES_TO_LOAD_ON_SCROLL - 1));
            } else { // 正常双向扩展
                startIndex = potentialStart;
                endIndex = potentialEnd;
            }
        }
        startIndex = Math.max(0, startIndex); // 确保不小于0
        endIndex = Math.min(this._allMessagesForCurrentChat.length - 1, endIndex); // 确保不大于最大索引

        // 渲染选定范围的消息
        for (let i = startIndex; i <= endIndex; i++) {
            MessageManager.displayMessage(this._allMessagesForCurrentChat[i], false);
        }
        this._renderedOldestMessageArrayIndex = startIndex; // 更新已渲染边界
        this._renderedNewestMessageArrayIndex = endIndex;

        // 查找目标消息的DOM元素并滚动到视图中央
        const targetElement = this.chatBoxEl.querySelector(`.message[data-message-id="${targetMessageId}"]`);
        if (targetElement) {
            setTimeout(() => { // 延迟确保DOM已更新
                targetElement.scrollIntoView({ behavior: 'auto', block: 'center' });
                this._lastScrollTop = this.chatBoxEl.scrollTop; // 更新滚动位置记录
            }, 50);
        } else { // 如果目标元素未找到 (理论上不应发生)，则滚动到大致中间位置
            this.chatBoxEl.scrollTop = this.chatBoxEl.scrollHeight / 2;
            this._lastScrollTop = this.chatBoxEl.scrollTop;
        }

        this._attachScrollListener(); // 重新附加滚动监听
        // 根据是否还有未加载的最新消息，决定是否显示“滚动到最新”按钮
        if (this._renderedNewestMessageArrayIndex < this._allMessagesForCurrentChat.length - 1) {
            this._showScrollToLatestButton();
        } else {
            this._hideScrollToLatestButton();
        }
    },

    /**
     * @private
     * 显示“滚动到最新消息”按钮。
     */
    _showScrollToLatestButton: function () {
        if (!this.chatBoxEl || !this.chatBoxEl.parentElement) return; // 确保父元素存在

        // 如果按钮不存在，则创建它
        if (!this._scrollToLatestBtnEl) {
            this._scrollToLatestBtnEl = document.createElement('button');
            this._scrollToLatestBtnEl.id = 'scrollToLatestBtn';
            this._scrollToLatestBtnEl.className = 'scroll-to-latest-btn'; // CSS类名
            this._scrollToLatestBtnEl.innerHTML = '▼'; // 图标
            this._scrollToLatestBtnEl.title = '滚动到最新消息';
            this._scrollToLatestBtnEl.onclick = this._scrollToLatestMessages.bind(this); // 绑定点击事件
            this.chatBoxEl.parentElement.appendChild(this._scrollToLatestBtnEl); // 添加到聊天框的父容器
        }
        this._scrollToLatestBtnEl.style.display = 'flex'; // 显示按钮 (flex用于居中图标)
    },

    /**
     * @private
     * 隐藏“滚动到最新消息”按钮。
     */
    _hideScrollToLatestButton: function () {
        if (this._scrollToLatestBtnEl) {
            this._scrollToLatestBtnEl.style.display = 'none'; // 隐藏按钮
        }
    },

    /**
     * @private
     * 处理“滚动到最新消息”按钮的点击事件。
     * 它会重置虚拟滚动状态并渲染最新的消息批次。
     */
    _scrollToLatestMessages: function () {
        Utils.log("ChatAreaUIManager: 滚动到最新消息...", Utils.logLevels.DEBUG);
        this._detachScrollListener(); // 临时解绑滚动监听
        this._isLoadingOlderMessages = false; // 重置加载状态
        this._isLoadingNewerMessages = false;
        this._renderInitialMessageBatch(); // 重新渲染最新的消息批次
        this._lastScrollTop = this.chatBoxEl.scrollTop; // 更新滚动位置记录
        this._attachScrollListener(); // 重新附加滚动监听
        this._hideScrollToLatestButton(); // 隐藏按钮
    }
};