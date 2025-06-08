// NEW FILE: NotificationManager.js
// Responsibilities:
// - Displaying and managing UI notifications.
const NotificationManager = {
    showNotification: function (message, type = 'info') { // type: 'info', 'success', 'warning', 'error'
        const container = document.querySelector('.notification-container') || this._createNotificationContainer();

        const notification = document.createElement('div');
        notification.className = `notification notification-${type}`;
        const iconMap = {info: 'ℹ️', success: '✅', warning: '⚠️', error: '❌'};

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
                if (container.children.length === 0 && container.parentNode) container.remove();
            }, 300);
        };

        notification.querySelector('.notification-close').onclick = removeNotification;
        setTimeout(removeNotification, type === 'error' ? 8000 : 5000);
    },

    _createNotificationContainer: function () {
        const container = document.createElement('div');
        container.className = 'notification-container';
        document.body.appendChild(container);
        return container;
    }
};