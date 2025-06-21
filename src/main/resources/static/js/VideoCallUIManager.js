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
 * @dependencies Utils, VideoCallManager, EventEmitter, LayoutUIManager
 * @dependents AppInitializer (进行初始化), VideoCallManager (调用以更新 UI)
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
    dragInfo: {
        active: false, currentX: 0, currentY: 0,
        initialX: 0, initialY: 0, xOffset: 0, yOffset: 0,
        draggedElement: null,
        originalTransition: '' // To store original transition property
    },
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
     * @description 更新音频质量指示器的显示。
     * @param {object} data - 事件数据，包含 { peerId, profileName, profileIndex, description }。
     */
    _updateAudioQualityDisplay: function(data) {
        if (!this.audioQualityIndicatorEl || !VideoCallManager.isCallActive || VideoCallManager.currentPeerId !== data.peerId) {
            return;
        }
        const qualityText = data.profileName || `等级 ${data.profileIndex}`;
        this.audioQualityIndicatorEl.className = 'call-status-indicator'; // Reset classes

        // Add a general class for the level and potentially specific classes for ranges
        if (data.profileIndex !== undefined) {
            this.audioQualityIndicatorEl.classList.add(`quality-level-${data.profileIndex}`);
            // Example of range-based classes (optional, requires CSS definitions)
            if (data.profileIndex >= 3) { // "较高" or "极高"
                this.audioQualityIndicatorEl.classList.add('quality-high-range');
            } else if (data.profileIndex <= 1) { // "极低" or "较低"
                this.audioQualityIndicatorEl.classList.add('quality-low-range');
            } else { // "标准"
                this.audioQualityIndicatorEl.classList.add('quality-medium-range');
            }
        }
        this.audioQualityIndicatorEl.title = data.description || qualityText; // Use description for tooltip
        this.audioQualityIndicatorEl.textContent = qualityText;
        this.audioQualityIndicatorEl.style.display = 'inline-block';
        Utils.log(`UI: 音频质量指示器更新为: ${qualityText} (Lvl ${data.profileIndex})`, Utils.logLevels.DEBUG);
    },


    /**
     * 根据 VideoCallManager 提供的状态对象，更新所有相关的 UI 元素。
     * @param {object} callState - 包含通话状态信息的对象。
     */
    updateUIForCallState: function(callState) {
        if (!this.callContainer || !this.localVideo || !this.remoteVideo || !this.audioOnlyBtn || !this.cameraBtn || !this.audioBtn || !this.pipButton) {
            Utils.log("VideoCallUIManager: 未找到所有 UI 元素，无法更新。", Utils.logLevels.WARN);
            return;
        }

        if (callState.isCallActive) {
            this.showCallContainer(true);
            if (this.audioQualityIndicatorEl && VideoCallManager.currentPeerId) { // Ensure peerId is available
                const currentProfileIndex = VideoCallManager._currentAudioProfileIndex[VideoCallManager.currentPeerId] !== undefined
                    ? VideoCallManager._currentAudioProfileIndex[VideoCallManager.currentPeerId]
                    : Config.adaptiveAudioQuality.initialProfileIndex;
                const profile = Config.adaptiveAudioQuality.audioQualityProfiles[currentProfileIndex];
                this._updateAudioQualityDisplay({
                    peerId: VideoCallManager.currentPeerId,
                    profileName: profile ? profile.levelName : "未知",
                    profileIndex: currentProfileIndex,
                    description: profile ? profile.description : "未知状态"
                });
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
        const hasRemoteVideoTrack = currentRemoteStream instanceof MediaStream &&
            currentRemoteStream.getVideoTracks().some(t => t.readyState === "live" && !t.muted);

        if ((callState.isScreenSharing && hasRemoteVideoTrack) || (!callState.isAudioOnly && hasRemoteVideoTrack)) {
            this.remoteVideo.style.display = 'block';
            if (this.remoteVideo.paused) {
                this.remoteVideo.play().catch(e => Utils.log(`播放远程视频时出错: ${e.name} - ${e.message}`, Utils.logLevels.WARN));
            }
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
     * 设置本地视频元素的媒体流。
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
            if (this.callContainer.style.left && this.callContainer.style.left !== 'auto') {
                this.callContainer.dataset.pipLeft = this.callContainer.style.left;
            }
            if (this.callContainer.style.top && this.callContainer.style.top !== 'auto') {
                this.callContainer.dataset.pipTop = this.callContainer.style.top;
            }
            this.callContainer.style.left = ''; this.callContainer.style.top = '';
            this.callContainer.style.right = ''; this.callContainer.style.bottom = '';
        }
        // updateUIForCallState will handle updating the audio quality display as well
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
        element.addEventListener("mousedown", this._boundDragStart);
        element.addEventListener("touchstart", this._boundDragStartTouch, {passive: false});
    },

    /**
     * 移除 PiP 窗口的拖动功能。
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
     * 拖动开始事件处理函数。
     * @param {MouseEvent|TouchEvent} e - 事件对象。
     */
    dragStart: function (e) {
        if (e.target.classList.contains('video-call-button') || e.target.closest('.video-call-button') || e.target.id === 'audioQualityIndicator') return;
        if (!this.isPipMode || !VideoCallManager.isCallActive || !this.callContainer) return;

        e.preventDefault();

        this.dragInfo.draggedElement = this.callContainer;
        this.dragInfo.active = true;
        this.dragInfo.originalTransition = this.dragInfo.draggedElement.style.transition;
        this.dragInfo.draggedElement.style.transition = 'none'; // Disable CSS transitions during drag
        this.dragInfo.draggedElement.style.cursor = 'grabbing';
        const rect = this.dragInfo.draggedElement.getBoundingClientRect();

        document.body.style.userSelect = 'none';
        if (typeof LayoutUIManager !== 'undefined' && LayoutUIManager.appContainer) {
            LayoutUIManager.appContainer.style.userSelect = 'none';
        }


        if (e.type === "touchstart") {
            this.dragInfo.initialX = e.touches[0].clientX - rect.left;
            this.dragInfo.initialY = e.touches[0].clientY - rect.top;
            document.addEventListener("touchmove", this._boundDragTouch, {passive: false});
            document.addEventListener("touchend", this._boundDragEndTouch);
        } else {
            this.dragInfo.initialX = e.clientX - rect.left;
            this.dragInfo.initialY = e.clientY - rect.top;
            document.addEventListener("mousemove", this._boundDrag);
            document.addEventListener("mouseup", this._boundDragEnd);
        }
    },

    /**
     * 拖动过程中的事件处理函数。
     * @param {MouseEvent|TouchEvent} e - 事件对象。
     */
    drag: function (e) {
        if (!this.dragInfo.active || !this.dragInfo.draggedElement) return;
        e.preventDefault();

        let currentX, currentY;
        if (e.type === "touchmove") {
            currentX = e.touches[0].clientX - this.dragInfo.initialX;
            currentY = e.touches[0].clientY - this.dragInfo.initialY;
        } else {
            currentX = e.clientX - this.dragInfo.initialX;
            currentY = e.clientY - this.dragInfo.initialY;
        }
        const viewportWidth = window.innerWidth;
        const viewportHeight = window.innerHeight;
        currentX = Math.max(0, Math.min(currentX, viewportWidth - this.dragInfo.draggedElement.offsetWidth));
        currentY = Math.max(0, Math.min(currentY, viewportHeight - this.dragInfo.draggedElement.offsetHeight));

        // Apply position updates using requestAnimationFrame for smoother rendering
        // However, for direct manipulation like dragging, direct style update is often preferred for responsiveness
        // If lag is still an issue, this is where rAF would be added.
        // For now, direct update is kept as it's usually very responsive for `left/top`.
        this.dragInfo.draggedElement.style.left = currentX + "px";
        this.dragInfo.draggedElement.style.top = currentY + "px";
    },

    /**
     * 拖动结束事件处理函数。
     */
    dragEnd: function () {
        if (!this.dragInfo.active) return;
        this.dragInfo.active = false;

        document.body.style.userSelect = '';
        if (typeof LayoutUIManager !== 'undefined' && LayoutUIManager.appContainer) {
            LayoutUIManager.appContainer.style.userSelect = '';
        }

        if (this.dragInfo.draggedElement) {
            this.dragInfo.draggedElement.style.transition = this.dragInfo.originalTransition || ''; // Restore original transition
            this.dragInfo.draggedElement.style.cursor = 'grab';
            this.dragInfo.draggedElement.dataset.pipLeft = this.dragInfo.draggedElement.style.left;
            this.dragInfo.draggedElement.dataset.pipTop = this.dragInfo.draggedElement.style.top;
        }
        document.removeEventListener("mousemove", this._boundDrag);
        document.removeEventListener("mouseup", this._boundDragEnd);
        document.removeEventListener("touchmove", this._boundDragTouch);
        document.removeEventListener("touchend", this._boundDragEndTouch);
    },

    /**
     * 重置 PiP 模式相关的视觉效果和状态。
     */
    resetPipVisuals: function() {
        this.isPipMode = false;
        if (this.callContainer) {
            this.removePipDraggable(this.callContainer);
            this.callContainer.classList.remove('pip-mode');
            this.callContainer.style.left = ''; this.callContainer.style.top = '';
            this.callContainer.style.right = ''; this.callContainer.style.bottom = '';
            this.callContainer.style.transition = ''; // Ensure transition is reset if it was 'none'
        }
    }
};