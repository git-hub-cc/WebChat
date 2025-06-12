/**
 * @file EventEmitter.js
 * @description 一个简单的事件发射器（发布/订阅）实现，用于模块间的解耦通信。
 * @module EventEmitter
 * @exports {object} EventEmitter - 对外暴露的单例对象，包含事件监听和触发的方法。
 * @property {function} on - 注册一个事件监听器。
 * @property {function} emit - 触发一个事件，并向其所有监听器传递参数。
 * @property {function} off - 移除一个或所有事件监听器。
 * @property {function} once - 注册一个只执行一次的事件监听器。
 * @dependencies Utils
 * @dependents AppInitializer (设置核心监听器), 几乎所有其他管理器都使用它来触发或监听事件。
 */
const EventEmitter = {
    events: {}, // 存储所有事件及其监听器回调的 Set

    /**
     * 注册一个事件监听器。
     * @param {string} event - 事件名称。
     * @param {Function} callback - 事件触发时执行的回调函数。
     */
    on: function (event, callback) {
        if (!this.events[event]) {
            this.events[event] = new Set();
        }
        this.events[event].add(callback);
        Utils.log(`为事件添加了监听器: ${event}`, Utils.logLevels.DEBUG);
    },

    /**
     * 触发一个事件，并执行所有已注册的监听器。
     * @param {string} event - 要触发的事件名称。
     * @param {...*} args - 传递给监听器回调的参数。
     */
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

    /**
     * 移除一个事件的监听器。
     * @param {string} event - 事件名称。
     * @param {Function} [callback] - 要移除的特定回调函数。如果未提供，则移除该事件的所有监听器。
     */
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

    /**
     * 注册一个只执行一次的事件监听器。
     * @param {string} event - 事件名称。
     * @param {Function} callback - 事件触发时执行的回调函数。
     */
    once: function(event, callback) {
        const onceCallback = (...args) => {
            this.off(event, onceCallback); // 执行后立即移除自身
            callback(...args);
        };
        this.on(event, onceCallback);
    }
};