/**
 * @file WebSocketManager.js
 * @description 管理与信令服务器的 WebSocket 通信。
 *              负责连接、断开、重连、心跳以及原始信令消息的发送和接收。
 * @module WebSocketManager
 * @exports {object} WebSocketManager
 * @dependencies Utils, AppSettings, LayoutUIManager, EventEmitter, TimerManager
 */
const WebSocketManager = {
    websocket: null, // WebSocket 实例
    isWebSocketConnected: false, // WebSocket 是否已连接
    signalingServerUrl: AppSettings.server.signalingServerUrl, // 信令服务器 URL
    wsReconnectAttempts: 0, // WebSocket 重连尝试次数
    // heartbeatInterval: null, // Moved to TimerManager
    _HEARTBEAT_TASK_NAME: 'webSocketHeartbeat', // Unique name for heartbeat task

    _onMessageHandler: null, // 外部设置的消息处理回调
    _onStatusChangeHandler: null, // 外部设置的状态变更回调

    /**
     * 初始化 WebSocketManager 并尝试连接。
     * @param {function} onMessage - 接收到消息时的回调函数 (参数: parsedMessage)。
     * @param {function} onStatusChange - WebSocket 连接状态改变时的回调函数 (参数: isConnected)。
     * @returns {Promise<void>} - A promise that resolves when connection is attempted.
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

        LayoutUIManager.updateConnectionStatusIndicator('正在连接信令服务器...');
        Utils.log('WebSocketManager: 尝试连接到 WebSocket: ' + this.signalingServerUrl, Utils.logLevels.INFO);

        return new Promise((resolve, reject) => {
            try {
                this.websocket = new WebSocket(this.signalingServerUrl);

                this.websocket.onopen = () => {
                    this.isWebSocketConnected = true;
                    this.wsReconnectAttempts = 0; // 重置重连次数
                    LayoutUIManager.updateConnectionStatusIndicator('信令服务器已连接。');
                    Utils.log('WebSocketManager: WebSocket 连接已建立。', Utils.logLevels.INFO);

                    this.startHeartbeat(); // 启动心跳
                    if (typeof this._onStatusChangeHandler === 'function') {
                        this._onStatusChangeHandler(true); // 通知状态变更
                    }
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
                        this._onStatusChangeHandler(false); // 通知状态变更
                    }

                    if (this.wsReconnectAttempts <= 3) { // 最多尝试3次
                        const delay = Math.min(30000, 1000 * Math.pow(2, this.wsReconnectAttempts)); // 指数退避
                        LayoutUIManager.updateConnectionStatusIndicator(`信令服务器已断开。${delay / 1000}秒后尝试重连...`);
                        Utils.log(`WebSocketManager: 下一次重连将在 ${delay / 1000} 秒后。`, Utils.logLevels.WARN);
                        setTimeout(() => this.connect().catch(err => Utils.log(`WebSocketManager: 重连尝试失败: ${err.message || err}`, Utils.logLevels.ERROR)), delay);
                    } else {
                        LayoutUIManager.updateConnectionStatusIndicator('信令服务器连接失败。自动重连已停止。');
                        NotificationUIManager.showNotification('无法连接到信令服务器。请检查您的网络并手动刷新或重新连接。', 'error');
                        Utils.log('WebSocketManager: 已达到最大重连次数 (3)，停止自动重连。', Utils.logLevels.ERROR);
                    }
                    if (oldStatus) EventEmitter.emit('websocketStatusUpdate');
                    // For onclose, we don't reject the promise from the initial connect call,
                    // as that promise might have already resolved. This is for subsequent disconnections.
                };

                this.websocket.onerror = (errorEvent) => { // Changed 'error' to 'errorEvent' to avoid conflict
                    Utils.log('WebSocketManager: WebSocket 错误: ' + JSON.stringify(errorEvent), Utils.logLevels.ERROR);
                    LayoutUIManager.updateConnectionStatusIndicator('信令服务器连接错误。');
                    const oldStatus = this.isWebSocketConnected;
                    this.isWebSocketConnected = false;
                    if (typeof this._onStatusChangeHandler === 'function' && oldStatus) {
                        this._onStatusChangeHandler(false);
                    }
                    if (oldStatus) EventEmitter.emit('websocketStatusUpdate');
                    reject(new Error("WebSocket connection error.")); // For initial connect, reject on error.
                };
            } catch (error) {
                Utils.log('WebSocketManager: 创建 WebSocket 连接失败: ' + error, Utils.logLevels.ERROR);
                LayoutUIManager.updateConnectionStatusIndicator('连接信令服务器失败。');
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
                25000 // 每25秒发送一次
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
                if (window.location.protocol === 'file:') {
                    NotificationUIManager.showNotification('正从本地文件系统运行。信令服务器可能不可用。消息未发送。', 'warning');
                } else {
                    NotificationUIManager.showNotification('未连接到信令服务器。消息未发送。', 'error');
                }
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
            // Remove onclose temporarily to prevent auto-reconnect logic during manual disconnect
            const originalOnClose = this.websocket.onclose;
            this.websocket.onclose = null;

            this.websocket.close();
            this.websocket = null;
            this.isWebSocketConnected = false;
            Utils.log('WebSocketManager: WebSocket 连接已手动断开。', Utils.logLevels.INFO);

            // Restore onclose if needed, or ensure it's cleared if not
            // For a full disconnect, probably best to leave it null or reassign if an external handler exists
            // this.websocket.onclose = originalOnClose; // Or set to a default if re-init is expected

            if (typeof this._onStatusChangeHandler === 'function') {
                this._onStatusChangeHandler(false);
            }
            EventEmitter.emit('websocketStatusUpdate');
        }
    }
};