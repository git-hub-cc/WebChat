/**
 * @file VideoCallUIManager.js
 * @description 视频通话 UI 管理器，负责管理所有与视频通话相关的用户界面元素。
 *              包括本地/远程视频的显示、通话控制按钮的更新，以及画中画 (PiP) 模式的 UI 和拖动功能。
 *              现在能显示五级音频和视频质量状态。
 *              FIX: 修复了 PiP 窗口拖动时因位置计算不当导致的偏移（跳跃）问题。
 *              FIXED: 修复了 togglePipMode 函数逻辑，确保其能正确进入画中画模式。
 *              FIXED: 修复了UI以支持不对称通话（一方音频，一方视频）。
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
    videoQualityIndicatorEl: null,
    isPipMode: false,

    dragInfo: {
        active: false,
        element: null,
        elementStartX: 0,
        elementStartY: 0,
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
        this.videoQualityIndicatorEl = document.getElementById('videoQualityIndicator');

        this._boundDragStart = this.dragStart.bind(this);
        this._boundDragStartTouch = this.dragStart.bind(this);
        this._boundDrag = this.drag.bind(this);
        this._boundDragTouch = this.drag.bind(this);
        this._boundDragEnd = this.dragEnd.bind(this);
        this._boundDragEndTouch = this.dragEnd.bind(this);

        this.bindEvents();

        if (typeof EventEmitter !== 'undefined') {
            EventEmitter.on('audioProfileChanged', this._updateAudioQualityDisplay.bind(this));
            EventEmitter.on('videoProfileChanged', this._updateVideoQualityDisplay.bind(this));
        }
    },

    bindEvents: function() {
        if (this.pipButton) this.pipButton.addEventListener('click', () => this.togglePipMode());
        if (this.cameraBtn) this.cameraBtn.addEventListener('click', () => VideoCallManager.toggleCamera());
        if (this.audioBtn) this.audioBtn.addEventListener('click', () => VideoCallManager.toggleAudio());
        if (this.audioOnlyBtn) this.audioOnlyBtn.addEventListener('click', () => VideoCallManager.toggleAudioOnly());
        if (this.endCallBtn) this.endCallBtn.addEventListener('click', () => VideoCallManager.hangUpMedia());
    },

    showCallContainer: function(display = true) {
        if (this.callContainer) {
            this.callContainer.style.display = display ? 'flex' : 'none';
            if (!display) {
                this.resetPipVisuals();
                if (this.audioQualityIndicatorEl) {
                    this.audioQualityIndicatorEl.style.display = 'none';
                }
                if (this.videoQualityIndicatorEl) {
                    this.videoQualityIndicatorEl.style.display = 'none';
                }
            }
        }
    },

    _updateAudioQualityDisplay: function(data) {
        if (!this.audioQualityIndicatorEl || !VideoCallManager.state.isCallActive || VideoCallManager.state.currentPeerId !== data.peerId) {
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
        this.audioQualityIndicatorEl.title = `音频: ${data.description || qualityText}`;
        this.audioQualityIndicatorEl.textContent = `A: ${qualityText}`;
        this.audioQualityIndicatorEl.style.display = 'inline-block';
        Utils.log(`UI: 音频质量指示器更新为: ${qualityText} (Lvl ${data.profileIndex})`, Utils.logLevels.DEBUG);
    },

    _updateVideoQualityDisplay: function(data) {
        if (!this.videoQualityIndicatorEl || !VideoCallManager.state.isCallActive || VideoCallManager.state.currentPeerId !== data.peerId || !VideoCallManager.state.isVideoEnabled) {
            if(this.videoQualityIndicatorEl) this.videoQualityIndicatorEl.style.display = 'none';
            return;
        }
        const qualityText = data.profileName || `等级 ${data.profileIndex}`;
        this.videoQualityIndicatorEl.className = 'call-status-indicator';
        if (data.profileIndex !== undefined) {
            this.videoQualityIndicatorEl.classList.add(`quality-level-${data.profileIndex}`);
            if (data.profileIndex >= 3) this.videoQualityIndicatorEl.classList.add('quality-high-range');
            else if (data.profileIndex <= 1) this.videoQualityIndicatorEl.classList.add('quality-low-range');
            else this.videoQualityIndicatorEl.classList.add('quality-medium-range');
        }
        this.videoQualityIndicatorEl.title = `视频: ${data.description || qualityText}`;
        this.videoQualityIndicatorEl.textContent = `V: ${qualityText}`;
        this.videoQualityIndicatorEl.style.display = 'inline-block';
        Utils.log(`UI: 视频质量指示器更新为: ${qualityText} (Lvl ${data.profileIndex})`, Utils.logLevels.DEBUG);
    },

    updateUIForCallState: function(callState) {
        if (!this.callContainer || !this.localVideo || !this.remoteVideo || !this.audioOnlyBtn || !this.cameraBtn || !this.audioBtn || !this.pipButton) {
            Utils.log("VideoCallUIManager: 未找到所有 UI 元素，无法更新。", Utils.logLevels.WARN);
            return;
        }

        const remoteStream = this.remoteVideo.srcObject;
        const hasRemoteVideo = remoteStream instanceof MediaStream && remoteStream.getVideoTracks().some(t => t.readyState === "live" && !t.muted);

        if (callState.isCallActive) {
            this.showCallContainer(true);
            // Update quality indicators...
        } else {
            this.showCallContainer(false);
            return;
        }

        // --- UI Mode Class Logic ---
        const isEffectivelyAudioOnly = !callState.isVideoEnabled && !hasRemoteVideo;
        this.callContainer.classList.toggle('audio-only-mode', isEffectivelyAudioOnly && !callState.isScreenSharing);
        this.callContainer.classList.toggle('screen-sharing-mode', callState.isScreenSharing);
        this.callContainer.classList.toggle('pip-mode', this.isPipMode && callState.isCallActive);

        // --- Video Element Display Logic ---
        const showLocalVideo = callState.localStream && callState.isVideoEnabled;
        this.localVideo.style.display = showLocalVideo ? 'block' : 'none';
        if (this.localVideo.srcObject !== callState.localStream) {
            this.localVideo.srcObject = callState.localStream;
        }

        // CORRECTED: Remote video visibility depends only on the presence of a live track.
        this.remoteVideo.style.display = hasRemoteVideo ? 'block' : 'none';
        if (hasRemoteVideo && this.remoteVideo.paused) {
            this.remoteVideo.play().catch(e => Utils.log(`播放远程视频时出错: ${e.name} - ${e.message}`, Utils.logLevels.WARN));
        }

        // --- Button State Logic ---
        this.cameraBtn.style.display = callState.isScreenSharing ? 'none' : 'inline-block';
        if (!callState.isScreenSharing) {
            this.cameraBtn.innerHTML = callState.isVideoEnabled ? '📹' : '🚫';
            this.cameraBtn.style.background = callState.isVideoEnabled ? '#fff' : '#666';
            this.cameraBtn.style.color = callState.isVideoEnabled ? 'var(--text-color)' : 'white';
            this.cameraBtn.title = callState.isVideoEnabled ? '关闭摄像头' : '打开摄像头';
        }

        this.audioBtn.innerHTML = callState.isAudioMuted ? '🔇' : '🎤';
        this.audioBtn.style.background = callState.isAudioMuted ? '#666' : '#fff';
        this.audioBtn.style.color = callState.isAudioMuted ? 'white' : 'var(--text-color)';
        this.audioBtn.title = callState.isAudioMuted ? '取消静音' : '静音';

        // This button is only for pre-call setup, hide it during a call
        this.audioOnlyBtn.style.display = callState.isCallActive ? 'none' : 'inline-block';
        if (!callState.isCallActive) {
            this.audioOnlyBtn.innerHTML = callState.isAudioOnly ? '🎬' : '🔊';
            this.audioOnlyBtn.title = callState.isAudioOnly ? '切换到视频通话' : '切换到纯音频通话';
        }

        this.pipButton.style.display = callState.isCallActive ? 'inline-block' : 'none';
        if (callState.isCallActive) {
            this.pipButton.innerHTML = this.isPipMode ? '↗️' : '↙️';
            this.pipButton.title = this.isPipMode ? '最大化视频' : '最小化视频 (画中画)';
        }
    },

    setLocalStream: function(stream) {
        if (this.localVideo) {
            this.localVideo.srcObject = stream;
            if (stream && this.localVideo.paused) {
                this.localVideo.play().catch(e => Utils.log(`播放本地视频时出错: ${e.name}`, Utils.logLevels.WARN));
            }
        }
    },

    setRemoteStream: function(stream) {
        if (this.remoteVideo) {
            this.remoteVideo.srcObject = stream;
            if (stream && this.remoteVideo.paused) {
                this.remoteVideo.play().catch(e => Utils.log(`播放远程视频时出错: ${e.name}`, Utils.logLevels.WARN));
            }
        }
    },

    /**
     * FIX: 切换画中画 (PiP) 模式，简化逻辑。
     */
    togglePipMode: function () {
        if (!VideoCallManager.state.isCallActive || !this.callContainer) {
            Utils.log(`无法切换PiP模式: 通话未激活 (${VideoCallManager.state.isCallActive}) 或容器不存在。`, Utils.logLevels.WARN);
            return;
        }
        this.isPipMode = !this.isPipMode;
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
            this.callContainer.style.left = '';
            this.callContainer.style.top = '';
            this.callContainer.style.right = '';
            this.callContainer.style.bottom = '';
            this.callContainer.style.transform = '';
        }
        this.updateUIForCallState(VideoCallManager.state);
    },

    initPipDraggable: function (element) {
        if (!element) return;
        element.addEventListener("mousedown", this._boundDragStart);
        element.addEventListener("touchstart", this._boundDragStartTouch, {passive: false});
    },

    removePipDraggable: function (element) {
        if (!element) return;
        element.removeEventListener("mousedown", this._boundDragStart);
        element.removeEventListener("touchstart", this._boundDragStartTouch);
        document.removeEventListener("mousemove", this._boundDrag);
        document.removeEventListener("mouseup", this._boundDragEnd);
        document.removeEventListener("touchmove", this._boundDragTouch);
        document.removeEventListener("touchend", this._boundDragEndTouch);
    },

    dragStart: function (e) {
        if (e.target.closest('.video-call-button') || e.target.id === 'audioQualityIndicator' || e.target.id === 'videoQualityIndicator') return;
        if (!this.isPipMode || !VideoCallManager.state.isCallActive || !this.callContainer) return;
        e.preventDefault();
        this.dragInfo.element = this.callContainer;
        this.dragInfo.active = true;
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
        this.dragInfo.originalTransition = this.dragInfo.element.style.transition;
        this.dragInfo.element.style.transition = 'none';
        this.dragInfo.element.style.cursor = 'grabbing';
        document.body.style.userSelect = 'none';
        if (typeof LayoutUIManager !== 'undefined' && LayoutUIManager.appContainer) {
            LayoutUIManager.appContainer.style.userSelect = 'none';
        }
    },

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
        const deltaX = cursorCurrentX - this.dragInfo.cursorStartX;
        const deltaY = cursorCurrentY - this.dragInfo.cursorStartY;
        let newX = this.dragInfo.elementStartX + deltaX;
        let newY = this.dragInfo.elementStartY + deltaY;
        const viewportWidth = window.innerWidth;
        const viewportHeight = window.innerHeight;
        newX = Math.max(0, Math.min(newX, viewportWidth - this.dragInfo.element.offsetWidth));
        newY = Math.max(0, Math.min(newY, viewportHeight - this.dragInfo.element.offsetHeight));
        this.dragInfo.element.style.left = `${newX}px`;
        this.dragInfo.element.style.top = `${newY}px`;
    },

    dragEnd: function () {
        if (!this.dragInfo.active) return;
        this.dragInfo.active = false;
        document.body.style.userSelect = '';
        if (typeof LayoutUIManager !== 'undefined' && LayoutUIManager.appContainer) {
            LayoutUIManager.appContainer.style.userSelect = '';
        }
        if (this.dragInfo.element) {
            this.dragInfo.element.style.transition = this.dragInfo.originalTransition || '';
            this.dragInfo.element.style.cursor = 'grab';
            this.dragInfo.element.dataset.pipLeft = this.dragInfo.element.style.left;
            this.dragInfo.element.dataset.pipTop = this.dragInfo.element.style.top;
        }
        document.removeEventListener("mousemove", this._boundDrag);
        document.removeEventListener("mouseup", this._boundDragEnd);
        document.removeEventListener("touchmove", this._boundDragTouch);
        document.removeEventListener("touchend", this._boundDragEndTouch);
        this.dragInfo.element = null;
    },

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