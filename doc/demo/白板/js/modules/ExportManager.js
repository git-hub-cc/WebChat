// js/modules/ExportManager.js
import Modal from './Modal.js'; // 引入我们自定义的 Modal 模块

class ExportManager {
    constructor(canvas) {
        this.canvas = canvas;
        this.exportBtn = document.querySelector('.header-actions .action-btn');
        this.modal = new Modal(); // 创建 Modal 实例，以便在整个类中使用

        this._initEventListeners();
    }

    _initEventListeners() {
        this.exportBtn.addEventListener('click', () => {
            this.showExportDialog();
        });
    }

    /**
     * 使用自定义模态框异步显示导出配置
     */
    async showExportDialog() {
        // 定义模态框主体部分的 HTML
        const bodyHtml = `
            <div class="form-group">
                <label for="export-format">导出格式</label>
                <select name="format" id="export-format">
                    <option value="png" selected>PNG (推荐, 支持透明)</option>
                    <option value="jpeg">JPEG (有损压缩, 体积小)</option>
                    <option value="svg">SVG (矢量格式, 可缩放)</option>
                </select>
            </div>
            <div class="form-group checkbox-group">
                <input type="checkbox" name="includeBackground" id="include-background" checked>
                <label for="include-background">包含背景色</label>
            </div>
        `;

        // 使用 await 等待用户交互的结果
        const result = await this.modal.show("导出选项", bodyHtml);

        // 如果用户点击了“确认” (result 不为 null)
        if (result) {
            // FormData 会将选中的 checkbox 的值设为 'on'，未选中则不存在该键。
            const options = {
                includeBackground: result.includeBackground === 'on'
            };
            this.export(result.format, options);
        }
        // 如果用户点击了“取消”或关闭模态框，result 为 null，则不执行任何操作。
    }

    /**
     * 执行导出操作
     * @param {string} format - 'png', 'jpeg', or 'svg'
     * @param {object} options - 导出选项, e.g., { includeBackground: true }
     */
    export(format, options) {
        // 保存原始背景色，以便操作结束后恢复
        const originalBackgroundColor = this.canvas.backgroundColor;

        // 根据用户选项和格式要求，临时修改画布背景
        if (format === 'jpeg' && !options.includeBackground) {
            // JPEG 不支持透明度，若用户不希望包含背景，则强制使用白色背景
            this.canvas.backgroundColor = '#ffffff';
            this.canvas.renderAll();
        } else if (!options.includeBackground) {
            // 对于 PNG 和 SVG，可以设置为透明
            this.canvas.backgroundColor = 'transparent';
            this.canvas.renderAll();
        }

        let dataURL;
        const fileExtension = format;

        if (format === 'png' || format === 'jpeg') {
            dataURL = this.getRasterDataURL(format); // 获取光栅图片 (PNG/JPEG)
        } else if (format === 'svg') {
            dataURL = this.getSVGDataURL();
        }

        // 无论导出成功与否，都恢复画布的原始背景色
        this.canvas.backgroundColor = originalBackgroundColor;
        this.canvas.renderAll();

        // 如果成功获取了数据 URL，则触发下载
        if (dataURL) {
            this.download(dataURL, `canvas-drawing.${fileExtension}`);
        }
    }

    /**
     * 获取智能裁剪后的光栅图片 (PNG/JPEG) 数据 URL
     * @param {string} format - 'png' or 'jpeg'
     * @returns {string|null} - Data URL or null if canvas is empty
     */
    getRasterDataURL(format = 'png') {
        // 计算所有对象的边界框，以实现智能裁剪
        const contentArea = this.canvas.getObjects().reduce((box, obj) => {
            if (obj.excludeFromExport) return box; // 忽略不应导出的对象
            const objBox = obj.getBoundingRect();
            if (!box.left || objBox.left < box.left) box.left = objBox.left;
            if (!box.top || objBox.top < box.top) box.top = objBox.top;
            if (!box.right || (objBox.left + objBox.width) > box.right) box.right = objBox.left + objBox.width;
            if (!box.bottom || (objBox.top + objBox.height) > box.bottom) box.bottom = objBox.top + objBox.height;
            return box;
        }, {});

        // 如果画布为空，则不导出
        if (Object.keys(contentArea).length === 0) {
            this.modal.show("导出错误", "<p>画布为空，无法导出！</p>"); // 使用模态框提示错误
            return null;
        }

        const padding = 20; // 在内容周围添加一些内边距

        // 调用 toDataURL 并传入裁剪区域和格式选项
        return this.canvas.toDataURL({
            format: format,
            quality: format === 'jpeg' ? 0.9 : 1.0, // JPEG 可以设置压缩质量
            left: contentArea.left - padding,
            top: contentArea.top - padding,
            width: (contentArea.right - contentArea.left) + (padding * 2),
            height: (contentArea.bottom - contentArea.top) + (padding * 2),
        });
    }

    /**
     * 获取 SVG 格式的数据 URL
     * @returns {string} - Data URL
     */
    getSVGDataURL() {
        // Fabric.js 内置的 toSVG 方法
        const svgString = this.canvas.toSVG();
        // 将 SVG 字符串编码为可以在 URL 中使用的格式
        return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svgString);
    }

    /**
     * 创建一个隐藏的 a 标签并触发点击，以下载文件
     * @param {string} dataURL - 文件的 Data URL
     * @param {string} filename - 下载后的文件名
     */
    download(dataURL, filename) {
        const link = document.createElement('a');
        link.href = dataURL;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    }
}

export default ExportManager;