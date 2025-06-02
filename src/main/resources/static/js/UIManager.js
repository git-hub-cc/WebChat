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
                return; // Cannot proceed if chatArea is missing
            }
        } else if (chatAreaEl) {
            // Ensure chatArea is visible on desktop if it was hidden by other logic
            chatAreaEl.style.display = 'flex';
        } else {
            Utils.log("UIManager.showChatArea: Critical error - chatArea element NOT FOUND! (desktop mode)", Utils.logLevels.ERROR);
            return; // Cannot proceed if chatArea is missing
        }

        const noChatSelectedScreen = document.getElementById('noChatSelectedScreen');
        if (noChatSelectedScreen) {
            noChatSelectedScreen.style.display = 'none';
        } else {
            Utils.log("UIManager.showChatArea: noChatSelectedScreen element not found. This might be ok if a chat is already selected.", Utils.logLevels.WARN);
        }

        const chatBox = document.getElementById('chatBox');
        if (chatBox) {
            chatBox.style.display = 'flex'; // Ensure chatBox itself is visible
        } else {
            Utils.log("UIManager.showChatArea: chatBox element NOT FOUND! This is a critical issue.", Utils.logLevels.ERROR);
            // Log parent state for debugging
            if (chatAreaEl) {
                Utils.log("UIManager.showChatArea: Parent 'chatArea' exists. 'chatBox' is missing within it.", Utils.logLevels.DEBUG);
            }
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
            chatBox.innerHTML = ''; // Clear messages
            chatBox.style.display = 'hidden'; // Hide message area
        } else {
            Utils.log("UIManager.showNoChatSelected: chatBox element NOT FOUND!", Utils.logLevels.ERROR);
        }

        const noChatSelectedScreen = document.getElementById('noChatSelectedScreen');
        if (noChatSelectedScreen) {
            noChatSelectedScreen.style.display = 'flex'; // Show placeholder
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
        document.getElementById('currentChatTitleMain').textContent = title;
        document.getElementById('currentChatStatusMain').textContent = status;
        const avatarEl = document.getElementById('currentChatAvatarMain');
        avatarEl.textContent = avatarText || title.charAt(0).toUpperCase();
        avatarEl.className = 'chat-avatar-main'; // Reset classes
        if (isGroup) avatarEl.classList.add('group');

        const detailsBtn = document.getElementById('chatDetailsBtnMain');
        detailsBtn.style.display = ChatManager.currentChatId ? 'block' : 'none';
    },

    updateChatHeaderStatus: function(statusText) {
        const statusEl = document.getElementById('currentChatStatusMain');
        if (statusEl) statusEl.textContent = statusText;
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
            this.setCallButtonsState(false);
        }

        if (enabled) {
            setTimeout(() => document.getElementById('messageInput').focus(), 100);
        }
    },

    setCallButtonsState(enabled, peerId = null) {
        const videoCallBtn = document.getElementById('videoCallButtonMain');
        const audioCallBtn = document.getElementById('audioCallButtonMain');
        const screenShareBtn = document.getElementById('screenShareButtonMain');

        const isGroupChat = ChatManager.currentChatId?.startsWith('group_');
        // Check if getDisplayMedia API is available
        const canShareScreen = !!(navigator.mediaDevices && navigator.mediaDevices.getDisplayMedia);

        if (videoCallBtn) videoCallBtn.disabled = !enabled || isGroupChat;
        if (audioCallBtn) audioCallBtn.disabled = !enabled || isGroupChat;
        if (screenShareBtn) screenShareBtn.disabled = !enabled || isGroupChat || !canShareScreen;

        if (enabled && peerId && !isGroupChat) {
            videoCallBtn.onclick = () => VideoCallManager.initiateCall(peerId);
            audioCallBtn.onclick = () => VideoCallManager.initiateAudioCall(peerId);
            if (canShareScreen) screenShareBtn.onclick = () => VideoCallManager.initiateScreenShare(peerId);
        }
    },

    updateConnectionStatusIndicator: function(message, type = 'info') {
        const statusTextEl = document.getElementById('connectionStatusText');
        const statusContainerEl = document.getElementById('connectionStatusGlobal');

        if (statusTextEl) statusTextEl.textContent = message;
        if (statusContainerEl) {
            statusContainerEl.className = 'status-indicator';
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
            this.updateNetworkInfoDisplay(null, ConnectionManager.isWebSocketConnected);
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
                if (container.children.length === 0) container.remove();
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
    copySdpTextFromModal: function() {
        const sdpText = document.getElementById('modalSdpText').value;
        if (sdpText) {
            navigator.clipboard.writeText(sdpText)
                .then(() => this.showNotification('Connection Info copied!', 'success'))
                .catch(() => this.showNotification('Failed to copy info.', 'error'));
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
            if (!ChatManager.currentChatId) {
                this.isDetailsPanelVisible = false;
                return;
            }
            detailsPanel.style.display = 'flex';
            appContainer.classList.add('show-details');
            this.updateDetailsPanel(ChatManager.currentChatId, ChatManager.currentChatId.startsWith('group_') ? 'group' : 'contact');
        } else {
            appContainer.classList.remove('show-details');
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
            idEl.textContent = `Group ID: ${group.id.substring(6)}`;
            avatarEl.textContent = '👥';
            avatarEl.className = 'details-avatar group';
            statusEl.textContent = `${group.members.length} members`;

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
                    leaveGroupBtn.style.display = 'none';
                } else {
                    leaveGroupBtn.style.display = 'block';
                    leaveGroupBtn.textContent = 'Leave Group';
                    leaveGroupBtn.onclick = () => GroupManager.leaveGroup(chatId);
                    leaveGroupBtn.disabled = false;
                }
            }
            if (dissolveGroupBtn) {
                dissolveGroupBtn.style.display = isOwner ? 'block' : 'none';
                dissolveGroupBtn.onclick = () => GroupManager.dissolveGroup(chatId);
            }
            this.updateDetailsPanelMembers(chatId);
        }
    },

    updateDetailsPanelMembers: function(groupId) {
        const group = GroupManager.groups[groupId];
        if (!group) return;

        const memberListEl = document.getElementById('groupMemberListDetails');
        memberListEl.innerHTML = '';
        document.getElementById('groupMemberCount').textContent = group.members.length;

        group.members.forEach(memberId => {
            const member = UserManager.contacts[memberId] || { id: memberId, name: `User ${memberId.substring(0,4)}` };
            const item = document.createElement('div');
            item.className = 'member-item-detail';
            let html = `<span>${Utils.escapeHtml(member.name)} ${memberId === UserManager.userId ? '(You)' : ''}</span>`;
            if (memberId === group.owner) html += '<span class="owner-badge">Owner</span>';
            else if (group.owner === UserManager.userId) {
                html += `<button class="remove-member-btn-detail" data-member-id="${memberId}" title="Remove member">✕</button>`;
            }
            item.innerHTML = html;
            memberListEl.appendChild(item);
        });

        memberListEl.querySelectorAll('.remove-member-btn-detail').forEach(btn => {
            btn.onclick = () => GroupManager.removeMemberFromGroup(groupId, btn.dataset.memberId);
        });

        const contactsDropdown = document.getElementById('contactsDropdownDetails');
        contactsDropdown.innerHTML = '<option value="">Select contact to add...</option>';
        Object.values(UserManager.contacts).forEach(contact => {
            if (!group.members.includes(contact.id)) {
                const option = document.createElement('option');
                option.value = contact.id;
                option.textContent = contact.name;
                contactsDropdown.appendChild(option);
            }
        });

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
        const memberId = document.getElementById('contactsDropdownDetails').value;
        const memberName = document.getElementById('contactsDropdownDetails').selectedOptions[0]?.text;
        if (groupId && memberId) {
            GroupManager.addMemberToGroup(groupId, memberId, memberName);
        } else {
            UIManager.showNotification("Please select a contact to add.", "warning");
        }
    },

    filterChatList: function(query) {
        ChatManager.renderChatList(ChatManager.currentFilter);
    },

    showFullImage: function(src, altText = "Image") {
        const modal = document.createElement('div');
        modal.className = 'modal-like image-viewer';
        modal.style.backgroundColor = 'rgba(0,0,0,0.85)';

        const img = document.createElement('img');
        img.src = src;
        img.alt = altText;
        img.style.maxWidth = '90%';
        img.style.maxHeight = '90%';
        img.style.objectFit = 'contain';
        img.style.borderRadius = 'var(--border-radius)';
        img.style.boxShadow = '0 0 30px rgba(0,0,0,0.5)';

        modal.appendChild(img);
        modal.onclick = () => modal.remove();
        document.body.appendChild(modal);
    },

    updateChatListItemStatus: function(peerId, isConnected) {
        const itemEl = document.querySelector(`.chat-list-item[data-id="${peerId}"]`);
        if (itemEl && itemEl.dataset.type === 'contact') {
            const nameEl = itemEl.querySelector('.chat-list-name');
            if (nameEl) {
                let onlineDot = nameEl.querySelector('.online-dot');
                if (isConnected) {
                    if (!onlineDot) {
                        onlineDot = document.createElement('span');
                        onlineDot.className = 'online-dot';
                        onlineDot.title = "Connected";
                        nameEl.appendChild(onlineDot);
                    }
                    onlineDot.style.display = 'inline-block';
                } else {
                    if (onlineDot) onlineDot.style.display = 'none';
                }
            }
            if (ChatManager.currentChatId === peerId) {
                this.updateChatHeaderStatus(isConnected ? 'Connected' : 'Offline');
            }
        }
    },
    showReconnectPrompt: function(peerId, onReconnectSuccess) {
        const chatBox = document.getElementById('chatBox');
        let promptDiv = chatBox.querySelector(`.system-message.reconnect-prompt[data-peer-id="${peerId}"]`);
        const peerName = UserManager.contacts[peerId]?.name || `Peer ${peerId.substring(0,4)}`;

        if (promptDiv) {
            Utils.log(`Reconnect prompt for ${peerId} already visible. Updating text.`, Utils.logLevels.DEBUG);
            promptDiv.querySelector('.reconnect-prompt-text').textContent = `Connection to ${peerName} lost.`;
            const recBtn = promptDiv.querySelector('.btn-reconnect-inline');
            if(recBtn) recBtn.disabled = false;
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
        chatBox.scrollTop = chatBox.scrollHeight;

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
                    setTimeout(() => {
                        if (promptDiv && promptDiv.parentNode) promptDiv.remove();
                    }, textElement.textContent.includes("Failed") ? 5000 : 3000);
                }
            }
        };

        successHandler = (connectedPeerId) => {
            if (connectedPeerId === peerId) {
                textElement.textContent = `Reconnected to ${peerName}.`;
                if (reconnectButton) reconnectButton.style.display = 'none';
                if (cancelButton) {
                    cancelButton.textContent = 'OK';
                    cancelButton.onclick = () => cleanupPrompt(true);
                }
                if (typeof onReconnectSuccess === 'function') onReconnectSuccess();
                cleanupPrompt();
            }
        };

        failHandler = (failedPeerId) => {
            if (failedPeerId === peerId) {
                textElement.textContent = `Failed to reconnect to ${peerName}. Try manual connection or refresh.`;
                if (reconnectButton) {
                    reconnectButton.style.display = 'initial';
                    reconnectButton.disabled = false;
                }
                if (cancelButton) cancelButton.textContent = 'Dismiss';
            }
        };

        EventEmitter.on('connectionEstablished', successHandler);
        EventEmitter.on('connectionFailed', failHandler);

        reconnectButton.onclick = () => {
            textElement.textContent = `Attempting to reconnect to ${peerName}...`;
            reconnectButton.disabled = true;
            ConnectionManager.createOffer(peerId, { isSilent: false });
        };
        cancelButton.onclick = () => {
            cleanupPrompt(true);
        };
    },

    showConfirmationModal: function(message, onConfirm, onCancel = null, options = {}) {
        const existingModal = document.getElementById('genericConfirmationModal');
        if (existingModal) {
            existingModal.remove();
        }

        const modalId = 'genericConfirmationModal';
        const modal = document.createElement('div');
        modal.id = modalId;
        modal.className = 'modal-like confirmation-modal';
        modal.style.display = 'flex';

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
        messageParagraph.textContent = message;
        modalBody.appendChild(messageParagraph);

        const modalFooter = document.createElement('div');
        modalFooter.className = 'modal-footer';

        const confirmButton = document.createElement('button');
        confirmButton.textContent = options.confirmText || 'Confirm';
        confirmButton.className = `btn ${options.confirmClass || 'btn-danger'}`;
        confirmButton.onclick = () => {
            if (onConfirm) onConfirm();
            modal.remove();
        };

        const cancelButton = document.createElement('button');
        cancelButton.textContent = options.cancelText || 'Cancel';
        cancelButton.className = `btn ${options.cancelClass || 'btn-secondary'}`;
        cancelButton.onclick = () => {
            if (onCancel) onCancel();
            modal.remove();
        };

        modalFooter.appendChild(cancelButton);
        modalFooter.appendChild(confirmButton);

        modalContent.appendChild(modalHeader);
        modalContent.appendChild(modalBody);
        modalContent.appendChild(modalFooter);
        modal.appendChild(modalContent);

        document.body.appendChild(modal);
    }
};