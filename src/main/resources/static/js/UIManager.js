
const UIManager = {
    // 更新连接状态显示
    updateConnectionState: function (connected, state = '') {
        const statusElement = document.getElementById('connectionStatus');
        if (connected) {
            statusElement.classList.add('connected');
            statusElement.classList.remove('disconnected');

            // 显示返回聊天按钮
            document.querySelector('.sidebar').classList.add('show-back-btn');
        } else {
            if (state === 'disconnected') {
                statusElement.classList.add('disconnected');
            } else {
                statusElement.classList.remove('connected');
            }
        }
    },

    // 启用/禁用聊天界面
    enableChatInterface: function(enabled) {
        const messageInput = document.getElementById('messageInput');
        const sendButton = document.getElementById('sendButton');
        const uploadButton = document.getElementById('uploadButton');
        const voiceButton = document.getElementById('voiceButton');
        const videoCallButton = document.getElementById('videoCallButton');
        const audioCallButton = document.getElementById('audioCallButton'); // 新增
        const clearChatButton = document.getElementById('clearChatButton');

        messageInput.disabled = !enabled;
        sendButton.disabled = !enabled;
        uploadButton.disabled = !enabled;
        voiceButton.disabled = !enabled;
        videoCallButton.disabled = !enabled;
        audioCallButton.disabled = !enabled; // 新增
        clearChatButton.disabled = !enabled;

        if (enabled) {
            // 聚焦输入框
            setTimeout(() => messageInput.focus(), 300);
        }
    },

    // 更新连接状态文本
    updateStatus: function (message, delay = 0) {
        const statusElement = document.getElementById('connectionStatus');

        if (delay > 0) {
            // 如果有延迟，显示倒计时
            statusElement.innerHTML = `${message} <span class="loading-spinner"></span>`;

            let countdown = Math.floor(delay / 1000);
            const timer = setInterval(() => {
                countdown--;
                if (countdown <= 0) {
                    clearInterval(timer);
                    statusElement.textContent = message;
                } else {
                    statusElement.innerHTML = `${message} (${countdown}秒) <span class="loading-spinner"></span>`;
                }
            }, 1000);
        } else {
            statusElement.textContent = message;
        }
    },

    // 更新连接质量指示器
    updateConnectionQuality: function (rtt) {
        const indicator = document.getElementById('qualityIndicator');
        const qualityText = document.getElementById('qualityText');

        if (!indicator || !qualityText) return;

        try {
            if (rtt < 0.3) {
                indicator.className = 'quality-indicator quality-good';
                qualityText.textContent = '良好';
            } else if (rtt < 0.8) {
                indicator.className = 'quality-indicator quality-medium';
                qualityText.textContent = '一般';
            } else {
                indicator.className = 'quality-indicator quality-poor';
                qualityText.textContent = '较差';
            }
        } catch (error) {
            Utils.log(`更新连接质量显示失败: ${error}`, Utils.logLevels.ERROR);
        }
    },

    // 禁用连接按钮
    disableConnectionButtons: function (stage) {
        switch (stage) {
            case 'offer':
                document.getElementById('createOfferBtn').disabled = true;
                document.getElementById('createAnswerBtn').disabled = true;
                document.getElementById('handleAnswerBtn').disabled = false;
                break;

            case 'answer':
                document.getElementById('createOfferBtn').disabled = true;
                document.getElementById('createAnswerBtn').disabled = true;
                document.getElementById('handleAnswerBtn').disabled = true;
                break;

            case 'complete':
                document.getElementById('createOfferBtn').disabled = true;
                document.getElementById('createAnswerBtn').disabled = true;
                document.getElementById('handleAnswerBtn').disabled = true;
                break;
        }
    },

    // 重置连接控件
    resetConnectionControls: function () {
        // 重置连接按钮状态
        document.getElementById('createOfferBtn').disabled = false;
        document.getElementById('createAnswerBtn').disabled = false;
        document.getElementById('handleAnswerBtn').disabled = false;

        // 如果没有活跃连接，隐藏返回聊天按钮
        let hasActiveConnection = false;
        for (const peerId in ConnectionManager.connections) {
            const conn = ConnectionManager.connections[peerId];
            if (conn && conn.dataChannel && conn.dataChannel.readyState === 'open') {
                hasActiveConnection = true;
                break;
            }
        }

        if (!hasActiveConnection) {
            document.querySelector('.sidebar').classList.remove('show-back-btn');
            this.enableChatInterface(false);

            // 移动端：切换回连接设置界面
            if (window.innerWidth <= 768) {
                document.querySelector('.container').classList.remove('connected-mode');
            }
        }
    },

    // 复制文本
    copyText: function () {
        const textarea = document.getElementById('sdpText');
        textarea.select();
        document.execCommand('copy');

        const copyButton = document.querySelector('.copy-button');
        const originalText = copyButton.textContent;

        copyButton.textContent = '已复制！';
        setTimeout(() => {
            copyButton.textContent = originalText;
        }, 2000);
    },

    // 检查WebRTC支持
    checkWebRTCSupport: function () {
        if (typeof RTCPeerConnection === 'undefined') {
            this.updateStatus('您的浏览器不支持 WebRTC，请使用 Chrome 等现代浏览器');
            Utils.log('浏览器不支持WebRTC', Utils.logLevels.ERROR);
            return false;
        }

        if (typeof navigator.mediaDevices === 'undefined' ||
            typeof navigator.mediaDevices.getUserMedia === 'undefined') {
            Utils.log('浏览器可能不完全支持媒体设备API', Utils.logLevels.WARN);
        }

        return true;
    },

    // 显示通知消息
    showNotification: function (message, type = 'info') {
        // 创建通知元素
        const notification = document.createElement('div');
        notification.className = `notification notification-${type}`;

        // 设置图标
        let icon = '';
        switch (type) {
            case 'warning':
                icon = '⚠️';
                break;
            case 'error':
                icon = '❌';
                break;
            case 'success':
                icon = '✅';
                break;
            default:
                icon = 'ℹ️';
        }

        notification.innerHTML = `
                <span class="notification-icon">${icon}</span>
                <span class="notification-message">${message}</span>
                <button class="notification-close">×</button>
            `;

        // 添加到界面
        if (!document.querySelector('.notification-container')) {
            const container = document.createElement('div');
            container.className = 'notification-container';
            document.body.appendChild(container);
        }

        const container = document.querySelector('.notification-container');
        container.appendChild(notification);

        // 点击关闭按钮移除通知
        notification.querySelector('.notification-close').addEventListener('click', () => {
            notification.classList.add('notification-hide');
            setTimeout(() => {
                if (notification.parentNode) {
                    notification.parentNode.removeChild(notification);
                }

                // 如果容器为空，移除容器
                if (container.children.length === 0) {
                    container.parentNode.removeChild(container);
                }
            }, 300);
        });

        // 自动关闭
        setTimeout(() => {
            if (notification.parentNode) {
                notification.classList.add('notification-hide');
                setTimeout(() => {
                    if (notification.parentNode) {
                        notification.parentNode.removeChild(notification);
                    }

                    // 如果容器为空，移除容器
                    if (container.children.length === 0) {
                        container.parentNode.removeChild(container);
                    }
                }, 300);
            }
        }, 10000); // 10秒后自动关闭
    },

    // 显示重连提示
    showReconnectPrompt: function(peerId, onReconnectSuccess) {
        // 创建重连提示元素
        const reconnectPrompt = document.createElement('div');
        reconnectPrompt.className = 'reconnect-prompt';
        reconnectPrompt.innerHTML = `
        <div class="reconnect-message">
            <p>连接未建立，无法发送消息</p>
            <div class="reconnect-buttons">
                <button class="reconnect-btn">重新连接</button>
                <button class="cancel-btn">取消</button>
            </div>
        </div>
    `;

        // 添加到聊天框
        const chatBox = document.getElementById('chatBox');
        chatBox.appendChild(reconnectPrompt);
        chatBox.scrollTop = chatBox.scrollHeight;

        // 设置重连按钮事件
        const reconnectBtn = reconnectPrompt.querySelector('.reconnect-btn');
        reconnectBtn.addEventListener('click', async () => {
            // 移除提示
            if (reconnectPrompt.parentNode) {
                reconnectPrompt.parentNode.removeChild(reconnectPrompt);
            }

            // 显示连接面板
            document.querySelector('.connection-tab[data-tab="connect"]').click();

            // 如果在移动设备上，切换到连接界面
            if (window.innerWidth <= 768) {
                document.querySelector('.container').classList.remove('connected-mode');
            }

            // 重置连接按钮状态
            this.resetConnectionControls();

            // 添加系统消息
            const reconnectingMsg = document.createElement('div');
            reconnectingMsg.className = 'system-message';
            reconnectingMsg.textContent = '正在尝试重新连接...';
            chatBox.appendChild(reconnectingMsg);

            // 自动开始连接流程
            try {
                // 清空之前的连接信息
                document.getElementById('sdpText').value = '';

                // 初始化新连接
                await ConnectionManager.createOffer();

                // 显示通知
                this.showNotification('请将连接信息发送给对方，并等待对方回复', 'info');

                // 监听连接状态变化
                const checkConnection = () => {
                    if (ConnectionManager.isConnectedTo(peerId)) {
                        // 连接成功
                        const successMsg = document.createElement('div');
                        successMsg.className = 'system-message success';
                        successMsg.textContent = '连接已重新建立';
                        chatBox.appendChild(successMsg);
                        chatBox.scrollTop = chatBox.scrollHeight;

                        // 执行成功回调
                        if (typeof onReconnectSuccess === 'function') {
                            onReconnectSuccess();
                        }

                        // 如果在移动设备上，切换回聊天界面
                        if (window.innerWidth <= 768) {
                            document.querySelector('.container').classList.add('connected-mode');
                        }

                        return true;
                    }
                    return false;
                };

                // 定期检查连接状态
                const checkInterval = setInterval(() => {
                    if (checkConnection()) {
                        clearInterval(checkInterval);
                    }
                }, 2000);

                // 60秒后停止检查
                setTimeout(() => {
                    clearInterval(checkInterval);
                    if (!ConnectionManager.isConnectedTo(peerId)) {
                        const failMsg = document.createElement('div');
                        failMsg.className = 'system-message error';
                        failMsg.textContent = '连接建立失败，请手动完成连接步骤';
                        chatBox.appendChild(failMsg);
                        chatBox.scrollTop = chatBox.scrollHeight;
                    }
                }, 60000);

            } catch (error) {
                Utils.log(`自动重连失败: ${error.message}`, Utils.logLevels.ERROR);
                this.showNotification('自动重连失败，请手动建立连接', 'error');
            }
        });

        // 设置取消按钮事件
        const cancelBtn = reconnectPrompt.querySelector('.cancel-btn');
        cancelBtn.addEventListener('click', () => {
            if (reconnectPrompt.parentNode) {
                reconnectPrompt.parentNode.removeChild(reconnectPrompt);
            }
        });

        // 添加样式
        if (!document.getElementById('reconnect-prompt-style')) {
            const style = document.createElement('style');
            style.id = 'reconnect-prompt-style';
            style.textContent = `
            .reconnect-prompt {
                padding: 10px;
                margin: 10px auto;
                max-width: 80%;
                background: rgba(255, 255, 255, 0.9);
                border-radius: 8px;
                box-shadow: 0 2px 10px rgba(0,0,0,0.1);
                text-align: center;
            }
            .reconnect-message {
                font-size: 14px;
                color: #333;
            }
            .reconnect-buttons {
                margin-top: 10px;
                display: flex;
                justify-content: center;
                gap: 10px;
            }
            .reconnect-btn {
                background: #007bff;
                color: white;
                border: none;
                padding: 5px 15px;
                border-radius: 4px;
                cursor: pointer;
            }
            .cancel-btn {
                background: #f44336;
                color: white;
                border: none;
                padding: 5px 15px;
                border-radius: 4px;
                cursor: pointer;
            }
            .system-message {
                text-align: center;
                padding: 5px 10px;
                margin: 5px auto;
                font-size: 12px;
                color: #666;
                background: rgba(0,0,0,0.05);
                border-radius: 10px;
                max-width: 80%;
            }
            .system-message.success {
                color: #4CAF50;
            }
            .system-message.error {
                color: #f44336;
            }
        `;
            document.head.appendChild(style);
        }
    }
};