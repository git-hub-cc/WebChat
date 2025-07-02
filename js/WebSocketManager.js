/**
 * @file WebSocket 通信管理器
 * @description 管理与信令服务器的 WebSocket 通信。负责连接、断开、重连、心跳以及原始信令消息的收发。通过事件和回调与上层模块解耦。
 * @module WebSocketManager
 * @exports {object} WebSocketManager - 对外暴露的 WebSocket 管理器单例。
 * @dependency Utils, AppSettings, EventEmitter, TimerManager
 */
const WebSocketManager = {
    // =================================================================
    // 常量与配置 (Constants & Config)
    // =================================================================

    // 信令服务器 URL
    signalingServerUrl: AppSettings.server.signalingServerUrl,
    // 心跳任务在 TimerManager 中的唯一名称
    _HEARTBEAT_TASK_NAME: 'webSocketHeartbeat',

    // =================================================================
    // 状态变量 (State Variables)
    // =================================================================

    // WebSocket 实例
    websocket: null,
    // WebSocket 是否已连接
    isWebSocketConnected: false,
    // WebSocket 重连尝试次数
    wsReconnectAttempts: 0,
    // 外部设置的消息处理回调函数
    _onMessageHandler: null,
    // 外部设置的状态变更回调函数
    _onStatusChangeHandler: null,

    // =================================================================
    // 公开方法 (Public Methods)
    // =================================================================

    /**
     * 初始化 WebSocketManager 并尝试连接。
     * @function init
     * @param {function} onMessage - 接收到消息时的回调函数 (参数: parsedMessage)。
     * @param {function} onStatusChange - WebSocket 连接状态改变时的回调函数 (参数: isConnected)。
     * @returns {Promise<void>} - 一个在初次尝试连接时解析的 Promise。
     */
    init: function(onMessage, onStatusChange) {
        this._onMessageHandler = onMessage;
        this._onStatusChangeHandler = onStatusChange;
        return this.connect();
    },

    /**
     * 连接到 WebSocket 信令服务器。
     * @function connect
     * @returns {Promise<void>} - 在连接成功时 resolve，在初次连接失败时 reject。
     */
    connect: function() {
        // 如果已连接或正在连接，则直接返回
        if (this.websocket && (this.websocket.readyState === WebSocket.OPEN || this.websocket.readyState === WebSocket.CONNECTING)) {
            Utils.log('WebSocketManager: WebSocket 已连接或正在连接中。', Utils.logLevels.DEBUG);
            return Promise.resolve();
        }

        Utils.log('WebSocketManager: 尝试连接到 WebSocket: ' + this.signalingServerUrl, Utils.logLevels.INFO);

        return new Promise((resolve, reject) => {
            try {
                this.websocket = new WebSocket(this.signalingServerUrl);

                // 1. 连接成功时的处理
                this.websocket.onopen = () => {
                    this.isWebSocketConnected = true;
                    this.wsReconnectAttempts = 0; // 重置重连次数
                    Utils.log('WebSocketManager: WebSocket 连接已建立。', Utils.logLevels.INFO);

                    this.startHeartbeat(); // 启动心跳

                    // 通过回调和事件通知外部
                    if (typeof this._onStatusChangeHandler === 'function') {
                        this._onStatusChangeHandler(true);
                    }
                    EventEmitter.emit('websocketStatusUpdate');

                    resolve();
                };

                // 2. 收到消息时的处理
                this.websocket.onmessage = (event) => {
                    try {
                        const message = JSON.parse(event.data);
                        // 处理心跳回复，不传递给上层
                        if (message.type === 'PONG') {
                            Utils.log('WebSocketManager: 收到 WebSocket 心跳回复 (PONG)', Utils.logLevels.DEBUG);
                            return;
                        }
                        // 调用外部注册的消息处理器
                        if (typeof this._onMessageHandler === 'function') {
                            this._onMessageHandler(message);
                        }
                    } catch (e) {
                        Utils.log('WebSocketManager: 解析信令消息时出错: ' + e, Utils.logLevels.ERROR);
                    }
                };

                // 3. 连接关闭时的处理（包含自动重连逻辑）
                this.websocket.onclose = () => {
                    const oldStatus = this.isWebSocketConnected;
                    this.isWebSocketConnected = false;
                    this.stopHeartbeat(); // 停止心跳
                    this.wsReconnectAttempts++;
                    Utils.log(`WebSocketManager: WebSocket 连接已关闭。正在进行第 ${this.wsReconnectAttempts} 次重连尝试...`, Utils.logLevels.WARN);

                    // 通知外部状态变更
                    if (typeof this._onStatusChangeHandler === 'function' && oldStatus) {
                        this._onStatusChangeHandler(false);
                    }
                    if (oldStatus) EventEmitter.emit('websocketStatusUpdate');

                    // 自动重连逻辑
                    const wsReconnectConfig = AppSettings.reconnect.websocket;
                    if (this.wsReconnectAttempts <= wsReconnectConfig.maxAttempts) {
                        // 计算指数退避延迟
                        const delay = Math.min(
                            wsReconnectConfig.maxDelay,
                            wsReconnectConfig.initialDelay * Math.pow(wsReconnectConfig.backoffFactor, this.wsReconnectAttempts - 1)
                        );
                        Utils.log(`WebSocketManager: 下一次重连将在 ${delay / 1000} 秒后。`, Utils.logLevels.WARN);
                        setTimeout(() => this.connect().catch(err => Utils.log(`WebSocketManager: 重连尝试失败: ${err.message || err}`, Utils.logLevels.ERROR)), delay);
                    } else {
                        Utils.log(`WebSocketManager: 已达到最大重连次数 (${wsReconnectConfig.maxAttempts})，停止自动重连。`, Utils.logLevels.ERROR);
                    }
                };

                // 4. 连接发生错误时的处理
                this.websocket.onerror = (errorEvent) => {
                    Utils.log('WebSocketManager: WebSocket 错误: ' + JSON.stringify(errorEvent), Utils.logLevels.ERROR);
                    const oldStatus = this.isWebSocketConnected;
                    this.isWebSocketConnected = false;

                    // 通知外部状态变更
                    if (typeof this._onStatusChangeHandler === 'function' && oldStatus) {
                        this._onStatusChangeHandler(false);
                    }
                    if (oldStatus) EventEmitter.emit('websocketStatusUpdate');

                    // 对于初始连接，在出错时 reject Promise
                    reject(new Error("WebSocket connection error."));
                };
            } catch (error) {
                Utils.log('WebSocketManager: 创建 WebSocket 连接失败: ' + error, Utils.logLevels.ERROR);
                const oldStatus = this.isWebSocketConnected;
                this.isWebSocketConnected = false;
                if (typeof this._onStatusChangeHandler === 'function' && oldStatus) {
                    this._onStatusChangeHandler(false);
                }
                if (oldStatus) EventEmitter.emit('websocketStatusUpdate');
                reject(error);
            }
        });
    },

    /**
     * 发送原始的 JSON 对象作为信令消息。
     * @function sendRawMessage
     * @param {object} messageObject - 要发送的消息对象。
     * @param {boolean} [isInternalSilentFlag=false] - 是否为内部静默操作 (影响错误通知)。
     * @returns {boolean} - 是否成功发送 (或排队等待发送)。
     */
    sendRawMessage: function(messageObject, isInternalSilentFlag = false) {
        if (this.websocket && this.websocket.readyState === WebSocket.OPEN) {
            try {
                const messageString = JSON.stringify(messageObject);
                this.websocket.send(messageString);
                Utils.log(`WebSocketManager: 已发送 WS 消息: ${messageObject.type}`, Utils.logLevels.DEBUG);
                return true;
            } catch (e) {
                Utils.log(`WebSocketManager: 序列化或发送 WS 消息时出错: ${e}`, Utils.logLevels.ERROR);
                return false;
            }
        } else {
            Utils.log('WebSocketManager: WebSocket 未连接，无法发送信令消息。', Utils.logLevels.ERROR);
            // NOTE: 不再直接调用UI，上层逻辑(如ConnectionManager)应处理错误通知。
            if (!isInternalSilentFlag) {
                // 上层模块负责通知用户
            }
            return false;
        }
    },

    /**
     * 断开 WebSocket 连接。
     * @function disconnect
     */
    disconnect: function() {
        this.stopHeartbeat();
        if (this.websocket) {
            // NOTE: 临时移除 onclose 回调，以防止在手动断开时触发自动重连逻辑
            this.websocket.onclose = null;

            this.websocket.close();
            this.websocket = null;
            this.isWebSocketConnected = false;
            Utils.log('WebSocketManager: WebSocket 连接已手动断开。', Utils.logLevels.INFO);

            // 通知外部状态变更
            if (typeof this._onStatusChangeHandler === 'function') {
                this._onStatusChangeHandler(false);
            }
            EventEmitter.emit('websocketStatusUpdate');
        }
    },

    // =================================================================
    // 内部和工具方法 (Internal & Utility Methods)
    // =================================================================

    /**
     * 启动 WebSocket 心跳机制。
     * @function startHeartbeat
     */
    startHeartbeat: function() {
        this.stopHeartbeat(); // 先停止可能存在的旧心跳
        if (typeof TimerManager !== 'undefined') {
            TimerManager.addPeriodicTask(
                this._HEARTBEAT_TASK_NAME,
                () => {
                    if (this.websocket && this.websocket.readyState === WebSocket.OPEN) {
                        this.sendRawMessage({ type: 'PING' }); // 发送 PING 消息
                        Utils.log('WebSocketManager: 发送 WebSocket 心跳 (PING)', Utils.logLevels.DEBUG);
                    }
                },
                AppSettings.timers.websocketHeartbeat
            );
        } else {
            Utils.log("WebSocketManager: TimerManager 未定义，无法启动心跳。", Utils.logLevels.ERROR);
        }
    },

    /**
     * 停止 WebSocket 心跳定时器。
     * @function stopHeartbeat
     */
    stopHeartbeat: function() {
        if (typeof TimerManager !== 'undefined') {
            TimerManager.removePeriodicTask(this._HEARTBEAT_TASK_NAME);
            Utils.log('WebSocketManager: 已停止 WebSocket 心跳 (via TimerManager)', Utils.logLevels.DEBUG);
        }
    },
};