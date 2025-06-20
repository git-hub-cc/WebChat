/**
 * @file AppInitializer.js
 * @description 应用的入口点和初始化器。负责按正确顺序加载和初始化所有管理器和 UI 组件，并设置核心事件监听器。
 *              现在确保 ThemeLoader.init() 在 UserManager.init() 之前被 await 调用。
 *              优化了部分异步任务的并行执行。
 *              当AI服务状态更新时，现在会正确调用 `ChatAreaUIManager.updateChatHeader` 来更新聊天头部的状态指示器。
 * @module AppInitializer
 * @exports {object} AppInitializer - 包含 init 方法，现在应由 DOMContentLoaded 事件触发。
 * @property {function} init - 应用程序的主初始化函数，是整个应用的启动点。
 * @dependencies DBManager, UserManager, ChatManager, GroupManager, ConnectionManager, MediaManager, VideoCallManager,
 *               LayoutUIManager, ModalUIManager, SettingsUIManager, ChatAreaUIManager, SidebarUIManager,
 *               DetailsPanelUIManager, VideoCallUIManager, MediaUIManager, NotificationUIManager, Utils, EventEmitter,
 *               PeopleLobbyManager, AiApiHandler, ThemeLoader, ScreenshotEditorUIManager
 * @dependents DOMContentLoaded (在 index.html 中通过新的方式调用)
 */
const AppInitializer = {

    /**
     * 应用程序的主初始化函数。
     * 按顺序执行以下操作：
     * 1.  设置日志级别和全局错误处理。
     * 2.  检查 WebRTC 支持。
     * 3.  初始化数据库 (DBManager)。
     * 4.  初始化 ThemeLoader (必须在 UserManager 之前)。
     * 5.  初始化核心数据管理器 (UserManager, ChatManager, GroupManager)。
     * 6.  初始化所有 UI 管理器。
     * 7.  初始化媒体和通话的核心逻辑。
     * 8.  设置全局事件监听器和网络监控。
     * 9.  并行执行 AI 服务健康检查、刷新网络 UI 和初始化 WebSocket 连接。
     * @returns {Promise<void>}
     */
    init: async function () {
        // --- 阶段 1: 关键的同步设置 ---
        Utils.setLogLevelFromConfig(); // 从配置设置日志级别
        this.initializeGlobalImageErrorHandler(); // 初始化全局图片错误处理器
        if (!UIManager.checkWebRTCSupport()) return; // 检查WebRTC支持，不支持则退出

        try {
            // --- 阶段 2: 核心数据加载 (主要是顺序异步) ---
            await DBManager.init(); // 初始化数据库
            Utils.log('数据库初始化成功', Utils.logLevels.INFO);

            // 初始化主题加载器 (必须在UserManager之前，因为它可能提供AI角色的初始定义)
            if (typeof ThemeLoader !== 'undefined' && typeof ThemeLoader.init === 'function') {
                await ThemeLoader.init();
                Utils.log('ThemeLoader 初始化完成。', Utils.logLevels.INFO);
            } else {
                Utils.log('ThemeLoader 或其 init 方法未定义。主题系统可能无法正常工作。', Utils.logLevels.ERROR);
            }

            await UserManager.init(); // 初始化用户管理器
            // GroupManager.init() 必须在 ChatManager.init() 之前调用,
            // 因为 ChatManager.renderChatList() 需要访问已加载的群组数据。
            await GroupManager.init(); // 初始化群组管理器
            await ChatManager.init(); // 初始化聊天管理器


            // --- 阶段 3: UI 管理器初始化 (同步, 在核心数据加载后) ---
            ModalUIManager.init();          // 模态框UI
            SettingsUIManager.init();       // 设置UI (ThemeLoader已完成，可以安全初始化)
            LayoutUIManager.init();         // 布局UI
            ChatAreaUIManager.init();       // 聊天区域UI
            SidebarUIManager.init();        // 侧边栏UI
            DetailsPanelUIManager.init();   // 详情面板UI
            VideoCallUIManager.init();      // 视频通话UI
            MediaUIManager.init();          // 媒体UI (文件/音频预览)
            PeopleLobbyManager.init();    // 人员大厅UI
            // 初始化截图编辑器UI (如果存在)
            if (typeof ScreenshotEditorUIManager !== 'undefined' && typeof ScreenshotEditorUIManager.init === 'function') {
                ScreenshotEditorUIManager.init();
                Utils.log('ScreenshotEditorUIManager 初始化完成。', Utils.logLevels.INFO);
            } else {
                Utils.log('ScreenshotEditorUIManager 或其 init 方法未定义。截图编辑功能可能无法使用。', Utils.logLevels.WARN);
            }


            // --- 阶段 4: 其他同步设置 ---
            this.startNetworkMonitoring();      // 启动网络状态监控 (同步监听器设置)
            MediaManager.initVoiceRecording(); // 初始化语音录制 (可能依赖DOM)
            VideoCallManager.init();           // 初始化视频通话核心逻辑
            this.setupCoreEventListeners();     // 设置核心事件监听器 (依赖各管理器对象存在)
            this.smartBackToChatList();       // 处理移动端返回按钮

            // --- 阶段 5: 并行执行的异步操作 ---
            const asyncOperations = []; // 用于收集所有并行异步任务的Promise

            // 1. 刷新网络状态UI (依赖 SettingsUIManager.init())
            asyncOperations.push(this.refreshNetworkStatusUI());

            // 2. AI 服务健康检查 (依赖 UserManager.init(), AiApiHandler, EventEmitter)
            const aiHealthCheckTask = async () => {
                try {
                    const isAiHealthy = await AiApiHandler.checkAiServiceHealth(); // 检查AI服务
                    UserManager.updateAiServiceStatus(isAiHealthy); // 更新UserManager中的状态
                    EventEmitter.emit('aiServiceStatusUpdated', UserManager.isAiServiceHealthy); // 触发事件
                } catch (e) {
                    Utils.log("初始化期间 AI 健康检查出错: " + e.message, Utils.logLevels.ERROR);
                    UserManager.updateAiServiceStatus(false); // 失败则设为不健康
                    EventEmitter.emit('aiServiceStatusUpdated', false); // 触发事件
                }
            };
            asyncOperations.push(aiHealthCheckTask());

            // 3. 初始化 WebSocket 连接 (如果尚未连接)
            if (ConnectionManager.websocket === null || ConnectionManager.websocket.readyState === WebSocket.CLOSED) {
                asyncOperations.push(ConnectionManager.connectWebSocket()); // 连接WebSocket
            } else {
                ConnectionManager.initialize(); // 如果已存在，则执行其内部的初始化逻辑（如用户注册）
            }

            await Promise.all(asyncOperations); // 等待所有并行任务完成

            Utils.log('应用已初始化 (所有主要异步任务已启动或完成)', Utils.logLevels.INFO);

        } catch (error) {
            Utils.log(`应用初始化失败: ${error.stack || error}`, Utils.logLevels.ERROR);
            NotificationUIManager.showNotification('应用初始化失败，部分功能可能无法使用。', 'error');

            // --- 回退模式初始化 (如果主要初始化流程失败) ---
            // 确保核心UI管理器至少被初始化，以避免页面完全卡死
            if (!UserManager.userId) { // 如果用户ID未设置（DB加载失败）
                UserManager.userId = Utils.generateId(8); // 生成临时ID
                UserManager.userSettings.autoConnectEnabled = false; // 禁用自动连接
                const userIdEl = document.getElementById('modalUserIdValue');
                if(userIdEl) userIdEl.textContent = UserManager.userId;
            }
            // 初始化基础UI管理器
            ModalUIManager.init(); SettingsUIManager.init(); LayoutUIManager.init();
            ChatAreaUIManager.init(); SidebarUIManager.init(); DetailsPanelUIManager.init();
            VideoCallUIManager.init(); MediaUIManager.init(); PeopleLobbyManager.init();
            if (typeof ScreenshotEditorUIManager !== 'undefined' && typeof ScreenshotEditorUIManager.init === 'function') {
                ScreenshotEditorUIManager.init();
            }

            // 尝试执行一些基础的后备操作
            if (typeof this.refreshNetworkStatusUI === 'function') await this.refreshNetworkStatusUI();
            if (typeof this.startNetworkMonitoring === 'function') this.startNetworkMonitoring();
            if (typeof MediaManager !== 'undefined' && typeof MediaManager.initVoiceRecording === 'function') MediaManager.initVoiceRecording();
            if (typeof VideoCallManager !== 'undefined' && typeof VideoCallManager.init === 'function') VideoCallManager.init();
            if (typeof this.setupCoreEventListeners === 'function') this.setupCoreEventListeners();
            if (typeof this.smartBackToChatList === 'function') this.smartBackToChatList();

            // 隐藏加载遮罩，并显示开源信息 (如果适用)
            const loadingOverlay = document.getElementById('loadingOverlay');
            if (loadingOverlay && loadingOverlay.style.display !== 'none') {
                loadingOverlay.style.display = 'none';
                ModalUIManager.showOpenSourceInfoModal();
            }
        }
    },

    /**
     * 初始化全局图片错误处理器。
     * 当 <img> 元素加载失败时，此处理器会捕获错误事件，
     * 并根据图片类型（如头像、文件预览）提供合适的备用内容。
     */
    initializeGlobalImageErrorHandler: function() {
        // 监听全局的图片加载错误事件 (捕获阶段)
        document.addEventListener('error', function(event) {
            const imgElement = event.target; // 获取出错的图片元素
            if (imgElement && imgElement.tagName === 'IMG') { // 确保是图片元素
                // 防止重复处理同一个加载失败的图片
                if (imgElement.classList.contains('image-load-error-processed')) return;
                imgElement.classList.add('image-load-error-processed');

                Utils.log(`图片加载失败: ${imgElement.src}。正在尝试使用备用方案。`, Utils.logLevels.WARN);

                if (imgElement.classList.contains('avatar-image')) { // 如果是头像图片
                    const fallbackText = imgElement.dataset.fallbackText || imgElement.alt || '?'; // 获取备用文本
                    const avatarContainer = imgElement.parentElement; // 获取头像容器
                    // 检查容器是否是预期的头像容器类型
                    if (avatarContainer && (
                        avatarContainer.classList.contains('chat-list-avatar') ||
                        avatarContainer.classList.contains('chat-avatar-main') ||
                        avatarContainer.classList.contains('details-avatar') ||
                        avatarContainer.classList.contains('video-call-avatar')
                    )) {
                        avatarContainer.innerHTML = ''; // 清空容器 (移除失败的img)
                        avatarContainer.textContent = fallbackText; // 设置备用文本
                        avatarContainer.classList.add('avatar-fallback-active'); // 添加备用样式类
                    } else {
                        imgElement.style.display = 'none'; // 如果不是标准头像容器，则隐藏图片
                    }
                }
                else if (imgElement.classList.contains('file-preview-img')) { // 如果是文件预览中的图片
                    const placeholder = document.createElement('div');
                    placeholder.className = 'image-message-fallback'; // 备用样式
                    placeholder.textContent = '[图片无法显示]';
                    if (imgElement.parentElement) {
                        try { imgElement.parentElement.replaceChild(placeholder, imgElement); } // 替换为备用元素
                        catch (e) { imgElement.style.display = 'none'; } // 替换失败则隐藏
                    }
                    else { imgElement.style.display = 'none'; } // 无父元素则隐藏
                }
                else { // 其他类型的图片加载失败
                    imgElement.classList.add('image-load-error'); // 添加通用错误标记类
                }
            }
        }, true); // 使用捕获阶段以确保尽早处理
        Utils.log("全局图片错误处理器已初始化。", Utils.logLevels.INFO);
    },

    /**
     * 异步刷新设置模态框中的网络状态 UI。
     */
    refreshNetworkStatusUI: async function() {
        try {
            const networkType = await Utils.checkNetworkType(); // 检测网络类型
            const wsStatus = ConnectionManager.isWebSocketConnected; // 获取WebSocket连接状态
            // 更新设置UI中的网络信息显示
            if (typeof SettingsUIManager !== 'undefined' && SettingsUIManager.updateNetworkInfoDisplay) {
                SettingsUIManager.updateNetworkInfoDisplay(networkType, wsStatus);
            }
        } catch (error) {
            Utils.log(`refreshNetworkStatusUI 出错: ${error.message || error}`, Utils.logLevels.ERROR);
            // 出错时也尝试更新UI，显示错误信息
            if (typeof SettingsUIManager !== 'undefined' && SettingsUIManager.updateNetworkInfoDisplay) {
                SettingsUIManager.updateNetworkInfoDisplay({ error: "WebRTC 检查失败" }, ConnectionManager.isWebSocketConnected);
            }
        }
    },

    /**
     * 启动网络状态监控，监听浏览器的 online 和 offline 事件。
     */
    startNetworkMonitoring: function () {
        window.addEventListener('online', this.handleNetworkChange.bind(this));  // 网络恢复在线
        window.addEventListener('offline', this.handleNetworkChange.bind(this)); // 网络断开
    },

    /**
     * 处理网络状态变化事件。
     */
    handleNetworkChange: async function () {
        if (navigator.onLine) { // 如果浏览器报告在线
            LayoutUIManager.updateConnectionStatusIndicator('网络已重新连接。正在尝试恢复连接...');
            ConnectionManager.initialize(); // 尝试重新初始化连接 (包括WebSocket)
        } else { // 如果浏览器报告离线
            LayoutUIManager.updateConnectionStatusIndicator('网络已断开。');
        }
        await this.refreshNetworkStatusUI(); // 刷新网络状态显示
    },

    /**
     * 在移动端视图下，通过监听 popstate 事件智能处理返回按钮，
     * 实现从聊天界面返回到聊天列表，而不是退出页面。
     */
    smartBackToChatList: function (){
        history.pushState(null, null, location.href); // 添加一个历史记录条目，以便可以捕获popstate
        window.addEventListener('popstate', function(event) {
            const btn = document.querySelector('.back-to-list-btn'); // 获取返回列表按钮
            // 如果返回按钮可见 (表示当前在移动端聊天视图)
            if (btn && window.getComputedStyle(btn).getPropertyValue('display') === "block"){
                history.pushState(null, null, location.href); // 再次添加历史记录，防止连续返回退出
                if (typeof LayoutUIManager !== 'undefined') LayoutUIManager.showChatListArea(); // 显示聊天列表区域
            }
        });
    },

    /**
     * 设置核心的、跨模块的事件监听器。
     * 这是实现模块间解耦通信的关键。
     */
    setupCoreEventListeners: function () {
        // --- ConnectionManager 相关事件 ---
        EventEmitter.on('connectionDisconnected', (peerId) => { // 连接断开事件
            if (typeof ChatAreaUIManager !== 'undefined') ChatAreaUIManager.setCallButtonsStateForPeer(peerId, false); // 更新通话按钮状态
            if (typeof SidebarUIManager !== 'undefined') SidebarUIManager.updateChatListItemStatus(peerId, false); // 更新侧边栏联系人状态
        });
        EventEmitter.on('connectionEstablished', (peerId) => { // 连接建立事件
            if (typeof ChatAreaUIManager !== 'undefined') {
                const contact = UserManager.contacts[peerId];
                // 更新通话按钮状态 (对非特殊联系人启用)
                ChatAreaUIManager.setCallButtonsStateForPeer(peerId, !(contact && contact.isSpecial));
            }
            if (typeof SidebarUIManager !== 'undefined') SidebarUIManager.updateChatListItemStatus(peerId, true); // 更新侧边栏联系人状态
        });
        EventEmitter.on('connectionFailed', (peerId) => { // 连接失败事件
            if (typeof ChatAreaUIManager !== 'undefined') ChatAreaUIManager.setCallButtonsStateForPeer(peerId, false);
            if (typeof SidebarUIManager !== 'undefined') SidebarUIManager.updateChatListItemStatus(peerId, false);
        });
        EventEmitter.on('connectionClosed', (peerId) => { // 连接关闭事件
            if (typeof ChatAreaUIManager !== 'undefined') ChatAreaUIManager.setCallButtonsStateForPeer(peerId, false);
            if (typeof SidebarUIManager !== 'undefined') SidebarUIManager.updateChatListItemStatus(peerId, false);
        });

        // --- WebSocket 状态更新事件 ---
        EventEmitter.on('websocketStatusUpdate', async () => {
            Utils.log('收到 WebSocket 状态更新事件，正在刷新网络 UI。', Utils.logLevels.DEBUG);
            await this.refreshNetworkStatusUI(); // 刷新网络状态显示
            if (typeof SettingsUIManager !== 'undefined' && SettingsUIManager.updateCheckNetworkButtonState) {
                SettingsUIManager.updateCheckNetworkButtonState(); // 更新设置中的“重新检查网络”按钮状态
            }
        });

        // --- AI 服务状态更新事件 ---
        EventEmitter.on('aiServiceStatusUpdated', function(isHealthy) {
            Utils.log(`AppInitializer: 收到 aiServiceStatusUpdated 事件, healthy: ${isHealthy}`, Utils.logLevels.DEBUG);
            // 如果当前聊天是AI聊天，则更新聊天头部的状态
            if (typeof ChatAreaUIManager !== 'undefined' && ChatManager.currentChatId) {
                const currentContact = UserManager.contacts[ChatManager.currentChatId];
                if (currentContact && currentContact.isAI) {
                    // 调用 updateChatHeader 以正确更新文本和状态指示圆点
                    ChatAreaUIManager.updateChatHeader(
                        currentContact.name,                           // 标题
                        UserManager.getAiServiceStatusMessage(),     // 状态文本 (会包含 "服务可用/不可用")
                        currentContact.avatarText || 'S',            // 头像文本
                        false                                        // isGroup = false
                    );
                }
            }
        });


        // --- AI 配置变更事件 ---
        // 当AI配置（如API端点、密钥）在设置中更改时，AiApiHandler需要处理
        if (typeof AiApiHandler !== 'undefined' && typeof AiApiHandler.handleAiConfigChange === 'function') {
            EventEmitter.on('aiConfigChanged', AiApiHandler.handleAiConfigChange.bind(AiApiHandler));
        } else {
            Utils.log("AppInitializer: AiApiHandler 或其 handleAiConfigChange 方法未定义，无法监听 aiConfigChanged 事件。", Utils.logLevels.WARN);
        }

        // --- 全局事件处理器 ---
        const fileInput = document.getElementById('fileInput');
        if (fileInput) fileInput.addEventListener('change', MediaManager.handleFileSelect.bind(MediaManager)); // 文件选择事件

        // 全局错误捕获
        window.addEventListener('error', (event) => {
            const errorDetails = event.error ? (event.error.stack || event.error.message) : event.message;
            Utils.log(`全局 window 错误: ${errorDetails} 位于 ${event.filename}:${event.lineno}`, Utils.logLevels.ERROR);
            NotificationUIManager.showNotification('应用程序发生错误。请检查控制台以获取详细信息。', 'error');
        });
        // 未处理的Promise rejection捕获
        window.addEventListener('unhandledrejection', function(event) {
            const reason = event.reason instanceof Error ? (event.reason.stack || event.reason.message) : event.reason;
            Utils.log(`未处理的 Promise rejection: ${reason}`, Utils.logLevels.ERROR);
            NotificationUIManager.showNotification('发生意外错误。请检查控制台。', 'error');
        });
        // 页面卸载前清理资源
        window.addEventListener('beforeunload', () => {
            MediaManager.releaseAudioResources(); // 释放音频资源
            VideoCallManager.releaseMediaResources(); // 释放视频通话媒体资源
            // 关闭所有WebRTC连接
            for (const peerId in ConnectionManager.connections) {
                if (ConnectionManager.connections.hasOwnProperty(peerId)) {
                    ConnectionManager.close(peerId, true);
                }
            }
        });

        // --- 加载覆盖层观察器 ---
        // 监听“连接状态”文本的变化，当特定文本出现时，隐藏加载遮罩
        const connectionStatusTextEl = document.getElementById('connectionStatusText');
        const loadingOverlay = document.getElementById('loadingOverlay');
        if (connectionStatusTextEl && loadingOverlay) {
            const observer = new MutationObserver(() => {
                const statusText = connectionStatusTextEl.textContent.toLowerCase();
                // 匹配表示初始化基本完成的文本
                if (statusText.includes('用户注册成功') ||
                    statusText.includes('信令服务器已连接') ||
                    statusText.includes('已从本地加载') || // 表示DB加载完成
                    statusText.includes('使用现有id') || // 表示用户ID已确定
                    statusText.includes('初始化完成，准备连接') // 通用完成提示
                ) {
                    setTimeout(() => { // 稍作延迟，确保UI稳定
                        if (loadingOverlay.style.display !== 'none') {
                            loadingOverlay.style.display = 'none'; // 隐藏加载遮罩
                            ModalUIManager.showOpenSourceInfoModal(); // 显示开源信息提示
                        }
                    }, 500);
                }
            });
            // 观察文本内容的变化
            observer.observe(connectionStatusTextEl, { childList: true, characterData: true, subtree: true });
        }
    }
};

// 当DOM内容加载完成后，执行应用初始化
window.addEventListener('load', AppInitializer.init.bind(AppInitializer));