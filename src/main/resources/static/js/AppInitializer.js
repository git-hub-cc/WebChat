const AppInitializer = {

    init: async function () {
        // 检查浏览器兼容性
        if (!UIManager.checkWebRTCSupport()) return;

        try {
            // 初始化IndexedDB
            await DBManager.init();
            Utils.log('数据库初始化成功', Utils.logLevels.INFO);

            // 初始化用户管理
            await UserManager.init();

            // 初始化聊天管理
            await ChatManager.init();

            // 检查网络状态
            this.checkNetworkType();

            // 添加网络状态监听
            this.startNetworkMonitoring();

            // 初始化语音录制按钮（但不申请权限）
            MediaManager.initVoiceRecording();

            // 初始化视频通话按钮（但不申请权限）
            VideoCallManager.init();

            // 添加按钮事件处理程序
            this.setupEventListeners();

            // 初始化移动端UI
            this.initMobileUI();

            // 初始化群聊管理
            await GroupManager.init();

            ConnectionManager.initialize();

            Utils.log('应用已初始化', Utils.logLevels.INFO);
        } catch (error) {
            Utils.log(`应用初始化失败: ${error}`, Utils.logLevels.ERROR);

            // 回退到localStorage模式
            Utils.log('回退到localStorage存储模式', Utils.logLevels.WARN);

            // 初始化用户管理
            UserManager.userId = Utils.generateId();
            document.getElementById('userIdValue').textContent = UserManager.userId;

            // 加载联系人
            UserManager.loadContactsFromLocalStorage();

            // 初始化聊天管理
            ChatManager.loadChatsFromLocalStorage();

            // 其他初始化步骤
            this.checkNetworkType();
            this.startNetworkMonitoring();
            MediaManager.initVoiceRecording();
            VideoCallManager.init();
            this.setupEventListeners();
            this.initMobileUI();

            // 加载群组
            GroupManager.loadGroupsFromLocalStorage();

            Utils.log('应用已使用localStorage模式初始化', Utils.logLevels.INFO);
        }
    },

    // 初始化移动端UI
    initMobileUI: function() {
        // 添加返回设置按钮事件
        const backButton = document.getElementById('backToSettings');
        if (backButton) {
            backButton.addEventListener('click', function() {
                document.querySelector('.container').classList.remove('connected-mode');
            });
        }

        // 响应屏幕尺寸变化
        window.addEventListener('resize', function() {
            const container = document.querySelector('.container');
            const isConnected = document.getElementById('connectionStatus').classList.contains('connected');
            const sidebar = document.querySelector('.sidebar');

            // 如果是移动端且已连接，保持聊天界面显示
            if (window.innerWidth <= 768 && isConnected && ChatManager.currentChatId) {
                // 显示进入聊天按钮
                if (sidebar) sidebar.classList.add('show-back-btn');
            } else if (window.innerWidth > 768) {
                // 在大屏幕上，移除连接模式类，显示两个面板
                container.classList.remove('connected-mode');
            }
        });
    },

    // 检查网络状态
    checkNetworkType: async function () {
        const networkInfo = document.getElementById('networkInfo');
        networkInfo.innerHTML = '<span class="loading-spinner"></span> 正在检测网络...';

        try {
            const networkType = await Utils.checkNetworkType();

            if (networkType) {
                let networkHtml = `
                    网络支持:<br>
                    IPv4: ${networkType.ipv4 ? '✓' : '✗'}<br>
                    IPv6: ${networkType.ipv6 ? '✓' : '✗'}<br>
                    UDP: ${networkType.udp ? '✓' : '✗'}<br>
                    TCP: ${networkType.tcp ? '✓' : '✗'}<br>
                    中继: ${networkType.relay ? '可用' : '未检测到'}<br>
                    候选数: ${networkType.count}
                `;

                // 根据网络状况调整配置
                if (!networkType.udp && networkType.tcp) {
                    Config.peerConnectionConfig.iceTransportPolicy = 'relay';
                    networkHtml += '<br><b>已切换到中继优先模式</b>';
                }

                networkInfo.innerHTML = networkHtml;

                const qualityIndicator = document.getElementById('qualityIndicator');
                if (qualityIndicator) {
                    if (networkType.udp) {
                        qualityIndicator.className = 'quality-indicator quality-good';
                        document.getElementById('qualityText').textContent = '网络良好';
                    } else if (networkType.tcp) {
                        qualityIndicator.className = 'quality-indicator quality-medium';
                        document.getElementById('qualityText').textContent = '网络受限';
                    } else {
                        qualityIndicator.className = 'quality-indicator quality-poor';
                        document.getElementById('qualityText').textContent = '网络受阻';
                    }
                }
            } else {
                networkInfo.innerHTML = '网络检测失败';
            }
        } catch (error) {
            networkInfo.innerHTML = '网络检测失败: ' + error.message;
        }
    },

    // 监听网络状态变化
    startNetworkMonitoring: function () {
        window.addEventListener('online', this.handleNetworkChange.bind(this));
        window.addEventListener('offline', this.handleNetworkChange.bind(this));
    },

    // 处理网络变化
    handleNetworkChange: function () {
        if (navigator.onLine) {
            UIManager.updateStatus('网络已恢复，尝试重新连接...');

            // 尝试重新连接所有活跃的连接
            for (const peerId in ConnectionManager.connections) {
                const conn = ConnectionManager.connections[peerId];
                if (conn && conn.peerConnection &&
                    conn.peerConnection.iceConnectionState !== 'connected') {
                    ConnectionManager.restartIce(peerId);
                }
            }
        } else {
            UIManager.updateStatus('网络已断开');
        }
    },

    // 设置事件监听
    setupEventListeners: function () {
        // 消息输入框回车发送
        document.getElementById('messageInput').addEventListener('keydown', (e) => {
            // 如果是 Ctrl+Enter 组合键，则发送消息
            if (e.key === 'Enter' && e.ctrlKey) {
                e.preventDefault();
                MessageManager.sendMessage();
            }
            // 仅按回车键时，允许换行
            else if (e.key === 'Enter' && !e.ctrlKey) {
                // 不阻止默认行为，允许输入换行符
            }
        });

        // 添加断开连接事件处理
        EventEmitter.on('connectionDisconnected', function(peerId) {
            // 如果是当前聊天，更新UI
            if (ChatManager.currentChatId === peerId) {
                // 禁用视频通话按钮
                document.getElementById('videoCallButton').disabled = true;
                // 禁用音频通话按钮
                document.getElementById('audioCallButton').disabled = true;

                // 移动端：断开连接时切换回设置界面
                if (window.innerWidth <= 768) {
                    document.querySelector('.container').classList.remove('connected-mode');
                }
            }
        });

        EventEmitter.on('connectionEstablished', function(peerId) {
            // 如果是当前聊天，更新UI
            if (ChatManager.currentChatId === peerId) {
                // 启用视频通话按钮
                document.getElementById('videoCallButton').disabled = false;
                document.getElementById('videoCallButton').onclick = () => VideoCallManager.initiateCall(peerId);

                // 启用音频通话按钮
                document.getElementById('audioCallButton').disabled = false;
                document.getElementById('audioCallButton').onclick = () => VideoCallManager.initiateAudioCall(peerId);
            }
        });

        EventEmitter.on('connectionFailed', function(peerId) {
            // 如果是当前聊天，更新UI
            if (ChatManager.currentChatId === peerId) {
                // 禁用视频通话按钮
                document.getElementById('videoCallButton').disabled = true;

                // 移动端：连接失败时切换回设置界面
                if (window.innerWidth <= 768) {
                    document.querySelector('.container').classList.remove('connected-mode');
                }
            }
        });

        // 语音录制按钮事件
        const voiceButton = document.getElementById('voiceButton');

        // 检测是否为移动设备
        if ('ontouchstart' in window) {
            // 移动设备使用触摸事件
            voiceButton.addEventListener('touchstart', function (e) {
                e.preventDefault();
                MediaManager.startRecording();
            });

            voiceButton.addEventListener('touchend', function (e) {
                e.preventDefault();
                MediaManager.stopRecording();
            });
        } else {
            // 桌面设备使用鼠标事件
            voiceButton.addEventListener('mousedown', MediaManager.startRecording.bind(MediaManager));
            voiceButton.addEventListener('mouseup', MediaManager.stopRecording.bind(MediaManager));
            voiceButton.addEventListener('mouseleave', MediaManager.stopRecording.bind(MediaManager));
        }

        // 添加全局错误处理
        window.addEventListener('error', (event) => {
            Utils.log(`应用错误: ${event.message}`, Utils.logLevels.ERROR);
        });

        // 添加断开连接前的提示
        window.addEventListener('beforeunload', () => {
            // 释放语音录制资源
            MediaManager.releaseAudioResources();

            // 释放视频通话资源
            VideoCallManager.releaseMediaResources();

            // 关闭所有连接
            for (const peerId in ConnectionManager.connections) {
                ConnectionManager.close(peerId);
            }
        });


        // 添加重置按钮事件
        document.getElementById('resetAllBtn').addEventListener('click', () => {
            UIManager.resetConnectionControls();
        });
    }

};
const connectionStatus = document.getElementById('connectionStatus');
const loadingOverlay = document.getElementById('loadingOverlay');

// 创建一个观察器来监视connectionStatus元素的内容变化
const observer = new MutationObserver(function(mutations) {
    mutations.forEach(function(mutation) {
        if (mutation.type === 'childList') {
            // 检查连接状态是否变为"用户注册成功"
            if (connectionStatus.textContent !== '未连接' && connectionStatus.textContent !== '信令服务器连接断开') {
                // 隐藏加载蒙版
                loadingOverlay.style.display = 'none';
                console.log('用户注册成功，移除加载蒙版');
            }
        }
    });
});

// 配置观察器
const config = { childList: true, subtree: true };

// 开始观察connectionStatus元素
observer.observe(connectionStatus, config);


// 页面加载完成后初始化
window.addEventListener('load', AppInitializer.init.bind(AppInitializer));