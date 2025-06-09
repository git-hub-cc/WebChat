// MODIFIED: AppInitializer.js (已翻译为中文)
// - 从 setupCoreEventListeners 中移除了 voiceButtonMain 事件监听器。
const AppInitializer = {

    init: async function () {
        Utils.setLogLevelFromConfig();
        this.initializeGlobalImageErrorHandler();
        if (!UIManager.checkWebRTCSupport()) return;

        try {
            await DBManager.init();
            Utils.log('数据库初始化成功', Utils.logLevels.INFO);

            await UserManager.init();
            await ChatManager.init();
            await GroupManager.init();

            // 初始化 UI 管理器
            ModalManager.init();
            SettingsUIManager.init();
            LayoutManager.init();
            ChatAreaUIManager.init(); // 它将绑定自己的语音按钮监听器
            SidebarUIManager.init();
            DetailsPanelUIManager.init();
            VideoCallUIManager.init();
            MediaUIManager.init();

            await this.refreshNetworkStatusUI();
            this.startNetworkMonitoring();

            MediaManager.initVoiceRecording(); // 核心逻辑初始化 (权限检查等)
            VideoCallManager.init();         // 核心逻辑初始化

            this.setupCoreEventListeners(); // 现在更精简了
            this.smartBackToChatList();
            ConnectionManager.initialize();
            Utils.log('应用已初始化', Utils.logLevels.INFO);
        } catch (error) {
            Utils.log(`应用初始化失败: ${error.stack || error}`, Utils.logLevels.ERROR);
            NotificationManager.showNotification('应用初始化失败，部分功能可能无法使用。', 'error');

            if (!UserManager.userId) {
                UserManager.userId = Utils.generateId(8);
                UserManager.userSettings.autoConnectEnabled = false;
                const userIdEl = document.getElementById('modalUserIdValue');
                if(userIdEl) userIdEl.textContent = UserManager.userId;
            }
            // 在回退模式下也尝试初始化 UI 管理器
            ModalManager.init(); SettingsUIManager.init(); LayoutManager.init();
            ChatAreaUIManager.init(); SidebarUIManager.init(); DetailsPanelUIManager.init();
            VideoCallUIManager.init(); MediaUIManager.init();

            await this.refreshNetworkStatusUI(); this.startNetworkMonitoring();
            MediaManager.initVoiceRecording(); VideoCallManager.init();
            this.setupCoreEventListeners(); this.smartBackToChatList();
            // 此功能现已移至 SettingsUIManager.initThemeSelectors

            const loadingOverlay = document.getElementById('loadingOverlay');
            if (loadingOverlay && loadingOverlay.style.display !== 'none') {
                loadingOverlay.style.display = 'none';
                ModalManager.showOpenSourceInfoModal();
            }
        }
    },

    initializeGlobalImageErrorHandler: function() {
        document.addEventListener('error', function(event) {
            const imgElement = event.target;
            if (imgElement && imgElement.tagName === 'IMG') {
                if (imgElement.classList.contains('image-load-error-processed')) return;
                imgElement.classList.add('image-load-error-processed');
                // 注意：这里的原文是印尼语，已按要求翻译成中文
                Utils.log(`图片加载失败: ${imgElement.src}。正在尝试使用备用方案。`, Utils.logLevels.WARN);
                if (imgElement.classList.contains('avatar-image')) {
                    const fallbackText = imgElement.dataset.fallbackText || imgElement.alt || '?';
                    const entityId = imgElement.dataset.entityId;
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
                    } else { imgElement.style.display = 'none'; }
                } else if (imgElement.classList.contains('file-preview-img')) {
                    const placeholder = document.createElement('div');
                    placeholder.className = 'image-message-fallback';
                    placeholder.textContent = '[图片无法显示]';
                    if (imgElement.parentElement) { try { imgElement.parentElement.replaceChild(placeholder, imgElement); } catch (e) { imgElement.style.display = 'none'; }}
                    else { imgElement.style.display = 'none'; }
                } else { imgElement.classList.add('image-load-error'); }
            }
        }, true);
        Utils.log("全局图片错误处理器已初始化。", Utils.logLevels.INFO);
    },

    refreshNetworkStatusUI: async function() {
        try {
            const networkType = await Utils.checkNetworkType();
            const wsStatus = ConnectionManager.isWebSocketConnected;
            if (typeof SettingsUIManager !== 'undefined' && SettingsUIManager.updateNetworkInfoDisplay) {
                SettingsUIManager.updateNetworkInfoDisplay(networkType, wsStatus);
            }
        } catch (error) {
            Utils.log(`refreshNetworkStatusUI 出错: ${error.message || error}`, Utils.logLevels.ERROR);
            if (typeof SettingsUIManager !== 'undefined' && SettingsUIManager.updateNetworkInfoDisplay) {
                SettingsUIManager.updateNetworkInfoDisplay({ error: "WebRTC 检查失败" }, ConnectionManager.isWebSocketConnected);
            }
        }
    },

    startNetworkMonitoring: function () {
        window.addEventListener('online', this.handleNetworkChange.bind(this));
        window.addEventListener('offline', this.handleNetworkChange.bind(this));
    },

    handleNetworkChange: async function () {
        if (navigator.onLine) {
            LayoutManager.updateConnectionStatusIndicator('网络已重新连接。正在尝试恢复连接...');
            ConnectionManager.initialize();
        } else {
            LayoutManager.updateConnectionStatusIndicator('网络已断开。');
        }
        await this.refreshNetworkStatusUI();
    },

    smartBackToChatList: function (){
        history.pushState(null, null, location.href);
        window.addEventListener('popstate', function(event) {
            const btn = document.querySelector('.back-to-list-btn');
            if (btn && window.getComputedStyle(btn).getPropertyValue('display') === "block"){
                history.pushState(null, null, location.href);
                if (typeof LayoutManager !== 'undefined') LayoutManager.showChatListArea();
            }
        });
    },

    setupCoreEventListeners: function () {
        // ConnectionManager 相关事件
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

        // WebSocket 状态更新
        EventEmitter.on('websocketStatusUpdate', async () => {
            Utils.log('收到 WebSocket 状态更新事件，正在刷新网络 UI。', Utils.logLevels.DEBUG);
            await this.refreshNetworkStatusUI();
            if (typeof SettingsUIManager !== 'undefined' && SettingsUIManager.updateCheckNetworkButtonState) {
                SettingsUIManager.updateCheckNetworkButtonState();
            }
        });

        // 文件输入 (放在这里仍然合理，因为它是一种通用的输入机制)
        const fileInput = document.getElementById('fileInput');
        if (fileInput) fileInput.addEventListener('change', MediaManager.handleFileSelect.bind(MediaManager));

        // 全局 window 错误处理器
        window.addEventListener('error', (event) => {
            const errorDetails = event.error ? (event.error.stack || event.error.message) : event.message;
            Utils.log(`全局 window 错误: ${errorDetails} 位于 ${event.filename}:${event.lineno}`, Utils.logLevels.ERROR);
            NotificationManager.showNotification('应用程序发生错误。请检查控制台以获取详细信息。', 'error');
        });
        window.addEventListener('unhandledrejection', function(event) {
            const reason = event.reason instanceof Error ? (event.reason.stack || event.reason.message) : event.reason;
            Utils.log(`未处理的 Promise rejection: ${reason}`, Utils.logLevels.ERROR);
            NotificationManager.showNotification('发生意外错误。请检查控制台。', 'error');
        });
        window.addEventListener('beforeunload', () => {
            MediaManager.releaseAudioResources();
            VideoCallManager.releaseMediaResources();
            for (const peerId in ConnectionManager.connections) {
                if (ConnectionManager.connections.hasOwnProperty(peerId)) {
                    ConnectionManager.close(peerId, true);
                }
            }
        });

        // 加载覆盖层观察器
        const connectionStatusTextEl = document.getElementById('connectionStatusText');
        const loadingOverlay = document.getElementById('loadingOverlay');
        if (connectionStatusTextEl && loadingOverlay) {
            const observer = new MutationObserver(() => {
                const statusText = connectionStatusTextEl.textContent.toLowerCase();
                // **重要**: 以下字符串必须与设置 `connectionStatusTextEl` 内容的地方完全匹配！
                if (statusText.includes('用户注册成功') ||
                    statusText.includes('信令服务器已连接') ||
                    statusText.includes('已从本地加载') ||
                    statusText.includes('使用现有id') || // 'id' 保持小写以匹配 toLowerCase()
                    statusText.includes('初始化完成，准备连接')
                ) {
                    setTimeout(() => {
                        if (loadingOverlay.style.display !== 'none') {
                            loadingOverlay.style.display = 'none';
                            ModalManager.showOpenSourceInfoModal();
                        }
                    }, 500);
                }
            });
            observer.observe(connectionStatusTextEl, { childList: true, characterData: true, subtree: true });
        }
    }
};

window.addEventListener('load', AppInitializer.init.bind(AppInitializer));