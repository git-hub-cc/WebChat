/**
 * @file 管理UI通知弹窗
 * @description
 * 负责在用户界面中显示和管理短暂的弹窗通知。
 * 这是一个独立的UI工具模块，为应用内其他模块提供统一的用户反馈机制。
 * @module NotificationUIManager
 * @exports {object} NotificationUIManager - 对外暴露的单例对象，包含显示通知的方法。
 * @dependency Utils - 可能间接依赖，用于日志等。
 * @dependency AppSettings - 提供通知的默认显示时长等配置。
 */
const NotificationUIManager = {
    /**
     * 显示一个通知弹窗。
     * @function showNotification
     * @param {string} message - 要显示的通知消息内容。
     * @param {string} [type='info'] - 通知的类型，可选值为 'info', 'success', 'warning', 'error'。它会影响通知的样式和图标。
     * @param {number} [duration] - 通知的显示时长（毫秒）。如果未提供，则根据类型使用 `AppSettings` 中的默认值。
     */
    showNotification: function (message, type = 'info', duration) {
        // 处理流程如下：
        // 1. 获取或创建通知的容器元素。
        const container = document.querySelector('.notification-container') || this._createNotificationContainer();

        // 2. 从HTML模板克隆一个新的通知元素。
        const template = document.getElementById('notification-template').content.cloneNode(true);
        const notification = template.querySelector('.notification');

        // 定义不同类型通知对应的图标
        const iconMap = {info: 'ℹ️', success: '✅', warning: '⚠️', error: '❌'};

        // 3. 根据类型和消息内容，填充通知元素。
        notification.classList.add(`notification-${type}`);
        notification.querySelector('.notification-icon').textContent = iconMap[type] || 'ℹ️';
        notification.querySelector('.notification-message').textContent = message; // 使用 textContent 以防止XSS攻击

        // 4. 定义移除通知的函数，包含渐隐动画。
        const removeNotification = () => {
            notification.classList.add('notification-hide');
            // 动画结束后，从DOM中移除元素
            setTimeout(() => {
                if (notification.parentNode) notification.remove();
                // 如果容器内已无通知，也移除容器
                if (container.children.length === 0 && container.parentNode) container.remove();
            }, 300); // 300ms 对应 CSS 动画时长
        };

        // 5. 绑定关闭按钮的点击事件。
        notification.querySelector('.notification-close').addEventListener('click', removeNotification);

        // 6. 将通知添加到容器中，使其显示。
        container.appendChild(notification);

        // 7. 设置定时器，在指定时长后自动移除通知。
        // 优先使用传入的 duration，否则根据类型从 AppSettings 获取。
        const displayDuration = duration !== undefined
            ? duration
            : (type === 'error' ? AppSettings.ui.notificationErrorDuration : AppSettings.ui.notificationDefaultDuration);
        setTimeout(removeNotification, displayDuration);
    },

    /**
     * 创建通知容器元素并附加到 body。
     * @function _createNotificationContainer
     * @private
     * @returns {HTMLElement} 创建的容器元素。
     */
    _createNotificationContainer: function () {
        const container = document.createElement('div');
        // 应用容器的 CSS 类名
        container.className = 'notification-container';
        // 将容器添加到 body 的末尾
        document.body.appendChild(container);
        return container;
    }
};