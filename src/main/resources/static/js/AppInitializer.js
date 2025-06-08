// MODIFIED: AppInitializer.js
// - Removed voiceButtonMain event listeners from setupCoreEventListeners.
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

            // Initialize UI Managers
            ModalManager.init();
            SettingsUIManager.init();
            LayoutManager.init();
            ChatAreaUIManager.init(); // Will bind its own voice button listeners
            SidebarUIManager.init();
            DetailsPanelUIManager.init();
            VideoCallUIManager.init();
            MediaUIManager.init();

            await this.refreshNetworkStatusUI();
            this.startNetworkMonitoring();

            MediaManager.initVoiceRecording(); // Core logic init (permission checks, etc.)
            VideoCallManager.init();         // Core logic init

            this.setupCoreEventListeners(); // Now smaller
            this.smartBackToChatList();
            ConnectionManager.initialize();
            Utils.log('应用已初始化', Utils.logLevels.INFO);
        } catch (error) {
            Utils.log(`应用初始化失败: ${error.stack || error}`, Utils.logLevels.ERROR);
            NotificationManager.showNotification('应用初始化失败，部分功能可能无法使用.', 'error');

            if (!UserManager.userId) {
                UserManager.userId = Utils.generateId(8);
                UserManager.userSettings.autoConnectEnabled = false;
                const userIdEl = document.getElementById('modalUserIdValue');
                if(userIdEl) userIdEl.textContent = UserManager.userId;
            }
            // Attempt to init UI managers even in fallback
            ModalManager.init(); SettingsUIManager.init(); LayoutManager.init();
            ChatAreaUIManager.init(); SidebarUIManager.init(); DetailsPanelUIManager.init();
            VideoCallUIManager.init(); MediaUIManager.init();

            await this.refreshNetworkStatusUI(); this.startNetworkMonitoring();
            MediaManager.initVoiceRecording(); VideoCallManager.init();
            this.setupCoreEventListeners(); this.smartBackToChatList();
            // ThemeLoader.populateSelector(); // This is now part of SettingsUIManager.initThemeSelectors

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
                Utils.log(`Gambar gagal dimuat: ${imgElement.src}. Mencoba fallback.`, Utils.logLevels.WARN);
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
                    placeholder.textContent = '[Image not available]';
                    if (imgElement.parentElement) { try { imgElement.parentElement.replaceChild(placeholder, imgElement); } catch (e) { imgElement.style.display = 'none'; }}
                    else { imgElement.style.display = 'none'; }
                } else { imgElement.classList.add('image-load-error'); }
            }
        }, true);
        Utils.log("Global image error handler initialized.", Utils.logLevels.INFO);
    },

    refreshNetworkStatusUI: async function() {
        try {
            const networkType = await Utils.checkNetworkType();
            const wsStatus = ConnectionManager.isWebSocketConnected;
            if (typeof SettingsUIManager !== 'undefined' && SettingsUIManager.updateNetworkInfoDisplay) {
                SettingsUIManager.updateNetworkInfoDisplay(networkType, wsStatus);
            }
        } catch (error) {
            Utils.log(`Error in refreshNetworkStatusUI: ${error.message || error}`, Utils.logLevels.ERROR);
            if (typeof SettingsUIManager !== 'undefined' && SettingsUIManager.updateNetworkInfoDisplay) {
                SettingsUIManager.updateNetworkInfoDisplay({ error: "WebRTC check failed" }, ConnectionManager.isWebSocketConnected);
            }
        }
    },

    startNetworkMonitoring: function () {
        window.addEventListener('online', this.handleNetworkChange.bind(this));
        window.addEventListener('offline', this.handleNetworkChange.bind(this));
    },

    handleNetworkChange: async function () {
        if (navigator.onLine) {
            LayoutManager.updateConnectionStatusIndicator('Network reconnected. Attempting to restore connections...');
            ConnectionManager.initialize();
        } else {
            LayoutManager.updateConnectionStatusIndicator('Network disconnected.');
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
        // ConnectionManager related events
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

        // WebSocket status updates
        EventEmitter.on('websocketStatusUpdate', async () => {
            Utils.log('WebSocket status updated event received, refreshing network UI.', Utils.logLevels.DEBUG);
            await this.refreshNetworkStatusUI();
            if (typeof SettingsUIManager !== 'undefined' && SettingsUIManager.updateCheckNetworkButtonState) {
                SettingsUIManager.updateCheckNetworkButtonState();
            }
        });

        // File input (still makes sense here as it's a general input mechanism)
        const fileInput = document.getElementById('fileInput');
        if (fileInput) fileInput.addEventListener('change', MediaManager.handleFileSelect.bind(MediaManager));

        // Global window error handlers
        window.addEventListener('error', (event) => {
            const errorDetails = event.error ? (event.error.stack || event.error.message) : event.message;
            Utils.log(`Global window error: ${errorDetails} at ${event.filename}:${event.lineno}`, Utils.logLevels.ERROR);
            NotificationManager.showNotification('An application error occurred. Check console for details.', 'error');
        });
        window.addEventListener('unhandledrejection', function(event) {
            const reason = event.reason instanceof Error ? (event.reason.stack || event.reason.message) : event.reason;
            Utils.log(`Unhandled Promise rejection: ${reason}`, Utils.logLevels.ERROR);
            NotificationManager.showNotification('An unexpected error occurred. Check console.', 'error');
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

        // Loading overlay observer
        const connectionStatusTextEl = document.getElementById('connectionStatusText');
        const loadingOverlay = document.getElementById('loadingOverlay');
        if (connectionStatusTextEl && loadingOverlay) {
            const observer = new MutationObserver(() => {
                const statusText = connectionStatusTextEl.textContent.toLowerCase();
                if (statusText.includes('user registration successful') ||
                    statusText.includes('signaling server connected') ||
                    statusText.includes('loaded from local') ||
                    statusText.includes('using existing id') ||
                    statusText.includes('initialized. ready to connect')
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