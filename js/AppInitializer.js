/**
 * @file AppInitializer.js - 应用初始化器
 * @description
 *      作为应用的入口点，负责按预定顺序加载和初始化所有管理器、UI 组件，并设置核心事件监听器。
 *      此模块确保了应用启动流程的健壮性和正确性，例如：
 *      - 确保主题在用户管理器之前加载。
 *      - 通过并行执行优化异步任务的启动速度。
 *      - 确保在 AI 服务状态变更时，能正确更新 UI。
 *      - 拆分和重构了 WebSocket 连接管理与定时器任务。
 *      - 初始化流程现在依赖 Store 状态分发来触发首次渲染，移除了对 UI 管理器的直接调用。
 * @module AppInitializer
 * @exports {object} AppInitializer - 包含应用主入口 `init` 方法，由 `DOMContentLoaded` 事件触发。
 * @dependency
 *      核心管理器: DBManager, UserManager, ChatManager, GroupManager, ConnectionManager, MediaManager,
 *                VideoCallManager, PeopleLobbyManager, WebSocketManager, TimerManager, CharacterCardManager, MemoryBookManager
 *      UI 管理器:   LayoutUIManager, ModalUIManager, SettingsUIManager, ChatAreaUIManager, SidebarUIManager,
 *                 DetailsPanelUIManager, VideoCallUIManager, MediaUIManager, NotificationUIManager,
 *                 ScreenshotEditorUIManager, ResourcePreviewUIManager
 *      核心工具:    Utils, EventEmitter, AiApiHandler, ThemeLoader
 *      状态管理:    Store, ActionCreators
 */
const AppInitializer = {

    /**
     * 应用程序的主初始化函数，负责整个应用的启动流程。
     * @function init
     * @returns {Promise<void>} 初始化过程是异步的，但没有具体的返回值。
     * @throws {Error} 当初始化过程中出现严重错误（如数据库无法启动）时，会抛出异常。
     */
    init: async function () {
        // --- 初始化流程第 1 阶段：执行关键的同步设置 ---
        // 1. 初始化中央状态管理器 Store
        Store.init();
        // 2. 从配置中设置日志级别
        Utils.setLogLevelFromConfig();
        // 3. 设置全局图片加载失败的处理器
        this.initializeGlobalImageErrorHandler();
        // 4. 检查浏览器是否支持 WebRTC，如果不支持则中止初始化
        if (!Utils.checkWebRTCSupport()) return;
        // 5. 初始化定时器管理器
        TimerManager.init();

        try {
            // --- 初始化流程第 2 阶段：按顺序异步加载核心数据 ---
            // 1. 初始化数据库，这是后续所有数据管理器的基础
            await DBManager.init();
            Utils.log('数据库初始化成功', Utils.logLevels.INFO);

            // 2. 初始化记忆书管理器（如果存在）
            if (typeof MemoryBookManager !== 'undefined' && typeof MemoryBookManager.init === 'function') {
                await MemoryBookManager.init();
            } else {
                Utils.log('MemoryBookManager 或其 init 方法未定义。记忆书功能可能无法使用。', Utils.logLevels.WARN);
            }

            // 3. 初始化主题加载器，确保在渲染任何 UI 前加载主题
            if (typeof ThemeLoader !== 'undefined' && typeof ThemeLoader.init === 'function') {
                await ThemeLoader.init();
                Utils.log('ThemeLoader 初始化完成。', Utils.logLevels.INFO);
            } else {
                // NOTE: 主题系统是核心视觉功能，如果失败则记录为错误
                Utils.log('ThemeLoader 或其 init 方法未定义。主题系统可能无法正常工作。', Utils.logLevels.ERROR);
            }

            // 4. 初始化用户、群组和聊天管理器
            await UserManager.init();
            await GroupManager.init();
            await ChatManager.init();

            // --- 初始化流程第 3 阶段：同步初始化所有 UI 管理器 ---
            // NOTE: UI 管理器通常是同步的，它们注册事件监听器并准备好接收来自 Store 的状态更新
            ModalUIManager.init();
            SettingsUIManager.init();
            LayoutUIManager.init();
            ChatAreaUIManager.init();
            SidebarUIManager.init();
            DetailsPanelUIManager.init();
            if (typeof ResourcePreviewUIManager !== 'undefined' && ResourcePreviewUIManager.init) {
                ResourcePreviewUIManager.init();
            }
            VideoCallUIManager.init();
            MediaUIManager.init();
            PeopleLobbyManager.init();
            EmojiStickerUIManager.init();
            if (typeof ScreenshotEditorUIManager !== 'undefined' && typeof ScreenshotEditorUIManager.init === 'function') {
                ScreenshotEditorUIManager.init();
            }
            if (typeof CharacterCardManager !== 'undefined' && CharacterCardManager.init) {
                CharacterCardManager.init();
            }

            // --- 初始化流程第 4 阶段：执行其他必要的同步设置 ---
            this.startNetworkMonitoring();
            MediaManager.initVoiceRecording();
            VideoCallManager.init();
            this.setupCoreEventListeners();
            this.smartBackToChatList();

            // --- 初始化流程第 5 阶段：并行执行初始的异步操作以提升性能 ---
            // 用于收集需要并行执行的异步任务
            const initialAsyncOperations = [];

            // 1. 更新网络状态 UI
            initialAsyncOperations.push(this.refreshNetworkStatusUI());

            // 2. 初始化并建立 WebSocket 连接
            if (typeof ConnectionManager !== 'undefined' && typeof ConnectionManager.initialize === 'function') {
                const cmInitPromise = ConnectionManager.initialize();
                // 确保对连接失败进行捕获，避免阻塞 Promise.all
                if (cmInitPromise && typeof cmInitPromise.catch === 'function') {
                    initialAsyncOperations.push(cmInitPromise.catch(wsError => {
                        Utils.log(`AppInitializer: WebSocket 初始化/连接失败: ${wsError.message || wsError}`, Utils.logLevels.ERROR);
                    }));
                }
            } else {
                Utils.log('AppInitializer: ConnectionManager 未定义或其 initialize 方法未定义，无法初始化 WebSocket 连接。', Utils.logLevels.ERROR);
            }

            // 等待所有并行的初始异步任务完成
            await Promise.all(initialAsyncOperations);

            // --- 初始化流程第 6 阶段：执行依赖于前序步骤的后续异步操作 ---
            // AI 健康检查在网络连接尝试后执行
            try {
                const isAiHealthy = await AiApiHandler.checkAiServiceHealth();
                UserManager.updateAiServiceStatus(isAiHealthy);
            } catch (e) {
                Utils.log("初始化期间 AI 健康检查出错: " + e.message, Utils.logLevels.ERROR);
                UserManager.updateAiServiceStatus(false);
            }

            // NOTE: 重构(阶段3) - 不再直接调用 render...List 方法
            // 派发 APP_INITIALIZED 动作，由 Store 计算初始状态并触发相关组件（如侧边栏）的首次渲染
            Store.dispatch('APP_INITIALIZED');

            Utils.log('应用已初始化 (所有主要异步任务已启动或完成)', Utils.logLevels.INFO);

        } catch (error) {
            Utils.log(`应用初始化失败: ${error.stack || error}`, Utils.logLevels.ERROR);
            NotificationUIManager.showNotification('应用初始化失败，部分功能可能无法使用。', 'error');
            // TODO: 此处可以实现更完善的回退机制，例如仅启用基础功能
        }
    },

    /**
     * 初始化全局图片错误处理器。
     * 当 <img> 标签加载资源失败时，此处理器会介入，根据图片的类型提供优雅的降级方案。
     * @function initializeGlobalImageErrorHandler
     */
    initializeGlobalImageErrorHandler: function() {
        document.addEventListener('error', function(event) {
            const imgElement = event.target;
            // 确保目标是图片元素
            if (imgElement && imgElement.tagName === 'IMG') {
                // 1. 防止重复处理（某些情况下 error 事件可能多次触发）
                if (imgElement.classList.contains('image-load-error-processed')) return;
                imgElement.classList.add('image-load-error-processed');
                Utils.log(`图片加载失败: ${imgElement.src}。正在尝试使用备用方案。`, Utils.logLevels.WARN);

                // 2. 如果是头像图片，显示备用文本
                if (imgElement.classList.contains('avatar-image')) {
                    const fallbackText = imgElement.dataset.fallbackText || imgElement.alt || '?';
                    const avatarContainer = imgElement.parentElement;
                    if (avatarContainer && (
                        avatarContainer.classList.contains('chat-list-avatar') ||
                        avatarContainer.classList.contains('chat-avatar-main') ||
                        avatarContainer.classList.contains('details-avatar') ||
                        avatarContainer.classList.contains('video-call-avatar')
                    )) {
                        // 清空容器并填充备用文本
                        avatarContainer.innerHTML = '';
                        avatarContainer.textContent = fallbackText;
                        avatarContainer.classList.add('avatar-fallback-active');
                    } else {
                        imgElement.style.display = 'none'; // 隐藏损坏的图片
                    }
                }
                // 3. 如果是文件预览图片，显示占位符
                else if (imgElement.classList.contains('file-preview-img')) {
                    const placeholder = document.createElement('div');
                    placeholder.className = 'image-message-fallback';
                    placeholder.textContent = '[图片无法显示]';
                    // 替换损坏的图片元素
                    if (imgElement.parentElement) {
                        try { imgElement.parentElement.replaceChild(placeholder, imgElement); }
                        catch (e) { imgElement.style.display = 'none'; } // 替换失败则隐藏
                    }
                    else { imgElement.style.display = 'none'; }
                }
                // 4. 对于其他类型的图片，仅添加一个错误标识类，由 CSS 处理
                else {
                    imgElement.classList.add('image-load-error');
                }
            }
        }, true); // 使用捕获阶段以尽早处理
        Utils.log("全局图片错误处理器已初始化。", Utils.logLevels.INFO);
    },

    /**
     * 异步刷新网络状态的 UI 显示。
     * @function refreshNetworkStatusUI
     * @returns {Promise<void>}
     */
    refreshNetworkStatusUI: async function() {
        try {
            // 获取 WebRTC 网络类型和 WebSocket 连接状态
            const networkType = await Utils.checkNetworkType();
            const wsStatus = (typeof ConnectionManager !== 'undefined') ? ConnectionManager.isWebSocketConnected : false;
            // 更新设置界面的网络信息
            if (typeof SettingsUIManager !== 'undefined' && SettingsUIManager.updateNetworkInfoDisplay) {
                SettingsUIManager.updateNetworkInfoDisplay(networkType, wsStatus);
            }
        } catch (error) {
            Utils.log(`refreshNetworkStatusUI 出错: ${error.message || error}`, Utils.logLevels.ERROR);
            // 即使出错，也尝试使用备用状态更新 UI
            if (typeof SettingsUIManager !== 'undefined' && SettingsUIManager.updateNetworkInfoDisplay) {
                const wsStatusFallback = (typeof ConnectionManager !== 'undefined') ? ConnectionManager.isWebSocketConnected : false;
                SettingsUIManager.updateNetworkInfoDisplay({ error: "WebRTC 检查失败" }, wsStatusFallback);
            }
        }
    },

    /**
     * 启动网络状态监控，监听 'online' 和 'offline' 事件。
     * @function startNetworkMonitoring
     */
    startNetworkMonitoring: function () {
        window.addEventListener('online', this.handleNetworkChange.bind(this));
        window.addEventListener('offline', this.handleNetworkChange.bind(this));
    },

    /**
     * 处理网络状态变化事件。
     * @function handleNetworkChange
     * @returns {Promise<void>}
     */
    handleNetworkChange: async function () {
        // 当网络恢复在线时
        if (navigator.onLine) {
            // 1. 更新 Store 中的连接状态，通知用户正在尝试重连
            Store.dispatch('UPDATE_CONNECTION_STATUS', { isConnected: false, statusText: '网络已重新连接。正在尝试恢复连接...' });

            // 2. 重新初始化 WebSocket 连接
            if (typeof ConnectionManager !== 'undefined' && typeof ConnectionManager.initialize === 'function') {
                const cmInitPromise = ConnectionManager.initialize();
                if (cmInitPromise && typeof cmInitPromise.catch === 'function') {
                    // 捕获错误，防止未处理的 promise rejection
                    cmInitPromise.catch(wsError => {
                        Utils.log(`AppInitializer (handleNetworkChange): WebSocket 连接尝试失败: ${wsError.message || wsError}`, Utils.logLevels.WARN);
                    });
                }
            }
        } else {
            // 当网络断开时，直接更新状态
            Store.dispatch('UPDATE_CONNECTION_STATUS', { isConnected: false, statusText: '网络已断开。' });
        }
        // 刷新 UI 显示
        await this.refreshNetworkStatusUI();
    },

    /**
     * 智能返回聊天列表。
     * 通过操作浏览器历史记录，实现在移动端视图下点击返回按钮优先返回聊天列表，而不是退出页面。
     * @function smartBackToChatList
     */
    smartBackToChatList: function (){
        // 确保应用加载时有一个明确的初始历史记录状态
        if (location.pathname === '/' || location.pathname === '/index.html' || location.pathname === (AppSettings.ui.baseUrl || '/')) {
            history.replaceState(null, null, location.href);
        } else {
            history.pushState(null, null, location.href);
        }

        // 监听 popstate 事件（通常由浏览器后退按钮触发）
        window.addEventListener('popstate', function(event) {
            const btn = document.querySelector('.back-to-list-btn');
            // 如果返回按钮可见（表示当前在聊天界面），则阻止默认的后退行为
            if (btn && window.getComputedStyle(btn).getPropertyValue('display') === "block"){
                history.pushState(null, null, location.href); // 重新推入当前状态，防止后退
                Store.dispatch('SHOW_CHAT_LIST'); // 派发动作以显示聊天列表
            }
        });
    },

    /**
     * 设置应用的核心事件监听器。
     * 将各个模块的事件与 Store 动作或回调函数连接起来，实现模块间的解耦通信。
     * @function setupCoreEventListeners
     */
    setupCoreEventListeners: function () {
        // 监听 WebRTC 连接状态事件，并更新联系人状态
        EventEmitter.on('connectionDisconnected', (peerId) => {
            Store.dispatch('UPDATE_CONTACT_STATUS', { contactId: peerId, status: 'offline' });
        });
        EventEmitter.on('connectionEstablished', (peerId) => {
            Store.dispatch('UPDATE_CONTACT_STATUS', { contactId: peerId, status: 'connected' });
        });
        EventEmitter.on('connectionFailed', (peerId) => {
            Store.dispatch('UPDATE_CONTACT_STATUS', { contactId: peerId, status: 'offline' });
        });
        EventEmitter.on('connectionClosed', (peerId) => {
            Store.dispatch('UPDATE_CONTACT_STATUS', { contactId: peerId, status: 'offline' });
        });

        // 监听 WebSocket 状态更新事件
        EventEmitter.on('websocketStatusUpdate', async () => {
            const isConnected = WebSocketManager.isWebSocketConnected;
            let statusText = isConnected ? '信令服务器已连接。' : '信令服务器已断开。';
            // 特殊情况：如果正在注册用户，显示特定状态文本
            if (document.getElementById('modalUserIdValue')?.textContent === "生成中...") {
                statusText = "正在注册用户...";
            }
            Store.dispatch('UPDATE_CONNECTION_STATUS', { isConnected, statusText });
            // 更新设置界面中的相关 UI
            if (typeof SettingsUIManager !== 'undefined' && SettingsUIManager.updateCheckNetworkButtonState) {
                SettingsUIManager.updateCheckNetworkButtonState();
                await this.refreshNetworkStatusUI();
            }
        });

        // 监听 AI 服务状态更新事件
        EventEmitter.on('aiServiceStatusUpdated', function(isHealthy) {
            UserManager.updateAiServiceStatus(isHealthy);
        });

        // 监听 AI 配置变更事件
        if (typeof AiApiHandler !== 'undefined' && typeof AiApiHandler.handleAiConfigChange === 'function') {
            EventEmitter.on('aiConfigChanged', AiApiHandler.handleAiConfigChange.bind(AiApiHandler));
        }

        // 监听文件输入框的 change 事件
        const fileInput = document.getElementById('fileInput');
        if (fileInput) fileInput.addEventListener('change', MediaManager.handleFileSelect.bind(MediaManager));

        // 设置全局错误处理器
        window.addEventListener('error', (event) => {
            const errorDetails = event.error ? (event.error.stack || event.error.message) : event.message;
            Utils.log(`全局 window 错误: ${errorDetails} 位于 ${event.filename}:${event.lineno}`, Utils.logLevels.ERROR);
            NotificationUIManager.showNotification('应用程序发生错误。请检查控制台以获取详细信息。', 'error');
        });

        // 设置未处理的 Promise rejection 处理器
        window.addEventListener('unhandledrejection', function(event) {
            const reason = event.reason instanceof Error ? (event.reason.stack || event.reason.message) : event.reason;
            Utils.log(`未处理的 Promise rejection: ${reason}`, Utils.logLevels.ERROR);
            NotificationUIManager.showNotification('发生意外错误。请检查控制台。', 'error');
        });

        // 监听页面卸载前事件，用于释放资源
        window.addEventListener('beforeunload', () => {
            MediaManager.releaseAudioResources();
            VideoCallManager.releaseMediaResources();
            // 关闭所有 WebRTC 连接
            if (typeof WebRTCManager !== 'undefined' && WebRTCManager.connections) {
                for (const peerId in WebRTCManager.connections) {
                    if (WebRTCManager.connections.hasOwnProperty(peerId)) {
                        if (typeof ConnectionManager !== 'undefined' && ConnectionManager.close) ConnectionManager.close(peerId, true);
                    }
                }
            }
            // 停止所有定时任务
            if (typeof TimerManager !== 'undefined') {
                TimerManager.stopAllTasks();
            }
        });

        // 监听连接状态文本变化，以自动隐藏加载遮罩
        const connectionStatusTextEl = document.getElementById('connectionStatusText');
        const loadingOverlay = document.getElementById('loadingOverlay');
        if (connectionStatusTextEl && loadingOverlay) {
            const observer = new MutationObserver(() => {
                const statusText = connectionStatusTextEl.textContent.toLowerCase();
                // 当状态文本表明初始化关键步骤完成时
                if (statusText.includes('用户注册成功') ||
                    statusText.includes('信令服务器已连接') ||
                    statusText.includes('已从本地加载') ||
                    statusText.includes('使用现有id') ||
                    statusText.includes('初始化完成，准备连接')
                ) {
                    // 延迟隐藏，给用户一个缓冲时间
                    setTimeout(() => {
                        if (loadingOverlay.style.display !== 'none') {
                            loadingOverlay.style.display = 'none';
                            // 首次启动时显示开源信息弹窗
                            ModalUIManager.showOpenSourceInfoModal();
                        }
                    }, 500);
                }
            });
            observer.observe(connectionStatusTextEl, { childList: true, characterData: true, subtree: true });
        }
    }
};

// DOM 内容加载完毕后，开始执行应用初始化
window.addEventListener('DOMContentLoaded', () => {
    AppInitializer.init();
});