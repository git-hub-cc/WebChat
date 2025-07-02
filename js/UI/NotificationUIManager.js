/**
 * @file NotificationUIManager.js
 * @description 通知管理器，负责在 UI 中显示和管理短暂的弹窗通知。
 *              这是一个独立的 UI 工具模块，为其他模块提供用户反馈。
 * @module NotificationManager
 * @exports {object} NotificationUIManager - 对外暴露的单例对象，包含显示通知的方法。
 * @property {function} showNotification - 显示一个指定类型和消息的通知。
 * @dependencies Utils, AppSettings
 * @dependents 几乎所有其他管理器，在需要向用户提供反馈时调用。
 */
const NotificationUIManager = {
    /**
     * 显示一个通知。
     * @param {string} message - 要显示的通知消息。
     * @param {string} [type='info'] - 通知类型...
     * @param {number} [duration] - 显示时长...
     */
    showNotification: function (message, type = 'info', duration) {
        const container = document.querySelector('.notification-container') || this._createNotificationContainer();

        const template = document.getElementById('notification-template').content.cloneNode(true);
        const notification = template.querySelector('.notification');
        const iconMap = {info: 'ℹ️', success: '✅', warning: '⚠️', error: '❌'};

        notification.classList.add(`notification-${type}`);
        notification.querySelector('.notification-icon').textContent = iconMap[type] || 'ℹ️';
        notification.querySelector('.notification-message').textContent = message; // textContent is safe

        const removeNotification = () => {
            notification.classList.add('notification-hide');
            setTimeout(() => {
                if (notification.parentNode) notification.remove();
                if (container.children.length === 0 && container.parentNode) container.remove();
            }, 300);
        };

        notification.querySelector('.notification-close').addEventListener('click', removeNotification);

        container.appendChild(notification);

        const displayDuration = duration !== undefined
            ? duration
            : (type === 'error' ? AppSettings.ui.notificationErrorDuration : AppSettings.ui.notificationDefaultDuration);
        setTimeout(removeNotification, displayDuration);
    },
    /**
     * @private
     * 创建通知容器元素并附加到 body。
     * @returns {HTMLElement} - 创建的容器元素。
     */
    _createNotificationContainer: function () {
        const container = document.createElement('div');
        container.className = 'notification-container'; // 应用容器样式
        document.body.appendChild(container); // 添加到body
        return container;
    }
};