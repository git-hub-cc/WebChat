/**
 * @file TimerManager.js
 * @description 管理应用中所有使用的周期性定时器 (setInterval)。
 *              提供一种集中的方式来添加、移除和控制这些定时器。
 * @module TimerManager
 * @exports {object} TimerManager - 用于定时器管理的单例对象。
 * @property {function} init - 初始化 TimerManager。
 * @property {function} addPeriodicTask - 添加或更新一个具名的周期性任务。
 * @property {function} removePeriodicTask - 移除并停止一个具名的周期性任务。
 * @property {function} hasTask - 检查是否存在具有给定名称的任务。
 * @dependencies Utils (假设的依赖，用于日志)
 */
const TimerManager = {
    _tasks: {}, // 存储任务详情: { 任务名: { intervalId定时器ID, callback回调函数, intervalMs间隔毫秒, isRunning是否运行中 } }

    /**
     * 初始化 TimerManager。
     * (目前除了创建之外，不需要特定的初始化步骤)。
     */
    init: function() {
        // 假设 Utils.log 和 Utils.logLevels 存在
        if (typeof Utils !== 'undefined' && Utils.log) {
            Utils.log("定时器管理器已初始化。", Utils.logLevels.INFO);
        } else {
            console.info("定时器管理器已初始化。");
        }
    },

    /**
     * 添加或更新一个具名的周期性任务。
     * 如果已存在同名任务，则会先停止并替换旧任务。
     * @param {string} name - 任务的唯一名称。
     * @param {function} callback - 周期性执行的函数。
     * @param {number} intervalMs - 间隔时间，单位毫秒。
     * @param {boolean} [runImmediately=false] - 如果为 true，则在启动定时器前立即执行一次回调。
     */
    addPeriodicTask: function(name, callback, intervalMs, runImmediately = false) {
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
                console.debug(message); // console.debug 可能在某些环境不显示，可以用 console.log
            }
        };

        if (!name || typeof callback !== 'function' || typeof intervalMs !== 'number' || intervalMs <= 0) {
            logError(`定时器管理器：addPeriodicTask 参数无效 (任务名: ${name})。任务未添加。`);
            return;
        }

        // 如果任务已存在，先移除它以防止同一名称有多个定时器
        if (this._tasks[name] && this._tasks[name].intervalId) {
            this.removePeriodicTask(name); // removePeriodicTask 内部会打印日志
            logDebug(`定时器管理器：已替换现有任务：${name}`);
        }

        if (runImmediately) {
            try {
                callback();
            } catch (error) {
                logError(`定时器管理器：立即执行任务 "${name}" 时出错：${error.message}`);
            }
        }

        const intervalId = setInterval(() => {
            try {
                callback();
            } catch (error) {
                logError(`定时器管理器：周期性任务 "${name}" 执行出错：${error.message}`);
                // 可选：如果任务持续失败，则停止该任务，或实现重试逻辑。
                // 目前，我们将让它继续尝试。
            }
        }, intervalMs);

        this._tasks[name] = {
            intervalId: intervalId,
            callback: callback, // 存储回调以便将来使用 (例如，手动触发)
            intervalMs: intervalMs,
            isRunning: true
        };
        logInfo(`定时器管理器：周期性任务 "${name}" 已添加，间隔 ${intervalMs}毫秒。`);
    },

    /**
     * 移除并停止一个具名的周期性任务。
     * @param {string} name - 要移除的任务的名称。
     */
    removePeriodicTask: function(name) {
        const logInfo = (message) => {
            if (typeof Utils !== 'undefined' && Utils.log) {
                Utils.log(message, Utils.logLevels.INFO);
            } else {
                console.info(message);
            }
        };
        const logWarn = (message) => {
            if (typeof Utils !== 'undefined' && Utils.log) {
                Utils.log(message, Utils.logLevels.WARN);
            } else {
                console.warn(message);
            }
        };

        const task = this._tasks[name];
        if (task && task.intervalId) {
            clearInterval(task.intervalId);
            delete this._tasks[name];
            logInfo(`定时器管理器：周期性任务 "${name}" 已移除并停止。`);
        } else {
            logWarn(`定时器管理器：尝试移除不存在或已停止的任务：${name}`);
        }
    },

    /**
     * 检查是否存在具有给定名称的任务并且该任务正在运行。
     * @param {string} name - 任务的名称。
     * @returns {boolean} - 如果任务存在且正在运行，则返回 true，否则返回 false。
     */
    hasTask: function(name) {
        return !!(this._tasks[name] && this._tasks[name].isRunning);
    },

    /**
     * 停止所有受管理的周期性任务。
     * 用于应用程序关闭或清理。
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
        for (const name in this._tasks) {
            // hasOwnProperty 检查确保我们不会遍历原型链上的属性
            if (Object.prototype.hasOwnProperty.call(this._tasks, name)) {
                this.removePeriodicTask(name); // removePeriodicTask 内部会打印日志
            }
        }
        logInfo("定时器管理器：所有任务已停止。");
    }
};
