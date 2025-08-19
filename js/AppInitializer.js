/**
 * @file AppInitializer.js
 * @description 应用的入口点和初始化器。负责按正确顺序加载和初始化所有管理器和 UI 组件，并设置核心事件监听器。
 *              【核心修复】`init` 方法现在使用 `try...finally` 结构，确保无论初始化成功与否，加载覆盖层最终都会被移除，解决了页面卡在加载中的问题。
 *              【核心修复】新增了中心化的用户注册逻辑，在网络和本地数据都就绪后执行，解决了竞争条件问题。
 * @module AppInitializer
 * @exports {object} AppInitializer - 包含 init 方法，由 DOMContentLoaded 事件触发。
 * @dependencies DBManager, UserManager, ChatManager, GroupManager, ConnectionManager, MediaManager, VideoCallManager,
 *               LayoutUIManager, ModalUIManager, SettingsUIManager, ChatAreaUIManager, SidebarUIManager,
 *               DetailsPanelUIManager, VideoCallUIManager, MediaUIManager, NotificationUIManager, Utils, EventEmitter,
 *               PeopleLobbyManager, AiApiHandler, ThemeLoader, ScreenshotEditorUIManager, ResourcePreviewUIManager, WebSocketManager, TimerManager, CharacterCardManager, MemoryBookManager
 */
const AppInitializer = {

    /**
     * 【重构与修复】应用程序的主初始化函数。
     * 使用 `try...finally` 确保加载覆盖层总能被移除，防止卡死。
     * 解决了 WebSocket 注册时 userId 不可用的竞争条件问题。
     */
    init: async function () {
        const loadingTextEl = document.querySelector('.loading-text');
        const loadingOverlay = document.getElementById('loadingOverlay');

        try {
            // --- 阶段 1: 关键的同步设置 ---
            if(loadingTextEl) loadingTextEl.textContent = '正在配置核心服务...';
            Utils.setLogLevelFromConfig();
            this.initializeGlobalImageErrorHandler();
            if (!Utils.checkWebRTCSupport()) return;
            TimerManager.init();

            // --- 阶段 2: 关键异步任务并行启动 ---
            // 任务1: 网络连接
            if(loadingTextEl) loadingTextEl.textContent = '正在连接信令服务器...';
            const networkPromise = ConnectionManager.initialize().catch(wsError => {
                Utils.log(`AppInitializer: WebSocket 初始化/连接失败: ${wsError.message || wsError}`, Utils.logLevels.ERROR);
                // 即使失败，也 resolve 以免阻塞 Promise.all
                return Promise.resolve();
            });

            // 任务2: 本地数据和UI初始化
            const localSetupPromise = (async () => {
                if(loadingTextEl) loadingTextEl.textContent = '正在加载本地数据...';
                await DBManager.init();
                Utils.log('数据库初始化成功', Utils.logLevels.INFO);

                // 核心数据加载
                await MemoryBookManager.init();
                await ThemeLoader.init();
                await UserManager.init();
                await GroupManager.init();
                await ChatManager.init();
                Utils.log('核心数据模型已加载。', Utils.logLevels.INFO);

                // UI 管理器初始化 (同步)
                if(loadingTextEl) loadingTextEl.textContent = '正在构建用户界面...';
                ModalUIManager.init();
                SettingsUIManager.init();
                LayoutUIManager.init();
                ChatAreaUIManager.init();
                SidebarUIManager.init();
                DetailsPanelUIManager.init();
                ResourcePreviewUIManager.init();
                VideoCallUIManager.init();
                MediaUIManager.init();
                PeopleLobbyManager.init();
                EmojiStickerUIManager.init();
                ScreenshotEditorUIManager.init();
                CharacterCardManager.init();
                Utils.log('UI 管理器已初始化。', Utils.logLevels.INFO);
            })();

            // --- 阶段 3: 等待并行任务完成 ---
            if(loadingTextEl) loadingTextEl.textContent = '正在等待所有模块就绪...';
            await Promise.all([networkPromise, localSetupPromise]);
            Utils.log('网络连接和本地数据加载均已完成。', Utils.logLevels.INFO);


            // --- 新增阶段 3.5: 核心修复 - 确保在所有前置任务完成后进行用户注册 ---
            if (loadingTextEl) loadingTextEl.textContent = '正在注册用户身份...';
            if (WebSocketManager.isWebSocketConnected && UserManager.userId) {
                Utils.log(`AppInitializer: 安全检查通过。确保用户 ${UserManager.userId} 已注册到信令服务器。`, Utils.logLevels.INFO);
                WebSocketManager.sendRawMessage({
                    type: 'REGISTER',
                    userId: UserManager.userId
                });
            } else {
                let reason = [];
                if (!WebSocketManager.isWebSocketConnected) reason.push("WebSocket 未连接");
                if (!UserManager.userId) reason.push("用户 ID 尚未加载");
                Utils.log(`AppInitializer: 初始注册被跳过。原因: ${reason.join('; ')}`, Utils.logLevels.WARN);
            }

            // --- 阶段 4: 依赖于阶段3的后续设置 ---
            if(loadingTextEl) loadingTextEl.textContent = '正在进行最终检查...';
            this.startNetworkMonitoring();
            MediaManager.initVoiceRecording();
            VideoCallManager.init();
            this.setupCoreEventListeners();
            this.smartBackToChatList();

            // 初始网络状态UI刷新
            await this.refreshNetworkStatusUI();

            // AI健康检查
            try {
                const isAiHealthy = await AiApiHandler.checkAiServiceHealth();
                UserManager.updateAiServiceStatus(isAiHealthy);
            } catch (e) {
                Utils.log("初始化期间 AI 健康检查出错: " + e.message, Utils.logLevels.ERROR);
                UserManager.updateAiServiceStatus(false);
            }

            Utils.log('应用已完全初始化。', Utils.logLevels.INFO);

        } catch (error) {
            Utils.log(`应用初始化失败: ${error.stack || error}`, Utils.logLevels.ERROR);
            if(loadingTextEl) loadingTextEl.textContent = '初始化失败！';
            NotificationUIManager.showNotification('应用初始化失败，部分功能可能无法使用。', 'error');
        } finally {
            // [核心修复] 无论成功或失败，都在此隐藏加载界面。
            // 这确保了即使用户网络不佳，也能进入应用主界面（尽管某些功能可能不可用）。
            if (loadingOverlay) {
                setTimeout(() => {
                    loadingOverlay.style.opacity = '0';
                    loadingOverlay.addEventListener('transitionend', () => {
                        loadingOverlay.style.display = 'none';
                    }, { once: true });
                    ModalUIManager.showOpenSourceInfoModal();
                }, 500); // 延迟一小段时间，让用户看到最终状态
            }
        }
    },

    initializeGlobalImageErrorHandler: function() {
        // ... (此方法代码不变)
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

    refreshNetworkStatusUI: async function() {
        // ... (此方法代码不变)
        try {
            const networkType = await Utils.checkNetworkType();
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

    startNetworkMonitoring: function () {
        // ... (此方法代码不变)
        window.addEventListener('online', this.handleNetworkChange.bind(this));
        window.addEventListener('offline', this.handleNetworkChange.bind(this));
    },

    handleNetworkChange: async function () {
        // ... (此方法代码不变)
        if (navigator.onLine) {
            LayoutUIManager.updateConnectionStatusIndicator('网络已重新连接。正在尝试恢复连接...');
            if (typeof ConnectionManager !== 'undefined' && typeof ConnectionManager.initialize === 'function') {
                const cmInitPromise = ConnectionManager.initialize();
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

    smartBackToChatList: function (){
        // ... (此方法代码不变)
        if (location.pathname === '/' || location.pathname === '/index.html' || location.pathname === (AppSettings.ui.baseUrl || '/')) {
            history.replaceState(null, null, location.href);
        } else {
            history.pushState(null, null, location.href);
        }

        window.addEventListener('popstate', function(event) {
            const btn = document.querySelector('.back-to-list-btn');
            if (btn && window.getComputedStyle(btn).getPropertyValue('display') === "block"){
                history.pushState(null, null, location.href);
                if (typeof LayoutUIManager !== 'undefined') LayoutUIManager.showChatListArea();
            }
        });
    },

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
        EventEmitter.on('fileDataReady', ({ fileHash, fileType, fileName }) => {
            if (!fileHash) return;
            const placeholders = document.querySelectorAll(`.thumbnail-placeholder[data-awaiting-hash="${fileHash}"]`);
            if (placeholders.length > 0) {
                Utils.log(`fileDataReady: 找到 ${placeholders.length} 个占位符 for hash ${fileHash}. 正在渲染缩略图。`);
                placeholders.forEach(placeholder => {
                    const isResourceGrid = placeholder.classList.contains('thumbnail-placeholder-resource');
                    if (typeof MediaUIManager !== 'undefined' && MediaUIManager.renderMediaThumbnail) {
                        MediaUIManager.renderMediaThumbnail(placeholder, fileHash, fileType, fileName, isResourceGrid);
                    }
                    placeholder.removeAttribute('data-awaiting-hash');
                });
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
            if (typeof WebRTCManager !== 'undefined' && WebRTCManager.connections) {
                for (const peerId in WebRTCManager.connections) {
                    if (WebRTCManager.connections.hasOwnProperty(peerId)) {
                        if (typeof ConnectionManager !== 'undefined' && ConnectionManager.close) ConnectionManager.close(peerId, true);
                    }
                }
            }
            if (typeof TimerManager !== 'undefined') {
                TimerManager.stopAllTasks();
            }
        });
    }
};

window.addEventListener('DOMContentLoaded', () => {
    AppInitializer.init();
});

/**
 * @function handleNativeScreenshot
 * @description 全局函数，由 Android 原生代码在截图完成后调用。
 * @param {string} base64DataUrl - 从原生代码传递过来的截图的 Base64 Data URL。
 */
window.handleNativeScreenshot = function(base64DataUrl) {
    // ... (此函数代码不变)
    Utils.log('Received screenshot from native Android.', Utils.logLevels.INFO);
    if (!base64DataUrl || !base64DataUrl.startsWith('data:image/')) {
        Utils.log('Invalid base64 data received from native.', Utils.logLevels.ERROR);
        NotificationUIManager.showNotification('从原生应用接收截图失败。', 'error');
        return;
    }

    fetch(base64DataUrl)
        .then(res => res.blob())
        .then(blob => {
            if (!blob) {
                NotificationUIManager.showNotification('截图失败：无法生成图片 Blob。', 'error');
                return;
            }
            if (typeof EventEmitter !== 'undefined') {
                EventEmitter.emit('rawScreenshotCaptured', {
                    dataUrl: base64DataUrl,
                    blob: blob,
                    originalStream: null
                });
                Utils.log("Raw screenshot from native processed, event emitted.", Utils.logLevels.INFO);
            }
        })
        .catch(error => {
            Utils.log(`Error converting native screenshot Data URL to Blob: ${error}`, Utils.logLevels.ERROR);
            NotificationUIManager.showNotification('处理原生截图时出错。', 'error');
        });
};