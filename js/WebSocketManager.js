/**
 * @file WebSocketManager.js
 * @description 管理与信令服务器的 WebSocket 通信。
 *              负责连接、断开、重连、心跳以及原始信令消息的发送和接收。
 *              REFACTORED: (第2阶段) 移除了所有对 LayoutUIManager 的直接调用，完全通过事件和回调来通信。
 * @module WebSocketManager
 * @exports {object} WebSocketManager
 * @dependencies Utils, AppSettings, EventEmitter, TimerManager
 */
const WebSocketManager = {
    websocket: null, // WebSocket 实例
    isWebSocketConnected: false, // WebSocket 是否已连接
    signalingServerUrl: AppSettings.server.signalingServerUrl, // 信令服务器 URL
    wsReconnectAttempts: 0, // WebSocket 重连尝试次数
    _HEARTBEAT_TASK_NAME: 'webSocketHeartbeat', // 心跳任务的唯一名称

    _onMessageHandler: null, // 外部设置的消息处理回调
    _onStatusChangeHandler: null, // 外部设置的状态变更回调

    /**
     * 初始化 WebSocketManager 并尝试连接。
     * @param {function} onMessage - 接收到消息时的回调函数 (参数: parsedMessage)。
     * @param {function} onStatusChange - WebSocket 连接状态改变时的回调函数 (参数: isConnected)。
     * @returns {Promise<void>} - 一个在尝试连接时解析的 Promise。
     */
    init: function(onMessage, onStatusChange) {
        this._onMessageHandler = onMessage;
        this._onStatusChangeHandler = onStatusChange;
        return this.connect(); // 尝试连接并返回 Promise
    },

    /**
     * 连接到 WebSocket 信令服务器。
     * @returns {Promise<void>}
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

                this.websocket.onopen = () => {
                    this.isWebSocketConnected = true;
                    this.wsReconnectAttempts = 0; // 重置重连次数
                    Utils.log('WebSocketManager: WebSocket 连接已建立。', Utils.logLevels.INFO);

                    this.startHeartbeat(); // 启动心跳

                    // 通过回调通知外部状态已连接
                    if (typeof this._onStatusChangeHandler === 'function') {
                        this._onStatusChangeHandler(true);
                    }

                    // REFACTORED (Phase 1): 移除直接UI调用，通过事件解耦。
                    EventEmitter.emit('websocketStatusUpdate'); // 触发全局事件

                    resolve();
                };

                this.websocket.onmessage = (event) => {
                    try {
                        const message = JSON.parse(event.data);
                        if (message.type === 'PONG') { // 处理心跳回复
                            Utils.log('WebSocketManager: 收到 WebSocket 心跳回复 (PONG)', Utils.logLevels.DEBUG);
                            return;
                        }
                        // 调用外部消息处理器
                        if (typeof this._onMessageHandler === 'function') {
                            this._onMessageHandler(message);
                        }
                    } catch (e) {
                        Utils.log('WebSocketManager: 解析信令消息时出错: ' + e, Utils.logLevels.ERROR);
                    }
                };

                this.websocket.onclose = () => {
                    const oldStatus = this.isWebSocketConnected;
                    this.isWebSocketConnected = false;
                    this.stopHeartbeat(); // 停止心跳
                    this.wsReconnectAttempts++;
                    Utils.log(`WebSocketManager: WebSocket 连接已关闭。正在进行第 ${this.wsReconnectAttempts} 次重连尝试...`, Utils.logLevels.WARN);

                    if (typeof this._onStatusChangeHandler === 'function' && oldStatus) {
                        this._onStatusChangeHandler(false);
                    }

                    const wsReconnectConfig = AppSettings.reconnect.websocket;
                    if (this.wsReconnectAttempts <= wsReconnectConfig.maxAttempts) {
                        const delay = Math.min(
                            wsReconnectConfig.maxDelay,
                            wsReconnectConfig.initialDelay * Math.pow(wsReconnectConfig.backoffFactor, this.wsReconnectAttempts - 1)
                        );
                        Utils.log(`WebSocketManager: 下一次重连将在 ${delay / 1000} 秒后。`, Utils.logLevels.WARN);
                        setTimeout(() => this.connect().catch(err => Utils.log(`WebSocketManager: 重连尝试失败: ${err.message || err}`, Utils.logLevels.ERROR)), delay);
                    } else {
                        Utils.log(`WebSocketManager: 已达到最大重连次数 (${wsReconnectConfig.maxAttempts})，停止自动重连。`, Utils.logLevels.ERROR);
                    }

                    // 仅当状态实际发生变化时才触发事件
                    if (oldStatus) EventEmitter.emit('websocketStatusUpdate');
                };

                this.websocket.onerror = (errorEvent) => {
                    Utils.log('WebSocketManager: WebSocket 错误: ' + JSON.stringify(errorEvent), Utils.logLevels.ERROR);
                    const oldStatus = this.isWebSocketConnected;
                    this.isWebSocketConnected = false;

                    if (typeof this._onStatusChangeHandler === 'function' && oldStatus) {
                        this._onStatusChangeHandler(false);
                    }
                    if (oldStatus) EventEmitter.emit('websocketStatusUpdate');

                    reject(new Error("WebSocket connection error.")); // 对于初始连接，在出错时 reject
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
     * 启动 WebSocket 心跳机制。
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
     */
    stopHeartbeat: function() {
        if (typeof TimerManager !== 'undefined') {
            TimerManager.removePeriodicTask(this._HEARTBEAT_TASK_NAME);
            Utils.log('WebSocketManager: 已停止 WebSocket 心跳 (via TimerManager)', Utils.logLevels.DEBUG);
        }
    },

    /**
     * 发送原始的 JSON 对象作为信令消息。
     * @param {object} messageObject - 要发送的消息对象。
     * @param {boolean} [isInternalSilentFlag=false] - 是否为内部静默操作 (影响错误通知)。
     * @returns {boolean} - 是否成功发送 (或排队发送)。
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
            if (!isInternalSilentFlag) {
                // REFACTORED (Phase 1): 不再直接调用UI，上层逻辑(如ConnectionManager)应处理通知。
            }
            return false;
        }
    },

    /**
     * 断开 WebSocket 连接。
     */
    disconnect: function() {
        this.stopHeartbeat();
        if (this.websocket) {
            // 临时移除 onclose 回调，以防止在手动断开时触发自动重连逻辑
            const originalOnClose = this.websocket.onclose;
            this.websocket.onclose = null;

            this.websocket.close();
            this.websocket = null;
            this.isWebSocketConnected = false;
            Utils.log('WebSocketManager: WebSocket 连接已手动断开。', Utils.logLevels.INFO);

            if (typeof this._onStatusChangeHandler === 'function') {
                this._onStatusChangeHandler(false);
            }
            EventEmitter.emit('websocketStatusUpdate');
        }
    }
};