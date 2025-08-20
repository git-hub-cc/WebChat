/**
 * @file AppInitializer.js
 * @description 应用的入口点和初始化器。负责按正确顺序加载和初始化所有管理器和 UI 组件，并设置核心事件监听器。
 *              MODIFIED: 在初始化早期，会异步加载 ui_templates.html 文件并将其内容注入到 DOM 中，以供其他模块使用。
 *              优化了部分异步任务的并行执行。
 *              当AI服务状态更新时，现在会正确调用 `ChatAreaUIManager.updateChatHeader` 来更新聊天头部的状态指示器。
 *              新增 ResourcePreviewUIManager 初始化。
 *              修复：WebSocket 连接检查逻辑，以适应 ConnectionManager 的拆分。
 *                    ConnectionManager.initialize()现在会正确启动并管理WebSocket连接。
 *              定时器逻辑已移至 TimerManager。
 *              修改：AI 服务健康检查现在会在其他关键异步任务（如WebSocket初始化）之后执行。
 *              FIXED: Added MemoryBookManager.init() call to ensure memory book data is loaded on startup.
 *              FIXED: 新增 fileDataReady 事件监听器，以在文件数据接收完毕后异步更新UI预览。
 *              MODIFIED: 移除了全局的右键菜单禁用，将其移至 LayoutUIManager 中更精确地控制。
 * @module AppInitializer
 * @exports {object} AppInitializer - 包含 init 方法，现在应由 DOMContentLoaded 事件触发。
 * @dependencies DBManager, UserManager, ChatManager, GroupManager, ConnectionManager, MediaManager, VideoCallManager,
 *               LayoutUIManager, ModalUIManager, SettingsUIManager, ChatAreaUIManager, SidebarUIManager,
 *               DetailsPanelUIManager, VideoCallUIManager, MediaUIManager, NotificationUIManager, Utils, EventEmitter,
 *               PeopleLobbyManager, AiApiHandler, ThemeLoader, ScreenshotEditorUIManager, ResourcePreviewUIManager, WebSocketManager, TimerManager, CharacterCardManager, MemoryBookManager
 * @dependents DOMContentLoaded (在 index.html 中通过新的方式调用)
 */
const AppInitializer = {

    /**
     * 应用程序的主初始化函数。
     */
    init: async function () {
        // --- 阶段 1: 关键的同步设置 ---
        Utils.setLogLevelFromConfig();
        this.initializeGlobalImageErrorHandler();
        if (!Utils.checkWebRTCSupport()) return;
        TimerManager.init();

        try {
            // --- 新增阶段: 加载 UI 模板 ---
            await this.loadUiTemplates();
            Utils.log('UI 模板加载成功', Utils.logLevels.INFO);

            // --- 阶段 2: 核心数据加载 (主要是顺序异步) ---
            await DBManager.init();
            Utils.log('数据库初始化成功', Utils.logLevels.INFO);

            // ADDED: Initialize MemoryBookManager right after DBManager
            if (typeof MemoryBookManager !== 'undefined' && typeof MemoryBookManager.init === 'function') {
                await MemoryBookManager.init();
            } else {
                Utils.log('MemoryBookManager 或其 init 方法未定义。记忆书功能可能无法使用。', Utils.logLevels.WARN);
            }

            if (typeof ThemeLoader !== 'undefined' && typeof ThemeLoader.init === 'function') {
                await ThemeLoader.init();
                Utils.log('ThemeLoader 初始化完成。', Utils.logLevels.INFO);
            } else {
                Utils.log('ThemeLoader 或其 init 方法未定义。主题系统可能无法正常工作。', Utils.logLevels.ERROR);
            }

            await UserManager.init();
            await GroupManager.init();
            await ChatManager.init();

            // --- 阶段 3: UI 管理器初始化 (同步, 在核心数据加载后) ---
            ModalUIManager.init();
            SettingsUIManager.init();
            LayoutUIManager.init();
            ChatAreaUIManager.init();
            SidebarUIManager.init();
            DetailsPanelUIManager.init();
            if (typeof ResourcePreviewUIManager !== 'undefined' && ResourcePreviewUIManager.init) {
                ResourcePreviewUIManager.init();
                Utils.log('ResourcePreviewUIManager 初始化完成。', Utils.logLevels.INFO);
            } else {
                Utils.log('ResourcePreviewUIManager 或其 init 方法未定义。资源预览功能可能无法使用。', Utils.logLevels.WARN);
            }
            VideoCallUIManager.init();
            MediaUIManager.init();
            PeopleLobbyManager.init();
            EmojiStickerUIManager.init();
            if (typeof ScreenshotEditorUIManager !== 'undefined' && typeof ScreenshotEditorUIManager.init === 'function') {
                ScreenshotEditorUIManager.init();
                Utils.log('ScreenshotEditorUIManager 初始化完成。', Utils.logLevels.INFO);
            } else {
                Utils.log('ScreenshotEditorUIManager 或其 init 方法未定义。截图编辑功能可能无法使用。', Utils.logLevels.WARN);
            }
            if (typeof CharacterCardManager !== 'undefined' && CharacterCardManager.init) {
                CharacterCardManager.init();
                Utils.log('CharacterCardManager 初始化完成。', Utils.logLevels.INFO);
            }

            // --- 阶段 4: 其他同步设置 ---
            this.startNetworkMonitoring();
            MediaManager.initVoiceRecording();
            VideoCallManager.init();
            this.setupCoreEventListeners();
            this.smartBackToChatList();

            // --- 阶段 5: 并行执行的初始异步操作 ---
            const initialAsyncOperations = [];
            initialAsyncOperations.push(this.refreshNetworkStatusUI());

            if (typeof ConnectionManager !== 'undefined' && typeof ConnectionManager.initialize === 'function') {
                const cmInitPromise = ConnectionManager.initialize();
                if (cmInitPromise && typeof cmInitPromise.catch === 'function') {
                    initialAsyncOperations.push(cmInitPromise.catch(wsError => {
                        Utils.log(`AppInitializer: WebSocket 初始化/连接失败: ${wsError.message || wsError}`, Utils.logLevels.ERROR);
                    }));
                } else {
                    Utils.log('AppInitializer: ConnectionManager.initialize() did not return a valid Promise. WebSocket initialization might be incomplete.', Utils.logLevels.ERROR);
                    initialAsyncOperations.push(Promise.resolve());
                }
            } else {
                Utils.log('AppInitializer: ConnectionManager 未定义或其 initialize 方法未定义，无法初始化 WebSocket 连接。', Utils.logLevels.ERROR);
                initialAsyncOperations.push(Promise.resolve());
            }

            await Promise.all(initialAsyncOperations);

            // --- 阶段 6: 后续异步操作 (如 AI 健康检查) ---
            try {
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
        }
    },

    /**
     * @private
     * @description 从 ui_templates.html 文件加载 UI 模板并注入到 DOM 中。
     *              这是初始化的关键早期步骤，必须在任何 UI 管理器初始化之前完成。
     * @returns {Promise<void>}
     */
    loadUiTemplates: async function() {
        try {
            const response = await fetch('templates.html');
            if (!response.ok) {
                throw new Error(`无法获取 UI 模板文件: ${response.statusText}`);
            }
            const templatesHtml = await response.text();
            document.body.insertAdjacentHTML('beforeend', templatesHtml);
        } catch (error) {
            console.error('加载 UI 模板失败:', error);
            // 显示一个致命错误，因为没有模板，应用无法运行
            document.body.innerHTML = '<div style="color: red; padding: 20px; font-family: sans-serif;">关键UI组件加载失败，应用无法启动。请检查网络连接并刷新页面或联系管理员。</div>';
            throw error; // 阻止后续的初始化
        }
    },

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
    refreshNetworkStatusUI: async function() {
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
        window.addEventListener('online', this.handleNetworkChange.bind(this));
        window.addEventListener('offline', this.handleNetworkChange.bind(this));
    },
    handleNetworkChange: async function () {
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

        // --- MODIFICATION START: Add listener for file data ready ---
        EventEmitter.on('fileDataReady', ({ fileHash, fileType, fileName }) => {
            if (!fileHash) return;
            // Find all placeholders waiting for this specific file hash
            const placeholders = document.querySelectorAll(`.thumbnail-placeholder[data-awaiting-hash="${fileHash}"]`);
            if (placeholders.length > 0) {
                Utils.log(`fileDataReady: 找到 ${placeholders.length} 个占位符 for hash ${fileHash}. 正在渲染缩略图。`);
                placeholders.forEach(placeholder => {
                    const isResourceGrid = placeholder.classList.contains('thumbnail-placeholder-resource');
                    if (typeof MediaUIManager !== 'undefined' && MediaUIManager.renderMediaThumbnail) {
                        // Re-call renderMediaThumbnail on the now-ready placeholder
                        MediaUIManager.renderMediaThumbnail(placeholder, fileHash, fileType, fileName, isResourceGrid);
                    }
                    placeholder.removeAttribute('data-awaiting-hash'); // Clean up the marker attribute
                });
            }
        });
        // --- MODIFICATION END ---

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

/**
 * @function handleNativeScreenshot
 * @description 全局函数，由 Android 原生代码在截图完成后调用。
 * @param {string} base64DataUrl - 从原生代码传递过来的截图的 Base64 Data URL 。
 */
window.handleNativeScreenshot = function(base64DataUrl) {
    Utils.log('Received screenshot from native Android.', Utils.logLevels.INFO);
    if (!base64DataUrl || !base64DataUrl.startsWith('data:image/')) {
        Utils.log('Invalid base64 data received from native.', Utils.logLevels.ERROR);
        NotificationUIManager.showNotification('从原生应用接收截图失败。', 'error');
        return;
    }

    // 将 Base64 Data URL 转换为 Blob
    fetch(base64DataUrl)
        .then(res => res.blob())
        .then(blob => {
            if (!blob) {
                NotificationUIManager.showNotification('截图失败：无法生成图片 Blob。', 'error');
                return;
            }
            // 触发事件，将截图发送到编辑器
            if (typeof EventEmitter !== 'undefined') {
                EventEmitter.emit('rawScreenshotCaptured', {
                    dataUrl: base64DataUrl,
                    blob: blob,
                    originalStream: null // 原生截图没有流
                });
                Utils.log("Raw screenshot from native processed, event emitted.", Utils.logLevels.INFO);
            }
        })
        .catch(error => {
            Utils.log(`Error converting native screenshot Data URL to Blob: ${error}`, Utils.logLevels.ERROR);
            NotificationUIManager.showNotification('处理原生截图时出错。', 'error');
        });
};