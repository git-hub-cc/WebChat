const EventEmitter = {
    events: {},

    // 注册事件
    on: function (event, callback) {
        if (!this.events[event]) {
            this.events[event] = [];
        }
        this.events[event].push(callback);
    },

    // 触发事件
    emit: function (event, ...args) {
        if (this.events[event]) {
            this.events[event].forEach(callback => {
                try {
                    callback(...args);
                } catch (e) {
                    Utils.log(`事件处理发生错误: ${e.message}`, Utils.logLevels.ERROR);
                }
            });
        }
    },

    // 移除事件
    off: function (event, callback) {
        if (this.events[event]) {
            if (callback) {
                this.events[event] = this.events[event].filter(cb => cb !== callback);
            } else {
                delete this.events[event];
            }
        }
    }
};