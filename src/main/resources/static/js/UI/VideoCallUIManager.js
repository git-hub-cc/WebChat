/**
 * @file VideoCallUIManager.js
 * @description [REFACTORED FOR SIMPLE-PEER] 视频通话 UI 管理器。
 *              现在由 WebRTCManager 的事件驱动来设置远程流。
 *              修复了屏幕共享和不对称通话时的UI显示逻辑。
 * @module VideoCallUIManager
 * @exports {object} VideoCallUIManager
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
                if (this.audioQualityIndicatorEl) this.audioQualityIndicatorEl.style.display = 'none';
                if (this.videoQualityIndicatorEl) this.videoQualityIndicatorEl.style.display = 'none';
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
        }
        this.audioQualityIndicatorEl.title = `音频: ${data.description || qualityText}`;
        this.audioQualityIndicatorEl.textContent = `A: ${qualityText}`;
        this.audioQualityIndicatorEl.style.display = 'inline-block';
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
        }
        this.videoQualityIndicatorEl.title = `视频: ${data.description || qualityText}`;
        this.videoQualityIndicatorEl.textContent = `V: ${qualityText}`;
        this.videoQualityIndicatorEl.style.display = 'inline-block';
    },

    updateUIForCallState: function(callState) {
        if (!this.callContainer) return;
        if (!callState.isCallActive) {
            this.showCallContainer(false);
            return;
        }

        this.showCallContainer(true);

        const remoteStream = this.remoteVideo.srcObject;
        const hasRemoteVideoTrack = remoteStream instanceof MediaStream && remoteStream.getVideoTracks().some(t => t.readyState === "live" && !t.muted);

        this.remoteVideo.style.display = hasRemoteVideoTrack ? 'block' : 'none';

        const isEffectivelyAudioOnly = !callState.isVideoEnabled && !hasRemoteVideoTrack;
        this.callContainer.classList.toggle('audio-only-mode', isEffectivelyAudioOnly);
        this.callContainer.classList.toggle('screen-sharing-mode', callState.isScreenSharing);
        this.callContainer.classList.toggle('pip-mode', this.isPipMode);

        const hasLocalVideoStream = callState.localStream instanceof MediaStream && callState.localStream.getVideoTracks().some(t => t.readyState === "live");
        this.localVideo.style.display = (hasLocalVideoStream && callState.isVideoEnabled) ? 'block' : 'none';

        this.cameraBtn.style.display = callState.isScreenSharing ? 'none' : 'inline-block';
        if (!callState.isScreenSharing) {
            this.cameraBtn.innerHTML = callState.isVideoEnabled ? '📹' : '🚫';
            this.cameraBtn.classList.toggle('active', callState.isVideoEnabled);
            this.cameraBtn.title = callState.isVideoEnabled ? '关闭摄像头' : '打开摄像头';
        }

        this.audioBtn.innerHTML = callState.isAudioMuted ? '🔇' : '🎤';
        this.audioBtn.classList.toggle('active', !callState.isAudioMuted);
        this.audioBtn.title = callState.isAudioMuted ? '取消静音' : '静音';

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
            if (this.localVideo.srcObject !== stream) {
                this.localVideo.srcObject = stream;
            }
            if (stream && this.localVideo.paused) {
                this.localVideo.play().catch(e => Utils.log(`播放本地视频时出错: ${e.name}`, Utils.logLevels.WARN));
            }
        }
    },

    setRemoteStream: function(stream) {
        if (this.remoteVideo) {
            if (this.remoteVideo.srcObject !== stream) {
                this.remoteVideo.srcObject = stream;
            }
            if (stream && this.remoteVideo.paused) {
                this.remoteVideo.play().catch(e => Utils.log(`播放远程视频时出错: ${e.name}`, Utils.logLevels.WARN));
            }
        }
    },

    togglePipMode: function () {
        if (!VideoCallManager.state.isCallActive || !this.callContainer) return;
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
        const client = e.touches ? e.touches[0] : e;
        this.dragInfo.cursorStartX = client.clientX;
        this.dragInfo.cursorStartY = client.clientY;
        document.addEventListener(e.type === "touchstart" ? "touchmove" : "mousemove", this._boundDrag, {passive: false});
        document.addEventListener(e.type === "touchstart" ? "touchend" : "mouseup", this._boundDragEnd);
        this.dragInfo.originalTransition = this.dragInfo.element.style.transition;
        this.dragInfo.element.style.transition = 'none';
        this.dragInfo.element.style.cursor = 'grabbing';
    },

    drag: function (e) {
        if (!this.dragInfo.active) return;
        e.preventDefault();
        const client = e.touches ? e.touches[0] : e;
        const deltaX = client.clientX - this.dragInfo.cursorStartX;
        const deltaY = client.clientY - this.dragInfo.cursorStartY;
        let newX = this.dragInfo.elementStartX + deltaX;
        let newY = this.dragInfo.elementStartY + deltaY;
        newX = Math.max(0, Math.min(newX, window.innerWidth - this.dragInfo.element.offsetWidth));
        newY = Math.max(0, Math.min(newY, window.innerHeight - this.dragInfo.element.offsetHeight));
        this.dragInfo.element.style.left = `${newX}px`;
        this.dragInfo.element.style.top = `${newY}px`;
    },

    dragEnd: function () {
        if (!this.dragInfo.active) return;
        this.dragInfo.active = false;
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
            this.callContainer.style.left = '';
            this.callContainer.style.top = '';
            this.callContainer.style.right = '';
            this.callContainer.style.bottom = '';
            this.callContainer.style.transition = '';
            this.callContainer.style.transform = '';
        }
    }
};