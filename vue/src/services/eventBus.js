import { log } from '@/utils';

const events = new Map();

/**
 * @file eventBus.js
 * @description (Vue Refactor) 一个简单的全局事件总线，用于模块间的解耦通信。
 *              替代了原生的 EventEmitter.js，并针对 Vue 3 + Pinia 架构进行了优化。
 *              修复了尝试深拷贝 Blob 对象时导致的错误。
 */
export const eventBus = {
    /**
     * 注册一个事件监听器。
     * @param {string} event - 事件名称。
     * @param {Function} callback - 事件触发时执行的回调函数。
     */
    on(event, callback) {
        if (!events.has(event)) {
            events.set(event, new Set());
        }
        events.get(event).add(callback);
        log(`Event listener added: ${event}`, 'DEBUG');
    },

    /**
     * 触发一个事件。
     * @param {string} event - 事件名称。
     * @param {...*} args - 传递给监听器的参数。
     *                    注意：参数不会被深拷贝，如果传递的是可变对象，监听器应自行处理副本。
     *                    Blob 等不可变对象可以直接传递。
     */
    emit(event, ...args) {
        if (events.has(event)) {
            // 改进日志记录，避免序列化 Blob 等不可序列化对象
            // Blob 对象在日志中会显示为 '[Blob]'，其他对象正常显示。
            const loggableArgs = args.map(arg => {
                if (typeof arg === 'object' && arg !== null && arg.constructor.name === 'Blob') {
                    return '[Blob]';
                }
                return arg;
            });
            log(`Emitting event: ${event} with args: ${JSON.stringify(loggableArgs)}`, 'DEBUG');

            // 遍历并执行所有回调
            events.get(event).forEach(callback => {
                try {
                    // MODIFIED: 移除深拷贝。Blob是不可变的，其他可变对象由 Pinia 或组件自行管理。
                    callback(...args);
                } catch (e) {
                    log(`Error in event listener for ${event}: ${e.message}\n${e.stack}`, 'ERROR');
                }
            });
        }
    },

    /**
     * 移除一个事件的监听器。
     * @param {string} event - 事件名称。
     * @param {Function} [callback] - 要移除的特定回调函数。如果省略，则移除该事件的所有监听器。
     */
    off(event, callback) {
        if (!events.has(event)) return;

        if (callback) {
            events.get(event).delete(callback);
            log(`Event listener removed: ${event}`, 'DEBUG');
        } else {
            events.delete(event);
            log(`All listeners removed for event: ${event}`, 'DEBUG');
        }
    }
};