/**
 * @file AppInitializer.js
 * @description 应用的入口点和初始化器。负责按正确顺序加载和初始化所有管理器和 UI 组件，并设置核心事件监听器。
 *              现在确保 ThemeLoader.init() 在 UserManager.init() 之前被 await 调用。
 *              优化了部分异步任务的并行执行。
 *              当AI服务状态更新时，现在会正确调用 `ChatAreaUIManager.updateChatHeader` 来更新聊天头部的状态指示器。
 *              新增 ResourcePreviewUIManager 初始化。
 *              修复：WebSocket 连接检查逻辑，以适应 ConnectionManager 的拆分。
 *                    ConnectionManager.initialize()现在会正确启动并管理WebSocket连接。
 *              定时器逻辑已移至 TimerManager。
 *              修改：AI 服务健康检查现在会在其他关键异步任务（如WebSocket初始化）之后执行。
 * @module AppInitializer
 * @exports {object} AppInitializer - 包含 init 方法，现在应由 DOMContentLoaded 事件触发。
 * @property {function} init - 应用程序的主初始化函数，是整个应用的启动点。
 * @dependencies DBManager, UserManager, ChatManager, GroupManager, ConnectionManager, MediaManager, VideoCallManager,
 *               LayoutUIManager, ModalUIManager, SettingsUIManager, ChatAreaUIManager, SidebarUIManager,
 *               DetailsPanelUIManager, VideoCallUIManager, MediaUIManager, NotificationUIManager, Utils, EventEmitter,
 *               PeopleLobbyManager, AiApiHandler, ThemeLoader, ScreenshotEditorUIManager, ResourcePreviewUIManager, WebSocketManager, TimerManager
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
     * 9.  并行执行部分异步任务（刷新网络UI, WebSocket连接），然后串行执行AI服务健康检查。
     * @returns {Promise<void>}
     */
    init: async function () {
        // --- 阶段 1: 关键的同步设置 ---
        Utils.setLogLevelFromConfig(); // 从配置设置日志级别
        this.initializeGlobalImageErrorHandler(); // 初始化全局图片错误处理器
        if (!Utils.checkWebRTCSupport()) return; // 检查WebRTC支持，不支持则退出
        TimerManager.init(); // 初始化 TimerManager

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
            if (typeof ResourcePreviewUIManager !== 'undefined' && ResourcePreviewUIManager.init) { // 新增
                ResourcePreviewUIManager.init();
                Utils.log('ResourcePreviewUIManager 初始化完成。', Utils.logLevels.INFO);
            } else {
                Utils.log('ResourcePreviewUIManager 或其 init 方法未定义。资源预览功能可能无法使用。', Utils.logLevels.WARN);
            }
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

            // --- 阶段 5: 并行执行的初始异步操作 ---
            const initialAsyncOperations = []; // 用于收集并行异步任务的Promise

            // 1. 刷新网络状态UI (依赖 SettingsUIManager.init())
            initialAsyncOperations.push(this.refreshNetworkStatusUI());

            // 2. 初始化 WebSocket 连接 (并处理注册)
            if (typeof ConnectionManager !== 'undefined' && typeof ConnectionManager.initialize === 'function') {
                const cmInitPromise = ConnectionManager.initialize();
                if (cmInitPromise && typeof cmInitPromise.catch === 'function') {
                    initialAsyncOperations.push(cmInitPromise.catch(wsError => {
                        Utils.log(`AppInitializer: WebSocket 初始化/连接失败: ${wsError.message || wsError}`, Utils.logLevels.ERROR);
                    }));
                } else {
                    Utils.log('AppInitializer: ConnectionManager.initialize() did not return a valid Promise. WebSocket initialization might be incomplete.', Utils.logLevels.ERROR);
                    initialAsyncOperations.push(Promise.resolve()); // Push resolved to not break Promise.all
                }
            } else {
                Utils.log('AppInitializer: ConnectionManager 未定义或其 initialize 方法未定义，无法初始化 WebSocket 连接。', Utils.logLevels.ERROR);
                initialAsyncOperations.push(Promise.resolve());
            }

            await Promise.all(initialAsyncOperations); // 等待这些初始并行任务完成

            // --- 阶段 6: 后续异步操作 (如 AI 健康检查) ---
            // AI 服务健康检查 (依赖 UserManager.init(), AiApiHandler, EventEmitter, and now critical async ops are done)
            try {
                // AiApiHandler.checkAiServiceHealth() 内部会记录端点是否配置
                const isAiHealthy = await AiApiHandler.checkAiServiceHealth();
                UserManager.updateAiServiceStatus(isAiHealthy);
            } catch (e) {
                Utils.log("初始化期间 AI 健康检查出错: " + e.message, Utils.logLevels.ERROR);
                UserManager.updateAiServiceStatus(false);
            }

            Utils.log('应用已初始化 (所有主要异步任务已启动或完成)', Utils.logLevels.INFO);

        } catch (error) {
            Utils.log(`应用初始化失败: ${error.stack || error}`, Utils.logLevels.ERROR);
            NotificationUIManager.showNotification('应用初始化失败，部分功能可能无法使用。', 'error');

            // --- 回退模式初始化 (如果主要初始化流程失败) ---
            if (!UserManager.userId) {
                UserManager.userId = Utils.generateId(8);
                UserManager.userSettings.autoConnectEnabled = false;
                const userIdEl = document.getElementById('modalUserIdValue');
                if(userIdEl) userIdEl.textContent = UserManager.userId;
            }
            // 确保UI管理器在回退模式下也被初始化
            if (typeof ModalUIManager !== 'undefined' && ModalUIManager.init) ModalUIManager.init();
            if (typeof SettingsUIManager !== 'undefined' && SettingsUIManager.init) SettingsUIManager.init();
            if (typeof LayoutUIManager !== 'undefined' && LayoutUIManager.init) LayoutUIManager.init();
            if (typeof ChatAreaUIManager !== 'undefined' && ChatAreaUIManager.init) ChatAreaUIManager.init();
            if (typeof SidebarUIManager !== 'undefined' && SidebarUIManager.init) SidebarUIManager.init();
            if (typeof DetailsPanelUIManager !== 'undefined' && DetailsPanelUIManager.init) DetailsPanelUIManager.init();
            if (typeof ResourcePreviewUIManager !== 'undefined' && ResourcePreviewUIManager.init) ResourcePreviewUIManager.init();
            if (typeof VideoCallUIManager !== 'undefined' && VideoCallUIManager.init) VideoCallUIManager.init();
            if (typeof MediaUIManager !== 'undefined' && MediaUIManager.init) MediaUIManager.init();
            if (typeof PeopleLobbyManager !== 'undefined' && PeopleLobbyManager.init) PeopleLobbyManager.init();
            if (typeof ScreenshotEditorUIManager !== 'undefined' && typeof ScreenshotEditorUIManager.init === 'function') {
                ScreenshotEditorUIManager.init();
            }

            // 回退模式下的其他初始化
            if (typeof this.refreshNetworkStatusUI === 'function') await this.refreshNetworkStatusUI();
            if (typeof this.startNetworkMonitoring === 'function') this.startNetworkMonitoring();
            if (typeof MediaManager !== 'undefined' && typeof MediaManager.initVoiceRecording === 'function') MediaManager.initVoiceRecording();
            if (typeof VideoCallManager !== 'undefined' && typeof VideoCallManager.init === 'function') VideoCallManager.init();
            if (typeof this.setupCoreEventListeners === 'function') this.setupCoreEventListeners();
            if (typeof this.smartBackToChatList === 'function') this.smartBackToChatList();
            // 在回退模式下，如果 ConnectionManager 及其方法可用，则尝试初始化连接
            if (typeof ConnectionManager !== 'undefined' && typeof ConnectionManager.initialize === 'function') {
                const cmInitPromiseFallback = ConnectionManager.initialize();
                if (cmInitPromiseFallback && typeof cmInitPromiseFallback.catch === 'function') {
                    cmInitPromiseFallback.catch(wsError => {
                        Utils.log(`AppInitializer (fallback): WebSocket 连接尝试失败: ${wsError.message || wsError}`, Utils.logLevels.WARN);
                    });
                } else {
                    Utils.log('AppInitializer (fallback): ConnectionManager.initialize() did not return a valid Promise.', Utils.logLevels.WARN);
                }
            }


            const loadingOverlay = document.getElementById('loadingOverlay');
            if (loadingOverlay && loadingOverlay.style.display !== 'none') {
                loadingOverlay.style.display = 'none';
                if (typeof ModalUIManager !== 'undefined' && ModalUIManager.showOpenSourceInfoModal) {
                    ModalUIManager.showOpenSourceInfoModal();
                }
            }
        }
    },

    /**
     * 初始化全局图片错误处理器。
     */
    initializeGlobalImageErrorHandler: function() {
        document.addEventListener('error', function(event) {
            const imgElement = event.target;
            if (imgElement && imgElement.tagName === 'IMG') {
                if (imgElement.classList.contains('image-load-error-processed')) return;
                imgElement.classList.add('image-load-error-processed');
                Utils.log(`图片加载失败: ${imgElement.src}。正在尝试使用备用方案。`, Utils.logLevels.WARN);
                if (imgElement.classList.contains('avatar-image')) {
                    const fallbackText = imgElement.dataset.fallbackText || imgElement.alt || '?';
                    const avatarContainer = imgElement.parentElement;
                    if (avatarContainer && (
                        avatarContainer.classList.contains('chat-list-avatar') ||
                        avatarContainer.classList.contains('chat-avatar-main') ||
                        avatarContainer.classList.contains('details-avatar') ||
                        avatarContainer.classList.contains('video-call-avatar')
                    )) {
                        avatarContainer.innerHTML = '';
                        avatarContainer.textContent = fallbackText;
                        avatarContainer.classList.add('avatar-fallback-active');
                    } else {
                        imgElement.style.display = 'none';
                    }
                }
                else if (imgElement.classList.contains('file-preview-img')) {
                    const placeholder = document.createElement('div');
                    placeholder.className = 'image-message-fallback';
                    placeholder.textContent = '[图片无法显示]';
                    if (imgElement.parentElement) {
                        try { imgElement.parentElement.replaceChild(placeholder, imgElement); }
                        catch (e) { imgElement.style.display = 'none'; }
                    }
                    else { imgElement.style.display = 'none'; }
                }
                else {
                    imgElement.classList.add('image-load-error');
                }
            }
        }, true);
        Utils.log("全局图片错误处理器已初始化。", Utils.logLevels.INFO);
    },

    /**
     * 异步刷新设置模态框中的网络状态 UI。
     */
    refreshNetworkStatusUI: async function() {
        try {
            const networkType = await Utils.checkNetworkType();
            // ConnectionManager.isWebSocketConnected 会从 WebSocketManager 获取状态
            const wsStatus = (typeof ConnectionManager !== 'undefined') ? ConnectionManager.isWebSocketConnected : false;
            if (typeof SettingsUIManager !== 'undefined' && SettingsUIManager.updateNetworkInfoDisplay) {
                SettingsUIManager.updateNetworkInfoDisplay(networkType, wsStatus);
            }
        } catch (error) {
            Utils.log(`refreshNetworkStatusUI 出错: ${error.message || error}`, Utils.logLevels.ERROR);
            if (typeof SettingsUIManager !== 'undefined' && SettingsUIManager.updateNetworkInfoDisplay) {
                const wsStatusFallback = (typeof ConnectionManager !== 'undefined') ? ConnectionManager.isWebSocketConnected : false;
                SettingsUIManager.updateNetworkInfoDisplay({ error: "WebRTC 检查失败" }, wsStatusFallback);
            }
        }
    },

    /**
     * 启动网络状态监控。
     */
    startNetworkMonitoring: function () {
        window.addEventListener('online', this.handleNetworkChange.bind(this));
        window.addEventListener('offline', this.handleNetworkChange.bind(this));
    },

    /**
     * 处理网络状态变化事件。
     */
    handleNetworkChange: async function () {
        if (navigator.onLine) {
            LayoutUIManager.updateConnectionStatusIndicator('网络已重新连接。正在尝试恢复连接...');
            if (typeof ConnectionManager !== 'undefined' && typeof ConnectionManager.initialize === 'function') {
                const cmInitPromise = ConnectionManager.initialize(); // 尝试重新初始化/连接 WebSocket
                if (cmInitPromise && typeof cmInitPromise.catch === 'function') {
                    cmInitPromise.catch(wsError => {
                        Utils.log(`AppInitializer (handleNetworkChange): WebSocket 连接尝试失败: ${wsError.message || wsError}`, Utils.logLevels.WARN);
                    });
                } else {
                    Utils.log('AppInitializer (handleNetworkChange): ConnectionManager.initialize() did not return a valid Promise.', Utils.logLevels.WARN);
                }
            }
        } else {
            LayoutUIManager.updateConnectionStatusIndicator('网络已断开。');
        }
        await this.refreshNetworkStatusUI();
    },

    /**
     * 智能处理移动端返回按钮。
     */
    smartBackToChatList: function (){
        // Check if current URL is the base URL (no userId in path)
        // This logic assumes that URLs without a userId are the "base" state before a user context is established.
        if (location.pathname === '/' || location.pathname === '/index.html' || location.pathname === (AppSettings.ui.baseUrl || '/')) {
            // If it's the base URL, replace the state so that the first "meaningful" URL (e.g., with userId)
            // becomes the one the user would return to if they leave and come back,
            // or if they manually change the URL and hit back.
            history.replaceState(null, null, location.href);
        } else {
            // If it's not the base URL (e.g., already has a userId or other path info),
            // then push a new state. This is more conservative and aligns with the original intent
            // for non-initial states.
            history.pushState(null, null, location.href);
        }

        window.addEventListener('popstate', function(event) {
            const btn = document.querySelector('.back-to-list-btn');
            if (btn && window.getComputedStyle(btn).getPropertyValue('display') === "block"){
                // When popstate occurs due to back button in mobile view showing chat area,
                // push a new state again to "consume" the back action, effectively preventing
                // going back further in history and instead showing the chat list.
                history.pushState(null, null, location.href);
                if (typeof LayoutUIManager !== 'undefined') LayoutUIManager.showChatListArea();
            }
        });
    },

    /**
     * 设置核心的、跨模块的事件监听器。
     */
    setupCoreEventListeners: function () {
        EventEmitter.on('connectionDisconnected', (peerId) => {
            if (typeof ChatAreaUIManager !== 'undefined') ChatAreaUIManager.setCallButtonsStateForPeer(peerId, false);
            if (typeof SidebarUIManager !== 'undefined') SidebarUIManager.updateChatListItemStatus(peerId, false);
        });
        EventEmitter.on('connectionEstablished', (peerId) => {
            if (typeof ChatAreaUIManager !== 'undefined') {
                const contact = UserManager.contacts[peerId];
                ChatAreaUIManager.setCallButtonsStateForPeer(peerId, !(contact && contact.isSpecial));
            }
            if (typeof SidebarUIManager !== 'undefined') SidebarUIManager.updateChatListItemStatus(peerId, true);
        });
        EventEmitter.on('connectionFailed', (peerId) => {
            if (typeof ChatAreaUIManager !== 'undefined') ChatAreaUIManager.setCallButtonsStateForPeer(peerId, false);
            if (typeof SidebarUIManager !== 'undefined') SidebarUIManager.updateChatListItemStatus(peerId, false);
        });
        EventEmitter.on('connectionClosed', (peerId) => {
            if (typeof ChatAreaUIManager !== 'undefined') ChatAreaUIManager.setCallButtonsStateForPeer(peerId, false);
            if (typeof SidebarUIManager !== 'undefined') SidebarUIManager.updateChatListItemStatus(peerId, false);
        });
        EventEmitter.on('websocketStatusUpdate', async () => {
            Utils.log('收到 WebSocket 状态更新事件，正在刷新网络 UI。', Utils.logLevels.DEBUG);
            await this.refreshNetworkStatusUI();
            if (typeof SettingsUIManager !== 'undefined' && SettingsUIManager.updateCheckNetworkButtonState) {
                SettingsUIManager.updateCheckNetworkButtonState();
            }
        });
        EventEmitter.on('aiServiceStatusUpdated', function(isHealthy) {
            Utils.log(`AppInitializer: 收到 aiServiceStatusUpdated 事件, healthy: ${isHealthy}`, Utils.logLevels.DEBUG);
            if (typeof ChatAreaUIManager !== 'undefined' && ChatManager.currentChatId) {
                const currentContact = UserManager.contacts[ChatManager.currentChatId];
                if (currentContact && currentContact.isAI) {
                    ChatAreaUIManager.updateChatHeader(
                        currentContact.name,
                        UserManager.getAiServiceStatusMessage(),
                        currentContact.avatarText || 'S',
                        false
                    );
                }
            }
        });

        if (typeof AiApiHandler !== 'undefined' && typeof AiApiHandler.handleAiConfigChange === 'function') {
            EventEmitter.on('aiConfigChanged', AiApiHandler.handleAiConfigChange.bind(AiApiHandler));
        } else {
            Utils.log("AppInitializer: AiApiHandler 或其 handleAiConfigChange 方法未定义，无法监听 aiConfigChanged 事件。", Utils.logLevels.WARN);
        }

        const fileInput = document.getElementById('fileInput');
        if (fileInput) fileInput.addEventListener('change', MediaManager.handleFileSelect.bind(MediaManager));

        window.addEventListener('error', (event) => {
            const errorDetails = event.error ? (event.error.stack || event.error.message) : event.message;
            Utils.log(`全局 window 错误: ${errorDetails} 位于 ${event.filename}:${event.lineno}`, Utils.logLevels.ERROR);
            NotificationUIManager.showNotification('应用程序发生错误。请检查控制台以获取详细信息。', 'error');
        });
        window.addEventListener('unhandledrejection', function(event) {
            const reason = event.reason instanceof Error ? (event.reason.stack || event.reason.message) : event.reason;
            Utils.log(`未处理的 Promise rejection: ${reason}`, Utils.logLevels.ERROR);
            NotificationUIManager.showNotification('发生意外错误。请检查控制台。', 'error');
        });
        window.addEventListener('beforeunload', () => {
            MediaManager.releaseAudioResources();
            VideoCallManager.releaseMediaResources();
            // ConnectionManager.closeAllConnections() 或类似方法会更合适，如果 WebRTCManager 提供了的话
            if (typeof WebRTCManager !== 'undefined' && WebRTCManager.connections) {
                for (const peerId in WebRTCManager.connections) {
                    if (WebRTCManager.connections.hasOwnProperty(peerId)) {
                        // ConnectionManager.close 会调用 WebRTCManager.closeConnection
                        if (typeof ConnectionManager !== 'undefined' && ConnectionManager.close) ConnectionManager.close(peerId, true);
                    }
                }
            }
            // Stop all timers when leaving the page
            if (typeof TimerManager !== 'undefined') {
                TimerManager.stopAllTasks();
            }
        });

        const connectionStatusTextEl = document.getElementById('connectionStatusText');
        const loadingOverlay = document.getElementById('loadingOverlay');
        if (connectionStatusTextEl && loadingOverlay) {
            const observer = new MutationObserver(() => {
                const statusText = connectionStatusTextEl.textContent.toLowerCase();
                if (statusText.includes('用户注册成功') ||
                    statusText.includes('信令服务器已连接') ||
                    statusText.includes('已从本地加载') ||
                    statusText.includes('使用现有id') ||
                    statusText.includes('初始化完成，准备连接')
                ) {
                    setTimeout(() => {
                        if (loadingOverlay.style.display !== 'none') {
                            loadingOverlay.style.display = 'none';
                            ModalUIManager.showOpenSourceInfoModal();
                        }
                    }, 500);
                }
            });
            observer.observe(connectionStatusTextEl, { childList: true, characterData: true, subtree: true });
        }
    }
};

window.addEventListener('DOMContentLoaded', () => {
    AppInitializer.init();
});