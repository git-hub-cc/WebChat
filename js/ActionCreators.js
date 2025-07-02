/**
 * @file 行为创建器 (Action Creators)
 * @description 封装所有业务逻辑和副作用的入口。UI 组件应调用此处的函数来触发业务流程，而非直接操作管理器或派发包含副作用的 action。这些函数负责执行异步操作、编排多个管理器的调用，并在完成后向 Store 派发一个或多个纯粹的 action 来更新状态。
 * @module ActionCreators
 * @exports {object} ActionCreators - 包含所有行为创建器函数的单例对象。
 * @dependency MessageManager, ChatManager, MediaManager, VideoCallManager, UserManager, GroupManager, ModalUIManager, Store, Utils, NotificationUIManager
 */
const ActionCreators = {
    // ==========================================================================
    // 消息与聊天操作 (Message & Chat Actions)
    // ==========================================================================

    /**
     * 请求发送当前输入框中的消息。
     * @function sendMessageRequest
     * @returns {Promise<void>}
     */
    sendMessageRequest: async function() {
        try {
            await MessageManager.sendMessage();
        } catch (error) {
            Utils.log(`ActionCreator: sendMessageRequest 失败: ${error}`, Utils.logLevels.ERROR);
            NotificationUIManager.showNotification('发送消息时出错。', 'error');
        }
    },

    /**
     * 请求清空当前聊天窗口的消息。
     * @function clearChatRequest
     */
    clearChatRequest: function() {
        MessageManager.clearChat();
    },

    /**
     * 请求清空所有聊天记录。
     * @function clearAllChatsRequest
     */
    clearAllChatsRequest: function() {
        ChatManager.clearAllChats();
    },

    // ==========================================================================
    // 媒体操作 (Media Actions)
    // ==========================================================================

    /**
     * 请求开始录音。
     * @function startRecordingRequest
     */
    startRecordingRequest: function() {
        MediaManager.startRecording();
    },

    /**
     * 请求停止录音。
     * @function stopRecordingRequest
     */
    stopRecordingRequest: function() {
        MediaManager.stopRecording();
    },

    /**
     * 请求截取屏幕。
     * @function captureScreenRequest
     */
    captureScreenRequest: function() {
        MediaManager.captureScreen();
    },

    /**
     * 请求发起一个通话（视频、音频或屏幕共享）。
     * @function initiateCallRequest
     * @param {object} payload - 请求参数。
     * @param {string} payload.peerId - 目标用户的 ID。
     * @param {'video'|'audio'|'screen'} payload.type - 通话类型。
     */
    initiateCallRequest: function(payload) {
        const { peerId, type } = payload;
        if (type === 'video') VideoCallManager.initiateCall(peerId);
        else if (type === 'audio') VideoCallManager.initiateAudioCall(peerId);
        else if (type === 'screen') VideoCallManager.initiateScreenShare(peerId);
    },

    // ==========================================================================
    // 联系人与群组管理 (Contact & Group Management)
    // ==========================================================================

    /**
     * 请求添加一个新的联系人。
     * @function addContactRequest
     * @param {object} payload - 请求参数。
     * @param {string} payload.peerId - 要添加的联系人 Peer ID。
     * @param {string} payload.name - 联系人名称。
     * @returns {Promise<void>}
     */
    addContactRequest: async function(payload) {
        const { peerId, name } = payload;
        const success = await UserManager.addContact(peerId, name);
        if (success) {
            ModalUIManager.toggleModal('newContactGroupModal', false);
        }
    },

    /**
     * 请求创建一个新的群组。
     * @function createGroupRequest
     * @param {object} payload - 请求参数。
     * @param {string} payload.name - 群组名称。
     * @param {string} [payload.groupId] - （可选）指定的群组 ID。
     * @returns {Promise<void>}
     */
    createGroupRequest: async function(payload) {
        const { name, groupId } = payload;
        const newGroupId = await GroupManager.createGroup(name, groupId);
        // 如果创建成功，则关闭弹窗并切换到新群组的聊天界面
        if (newGroupId) {
            ModalUIManager.toggleModal('newContactGroupModal', false);
            Store.dispatch('OPEN_CHAT', { chatId: newGroupId });
        }
    },

    /**
     * 请求向群组中添加一个成员。
     * @function addGroupMemberRequest
     * @param {object} payload - 请求参数。
     * @param {string} payload.groupId - 目标群组 ID。
     * @param {string} payload.memberId - 要添加的成员 ID。
     * @param {string} payload.memberName - 要添加的成员名称。
     * @returns {Promise<void>}
     */
    addGroupMemberRequest: async function(payload) {
        const { groupId, memberId, memberName } = payload;
        await GroupManager.addMemberToGroup(groupId, memberId, memberName);
    },

    /**
     * 请求从群组中移除一个成员。
     * @function removeGroupMemberRequest
     * @param {object} payload - 请求参数。
     * @param {string} payload.groupId - 目标群组 ID。
     * @param {string} payload.memberId - 要移除的成员 ID。
     * @returns {Promise<void>}
     */
    removeGroupMemberRequest: async function(payload) {
        const { groupId, memberId } = payload;
        await GroupManager.removeMemberFromGroup(groupId, memberId);
    },

    /**
     * 请求离开一个群组。
     * @function leaveGroupRequest
     * @param {object} payload - 请求参数。
     * @param {string} payload.groupId - 要离开的群组 ID。
     * @returns {Promise<void>}
     */
    leaveGroupRequest: async function(payload) {
        const { groupId } = payload;
        await GroupManager.leaveGroup(groupId);
    },

    /**
     * 请求解散一个群组（仅群主可操作）。
     * @function dissolveGroupRequest
     * @param {object} payload - 请求参数。
     * @param {string} payload.groupId - 要解散的群组 ID。
     * @returns {Promise<void>}
     */
    dissolveGroupRequest: async function(payload) {
        const { groupId } = payload;
        await GroupManager.dissolveGroup(groupId);
    },

    /**
     * 请求删除一个联系人及其聊天记录。
     * @function deleteContactRequest
     * @param {object} payload - 请求参数。
     * @param {string} payload.contactId - 要删除的联系人 ID。
     */
    deleteContactRequest: function(payload) {
        const { contactId } = payload;
        ChatManager.deleteChat(contactId, 'contact');
    }
};