
const UIManager = {
    isDetailsPanelVisible: false,

    // Call this on init and resize
    updateResponsiveUI: function() {
        const appContainer = document.querySelector('.app-container');
        if (window.innerWidth <= 768) {
            appContainer.classList.add('mobile-view');
            if (!appContainer.classList.contains('chat-view-active')) {
                this.showChatListArea(); // Default to list view on mobile
            }
        } else {
            appContainer.classList.remove('mobile-view', 'chat-view-active');
            const sidebarNav = document.getElementById('sidebarNav');
            if (sidebarNav) sidebarNav.style.display = 'flex';
            const chatArea = document.getElementById('chatArea');
            if (chatArea) chatArea.style.display = 'flex';
        }
    },

    showChatListArea: function() {
        const appContainer = document.querySelector('.app-container');
        if (appContainer.classList.contains('mobile-view')) {
            appContainer.classList.remove('chat-view-active');
            const sidebarNav = document.getElementById('sidebarNav');
            if (sidebarNav) sidebarNav.style.display = 'flex';
            const chatArea = document.getElementById('chatArea');
            if (chatArea) chatArea.style.display = 'none';
        }
        this.toggleDetailsPanel(false); // Hide details when going to list on mobile
    },

    showChatArea: function() {
        const appContainer = document.querySelector('.app-container');
        const chatAreaEl = document.getElementById('chatArea');

        if (appContainer && appContainer.classList.contains('mobile-view')) {
            appContainer.classList.add('chat-view-active');
            const sidebarNav = document.getElementById('sidebarNav');
            if (sidebarNav) sidebarNav.style.display = 'none';

            if (chatAreaEl) {
                chatAreaEl.style.display = 'flex';
            } else {
                Utils.log("UIManager.showChatArea: Critical error - chatArea element NOT FOUND!", Utils.logLevels.ERROR);
                return;
            }
        } else if (chatAreaEl) {
            chatAreaEl.style.display = 'flex';
        } else {
            Utils.log("UIManager.showChatArea: Critical error - chatArea element NOT FOUND! (desktop mode)", Utils.logLevels.ERROR);
            return;
        }

        const noChatSelectedScreen = document.getElementById('noChatSelectedScreen');
        if (noChatSelectedScreen) {
            noChatSelectedScreen.style.display = 'none';
        }

        const chatBox = document.getElementById('chatBox');
        if (chatBox) {
            chatBox.style.display = 'flex';
        } else {
            Utils.log("UIManager.showChatArea: chatBox element NOT FOUND!", Utils.logLevels.ERROR);
        }
    },

    showNoChatSelected: function() {
        const currentChatTitleMain = document.getElementById('currentChatTitleMain');
        if (currentChatTitleMain) currentChatTitleMain.textContent = 'Select a chat';
        const currentChatStatusMain = document.getElementById('currentChatStatusMain');
        if (currentChatStatusMain) currentChatStatusMain.textContent = '';
        const currentChatAvatarMain = document.getElementById('currentChatAvatarMain');
        if (currentChatAvatarMain) currentChatAvatarMain.textContent = '';

        const chatBox = document.getElementById('chatBox');
        if (chatBox) {
            chatBox.innerHTML = '';
            chatBox.style.display = 'hidden'; // Hide message area when no chat is selected
        } else {
            Utils.log("UIManager.showNoChatSelected: chatBox element NOT FOUND!", Utils.logLevels.ERROR);
        }

        const noChatSelectedScreen = document.getElementById('noChatSelectedScreen');
        if (noChatSelectedScreen) {
            noChatSelectedScreen.style.display = 'flex';
        } else {
            Utils.log("UIManager.showNoChatSelected: noChatSelectedScreen element NOT FOUND!", Utils.logLevels.ERROR);
        }


        this.enableChatInterface(false);
        this.toggleDetailsPanel(false);
        const appContainer = document.querySelector('.app-container');
        if (appContainer && appContainer.classList.contains('mobile-view')) {
            this.showChatListArea();
        }
    },

    updateChatHeader: function(title, status, avatarText, isGroup = false, isOwner = false) {
        document.getElementById('currentChatTitleMain').textContent = Utils.escapeHtml(title);
        document.getElementById('currentChatStatusMain').textContent = Utils.escapeHtml(status);
        const avatarEl = document.getElementById('currentChatAvatarMain');
        avatarEl.textContent = Utils.escapeHtml(avatarText) || Utils.escapeHtml(title).charAt(0).toUpperCase();
        avatarEl.className = 'chat-avatar-main'; // Reset classes
        if (isGroup) avatarEl.classList.add('group');

        const detailsBtn = document.getElementById('chatDetailsBtnMain');
        detailsBtn.style.display = ChatManager.currentChatId ? 'block' : 'none';
    },

    updateChatHeaderStatus: function(statusText) {
        const statusEl = document.getElementById('currentChatStatusMain');
        if (statusEl) statusEl.textContent = Utils.escapeHtml(statusText);
    },

    enableChatInterface: function(enabled) {
        const elementsToToggle = [
            'messageInput', 'sendButtonMain', 'attachBtnMain',
            'voiceButtonMain',
        ];
        elementsToToggle.forEach(id => {
            const el = document.getElementById(id);
            if (el) el.disabled = !enabled;
        });

        if (enabled && ChatManager.currentChatId) {
            this.setCallButtonsState(ConnectionManager.isConnectedTo(ChatManager.currentChatId), ChatManager.currentChatId);
        } else {
            this.setCallButtonsState(false); // Disable if no chat or interface disabled
        }

        if (enabled) {
            // Small delay for focus to work reliably after UI changes
            setTimeout(() => {
                const messageInput = document.getElementById('messageInput');
                if (messageInput) messageInput.focus();
            }, 100);
        }
    },

    setCallButtonsState(enabled, peerId = null) {
        const videoCallBtn = document.getElementById('videoCallButtonMain');
        const audioCallBtn = document.getElementById('audioCallButtonMain');
        const screenShareBtn = document.getElementById('screenShareButtonMain');

        const currentChat = ChatManager.currentChatId;
        const isGroupChat = currentChat?.startsWith('group_');
        const canShareScreen = !!(navigator.mediaDevices && navigator.mediaDevices.getDisplayMedia);

        if (videoCallBtn) videoCallBtn.disabled = !enabled || isGroupChat;
        if (audioCallBtn) audioCallBtn.disabled = !enabled || isGroupChat;
        if (screenShareBtn) screenShareBtn.disabled = !enabled || isGroupChat || !canShareScreen;

        if (enabled && peerId && !isGroupChat) {
            videoCallBtn.onclick = () => VideoCallManager.initiateCall(peerId);
            audioCallBtn.onclick = () => VideoCallManager.initiateAudioCall(peerId);
            if (canShareScreen) screenShareBtn.onclick = () => VideoCallManager.initiateScreenShare(peerId);
        } else { // Clear onclick handlers if disabled or group chat
            videoCallBtn.onclick = null;
            audioCallBtn.onclick = null;
            screenShareBtn.onclick = null;
        }
    },

    updateConnectionStatusIndicator: function(message, type = 'info') {
        const statusTextEl = document.getElementById('connectionStatusText');
        const statusContainerEl = document.getElementById('connectionStatusGlobal');

        if (statusTextEl) statusTextEl.textContent = message;
        if (statusContainerEl) {
            statusContainerEl.className = 'status-indicator global'; // Ensure 'global' class is always present
            if (type !== 'info') {
                statusContainerEl.classList.add(`status-${type}`);
            }
        }
    },

    updateNetworkInfoDisplay: function(networkType, webSocketStatus) {
        const networkInfoEl = document.getElementById('modalNetworkInfo');
        const qualityIndicator = document.getElementById('modalQualityIndicator');
        const qualityText = document.getElementById('modalQualityText');

        if (!networkInfoEl || !qualityIndicator || !qualityText) return;

        let html = '';
        let overallQuality = 'N/A';
        let qualityClass = '';

        if (networkType && networkType.error === null) {
            html += `IPv4: ${networkType.ipv4 ? '✓' : '✗'} | IPv6: ${networkType.ipv6 ? '✓' : '✗'} <br>`;
            html += `UDP: ${networkType.udp ? '✓' : '✗'} | TCP: ${networkType.tcp ? '✓' : '✗'} | Relay: ${networkType.relay ? '✓' : '?'} <br>`;
        } else {
            html += 'WebRTC Network detection: ' + (networkType?.error || 'Failed or not supported') + '.<br>';
        }

        html += `Signaling Server: ${webSocketStatus ? '<span style="color: green;">Connected</span>' : '<span style="color: var(--danger-color, red);">Disconnected</span>'}`;
        networkInfoEl.innerHTML = html;

        if (!webSocketStatus) {
            overallQuality = 'Signaling Offline';
            qualityClass = 'quality-poor';
        } else if (networkType && networkType.error === null) {
            if (networkType.udp) {
                overallQuality = 'Good';
                qualityClass = 'quality-good';
            } else if (networkType.tcp) {
                overallQuality = 'Limited (TCP Fallback)';
                qualityClass = 'quality-medium';
            } else if (networkType.relay) {
                overallQuality = 'Relay Only';
                qualityClass = 'quality-medium';
            } else {
                overallQuality = 'Poor (WebRTC P2P Failed)';
                qualityClass = 'quality-poor';
            }
        } else {
            overallQuality = 'WebRTC Check Failed';
            qualityClass = 'quality-poor';
        }

        qualityIndicator.className = `quality-indicator ${qualityClass}`;
        qualityText.textContent = overallQuality;
    },

    checkWebRTCSupport: function() {
        if (typeof RTCPeerConnection === 'undefined') {
            this.updateConnectionStatusIndicator('Browser does not support WebRTC.', 'error');
            this.updateNetworkInfoDisplay(null, ConnectionManager.isWebSocketConnected); // Pass current WS status
            return false;
        }
        return true;
    },

    showNotification: function(message, type = 'info') {
        const container = document.querySelector('.notification-container') || this._createNotificationContainer();

        const notification = document.createElement('div');
        notification.className = `notification notification-${type}`;
        const iconMap = { info: 'ℹ️', success: '✅', warning: '⚠️', error: '❌' };

        notification.innerHTML = `
            <span class="notification-icon">${iconMap[type]}</span>
            <span class="notification-message">${Utils.escapeHtml(message)}</span>
            <button class="notification-close" title="Close">×</button>
        `;
        container.appendChild(notification);

        const removeNotification = () => {
            notification.classList.add('notification-hide');
            setTimeout(() => {
                if (notification.parentNode) notification.remove();
                if (container.children.length === 0 && container.parentNode) container.remove(); // Remove container if empty
            }, 300);
        };

        notification.querySelector('.notification-close').onclick = removeNotification;
        setTimeout(removeNotification, type === 'error' ? 8000 : 5000);
    },
    _createNotificationContainer: function() {
        const container = document.createElement('div');
        container.className = 'notification-container';
        document.body.appendChild(container);
        return container;
    },

    toggleModal: function(modalId, show) {
        const modal = document.getElementById(modalId);
        if (modal) {
            modal.style.display = show ? 'flex' : 'none';
            if (show && modalId === 'mainMenuModal') {
                // Refresh network status when main menu modal is shown
                AppInitializer.refreshNetworkStatusUI();
            }
        }
    },

    copyUserIdFromModal: function() {
        const userId = document.getElementById('modalUserIdValue').textContent;
        if (userId && userId !== "Generating...") {
            navigator.clipboard.writeText(userId)
                .then(() => this.showNotification('User ID copied!', 'success'))
                .catch(() => this.showNotification('Failed to copy ID.', 'error'));
        }
    },
    copySdpTextFromModal: function() { // Make sure this button exists or is added to HTML
        const sdpText = document.getElementById('modalSdpText').value;
        if (sdpText) {
            navigator.clipboard.writeText(sdpText)
                .then(() => this.showNotification('Connection Info copied!', 'success'))
                .catch(() => this.showNotification('Failed to copy info.', 'error'));
        } else {
            this.showNotification('No connection info to copy.', 'warning');
        }
    },


    handleAddNewContact: function() {
        const peerId = document.getElementById('newPeerIdInput').value.trim();
        const peerName = document.getElementById('newPeerNameInput').value.trim();
        if (!peerId) {
            UIManager.showNotification('Peer ID is required.', 'warning');
            return;
        }
        UserManager.addContact(peerId, peerName || `Peer ${peerId.substring(0,4)}`);
        document.getElementById('newPeerIdInput').value = '';
        document.getElementById('newPeerNameInput').value = '';
        UIManager.toggleModal('newContactGroupModal', false);
    },

    handleCreateNewGroup: function() {
        const groupName = document.getElementById('newGroupNameInput').value.trim();
        if (!groupName) {
            UIManager.showNotification('Group Name is required.', 'warning');
            return;
        }
        GroupManager.createGroup(groupName);
        document.getElementById('newGroupNameInput').value = '';
        UIManager.toggleModal('newContactGroupModal', false);
    },

    setActiveTab: function(tabName) {
        document.querySelectorAll('.nav-tabs .nav-tab').forEach(tab => tab.classList.remove('active'));
        let targetTabId = '';
        if (tabName === 'all') targetTabId = 'tabAllChats';
        else if (tabName === 'contacts') targetTabId = 'tabContacts';
        else if (tabName === 'groups') targetTabId = 'tabGroups';

        const activeTabEl = document.getElementById(targetTabId);
        if (activeTabEl) activeTabEl.classList.add('active');
    },

    toggleDetailsPanel: function(show) {
        const detailsPanel = document.getElementById('detailsPanel');
        const appContainer = document.querySelector('.app-container');
        this.isDetailsPanelVisible = show;

        if (show) {
            if (!ChatManager.currentChatId) { // Don't show if no chat selected
                this.isDetailsPanelVisible = false;
                return;
            }
            detailsPanel.style.display = 'flex';
            appContainer.classList.add('show-details');
            this.updateDetailsPanel(ChatManager.currentChatId, ChatManager.currentChatId.startsWith('group_') ? 'group' : 'contact');
        } else {
            appContainer.classList.remove('show-details');
            // Delay hiding to allow for transition animation
            setTimeout(() => {
                if (!this.isDetailsPanelVisible) detailsPanel.style.display = 'none';
            }, 300);
        }
    },

    updateDetailsPanel: function(chatId, type) {
        const nameEl = document.getElementById('detailsName');
        const idEl = document.getElementById('detailsId');
        const avatarEl = document.getElementById('detailsAvatar');
        const statusEl = document.getElementById('detailsStatus');
        const contactActionsEl = document.getElementById('contactActionsDetails');
        const groupMgmtEl = document.getElementById('detailsGroupManagement');
        const groupActionsEl = document.getElementById('groupActionsDetails');
        const deleteContactBtn = document.getElementById('deleteContactBtnDetails');
        const leaveGroupBtn = document.getElementById('leaveGroupBtnDetails');
        const dissolveGroupBtn = document.getElementById('dissolveGroupBtnDetails');

        if (contactActionsEl) contactActionsEl.style.display = 'none';
        if (groupMgmtEl) groupMgmtEl.style.display = 'none';
        if (groupActionsEl) groupActionsEl.style.display = 'none';

        if (type === 'contact') {
            const contact = UserManager.contacts[chatId];
            if (!contact) return;
            nameEl.textContent = contact.name;
            idEl.textContent = `ID: ${contact.id}`;
            avatarEl.textContent = contact.name.charAt(0).toUpperCase();
            avatarEl.className = 'details-avatar';
            statusEl.textContent = ConnectionManager.isConnectedTo(chatId) ? 'Connected' : 'Offline';

            if (contactActionsEl) contactActionsEl.style.display = 'block';
            if (deleteContactBtn) {
                deleteContactBtn.onclick = () => ChatManager.deleteChat(chatId, 'contact');
            }
        } else if (type === 'group') {
            const group = GroupManager.groups[chatId];
            if (!group) return;
            nameEl.textContent = group.name;
            idEl.textContent = `Group ID: ${group.id.substring(6)}`; // Show partial ID
            avatarEl.textContent = '👥';
            avatarEl.className = 'details-avatar group';
            statusEl.textContent = `${group.members.length} member${group.members.length === 1 ? '' : 's'}`;

            if (groupMgmtEl) groupMgmtEl.style.display = 'block';
            if (groupActionsEl) groupActionsEl.style.display = 'block';

            const isOwner = group.owner === UserManager.userId;
            document.getElementById('addGroupMemberArea').style.display = isOwner ? 'block' : 'none';
            const leftMembersAreaEl = document.getElementById('leftMembersArea');
            if (leftMembersAreaEl) {
                leftMembersAreaEl.style.display = isOwner && group.leftMembers && group.leftMembers.length > 0 ? 'block' : 'none';
            }


            if (leaveGroupBtn) {
                if (isOwner) {
                    leaveGroupBtn.style.display = 'none'; // Owner cannot "leave", must dissolve
                } else {
                    leaveGroupBtn.style.display = 'block';
                    leaveGroupBtn.textContent = 'Leave Group';
                    leaveGroupBtn.onclick = () => ChatManager.deleteChat(chatId, 'group'); // Use deleteChat for consistency
                    leaveGroupBtn.disabled = false;
                }
            }
            if (dissolveGroupBtn) {
                dissolveGroupBtn.style.display = isOwner ? 'block' : 'none';
                dissolveGroupBtn.onclick = () => ChatManager.deleteChat(chatId, 'group'); // Use deleteChat
            }
            this.updateDetailsPanelMembers(chatId);
        }
    },

    updateDetailsPanelMembers: function(groupId) {
        const group = GroupManager.groups[groupId];
        if (!group) return;

        const memberListEl = document.getElementById('groupMemberListDetails');
        memberListEl.innerHTML = ''; // Clear previous list
        document.getElementById('groupMemberCount').textContent = group.members.length;

        group.members.forEach(memberId => {
            const member = UserManager.contacts[memberId] || { id: memberId, name: `User ${memberId.substring(0,4)}` };
            const item = document.createElement('div');
            item.className = 'member-item-detail';
            let html = `<span>${Utils.escapeHtml(member.name)} ${memberId === UserManager.userId ? '(You)' : ''}</span>`;
            if (memberId === group.owner) html += '<span class="owner-badge">Owner</span>';
            else if (group.owner === UserManager.userId) { // Only owner can remove
                html += `<button class="remove-member-btn-detail" data-member-id="${memberId}" title="Remove member">✕</button>`;
            }
            item.innerHTML = html;
            memberListEl.appendChild(item);
        });

        // Add event listeners to new remove buttons
        memberListEl.querySelectorAll('.remove-member-btn-detail').forEach(btn => {
            btn.onclick = () => GroupManager.removeMemberFromGroup(groupId, btn.dataset.memberId);
        });

        // Populate contacts dropdown for adding new members
        const contactsDropdown = document.getElementById('contactsDropdownDetails');
        contactsDropdown.innerHTML = '<option value="">Select contact to add...</option>'; // Reset
        Object.values(UserManager.contacts).forEach(contact => {
            if (!group.members.includes(contact.id) && !(group.leftMembers?.find(lm => lm.id === contact.id))) { // Don't show if already member or recently left (handled by re-add)
                const option = document.createElement('option');
                option.value = contact.id;
                option.textContent = contact.name;
                contactsDropdown.appendChild(option);
            }
        });

        // Populate left members list for re-adding
        const leftMemberListEl = document.getElementById('leftMemberListDetails');
        const leftMembersAreaEl = document.getElementById('leftMembersArea');
        leftMemberListEl.innerHTML = '';

        if (group.owner === UserManager.userId && group.leftMembers && group.leftMembers.length > 0) {
            group.leftMembers.forEach(leftMember => {
                const item = document.createElement('div');
                item.className = 'left-member-item-detail';
                item.innerHTML = `
                    <span>${Utils.escapeHtml(leftMember.name)} (Left: ${Utils.formatDate(new Date(leftMember.leftTime))})</span>
                    <button class="re-add-member-btn-detail" data-member-id="${leftMember.id}" data-member-name="${Utils.escapeHtml(leftMember.name)}" title="Re-add member">+</button>
                `;
                leftMemberListEl.appendChild(item);
            });
            leftMemberListEl.querySelectorAll('.re-add-member-btn-detail').forEach(btn => {
                btn.onclick = () => GroupManager.addMemberToGroup(groupId, btn.dataset.memberId, btn.dataset.memberName);
            });
            if (leftMembersAreaEl) leftMembersAreaEl.style.display = 'block';
        } else {
            if (leftMembersAreaEl) leftMembersAreaEl.style.display = 'none';
        }
    },

    handleAddMemberToGroupDetails: function() {
        const groupId = ChatManager.currentChatId;
        const memberSelect = document.getElementById('contactsDropdownDetails');
        const memberId = memberSelect.value;
        const memberName = memberSelect.selectedOptions[0]?.text;

        if (groupId && memberId) {
            GroupManager.addMemberToGroup(groupId, memberId, memberName).then(() => {
                memberSelect.value = ""; // Reset dropdown after adding
            });
        } else {
            UIManager.showNotification("Please select a contact to add.", "warning");
        }
    },

    filterChatList: function(query) {
        ChatManager.renderChatList(ChatManager.currentFilter); // Re-render with current filter and new query
    },

    showFullImage: function(src, altText = "Image") {
        const modal = document.createElement('div');
        modal.className = 'modal-like image-viewer'; // 'modal' for basic styling, 'image-viewer' for specifics
        modal.style.backgroundColor = 'rgba(0,0,0,0.85)'; // Dark semi-transparent background
        modal.style.position = 'fixed';
        modal.style.top = '0';
        modal.style.left = '0';
        modal.style.width = '100%';
        modal.style.height = '100%';
        modal.style.display = 'flex';
        modal.style.alignItems = 'center';
        modal.style.justifyContent = 'center';
        modal.style.zIndex = '1001'; // Above other modals

        const img = document.createElement('img');
        img.src = src;
        img.alt = altText;
        img.style.maxWidth = '90%';
        img.style.maxHeight = '90%';
        img.style.objectFit = 'contain';
        img.style.borderRadius = 'var(--border-radius)';
        img.style.boxShadow = '0 0 30px rgba(0,0,0,0.5)';

        modal.appendChild(img);
        modal.onclick = () => modal.remove(); // Click anywhere on modal to close
        document.body.appendChild(modal);
    },

    updateChatListItemStatus: function(peerId, isConnected) {
        const itemEl = document.querySelector(`.chat-list-item[data-id="${peerId}"]`);
        if (itemEl && itemEl.dataset.type === 'contact') { // Ensure it's a contact item
            const nameEl = itemEl.querySelector('.chat-list-name');
            if (nameEl) {
                let onlineDot = nameEl.querySelector('.online-dot');
                if (isConnected) {
                    if (!onlineDot) { // If dot doesn't exist, create it
                        onlineDot = document.createElement('span');
                        onlineDot.className = 'online-dot';
                        onlineDot.title = "Connected";
                        nameEl.appendChild(onlineDot); // Append dot to the name element
                    }
                    onlineDot.style.display = 'inline-block'; // Ensure it's visible
                } else {
                    if (onlineDot) onlineDot.style.display = 'none'; // Hide if disconnected
                }
            }
            // Also update the status in the main chat header if this is the current chat
            if (ChatManager.currentChatId === peerId) {
                this.updateChatHeaderStatus(isConnected ? 'Connected' : 'Offline');
            }
        }
    },
    showReconnectPrompt: function(peerId, onReconnectSuccess) {
        const chatBox = document.getElementById('chatBox');
        let promptDiv = chatBox.querySelector(`.system-message.reconnect-prompt[data-peer-id="${peerId}"]`);
        const peerName = UserManager.contacts[peerId]?.name || `Peer ${peerId.substring(0,4)}`;

        if (promptDiv) { // If prompt already exists, update its state
            Utils.log(`Reconnect prompt for ${peerId} already visible. Updating text.`, Utils.logLevels.DEBUG);
            const textElement = promptDiv.querySelector('.reconnect-prompt-text');
            if (textElement) textElement.textContent = `Connection to ${peerName} lost.`;
            const recBtn = promptDiv.querySelector('.btn-reconnect-inline');
            if(recBtn) recBtn.disabled = false; // Re-enable button
            return;
        }

        promptDiv = document.createElement('div');
        promptDiv.className = 'system-message reconnect-prompt';
        promptDiv.setAttribute('data-peer-id', peerId);
        promptDiv.innerHTML = `
            <span class="reconnect-prompt-text">Connection to ${peerName} lost.</span>
            <button class="btn-reconnect-inline">Reconnect</button>
            <button class="btn-cancel-reconnect-inline">Dismiss</button>
        `;
        chatBox.appendChild(promptDiv);
        chatBox.scrollTop = chatBox.scrollHeight; // Scroll to make it visible

        const reconnectButton = promptDiv.querySelector('.btn-reconnect-inline');
        const cancelButton = promptDiv.querySelector('.btn-cancel-reconnect-inline');
        const textElement = promptDiv.querySelector('.reconnect-prompt-text');
        let successHandler, failHandler;

        const cleanupPrompt = (removeImmediately = false) => {
            EventEmitter.off('connectionEstablished', successHandler);
            EventEmitter.off('connectionFailed', failHandler);
            if (promptDiv && promptDiv.parentNode) {
                if (removeImmediately) {
                    promptDiv.remove();
                } else {
                    // Delay removal slightly to allow user to read status
                    setTimeout(() => {
                        if (promptDiv && promptDiv.parentNode) promptDiv.remove();
                    }, textElement.textContent.includes("Failed") ? 5000 : 3000);
                }
            }
        };

        successHandler = (connectedPeerId) => {
            if (connectedPeerId === peerId) {
                textElement.textContent = `Reconnected to ${peerName}.`;
                if (reconnectButton) reconnectButton.style.display = 'none'; // Hide reconnect button
                if (cancelButton) {
                    cancelButton.textContent = 'OK';
                    cancelButton.onclick = () => cleanupPrompt(true); // OK button just closes
                }
                if (typeof onReconnectSuccess === 'function') onReconnectSuccess();
                cleanupPrompt(); // Start timed removal
            }
        };

        failHandler = (failedPeerId) => {
            if (failedPeerId === peerId) {
                textElement.textContent = `Failed to reconnect to ${peerName}. Try manual connection or refresh.`;
                if (reconnectButton) {
                    reconnectButton.style.display = 'initial'; // Show button again
                    reconnectButton.disabled = false; // Re-enable
                }
                if (cancelButton) cancelButton.textContent = 'Dismiss';
            }
        };

        EventEmitter.on('connectionEstablished', successHandler);
        EventEmitter.on('connectionFailed', failHandler);

        reconnectButton.onclick = () => {
            textElement.textContent = `Attempting to reconnect to ${peerName}...`;
            reconnectButton.disabled = true; // Disable while attempting
            ConnectionManager.createOffer(peerId, { isSilent: false }); // Attempt non-silent offer
        };
        cancelButton.onclick = () => {
            cleanupPrompt(true); // Dismiss immediately
        };
    },

    showConfirmationModal: function(message, onConfirm, onCancel = null, options = {}) {
        const existingModal = document.getElementById('genericConfirmationModal');
        if (existingModal) {
            existingModal.remove(); // Remove if one already exists
        }

        const modalId = 'genericConfirmationModal';
        const modal = document.createElement('div');
        modal.id = modalId;
        modal.className = 'modal-like confirmation-modal'; // Base class + specific class
        modal.style.display = 'flex'; // Show it

        const modalContent = document.createElement('div');
        modalContent.className = 'modal-content';

        const modalHeader = document.createElement('div');
        modalHeader.className = 'modal-header';
        const titleElement = document.createElement('h2');
        titleElement.textContent = options.title || 'Confirm Action';
        modalHeader.appendChild(titleElement);

        const modalBody = document.createElement('div');
        modalBody.className = 'modal-body';
        const messageParagraph = document.createElement('p');
        messageParagraph.innerHTML = Utils.escapeHtml(message).replace(/\n/g, '<br>'); // Support newlines
        modalBody.appendChild(messageParagraph);

        const modalFooter = document.createElement('div');
        modalFooter.className = 'modal-footer';

        const confirmButton = document.createElement('button');
        confirmButton.textContent = options.confirmText || 'Confirm';
        confirmButton.className = `btn ${options.confirmClass || 'btn-danger'}`; // Default to danger for destructive actions
        confirmButton.onclick = () => {
            if (onConfirm) onConfirm();
            modal.remove(); // Close modal
        };

        const cancelButton = document.createElement('button');
        cancelButton.textContent = options.cancelText || 'Cancel';
        cancelButton.className = `btn ${options.cancelClass || 'btn-secondary'}`; // Default to secondary
        cancelButton.onclick = () => {
            if (onCancel) onCancel();
            modal.remove(); // Close modal
        };

        modalFooter.appendChild(cancelButton); // Cancel first, then confirm (common UI pattern)
        modalFooter.appendChild(confirmButton);

        modalContent.appendChild(modalHeader);
        modalContent.appendChild(modalBody);
        modalContent.appendChild(modalFooter);
        modal.appendChild(modalContent);

        document.body.appendChild(modal);
    }
};