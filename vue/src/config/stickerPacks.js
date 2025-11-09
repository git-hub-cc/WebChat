/**
 * @file stickerPacks.js
 * @description (新文件) 定义所有可用的贴图包。
 *              每个贴图都有一个唯一的ID，并指向其在 `public` 目录下的 .tgs 文件。
 *              ID格式: 'pack_id/sticker_id'
 * @module Config
 */
export const STICKER_PACKS = {
    'general_animations': {
        name: '✨ 通用动画',
        stickers: [
            { id: 'blocked_peers_empty', file: 'animations/blocked_peers_empty.tgs' },
            { id: 'cake', file: 'animations/cake.tgs' },
            { id: 'camera_outline', file: 'animations/camera_outline.tgs' },
            { id: 'change_number', file: 'animations/change_number.tgs' },
            { id: 'chat_link', file: 'animations/chat_link.tgs' },
            { id: 'cloud_filters', file: 'animations/cloud_filters.tgs' },
            { id: 'collectible_phone', file: 'animations/collectible_phone.tgs' },
            { id: 'collectible_username', file: 'animations/collectible_username.tgs' },
            { id: 'diamond', file: 'animations/diamond.tgs' },
            { id: 'discussion', file: 'animations/discussion.tgs' },
            { id: 'filters', file: 'animations/filters.tgs' },
            { id: 'greeting', file: 'animations/greeting.tgs' },
            { id: 'hello_status', file: 'animations/hello_status.tgs' },
            { id: 'hours', file: 'animations/hours.tgs' },
            { id: 'local_passcode_enter', file: 'animations/local_passcode_enter.tgs' },
            { id: 'location', file: 'animations/location.tgs' },
            { id: 'media_forbidden', file: 'animations/media_forbidden.tgs' },
            { id: 'my_gifts_empty', file: 'animations/my_gifts_empty.tgs' },
            { id: 'noresults', file: 'animations/noresults.tgs' },
            { id: 'no_chats', file: 'animations/no_chats.tgs' },
            { id: 'palette', file: 'animations/palette.tgs' },
            { id: 'phone', file: 'animations/phone.tgs' },
            { id: 'photo_suggest_icon', file: 'animations/photo_suggest_icon.tgs' },
            { id: 'robot', file: 'animations/robot.tgs' }, // 默认机器人
            { id: 'rtmp', file: 'animations/rtmp.tgs' },
            { id: 'search', file: 'animations/search.tgs' },
            { id: 'show_or_premium_lastseen', file: 'animations/show_or_premium_lastseen.tgs' },
            { id: 'show_or_premium_readtime', file: 'animations/show_or_premium_readtime.tgs' },
            { id: 'sleep', file: 'animations/sleep.tgs' },
            { id: 'starref_link', file: 'animations/starref_link.tgs' },
            { id: 'stats', file: 'animations/stats.tgs' },
            { id: 'stats_boosts', file: 'animations/stats_boosts.tgs' },
            { id: 'stats_earn', file: 'animations/stats_earn.tgs' },
            { id: 'transcribe_loading', file: 'animations/transcribe_loading.tgs' },
            { id: 'ttl', file: 'animations/ttl.tgs' },
            { id: 'voice_ttl_idle', file: 'animations/voice_ttl_idle.tgs' },
            { id: 'voice_ttl_start', file: 'animations/voice_ttl_start.tgs' },
            { id: 'writing', file: 'animations/writing.tgs' },
        ]
    },
    'cloud_password_pack': {
        name: '☁️ 云端密码',
        stickers: [
            { id: 'email', file: 'animations/cloud_password/email.tgs' },
            { id: 'hint', file: 'animations/cloud_password/hint.tgs' },
            { id: 'intro', file: 'animations/cloud_password/intro.tgs' },
            { id: 'password_input', file: 'animations/cloud_password/password_input.tgs' },
            { id: 'validate', file: 'animations/cloud_password/validate.tgs' },
        ]
    },
    'dice_pack': {
        name: '🎲 骰子与游戏',
        stickers: [
            { id: 'bball_idle', file: 'animations/dice/bball_idle.tgs' },
            { id: 'dart_idle', file: 'animations/dice/dart_idle.tgs' },
            { id: 'dice_idle', file: 'animations/dice/dice_idle.tgs' },
            { id: 'fball_idle', file: 'animations/dice/fball_idle.tgs' },
            { id: 'slot_0_idle', file: 'animations/dice/slot_0_idle.tgs' },
            { id: 'slot_1_idle', file: 'animations/dice/slot_1_idle.tgs' },
            { id: 'slot_2_idle', file: 'animations/dice/slot_2_idle.tgs' },
            { id: 'slot_back', file: 'animations/dice/slot_back.tgs' },
            { id: 'slot_pull', file: 'animations/dice/slot_pull.tgs' },
            { id: 'winners', file: 'animations/dice/winners.tgs' },
        ]
    },
    'edit_peers_pack': {
        name: '👥 编辑',
        stickers: [
            { id: 'direct_messages', file: 'animations/edit_peers/direct_messages.tgs' },
            { id: 'topics', file: 'animations/edit_peers/topics.tgs' },
            { id: 'topics_list', file: 'animations/edit_peers/topics_list.tgs' },
            { id: 'topics_tabs', file: 'animations/edit_peers/topics_tabs.tgs' },
        ]
    },
    'profile_pack': {
        name: '👤 个人资料',
        stickers: [
            { id: 'profile_muting', file: 'animations/profile/profile_muting.tgs' },
            { id: 'profile_unmuting', file: 'animations/profile/profile_unmuting.tgs' },
        ]
    },
    'star_reaction_pack': {
        name: '⭐ 星星反应',
        stickers: [
            { id: 'appear', file: 'animations/star_reaction/appear.tgs' },
            { id: 'center', file: 'animations/star_reaction/center.tgs' },
            { id: 'effect1', file: 'animations/star_reaction/effect1.tgs' },
            { id: 'effect2', file: 'animations/star_reaction/effect2.tgs' },
            { id: 'effect3', file: 'animations/star_reaction/effect3.tgs' },
            { id: 'select', file: 'animations/star_reaction/select.tgs' },
            { id: 'toast', file: 'animations/star_reaction/toast.tgs' },
        ]
    },
    'swipe_action_pack': {
        name: '↔️ 滑动操作',
        stickers: [
            { id: 'archive', file: 'animations/swipe_action/archive.tgs' },
            { id: 'delete', file: 'animations/swipe_action/delete.tgs' },
            { id: 'disabled', file: 'animations/swipe_action/disabled.tgs' },
            { id: 'mute', file: 'animations/swipe_action/mute.tgs' },
            { id: 'pin', file: 'animations/swipe_action/pin.tgs' },
            { id: 'read', file: 'animations/swipe_action/read.tgs' },
            { id: 'unarchive', file: 'animations/swipe_action/unarchive.tgs' },
            { id: 'unmute', file: 'animations/swipe_action/unmute.tgs' },
            { id: 'unpin', file: 'animations/swipe_action/unpin.tgs' },
            { id: 'unread', file: 'animations/swipe_action/unread.tgs' },
        ]
    },
    'toast_pack': {
        name: '🍞 提示',
        stickers: [
            { id: 'chats_filter_in', file: 'animations/toast/chats_filter_in.tgs' },
            { id: 'saved_messages', file: 'animations/toast/saved_messages.tgs' },
            { id: 'tagged', file: 'animations/toast/tagged.tgs' },
        ]
    },
};

/**
 * 根据组合ID (e.g., 'general_animations/robot') 查找贴图文件路径。
 * @param {string} combinedId - 贴图的组合ID。
 * @returns {string|null} 贴图文件的路径，如果找不到则返回null。
 */
export function getStickerPathById(combinedId) {
    if (!combinedId || typeof combinedId !== 'string') return null;

    const [packId, stickerId] = combinedId.split('/');
    if (!packId || !stickerId) return null;

    const pack = STICKER_PACKS[packId];
    if (!pack) return null;

    const sticker = pack.stickers.find(s => s.id === stickerId);
    return sticker ? sticker.file : null;
}