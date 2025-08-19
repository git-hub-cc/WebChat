/**
 * @file WebSocketManager.js
 * @description 管理与信令服务器的 WebSocket 通信。
 *              负责连接、断开、重连、心跳以及原始信令消息的发送和接收。
 *              MODIFIED: 增强了离线和连接失败时的用户引导，提示用户可使用手动连接功能。
 *              【核心修复】: 在连接成功后，立即发送 'REGISTER' 消息将当前用户ID注册到服务器，这是人员大厅功能正常工作的关键。
 * @module WebSocketManager
 * @exports {object} WebSocketManager
 * @dependencies Utils, AppSettings, LayoutUIManager, EventEmitter, TimerManager, UserManager
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
     * @param {function} onMessage - 接收到消息时的回调函数。
     * @param {function} onStatusChange - WebSocket 连接状态改变时的回调函数。
     * @returns {Promise<void>}
     */
    init: function(onMessage, onStatusChange) {
        this._onMessageHandler = onMessage;
        this._onStatusChangeHandler = onStatusChange;
        return this.connect();
    },

    /**
     * 连接到 WebSocket 信令服务器。
     * MODIFIED: 增加了对 file:// 协议的检查，以支持本地离线使用。
     * @returns {Promise<void>}
     */
    connect: function() {
        // --- MODIFICATION START: Handle local file execution ---
        // 如果应用作为本地HTML文件运行，则信令服务不可用，直接提示用户。
        if (window.location.protocol === 'file:') {
            const localFileMessage = '正从本地文件运行，信令服务不可用。请使用“菜单”>“高级功能”中的手动连接。';
            Utils.log('WebSocketManager: ' + localFileMessage, Utils.logLevels.WARN);
            LayoutUIManager.updateConnectionStatusIndicator('离线模式 (本地文件)');
            NotificationUIManager.showNotification(localFileMessage, 'warning', 15000); // 持续15秒

            // 立即以失败状态结束，避免应用挂起等待连接。
            // 确保依赖此Promise的后续操作（如自动连接）不会执行。
            const oldStatus = this.isWebSocketConnected;
            this.isWebSocketConnected = false;
            if (typeof this._onStatusChangeHandler === 'function' && oldStatus) {
                this._onStatusChangeHandler(false);
            }
            if (oldStatus) EventEmitter.emit('websocketStatusUpdate');

            return Promise.reject(new Error('Cannot connect to WebSocket from file:// protocol.'));
        }
        // --- MODIFICATION END ---

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
                    this.wsReconnectAttempts = 0;
                    LayoutUIManager.updateConnectionStatusIndicator('信令服务器已连接。');
                    Utils.log('WebSocketManager: WebSocket 连接已建立。', Utils.logLevels.INFO);

                    // [核心逻辑] 连接成功后，立即用当前用户ID向服务器注册。
                    // 这对于自动重连至关重要。初始加载时的竞争条件由 AppInitializer 解决。
                    if (UserManager && UserManager.userId) {
                        Utils.log(`WebSocketManager: 正在注册用户 ID: ${UserManager.userId}`, Utils.logLevels.INFO);
                        this.sendRawMessage({
                            type: 'REGISTER',
                            userId: UserManager.userId
                        });
                    } else {
                        // 这是导致初始加载时出现错误日志的地方，但现在是预期的行为了。
                        Utils.log('WebSocketManager: 无法注册 - UserManager.userId 尚不可用 (可能是初始加载)。', Utils.logLevels.WARN);
                    }

                    this.startHeartbeat();
                    if (typeof this._onStatusChangeHandler === 'function') {
                        this._onStatusChangeHandler(true);
                    }
                    EventEmitter.emit('websocketStatusUpdate');
                    resolve();
                };

                this.websocket.onmessage = (event) => {
                    try {
                        const message = JSON.parse(event.data);
                        if (message.type === 'PONG') {
                            Utils.log('WebSocketManager: 收到 WebSocket 心跳回复 (PONG)', Utils.logLevels.DEBUG);
                            return;
                        }
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
                    this.stopHeartbeat();
                    this.wsReconnectAttempts++;
                    Utils.log(`WebSocketManager: WebSocket 连接已关闭。正在进行第 ${this.wsReconnectAttempts} 次重连尝试...`, Utils.logLevels.WARN);

                    if (typeof this._onStatusChangeHandler === 'function' && oldStatus) {
                        this._onStatusChangeHandler(false);
                    }

                    if (this.wsReconnectAttempts <= AppSettings.reconnect.websocket.maxAttempts) {
                        const delay = Math.min(30000, AppSettings.reconnect.websocket.backoffBase * Math.pow(2, this.wsReconnectAttempts - 1));
                        LayoutUIManager.updateConnectionStatusIndicator(`信令服务器已断开。${delay / 1000}秒后尝试重连...`);
                        Utils.log(`WebSocketManager: 下一次重连将在 ${delay / 1000} 秒后。`, Utils.logLevels.WARN);
                        setTimeout(() => this.connect().catch(err => Utils.log(`WebSocketManager: 重连尝试失败: ${err.message || err}`, Utils.logLevels.ERROR)), delay);
                    } else {
                        // --- MODIFICATION START: Enhanced user guidance on final failure ---
                        LayoutUIManager.updateConnectionStatusIndicator('信令服务器连接失败。自动重连已停止。');
                        const finalFailureMessage = '无法连接到信令服务器。您仍可通过“菜单” > “高级功能”中的手动方式建立连接。';
                        NotificationUIManager.showNotification(finalFailureMessage, 'error', 15000); // 持续15秒
                        Utils.log(`WebSocketManager: 已达到最大重连次数 (${AppSettings.reconnect.websocket.maxAttempts})，停止自动重连。`, Utils.logLevels.ERROR);
                        // --- MODIFICATION END ---
                    }
                    if (oldStatus) EventEmitter.emit('websocketStatusUpdate');
                };

                this.websocket.onerror = (errorEvent) => {
                    Utils.log('WebSocketManager: WebSocket 错误: ' + JSON.stringify(errorEvent), Utils.logLevels.ERROR);
                    LayoutUIManager.updateConnectionStatusIndicator('信令服务器连接错误。');
                    const oldStatus = this.isWebSocketConnected;
                    this.isWebSocketConnected = false;
                    if (typeof this._onStatusChangeHandler === 'function' && oldStatus) {
                        this._onStatusChangeHandler(false);
                    }
                    if (oldStatus) EventEmitter.emit('websocketStatusUpdate');
                    reject(new Error("WebSocket connection error."));
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
        this.stopHeartbeat();
        if (typeof TimerManager !== 'undefined') {
            TimerManager.addPeriodicTask(
                this._HEARTBEAT_TASK_NAME,
                () => {
                    if (this.websocket && this.websocket.readyState === WebSocket.OPEN) {
                        this.sendRawMessage({ type: 'PING' });
                        Utils.log('WebSocketManager: 发送 WebSocket 心跳 (PING)', Utils.logLevels.DEBUG);
                    }
                },
                AppSettings.network.websocketHeartbeatInterval
            );
        } else {
            Utils.log("WebSocketManager: TimerManager 未定义，无法启动心跳。", Utils.logLevels.ERROR);
        }
    },

    stopHeartbeat: function() {
        if (typeof TimerManager !== 'undefined') {
            TimerManager.removePeriodicTask(this._HEARTBEAT_TASK_NAME);
            Utils.log('WebSocketManager: 已停止 WebSocket 心跳 (via TimerManager)', Utils.logLevels.DEBUG);
        }
    },

    sendRawMessage: function(messageObject, isInternalSilentFlag = false) {
        if (this.websocket && this.websocket.readyState === WebSocket.OPEN) {
            try {
                const messageString = JSON.stringify(messageObject);
                this.websocket.send(messageString);
                // 避免对 PING 消息进行冗余记录
                if (messageObject.type !== 'PING') {
                    Utils.log(`WebSocketManager: 已发送 WS 消息: ${messageObject.type}`, Utils.logLevels.DEBUG);
                }
                return true;
            } catch (e) {
                Utils.log(`WebSocketManager: 序列化或发送 WS 消息时出错: ${e}`, Utils.logLevels.ERROR);
                return false;
            }
        } else {
            Utils.log('WebSocketManager: WebSocket 未连接，无法发送信令消息。', Utils.logLevels.ERROR);
            if (!isInternalSilentFlag) {
                if (window.location.protocol === 'file:') {
                    NotificationUIManager.showNotification('正从本地文件系统运行。信令服务不可用。消息未发送。', 'warning');
                } else {
                    NotificationUIManager.showNotification('未连接到信令服务器。消息未发送。', 'error');
                }
            }
            return false;
        }
    },

    disconnect: function() {
        this.stopHeartbeat();
        if (this.websocket) {
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