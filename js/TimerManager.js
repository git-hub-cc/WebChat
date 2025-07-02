/**
 * @file 管理应用中的定时器
 * @description 集中管理所有通过 `setInterval` 创建的周期性定时器，提供统一的添加、移除和控制接口，以避免定时器滥用和内存泄漏。
 * @module TimerManager
 * @exports {object} TimerManager - 用于定时器管理的单例对象。
 * @dependency Utils - 用于日志记录功能（如果可用）。
 */
const TimerManager = {
    // 存储所有定时任务的详情。键为任务名，值为任务对象。
    // 结构: { taskName: { intervalId: number, callback: function, intervalMs: number, isRunning: boolean } }
    _tasks: {},

    /**
     * 初始化定时器管理器
     * @function init
     * @description 执行模块初始化所需的操作。目前主要用于打印初始化日志。
     */
    init: function() {
        // NOTE: 假设 Utils.log 和 Utils.logLevels 存在，用于标准化日志输出
        if (typeof Utils !== 'undefined' && Utils.log) {
            Utils.log("定时器管理器已初始化。", Utils.logLevels.INFO);
        } else {
            console.info("定时器管理器已初始化。");
        }
    },

    /**
     * 添加或更新一个具名的周期性任务
     * @function addPeriodicTask
     * @description 如果已存在同名任务，会先停止并移除旧任务，然后创建新任务。
     * @param {string} name - 任务的唯一名称，用于标识和管理。
     * @param {function} callback - 每个周期需要执行的回调函数。
     * @param {number} intervalMs - 执行回调函数的时间间隔，单位为毫秒。
     * @param {boolean} [runImmediately=false] - 若为 true，则在启动定时器前立即执行一次回调。
     * @example
     * // 添加一个每5秒执行一次的任务
     * TimerManager.addPeriodicTask('heartbeat', () => console.log('ping'), 5000);
     *
     * // 添加一个任务，并立即执行一次
     * TimerManager.addPeriodicTask('checkStatus', checkStatusFunc, 10000, true);
     */
    addPeriodicTask: function(name, callback, intervalMs, runImmediately = false) {
        // 定义日志记录的辅助函数，优先使用 Utils 模块
        const logError = (message) => {
            if (typeof Utils !== 'undefined' && Utils.log) {
                Utils.log(message, Utils.logLevels.ERROR);
            } else {
                console.error(message);
            }
        };
        const logInfo = (message) => {
            if (typeof Utils !== 'undefined' && Utils.log) {
                Utils.log(message, Utils.logLevels.INFO);
            } else {
                console.info(message);
            }
        };
        const logDebug = (message) => {
            if (typeof Utils !== 'undefined' && Utils.log) {
                Utils.log(message, Utils.logLevels.DEBUG);
            } else {
                console.debug(message);
            }
        };

        // 任务添加流程如下：
        // 1. 校验输入参数的合法性
        if (!name || typeof callback !== 'function' || typeof intervalMs !== 'number' || intervalMs <= 0) {
            logError(`定时器管理器：addPeriodicTask 参数无效 (任务名: ${name})。任务未添加。`);
            return;
        }

        // 2. 如果已存在同名任务，先移除旧任务以防重复执行
        if (this._tasks[name] && this._tasks[name].intervalId) {
            this.removePeriodicTask(name); // 内部会打印移除日志
            logDebug(`定时器管理器：已替换现有任务：${name}`);
        }

        // 3. 如果设置了 runImmediately，则立即执行一次回调
        if (runImmediately) {
            try {
                callback();
            } catch (error) {
                logError(`定时器管理器：立即执行任务 "${name}" 时出错：${error.message}`);
            }
        }

        // 4. 创建新的周期性定时器
        const intervalId = setInterval(() => {
            try {
                callback();
            } catch (error) {
                logError(`定时器管理器：周期性任务 "${name}" 执行出错：${error.message}`);
                // NOTE: 当前策略是即使任务执行出错，也让它继续尝试。未来可根据需求添加重试或自动停止逻辑。
            }
        }, intervalMs);

        // 5. 在 _tasks 对象中存储新任务的信息
        this._tasks[name] = {
            intervalId: intervalId,
            callback: callback,
            intervalMs: intervalMs,
            isRunning: true
        };
        logInfo(`定时器管理器：周期性任务 "${name}" 已添加，间隔 ${intervalMs}毫秒。`);
    },

    /**
     * 移除并停止一个具名的周期性任务
     * @function removePeriodicTask
     * @param {string} name - 需要移除的任务的名称。
     */
    removePeriodicTask: function(name) {
        const logInfo = (message) => {
            if (typeof Utils !== 'undefined' && Utils.log) {
                Utils.log(message, Utils.logLevels.INFO);
            } else {
                console.info(message);
            }
        };

        const task = this._tasks[name];
        if (task && task.intervalId) {
            clearInterval(task.intervalId);
            delete this._tasks[name];
            logInfo(`定时器管理器：周期性任务 "${name}" 已移除并停止。`);
        }
        // NOTE: 此处特意不警告“尝试移除不存在的任务”。这使得该函数是幂等的，行为类似于原生的 clearInterval，
        // 在进行清理操作时，无需预先检查任务是否存在，简化了调用方的逻辑。
    },

    /**
     * 检查是否存在指定名称的任务且该任务正在运行
     * @function hasTask
     * @param {string} name - 要检查的任务的名称。
     * @returns {boolean} - 如果任务存在且正在运行，则返回 true；否则返回 false。
     */
    hasTask: function(name) {
        return !!(this._tasks[name] && this._tasks[name].isRunning);
    },

    /**
     * 停止所有由本管理器创建的周期性任务
     * @function stopAllTasks
     * @description 通常在应用关闭或需要进行全局清理时调用。
     */
    stopAllTasks: function() {
        const logInfo = (message) => {
            if (typeof Utils !== 'undefined' && Utils.log) {
                Utils.log(message, Utils.logLevels.INFO);
            } else {
                console.info(message);
            }
        };

        logInfo("定时器管理器：正在停止所有任务...");
        // 遍历并移除所有已注册的任务
        for (const name in this._tasks) {
            // NOTE: 使用 hasOwnProperty 确保我们不会遍历到原型链上的属性
            if (Object.prototype.hasOwnProperty.call(this._tasks, name)) {
                this.removePeriodicTask(name); // 调用 removePeriodicTask 以确保逻辑统一
            }
        }
        logInfo("定时器管理器：所有任务已停止。");
    }
};