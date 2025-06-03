
const UIManager = {
    isDetailsPanelVisible: false,

    updateResponsiveUI: function() {
        const appContainer = document.querySelector('.app-container');
        if (window.innerWidth <= 768) {
            appContainer.classList.add('mobile-view');
            if (!appContainer.classList.contains('chat-view-active')) {
                this.showChatListArea();
            }
        } else {
            appContainer.classList.remove('mobile-view', 'chat-view-active');
            document.getElementById('sidebarNav').style.display = 'flex';
            document.getElementById('chatArea').style.display = 'flex';
        }
    },

    showChatListArea: function() {
        const appContainer = document.querySelector('.app-container');
        if (appContainer.classList.contains('mobile-view')) {
            appContainer.classList.remove('chat-view-active');
            document.getElementById('sidebarNav').style.display = 'flex';
            document.getElementById('chatArea').style.display = 'none';
        }
        this.toggleDetailsPanel(false);
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
        document.getElementById('currentChatTitleMain').textContent = 'Select a chat';
        document.getElementById('currentChatStatusMain').textContent = '';
        const avatarEl = document.getElementById('currentChatAvatarMain');
        avatarEl.innerHTML = ''; // Clear previous content (text or image)
        avatarEl.className = 'chat-avatar-main'; // Reset class

        const chatBox = document.getElementById('chatBox');
        if (chatBox) {
            chatBox.innerHTML = '';
            chatBox.style.display = 'none'; // Corrected: 'none' not 'hidden'
        } else Utils.log("UIManager.showNoChatSelected: chatBox element NOT FOUND!", Utils.logLevels.ERROR);


        document.getElementById('noChatSelectedScreen').style.display = 'flex';

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

        avatarEl.className = 'chat-avatar-main'; // Reset classes
        if (isGroup) avatarEl.classList.add('group');

        const currentContact = UserManager.contacts[ChatManager.currentChatId];
        let avatarContentHtml = Utils.escapeHtml(avatarText) || Utils.escapeHtml(title).charAt(0).toUpperCase();

        if (currentContact) {
            if (currentContact.isSpecial) {
                avatarEl.classList.add('special-avatar');
            }
            if (currentContact.avatarUrl) { // Check for custom avatar URL
                avatarContentHtml = `<img src="${currentContact.avatarUrl}" alt="${Utils.escapeHtml(title.charAt(0))}" class="avatar-image">`;
            }
        } else if (isGroup) {
            avatarContentHtml = Utils.escapeHtml(avatarText); // Ensure group avatar text is used
        }

        avatarEl.innerHTML = avatarContentHtml;

        document.getElementById('chatDetailsBtnMain').style.display = ChatManager.currentChatId ? 'block' : 'none';
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
            const currentContact = UserManager.contacts[ChatManager.currentChatId];
            if (currentContact && currentContact.isSpecial) {
                this.setCallButtonsState(false); // Special contacts (like AI) generally don't support P2P calls
            } else {
                this.setCallButtonsState(ConnectionManager.isConnectedTo(ChatManager.currentChatId), ChatManager.currentChatId);
            }
        } else {
            this.setCallButtonsState(false);
        }

        if (enabled) {
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
        const currentContact = UserManager.contacts[currentChat];
        const isSpecialChat = currentContact && currentContact.isSpecial; // Check if current chat is with any special contact

        const canShareScreen = !!(navigator.mediaDevices && navigator.mediaDevices.getDisplayMedia);

        const finalEnabledState = enabled && !isGroupChat && !isSpecialChat;

        if (videoCallBtn) videoCallBtn.disabled = !finalEnabledState;
        if (audioCallBtn) audioCallBtn.disabled = !finalEnabledState;
        if (screenShareBtn) screenShareBtn.disabled = !finalEnabledState || !canShareScreen;

        if (finalEnabledState && peerId) {
            videoCallBtn.onclick = () => VideoCallManager.initiateCall(peerId);
            audioCallBtn.onclick = () => VideoCallManager.initiateAudioCall(peerId);
            if (canShareScreen) screenShareBtn.onclick = () => VideoCallManager.initiateScreenShare(peerId);
        } else {
            if (videoCallBtn) videoCallBtn.onclick = null;
            if (audioCallBtn) audioCallBtn.onclick = null;
            if (screenShareBtn) screenShareBtn.onclick = null;
        }
    },

    updateConnectionStatusIndicator: function(message, type = 'info') {
        const statusTextEl = document.getElementById('connectionStatusText');
        const statusContainerEl = document.getElementById('connectionStatusGlobal');

        if (statusTextEl) statusTextEl.textContent = message;
        if (statusContainerEl) {
            statusContainerEl.className = 'status-indicator global'; // Reset classes
            if (type !== 'info') {
                statusContainerEl.classList.add(`status-${type}`); // Add specific type class
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

        // Determine overall quality based on network and WebSocket status
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

        qualityIndicator.className = `quality-indicator ${qualityClass}`; // Reset and set class
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

    showNotification: function(message, type = 'info') { // type: 'info', 'success', 'warning', 'error'
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
            }, 300); // Match CSS transition
        };

        notification.querySelector('.notification-close').onclick = removeNotification;
        setTimeout(removeNotification, type === 'error' ? 8000 : 5000); // Longer display for errors
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

    setActiveTab: function(tabName) { // tabName: 'all', 'contacts', 'groups'
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
                this.isDetailsPanelVisible = false; // Ensure flag is correct
                return; // Don't show if no chat selected
            }
            detailsPanel.style.display = 'flex';
            appContainer.classList.add('show-details');
            this.updateDetailsPanel(ChatManager.currentChatId, ChatManager.currentChatId.startsWith('group_') ? 'group' : 'contact');
        } else {
            appContainer.classList.remove('show-details');
            // Delay hiding to allow for CSS transition if any (not strictly necessary for 'display:none')
            setTimeout(() => {
                if (!this.isDetailsPanelVisible) detailsPanel.style.display = 'none';
            }, 300); // Adjust time if CSS transitions are added to panel visibility
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

        // AI "About" section elements
        const aiContactAboutSectionEl = document.getElementById('aiContactAboutSection');
        const aiContactAboutNameEl = document.getElementById('aiContactAboutName');
        const aiContactBasicInfoListEl = document.getElementById('aiContactBasicInfoList');
        const aiContactAboutNameSubEl = document.getElementById('aiContactAboutNameSub');
        const aiContactAboutTextEl = document.getElementById('aiContactAboutText');


        if(contactActionsEl) contactActionsEl.style.display = 'none';
        if(groupMgmtEl) groupMgmtEl.style.display = 'none';
        if(groupActionsEl) groupActionsEl.style.display = 'none';
        if(aiContactAboutSectionEl) aiContactAboutSectionEl.style.display = 'none'; // Hide AI section by default


        if (type === 'contact') {
            const contact = UserManager.contacts[chatId];
            if (!contact) return;
            nameEl.textContent = contact.name;
            idEl.textContent = `ID: ${contact.id}`;

            avatarEl.className = 'details-avatar'; // Reset
            let avatarContentHtml = Utils.escapeHtml(contact.avatarText || contact.name.charAt(0).toUpperCase());
            if (contact.isSpecial) avatarEl.classList.add('special-avatar');
            if (contact.avatarUrl) {
                avatarContentHtml = `<img src="${contact.avatarUrl}" alt="${Utils.escapeHtml(contact.name.charAt(0))}" class="avatar-image">`;
            }
            avatarEl.innerHTML = avatarContentHtml;


            if (contact.isSpecial) {
                statusEl.textContent = (contact.isAI ? 'AI Assistant' : 'Special Contact') + ' - Always available';
                if(contactActionsEl) contactActionsEl.style.display = 'none'; // No actions for special contacts

                // Show and populate AI "About" section if details exist
                if (contact.isAI && contact.aboutDetails && aiContactAboutSectionEl) {
                    aiContactAboutSectionEl.style.display = 'block';
                    if (aiContactAboutNameEl) aiContactAboutNameEl.textContent = contact.aboutDetails.nameForAbout || contact.name;
                    if (aiContactAboutNameSubEl) aiContactAboutNameSubEl.textContent = contact.aboutDetails.nameForAbout || contact.name;

                    if (aiContactBasicInfoListEl) {
                        aiContactBasicInfoListEl.innerHTML = ''; // Clear previous
                        contact.aboutDetails.basicInfo.forEach(info => {
                            const li = document.createElement('li');
                            li.innerHTML = `<strong>${Utils.escapeHtml(info.label)}:</strong> ${Utils.escapeHtml(info.value)}`;
                            aiContactBasicInfoListEl.appendChild(li);
                        });
                    }
                    if (aiContactAboutTextEl) {
                        aiContactAboutTextEl.textContent = contact.aboutDetails.aboutText;
                    }
                }

            } else {
                statusEl.textContent = ConnectionManager.isConnectedTo(chatId) ? 'Connected' : 'Offline';
                if(contactActionsEl) contactActionsEl.style.display = 'block';
                if(deleteContactBtn) deleteContactBtn.onclick = () => ChatManager.deleteChat(chatId, 'contact');
            }

        } else if (type === 'group') {
            const group = GroupManager.groups[chatId];
            if (!group) return;
            nameEl.textContent = group.name;
            idEl.textContent = `Group ID: ${group.id.substring(6)}`; // Show partial ID
            avatarEl.innerHTML = '👥'; // Groups use text avatar
            avatarEl.className = 'details-avatar group'; // Reset and add group class
            statusEl.textContent = `${group.members.length} member${group.members.length === 1 ? '' : 's'}`;

            if(groupMgmtEl) groupMgmtEl.style.display = 'block';
            if(groupActionsEl) groupActionsEl.style.display = 'block';


            const isOwner = group.owner === UserManager.userId;
            document.getElementById('addGroupMemberArea').style.display = isOwner ? 'block' : 'none';
            const leftMembersAreaEl = document.getElementById('leftMembersArea');
            if(leftMembersAreaEl) leftMembersAreaEl.style.display = isOwner && group.leftMembers && group.leftMembers.length > 0 ? 'block' : 'none';

            if (leaveGroupBtn) {
                if (isOwner) {
                    leaveGroupBtn.style.display = 'none'; // Owner uses dissolve, not leave
                } else {
                    leaveGroupBtn.style.display = 'block';
                    leaveGroupBtn.textContent = 'Leave Group';
                    leaveGroupBtn.onclick = () => ChatManager.deleteChat(chatId, 'group'); // deleteChat handles leave for non-owners
                    leaveGroupBtn.disabled = false;
                }
            }
            if (dissolveGroupBtn) {
                dissolveGroupBtn.style.display = isOwner ? 'block' : 'none';
                dissolveGroupBtn.onclick = () => ChatManager.deleteChat(chatId, 'group'); // deleteChat handles dissolve for owners
            }
            this.updateDetailsPanelMembers(chatId);
            if (aiContactAboutSectionEl) aiContactAboutSectionEl.style.display = 'none'; // Hide AI section for groups
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
            else if (group.owner === UserManager.userId) { // Only owner can remove
                html += `<button class="remove-member-btn-detail" data-member-id="${memberId}" title="Remove member">✕</button>`;
            }
            item.innerHTML = html;
            memberListEl.appendChild(item);
        });

        memberListEl.querySelectorAll('.remove-member-btn-detail').forEach(btn => {
            btn.onclick = () => GroupManager.removeMemberFromGroup(groupId, btn.dataset.memberId);
        });

        // Populate contacts dropdown for adding new members
        const contactsDropdown = document.getElementById('contactsDropdownDetails');
        contactsDropdown.innerHTML = '<option value="">Select contact to add...</option>';
        Object.values(UserManager.contacts).forEach(contact => {
            // Exclude already members, left members, and special AI contacts
            if (!group.members.includes(contact.id) &&
                !(group.leftMembers?.find(lm => lm.id === contact.id)) &&
                !(contact.isSpecial && contact.isAI)) { // Don't add AI contacts to groups
                const option = document.createElement('option');
                option.value = contact.id;
                option.textContent = contact.name;
                contactsDropdown.appendChild(option);
            }
        });

        // Populate left members list
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
            if(leftMembersAreaEl) leftMembersAreaEl.style.display = 'block';
        } else {
            if(leftMembersAreaEl) leftMembersAreaEl.style.display = 'none';
        }
    },

    handleAddMemberToGroupDetails: function() {
        const groupId = ChatManager.currentChatId;
        const memberSelect = document.getElementById('contactsDropdownDetails');
        const memberId = memberSelect.value;
        const memberName = memberSelect.selectedOptions[0]?.text;

        if (groupId && memberId) {
            GroupManager.addMemberToGroup(groupId, memberId, memberName).then(success => {
                if (success) memberSelect.value = ""; // Reset dropdown on success
            });
        } else {
            UIManager.showNotification("Please select a contact to add.", "warning");
        }
    },

    filterChatList: function(query) {
        // The actual filtering logic is inside ChatManager.renderChatList
        // This function just triggers a re-render
        ChatManager.renderChatList(ChatManager.currentFilter);
    },

    showFullImage: function(src, altText = "Image") {
        const modal = document.createElement('div');
        modal.className = 'modal-like image-viewer'; // Use a class for styling if needed
        modal.style.backgroundColor = 'rgba(0,0,0,0.85)';
        modal.style.position = 'fixed';
        modal.style.top = '0';
        modal.style.left = '0';
        modal.style.width = '100%';
        modal.style.height = '100%';
        modal.style.display = 'flex';
        modal.style.alignItems = 'center';
        modal.style.justifyContent = 'center';
        modal.style.zIndex = '1001'; // Ensure it's above other modals potentially

        const img = document.createElement('img');
        img.src = src;
        img.alt = altText;
        img.style.maxWidth = '90%';
        img.style.maxHeight = '90%';
        img.style.objectFit = 'contain'; // Important for image aspect ratio
        img.style.borderRadius = 'var(--border-radius)';
        img.style.boxShadow = '0 0 30px rgba(0,0,0,0.5)';

        modal.appendChild(img);
        modal.onclick = () => modal.remove(); // Click anywhere on modal to close
        document.body.appendChild(modal);
    },

    updateChatListItemStatus: function(peerId, isConnected) {
        const itemEl = document.querySelector(`.chat-list-item[data-id="${peerId}"]`);
        if (itemEl && itemEl.dataset.type === 'contact') {
            // Do not update for special contacts, as their "online" status is fixed or conceptual
            if (UserManager.isSpecialContact(peerId)) return;

            const nameEl = itemEl.querySelector('.chat-list-name');
            if (nameEl) {
                let onlineDot = nameEl.querySelector('.online-dot');
                if (isConnected) {
                    if (!onlineDot) {
                        onlineDot = document.createElement('span');
                        onlineDot.className = 'online-dot';
                        onlineDot.title = "Connected";
                        nameEl.appendChild(onlineDot); // Append to name element
                    }
                    onlineDot.style.display = 'inline-block'; // Ensure visible
                } else {
                    if (onlineDot) onlineDot.style.display = 'none'; // Hide if not connected
                }
            }
            // Update header if this peer is the current chat
            if (ChatManager.currentChatId === peerId) {
                this.updateChatHeaderStatus(isConnected ? 'Connected' : 'Offline');
            }
        }
    },
    showReconnectPrompt: function(peerId, onReconnectSuccess) {
        const chatBox = document.getElementById('chatBox');
        let promptDiv = chatBox.querySelector(`.system-message.reconnect-prompt[data-peer-id="${peerId}"]`);
        const peerName = UserManager.contacts[peerId]?.name || `Peer ${peerId.substring(0,4)}`;

        if (promptDiv) { // Prompt already exists, update it
            Utils.log(`Reconnect prompt for ${peerId} already visible. Updating text.`, Utils.logLevels.DEBUG);
            const textElement = promptDiv.querySelector('.reconnect-prompt-text');
            if (textElement) textElement.textContent = `Connection to ${peerName} lost.`;
            const recBtn = promptDiv.querySelector('.btn-reconnect-inline');
            if(recBtn) recBtn.disabled = false; // Re-enable button if it was disabled
            return;
        }

        promptDiv = document.createElement('div');
        promptDiv.className = 'system-message reconnect-prompt'; // Use system-message for consistent styling
        promptDiv.setAttribute('data-peer-id', peerId);
        promptDiv.innerHTML = `
            <span class="reconnect-prompt-text">Connection to ${peerName} lost.</span>
            <button class="btn-reconnect-inline">Reconnect</button>
            <button class="btn-cancel-reconnect-inline">Dismiss</button>
        `;
        chatBox.appendChild(promptDiv);
        chatBox.scrollTop = chatBox.scrollHeight; // Scroll to show prompt

        const reconnectButton = promptDiv.querySelector('.btn-reconnect-inline');
        const cancelButton = promptDiv.querySelector('.btn-cancel-reconnect-inline');
        const textElement = promptDiv.querySelector('.reconnect-prompt-text');
        let successHandler, failHandler;

        const cleanupPrompt = (removeImmediately = false) => {
            EventEmitter.off('connectionEstablished', successHandler);
            EventEmitter.off('connectionFailed', failHandler);
            if (promptDiv && promptDiv.parentNode) {
                if(removeImmediately){
                    promptDiv.remove();
                } else {
                    setTimeout(() => { // Delay removal to let user see status message
                        if (promptDiv && promptDiv.parentNode) promptDiv.remove();
                    }, textElement.textContent.includes("Failed") ? 5000 : 3000); // Longer for failure message
                }
            }
        };

        successHandler = (connectedPeerId) => {
            if (connectedPeerId === peerId) {
                textElement.textContent = `Reconnected to ${peerName}.`;
                if (reconnectButton) reconnectButton.style.display = 'none'; // Hide reconnect button
                if (cancelButton) {
                    cancelButton.textContent = 'OK'; // Change dismiss to OK
                    cancelButton.onclick = () => cleanupPrompt(true); // OK now dismisses immediately
                }
                if (typeof onReconnectSuccess === 'function') onReconnectSuccess();
                cleanupPrompt(); // Schedule removal
            }
        };

        failHandler = (failedPeerId) => {
            if (failedPeerId === peerId) {
                textElement.textContent = `Failed to reconnect to ${peerName}. Try manual connection or refresh.`;
                if (reconnectButton) {
                    reconnectButton.style.display = 'initial'; // Ensure visible
                    reconnectButton.disabled = false; // Re-enable
                }
                if(cancelButton) cancelButton.textContent = 'Dismiss'; // Keep as dismiss
            }
        };

        EventEmitter.on('connectionEstablished', successHandler);
        EventEmitter.on('connectionFailed', failHandler);

        reconnectButton.onclick = () => {
            textElement.textContent = `Attempting to reconnect to ${peerName}...`;
            reconnectButton.disabled = true;
            ConnectionManager.createOffer(peerId, { isSilent: false }); // Not silent, as user initiated
        };
        cancelButton.onclick = () => {
            cleanupPrompt(true); // Immediate removal on dismiss
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
        modal.className = 'modal-like confirmation-modal'; // General modal class + specific
        modal.style.display = 'flex'; // Show it

        const modalContent = document.createElement('div');
        modalContent.className = 'modal-content';

        const modalHeader = document.createElement('div');
        modalHeader.className = 'modal-header';
        const titleElement = document.createElement('h2');
        titleElement.textContent = options.title || 'Confirm Action';
        modalHeader.appendChild(titleElement);
        // Optionally add close button to header if needed:
        // const closeBtn = document.createElement('button'); closeBtn.className = 'icon-btn close-modal-btn'; closeBtn.innerHTML = '✕';
        // closeBtn.onclick = () => { if (onCancel) onCancel(); modal.remove(); }; modalHeader.appendChild(closeBtn);

        const modalBody = document.createElement('div');
        modalBody.className = 'modal-body';
        const messageParagraph = document.createElement('p');
        messageParagraph.innerHTML = Utils.escapeHtml(message).replace(/\n/g, '<br>'); // Support newlines in message
        modalBody.appendChild(messageParagraph);

        const modalFooter = document.createElement('div');
        modalFooter.className = 'modal-footer';

        const confirmButton = document.createElement('button');
        confirmButton.textContent = options.confirmText || 'Confirm';
        confirmButton.className = `btn ${options.confirmClass || 'btn-danger'}`; // Default to danger for confirm
        confirmButton.onclick = () => {
            if (onConfirm) onConfirm();
            modal.remove();
        };

        const cancelButton = document.createElement('button');
        cancelButton.textContent = options.cancelText || 'Cancel';
        cancelButton.className = `btn ${options.cancelClass || 'btn-secondary'}`; // Default to secondary for cancel
        cancelButton.onclick = () => {
            if (onCancel) onCancel();
            modal.remove();
        };

        modalFooter.appendChild(cancelButton); // Typically cancel on left
        modalFooter.appendChild(confirmButton); // Confirm on right

        modalContent.appendChild(modalHeader);
        modalContent.appendChild(modalBody);
        modalContent.appendChild(modalFooter);
        modal.appendChild(modalContent);

        document.body.appendChild(modal);
    },

    showCallingModal: function(peerName, onCancelCall, onStopMusicOnly, callType) {
        const modal = document.getElementById('callingModal');
        const titleEl = document.getElementById('callingModalTitle');
        const textEl = document.getElementById('callingModalText');
        const avatarEl = document.getElementById('callingModalAvatar');
        const cancelBtn = document.getElementById('callingModalCancelBtn');

        if (!modal || !titleEl || !textEl || !avatarEl || !cancelBtn) {
            Utils.log("Calling modal elements not found!", Utils.logLevels.ERROR);
            return;
        }

        titleEl.textContent = `${callType}...`;
        textEl.textContent = `Contacting ${Utils.escapeHtml(peerName)}...`;

        // Avatar logic for calling modal
        let avatarContentHtml = (Utils.escapeHtml(peerName).charAt(0) || 'P').toUpperCase();
        const peerContact = UserManager.contacts[VideoCallManager.currentPeerId]; // Assuming VideoCallManager.currentPeerId is set
        if (peerContact && peerContact.avatarUrl) {
            avatarContentHtml = `<img src="${peerContact.avatarUrl}" alt="${Utils.escapeHtml(peerName.charAt(0))}" class="avatar-image">`;
        }
        avatarEl.innerHTML = avatarContentHtml;


        cancelBtn.onclick = onCancelCall; // Set the cancel action

        modal.style.display = 'flex'; // Show the modal
    },

    hideCallingModal: function() {
        const modal = document.getElementById('callingModal');
        if (modal && modal.style.display !== 'none') {
            modal.style.display = 'none';
            const cancelBtn = document.getElementById('callingModalCancelBtn');
            if (cancelBtn) cancelBtn.onclick = null; // Clear the onclick handler
        }
    }
};