/**
 * @file 管理截图编辑器的用户界面 (UI) 和交互逻辑
 * @description
 * 负责截图编辑器的全部 UI 管理和用户交互处理。它提供了图像裁剪和矩形标记（支持颜色选择）的核心功能。
 * 用户可以通过此模块对捕获的屏幕截图进行初步编辑。编辑确认后，模块会计算最终图像的哈希值，并将图像 Blob 和元数据通过事件派发出去。
 * @module ScreenshotEditorUIManager
 * @exports {object} ScreenshotEditorUIManager - ScreenshotEditorUIManager 的单例对象，提供所有公开方法。
 * @dependency Utils - 提供通用的工具函数，如日志记录、哈希计算、几何计算等。
 * @dependency NotificationUIManager - 用于向用户显示通知信息（例如，操作成功、错误提示）。
 * @dependency EventEmitter - 用于模块间的事件发布和订阅机制。
 * @dependency AppSettings - 提供截图编辑器的相关配置常量，如默认颜色、最小裁剪尺寸等。
 */
const ScreenshotEditorUIManager = {
    // DOM 元素引用
    // 编辑器模态框主容器元素
    editorModalEl: null,
    // Canvas 画布元素，用于图像绘制和交互
    canvasEl: null,
    // Canvas 2D 绘图上下文
    ctx: null,
    // 工具栏容器元素
    toolbarEl: null,
    // 裁剪工具按钮
    cropToolBtn: null,
    // 绘制矩形工具按钮
    drawRectToolBtn: null,
    // 标记颜色选择器元素
    markColorPickerEl: null,
    // 确认编辑按钮
    confirmBtn: null,
    // 取消编辑按钮
    cancelBtn: null,

    // 图像和媒体流数据
    // 原始截图的 Image 对象，作为绘制的基础
    rawImage: null,
    // 截图时使用的原始媒体流 (例如屏幕共享流)，用于在操作结束后停止
    originalStream: null,

    // 编辑器核心状态
    // 编辑器是否处于活动状态，控制所有交互的开关
    isEditorActive: false,
    // 当前选中的工具 ('crop', 'drawRect', 或 null)
    currentTool: null,

    // 裁剪相关状态
    // 标记是否正在从头开始绘制一个新的裁剪矩形
    isCropping: false,
    // 标记是否正在移动已有的裁剪矩形
    isMovingCrop: false,
    // 标记是否正在通过控制点调整裁剪矩形的大小
    isResizingCrop: false,
    // 当前裁剪矩形对象 {x, y, w, h}
    cropRect: null,
    // 裁剪矩形的8个控制点对象数组
    cropHandles: [],
    // 当前被激活（被鼠标按下）的裁剪控制点ID
    activeCropHandle: null,
    // 移动裁剪框时，鼠标相对于裁剪框左上角的X轴偏移量
    cropMoveOffsetX: 0,
    // 移动裁剪框时，鼠标相对于裁剪框左上角的Y轴偏移量
    cropMoveOffsetY: 0,

    // 标记相关状态
    // 标记是否正在绘制一个新的标记矩形
    isDrawingMark: false,
    // 当前正在绘制的标记矩形对象 {x, y, w, h}
    currentMarkRect: null,
    // 已确认并绘制的标记对象数组
    marks: [],

    // 鼠标/触摸事件坐标状态
    // 鼠标按下或触摸开始时的X坐标
    startX: 0,
    // 鼠标按下或触摸开始时的Y坐标
    startY: 0,
    // 当前鼠标在Canvas内的X坐标
    mouseX: 0,
    // 当前鼠标在Canvas内的Y坐标
    mouseY: 0,

    // 标记样式状态
    // 当前选中的标记颜色，默认为红色
    currentMarkColor: '#FF0000',

    /**
     * 初始化截图编辑器UI管理器，是模块的入口函数。
     * @function init
     * @description
     * 获取所有必要的DOM元素引用，设置Canvas的2D绘图上下文，
     * 初始化默认标记颜色，并绑定所有事件监听器。
     * 如果关键DOM元素未找到，将记录错误。
     */
    init: function() {
        // 1. 获取所有需要的 DOM 元素
        this.editorModalEl = document.getElementById('screenshotEditorModal');
        this.canvasEl = document.getElementById('screenshotEditorCanvas');
        this.toolbarEl = document.getElementById('screenshotEditorToolbar');
        this.cropToolBtn = document.getElementById('cropToolBtn');
        this.drawRectToolBtn = document.getElementById('drawRectToolBtn');
        this.markColorPickerEl = document.getElementById('markColorPicker');
        this.confirmBtn = document.getElementById('confirmScreenshotEditBtn');
        this.cancelBtn = document.getElementById('cancelScreenshotEditBtn');

        // 2. 校验关键元素是否存在
        if (!this.editorModalEl || !this.canvasEl || !this.toolbarEl || !this.confirmBtn || !this.cancelBtn || !this.markColorPickerEl) {
            Utils.log('ScreenshotEditorUIManager: 初始化失败，部分编辑器DOM元素未找到。截图编辑功能可能无法使用。', Utils.logLevels.ERROR);
            return;
        }
        if (this.canvasEl) {
            this.ctx = this.canvasEl.getContext('2d');
        } else {
            Utils.log('ScreenshotEditorUIManager: Canvas元素未找到，无法获取2D上下文。', Utils.logLevels.ERROR);
            return;
        }

        // 3. 初始化默认状态
        this.currentMarkColor = this.markColorPickerEl.value || AppSettings.media.screenshotEditor.defaultMarkColor;

        // 4. 绑定事件
        this._bindEvents();
        Utils.log('ScreenshotEditorUIManager initialized.', Utils.logLevels.INFO);
    },

    /**
     * 绑定编辑器内部及与其他模块交互所需的事件监听器。
     * @function _bindEvents
     * @private
     * @description
     * 监听来自 EventEmitter 的 `rawScreenshotCaptured` 事件以启动编辑器。
     * 同时绑定编辑器内部所有UI元素（如工具按钮、确认/取消按钮、颜色选择器）的交互事件，
     * 以及Canvas上的鼠标和触摸事件，以实现裁剪和绘制功能。
     */
    _bindEvents: function() {
        // 监听来自MediaManager的原始截图事件
        if (typeof EventEmitter !== 'undefined') {
            EventEmitter.on('rawScreenshotCaptured', this._handleRawScreenshot.bind(this));
        } else {
            Utils.log('ScreenshotEditorUIManager: EventEmitter 未定义，无法监听 rawScreenshotCaptured 事件。', Utils.logLevels.WARN);
        }

        // 绑定编辑器按钮点击事件
        if (this.confirmBtn) this.confirmBtn.addEventListener('click', this._confirmEdit.bind(this));
        if (this.cancelBtn) this.cancelBtn.addEventListener('click', this._cancelEdit.bind(this));
        if (this.cropToolBtn) this.cropToolBtn.addEventListener('click', this._activateCropTool.bind(this));
        if (this.drawRectToolBtn) this.drawRectToolBtn.addEventListener('click', this._activateDrawRectTool.bind(this));

        // 绑定颜色选择器输入事件
        if (this.markColorPickerEl) {
            this.markColorPickerEl.addEventListener('input', (event) => {
                this.currentMarkColor = event.target.value;
                Utils.log(`标记颜色已更改为: ${this.currentMarkColor}`, Utils.logLevels.DEBUG);
            });
        }

        // 绑定Canvas的鼠标事件
        this.canvasEl.addEventListener('mousedown', this._handleCanvasMouseDown.bind(this));
        this.canvasEl.addEventListener('mousemove', this._handleCanvasMouseMove.bind(this));
        this.canvasEl.addEventListener('mouseup', this._handleCanvasMouseUp.bind(this));
        this.canvasEl.addEventListener('mouseleave', this._handleCanvasMouseLeave.bind(this));

        // 绑定Canvas的触摸事件，设置 passive: false 以允许 e.preventDefault()
        this.canvasEl.addEventListener('touchstart', this._handleCanvasTouchStart.bind(this), { passive: false });
        this.canvasEl.addEventListener('touchmove', this._handleCanvasTouchMove.bind(this), { passive: false });
        this.canvasEl.addEventListener('touchend', this._handleCanvasTouchEnd.bind(this));
    },

    /**
     * 用户确认编辑操作。
     * @function _confirmEdit
     * @private
     * @description
     * 异步函数，负责处理最终的图像输出。
     * 1. 创建一个离屏 Canvas 以绘制最终结果。
     * 2. 根据是否存在 `cropRect`，确定源图像的裁剪区域和最终输出尺寸。
     * 3. 将原始图像的相应部分绘制到离屏 Canvas 上。
     * 4. 将所有已确认的标记（`marks`）也绘制到离屏 Canvas 上，并进行坐标转换。
     * 5. 将离屏 Canvas 的内容转换为 Blob 对象。
     * 6. 异步计算 Blob 的哈希值。
     * 7. 构建包含 blob、hash、文件名等信息的文件对象。
     * 8. 通过 EventEmitter 发出 `screenshotEditingComplete` 事件，并将文件对象作为载荷。
     * 9. 关闭编辑器并清理资源。
     * @returns {Promise<void>}
     */
    _confirmEdit: async function() {
        if (!this.isEditorActive || !this.canvasEl || !this.ctx || !this.rawImage) {
            Utils.log('确认编辑被调用，但编辑器未激活或画布未准备好。', Utils.logLevels.WARN);
            this._closeEditorAndStopStream();
            return;
        }
        Utils.log('ScreenshotEditorUIManager._confirmEdit called.', Utils.logLevels.INFO);
        NotificationUIManager.showNotification('正在处理截图...', 'info');

        // 1. 创建一个新的离屏 Canvas 用于最终输出
        const finalCanvas = document.createElement('canvas');
        const finalCtx = finalCanvas.getContext('2d');

        // 2. 确定源图像的裁剪区域和输出尺寸
        let sourceX = 0, sourceY = 0;
        let outputWidth = this.rawImage.width;
        let outputHeight = this.rawImage.height;

        if (this.cropRect && this.cropRect.w > 0 && this.cropRect.h > 0) {
            sourceX = this.cropRect.x;
            sourceY = this.cropRect.y;
            outputWidth = this.cropRect.w;
            outputHeight = this.cropRect.h;
        }

        finalCanvas.width = outputWidth;
        finalCanvas.height = outputHeight;

        // 3. 将原始图像的选定（或全部）区域绘制到离屏 Canvas
        finalCtx.drawImage(this.rawImage, sourceX, sourceY, outputWidth, outputHeight, 0, 0, outputWidth, outputHeight);

        // 4. 在离屏 Canvas 上绘制所有标记
        this.marks.forEach(mark => {
            if (mark.type === 'rect') {
                // 将标记的全局坐标转换为相对于裁剪后图像的局部坐标
                const markXInFinal = mark.x - sourceX;
                const markYInFinal = mark.y - sourceY;
                // 确保标记至少有一部分在最终输出图像的边界内
                if (markXInFinal + mark.w > 0 && markXInFinal < outputWidth &&
                    markYInFinal + mark.h > 0 && markYInFinal < outputHeight) {
                    finalCtx.strokeStyle = mark.color || AppSettings.media.screenshotEditor.defaultMarkColor;
                    finalCtx.lineWidth = mark.lineWidth || AppSettings.media.screenshotEditor.defaultMarkLineWidth;
                    finalCtx.strokeRect(markXInFinal, markYInFinal, mark.w, mark.h);
                }
            }
        });

        // 5. 将离屏 Canvas 内容转换为 Blob
        finalCanvas.toBlob(async (blob) => {
            if (!blob) {
                NotificationUIManager.showNotification('处理截图失败：无法生成图片 Blob。', 'error');
                this._closeEditorAndStopStream();
                return;
            }

            try {
                // 6. 计算哈希并创建预览 URL
                const fileHash = await Utils.generateFileHash(blob);
                const previewUrl = URL.createObjectURL(blob);
                const fileName = `screenshot_edited_${Date.now()}.png`;

                // 7. 构建文件对象
                const editedFile = {
                    blob: blob,
                    hash: fileHash,
                    name: fileName,
                    type: 'image/png',
                    size: blob.size,
                    previewUrl: previewUrl
                };
                // 8. 发出编辑完成事件
                EventEmitter.emit('screenshotEditingComplete', editedFile);
                // 9. 关闭编辑器
                this._closeEditorAndStopStream();
            } catch (hashError) {
                Utils.log(`计算编辑后截图哈希失败: ${hashError}`, Utils.logLevels.ERROR);
                NotificationUIManager.showNotification('处理截图失败：哈希计算错误。', 'error');
                this._closeEditorAndStopStream();
            }
        }, 'image/png');
    },

    /**
     * 用户取消编辑操作。
     * @function _cancelEdit
     * @private
     */
    _cancelEdit: function() {
        Utils.log('ScreenshotEditorUIManager._cancelEdit called.', Utils.logLevels.INFO);
        // 1. 发出取消事件
        EventEmitter.emit('screenshotEditingCancelled');
        // 2. 关闭编辑器并清理资源
        this._closeEditorAndStopStream();
    },

    /**
     * 处理从 EventEmitter 接收到的原始截图数据，是编辑器启动的入口。
     * @function _handleRawScreenshot
     * @private
     * @param {object} detail - 事件传递的数据对象。
     * @param {string} detail.dataUrl - 原始截图的 Base64 Data URL。
     * @param {Blob} detail.blob - 原始截图的 Blob 对象。
     * @param {MediaStream} detail.originalStream - 截图时使用的原始媒体流。
     */
    _handleRawScreenshot: function(detail) {
        Utils.log('原始截图已由 ScreenshotEditorUIManager 接收。', Utils.logLevels.DEBUG);
        // 1. 校验传入的数据是否完整
        if (!detail || !detail.dataUrl || !detail.blob || !detail.originalStream) {
            NotificationUIManager.showNotification('接收截图数据不完整。', 'error');
            // 即使数据不完整，也尝试停止流以释放资源
            if (detail && detail.originalStream) {
                detail.originalStream.getTracks().forEach(track => track.stop());
            }
            this.isEditorActive = false;
            return;
        }

        // 2. 重置编辑器所有状态，为新的编辑会话做准备
        this.rawImage = null;
        this.originalStream = detail.originalStream;
        this.isEditorActive = true;
        this.currentTool = null;
        this.cropRect = null;
        this.marks = [];
        this.isCropping = false;
        this.isMovingCrop = false;
        this.isResizingCrop = false;
        this.isDrawingMark = false;
        this.currentMarkRect = null;
        this.cropHandles = [];
        this.activeCropHandle = null;

        // 3. 重置颜色选择器为默认颜色
        if (this.markColorPickerEl) {
            this.markColorPickerEl.value = AppSettings.media.screenshotEditor.defaultMarkColor;
            this.currentMarkColor = AppSettings.media.screenshotEditor.defaultMarkColor;
        }

        // 4. 加载图像
        const img = new Image();
        img.onload = () => {
            this.rawImage = img;
            this._showEditor(); // 图像加载成功后显示编辑器
        };
        img.onerror = () => {
            NotificationUIManager.showNotification('加载截图到编辑器失败。', 'error');
            Utils.log('ScreenshotEditorUIManager: 图片加载失败 (img.onerror)。', Utils.logLevels.ERROR);
            this._closeEditorAndStopStream();
        };
        img.src = detail.dataUrl;
    },

    /**
     * 显示编辑器模态框，并将原始图像绘制到 Canvas 上。
     * @function _showEditor
     * @private
     */
    _showEditor: function() {
        if (!this.editorModalEl || !this.canvasEl || !this.ctx || !this.rawImage) {
            Utils.log('ScreenshotEditorUIManager._showEditor: 关键元素或数据缺失，无法显示编辑器。', Utils.logLevels.ERROR);
            this._closeEditorAndStopStream();
            return;
        }

        // 1. 设置 Canvas 尺寸与图像一致
        this.canvasEl.width = this.rawImage.width;
        this.canvasEl.height = this.rawImage.height;

        // 2. 初始绘制
        this._redrawCanvas();

        // 3. 显示模态框并更新UI状态
        this.editorModalEl.style.display = 'flex';
        this._updateToolButtons();
        Utils.log('截图编辑器已显示并加载图像。', Utils.logLevels.INFO);

        // 4. 默认激活裁剪工具
        this._activateCropTool();
    },

    /**
     * 关闭编辑器UI界面，并停止关联的媒体流。
     * @function _closeEditorAndStopStream
     * @private
     * @description
     * 这是一个清理函数，用于在编辑完成、取消或发生错误时调用。
     * 它会隐藏UI、清空画布、停止媒体流并重置所有内部状态变量，确保资源被释放。
     */
    _closeEditorAndStopStream: function() {
        // 1. 隐藏UI元素
        if (this.editorModalEl) this.editorModalEl.style.display = 'none';
        if (this.ctx && this.canvasEl && this.rawImage) {
            this.ctx.clearRect(0, 0, this.canvasEl.width, this.canvasEl.height);
        }

        // 2. 停止原始媒体流的轨道
        if (this.originalStream) {
            this.originalStream.getTracks().forEach(track => track.stop());
            Utils.log('截图的原始媒体流已停止。', Utils.logLevels.INFO);
        }

        // 3. 重置所有状态变量
        this.rawImage = null;
        this.originalStream = null;
        this.isEditorActive = false;
        this.currentTool = null;
        this.isCropping = false;
        this.isMovingCrop = false;
        this.isResizingCrop = false;
        this.isDrawingMark = false;
        this.cropRect = null;
        this.marks = [];
        this.cropHandles = [];
        this.activeCropHandle = null;
        if(this.canvasEl) this.canvasEl.style.cursor = 'default';
        if(this.markColorPickerEl) this.markColorPickerEl.style.display = 'none';
    },

    /**
     * 重新绘制整个 Canvas 画布。
     * @function _redrawCanvas
     * @private
     * @description
     * 这是核心的渲染函数，负责在每次状态变更后更新画布内容。绘制顺序如下：
     * 1. 绘制原始背景图像。
     * 2. 如果存在裁剪区域(`cropRect`)，绘制半透明遮罩以突出显示裁剪部分。
     * 3. 如果当前是裁剪工具，绘制裁剪框的边框和控制点。
     * 4. 绘制所有已确认的标记(`marks`)。
     * 5. 如果正在绘制新标记，绘制该标记的实时预览。
     */
    _redrawCanvas: function() {
        if (!this.ctx || !this.rawImage) return;

        // 1. 清空画布并绘制原始图像
        this.ctx.clearRect(0, 0, this.canvasEl.width, this.canvasEl.height);
        this.ctx.drawImage(this.rawImage, 0, 0);

        // 2. 如果存在裁剪矩形 (cropRect)，则绘制半透明遮罩
        if (this.cropRect) {
            this.ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
            // 绘制裁剪区域外的四个矩形遮罩，形成“挖空”效果
            this.ctx.fillRect(0, 0, this.canvasEl.width, this.cropRect.y); // 顶部
            this.ctx.fillRect(0, this.cropRect.y + this.cropRect.h, this.canvasEl.width, this.canvasEl.height - (this.cropRect.y + this.cropRect.h)); // 底部
            this.ctx.fillRect(0, this.cropRect.y, this.cropRect.x, this.cropRect.h); // 左侧
            this.ctx.fillRect(this.cropRect.x + this.cropRect.w, this.cropRect.y, this.canvasEl.width - (this.cropRect.x + this.cropRect.w), this.cropRect.h); // 右侧

            // 3. 如果当前工具是 'crop'，额外绘制裁剪框的边框和控制点
            if (this.currentTool === 'crop') {
                this.ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
                this.ctx.lineWidth = 2;
                this.ctx.strokeRect(this.cropRect.x, this.cropRect.y, this.cropRect.w, this.cropRect.h);
                if (!this.isCropping || (this.cropRect.w !== 0 || this.cropRect.h !== 0)) {
                    this._drawCropHandles();
                }
            }
        }

        // 4. 绘制所有已确认的标记
        this.marks.forEach(mark => {
            if (mark.type === 'rect') {
                this.ctx.strokeStyle = mark.color || AppSettings.media.screenshotEditor.defaultMarkColor;
                this.ctx.lineWidth = mark.lineWidth || AppSettings.media.screenshotEditor.defaultMarkLineWidth;
                this.ctx.strokeRect(mark.x, mark.y, mark.w, mark.h);
            }
        });

        // 5. 绘制当前正在绘制的标记（预览）
        if (this.isDrawingMark && this.currentMarkRect && this.currentTool === 'drawRect') {
            let rectToDrawPreview = { ...this.currentMarkRect };

            // 标准化预览矩形，确保宽高为正值
            let normalizedPreview = { ...rectToDrawPreview };
            if (normalizedPreview.w < 0) { normalizedPreview.x += normalizedPreview.w; normalizedPreview.w *= -1; }
            if (normalizedPreview.h < 0) { normalizedPreview.y += normalizedPreview.h; normalizedPreview.h *= -1; }

            // 如果存在裁剪区域，将标记预览限制在裁剪区域内
            if (this.cropRect) {
                const clippedLivePreview = Utils.clipRectToArea(normalizedPreview, this.cropRect);
                rectToDrawPreview = clippedLivePreview || null;
            } else {
                rectToDrawPreview = normalizedPreview;
            }

            // 仅当矩形有效且有尺寸时绘制
            if (rectToDrawPreview && rectToDrawPreview.w > 0 && rectToDrawPreview.h > 0) {
                this.ctx.strokeStyle = this.currentMarkColor;
                this.ctx.lineWidth = AppSettings.media.screenshotEditor.defaultMarkLineWidth;
                this.ctx.strokeRect(rectToDrawPreview.x, rectToDrawPreview.y, rectToDrawPreview.w, rectToDrawPreview.h);
            }
        }
    },

    /**
     * 激活裁剪工具。
     * @function _activateCropTool
     * @private
     */
    _activateCropTool: function() {
        this.currentTool = 'crop';
        this.isCropping = false;
        this.isMovingCrop = false;
        this.isResizingCrop = false;
        this._redrawCanvas(); // 重绘以显示裁剪框的控制点
        this._updateToolButtons(); // 更新工具按钮高亮状态
        this._updateCursorStyle(this.mouseX, this.mouseY); // 根据当前鼠标位置更新光标
        if (this.markColorPickerEl) this.markColorPickerEl.style.display = 'none';
        NotificationUIManager.showNotification('裁剪工具已激活。请拖拽选择或调整裁剪区域。', 'info');
    },

    /**
     * 激活矩形标记工具。
     * @function _activateDrawRectTool
     * @private
     */
    _activateDrawRectTool: function() {
        this.currentTool = 'drawRect';
        this._redrawCanvas(); // 重绘以移除裁剪框的控制点
        this._updateToolButtons();
        this.canvasEl.style.cursor = 'crosshair'; // 设置标记工具的光标
        if (this.markColorPickerEl) this.markColorPickerEl.style.display = 'inline-block';
        NotificationUIManager.showNotification(
            this.cropRect ? '矩形标记工具已激活。请在选定区域内标记。' : '矩形标记工具已激活。请标记。',
            'info'
        );
    },

    /**
     * 更新工具栏按钮的激活（高亮）状态。
     * @function _updateToolButtons
     * @private
     */
    _updateToolButtons: function() {
        // 根据当前工具，切换按钮的 'active' CSS 类
        if (this.cropToolBtn) this.cropToolBtn.classList.toggle('active', this.currentTool === 'crop');
        if (this.drawRectToolBtn) this.drawRectToolBtn.classList.toggle('active', this.currentTool === 'drawRect');
        // 根据当前工具决定是否显示颜色选择器
        if (this.markColorPickerEl) {
            this.markColorPickerEl.style.display = (this.currentTool === 'drawRect') ? 'inline-block' : 'none';
        }
    },

    /**
     * 将事件的客户端坐标 (clientX, clientY) 转换为相对于 Canvas 元素的内部坐标。
     * @function _getCanvasCoordinates
     * @private
     * @param {MouseEvent|TouchEvent|PointerEvent} e - 鼠标、触摸或指针事件对象。
     * @returns {{x: number, y: number}} Canvas内部的坐标对象 {x, y}。
     */
    _getCanvasCoordinates: function(e) {
        const rect = this.canvasEl.getBoundingClientRect();
        let clientX, clientY;

        // 兼容触摸事件和鼠标事件
        if (e.touches && e.touches.length > 0) {
            clientX = e.touches[0].clientX;
            clientY = e.touches[0].clientY;
        } else if (e.changedTouches && e.changedTouches.length > 0) {
            clientX = e.changedTouches[0].clientX;
            clientY = e.changedTouches[0].clientY;
        } else {
            clientX = e.clientX;
            clientY = e.clientY;
        }

        // 计算并应用CSS缩放比例，将视口坐标转换为Canvas内部坐标
        const scaleX = this.canvasEl.width / rect.width;
        const scaleY = this.canvasEl.height / rect.height;

        return {
            x: (clientX - rect.left) * scaleX,
            y: (clientY - rect.top) * scaleY
        };
    },

    /**
     * 处理 Canvas 上的鼠标按下 (mousedown) 事件。
     * @function _handleCanvasMouseDown
     * @private
     * @param {MouseEvent} e - 鼠标事件对象。
     */
    _handleCanvasMouseDown: function(e) {
        if (!this.isEditorActive) return;
        const { x, y } = this._getCanvasCoordinates(e);
        this.startX = x;
        this.startY = y;

        // 根据当前工具执行不同操作
        if (this.currentTool === 'crop') {
            this.activeCropHandle = this.cropRect ? this._getHandleAt(x, y) : null;

            if (this.activeCropHandle) {
                // 情况1: 点击在控制点上，开始调整大小
                this.isResizingCrop = true;
                this.isCropping = false; this.isMovingCrop = false;
                this.canvasEl.style.cursor = this._getResizeCursor(this.activeCropHandle);
            } else if (this.cropRect && Utils.isPointInRect(x, y, this.cropRect)) {
                // 情况2: 点击在裁剪框内部，开始移动
                this.isMovingCrop = true;
                this.isCropping = false; this.isResizingCrop = false;
                this.canvasEl.style.cursor = 'grabbing';
                this.cropMoveOffsetX = x - this.cropRect.x;
                this.cropMoveOffsetY = y - this.cropRect.y;
            } else {
                // 情况3: 点击在外部或无裁剪框，开始绘制新的裁剪框
                this.isCropping = true;
                this.isMovingCrop = false; this.isResizingCrop = false;
                this.cropRect = { x: this.startX, y: this.startY, w: 0, h: 0 };
                this.activeCropHandle = null; this.cropHandles = [];
                this.canvasEl.style.cursor = 'crosshair';
            }
        } else if (this.currentTool === 'drawRect') {
            // 开始绘制标记矩形
            this.isDrawingMark = true;
            this.currentMarkRect = { x: this.startX, y: this.startY, w: 0, h: 0 };
        }
    },

    /**
     * 处理 Canvas 上的鼠标移动 (mousemove) 事件。
     * @function _handleCanvasMouseMove
     * @private
     * @param {MouseEvent} e - 鼠标事件对象。
     */
    _handleCanvasMouseMove: function(e) {
        if (!this.isEditorActive) return;

        const isMouseButtonDown = e.buttons === 1;
        const isTouchEvent = e.type.startsWith('touch');

        // NOTE: 处理鼠标在画布外松开按钮再移回画布内的情况，重置拖拽状态
        if (!isMouseButtonDown && !isTouchEvent && (this.isCropping || this.isMovingCrop || this.isResizingCrop || this.isDrawingMark)) {
            this.isCropping = false; this.isMovingCrop = false; this.isResizingCrop = false;
            this.activeCropHandle = null; this.isDrawingMark = false;
            const { x: currentX, y: currentY } = this._getCanvasCoordinates(e);
            this._updateCursorStyle(currentX, currentY);
            this._redrawCanvas();
            return;
        }

        const { x, y } = this._getCanvasCoordinates(e);
        this.mouseX = x; this.mouseY = y;

        let needsRedraw = false;
        const isActiveDrag = isMouseButtonDown || isTouchEvent;

        // 根据当前激活的操作（调整、移动、绘制）更新矩形并标记重绘
        if (this.currentTool === 'crop') {
            if (this.isResizingCrop && this.activeCropHandle && isActiveDrag) {
                this._resizeCropRect(x, y);
                needsRedraw = true;
            } else if (this.isMovingCrop && this.cropRect && isActiveDrag) {
                this.cropRect.x = x - this.cropMoveOffsetX;
                this.cropRect.y = y - this.cropMoveOffsetY;
                // 限制移动范围在Canvas边界内
                this.cropRect.x = Math.max(0, Math.min(this.cropRect.x, this.canvasEl.width - this.cropRect.w));
                this.cropRect.y = Math.max(0, Math.min(this.cropRect.y, this.canvasEl.height - this.cropRect.h));
                this._updateCropHandles();
                needsRedraw = true;
            } else if (this.isCropping && isActiveDrag) {
                this.cropRect.w = x - this.startX;
                this.cropRect.h = y - this.startY;
                needsRedraw = true;
            } else if (!isActiveDrag) {
                this._updateCursorStyle(x, y);
            }
        } else if (this.currentTool === 'drawRect') {
            if (this.isDrawingMark && isActiveDrag) {
                this.currentMarkRect.w = x - this.startX;
                this.currentMarkRect.h = y - this.startY;
                needsRedraw = true;
            } else if (!isActiveDrag && !this.isDrawingMark) {
                this.canvasEl.style.cursor = 'crosshair';
            }
        }

        if (needsRedraw) {
            this._redrawCanvas();
        }
    },

    /**
     * 处理 Canvas 上的鼠标松开 (mouseup) 事件。
     * @function _handleCanvasMouseUp
     * @private
     * @param {MouseEvent} e - 鼠标事件对象。
     */
    _handleCanvasMouseUp: function(e) {
        if (!this.isEditorActive) return;
        const minCropSize = AppSettings.media.screenshotEditor.minCropSize;

        // 结束裁剪或调整操作
        if (this.currentTool === 'crop' && (this.isCropping || this.isMovingCrop || this.isResizingCrop)) {
            if (this.cropRect) {
                // 1. 标准化裁剪框（确保宽高为正）
                if (this.cropRect.w < 0) { this.cropRect.x += this.cropRect.w; this.cropRect.w *= -1; }
                if (this.cropRect.h < 0) { this.cropRect.y += this.cropRect.h; this.cropRect.h *= -1; }
                // 2. 检查并强制执行最小尺寸
                if (this.cropRect.w < minCropSize || this.cropRect.h < minCropSize) {
                    if (this.isCropping) { // 如果是新绘制的且过小，则取消
                        NotificationUIManager.showNotification('裁剪区域过小，请重新选择。', 'warn');
                        this.cropRect = null; this.cropHandles = [];
                    } else { // 如果是调整后过小，则强制设为最小尺寸
                        this.cropRect.w = Math.max(minCropSize, this.cropRect.w);
                        this.cropRect.h = Math.max(minCropSize, this.cropRect.h);
                        this.cropRect.x = Math.max(0, Math.min(this.cropRect.x, this.canvasEl.width - this.cropRect.w));
                        this.cropRect.y = Math.max(0, Math.min(this.cropRect.y, this.canvasEl.height - this.cropRect.h));
                    }
                }
            }
            if (this.cropRect) this._updateCropHandles();
            // 结束绘制标记操作
        } else if (this.currentTool === 'drawRect' && this.isDrawingMark && this.currentMarkRect) {
            // 1. 标准化标记矩形
            if (this.currentMarkRect.w < 0) { this.currentMarkRect.x += this.currentMarkRect.w; this.currentMarkRect.w *= -1; }
            if (this.currentMarkRect.h < 0) { this.currentMarkRect.y += this.currentMarkRect.h; this.currentMarkRect.h *= -1; }
            let markToAdd = { ...this.currentMarkRect, color: this.currentMarkColor, lineWidth: AppSettings.media.screenshotEditor.defaultMarkLineWidth, type: 'rect' };
            // 2. 如果存在裁剪区，将标记裁剪到该区域内
            if (this.cropRect) {
                const clippedMark = Utils.clipRectToArea(markToAdd, this.cropRect);
                markToAdd = clippedMark ? { ...clippedMark, color: markToAdd.color, lineWidth: markToAdd.lineWidth, type: 'rect' } : null;
            }
            // 3. 添加有效标记到 `marks` 数组
            if (markToAdd && markToAdd.w > 5 && markToAdd.h > 5) {
                this.marks.push(markToAdd);
            } else if (markToAdd) {
                Utils.log("标记矩形过小（可能因裁剪导致），未添加。", Utils.logLevels.DEBUG);
            } else if (this.cropRect) {
                Utils.log("标记在裁剪区域之外，未添加。", Utils.logLevels.DEBUG);
            }
            this.currentMarkRect = null;
        }

        // 重置所有拖拽/绘制状态
        this.isCropping = false; this.isMovingCrop = false; this.isResizingCrop = false;
        this.activeCropHandle = null; this.isDrawingMark = false;
        const { x, y } = this._getCanvasCoordinates(e);
        this._updateCursorStyle(x, y);
        this._redrawCanvas();
    },

    /**
     * 处理 Canvas 上的鼠标离开 (mouseleave) 事件。
     * @function _handleCanvasMouseLeave
     * @private
     * @param {MouseEvent} e - 鼠标事件对象。
     */
    _handleCanvasMouseLeave: function(e) {
        if (!this.isEditorActive) return;
        // NOTE: 如果在按下鼠标左键的状态下离开画布，视为操作结束
        if (e.buttons === 1 && !e.type.startsWith('touch')) {
            if (this.isCropping || this.isMovingCrop || this.isResizingCrop || this.isDrawingMark) {
                this._handleCanvasMouseUp(e);
            }
        }
        // 普通移出时，重置光标为默认样式
        if (!this.isDrawingMark && !this.isCropping && !this.isMovingCrop && !this.isResizingCrop) {
            const { x, y } = this._getCanvasCoordinates(e);
            if (x < 0 || x > this.canvasEl.width || y < 0 || y > this.canvasEl.height) {
                this.canvasEl.style.cursor = 'default';
            } else this._updateCursorStyle(x,y);
        }
    },

    /**
     * 处理 Canvas 上的触摸开始 (touchstart) 事件，代理到 mousedown 处理函数。
     * @function _handleCanvasTouchStart
     * @private
     * @param {TouchEvent} e - 触摸事件对象。
     */
    _handleCanvasTouchStart: function(e) {
        if (e.touches.length === 1) { // 仅处理单点触摸
            e.preventDefault();
            this._handleCanvasMouseDown(e.touches[0]);
        }
    },

    /**
     * 处理 Canvas 上的触摸移动 (touchmove) 事件，代理到 mousemove 处理函数。
     * @function _handleCanvasTouchMove
     * @private
     * @param {TouchEvent} e - 触摸事件对象。
     */
    _handleCanvasTouchMove: function(e) {
        if (e.touches.length === 1) {
            e.preventDefault();
            this._handleCanvasMouseMove(e.touches[0]);
        }
    },

    /**
     * 处理 Canvas 上的触摸结束 (touchend) 事件，代理到 mouseup 处理函数。
     * @function _handleCanvasTouchEnd
     * @private
     * @param {TouchEvent} e - 触摸事件对象。
     */
    _handleCanvasTouchEnd: function(e) {
        if (e.changedTouches.length === 1) {
            e.preventDefault();
            this._handleCanvasMouseUp(e.changedTouches[0]);
        }
    },

    /**
     * 根据当前 `cropRect` 更新裁剪框的8个控制点的位置。
     * @function _updateCropHandles
     * @private
     */
    _updateCropHandles: function() {
        if (!this.cropRect) { this.cropHandles = []; return; }
        const { x, y, w, h } = this.cropRect;
        // 计算并存储8个控制点的位置和ID
        this.cropHandles = [
            { id: 'tl', x: x, y: y }, { id: 'tm', x: x + w / 2, y: y }, { id: 'tr', x: x + w, y: y },
            { id: 'ml', x: x, y: y + h / 2 }, { id: 'mr', x: x + w, y: y + h / 2 },
            { id: 'bl', x: x, y: y + h }, { id: 'bm', x: x + w / 2, y: y + h }, { id: 'br', x: x + w, y: y + h }
        ];
    },

    /**
     * 在 Canvas 上绘制裁剪框的所有控制点。
     * @function _drawCropHandles
     * @private
     */
    _drawCropHandles: function() {
        if (!this.cropRect || !this.cropHandles || this.cropHandles.length === 0 || this.currentTool !== 'crop') return;
        if (this.isCropping && (this.cropRect.w === 0 || this.cropRect.h === 0)) return; // 新绘制且无尺寸时不画

        this.ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
        this.ctx.strokeStyle = 'rgba(0, 0, 0, 0.5)';
        this.ctx.lineWidth = 1;
        const handleSize = 8;

        this.cropHandles.forEach(handle => {
            this.ctx.fillRect(handle.x - handleSize / 2, handle.y - handleSize / 2, handleSize, handleSize);
            this.ctx.strokeRect(handle.x - handleSize / 2, handle.y - handleSize / 2, handleSize, handleSize);
        });
    },

    /**
     * 根据给定的鼠标坐标，判断其是否位于某个裁剪控制点的热区上。
     * @function _getHandleAt
     * @private
     * @param {number} mouseX - 鼠标X坐标。
     * @param {number} mouseY - 鼠标Y坐标。
     * @returns {string|null} 如果在热区上，返回控制点ID；否则返回null。
     */
    _getHandleAt: function(mouseX, mouseY) {
        if (this.currentTool !== 'crop' || !this.cropHandles || this.cropHandles.length === 0 || this.isCropping) return null;
        const handleSize = 12; // 判定热区比实际绘制的稍大，以改善用户体验
        for (const handle of this.cropHandles) {
            if (Math.abs(mouseX - handle.x) < handleSize / 2 && Math.abs(mouseY - handle.y) < handleSize / 2) {
                return handle.id;
            }
        }
        return null;
    },

    /**
     * 根据活动的裁剪控制点ID，返回对应的CSS光标样式。
     * @function _getResizeCursor
     * @private
     * @param {string} handleId - 控制点ID ('tl', 'tr', 'tm', etc.)。
     * @returns {string} CSS cursor 属性值。
     */
    _getResizeCursor: function(handleId) {
        switch (handleId) {
            case 'tl': case 'br': return 'nwse-resize';
            case 'tr': case 'bl': return 'nesw-resize';
            case 'tm': case 'bm': return 'ns-resize';
            case 'ml': case 'mr': return 'ew-resize';
            default: return 'default';
        }
    },

    /**
     * 根据鼠标当前位置和活动的控制点，调整裁剪矩形的大小和位置。
     * @function _resizeCropRect
     * @private
     * @param {number} mouseX - 当前鼠标在Canvas内的X坐标。
     * @param {number} mouseY - 当前鼠标在Canvas内的Y坐标。
     */
    _resizeCropRect: function(mouseX, mouseY) {
        if (!this.activeCropHandle || !this.cropRect) return;
        const { x: oX, y: oY, w: oW, h: oH } = this.cropRect; // 原始矩形
        let nX = oX, nY = oY, nW = oW, nH = oH; // 新矩形，初始为原始值
        const minCropSize = AppSettings.media.screenshotEditor.minCropSize;

        // 1. 根据不同的控制点，计算新的矩形位置和尺寸
        switch (this.activeCropHandle) {
            case 'tl': nW = oX + oW - mouseX; nH = oY + oH - mouseY; nX = mouseX; nY = mouseY; break;
            case 'tm': nH = oY + oH - mouseY; nY = mouseY; break;
            case 'tr': nW = mouseX - oX; nH = oY + oH - mouseY; nY = mouseY; break;
            case 'ml': nW = oX + oW - mouseX; nX = mouseX; break;
            case 'mr': nW = mouseX - oX; break;
            case 'bl': nW = oX + oW - mouseX; nH = mouseY - oY; nX = mouseX; break;
            case 'bm': nH = mouseY - oY; break;
            case 'br': nW = mouseX - oX; nH = mouseY - oY; break;
        }

        // 2. 标准化并应用约束（边界、最小尺寸）
        let tX = nX, tY = nY, tW = nW, tH = nH;
        // 确保宽高为正
        if (tW < 0) { tX += tW; tW = Math.abs(tW); }
        if (tH < 0) { tY += tH; tH = Math.abs(tH); }
        // 确保不小于最小尺寸
        tW = Math.max(minCropSize, tW); tH = Math.max(minCropSize, tH);
        // 确保不超出Canvas边界
        tX = Math.max(0, Math.min(tX, this.canvasEl.width - tW));
        tY = Math.max(0, Math.min(tY, this.canvasEl.height - tH));
        // 再次修正宽高，因为位置的限制可能影响它们
        tW = Math.min(tW, this.canvasEl.width - tX);
        tH = Math.min(tH, this.canvasEl.height - tY);
        tW = Math.max(minCropSize, tW); tH = Math.max(minCropSize, tH);
        // 最后检查，如果最小尺寸导致超出边界，则反向调整位置
        if (tX + tW > this.canvasEl.width) tX = this.canvasEl.width - tW;
        if (tY + tH > this.canvasEl.height) tY = this.canvasEl.height - tH;

        // 3. 更新裁剪框和控制点
        this.cropRect = { x: tX, y: tY, w: tW, h: tH };
        this._updateCropHandles();
    },

    /**
     * 根据当前鼠标位置和编辑器状态更新 Canvas 的光标样式。
     * @function _updateCursorStyle
     * @private
     * @param {number} mouseX - 当前鼠标在Canvas内的X坐标。
     * @param {number} mouseY - 当前鼠标在Canvas内的Y坐标。
     */
    _updateCursorStyle: function(mouseX, mouseY) {
        // 如果正在进行拖拽操作，则不改变光标
        if (this.isCropping || this.isMovingCrop || this.isResizingCrop || this.isDrawingMark) return;

        if (this.currentTool === 'crop') {
            if (this.cropRect) {
                const handle = this._getHandleAt(mouseX, mouseY);
                if (handle) { // 在控制点上
                    this.canvasEl.style.cursor = this._getResizeCursor(handle);
                } else if (Utils.isPointInRect(mouseX, mouseY, this.cropRect)) { // 在裁剪框内
                    this.canvasEl.style.cursor = 'grab';
                } else { // 在裁剪框外
                    this.canvasEl.style.cursor = 'crosshair';
                }
            } else { // 无裁剪框
                this.canvasEl.style.cursor = 'crosshair';
            }
        } else if (this.currentTool === 'drawRect') {
            this.canvasEl.style.cursor = 'crosshair';
        } else {
            this.canvasEl.style.cursor = 'default';
        }
    },
};