const EventEmitter = {
    events: {},

    on: function (event, callback) {
        if (!this.events[event]) {
            this.events[event] = new Set();
        }
        this.events[event].add(callback);
        Utils.log(`为事件添加了监听器: ${event}`, Utils.logLevels.DEBUG);
    },

    emit: function (event, ...args) {
        if (this.events[event]) {
            Utils.log(`正在触发事件: ${event}，参数: ${JSON.stringify(args)}`, Utils.logLevels.DEBUG);
            this.events[event].forEach(callback => {
                try {
                    callback(...args);
                } catch (e) {
                    Utils.log(`事件 ${event} 的监听器出错: ${e.message}\n${e.stack}`, Utils.logLevels.ERROR);
                }
            });
        }
    },

    off: function (event, callback) {
        if (this.events[event]) {
            if (callback) {
                this.events[event].delete(callback);
                Utils.log(`移除了指定的事件监听器: ${event}`, Utils.logLevels.DEBUG);
            } else {
                delete this.events[event];
                Utils.log(`移除了所有事件监听器: ${event}`, Utils.logLevels.DEBUG);
            }
        }
    },

    once: function(event, callback) {
        const onceCallback = (...args) => {
            this.off(event, onceCallback);
            callback(...args);
        };
        this.on(event, onceCallback);
    }
};