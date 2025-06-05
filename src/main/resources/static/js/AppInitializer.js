
const AppInitializer = {

    init: async function () {
        Utils.setLogLevelFromConfig(); // Set log level from Config first
        if (!UIManager.checkWebRTCSupport()) return;

        try {
            await DBManager.init();
            Utils.log('数据库初始化成功', Utils.logLevels.INFO);

            await UserManager.init(); // UserManager.init now loads the autoConnectEnabled setting
            await ChatManager.init();
            await GroupManager.init(); // Init GroupManager after UserManager and ChatManager

            await this.refreshNetworkStatusUI(); // Initial comprehensive network status check
            this.startNetworkMonitoring();

            MediaManager.initVoiceRecording();
            VideoCallManager.init();

            this.setupEventListeners();
            this.initUIMode(); // Initialize UI mode for mobile/desktop

            ConnectionManager.initialize(); // This will attempt WebSocket connection

            history.pushState(null, null, location.href);
            window.addEventListener('popstate', function(event) {
                const btn = document.querySelector('.back-to-list-btn');
                if (btn) {
                    const computedStyle = window.getComputedStyle(btn);
                    const displayProperty = computedStyle.getPropertyValue('display');
                    if (displayProperty === "block"){
                        history.pushState(null, null, location.href);
                        UIManager.showChatListArea()
                        console.log("用户尝试返回，猜测可能需要返回聊天列表。");
                    }
                }
            });
            Utils.log('应用已初始化', Utils.logLevels.INFO);
        } catch (error) {
            Utils.log(`应用初始化失败: ${error}`, Utils.logLevels.ERROR);
            UIManager.showNotification('应用初始化失败，部分功能可能无法使用.', 'error');

            // Fallback for core functionalities if DB fails
            if (!UserManager.userId) { // Ensure UserManager fallback if its init failed before DB
                UserManager.userId = Utils.generateId(8);
                UserManager.userSettings.autoConnectEnabled = false; // Ensure default on fallback
                document.getElementById('modalUserIdValue').textContent = UserManager.userId;
            }
            await this.refreshNetworkStatusUI();
            this.startNetworkMonitoring();
            MediaManager.initVoiceRecording();
            VideoCallManager.init();
            this.setupEventListeners(); // Call setupEventListeners even in fallback
            this.initUIMode();
        }
    },

    initUIMode: function() {
        UIManager.updateResponsiveUI();
        window.addEventListener('resize', UIManager.updateResponsiveUI.bind(UIManager));
    },

    refreshNetworkStatusUI: async function() {
        try {
            const networkType = await Utils.checkNetworkType();
            const wsStatus = ConnectionManager.isWebSocketConnected;
            UIManager.updateNetworkInfoDisplay(networkType, wsStatus);
        } catch (error) {
            Utils.log(`Error in refreshNetworkStatusUI during Utils.checkNetworkType: ${error}`, Utils.logLevels.ERROR);
            UIManager.updateNetworkInfoDisplay({ error: "WebRTC check failed" }, ConnectionManager.isWebSocketConnected);
        }
    },

    startNetworkMonitoring: function () {
        window.addEventListener('online', this.handleNetworkChange.bind(this));
        window.addEventListener('offline', this.handleNetworkChange.bind(this));
    },

    handleNetworkChange: async function () {
        if (navigator.onLine) {
            UIManager.updateConnectionStatusIndicator('Network reconnected. Attempting to restore connections...');
            ConnectionManager.initialize();
        } else {
            UIManager.updateConnectionStatusIndicator('Network disconnected.');
        }
        await this.refreshNetworkStatusUI();
    },

    setupEventListeners: function () {
        document.getElementById('messageInput').addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey) {
                e.preventDefault();
                MessageManager.sendMessage();
            }
        });

        EventEmitter.on('connectionDisconnected', (peerId) => {
            if (ChatManager.currentChatId === peerId) {
                UIManager.setCallButtonsState(false);
            }
            UIManager.updateChatListItemStatus(peerId, false);
        });

        EventEmitter.on('connectionEstablished', (peerId) => {
            if (ChatManager.currentChatId === peerId) {
                // For special contacts, call buttons should remain disabled for P2P calls
                const contact = UserManager.contacts[peerId];
                if (contact && contact.isSpecial) {
                    UIManager.setCallButtonsState(false);
                } else {
                    UIManager.setCallButtonsState(true, peerId);
                }
            }
            UIManager.updateChatListItemStatus(peerId, true);
        });


        EventEmitter.on('connectionFailed', (peerId) => {
            if (ChatManager.currentChatId === peerId) {
                UIManager.setCallButtonsState(false);
            }
            UIManager.updateChatListItemStatus(peerId, false);
        });

        EventEmitter.on('connectionClosed', (peerId) => {
            if (ChatManager.currentChatId === peerId) {
                UIManager.setCallButtonsState(false);
            }
            UIManager.updateChatListItemStatus(peerId, false);
        });


        EventEmitter.on('websocketStatusUpdate', async () => {
            Utils.log('WebSocket status updated event received, refreshing network UI.', Utils.logLevels.DEBUG);
            await this.refreshNetworkStatusUI();
        });

        const voiceButton = document.getElementById('voiceButtonMain');
        if ('ontouchstart' in window) {
            voiceButton.addEventListener('touchstart', (e) => { e.preventDefault(); MediaManager.startRecording(); });
            voiceButton.addEventListener('touchend', (e) => { e.preventDefault(); MediaManager.stopRecording(); });
        } else {
            voiceButton.addEventListener('mousedown', MediaManager.startRecording.bind(MediaManager));
            voiceButton.addEventListener('mouseup', MediaManager.stopRecording.bind(MediaManager));
            voiceButton.addEventListener('mouseleave', () => {
                if (MediaManager.mediaRecorder && MediaManager.mediaRecorder.state === 'recording') {
                    MediaManager.stopRecording();
                }
            });
        }

        document.getElementById('mainMenuBtn').addEventListener('click', () => {
            UIManager.toggleModal('mainMenuModal', true);
            const autoConnectToggle = document.getElementById('autoConnectToggle');
            if (autoConnectToggle && UserManager.userSettings) {
                autoConnectToggle.checked = UserManager.userSettings.autoConnectEnabled;
            }
        });
        document.querySelector('.close-modal-btn[data-modal-id="mainMenuModal"]').addEventListener('click', () => UIManager.toggleModal('mainMenuModal', false));
        document.getElementById('modalCopyIdBtn').addEventListener('click', () => UIManager.copyUserIdFromModal());
        document.getElementById('checkNetworkBtnModal').addEventListener('click', async () => await this.refreshNetworkStatusUI());

        const autoConnectToggle = document.getElementById('autoConnectToggle');
        if (autoConnectToggle) {
            autoConnectToggle.addEventListener('change', (event) => {
                if (UserManager.userSettings) {
                    UserManager.updateUserSetting('autoConnectEnabled', event.target.checked);
                    if (event.target.checked) {
                        UIManager.showNotification('Auto-connect enabled. Will attempt on next app start or successful signaling connection.', 'info');
                        if (ConnectionManager.isWebSocketConnected && ConnectionManager.websocket?.readyState === WebSocket.OPEN) {
                            ConnectionManager.autoConnectToAllContacts();
                        }
                    } else {
                        UIManager.showNotification('Auto-connect disabled.', 'info');
                    }
                }
            });
        }


        document.getElementById('modalResetAllConnectionsBtn').addEventListener('click', () => ConnectionManager.resetAllConnections());
        document.getElementById('modalClearContactsBtn').addEventListener('click', () => UserManager.clearAllContacts());
        document.getElementById('modalClearAllChatsBtn').addEventListener('click', () => ChatManager.clearAllChats());


        document.getElementById('newChatFab').addEventListener('click', () => UIManager.toggleModal('newContactGroupModal', true));
        document.querySelector('.close-modal-btn[data-modal-id="newContactGroupModal"]').addEventListener('click', () => UIManager.toggleModal('newContactGroupModal', false));
        document.getElementById('confirmNewContactBtn').addEventListener('click', UIManager.handleAddNewContact);
        document.getElementById('confirmNewGroupBtnModal').addEventListener('click', UIManager.handleCreateNewGroup);

        document.getElementById('videoCallButtonMain').onclick = () => VideoCallManager.initiateCall(ChatManager.currentChatId);
        document.getElementById('audioCallButtonMain').onclick = () => VideoCallManager.initiateAudioCall(ChatManager.currentChatId);
        document.getElementById('screenShareButtonMain').onclick = () => VideoCallManager.initiateScreenShare(ChatManager.currentChatId);
        document.getElementById('chatDetailsBtnMain').addEventListener('click', () => UIManager.toggleDetailsPanel(true));

        document.getElementById('closeDetailsBtnMain').addEventListener('click', () => UIManager.toggleDetailsPanel(false));
        document.getElementById('addMemberBtnDetails').addEventListener('click', UIManager.handleAddMemberToGroupDetails);

        document.getElementById('tabAllChats').addEventListener('click', () => ChatManager.renderChatList('all'));
        document.getElementById('tabContacts').addEventListener('click', () => UserManager.renderContactListForSidebar());
        document.getElementById('tabGroups').addEventListener('click', () => GroupManager.renderGroupListForSidebar());

        document.getElementById('chatSearchInput').addEventListener('input', (e) => UIManager.filterChatList(e.target.value));

        document.getElementById('sendButtonMain').addEventListener('click', MessageManager.sendMessage);
        document.getElementById('attachBtnMain').addEventListener('click', () => document.getElementById('fileInput').click());
        document.getElementById('fileInput').addEventListener('change', MediaManager.handleFileSelect.bind(MediaManager));


        document.getElementById('backToListBtn').addEventListener('click', () => UIManager.showChatListArea());

        window.addEventListener('error', (event) => {
            Utils.log(`应用错误: ${event.message} at ${event.filename}:${event.lineno}`, Utils.logLevels.ERROR);
            UIManager.showNotification('An application error occurred. Check console for details.', 'error');
        });

        window.addEventListener('unhandledrejection', function(event) {
            Utils.log(`未处理的Promise拒绝: ${event.reason}`, Utils.logLevels.ERROR);
            UIManager.showNotification('Lost connection to the server.', 'error');
        });

        window.addEventListener('beforeunload', () => {
            MediaManager.releaseAudioResources();
            VideoCallManager.releaseMediaResources();
            for (const peerId in ConnectionManager.connections) {
                ConnectionManager.close(peerId);
            }
        });

        const connectionStatusTextEl = document.getElementById('connectionStatusText');
        const loadingOverlay = document.getElementById('loadingOverlay');
        if (connectionStatusTextEl && loadingOverlay) {
            const observer = new MutationObserver(() => {
                const statusText = connectionStatusTextEl.textContent.toLowerCase();
                if (statusText.includes('user registration successful') || statusText.includes('signaling server connected')) {
                    setTimeout(() => {
                        if (loadingOverlay.style.display !== 'none') {
                            loadingOverlay.style.display = 'none';
                        }
                    }, 500);
                }
            });
            observer.observe(connectionStatusTextEl, { childList: true, characterData: true, subtree: true });
        }
    }
};

window.addEventListener('load', AppInitializer.init.bind(AppInitializer));