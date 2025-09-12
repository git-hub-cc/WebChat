import { defineStore } from 'pinia';
import { ref } from 'vue';
import { dbService } from '@/services/dbService';
import { eventBus } from '@/services/eventBus';
import { useUserStore } from './userStore';
import { useChatStore } from './chatStore';
import { generateId, log } from '@/utils';
import { webrtcService } from '@/services/webrtcService';
import AppSettings from '@/config/AppSettings';

export const useGroupStore = defineStore('group', () => {
    const groups = ref({});

    async function init() {
        const groupItems = await dbService.getAllItems('groups');
        const groupsMap = {};
        groupItems.forEach(g => {
            groupsMap[g.id] = { type: 'group', aiPrompts: {}, ...g };
        });
        groups.value = groupsMap;
        log('群组Store已初始化', 'INFO');
        eventBus.on('webrtc:message', handleIncomingGroupMessage);
    }

    async function updateGroupAiPrompt(groupId, aiMemberId, newPrompt) {
        const group = groups.value[groupId];
        const userStore = useUserStore();
        if (group && group.owner === userStore.userId) {
            if (!group.aiPrompts) group.aiPrompts = {};
            group.aiPrompts[aiMemberId] = newPrompt;
            await dbService.setItem('groups', group);
            broadcastMessage(groupId, {
                type: 'group-ai-prompt-updated',
                aiMemberId,
                newPrompt,
            });
            eventBus.emit('showNotification', { message: 'AI 行为指示已更新', type: 'success' });
        }
    }

    async function createGroup(name, customGroupId = null) {
        const userStore = useUserStore();
        const finalGroupId = customGroupId ? `group_${customGroupId}` : `group_${generateId()}`;
        if (groups.value[finalGroupId]) {
            if (groups.value[finalGroupId].owner === userStore.userId) {
                groups.value[finalGroupId].name = name;
                await dbService.setItem('groups', groups.value[finalGroupId]);
                broadcastMessage(finalGroupId, { type: 'group-name-changed', newName: name });
                eventBus.emit('showNotification', { message: '群组名称已更新', type: 'success' });
                return finalGroupId;
            } else {
                eventBus.emit('showNotification', { message: '您不是该群组的群主', type: 'error' });
                return null;
            }
        }
        const newGroup = {
            id: finalGroupId, name, owner: userStore.userId, members: [userStore.userId],
            lastTime: new Date().toISOString(), unread: 0, aiPrompts: {}, type: 'group'
        };
        groups.value[finalGroupId] = newGroup;
        await dbService.setItem('groups', newGroup);
        return finalGroupId;
    }

    // --- START OF MODIFICATION: Refined addMemberToGroup with connection checks ---
    async function addMemberToGroup(groupId, memberId) {
        const group = groups.value[groupId];
        const userStore = useUserStore();

        if (!group || group.owner !== userStore.userId) return false;
        if (group.members.length >= AppSettings.chat.maxGroupMembers) {
            eventBus.emit('showNotification', { message: `群组已满 (上限 ${AppSettings.chat.maxGroupMembers} 人)`, type: 'warning' });
            return false;
        }
        if (group.members.includes(memberId)) return true;

        const addedMemberDetails = userStore.contacts[memberId];

        // For human users, check connection status before adding
        if (!addedMemberDetails?.isAI) {
            const status = userStore.getContactCombinedStatus(memberId);
            const memberName = addedMemberDetails?.name || `用户 ${memberId.substring(0,4)}`;

            if (!status.isLobbyOnline) {
                eventBus.emit('showNotification', { message: `${memberName} 不在线，无法添加。`, type: 'error' });
                return false;
            }
            if (!status.isConnected) {
                eventBus.emit('showNotification', { message: `正在尝试与 ${memberName} 建立连接，请稍后重试...`, type: 'info' });
                // Proactively try to establish a connection
                webrtcService.createOffer(memberId, { isSilent: false });
                return false;
            }
        }

        // --- If checks pass, proceed with adding ---
        group.members.push(memberId);

        broadcastMessage(groupId, {
            type: 'group-member-added',
            addedMemberId: memberId,
            addedMemberDetails: JSON.parse(JSON.stringify(addedMemberDetails)),
            allMembers: group.members
        }, { excludeIds: [memberId] });

        // Only send a P2P join command to human users
        if (!addedMemberDetails?.isAI) {
            webrtcService.sendMessage(memberId, {
                type: 'group-join',
                group: JSON.parse(JSON.stringify(groups.value[groupId]))
            });
        }

        await dbService.setItem('groups', group);
        eventBus.emit('showNotification', { message: `${addedMemberDetails.name} 已加入群组`, type: 'success' });
        return true;
    }
    // --- END OF MODIFICATION ---

    async function removeMemberFromGroup(groupId, memberId) {
        const group = groups.value[groupId];
        const userStore = useUserStore();
        if (!group || group.owner !== userStore.userId || memberId === userStore.userId) return false;
        const index = group.members.indexOf(memberId);
        if (index > -1) {
            group.members.splice(index, 1);
            if (group.aiPrompts?.[memberId]) {
                delete group.aiPrompts[memberId];
            }
            broadcastMessage(groupId, {
                type: 'group-member-removed',
                removedMemberId: memberId,
                allMembers: group.members
            }, { excludeIds: [memberId] });

            if (!userStore.contacts[memberId]?.isAI) {
                // Use signaling for critical removal notice
                webrtcService.sendViaSignaling(memberId, { type: 'group-removed-you', groupId });
            }

            await dbService.setItem('groups', group);
            return true;
        }
        return false;
    }

    async function leaveGroup(groupId) {
        const group = groups.value[groupId];
        const userStore = useUserStore();
        const userId = userStore.userId;
        if (!group || !group.members.includes(userId) || group.owner === userId) return false;
        const updatedMembers = group.members.filter(id => id !== userId);
        broadcastMessage(groupId, {
            type: 'group-member-left',
            memberId: userId,
            memberName: userStore.userName,
            allMembers: updatedMembers
        }, { excludeIds: [userId] });
        delete groups.value[groupId];
        await dbService.removeItem('groups', groupId);
        await useChatStore().deleteChatHistory(groupId);
        if (useChatStore().currentChatId === groupId) useChatStore().openChat(null);
        return true;
    }

    async function dissolveGroup(groupId) {
        const group = groups.value[groupId];
        const userId = useUserStore().userId;
        if (!group || group.owner !== userId) return false;
        broadcastMessage(groupId, { type: 'group-dissolved' }, { excludeIds: [userId] });
        delete groups.value[groupId];
        await dbService.removeItem('groups', groupId);
        await useChatStore().deleteChatHistory(groupId);
        if (useChatStore().currentChatId === groupId) useChatStore().openChat(null);
        return true;
    }

    function broadcastMessage(groupId, message, { excludeIds = [], file = null } = {}) {
        const group = groups.value[groupId];
        const userStore = useUserStore();
        if (!group) return;
        group.members.forEach(memberId => {
            if (memberId !== userStore.userId && !userStore.contacts[memberId]?.isAI && !excludeIds.includes(memberId)) {
                webrtcService.sendMessage(memberId, { ...message, groupId });
                if (file) {
                    const fileData = { blob: file.blob, hash: file.hash || file.id, name: file.name, type: file.fileType || file.blob.type, size: file.size, messageId: message.id };
                    webrtcService.sendFile(memberId, fileData);
                }
            }
        });
    }

    async function handleIncomingGroupMessage({ peerId, message }) {
        const groupId = message.groupId || message.group?.id;
        if (!groupId) return;

        const userStore = useUserStore();
        const chatStore = useChatStore();

        switch(message.type) {
            case 'group-join':
                if (!groups.value[groupId]) {
                    const newGroupData = { type: 'group', ...message.group };
                    groups.value[groupId] = newGroupData;
                    await dbService.setItem('groups', newGroupData);
                    eventBus.emit('showNotification', { message: `您已加入新群组: ${message.group.name}`, type: 'success' });
                    const myId = userStore.userId;
                    message.group.members.forEach(memberId => {
                        if (memberId !== myId && !userStore.contacts[memberId]?.isAI) {
                            if (userStore.onlineUserIds.includes(memberId)) {
                                log(`Auto-connecting to new group member ${memberId}`, 'INFO');
                                webrtcService.createOffer(memberId, { isSilent: true });
                            }
                        }
                    });
                } else {
                    groups.value[groupId] = { ...groups.value[groupId], ...message.group };
                    await dbService.setItem('groups', groups.value[groupId]);
                }
                break;
            case 'group-invite':
                if (!groups.value[groupId]) {
                    groups.value[groupId] = { type: 'group', ...message.group };
                    await dbService.setItem('groups', message.group);
                    eventBus.emit('showNotification', { message: `您已被邀请加入群组: ${message.group.name}`, type: 'success' });
                }
                break;
            case 'group-member-added':
                if (groups.value[groupId]) {
                    groups.value[groupId].members = message.allMembers;
                    if (message.addedMemberDetails && !userStore.contacts[message.addedMemberId]) {
                        await userStore.addContact(message.addedMemberDetails);
                    }
                    await dbService.setItem('groups', groups.value[groupId]);
                }
                break;
            case 'group-ai-prompt-updated':
                if (groups.value[groupId]) {
                    if (!groups.value[groupId].aiPrompts) groups.value[groupId].aiPrompts = {};
                    groups.value[groupId].aiPrompts[message.aiMemberId] = message.newPrompt;
                    await dbService.setItem('groups', groups.value[groupId]);
                    log(`Group prompt updated for AI ${message.aiMemberId} from peer.`, 'INFO');
                }
                break;
            case 'retract-message-ack':
                if (groups.value[groupId]) {
                    chatStore._updateMessageToRetractedState(message.messageId, groupId, message.retractedByName);
                }
                break;
            case 'group-member-removed':
                if(groups.value[groupId] && message.removedMemberId) {
                    groups.value[groupId].members = message.allMembers;
                    if(groups.value[groupId].aiPrompts?.[message.removedMemberId]) {
                        delete groups.value[groupId].aiPrompts[message.removedMemberId];
                    }
                    await dbService.setItem('groups', groups.value[groupId]);
                }
                break;
            case 'group-removed-you':
                if(groups.value[groupId]) {
                    delete groups.value[groupId];
                    await dbService.removeItem('groups', groupId);
                    if (chatStore.currentChatId === groupId) chatStore.openChat(null);
                    eventBus.emit('showNotification', { message: `您已被移出群组`, type: 'warning' });
                }
                break;
            case 'group-member-left':
                if(groups.value[groupId] && message.memberId) {
                    groups.value[groupId].members = message.allMembers;
                    await dbService.setItem('groups', groups.value[groupId]);
                }
                break;
            case 'group-dissolved':
                if(groups.value[groupId]) {
                    delete groups.value[groupId];
                    await dbService.removeItem('groups', groupId);
                    if (chatStore.currentChatId === groupId) chatStore.openChat(null);
                    eventBus.emit('showNotification', { message: `群组 "${message.groupName}" 已被解散`, type: 'warning' });
                }
                break;
        }
    }

    async function updateGroupLastMessage(groupId, message) {
        if (groups.value[groupId]) {
            groups.value[groupId].lastMessage = message;
            groups.value[groupId].lastTime = new Date().toISOString();
            await dbService.setItem('groups', groups.value[groupId]);
        }
    }
    async function incrementUnread(groupId) {
        if (groups.value[groupId]) {
            groups.value[groupId].unread = (groups.value[groupId].unread || 0) + 1;
            await dbService.setItem('groups', groups.value[groupId]);
        }
    }
    async function clearUnread(groupId) {
        if (groups.value[groupId]) {
            groups.value[groupId].unread = 0;
            await dbService.setItem('groups', groups.value[groupId]);
        }
    }
    async function removeMemberFromAllGroups(memberId) {
        const promises = [];
        for (const groupId in groups.value) {
            const group = groups.value[groupId];
            const memberIndex = group.members.indexOf(memberId);
            if (memberIndex > -1) {
                group.members.splice(memberIndex, 1);
                promises.push(dbService.setItem('groups', group));
                log(`将成员 ${memberId} 从群组 ${groupId} 中移除。`, 'INFO');
            }
        }
        await Promise.all(promises);
    }

    return {
        groups, init, createGroup, addMemberToGroup, removeMemberFromGroup,
        leaveGroup, dissolveGroup, broadcastMessage, updateGroupAiPrompt,
        updateGroupLastMessage, incrementUnread, clearUnread,
        removeMemberFromAllGroups,
        handleIncomingGroupMessage
    };
});