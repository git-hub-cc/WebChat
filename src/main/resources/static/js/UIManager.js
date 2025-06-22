/**
 * @file UIManager.js
 * @description 一个高度精简的通用 UI 管理器。
 *              随着项目重构，大部分具体的 UI 管理职责已被移交给了更专业的管理器
 *              （如 ChatAreaUIManager, SidebarUIManager, ModalUIManager 等）。
 *              此文件现在只保留了不适合放在其他任何地方的、非常通用的 UI 功能。
 * @module UIManager
 * @exports {object} UIManager - 对外暴露的单例对象，包含剩余的通用 UI 方法。
 * @property {function} checkWebRTCSupport - 检查浏览器是否支持 WebRTC。
 * @property {function} showFullImage - 在一个模态框中显示全尺寸图片。
 * @dependencies LayoutUIManager
 * @dependents AppInitializer (调用以检查 WebRTC 支持), MessageManager (调用以显示全尺寸图片)
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
        modal.addEventListener('click', () => modal.remove());
        document.body.appendChild(modal); // 将模态框添加到body
    },
};