/**
 * @file 视频通话 UI 管理器
 * @description 负责管理所有与视频通话相关的用户界面元素。包括本地/远程视频的显示、通话控制按钮的更新、画中画 (PiP) 模式的 UI 与拖动功能，以及音频质量指示器的显示。
 * @module VideoCallUIManager
 * @exports {object} VideoCallUIManager - 对外暴露的单例对象，包含管理视频通话 UI 的所有方法。
 * @dependency VideoCallManager, Utils, EventEmitter, AppSettings
 */
const VideoCallUIManager = {
    // DOM 元素引用：本地视频播放器
    localVideo: null,
    // DOM 元素引用：远程视频播放器
    remoteVideo: null,
    // DOM 元素引用：切换画中画模式按钮
    pipButton: null,
    // DOM 元素引用：视频通话主容器
    callContainer: null,
    // DOM 元素引用：切换纯音频模式按钮
    audioOnlyBtn: null,
    // DOM 元素引用：切换摄像头开关按钮
    cameraBtn: null,
    // DOM 元素引用：切换麦克风静音按钮
    audioBtn: null,
    // DOM 元素引用：结束通话按钮
    endCallBtn: null,
    // DOM 元素引用：音频质量指示器
    audioQualityIndicatorEl: null,
    // 状态标识：当前是否处于画中画模式
    isPipMode: false,

    // 拖动状态信息对象，用于管理 PiP 窗口的拖动行为
    dragInfo: {
        // 拖动是否激活
        active: false,
        // 当前正在拖动的 DOM 元素
        element: null,
        // 拖动开始时，元素的初始 X 坐标 (left)
        elementStartX: 0,
        // 拖动开始时，元素的初始 Y 坐标 (top)
        elementStartY: 0,
        // 拖动开始时，鼠标或触摸点的初始 X 坐标 (clientX)
        cursorStartX: 0,
        // 拖动开始时，鼠标或触摸点的初始 Y 坐标 (clientY)
        cursorStartY: 0,
        // 拖动开始前，元素原始的 transition 样式，用于拖动结束后恢复
        originalTransition: ''
    },

    // 预绑定的事件处理函数，避免在事件监听器中重复创建函数，提升性能
    _boundDragStart: null,
    _boundDragStartTouch: null,
    _boundDrag: null,
    _boundDragTouch: null,
    _boundDragEnd: null,
    _boundDragEndTouch: null,

    /**
     * 初始化 UI 管理器，获取所有必要的 DOM 元素并绑定事件。
     * @function init
     */
    init: function() {
        // 1. 获取所有需要的 DOM 元素引用
        this.localVideo = document.getElementById('localVideo');
        this.remoteVideo = document.getElementById('remoteVideo');
        this.pipButton = document.getElementById('togglePipBtn');
        this.callContainer = document.getElementById('videoCallContainer');
        this.audioOnlyBtn = document.getElementById('audioOnlyBtn');
        this.cameraBtn = document.getElementById('toggleCameraBtn');
        this.audioBtn = document.getElementById('toggleAudioBtn');
        this.endCallBtn = this.callContainer ? this.callContainer.querySelector('.end-call') : null;
        this.audioQualityIndicatorEl = document.getElementById('audioQualityIndicator');

        // 2. 预绑定拖动事件的 this 上下文
        this._boundDragStart = this.dragStart.bind(this);
        this._boundDragStartTouch = this.dragStart.bind(this);
        this._boundDrag = this.drag.bind(this);
        this._boundDragTouch = this.drag.bind(this);
        this._boundDragEnd = this.dragEnd.bind(this);
        this._boundDragEndTouch = this.dragEnd.bind(this);

        // 3. 绑定静态 UI 事件
        this.bindEvents();

        // 4. 监听全局事件，如音频质量变化
        if (typeof EventEmitter !== 'undefined') {
            EventEmitter.on('audioProfileChanged', this._updateAudioQualityDisplay.bind(this));
        }
    },

    /**
     * 更新 UI 以响应通话状态的变更。
     * @function updateUIForCallState
     * @param {object} callState - 包含当前通话状态信息的对象。
     * @param {boolean} callState.isCallActive - 通话是否处于活动状态。
     * @param {boolean} callState.isScreenSharing - 是否正在进行屏幕共享。
     * @param {boolean} callState.isAudioOnly - 是否为纯音频通话。
     * @param {boolean} callState.isVideoEnabled - 本地摄像头是否开启。
     * @param {boolean} callState.isAudioMuted - 本地麦克风是否静音。
     */
    updateUIForCallState: function(callState) {
        // 前置检查：确保所有必要的 UI 元素都已加载
        if (!this.callContainer || !this.localVideo || !this.remoteVideo || !this.audioOnlyBtn || !this.cameraBtn || !this.audioBtn || !this.pipButton) {
            Utils.log("VideoCallUIManager: 未找到所有 UI 元素，无法更新。", Utils.logLevels.WARN);
            return;
        }

        // 1. 根据通话是否激活，决定是否显示通话容器
        if (callState.isCallActive) {
            this.showCallContainer(true);
            // 如果通话激活，则更新或显示音频质量指示器
            if (this.audioQualityIndicatorEl && VideoCallManager.currentPeerId) {
                const currentProfileIndex = VideoCallManager._currentAudioProfileIndex[VideoCallManager.currentPeerId] !== undefined ? VideoCallManager._currentAudioProfileIndex[VideoCallManager.currentPeerId] : AppSettings.adaptiveAudioQuality.initialProfileIndex;
                const profile = AppSettings.adaptiveAudioQuality.audioQualityProfiles[currentProfileIndex];
                this._updateAudioQualityDisplay({ peerId: VideoCallManager.currentPeerId, profileName: profile ? profile.levelName : "未知", profileIndex: currentProfileIndex, description: profile ? profile.description : "未知状态" });
            }
        } else {
            // 通话未激活，隐藏容器并重置相关 UI
            this.showCallContainer(false);
            if (this.audioQualityIndicatorEl) {
                this.audioQualityIndicatorEl.style.display = 'none';
            }
            return;
        }

        // 2. 根据不同模式（屏幕共享、纯音频）更新容器的 CSS 类
        if (callState.isScreenSharing) {
            this.callContainer.classList.add('screen-sharing-mode');
            this.callContainer.classList.remove('audio-only-mode');
        } else {
            this.callContainer.classList.remove('screen-sharing-mode');
            this.callContainer.classList.toggle('audio-only-mode', callState.isAudioOnly);
        }

        // 3. 更新画中画模式的 CSS 类
        this.callContainer.classList.toggle('pip-mode', this.isPipMode && callState.isCallActive);

        // 4. 控制本地视频的显示与流
        const showLocalVideo = VideoCallManager.localStream && !callState.isAudioOnly && callState.isVideoEnabled;
        if (callState.isScreenSharing) {
            // 屏幕共享时，发起方不显示自己的摄像头画面
            if (VideoCallManager.isCaller) {
                this.localVideo.style.display = 'none';
                this.localVideo.srcObject = null;
            } else { // 接收方正常显示
                this.localVideo.style.display = showLocalVideo ? 'block' : 'none';
                this.localVideo.srcObject = showLocalVideo ? VideoCallManager.localStream : null;
            }
        } else { // 非屏幕共享时，正常处理
            this.localVideo.style.display = showLocalVideo ? 'block' : 'none';
            this.localVideo.srcObject = showLocalVideo ? VideoCallManager.localStream : null;
        }

        // 5. 控制远程视频的显示与流
        const currentRemoteStream = this.remoteVideo.srcObject;
        const hasRemoteVideoTrack = currentRemoteStream instanceof MediaStream && currentRemoteStream.getVideoTracks().some(t => t.readyState === "live" && !t.muted);
        if ((callState.isScreenSharing && hasRemoteVideoTrack) || (!callState.isAudioOnly && hasRemoteVideoTrack)) {
            this.remoteVideo.style.display = 'block';
            if (this.remoteVideo.paused) this.remoteVideo.play().catch(e => Utils.log(`播放远程视频时出错: ${e.name} - ${e.message}`, Utils.logLevels.WARN));
        } else {
            this.remoteVideo.style.display = 'none';
        }

        // 6. 更新各个控制按钮的状态和样式
        // 纯音频切换按钮（仅在通话前可见）
        this.audioOnlyBtn.style.display = callState.isCallActive ? 'none' : 'inline-block';
        if (!callState.isCallActive) {
            this.audioOnlyBtn.style.background = callState.isAudioOnly ? 'var(--primary-color)' : '#fff';
            this.audioOnlyBtn.style.color = callState.isAudioOnly ? 'white' : 'var(--text-color)';
            this.audioOnlyBtn.innerHTML = callState.isAudioOnly ? '🎬' : '🔊';
            this.audioOnlyBtn.title = callState.isAudioOnly ? '切换到视频通话' : '切换到纯音频通话';
        }

        // 画中画按钮
        this.pipButton.style.display = callState.isCallActive ? 'inline-block' : 'none';
        if (callState.isCallActive) {
            this.pipButton.innerHTML = this.isPipMode ? '↗️' : '↙️';
            this.pipButton.title = this.isPipMode ? '最大化视频' : '最小化视频 (画中画)';
        }

        // 摄像头切换按钮
        const disableCameraToggle = callState.isAudioOnly || (callState.isScreenSharing && VideoCallManager.isCaller);
        this.cameraBtn.style.display = disableCameraToggle ? 'none' : 'inline-block';
        if (!disableCameraToggle) {
            this.cameraBtn.innerHTML = callState.isVideoEnabled ? '📹' : '🚫';
            this.cameraBtn.style.background = callState.isVideoEnabled ? '#fff' : '#666';
            this.cameraBtn.style.color = callState.isVideoEnabled ? 'var(--text-color)' : 'white';
            this.cameraBtn.title = callState.isVideoEnabled ? '关闭摄像头' : '打开摄像头';
        }

        // 麦克风静音按钮
        this.audioBtn.innerHTML = callState.isAudioMuted ? '🔇' : '🎤';
        this.audioBtn.style.background = callState.isAudioMuted ? '#666' : '#fff';
        this.audioBtn.style.color = callState.isAudioMuted ? 'white' : 'var(--text-color)';
        this.audioBtn.title = callState.isAudioMuted ? '取消静音' : '静音';
    },

    /**
     * 设置本地视频流到 `localVideo` 元素。
     * @function setLocalStream
     * @param {MediaStream|null} stream - 本地媒体流。如果为 null，则清除视频源。
     */
    setLocalStream: function(stream) {
        if (this.localVideo) {
            this.localVideo.srcObject = stream;
            // 如果有流且视频已暂停，则尝试播放
            if (stream && this.localVideo.paused) {
                this.localVideo.play().catch(e => Utils.log(`播放本地视频时出错: ${e.name}`, Utils.logLevels.WARN));
            }
        }
    },

    /**
     * 设置远程视频流到 `remoteVideo` 元素。
     * @function setRemoteStream
     * @param {MediaStream|null} stream - 远程媒体流。如果为 null，则清除视频源。
     */
    setRemoteStream: function(stream) {
        if (this.remoteVideo) {
            this.remoteVideo.srcObject = stream;
            // 如果有流且视频已暂停，则尝试播放
            if (stream && this.remoteVideo.paused) {
                this.remoteVideo.play().catch(e => Utils.log(`播放远程视频时出错: ${e.name}`, Utils.logLevels.WARN));
            }
        }
    },

    /**
     * 切换视频窗口的画中画 (PiP) 模式。
     * @function togglePipMode
     */
    togglePipMode: function () {
        if (!VideoCallManager.isCallActive || !this.callContainer) return;

        this.isPipMode = !this.isPipMode;
        this.callContainer.classList.toggle('pip-mode', this.isPipMode);

        if (this.isPipMode) {
            // 进入 PiP 模式
            // 1. 初始化拖动功能
            this.initPipDraggable(this.callContainer);
            // 2. 恢复上次保存的位置，或使用默认位置
            const lastLeft = this.callContainer.dataset.pipLeft;
            const lastTop = this.callContainer.dataset.pipTop;
            const containerWidth = this.callContainer.offsetWidth || 320;
            const containerHeight = this.callContainer.offsetHeight || 180;
            const defaultLeft = `${window.innerWidth - containerWidth - 20}px`;
            const defaultTop = `${window.innerHeight - containerHeight - 20}px`;
            this.callContainer.style.left = lastLeft || defaultLeft;
            this.callContainer.style.top = lastTop || defaultTop;
            // 3. 重置 right/bottom 以确保 left/top 生效
            this.callContainer.style.right = 'auto';
            this.callContainer.style.bottom = 'auto';
        } else {
            // 退出 PiP 模式
            // 1. 移除拖动功能
            this.removePipDraggable(this.callContainer);
            // 2. 保存当前位置，以便下次恢复
            if (this.callContainer.style.left && this.callContainer.style.left !== 'auto') this.callContainer.dataset.pipLeft = this.callContainer.style.left;
            if (this.callContainer.style.top && this.callContainer.style.top !== 'auto') this.callContainer.dataset.pipTop = this.callContainer.style.top;
            // 3. 清除行内样式，使其恢复由 CSS 控制的原始位置
            this.callContainer.style.left = ''; this.callContainer.style.top = '';
            this.callContainer.style.right = ''; this.callContainer.style.bottom = '';
            this.callContainer.style.transform = '';
        }

        // 更新 UI 以反映 PiP 按钮等的状态变化
        this.updateUIForCallState({
            isCallActive: VideoCallManager.isCallActive,
            isAudioOnly: VideoCallManager.isAudioOnly,
            isScreenSharing: VideoCallManager.isScreenSharing,
            isVideoEnabled: VideoCallManager.isVideoEnabled,
            isAudioMuted: VideoCallManager.isAudioMuted,
        });
    },

    /**
     * 重置画中画模式的视觉效果和状态。
     * @function resetPipVisuals
     */
    resetPipVisuals: function() {
        this.isPipMode = false;
        if (this.callContainer) {
            this.removePipDraggable(this.callContainer);
            this.callContainer.classList.remove('pip-mode');
            // 清理所有可能在 PiP 模式下设置的行内样式
            this.callContainer.style.left = ''; this.callContainer.style.top = '';
            this.callContainer.style.right = ''; this.callContainer.style.bottom = '';
            this.callContainer.style.transition = '';
            this.callContainer.style.transform = '';
        }
    },

    /**
     * 显示或隐藏通话容器。
     * @function showCallContainer
     * @param {boolean} [display=true] - `true` 表示显示, `false` 表示隐藏。
     */
    showCallContainer: function(display = true) {
        if (this.callContainer) {
            this.callContainer.style.display = display ? 'flex' : 'none';
            // 如果是隐藏操作，则重置 PiP 视觉效果并隐藏音频质量指示器
            if (!display) {
                this.resetPipVisuals();
                if (this.audioQualityIndicatorEl) {
                    this.audioQualityIndicatorEl.style.display = 'none';
                }
            }
        }
    },

    /**
     * 绑定 UI 元素的点击事件。
     * @function bindEvents
     * @private
     */
    bindEvents: function() {
        if (this.pipButton) this.pipButton.addEventListener('click', () => this.togglePipMode());
        if (this.cameraBtn) this.cameraBtn.addEventListener('click', () => VideoCallManager.toggleCamera());
        if (this.audioBtn) this.audioBtn.addEventListener('click', () => VideoCallManager.toggleAudio());
        if (this.audioOnlyBtn) this.audioOnlyBtn.addEventListener('click', () => VideoCallManager.toggleAudioOnly());
        if (this.endCallBtn) this.endCallBtn.addEventListener('click', () => VideoCallManager.hangUpMedia());
    },

    /**
     * 根据音频质量数据更新 UI 指示器。
     * @function _updateAudioQualityDisplay
     * @private
     * @param {object} data - 音频质量数据。
     * @param {string} data.peerId - 对应的对端 ID。
     * @param {string} data.profileName - 质量等级名称。
     * @param {number} data.profileIndex - 质量等级索引。
     * @param {string} data.description - 质量等级描述。
     */
    _updateAudioQualityDisplay: function(data) {
        // 如果指示器元素不存在、通话未激活或 peerId 不匹配，则不更新
        if (!this.audioQualityIndicatorEl || !VideoCallManager.isCallActive || VideoCallManager.currentPeerId !== data.peerId) {
            return;
        }
        const qualityText = data.profileName || `等级 ${data.profileIndex}`;
        // 重置 class
        this.audioQualityIndicatorEl.className = 'call-status-indicator';
        if (data.profileIndex !== undefined) {
            // 添加等级特定的 class
            this.audioQualityIndicatorEl.classList.add(`quality-level-${data.profileIndex}`);
            // 根据等级范围添加高、中、低范围的 class，用于视觉区分
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
     * 为指定元素初始化 PiP 窗口的拖动功能。
     * @function initPipDraggable
     * @private
     * @param {HTMLElement} element - 需要使其可拖动的元素。
     */
    initPipDraggable: function (element) {
        if (!element) return;
        // 同时监听鼠标和触摸事件
        element.addEventListener("mousedown", this._boundDragStart);
        element.addEventListener("touchstart", this._boundDragStartTouch, {passive: false});
    },

    /**
     * 移除元素的 PiP 窗口拖动功能。
     * @function removePipDraggable
     * @private
     * @param {HTMLElement} element - 需要移除拖动功能的元素。
     */
    removePipDraggable: function (element) {
        if (!element) return;
        // 移除所有可能已添加的拖动相关事件监听器
        element.removeEventListener("mousedown", this._boundDragStart);
        element.removeEventListener("touchstart", this._boundDragStartTouch);
        document.removeEventListener("mousemove", this._boundDrag);
        document.removeEventListener("mouseup", this._boundDragEnd);
        document.removeEventListener("touchmove", this._boundDragTouch);
        document.removeEventListener("touchend", this._boundDragEndTouch);
    },

    /**
     * 拖动开始的事件处理函数 (已重构)。
     * @function dragStart
     * @private
     * @param {MouseEvent|TouchEvent} e - 鼠标或触摸事件对象。
     */
    dragStart: function (e) {
        // 如果点击目标是按钮或指示器，则不触发拖动
        if (e.target.closest('.video-call-button') || e.target.id === 'audioQualityIndicator') return;
        // 必须在 PiP 模式和通话激活状态下才能拖动
        if (!this.isPipMode || !VideoCallManager.isCallActive || !this.callContainer) return;

        e.preventDefault();

        this.dragInfo.element = this.callContainer;
        this.dragInfo.active = true;

        // 1. 记录元素的初始布局位置和鼠标/触摸的初始位置
        const style = window.getComputedStyle(this.dragInfo.element);
        this.dragInfo.elementStartX = parseInt(style.left, 10) || 0;
        this.dragInfo.elementStartY = parseInt(style.top, 10) || 0;

        // 2. 根据事件类型（触摸或鼠标）记录初始光标位置并添加后续事件监听
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

        // 3. 准备拖动：禁用动画、改变光标样式、禁止页面文本选择
        this.dragInfo.originalTransition = this.dragInfo.element.style.transition;
        this.dragInfo.element.style.transition = 'none';
        this.dragInfo.element.style.cursor = 'grabbing';
        document.body.style.userSelect = 'none';
        if (typeof LayoutUIManager !== 'undefined' && LayoutUIManager.appContainer) {
            LayoutUIManager.appContainer.style.userSelect = 'none';
        }
    },

    /**
     * 拖动过程中的事件处理函数 (已重构)。
     * @function drag
     * @private
     * @param {MouseEvent|TouchEvent} e - 鼠标或触摸事件对象。
     */
    drag: function (e) {
        if (!this.dragInfo.active || !this.dragInfo.element) return;
        e.preventDefault();

        // 1. 获取当前的光标位置
        let cursorCurrentX, cursorCurrentY;
        if (e.type === "touchmove") {
            cursorCurrentX = e.touches[0].clientX;
            cursorCurrentY = e.touches[0].clientY;
        } else {
            cursorCurrentX = e.clientX;
            cursorCurrentY = e.clientY;
        }

        // 2. 计算光标从开始拖动以来的偏移量
        const deltaX = cursorCurrentX - this.dragInfo.cursorStartX;
        const deltaY = cursorCurrentY - this.dragInfo.cursorStartY;

        // 3. 计算元素的新位置 (初始位置 + 偏移量)
        let newX = this.dragInfo.elementStartX + deltaX;
        let newY = this.dragInfo.elementStartY + deltaY;

        // 4. 将新位置限制在浏览器视口范围内
        const viewportWidth = window.innerWidth;
        const viewportHeight = window.innerHeight;
        newX = Math.max(0, Math.min(newX, viewportWidth - this.dragInfo.element.offsetWidth));
        newY = Math.max(0, Math.min(newY, viewportHeight - this.dragInfo.element.offsetHeight));

        // 5. 直接更新元素的 left 和 top 样式。
        // NOTE: 由于在 dragStart 中已禁用 transition，直接修改 left/top 不会产生性能问题或视觉跳跃。
        this.dragInfo.element.style.left = `${newX}px`;
        this.dragInfo.element.style.top = `${newY}px`;
    },

    /**
     * 拖动结束的事件处理函数 (已重构)。
     * @function dragEnd
     * @private
     */
    dragEnd: function () {
        if (!this.dragInfo.active) return;

        this.dragInfo.active = false;

        // 1. 恢复页面和元素的样式
        document.body.style.userSelect = '';
        if (typeof LayoutUIManager !== 'undefined' && LayoutUIManager.appContainer) {
            LayoutUIManager.appContainer.style.userSelect = '';
        }

        if (this.dragInfo.element) {
            // 恢复元素的 transition 动画和光标样式
            this.dragInfo.element.style.transition = this.dragInfo.originalTransition || '';
            this.dragInfo.element.style.cursor = 'grab';
            // 2. 将最终位置保存在 dataset 中，以便下次进入 PiP 模式时恢复
            this.dragInfo.element.dataset.pipLeft = this.dragInfo.element.style.left;
            this.dragInfo.element.dataset.pipTop = this.dragInfo.element.style.top;
        }

        // 3. 移除在 document 上添加的事件监听器
        document.removeEventListener("mousemove", this._boundDrag);
        document.removeEventListener("mouseup", this._boundDragEnd);
        document.removeEventListener("touchmove", this._boundDragTouch);
        document.removeEventListener("touchend", this._boundDragEndTouch);

        // 4. 清理拖动信息
        this.dragInfo.element = null;
    }
};