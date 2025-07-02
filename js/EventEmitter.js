/**
 * @file 事件发射器 (EventEmitter.js)
 * @description 一个轻量级的事件发射器（发布/订阅模式）实现，用于应用内各模块间的解耦通信。
 * @module EventEmitter
 * @exports {object} EventEmitter - 对外暴露的单例对象，包含事件监听、触发和移除的方法。
 * @dependency Utils - 引入工具模块，用于日志记录。
 */
const EventEmitter = {
    // 存储所有事件及其对应的监听器回调集合。结构: { eventName: Set<Function> }
    events: {},

    /**
     * 注册一个事件监听器。
     * @function on
     * @param {string} event - 事件名称。
     * @param {Function} callback - 事件触发时执行的回调函数。
     */
    on: function (event, callback) {
        // 如果该事件尚无监听器，则为其创建一个新的 Set 结构
        if (!this.events[event]) {
            this.events[event] = new Set();
        }
        // 将回调函数添加到对应事件的 Set 中
        this.events[event].add(callback);
        Utils.log(`为事件添加了监听器: ${event}`, Utils.logLevels.DEBUG);
    },

    /**
     * 触发一个事件，并按注册顺序执行所有监听该事件的回调函数。
     * @function emit
     * @param {string} event - 要触发的事件名称。
     * @param {...*} args - 传递给监听器回调函数的参数。
     */
    emit: function (event, ...args) {
        // 检查是否存在该事件的监听器
        if (this.events[event]) {
            Utils.log(`正在触发事件: ${event}，参数: ${JSON.stringify(args)}`, Utils.logLevels.DEBUG);
            // 遍历并执行所有回调
            this.events[event].forEach(callback => {
                try {
                    callback(...args);
                } catch (e) {
                    // NOTE: 捕获并记录单个监听器的执行错误，防止其影响其他监听器的执行
                    Utils.log(`事件 ${event} 的监听器出错: ${e.message}\n${e.stack}`, Utils.logLevels.ERROR);
                }
            });
        }
    },

    /**
     * 移除一个或多个事件监听器。
     * @function off
     * @param {string} event - 事件名称。
     * @param {Function} [callback] - (可选) 要移除的特定回调函数。如果未提供，则移除该事件的所有监听器。
     */
    off: function (event, callback) {
        if (this.events[event]) {
            if (callback) {
                // 如果提供了具体的回调函数，则只从 Set 中移除该函数
                this.events[event].delete(callback);
                Utils.log(`移除了指定的事件监听器: ${event}`, Utils.logLevels.DEBUG);
            } else {
                // 如果未提供回调函数，则删除整个事件及其所有监听器
                delete this.events[event];
                Utils.log(`移除了所有事件监听器: ${event}`, Utils.logLevels.DEBUG);
            }
        }
    },

    /**
     * 注册一个只执行一次的事件监听器。
     * @function once
     * @param {string} event - 事件名称。
     * @param {Function} callback - 事件触发时执行的回调函数。
     */
    once: function(event, callback) {
        // 1. 创建一个包装回调函数
        const onceCallback = (...args) => {
            // 2. 在执行原始回调之前，先将自身从监听器中移除
            this.off(event, onceCallback);
            // 3. 执行原始的回调函数
            callback(...args);
        };
        // 4. 将包装后的回调注册为普通监听器
        this.on(event, onceCallback);
    }
};