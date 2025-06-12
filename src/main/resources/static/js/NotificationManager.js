
/**
 * @file NotificationManager.js
 * @description 通知管理器，负责在 UI 中显示和管理短暂的弹窗通知。
 *              这是一个独立的 UI 工具模块，为其他模块提供用户反馈。
 * @module NotificationManager
 * @exports {object} NotificationManager - 对外暴露的单例对象，包含显示通知的方法。
 * @property {function} showNotification - 显示一个指定类型和消息的通知。
 * @dependencies Utils
 * @dependents 几乎所有其他管理器，在需要向用户提供反馈时调用。
 */
const NotificationManager = {
    /**
     * 显示一个通知。
     * @param {string} message - 要显示的通知消息。
     * @param {string} [type='info'] - 通知类型，可选值为 'info', 'success', 'warning', 'error'。这会影响通知的样式和图标。
     */
    showNotification: function (message, type = 'info') {
        // 如果通知容器不存在，则创建它
        const container = document.querySelector('.notification-container') || this._createNotificationContainer();

        const notification = document.createElement('div');
        notification.className = `notification notification-${type}`;
        const iconMap = {info: 'ℹ️', success: '✅', warning: '⚠️', error: '❌'};

        notification.innerHTML = `
<span class="notification-icon">${iconMap[type]}</span>
<span class="notification-message">${Utils.escapeHtml(message)}</span>
<button class="notification-close" title="关闭">×</button>
    `;
        container.appendChild(notification);

        // 定义移除通知的函数，带有渐出动画效果
        const removeNotification = () => {
            notification.classList.add('notification-hide');
            // 在动画结束后从 DOM 中移除元素
            setTimeout(() => {
                if (notification.parentNode) notification.remove();
                // 如果容器为空，也移除容器
                if (container.children.length === 0 && container.parentNode) container.remove();
            }, 300);
        };

        // 绑定关闭按钮的点击事件
        notification.querySelector('.notification-close').onclick = removeNotification;
        // 设置定时器，在一段时间后自动移除通知（错误通知显示时间更长）
        setTimeout(removeNotification, type === 'error' ? 8000 : 5000);
    },

    /**
     * @private
     * 创建通知容器元素并附加到 body。
     * @returns {HTMLElement} - 创建的容器元素。
     */
    _createNotificationContainer: function () {
        const container = document.createElement('div');
        container.className = 'notification-container';
        document.body.appendChild(container);
        return container;
    }
};
