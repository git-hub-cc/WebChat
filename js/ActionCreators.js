/**
 * @file ActionCreators.js
 * @description (新增) 行为创建器，用于处理所有业务逻辑和副作用。
 *              UI 组件通过调用此处的函数来触发业务流程，而不是直接 dispatch 一个包含副作用的 action。
 *              这里的函数会执行异步操作、调用其他 Manager，并在完成后 dispatch 一个或多个“纯粹的” action 到 Store，以更新状态。
 *              REFACTORED (Phase 2): 增强了协调作用，负责编排多个 Manager 的调用，以减少它们之间的直接耦合。
 *              REFACTORED (Phase 3): 进一步完善，确保所有由 UI 触发的业务流程都从这里开始。
 * @module ActionCreators
 * @exports {object} ActionCreators - 包含所有行为创建器函数的对象。
 */
const ActionCreators = {
    // ==========================================================================
    // 消息与聊天操作
    // ==========================================================================
    sendMessageRequest: async function() {
        try {
            await MessageManager.sendMessage();
        } catch (error) {
            Utils.log(`ActionCreator: sendMessageRequest 失败: ${error}`, Utils.logLevels.ERROR);
            NotificationUIManager.showNotification('发送消息时出错。', 'error');
        }
    },
    clearChatRequest: function() {
        MessageManager.clearChat();
    },
    clearAllChatsRequest: function() {
        ChatManager.clearAllChats();
    },

    // ==========================================================================
    // 媒体操作
    // ==========================================================================
    startRecordingRequest: function() {
        MediaManager.startRecording();
    },
    stopRecordingRequest: function() {
        MediaManager.stopRecording();
    },
    captureScreenRequest: function() {
        MediaManager.captureScreen();
    },
    initiateCallRequest: function(payload) {
        const { peerId, type } = payload;
        if (type === 'video') VideoCallManager.initiateCall(peerId);
        else if (type === 'audio') VideoCallManager.initiateAudioCall(peerId);
        else if (type === 'screen') VideoCallManager.initiateScreenShare(peerId);
    },

    // ==========================================================================
    // 联系人与群组管理
    // ==========================================================================
    addContactRequest: async function(payload) {
        const { peerId, name } = payload;
        const success = await UserManager.addContact(peerId, name);
        if (success) {
            ModalUIManager.toggleModal('newContactGroupModal', false);
        }
    },
    createGroupRequest: async function(payload) {
        const { name, groupId } = payload;
        const newGroupId = await GroupManager.createGroup(name, groupId);
        if (newGroupId) {
            ModalUIManager.toggleModal('newContactGroupModal', false);
            Store.dispatch('OPEN_CHAT', { chatId: newGroupId });
        }
    },
    addGroupMemberRequest: async function(payload) {
        const { groupId, memberId, memberName } = payload;
        await GroupManager.addMemberToGroup(groupId, memberId, memberName);
    },
    removeGroupMemberRequest: async function(payload) {
        const { groupId, memberId } = payload;
        await GroupManager.removeMemberFromGroup(groupId, memberId);
    },
    leaveGroupRequest: async function(payload) {
        const { groupId } = payload;
        await GroupManager.leaveGroup(groupId);
    },
    dissolveGroupRequest: async function(payload) {
        const { groupId } = payload;
        await GroupManager.dissolveGroup(groupId);
    },
    deleteContactRequest: function(payload) {
        const { contactId } = payload;
        ChatManager.deleteChat(contactId, 'contact');
    }
};