/**
 * @file NotificationUIManager.js
 * @description 通知管理器，负责在 UI 中显示和管理短暂的弹窗通知。
 *              这是一个独立的 UI 工具模块，为其他模块提供用户反馈。
 * @module NotificationManager
 * @exports {object} NotificationUIManager - 对外暴露的单例对象，包含显示通知的方法。
 * @property {function} showNotification - 显示一个指定类型和消息的通知。
 * @dependencies Utils
 * @dependents 几乎所有其他管理器，在需要向用户提供反馈时调用。
 */
const NotificationUIManager = {
    /**
     * 显示一个通知。
     * @param {string} message - 要显示的通知消息。
     * @param {string} [type='info'] - 通知类型，可选值为 'info', 'success', 'warning', 'error'。这会影响通知的样式和图标。
     * @param {number} [duration=type === 'error' ? 8000 : 5000] - 通知显示时长（毫秒）。
     */
    showNotification: function (message, type = 'info', duration) {
        // 如果通知容器不存在，则创建它
        const container = document.querySelector('.notification-container') || this._createNotificationContainer();

        const notification = document.createElement('div');
        notification.className = `notification notification-${type}`; // 应用基础和类型特定的样式
        // 图标映射
        const iconMap = {info: 'ℹ️', success: '✅', warning: '⚠️', error: '❌'};

        // 构建通知HTML结构
        notification.innerHTML = `
<span class="notification-icon">${iconMap[type]}</span>
<span class="notification-message">${Utils.escapeHtml(message)}</span>
<button class="notification-close" title="关闭">×</button>
    `;
        container.appendChild(notification); // 添加到容器

        // 定义移除通知的函数，带有渐出动画效果
        const removeNotification = () => {
            notification.classList.add('notification-hide'); // 添加隐藏动画类
            // 在动画结束后从 DOM 中移除元素
            setTimeout(() => {
                if (notification.parentNode) notification.remove();
                // 如果容器为空，也移除容器 (可选逻辑)
                if (container.children.length === 0 && container.parentNode) container.remove();
            }, 300); // 动画时长为300ms
        };

        // 绑定关闭按钮的点击事件
        const closeButton = notification.querySelector('.notification-close');
        if (closeButton) closeButton.addEventListener('click', removeNotification);

        // 确定通知显示时长
        const displayDuration = duration !== undefined ? duration : (type === 'error' ? 8000 : 5000);

        // 设置定时器，在一段时间后自动移除通知
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