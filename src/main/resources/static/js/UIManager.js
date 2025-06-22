/**
 * @file UIManager.js
 * @description 一个高度精简的通用 UI 管理器。
 *              随着项目重构，大部分具体的 UI 管理职责已被移交给了更专业的管理器
 *              （如 ChatAreaUIManager, SidebarUIManager, ModalUIManager 等）。
 *              此文件现在只保留了不适合放在其他任何地方的、非常通用的 UI 功能。
 *              新增: showFullVideo 用于全屏播放视频。
 *              修改: 全屏视频播放器现在高度100%，宽度自适应，保持比例。
 *              修改: 点击视频播放器外部区域可以关闭视频查看器。
 * @module UIManager
 * @exports {object} UIManager - 对外暴露的单例对象，包含剩余的通用 UI 方法。
 * @property {function} checkWebRTCSupport - 检查浏览器是否支持 WebRTC。
 * @property {function} showFullImage - 在一个模态框中显示全尺寸图片。
 * @property {function} showFullVideo - 在一个模态框中显示全屏视频。
 * @dependencies LayoutUIManager
 * @dependents AppInitializer (调用以检查 WebRTC 支持), MessageManager (调用以显示全尺寸图片/视频)
 */
const UIManager = {
    /**
     * 检查浏览器是否支持 WebRTC (RTCPeerConnection)。
     * 如果不支持，会更新全局状态指示器并返回 false。
     * @returns {boolean} - true 表示支持，false 表示不支持。
     */
    checkWebRTCSupport: function () {
        if (typeof RTCPeerConnection === 'undefined') { // 检查 RTCPeerConnection 是否定义
            LayoutUIManager.updateConnectionStatusIndicator('浏览器不支持 WebRTC。', 'error'); // 更新状态指示
            return false;
        }
        return true;
    },

    /**
     * 在一个覆盖全屏的模态框中显示一张图片。
     * @param {string} src - 图片的源 URL。
     * @param {string} [altText="图片"] - 图片的替代文本。
     */
    showFullImage: function (src, altText = "图片") {
        const modal = document.createElement('div'); // 创建模态框容器
        modal.className = 'modal-like image-viewer'; // 应用样式
        // 设置模态框样式
        modal.style.backgroundColor = 'rgba(0,0,0,0.85)';
        modal.style.position = 'fixed';
        modal.style.top = '0';
        modal.style.left = '0';
        modal.style.width = '100%';
        modal.style.height = '100%';
        modal.style.display = 'flex';
        modal.style.alignItems = 'center';
        modal.style.justifyContent = 'center';
        modal.style.zIndex = '1001'; // 确保在顶层

        const img = document.createElement('img'); // 创建图片元素
        img.src = src;
        img.alt = altText;
        // 设置图片样式
        img.style.maxWidth = '90%';
        img.style.maxHeight = '90%';
        img.style.objectFit = 'contain'; // 保持图片比例
        img.style.borderRadius = 'var(--border-radius)'; // 应用圆角
        img.style.boxShadow = '0 0 30px rgba(0,0,0,0.5)'; // 添加阴影

        modal.appendChild(img); // 将图片添加到模态框
        // 点击模态框任意位置关闭
        modal.addEventListener('click', () => {
            modal.remove();
            // 如果 src 是 Object URL，调用者应负责 revoke
            // 但通常对于图片，src 是 Data URL 或普通 URL，不需要 revoke
        });
        document.body.appendChild(modal); // 将模态框添加到body
    },

    /**
     * 在一个覆盖全屏的模态框中显示一个视频。
     * @param {string} src - 视频的源 URL (通常是 Object URL)。
     * @param {string} [altText="视频"] - 视频的替代文本或标题。
     * @param {string} [fileType] - 视频的 MIME 类型，可选。
     */
    showFullVideo: function (src, altText = "视频", fileType) {
        const modal = document.createElement('div');
        modal.className = 'modal-like video-viewer'; // 与图片查看器类似的类名
        modal.style.backgroundColor = 'rgba(0,0,0,0.9)';
        modal.style.position = 'fixed';
        modal.style.top = '0';
        modal.style.left = '0';
        modal.style.width = '100%';
        modal.style.height = '100%';
        modal.style.display = 'flex';
        modal.style.alignItems = 'center';
        modal.style.justifyContent = 'center';
        modal.style.zIndex = '1001';

        const videoContainer = document.createElement('div');
        videoContainer.style.display = 'flex';
        videoContainer.style.alignItems = 'center';
        videoContainer.style.justifyContent = 'center';
        videoContainer.style.width = '95vw';
        videoContainer.style.height = '95vh';
        videoContainer.style.position = 'relative';


        const video = document.createElement('video');
        video.src = src;
        video.controls = true;
        video.autoplay = true;
        video.style.display = 'block';
        video.style.maxHeight = '100%';
        video.style.maxWidth = '100%';
        video.style.height = 'auto';
        video.style.width = 'auto';
        video.style.objectFit = 'contain';
        video.style.borderRadius = 'var(--border-radius)';
        video.style.boxShadow = '0 0 30px rgba(0,0,0,0.5)';
        if (fileType) {
            const source = document.createElement('source');
            source.src = src;
            source.type = fileType;
            video.appendChild(source);
        }
        video.setAttribute('title', altText);

        const closeButton = document.createElement('button');
        closeButton.textContent = '×';
        closeButton.className = 'modal-close-button top-right';
        closeButton.style.position = 'absolute';
        closeButton.style.top = '10px';
        closeButton.style.right = '10px';
        closeButton.style.zIndex = '1002';
        closeButton.style.fontSize = '1.8em';
        closeButton.style.padding = '0.1em 0.4em';
        closeButton.style.lineHeight = '1';
        closeButton.style.background = 'rgba(30, 30, 30, 0.7)';
        closeButton.style.color = 'white';
        closeButton.style.border = 'none';
        closeButton.style.borderRadius = '50%';
        closeButton.style.cursor = 'pointer';
        closeButton.setAttribute('aria-label', '关闭视频');


        const closeModalAndRevoke = () => {
            video.pause();
            URL.revokeObjectURL(src);
            modal.remove();
        };

        closeButton.addEventListener('click', (e) => {
            e.stopPropagation(); // 阻止事件冒泡到 videoContainer 或 modal
            closeModalAndRevoke();
        });

        // 点击 videoContainer 但非 video 元素或关闭按钮本身时关闭
        videoContainer.addEventListener('click', (event) => {
            if (event.target === videoContainer) { // 只有当直接点击 videoContainer 时
                closeModalAndRevoke();
            }
            // 如果点击的是 video 或 closeButton，此处的 target 不会是 videoContainer，所以不会关闭
        });

        // 点击最外层 modal 背景（videoContainer之外）时关闭
        modal.addEventListener('click', (event) => {
            if (event.target === modal) {
                closeModalAndRevoke();
            }
        });

        // 阻止视频元素上的点击事件冒泡到 videoContainer (如果 videoContainer 也有关闭逻辑)
        // 或者，更简单的方式是在 videoContainer 的事件处理器中检查 event.target
        // video.addEventListener('click', (event) => {
        //     event.stopPropagation();
        // });

        videoContainer.appendChild(video);
        videoContainer.appendChild(closeButton);
        modal.appendChild(videoContainer);
        document.body.appendChild(modal);

        video.focus();
    },
};