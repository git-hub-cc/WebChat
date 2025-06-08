const AppInitializer = {

    init: async function () {
        Utils.setLogLevelFromConfig();

        // Initialize global image error handler first
        this.initializeGlobalImageErrorHandler(); // <<< BARU DITAMBAHKAN

        if (!UIManager.checkWebRTCSupport()) return;

        // ThemeLoader.init() is already called via inline script in index.html
        // This ensures CSS and data JS are loaded before other initializations.

        try {
            await DBManager.init();
            Utils.log('数据库初始化成功', Utils.logLevels.INFO);

            // UserManager.init now loads SPECIAL_CONTACTS_DEFINITIONS which should be globally set
            // by the theme's data JS file (loaded by ThemeLoader.init in index.html).

            await UserManager.init();
            await ChatManager.init();
            await GroupManager.init();

            await this.refreshNetworkStatusUI();
            this.startNetworkMonitoring();

            MediaManager.initVoiceRecording();
            VideoCallManager.init();

            this.setupEventListeners(); // This will also init the Open Source Modal UI elements and AI settings
            this.initUIMode();
            this.smartBackToChatList();

            ThemeLoader.populateSelector(); // Populate the theme selector now that DOM is ready

            ConnectionManager.initialize();

            Utils.log('应用已初始化', Utils.logLevels.INFO);
            // Note: The loading overlay is now hidden by the MutationObserver in setupEventListeners
            // which will then trigger the UIManager.showOpenSourceInfoModal()
        } catch (error) {
            Utils.log(`应用初始化失败: ${error.stack || error}`, Utils.logLevels.ERROR); // Log stack trace if available
            UIManager.showNotification('应用初始化失败，部分功能可能无法使用.', 'error');

            // Fallback initialization for essential UI if main init fails
            if (!UserManager.userId) {
                UserManager.userId = Utils.generateId(8);
                UserManager.userSettings.autoConnectEnabled = false; // Sensible default on error
                const userIdEl = document.getElementById('modalUserIdValue');
                if(userIdEl) userIdEl.textContent = UserManager.userId;
            }
            await this.refreshNetworkStatusUI(); // Attempt to show some network status
            this.startNetworkMonitoring();
            MediaManager.initVoiceRecording(); // Try to init basic media
            VideoCallManager.init();          // Try to init basic video call logic
            this.setupEventListeners();       // Setup basic listeners and Open Source Modal & AI settings
            this.initUIMode();
            ThemeLoader.populateSelector();   // Populate selector even in fallback

            // Explicitly try to hide loading overlay and show open source modal on error too,
            // assuming basic UI elements for them are present.
            const loadingOverlay = document.getElementById('loadingOverlay');
            if (loadingOverlay && loadingOverlay.style.display !== 'none') {
                loadingOverlay.style.display = 'none';
                UIManager.showOpenSourceInfoModal(); // Attempt to show it even on some init errors
            }
        }
    },

    initializeGlobalImageErrorHandler: function() { // <<< FUNGSI BARU
        document.addEventListener('error', function(event) {
            const imgElement = event.target;
            if (imgElement && imgElement.tagName === 'IMG') {
                // Mencegah loop jika kita mencoba mengganti src dan itu juga gagal (nama kelas diubah)
                if (imgElement.classList.contains('image-load-error-processed')) {
                    return;
                }
                imgElement.classList.add('image-load-error-processed'); // Tandai bahwa kita sudah mencoba

                Utils.log(`Gambar gagal dimuat: ${imgElement.src}. Mencoba fallback.`, Utils.logLevels.WARN);

                if (imgElement.classList.contains('avatar-image')) {
                    const fallbackText = imgElement.dataset.fallbackText || imgElement.alt || '?';
                    const entityId = imgElement.dataset.entityId;
                    const avatarContainer = imgElement.parentElement;

                    // Check if the parent is one of our designated avatar containers
                    if (avatarContainer && (
                        avatarContainer.classList.contains('chat-list-avatar') ||
                        avatarContainer.classList.contains('chat-avatar-main') ||
                        avatarContainer.classList.contains('details-avatar') ||
                        avatarContainer.classList.contains('video-call-avatar') // Added for calling modal avatars
                    )) {
                        avatarContainer.innerHTML = ''; // Clear the failed <img>
                        avatarContainer.textContent = fallbackText; // Set the fallback text
                        // Add a class to avatarContainer for any specific styling if needed for text
                        avatarContainer.classList.add('avatar-fallback-active');
                        Utils.log(`Fallback avatar disetel untuk ${entityId || 'unknown entity'} dengan teks: ${fallbackText}`, Utils.logLevels.INFO);
                    } else {
                        // If it's an avatar-image but not in a known container, or parent is null
                        imgElement.style.display = 'none'; // Fallback to just hiding it
                        Utils.log(`Avatar image ${imgElement.src} (ID: ${entityId}) tidak dalam container yang dikenal atau parent tidak ada, disembunyikan.`, Utils.logLevels.WARN);
                    }
                } else if (imgElement.classList.contains('file-preview-img')) { // Handle image messages
                    const placeholder = document.createElement('div');
                    placeholder.className = 'image-message-fallback';
                    placeholder.textContent = '[Image not available]';

                    if (imgElement.parentElement) {
                        try {
                            imgElement.parentElement.replaceChild(placeholder, imgElement);
                        } catch (e) {
                            Utils.log(`Gagal mengganti image message dengan fallback: ${e.message}`, Utils.logLevels.WARN);
                            imgElement.style.display = 'none';
                        }
                    } else {
                        imgElement.style.display = 'none';
                    }
                    Utils.log(`Fallback teks disetel untuk pesan gambar: ${imgElement.src}`, Utils.logLevels.INFO);
                } else {
                    // For other images, add class and optionally hide
                    imgElement.classList.add('image-load-error'); // General error class
                    // imgElement.style.display = 'none'; // Optionally hide all other unhandled failed images
                    Utils.log(`Gambar ${imgElement.src} gagal dimuat, kelas error umum ditambahkan.`, Utils.logLevels.WARN);
                }
            }
        }, true); // true untuk menggunakan capture phase
        Utils.log("Global image error handler initialized.", Utils.logLevels.INFO);
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
            Utils.log(`Error in refreshNetworkStatusUI during Utils.checkNetworkType: ${error.message || error}`, Utils.logLevels.ERROR);
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
            ConnectionManager.initialize(); // Re-initialize or attempt to reconnect
        } else {
            UIManager.updateConnectionStatusIndicator('Network disconnected.');
        }
        await this.refreshNetworkStatusUI();
    },

    smartBackToChatList: function (){
        history.pushState(null, null, location.href);
        window.addEventListener('popstate', function(event) {
            const btn = document.querySelector('.back-to-list-btn');
            if (btn) {
                const computedStyle = window.getComputedStyle(btn);
                const displayProperty = computedStyle.getPropertyValue('display');
                if (displayProperty === "block"){
                    // If back button is visible (meaning we are in chat view on mobile),
                    // prevent default back and show chat list.
                    history.pushState(null, null, location.href); // Push state again to override browser's back
                    UIManager.showChatListArea();
                    Utils.log("Pengguna mencoba kembali dari tampilan chat, menampilkan daftar chat.", Utils.logLevels.DEBUG);
                }
            }
            // If not in chat view (btn not 'block'), let the browser handle back normally.
        });
    },

    setupEventListeners: function () {
        UIManager.initOpenSourceModal(); // Initialize Open Source Modal, AI settings elements and bind events

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
            if (typeof UIManager !== 'undefined' && UIManager.updateCheckNetworkButtonState) {
                UIManager.updateCheckNetworkButtonState();
            }
        });

        const voiceButton = document.getElementById('voiceButtonMain');
        if (voiceButton) { // Check if element exists
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
        }


        document.getElementById('mainMenuBtn').addEventListener('click', () => {
            UIManager.toggleModal('mainMenuModal', true);
            const autoConnectToggle = document.getElementById('autoConnectToggle');
            if (autoConnectToggle && UserManager.userSettings) {
                autoConnectToggle.checked = UserManager.userSettings.autoConnectEnabled;
            }
            // Update button states when modal is opened
            if (typeof UIManager !== 'undefined') {
                if (UIManager.updateCopyIdButtonState) UIManager.updateCopyIdButtonState();
                if (UIManager.updateCheckNetworkButtonState) UIManager.updateCheckNetworkButtonState();
            }
        });
        const closeMainMenuBtn = document.querySelector('.close-modal-btn[data-modal-id="mainMenuModal"]');
        if (closeMainMenuBtn) closeMainMenuBtn.addEventListener('click', () => UIManager.toggleModal('mainMenuModal', false));

        const modalCopyIdBtn = document.getElementById('modalCopyIdBtn');
        if (modalCopyIdBtn) modalCopyIdBtn.addEventListener('click', () => {
            if (modalCopyIdBtn.disabled) return;
            UIManager.copyUserIdFromModal();
        });

        const checkNetworkBtnModal = document.getElementById('checkNetworkBtnModal');
        if (checkNetworkBtnModal) checkNetworkBtnModal.addEventListener('click', async () => {
            if (checkNetworkBtnModal.disabled) { // If button is disabled (meaning already connected)
                UIManager.showNotification('Currently connected to signaling server.', 'info');
                return;
            }
            UIManager.showNotification('Re-checking network and attempting to connect...', 'info');
            await this.refreshNetworkStatusUI(); // `this` is AppInitializer instance
            if (!ConnectionManager.isWebSocketConnected) {
                Utils.log("Re-check Network button: WebSocket not connected, attempting to connect.", Utils.logLevels.INFO);
                ConnectionManager.connectWebSocket().catch(err => {
                    UIManager.showNotification('Failed to re-establish signaling connection.', 'error');
                    Utils.log(`Manual Re-check Network: connectWebSocket failed: ${err.message || err}`, Utils.logLevels.ERROR);
                });
            }
        });

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


        const modalResetAllConnectionsBtn = document.getElementById('modalResetAllConnectionsBtn');
        if (modalResetAllConnectionsBtn) modalResetAllConnectionsBtn.addEventListener('click', () => ConnectionManager.resetAllConnections());

        const modalClearContactsBtn = document.getElementById('modalClearContactsBtn');
        if (modalClearContactsBtn) modalClearContactsBtn.addEventListener('click', () => UserManager.clearAllContacts());

        const modalClearAllChatsBtn = document.getElementById('modalClearAllChatsBtn');
        if (modalClearAllChatsBtn) modalClearAllChatsBtn.addEventListener('click', () => ChatManager.clearAllChats());


        const newChatFab = document.getElementById('newChatFab');
        if (newChatFab) newChatFab.addEventListener('click', () => UIManager.toggleModal('newContactGroupModal', true));

        const closeNewContactGroupModalBtn = document.querySelector('.close-modal-btn[data-modal-id="newContactGroupModal"]');
        if (closeNewContactGroupModalBtn) closeNewContactGroupModalBtn.addEventListener('click', () => UIManager.toggleModal('newContactGroupModal', false));

        const confirmNewContactBtn = document.getElementById('confirmNewContactBtn');
        if (confirmNewContactBtn) confirmNewContactBtn.addEventListener('click', UIManager.handleAddNewContact);

        const confirmNewGroupBtnModal = document.getElementById('confirmNewGroupBtnModal');
        if (confirmNewGroupBtnModal) confirmNewGroupBtnModal.addEventListener('click', UIManager.handleCreateNewGroup);

        const videoCallButtonMain = document.getElementById('videoCallButtonMain');
        if (videoCallButtonMain) videoCallButtonMain.onclick = () => VideoCallManager.initiateCall(ChatManager.currentChatId);

        const audioCallButtonMain = document.getElementById('audioCallButtonMain');
        if (audioCallButtonMain) audioCallButtonMain.onclick = () => VideoCallManager.initiateAudioCall(ChatManager.currentChatId);

        const screenShareButtonMain = document.getElementById('screenShareButtonMain');
        if (screenShareButtonMain) screenShareButtonMain.onclick = () => VideoCallManager.initiateScreenShare(ChatManager.currentChatId);

        const chatDetailsBtnMain = document.getElementById('chatDetailsBtnMain');
        if (chatDetailsBtnMain) chatDetailsBtnMain.addEventListener('click', () => UIManager.toggleDetailsPanel(true));

        const closeDetailsBtnMain = document.getElementById('closeDetailsBtnMain');
        if (closeDetailsBtnMain) closeDetailsBtnMain.addEventListener('click', () => UIManager.toggleDetailsPanel(false));

        const addMemberBtnDetails = document.getElementById('addMemberBtnDetails');
        if (addMemberBtnDetails) addMemberBtnDetails.addEventListener('click', UIManager.handleAddMemberToGroupDetails);

        const tabAllChats = document.getElementById('tabAllChats');
        if (tabAllChats) tabAllChats.addEventListener('click', () => ChatManager.renderChatList('all'));

        const tabContacts = document.getElementById('tabContacts');
        if (tabContacts) tabContacts.addEventListener('click', () => UserManager.renderContactListForSidebar());

        const tabGroups = document.getElementById('tabGroups');
        if (tabGroups) tabGroups.addEventListener('click', () => GroupManager.renderGroupListForSidebar());

        const chatSearchInput = document.getElementById('chatSearchInput');
        if (chatSearchInput) chatSearchInput.addEventListener('input', (e) => UIManager.filterChatList(e.target.value));

        const sendButtonMain = document.getElementById('sendButtonMain');
        if (sendButtonMain) sendButtonMain.addEventListener('click', MessageManager.sendMessage);

        const attachBtnMain = document.getElementById('attachBtnMain');
        if (attachBtnMain) attachBtnMain.addEventListener('click', () => {
            const fileInput = document.getElementById('fileInput');
            if (fileInput) fileInput.click();
        });

        const fileInput = document.getElementById('fileInput');
        if (fileInput) fileInput.addEventListener('change', MediaManager.handleFileSelect.bind(MediaManager));


        const backToListBtn = document.getElementById('backToListBtn');
        if (backToListBtn) backToListBtn.addEventListener('click', () => UIManager.showChatListArea());

        window.addEventListener('error', (event) => {
            // Menggunakan event.error jika ada, untuk stack trace yang lebih baik
            const errorDetails = event.error ? (event.error.stack || event.error.message) : event.message;
            Utils.log(`Global window error: ${errorDetails} at ${event.filename}:${event.lineno}`, Utils.logLevels.ERROR);
            UIManager.showNotification('An application error occurred. Check console for details.', 'error');
        });

        window.addEventListener('unhandledrejection', function(event) {
            const reason = event.reason instanceof Error ? (event.reason.stack || event.reason.message) : event.reason;
            Utils.log(`Unhandled Promise rejection: ${reason}`, Utils.logLevels.ERROR);
            // Pesan "Lost connection to the server" mungkin tidak selalu akurat untuk semua unhandled rejection.
            // Lebih baik memberikan pesan yang lebih umum atau spesifik jika bisa diidentifikasi.
            UIManager.showNotification('An unexpected error occurred. Check console.', 'error');
        });

        window.addEventListener('beforeunload', () => {
            MediaManager.releaseAudioResources();
            VideoCallManager.releaseMediaResources();
            for (const peerId in ConnectionManager.connections) {
                if (ConnectionManager.connections.hasOwnProperty(peerId)) {
                    ConnectionManager.close(peerId, true); // true untuk menandakan ini adalah penutupan paksa/final
                }
            }
        });

        const connectionStatusTextEl = document.getElementById('connectionStatusText');
        const loadingOverlay = document.getElementById('loadingOverlay');
        if (connectionStatusTextEl && loadingOverlay) {
            const observer = new MutationObserver(() => {
                const statusText = connectionStatusTextEl.textContent.toLowerCase();
                if (statusText.includes('user registration successful') ||
                    statusText.includes('signaling server connected') ||
                    statusText.includes('loaded from local') ||
                    statusText.includes('using existing id') ||
                    statusText.includes('initialized. ready to connect') // Tambahan untuk status awal sukses
                ) {
                    setTimeout(() => {
                        if (loadingOverlay.style.display !== 'none') {
                            loadingOverlay.style.display = 'none';
                            // Hanya tampilkan modal open source jika belum pernah ditutup secara permanen
                            UIManager.showOpenSourceInfoModal();
                        }
                    }, 500); // Delay to ensure UI settles
                }
            });
            observer.observe(connectionStatusTextEl, { childList: true, characterData: true, subtree: true });
        }
    }
};

ThemeLoader.init(); // Call init immediately to load CSS and data JS
window.addEventListener('load', AppInitializer.init.bind(AppInitializer));