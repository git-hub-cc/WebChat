/**
 * @file VideoCallUIManager.js
 * @description 视频通话 UI 管理器，负责管理所有与视频通话相关的用户界面元素。
 *              包括本地/远程视频的显示、通话控制按钮的更新，以及画中画 (PiP) 模式的 UI 和拖动功能。
 *              现在能显示五级音频质量状态。
 *              FIX: 修复了 PiP 窗口拖动时因位置计算不当导致的偏移（跳跃）问题。
 * @module VideoCallUIManager
 * @exports {object} VideoCallUIManager - 对外暴露的单例对象，包含管理视频通话 UI 的方法。
 */
const VideoCallUIManager = {
    localVideo: null,
    remoteVideo: null,
    pipButton: null,
    callContainer: null,
    audioOnlyBtn: null,
    cameraBtn: null,
    audioBtn: null,
    endCallBtn: null,
    audioQualityIndicatorEl: null,
    isPipMode: false,

    // FIX: 重构拖动信息对象，使用更清晰的命名
    dragInfo: {
        active: false,
        element: null,          // 当前拖动的元素
        // 拖拽开始时元素的初始 left/top
        elementStartX: 0,
        elementStartY: 0,
        // 拖拽开始时鼠标/触摸的初始 clientX/clientY
        cursorStartX: 0,
        cursorStartY: 0,
        originalTransition: ''
    },

    _boundDragStart: null,
    _boundDragStartTouch: null,
    _boundDrag: null,
    _boundDragTouch: null,
    _boundDragEnd: null,
    _boundDragEndTouch: null,

    /**
     * 初始化模块。
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

        this._boundDragStart = this.dragStart.bind(this);
        this._boundDragStartTouch = this.dragStart.bind(this);
        this._boundDrag = this.drag.bind(this);
        this._boundDragTouch = this.drag.bind(this);
        this._boundDragEnd = this.dragEnd.bind(this);
        this._boundDragEndTouch = this.dragEnd.bind(this);

        this.bindEvents();

        if (typeof EventEmitter !== 'undefined') {
            EventEmitter.on('audioProfileChanged', this._updateAudioQualityDisplay.bind(this));
        }
    },

    /**
     * 绑定事件。
     */
    bindEvents: function() {
        if (this.pipButton) this.pipButton.addEventListener('click', () => this.togglePipMode());
        if (this.cameraBtn) this.cameraBtn.addEventListener('click', () => VideoCallManager.toggleCamera());
        if (this.audioBtn) this.audioBtn.addEventListener('click', () => VideoCallManager.toggleAudio());
        if (this.audioOnlyBtn) this.audioOnlyBtn.addEventListener('click', () => VideoCallManager.toggleAudioOnly());
        if (this.endCallBtn) this.endCallBtn.addEventListener('click', () => VideoCallManager.hangUpMedia());
    },

    /**
     * 显示或隐藏通话容器。
     * @param {boolean} [display=true] - true 为显示，false 为隐藏。
     */
    showCallContainer: function(display = true) {
        if (this.callContainer) {
            this.callContainer.style.display = display ? 'flex' : 'none';
            if (!display) {
                this.resetPipVisuals();
                if (this.audioQualityIndicatorEl) {
                    this.audioQualityIndicatorEl.style.display = 'none';
                }
            }
        }
    },

    /**
     * @private
     * 更新音频质量指示器。
     */
    _updateAudioQualityDisplay: function(data) {
        if (!this.audioQualityIndicatorEl || !VideoCallManager.isCallActive || VideoCallManager.currentPeerId !== data.peerId) {
            return;
        }
        const qualityText = data.profileName || `等级 ${data.profileIndex}`;
        this.audioQualityIndicatorEl.className = 'call-status-indicator';
        if (data.profileIndex !== undefined) {
            this.audioQualityIndicatorEl.classList.add(`quality-level-${data.profileIndex}`);
            if (data.profileIndex >= 3) this.audioQualityIndicatorEl.classList.add('quality-high-range');
            else if (data.profileIndex <= 1) this.audioQualityIndicatorEl.classList.add('quality-low-range');
            else this.audioQualityIndicatorEl.classList.add('quality-medium-range');
        }
        this.audioQualityIndicatorEl.title = data.description || qualityText;
        this.audioQualityIndicatorEl.textContent = qualityText;
        this.audioQualityIndicatorEl.style.display = 'inline-block';
        Utils.log(`UI: 音频质量指示器更新为: ${qualityText} (Lvl ${data.profileIndex})`, Utils.logLevels.DEBUG);
    },

    /**
     * 根据通话状态更新 UI。
     * @param {object} callState - 通话状态对象。
     */
    updateUIForCallState: function(callState) {
        if (!this.callContainer || !this.localVideo || !this.remoteVideo || !this.audioOnlyBtn || !this.cameraBtn || !this.audioBtn || !this.pipButton) {
            Utils.log("VideoCallUIManager: 未找到所有 UI 元素，无法更新。", Utils.logLevels.WARN);
            return;
        }
        if (callState.isCallActive) {
            this.showCallContainer(true);
            if (this.audioQualityIndicatorEl && VideoCallManager.currentPeerId) {
                const currentProfileIndex = VideoCallManager._currentAudioProfileIndex[VideoCallManager.currentPeerId] !== undefined ? VideoCallManager._currentAudioProfileIndex[VideoCallManager.currentPeerId] : AppSettings.adaptiveAudioQuality.initialProfileIndex;
                const profile = AppSettings.adaptiveAudioQuality.audioQualityProfiles[currentProfileIndex];
                this._updateAudioQualityDisplay({ peerId: VideoCallManager.currentPeerId, profileName: profile ? profile.levelName : "未知", profileIndex: currentProfileIndex, description: profile ? profile.description : "未知状态" });
            }
        } else {
            this.showCallContainer(false);
            if (this.audioQualityIndicatorEl) {
                this.audioQualityIndicatorEl.style.display = 'none';
            }
            return;
        }
        if (callState.isScreenSharing) {
            this.callContainer.classList.add('screen-sharing-mode');
            this.callContainer.classList.remove('audio-only-mode');
        } else {
            this.callContainer.classList.remove('screen-sharing-mode');
            this.callContainer.classList.toggle('audio-only-mode', callState.isAudioOnly);
        }
        this.callContainer.classList.toggle('pip-mode', this.isPipMode && callState.isCallActive);
        const showLocalVideo = VideoCallManager.localStream && !callState.isAudioOnly && callState.isVideoEnabled;
        if (callState.isScreenSharing) {
            if (VideoCallManager.isCaller) {
                this.localVideo.style.display = 'none';
                this.localVideo.srcObject = null;
            } else {
                this.localVideo.style.display = showLocalVideo ? 'block' : 'none';
                if(showLocalVideo) this.localVideo.srcObject = VideoCallManager.localStream;
                else this.localVideo.srcObject = null;
            }
        } else {
            this.localVideo.style.display = showLocalVideo ? 'block' : 'none';
            if(showLocalVideo) this.localVideo.srcObject = VideoCallManager.localStream;
            else this.localVideo.srcObject = null;
        }
        const currentRemoteStream = this.remoteVideo.srcObject;
        const hasRemoteVideoTrack = currentRemoteStream instanceof MediaStream && currentRemoteStream.getVideoTracks().some(t => t.readyState === "live" && !t.muted);
        if ((callState.isScreenSharing && hasRemoteVideoTrack) || (!callState.isAudioOnly && hasRemoteVideoTrack)) {
            this.remoteVideo.style.display = 'block';
            if (this.remoteVideo.paused) this.remoteVideo.play().catch(e => Utils.log(`播放远程视频时出错: ${e.name} - ${e.message}`, Utils.logLevels.WARN));
        } else {
            this.remoteVideo.style.display = 'none';
        }
        this.audioOnlyBtn.style.display = callState.isCallActive ? 'none' : 'inline-block';
        if (!callState.isCallActive) {
            this.audioOnlyBtn.style.background = callState.isAudioOnly ? 'var(--primary-color)' : '#fff';
            this.audioOnlyBtn.style.color = callState.isAudioOnly ? 'white' : 'var(--text-color)';
            this.audioOnlyBtn.innerHTML = callState.isAudioOnly ? '🎬' : '🔊';
            this.audioOnlyBtn.title = callState.isAudioOnly ? '切换到视频通话' : '切换到纯音频通话';
        }
        this.pipButton.style.display = callState.isCallActive ? 'inline-block' : 'none';
        if (callState.isCallActive) {
            this.pipButton.innerHTML = this.isPipMode ? '↗️' : '↙️';
            this.pipButton.title = this.isPipMode ? '最大化视频' : '最小化视频 (画中画)';
        }
        const disableCameraToggle = callState.isAudioOnly || (callState.isScreenSharing && VideoCallManager.isCaller);
        this.cameraBtn.style.display = disableCameraToggle ? 'none' : 'inline-block';
        if (!disableCameraToggle) {
            this.cameraBtn.innerHTML = callState.isVideoEnabled ? '📹' : '🚫';
            this.cameraBtn.style.background = callState.isVideoEnabled ? '#fff' : '#666';
            this.cameraBtn.style.color = callState.isVideoEnabled ? 'var(--text-color)' : 'white';
            this.cameraBtn.title = callState.isVideoEnabled ? '关闭摄像头' : '打开摄像头';
        }
        this.audioBtn.innerHTML = callState.isAudioMuted ? '🔇' : '🎤';
        this.audioBtn.style.background = callState.isAudioMuted ? '#666' : '#fff';
        this.audioBtn.style.color = callState.isAudioMuted ? 'white' : 'var(--text-color)';
        this.audioBtn.title = callState.isAudioMuted ? '取消静音' : '静音';
    },

    /**
     * 设置本地视频流。
     * @param {MediaStream|null} stream - 本地媒体流。
     */
    setLocalStream: function(stream) {
        if (this.localVideo) {
            this.localVideo.srcObject = stream;
            if (stream && this.localVideo.paused) {
                this.localVideo.play().catch(e => Utils.log(`播放本地视频时出错: ${e.name}`, Utils.logLevels.WARN));
            }
        }
    },

    /**
     * 设置远程视频流。
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
        if (!VideoCallManager.isCallActive || !this.callContainer) return;
        this.isPipMode = !this.isPipMode;
        this.callContainer.classList.toggle('pip-mode', this.isPipMode);

        if (this.isPipMode) {
            this.initPipDraggable(this.callContainer);
            const lastLeft = this.callContainer.dataset.pipLeft;
            const lastTop = this.callContainer.dataset.pipTop;
            const containerWidth = this.callContainer.offsetWidth || 320;
            const containerHeight = this.callContainer.offsetHeight || 180;
            const defaultLeft = `${window.innerWidth - containerWidth - 20}px`;
            const defaultTop = `${window.innerHeight - containerHeight - 20}px`;
            this.callContainer.style.left = lastLeft || defaultLeft;
            this.callContainer.style.top = lastTop || defaultTop;
            this.callContainer.style.right = 'auto';
            this.callContainer.style.bottom = 'auto';
        } else {
            this.removePipDraggable(this.callContainer);
            if (this.callContainer.style.left && this.callContainer.style.left !== 'auto') this.callContainer.dataset.pipLeft = this.callContainer.style.left;
            if (this.callContainer.style.top && this.callContainer.style.top !== 'auto') this.callContainer.dataset.pipTop = this.callContainer.style.top;
            this.callContainer.style.left = ''; this.callContainer.style.top = '';
            this.callContainer.style.right = ''; this.callContainer.style.bottom = '';
            this.callContainer.style.transform = '';
        }
        this.updateUIForCallState({
            isCallActive: VideoCallManager.isCallActive,
            isAudioOnly: VideoCallManager.isAudioOnly,
            isScreenSharing: VideoCallManager.isScreenSharing,
            isVideoEnabled: VideoCallManager.isVideoEnabled,
            isAudioMuted: VideoCallManager.isAudioMuted,
        });
    },

    /**
     * 初始化 PiP 窗口拖动功能。
     * @param {HTMLElement} element - 要拖动的元素。
     */
    initPipDraggable: function (element) {
        if (!element) return;
        element.addEventListener("mousedown", this._boundDragStart);
        element.addEventListener("touchstart", this._boundDragStartTouch, {passive: false});
    },

    /**
     * 移除 PiP 窗口拖动功能。
     * @param {HTMLElement} element - 要移除拖动功能的元素。
     */
    removePipDraggable: function (element) {
        if (!element) return;
        element.removeEventListener("mousedown", this._boundDragStart);
        element.removeEventListener("touchstart", this._boundDragStartTouch);
        document.removeEventListener("mousemove", this._boundDrag);
        document.removeEventListener("mouseup", this._boundDragEnd);
        document.removeEventListener("touchmove", this._boundDragTouch);
        document.removeEventListener("touchend", this._boundDragEndTouch);
    },

    /**
     * FIX: 拖动开始事件处理函数 (重构)。
     * @param {MouseEvent|TouchEvent} e - 事件对象。
     */
    dragStart: function (e) {
        if (e.target.closest('.video-call-button') || e.target.id === 'audioQualityIndicator') return;
        if (!this.isPipMode || !VideoCallManager.isCallActive || !this.callContainer) return;

        e.preventDefault();

        this.dragInfo.element = this.callContainer;
        this.dragInfo.active = true;

        // 记录元素的初始布局位置和鼠标的初始位置
        const style = window.getComputedStyle(this.dragInfo.element);
        this.dragInfo.elementStartX = parseInt(style.left, 10) || 0;
        this.dragInfo.elementStartY = parseInt(style.top, 10) || 0;

        if (e.type === "touchstart") {
            this.dragInfo.cursorStartX = e.touches[0].clientX;
            this.dragInfo.cursorStartY = e.touches[0].clientY;
            document.addEventListener("touchmove", this._boundDragTouch, {passive: false});
            document.addEventListener("touchend", this._boundDragEndTouch);
        } else {
            this.dragInfo.cursorStartX = e.clientX;
            this.dragInfo.cursorStartY = e.clientY;
            document.addEventListener("mousemove", this._boundDrag);
            document.addEventListener("mouseup", this._boundDragEnd);
        }

        // 准备拖动
        this.dragInfo.originalTransition = this.dragInfo.element.style.transition;
        this.dragInfo.element.style.transition = 'none';
        this.dragInfo.element.style.cursor = 'grabbing';
        document.body.style.userSelect = 'none';
        if (typeof LayoutUIManager !== 'undefined' && LayoutUIManager.appContainer) {
            LayoutUIManager.appContainer.style.userSelect = 'none';
        }
    },

    /**
     * FIX: 拖动过程中的事件处理函数 (重构)。
     * @param {MouseEvent|TouchEvent} e - 事件对象。
     */
    drag: function (e) {
        if (!this.dragInfo.active || !this.dragInfo.element) return;
        e.preventDefault();

        let cursorCurrentX, cursorCurrentY;
        if (e.type === "touchmove") {
            cursorCurrentX = e.touches[0].clientX;
            cursorCurrentY = e.touches[0].clientY;
        } else {
            cursorCurrentX = e.clientX;
            cursorCurrentY = e.clientY;
        }

        // 计算鼠标/触摸的偏移量
        const deltaX = cursorCurrentX - this.dragInfo.cursorStartX;
        const deltaY = cursorCurrentY - this.dragInfo.cursorStartY;

        // 计算新的 left/top 位置
        let newX = this.dragInfo.elementStartX + deltaX;
        let newY = this.dragInfo.elementStartY + deltaY;

        // 限制在视口范围内
        const viewportWidth = window.innerWidth;
        const viewportHeight = window.innerHeight;
        newX = Math.max(0, Math.min(newX, viewportWidth - this.dragInfo.element.offsetWidth));
        newY = Math.max(0, Math.min(newY, viewportHeight - this.dragInfo.element.offsetHeight));

        // 直接更新 left/top。因为拖动时 transition 已被禁用，所以不会有性能问题。
        // Transform 方案在这里有点过度设计，直接更新 left/top 更简单且无偏移问题。
        this.dragInfo.element.style.left = `${newX}px`;
        this.dragInfo.element.style.top = `${newY}px`;
    },

    /**
     * FIX: 拖动结束事件处理函数 (重构)。
     */
    dragEnd: function () {
        if (!this.dragInfo.active) return;

        this.dragInfo.active = false;

        // 恢复样式和事件监听
        document.body.style.userSelect = '';
        if (typeof LayoutUIManager !== 'undefined' && LayoutUIManager.appContainer) {
            LayoutUIManager.appContainer.style.userSelect = '';
        }

        if (this.dragInfo.element) {
            this.dragInfo.element.style.transition = this.dragInfo.originalTransition || '';
            this.dragInfo.element.style.cursor = 'grab';
            // 保存最后位置
            this.dragInfo.element.dataset.pipLeft = this.dragInfo.element.style.left;
            this.dragInfo.element.dataset.pipTop = this.dragInfo.element.style.top;
        }

        document.removeEventListener("mousemove", this._boundDrag);
        document.removeEventListener("mouseup", this._boundDragEnd);
        document.removeEventListener("touchmove", this._boundDragTouch);
        document.removeEventListener("touchend", this._boundDragEndTouch);

        // 清理 dragInfo
        this.dragInfo.element = null;
    },

    /**
     * 重置 PiP 模式视觉效果。
     */
    resetPipVisuals: function() {
        this.isPipMode = false;
        if (this.callContainer) {
            this.removePipDraggable(this.callContainer);
            this.callContainer.classList.remove('pip-mode');
            this.callContainer.style.left = ''; this.callContainer.style.top = '';
            this.callContainer.style.right = ''; this.callContainer.style.bottom = '';
            this.callContainer.style.transition = '';
            this.callContainer.style.transform = '';
        }
    }
};