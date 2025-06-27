/**
 * @file VideoCallUIManager.js
 * @description 视频通话 UI 管理器，负责管理所有与视频通话相关的用户界面元素。
 *              包括本地/远程视频的显示、通话控制按钮的更新，以及画中画 (PiP) 模式的 UI 和拖动功能。
 *              现在能显示五级音频质量状态。
 *              优化了 PiP 模式拖动效果，防止页面文字在拖动时被选中，并提升拖动响应速度。
 * @module VideoCallUIManager
 * @exports {object} VideoCallUIManager - 对外暴露的单例对象，包含管理视频通话 UI 的方法。
 * @property {function} init - 初始化模块，获取 DOM 元素并绑定事件。
 * @property {function} showCallContainer - 显示或隐藏整个通话 UI 容器。
 * @property {function} updateUIForCallState - 根据通话状态更新所有相关的 UI 元素。
 * @property {function} togglePipMode - 切换画中画模式。
 * @dependencies Utils, VideoCallManager, EventEmitter, LayoutUIManager, AppSettings
 * @dependents AppInitializer (进行初始化), VideoCallManager (调用以更新 UI)
 */
const VideoCallUIManager = {
    localVideo: null, // 本地视频元素
    remoteVideo: null, // 远程视频元素
    pipButton: null, // 画中画按钮
    callContainer: null, // 通话UI主容器
    audioOnlyBtn: null, // 纯音频模式切换按钮
    cameraBtn: null, // 摄像头切换按钮
    audioBtn: null, // 麦克风切换按钮
    endCallBtn: null, // 结束通话按钮
    audioQualityIndicatorEl: null, // 音频质量指示器元素

    isPipMode: false, // 当前是否为画中画模式
    // 拖动相关信息
    dragInfo: {
        active: false, currentX: 0, currentY: 0,
        initialX: 0, initialY: 0, xOffset: 0, yOffset: 0,
        draggedElement: null, // 当前拖动的元素
        originalTransition: '' // 存储原始的transition属性，以便恢复
    },
    // 绑定的事件处理函数，用于正确移除监听器
    _boundDragStart: null,
    _boundDragStartTouch: null,
    _boundDrag: null,
    _boundDragTouch: null,
    _boundDragEnd: null,
    _boundDragEndTouch: null,

    /**
     * 初始化模块，获取所有需要的 DOM 元素引用并绑定核心事件。
     */
    init: function() {
        this.localVideo = document.getElementById('localVideo');
        this.remoteVideo = document.getElementById('remoteVideo');
        this.pipButton = document.getElementById('togglePipBtn');
        this.callContainer = document.getElementById('videoCallContainer');
        this.audioOnlyBtn = document.getElementById('audioOnlyBtn');
        this.cameraBtn = document.getElementById('toggleCameraBtn');
        this.audioBtn = document.getElementById('toggleAudioBtn');
        this.endCallBtn = this.callContainer ? this.callContainer.querySelector('.end-call') : null;
        this.audioQualityIndicatorEl = document.getElementById('audioQualityIndicator');

        // 绑定拖动事件处理函数到当前上下文
        this._boundDragStart = this.dragStart.bind(this);
        this._boundDragStartTouch = this.dragStart.bind(this); // 触摸也使用相同的开始逻辑
        this._boundDrag = this.drag.bind(this);
        this._boundDragTouch = this.drag.bind(this); // 触摸也使用相同的拖动逻辑
        this._boundDragEnd = this.dragEnd.bind(this);
        this._boundDragEndTouch = this.dragEnd.bind(this); // 触摸也使用相同的结束逻辑

        this.bindEvents(); // 绑定UI事件

        // 监听音频配置档案变更事件以更新UI
        if (typeof EventEmitter !== 'undefined') {
            EventEmitter.on('audioProfileChanged', this._updateAudioQualityDisplay.bind(this));
        }
    },

    /**
     * 绑定通话 UI 内的事件监听器。
     */
    bindEvents: function() {
        if (this.pipButton) this.pipButton.addEventListener('click', () => this.togglePipMode());
        if (this.cameraBtn) this.cameraBtn.addEventListener('click', () => VideoCallManager.toggleCamera());
        if (this.audioBtn) this.audioBtn.addEventListener('click', () => VideoCallManager.toggleAudio());
        if (this.audioOnlyBtn) this.audioOnlyBtn.addEventListener('click', () => VideoCallManager.toggleAudioOnly());
        if (this.endCallBtn) this.endCallBtn.addEventListener('click', () => VideoCallManager.hangUpMedia());
    },

    /**
     * 显示或隐藏整个通话 UI 容器。
     * @param {boolean} [display=true] - true 为显示，false 为隐藏。
     */
    showCallContainer: function(display = true) {
        if (this.callContainer) {
            this.callContainer.style.display = display ? 'flex' : 'none'; // 'flex' 用于容器的布局
            if (!display) { // 如果隐藏容器
                this.resetPipVisuals(); // 重置画中画视觉效果
                if (this.audioQualityIndicatorEl) { // 隐藏音频质量指示器
                    this.audioQualityIndicatorEl.style.display = 'none';
                }
            }
        }
    },

    /**
     * @private
     * @description 更新音频质量指示器的显示。
     * @param {object} data - 事件数据，包含 { peerId, profileName, profileIndex, description }。
     */
    _updateAudioQualityDisplay: function(data) {
        // 检查指示器元素是否存在、通话是否激活以及对方ID是否匹配
        if (!this.audioQualityIndicatorEl || !VideoCallManager.isCallActive || VideoCallManager.currentPeerId !== data.peerId) {
            return;
        }
        const qualityText = data.profileName || `等级 ${data.profileIndex}`; // 显示文本
        this.audioQualityIndicatorEl.className = 'call-status-indicator'; // 重置CSS类

        // 根据配置档案索引添加特定的CSS类
        if (data.profileIndex !== undefined) {
            this.audioQualityIndicatorEl.classList.add(`quality-level-${data.profileIndex}`);
            // 根据等级范围添加通用类（可选，需要CSS配合）
            if (data.profileIndex >= 3) { // "较高" 或 "极高"
                this.audioQualityIndicatorEl.classList.add('quality-high-range');
            } else if (data.profileIndex <= 1) { // "极低" 或 "较低"
                this.audioQualityIndicatorEl.classList.add('quality-low-range');
            } else { // "标准"
                this.audioQualityIndicatorEl.classList.add('quality-medium-range');
            }
        }
        this.audioQualityIndicatorEl.title = data.description || qualityText; // 设置tooltip
        this.audioQualityIndicatorEl.textContent = qualityText; // 设置显示文本
        this.audioQualityIndicatorEl.style.display = 'inline-block'; // 显示指示器
        Utils.log(`UI: 音频质量指示器更新为: ${qualityText} (Lvl ${data.profileIndex})`, Utils.logLevels.DEBUG);
    },


    /**
     * 根据 VideoCallManager 提供的状态对象，更新所有相关的 UI 元素。
     * @param {object} callState - 包含通话状态信息的对象。
     */
    updateUIForCallState: function(callState) {
        // 防御性检查，确保所有关键UI元素都存在
        if (!this.callContainer || !this.localVideo || !this.remoteVideo || !this.audioOnlyBtn || !this.cameraBtn || !this.audioBtn || !this.pipButton) {
            Utils.log("VideoCallUIManager: 未找到所有 UI 元素，无法更新。", Utils.logLevels.WARN);
            return;
        }

        if (callState.isCallActive) { // 如果通话激活
            this.showCallContainer(true); // 显示通话容器
            // 更新音频质量指示器 (如果对方ID存在)
            if (this.audioQualityIndicatorEl && VideoCallManager.currentPeerId) {
                const currentProfileIndex = VideoCallManager._currentAudioProfileIndex[VideoCallManager.currentPeerId] !== undefined
                    ? VideoCallManager._currentAudioProfileIndex[VideoCallManager.currentPeerId]
                    : AppSettings.adaptiveAudioQuality.initialProfileIndex; // 获取当前配置档案索引
                const profile = AppSettings.adaptiveAudioQuality.audioQualityProfiles[currentProfileIndex]; // 获取配置档案
                this._updateAudioQualityDisplay({ // 调用更新函数
                    peerId: VideoCallManager.currentPeerId,
                    profileName: profile ? profile.levelName : "未知",
                    profileIndex: currentProfileIndex,
                    description: profile ? profile.description : "未知状态"
                });
            }
        } else { // 如果通话未激活
            this.showCallContainer(false); // 隐藏通话容器
            if (this.audioQualityIndicatorEl) {
                this.audioQualityIndicatorEl.style.display = 'none'; // 隐藏音频质量指示器
            }
            return; // 后续UI更新无需执行
        }

        // 根据通话模式（屏幕共享、纯音频）更新容器样式
        if (callState.isScreenSharing) {
            this.callContainer.classList.add('screen-sharing-mode');
            this.callContainer.classList.remove('audio-only-mode');
        } else {
            this.callContainer.classList.remove('screen-sharing-mode');
            this.callContainer.classList.toggle('audio-only-mode', callState.isAudioOnly);
        }
        // 根据画中画模式更新容器样式
        this.callContainer.classList.toggle('pip-mode', this.isPipMode && callState.isCallActive);

        // 控制本地视频的显示和流
        const showLocalVideo = VideoCallManager.localStream && !callState.isAudioOnly && callState.isVideoEnabled;
        if (callState.isScreenSharing) { // 如果是屏幕共享
            if (VideoCallManager.isCaller) { // 如果是发起方，不显示本地摄像头
                this.localVideo.style.display = 'none';
                this.localVideo.srcObject = null;
            } else { // 如果是接收方，正常显示本地摄像头（如果启用）
                this.localVideo.style.display = showLocalVideo ? 'block' : 'none';
                if(showLocalVideo) this.localVideo.srcObject = VideoCallManager.localStream;
                else this.localVideo.srcObject = null;
            }
        } else { // 普通通话
            this.localVideo.style.display = showLocalVideo ? 'block' : 'none';
            if(showLocalVideo) this.localVideo.srcObject = VideoCallManager.localStream;
            else this.localVideo.srcObject = null;
        }

        // 控制远程视频的显示和播放
        const currentRemoteStream = this.remoteVideo.srcObject;
        // 判断是否有活动的远程视频轨道
        const hasRemoteVideoTrack = currentRemoteStream instanceof MediaStream &&
            currentRemoteStream.getVideoTracks().some(t => t.readyState === "live" && !t.muted);

        if ((callState.isScreenSharing && hasRemoteVideoTrack) || (!callState.isAudioOnly && hasRemoteVideoTrack)) {
            this.remoteVideo.style.display = 'block'; // 显示远程视频
            if (this.remoteVideo.paused) { // 如果暂停则尝试播放
                this.remoteVideo.play().catch(e => Utils.log(`播放远程视频时出错: ${e.name} - ${e.message}`, Utils.logLevels.WARN));
            }
        } else {
            this.remoteVideo.style.display = 'none'; // 隐藏远程视频
        }

        // 更新通话前纯音频切换按钮的样式
        this.audioOnlyBtn.style.display = callState.isCallActive ? 'none' : 'inline-block'; // 通话激活时隐藏
        if (!callState.isCallActive) {
            this.audioOnlyBtn.style.background = callState.isAudioOnly ? 'var(--primary-color)' : '#fff';
            this.audioOnlyBtn.style.color = callState.isAudioOnly ? 'white' : 'var(--text-color)';
            this.audioOnlyBtn.innerHTML = callState.isAudioOnly ? '🎬' : '🔊'; // 根据状态切换图标
            this.audioOnlyBtn.title = callState.isAudioOnly ? '切换到视频通话' : '切换到纯音频通话';
        }

        // 更新画中画按钮的样式
        this.pipButton.style.display = callState.isCallActive ? 'inline-block' : 'none'; // 通话激活时显示
        if (callState.isCallActive) {
            this.pipButton.innerHTML = this.isPipMode ? '↗️' : '↙️'; // 根据PiP状态切换图标
            this.pipButton.title = this.isPipMode ? '最大化视频' : '最小化视频 (画中画)';
        }

        // 更新摄像头切换按钮的样式
        const disableCameraToggle = callState.isAudioOnly || (callState.isScreenSharing && VideoCallManager.isCaller); // 禁用条件
        this.cameraBtn.style.display = disableCameraToggle ? 'none' : 'inline-block';
        if (!disableCameraToggle) {
            this.cameraBtn.innerHTML = callState.isVideoEnabled ? '📹' : '🚫';
            this.cameraBtn.style.background = callState.isVideoEnabled ? '#fff' : '#666';
            this.cameraBtn.style.color = callState.isVideoEnabled ? 'var(--text-color)' : 'white';
            this.cameraBtn.title = callState.isVideoEnabled ? '关闭摄像头' : '打开摄像头';
        }

        // 更新麦克风切换按钮的样式
        this.audioBtn.innerHTML = callState.isAudioMuted ? '🔇' : '🎤';
        this.audioBtn.style.background = callState.isAudioMuted ? '#666' : '#fff';
        this.audioBtn.style.color = callState.isAudioMuted ? 'white' : 'var(--text-color)';
        this.audioBtn.title = callState.isAudioMuted ? '取消静音' : '静音';
    },

    /**
     * 设置本地视频元素的媒体流。
     * @param {MediaStream|null} stream - 本地媒体流。
     */
    setLocalStream: function(stream) {
        if (this.localVideo) {
            this.localVideo.srcObject = stream; // 设置流
            if (stream && this.localVideo.paused) { // 如果流存在且视频暂停，则尝试播放
                this.localVideo.play().catch(e => Utils.log(`播放本地视频时出错: ${e.name}`, Utils.logLevels.WARN));
            }
        }
    },

    /**
     * 设置远程视频元素的媒体流。
     * @param {MediaStream|null} stream - 远程媒体流。
     */
    setRemoteStream: function(stream) {
        if (this.remoteVideo) {
            this.remoteVideo.srcObject = stream;
            if (stream && this.remoteVideo.paused) {
                this.remoteVideo.play().catch(e => Utils.log(`播放远程视频时出错: ${e.name}`, Utils.logLevels.WARN));
            }
        }
    },

    /**
     * 切换画中画 (PiP) 模式。
     */
    togglePipMode: function () {
        if (!VideoCallManager.isCallActive || !this.callContainer) return; // 检查通话是否激活
        this.isPipMode = !this.isPipMode; // 切换PiP状态

        this.callContainer.classList.toggle('pip-mode', this.isPipMode); // 切换CSS类

        if (this.isPipMode) { // 如果进入PiP模式
            this.initPipDraggable(this.callContainer); // 初始化拖动功能
            // 获取上次保存的位置或设置默认位置
            const lastLeft = this.callContainer.dataset.pipLeft;
            const lastTop = this.callContainer.dataset.pipTop;
            const containerWidth = this.callContainer.offsetWidth || 320; // 默认宽度
            const containerHeight = this.callContainer.offsetHeight || 180; // 默认高度
            // 默认右下角
            const defaultLeft = `${window.innerWidth - containerWidth - 20}px`;
            const defaultTop = `${window.innerHeight - containerHeight - 20}px`;

            this.callContainer.style.left = lastLeft || defaultLeft;
            this.callContainer.style.top = lastTop || defaultTop;
            // 清除right/bottom，因为left/top优先
            this.callContainer.style.right = 'auto';
            this.callContainer.style.bottom = 'auto';
        } else { // 如果退出PiP模式
            this.removePipDraggable(this.callContainer); // 移除拖动功能
            // 保存当前位置（如果有效）
            if (this.callContainer.style.left && this.callContainer.style.left !== 'auto') {
                this.callContainer.dataset.pipLeft = this.callContainer.style.left;
            }
            if (this.callContainer.style.top && this.callContainer.style.top !== 'auto') {
                this.callContainer.dataset.pipTop = this.callContainer.style.top;
            }
            // 重置位置样式，由CSS控制全屏显示
            this.callContainer.style.left = ''; this.callContainer.style.top = '';
            this.callContainer.style.right = ''; this.callContainer.style.bottom = '';
            // --- OPTIMIZATION ---
            // 退出 PiP 模式时，清除可能存在的 transform 样式
            this.callContainer.style.transform = '';
        }
        // 更新UI状态，包括音频质量显示等
        this.updateUIForCallState({
            isCallActive: VideoCallManager.isCallActive,
            isAudioOnly: VideoCallManager.isAudioOnly,
            isScreenSharing: VideoCallManager.isScreenSharing,
            isVideoEnabled: VideoCallManager.isVideoEnabled,
            isAudioMuted: VideoCallManager.isAudioMuted,
        });
    },

    /**
     * 初始化 PiP 窗口的拖动功能。
     * @param {HTMLElement} element - 要使其可拖动的元素。
     */
    initPipDraggable: function (element) {
        if (!element) return;
        // 绑定鼠标和触摸事件
        element.addEventListener("mousedown", this._boundDragStart);
        element.addEventListener("touchstart", this._boundDragStartTouch, {passive: false}); // passive:false 允许 preventDefault
    },

    /**
     * 移除 PiP 窗口的拖动功能。
     * @param {HTMLElement} element - 要移除拖动功能的元素。
     */
    removePipDraggable: function (element) {
        if (!element) return;
        // 移除所有相关的事件监听器
        element.removeEventListener("mousedown", this._boundDragStart);
        element.removeEventListener("touchstart", this._boundDragStartTouch);
        document.removeEventListener("mousemove", this._boundDrag);
        document.removeEventListener("mouseup", this._boundDragEnd);
        document.removeEventListener("touchmove", this._boundDragTouch);
        document.removeEventListener("touchend", this._boundDragEndTouch);
    },

    /**
     * 拖动开始事件处理函数。
     * @param {MouseEvent|TouchEvent} e - 事件对象。
     */
    dragStart: function (e) {
        // 忽略在按钮或指示器上的点击
        if (e.target.classList.contains('video-call-button') || e.target.closest('.video-call-button') || e.target.id === 'audioQualityIndicator') return;
        if (!this.isPipMode || !VideoCallManager.isCallActive || !this.callContainer) return;

        e.preventDefault(); // 阻止默认行为（如文本选择）

        this.dragInfo.draggedElement = this.callContainer; // 设置被拖动元素
        // --- OPTIMIZATION START ---
        // 记录拖动开始时的初始位置和鼠标偏移
        this.dragInfo.xOffset = this.dragInfo.draggedElement.offsetLeft;
        this.dragInfo.yOffset = this.dragInfo.draggedElement.offsetTop;
        // --- OPTIMIZATION END ---

        this.dragInfo.active = true; // 标记拖动激活
        this.dragInfo.originalTransition = this.dragInfo.draggedElement.style.transition; // 保存原始transition
        this.dragInfo.draggedElement.style.transition = 'none'; // 拖动时禁用transition，避免延迟
        this.dragInfo.draggedElement.style.cursor = 'grabbing'; // 设置抓取光标

        // 禁用页面文本选择，提升拖动体验
        document.body.style.userSelect = 'none';
        if (typeof LayoutUIManager !== 'undefined' && LayoutUIManager.appContainer) {
            LayoutUIManager.appContainer.style.userSelect = 'none';
        }

        // 根据事件类型（鼠标或触摸）获取初始坐标
        if (e.type === "touchstart") {
            this.dragInfo.initialX = e.touches[0].clientX - this.dragInfo.xOffset;
            this.dragInfo.initialY = e.touches[0].clientY - this.dragInfo.yOffset;
            document.addEventListener("touchmove", this._boundDragTouch, {passive: false});
            document.addEventListener("touchend", this._boundDragEndTouch);
        } else {
            this.dragInfo.initialX = e.clientX - this.dragInfo.xOffset;
            this.dragInfo.initialY = e.clientY - this.dragInfo.yOffset;
            document.addEventListener("mousemove", this._boundDrag);
            document.addEventListener("mouseup", this._boundDragEnd);
        }
    },

    /**
     * 拖动过程中的事件处理函数。
     * @param {MouseEvent|TouchEvent} e - 事件对象。
     */
    drag: function (e) {
        if (!this.dragInfo.active || !this.dragInfo.draggedElement) return; // 如果未激活或无拖动元素，则返回
        e.preventDefault(); // 阻止默认行为

        let currentX, currentY;
        // 获取当前坐标
        if (e.type === "touchmove") {
            currentX = e.touches[0].clientX - this.dragInfo.initialX;
            currentY = e.touches[0].clientY - this.dragInfo.initialY;
        } else {
            currentX = e.clientX - this.dragInfo.initialX;
            currentY = e.clientY - this.dragInfo.initialY;
        }

        this.dragInfo.currentX = currentX;
        this.dragInfo.currentY = currentY;

        // 限制在视口范围内
        const viewportWidth = window.innerWidth;
        const viewportHeight = window.innerHeight;
        currentX = Math.max(0, Math.min(currentX, viewportWidth - this.dragInfo.draggedElement.offsetWidth));
        currentY = Math.max(0, Math.min(currentY, viewportHeight - this.dragInfo.draggedElement.offsetHeight));

        // --- OPTIMIZATION START ---
        // 使用 transform 进行位移，以获得GPU加速的流畅动画
        this.dragInfo.draggedElement.style.transform = `translate3d(${currentX}px, ${currentY}px, 0)`;
        // --- OPTIMIZATION END ---
    },

    /**
     * 拖动结束事件处理函数。
     */
    dragEnd: function () {
        if (!this.dragInfo.active) return; // 如果未激活，则返回

        // --- OPTIMIZATION START ---
        // "烘焙" transform 到 left/top，并重置 transform
        if (this.dragInfo.draggedElement) {
            // 获取当前经过 transform 后的位置
            let finalX = this.dragInfo.currentX;
            let finalY = this.dragInfo.currentY;

            // 再次限制在视口范围内，确保最终位置有效
            const viewportWidth = window.innerWidth;
            const viewportHeight = window.innerHeight;
            finalX = Math.max(0, Math.min(finalX, viewportWidth - this.dragInfo.draggedElement.offsetWidth));
            finalY = Math.max(0, Math.min(finalY, viewportHeight - this.dragInfo.draggedElement.offsetHeight));

            // 将最终位置应用到 left/top
            this.dragInfo.draggedElement.style.left = `${finalX}px`;
            this.dragInfo.draggedElement.style.top = `${finalY}px`;
            // 清除 transform 属性，为下一次拖动或模式切换做准备
            this.dragInfo.draggedElement.style.transform = '';
        }
        // --- OPTIMIZATION END ---

        this.dragInfo.active = false; // 标记拖动结束

        // 恢复页面文本选择
        document.body.style.userSelect = '';
        if (typeof LayoutUIManager !== 'undefined' && LayoutUIManager.appContainer) {
            LayoutUIManager.appContainer.style.userSelect = '';
        }

        if (this.dragInfo.draggedElement) {
            this.dragInfo.draggedElement.style.transition = this.dragInfo.originalTransition || ''; // 恢复原始transition
            this.dragInfo.draggedElement.style.cursor = 'grab'; // 重置光标
            // 保存最后位置
            this.dragInfo.draggedElement.dataset.pipLeft = this.dragInfo.draggedElement.style.left;
            this.dragInfo.draggedElement.dataset.pipTop = this.dragInfo.draggedElement.style.top;
        }
        // 移除全局事件监听器
        document.removeEventListener("mousemove", this._boundDrag);
        document.removeEventListener("mouseup", this._boundDragEnd);
        document.removeEventListener("touchmove", this._boundDragTouch);
        document.removeEventListener("touchend", this._boundDragEndTouch);
    },

    /**
     * 重置 PiP 模式相关的视觉效果和状态。
     */
    resetPipVisuals: function() {
        this.isPipMode = false; // 重置PiP状态
        if (this.callContainer) {
            this.removePipDraggable(this.callContainer); // 移除拖动功能
            this.callContainer.classList.remove('pip-mode'); // 移除PiP类
            // 重置位置和transition样式
            this.callContainer.style.left = ''; this.callContainer.style.top = '';
            this.callContainer.style.right = ''; this.callContainer.style.bottom = '';
            this.callContainer.style.transition = '';
            // --- OPTIMIZATION ---
            // 确保 transform 也被清除
            this.callContainer.style.transform = '';
        }
    }
};