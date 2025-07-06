/**
 * @file ScreenshotEditorUIManager.js
 * @description
 * 该文件负责管理截图编辑器的用户界面 (UI) 和交互逻辑。
 * 它提供了图像裁剪和矩形标记（支持颜色选择）的核心功能。
 * @module ScreenshotEditorUIManager
 * @exports {object} ScreenshotEditorUIManager
 * @dependencies Utils, NotificationUIManager, EventEmitter, AppSettings
 */
const ScreenshotEditorUIManager = {
    // ... (DOM 元素引用和大部分状态属性不变) ...
    editorModalEl: null,
    canvasEl: null,
    ctx: null,
    toolbarEl: null,
    cropToolBtn: null,
    drawRectToolBtn: null,
    markColorPickerEl: null,
    confirmBtn: null,
    cancelBtn: null,
    rawImage: null,
    originalStream: null,
    isEditorActive: false,
    currentTool: null,
    isCropping: false,
    isMovingCrop: false,
    isResizingCrop: false,
    cropRect: null,
    cropHandles: [],
    activeCropHandle: null,
    // 移除 minCropSize
    cropMoveOffsetX: 0,
    cropMoveOffsetY: 0,
    isDrawingMark: false,
    currentMarkRect: null,
    marks: [],
    startX: 0,
    startY: 0,
    mouseX: 0,
    mouseY: 0,
    // 移除 DEFAULT_MARK_COLOR 和 DEFAULT_MARK_LINE_WIDTH
    currentMarkColor: '#FF0000',

    /**
     * 初始化截图编辑器UI管理器。
     * @public
     */
    init: function() {
        this.editorModalEl = document.getElementById('screenshotEditorModal');
        this.canvasEl = document.getElementById('screenshotEditorCanvas');
        this.toolbarEl = document.getElementById('screenshotEditorToolbar');
        this.cropToolBtn = document.getElementById('cropToolBtn');
        this.drawRectToolBtn = document.getElementById('drawRectToolBtn');
        this.markColorPickerEl = document.getElementById('markColorPicker');
        this.confirmBtn = document.getElementById('confirmScreenshotEditBtn');
        this.cancelBtn = document.getElementById('cancelScreenshotEditBtn');

        if (!this.editorModalEl || !this.canvasEl || !this.toolbarEl || !this.confirmBtn || !this.cancelBtn || !this.markColorPickerEl) {
            Utils.log('ScreenshotEditorUIManager: 初始化失败，部分编辑器DOM元素未找到。', Utils.logLevels.ERROR);
            return;
        }
        if (this.canvasEl) {
            this.ctx = this.canvasEl.getContext('2d');
        } else {
            Utils.log('ScreenshotEditorUIManager: Canvas元素未找到，无法获取2D上下文。', Utils.logLevels.ERROR);
            return;
        }
        // 使用 AppSettings 中的常量
        this.currentMarkColor = this.markColorPickerEl.value || AppSettings.ui.screenshotEditor.defaultMarkColor;
        this._bindEvents();
        Utils.log('ScreenshotEditorUIManager initialized.', Utils.logLevels.INFO);
    },

    // ... (_bindEvents, _handleRawScreenshot, _showEditor 不变) ...
    _bindEvents: function() {
        if (typeof EventEmitter !== 'undefined') {
            EventEmitter.on('rawScreenshotCaptured', this._handleRawScreenshot.bind(this));
        } else {
            Utils.log('ScreenshotEditorUIManager: EventEmitter 未定义，无法监听 rawScreenshotCaptured 事件。', Utils.logLevels.WARN);
        }

        if (this.confirmBtn) this.confirmBtn.addEventListener('click', this._confirmEdit.bind(this));
        if (this.cancelBtn) this.cancelBtn.addEventListener('click', this._cancelEdit.bind(this));
        if (this.cropToolBtn) this.cropToolBtn.addEventListener('click', this._activateCropTool.bind(this));
        if (this.drawRectToolBtn) this.drawRectToolBtn.addEventListener('click', this._activateDrawRectTool.bind(this));

        if (this.markColorPickerEl) {
            this.markColorPickerEl.addEventListener('input', (event) => {
                this.currentMarkColor = event.target.value;
                Utils.log(`标记颜色已更改为: ${this.currentMarkColor}`, Utils.logLevels.DEBUG);
            });
        }

        this.canvasEl.addEventListener('mousedown', this._handleCanvasMouseDown.bind(this));
        this.canvasEl.addEventListener('mousemove', this._handleCanvasMouseMove.bind(this));
        this.canvasEl.addEventListener('mouseup', this._handleCanvasMouseUp.bind(this));
        this.canvasEl.addEventListener('mouseleave', this._handleCanvasMouseLeave.bind(this));

        this.canvasEl.addEventListener('touchstart', this._handleCanvasTouchStart.bind(this), { passive: false });
        this.canvasEl.addEventListener('touchmove', this._handleCanvasTouchMove.bind(this), { passive: false });
        this.canvasEl.addEventListener('touchend', this._handleCanvasTouchEnd.bind(this));
    },

    _handleRawScreenshot: function(detail) {
        Utils.log('原始截图已由 ScreenshotEditorUIManager 接收。', Utils.logLevels.DEBUG);
        // [修复] 放宽检查，允许 originalStream 为 null（原生安卓截图场景）
        // 只检查核心数据 dataUrl 和 blob 是否存在。
        if (!detail || !detail.dataUrl || !detail.blob) { // <--- 修改后的行
            NotificationUIManager.showNotification('接收截图数据不完整。', 'error');
            // 即使数据不完整，如果流存在，也应尝试关闭它
            if (detail && detail.originalStream) {
                detail.originalStream.getTracks().forEach(track => track.stop());
            }
            this.isEditorActive = false;
            return;
        }

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

        if (this.markColorPickerEl) {
            this.markColorPickerEl.value = AppSettings.ui.screenshotEditor.defaultMarkColor;
            this.currentMarkColor = AppSettings.ui.screenshotEditor.defaultMarkColor;
        }

        const img = new Image();
        img.onload = () => {
            this.rawImage = img;
            this._showEditor();
        };
        img.onerror = () => {
            NotificationUIManager.showNotification('加载截图到编辑器失败。', 'error');
            Utils.log('ScreenshotEditorUIManager: 图片加载失败 (img.onerror)。', Utils.logLevels.ERROR);
            this._closeEditorAndStopStream();
        };
        img.src = detail.dataUrl;
    },

    _showEditor: function() {
        if (!this.editorModalEl || !this.canvasEl || !this.ctx || !this.rawImage) {
            Utils.log('ScreenshotEditorUIManager._showEditor: 关键元素或数据缺失，无法显示编辑器。', Utils.logLevels.ERROR);
            this._closeEditorAndStopStream();
            return;
        }
        this.canvasEl.width = this.rawImage.width;
        this.canvasEl.height = this.rawImage.height;
        this._redrawCanvas();
        this.editorModalEl.style.display = 'flex';
        this._updateToolButtons();
        Utils.log('截图编辑器已显示并加载图像。', Utils.logLevels.INFO);
        this._activateCropTool();
    },

    /**
     * 重新绘制整个 Canvas 画布。
     * @private
     */
    _redrawCanvas: function() {
        if (!this.ctx || !this.rawImage) return;
        this.ctx.clearRect(0, 0, this.canvasEl.width, this.canvasEl.height);
        this.ctx.drawImage(this.rawImage, 0, 0);

        if (this.cropRect) {
            this.ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
            this.ctx.fillRect(0, 0, this.canvasEl.width, this.cropRect.y);
            this.ctx.fillRect(0, this.cropRect.y + this.cropRect.h, this.canvasEl.width, this.canvasEl.height - (this.cropRect.y + this.cropRect.h));
            this.ctx.fillRect(0, this.cropRect.y, this.cropRect.x, this.cropRect.h);
            this.ctx.fillRect(this.cropRect.x + this.cropRect.w, this.cropRect.y, this.canvasEl.width - (this.cropRect.x + this.cropRect.w), this.cropRect.h);
            if (this.currentTool === 'crop') {
                this.ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
                this.ctx.lineWidth = 2;
                this.ctx.strokeRect(this.cropRect.x, this.cropRect.y, this.cropRect.w, this.cropRect.h);
                if (!this.isCropping || (this.cropRect.w !== 0 || this.cropRect.h !== 0)) {
                    this._drawCropHandles();
                }
            }
        }

        this.marks.forEach(mark => {
            if (mark.type === 'rect') {
                // 使用 AppSettings 中的常量
                this.ctx.strokeStyle = mark.color || AppSettings.ui.screenshotEditor.defaultMarkColor;
                this.ctx.lineWidth = mark.lineWidth || AppSettings.ui.screenshotEditor.defaultMarkLineWidth;
                this.ctx.strokeRect(mark.x, mark.y, mark.w, mark.h);
            }
        });

        if (this.isDrawingMark && this.currentMarkRect && this.currentTool === 'drawRect') {
            let rectToDrawPreview = { ...this.currentMarkRect };
            let normalizedPreview = { ...rectToDrawPreview };
            if (normalizedPreview.w < 0) { normalizedPreview.x += normalizedPreview.w; normalizedPreview.w *= -1; }
            if (normalizedPreview.h < 0) { normalizedPreview.y += normalizedPreview.h; normalizedPreview.h *= -1; }
            if (this.cropRect) {
                const clippedLivePreview = Utils.clipRectToArea(normalizedPreview, this.cropRect);
                rectToDrawPreview = clippedLivePreview ? clippedLivePreview : null;
            } else {
                rectToDrawPreview = normalizedPreview;
            }
            if (rectToDrawPreview && rectToDrawPreview.w > 0 && rectToDrawPreview.h > 0) {
                this.ctx.strokeStyle = this.currentMarkColor;
                // 使用 AppSettings 中的常量
                this.ctx.lineWidth = AppSettings.ui.screenshotEditor.defaultMarkLineWidth;
                this.ctx.strokeRect(rectToDrawPreview.x, rectToDrawPreview.y, rectToDrawPreview.w, rectToDrawPreview.h);
            }
        }
    },

    // ... (_activateCropTool, _activateDrawRectTool, _updateToolButtons 不变) ...
    _activateCropTool: function() {
        this.currentTool = 'crop';
        this.isCropping = false;
        this.isMovingCrop = false;
        this.isResizingCrop = false;
        this._redrawCanvas();
        this._updateToolButtons();
        this._updateCursorStyle(this.mouseX, this.mouseY);
        if (this.markColorPickerEl) this.markColorPickerEl.style.display = 'none';
        NotificationUIManager.showNotification('裁剪工具已激活。请拖拽选择或调整裁剪区域。', 'info');
    },

    _activateDrawRectTool: function() {
        this.currentTool = 'drawRect';
        this._redrawCanvas();
        this._updateToolButtons();
        this.canvasEl.style.cursor = 'crosshair';
        if (this.markColorPickerEl) this.markColorPickerEl.style.display = 'inline-block';
        if (this.cropRect) {
            NotificationUIManager.showNotification('矩形标记工具已激活。请在选定区域内标记。', 'info');
        } else {
            NotificationUIManager.showNotification('矩形标记工具已激活。请标记。', 'info');
        }
    },

    _updateToolButtons: function() {
        if (this.cropToolBtn) this.cropToolBtn.classList.toggle('active', this.currentTool === 'crop');
        if (this.drawRectToolBtn) this.drawRectToolBtn.classList.toggle('active', this.currentTool === 'drawRect');
        if (this.markColorPickerEl) {
            this.markColorPickerEl.style.display = (this.currentTool === 'drawRect') ? 'inline-block' : 'none';
        }
    },

    /**
     * 用户确认编辑操作。
     * @private
     */
    _confirmEdit: async function() {
        if (!this.isEditorActive || !this.canvasEl || !this.ctx || !this.rawImage) {
            Utils.log('确认编辑被调用，但编辑器未激活或画布未准备好。', Utils.logLevels.WARN);
            this._closeEditorAndStopStream();
            return;
        }
        Utils.log('ScreenshotEditorUIManager._confirmEdit called.', Utils.logLevels.INFO);
        NotificationUIManager.showNotification('正在处理截图...', 'info');

        const finalCanvas = document.createElement('canvas');
        const finalCtx = finalCanvas.getContext('2d');

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
        finalCtx.drawImage(this.rawImage, sourceX, sourceY, outputWidth, outputHeight, 0, 0, outputWidth, outputHeight);

        this.marks.forEach(mark => {
            if (mark.type === 'rect') {
                const markXInFinal = mark.x - sourceX;
                const markYInFinal = mark.y - sourceY;
                if (markXInFinal + mark.w > 0 && markXInFinal < outputWidth &&
                    markYInFinal + mark.h > 0 && markYInFinal < outputHeight) {
                    // 使用 AppSettings 中的常量
                    finalCtx.strokeStyle = mark.color || AppSettings.ui.screenshotEditor.defaultMarkColor;
                    finalCtx.lineWidth = mark.lineWidth || AppSettings.ui.screenshotEditor.defaultMarkLineWidth;
                    finalCtx.strokeRect(markXInFinal, markYInFinal, mark.w, mark.h);
                }
            }
        });

        finalCanvas.toBlob(async (blob) => {
            if (!blob) {
                NotificationUIManager.showNotification('处理截图失败：无法生成图片 Blob。', 'error');
                this._closeEditorAndStopStream();
                return;
            }
            try {
                const fileHash = await Utils.generateFileHash(blob);
                const previewUrl = URL.createObjectURL(blob);
                const fileName = `screenshot_edited_${Date.now()}.png`;
                const editedFile = {
                    blob: blob,
                    hash: fileHash,
                    name: fileName,
                    type: 'image/png',
                    size: blob.size,
                    previewUrl: previewUrl
                };
                EventEmitter.emit('screenshotEditingComplete', editedFile);
                this._closeEditorAndStopStream();
            } catch (hashError) {
                Utils.log(`计算编辑后截图哈希失败: ${hashError}`, Utils.logLevels.ERROR);
                NotificationUIManager.showNotification('处理截图失败：哈希计算错误。', 'error');
                this._closeEditorAndStopStream();
            }
        }, 'image/png');
    },

    // ... (其他方法保持不变) ...
    _cancelEdit: function() {
        Utils.log('ScreenshotEditorUIManager._cancelEdit called.', Utils.logLevels.INFO);
        EventEmitter.emit('screenshotEditingCancelled');
        this._closeEditorAndStopStream();
    },

    _closeEditorAndStopStream: function() {
        if (this.editorModalEl) this.editorModalEl.style.display = 'none';
        if (this.ctx && this.canvasEl && this.rawImage) {
            this.ctx.clearRect(0, 0, this.canvasEl.width, this.canvasEl.height);
        }
        if (this.originalStream) {
            this.originalStream.getTracks().forEach(track => track.stop());
            Utils.log('截图的原始媒体流已停止。', Utils.logLevels.INFO);
        }
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

    _getCanvasCoordinates: function(e) {
        const rect = this.canvasEl.getBoundingClientRect();
        let clientX, clientY;
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
        const scaleX = this.canvasEl.width / rect.width;
        const scaleY = this.canvasEl.height / rect.height;
        return {
            x: (clientX - rect.left) * scaleX,
            y: (clientY - rect.top) * scaleY
        };
    },

    _handleCanvasMouseDown: function(e) {
        if (!this.isEditorActive) return;
        const { x, y } = this._getCanvasCoordinates(e);
        this.startX = x;
        this.startY = y;
        if (this.currentTool === 'crop') {
            this.activeCropHandle = this.cropRect ? this._getHandleAt(x, y) : null;
            if (this.activeCropHandle) {
                this.isResizingCrop = true;
                this.isCropping = false; this.isMovingCrop = false;
                this.canvasEl.style.cursor = this._getResizeCursor(this.activeCropHandle);
            } else if (this.cropRect && Utils.isPointInRect(x, y, this.cropRect)) {
                this.isMovingCrop = true;
                this.isCropping = false; this.isResizingCrop = false;
                this.canvasEl.style.cursor = 'grabbing';
                this.cropMoveOffsetX = x - this.cropRect.x;
                this.cropMoveOffsetY = y - this.cropRect.y;
            } else {
                this.isCropping = true;
                this.isMovingCrop = false; this.isResizingCrop = false;
                this.cropRect = { x: this.startX, y: this.startY, w: 0, h: 0 };
                this.activeCropHandle = null; this.cropHandles = [];
                this.canvasEl.style.cursor = 'crosshair';
            }
        } else if (this.currentTool === 'drawRect') {
            this.isDrawingMark = true;
            this.currentMarkRect = { x: this.startX, y: this.startY, w: 0, h: 0 };
        }
    },

    _handleCanvasMouseMove: function(e) {
        if (!this.isEditorActive) return;
        const isMouseButtonDown = e.buttons === 1;
        const isTouchEvent = e.type.startsWith('touch');
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
        if (this.currentTool === 'crop') {
            if (this.isResizingCrop && this.activeCropHandle && isActiveDrag) {
                this._resizeCropRect(x, y);
                needsRedraw = true;
            } else if (this.isMovingCrop && this.cropRect && isActiveDrag) {
                this.cropRect.x = x - this.cropMoveOffsetX;
                this.cropRect.y = y - this.cropMoveOffsetY;
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

    _updateCursorStyle: function(mouseX, mouseY) {
        if (this.isCropping || this.isMovingCrop || this.isResizingCrop || this.isDrawingMark) return;

        if (this.currentTool === 'crop') {
            if (this.cropRect) {
                const handle = this._getHandleAt(mouseX, mouseY);
                if (handle) this.canvasEl.style.cursor = this._getResizeCursor(handle);
                else if (Utils.isPointInRect(mouseX, mouseY, this.cropRect)) this.canvasEl.style.cursor = 'grab';
                else this.canvasEl.style.cursor = 'crosshair';
            } else this.canvasEl.style.cursor = 'crosshair';
        } else if (this.currentTool === 'drawRect') this.canvasEl.style.cursor = 'crosshair';
        else this.canvasEl.style.cursor = 'default';
    },

    /**
     * 处理 Canvas 上的鼠标松开 (mouseup) 事件。
     * @private
     * @param {MouseEvent} e - 鼠标事件对象。
     */
    _handleCanvasMouseUp: function(e) {
        if (!this.isEditorActive) return;

        if (this.currentTool === 'crop' && (this.isCropping || this.isMovingCrop || this.isResizingCrop)) {
            if (this.cropRect) {
                if (this.cropRect.w < 0) { this.cropRect.x += this.cropRect.w; this.cropRect.w *= -1; }
                if (this.cropRect.h < 0) { this.cropRect.y += this.cropRect.h; this.cropRect.h *= -1; }
                // 使用 AppSettings 中的常量
                if (this.cropRect.w < AppSettings.ui.screenshotEditor.minCropSize || this.cropRect.h < AppSettings.ui.screenshotEditor.minCropSize) {
                    if (this.isCropping) {
                        if (this.rawImage && (this.cropRect.w < this.rawImage.width || this.cropRect.h < this.rawImage.height)) NotificationUIManager.showNotification('裁剪区域过小，请重新选择。', 'warn');
                        this.cropRect = null; this.cropHandles = [];
                    } else {
                        this.cropRect.w = Math.max(AppSettings.ui.screenshotEditor.minCropSize, this.cropRect.w);
                        this.cropRect.h = Math.max(AppSettings.ui.screenshotEditor.minCropSize, this.cropRect.h);
                        this.cropRect.x = Math.max(0, Math.min(this.cropRect.x, this.canvasEl.width - this.cropRect.w));
                        this.cropRect.y = Math.max(0, Math.min(this.cropRect.y, this.canvasEl.height - this.cropRect.h));
                    }
                }
            }
            if (this.cropRect) this._updateCropHandles();
        } else if (this.currentTool === 'drawRect' && this.isDrawingMark && this.currentMarkRect) {
            if (this.currentMarkRect.w < 0) { this.currentMarkRect.x += this.currentMarkRect.w; this.currentMarkRect.w *= -1; }
            if (this.currentMarkRect.h < 0) { this.currentMarkRect.y += this.currentMarkRect.h; this.currentMarkRect.h *= -1; }
            // 使用 AppSettings 中的常量
            let markToAdd = { ...this.currentMarkRect, color: this.currentMarkColor, lineWidth: AppSettings.ui.screenshotEditor.defaultMarkLineWidth, type: 'rect' };
            if (this.cropRect) {
                const clippedMark = Utils.clipRectToArea(markToAdd, this.cropRect);
                markToAdd = clippedMark ? { ...clippedMark, color: markToAdd.color, lineWidth: markToAdd.lineWidth, type: 'rect' } : null;
            }
            if (markToAdd && markToAdd.w > 5 && markToAdd.h > 5) this.marks.push(markToAdd);
            else if (markToAdd) Utils.log("标记矩形过小（可能因裁剪导致），未添加。", Utils.logLevels.DEBUG);
            else if (this.cropRect) Utils.log("标记在裁剪区域之外，未添加。", Utils.logLevels.DEBUG);
            this.currentMarkRect = null;
        }

        this.isCropping = false; this.isMovingCrop = false; this.isResizingCrop = false;
        this.activeCropHandle = null; this.isDrawingMark = false;
        const { x, y } = this._getCanvasCoordinates(e);
        this._updateCursorStyle(x, y);
        this._redrawCanvas();
    },

    // ... (其他方法保持不变) ...
    _handleCanvasMouseLeave: function(e) {
        if (!this.isEditorActive) return;
        if (e.buttons === 1 && !e.type.startsWith('touch')) {
            if (this.isCropping || this.isMovingCrop || this.isResizingCrop || this.isDrawingMark) {
                this._handleCanvasMouseUp(e);
            }
        }
        if (!this.isDrawingMark && !this.isCropping && !this.isMovingCrop && !this.isResizingCrop) {
            const { x, y } = this._getCanvasCoordinates(e);
            if (x < 0 || x > this.canvasEl.width || y < 0 || y > this.canvasEl.height) {
                this.canvasEl.style.cursor = 'default';
            } else this._updateCursorStyle(x,y);
        }
    },

    _handleCanvasTouchStart: function(e) {
        if (e.touches.length === 1) {
            e.preventDefault();
            this._handleCanvasMouseDown(e.touches[0]);
        }
    },
    _handleCanvasTouchMove: function(e) {
        if (e.touches.length === 1) {
            e.preventDefault();
            this._handleCanvasMouseMove(e.touches[0]);
        }
    },
    _handleCanvasTouchEnd: function(e) {
        if (e.changedTouches.length === 1) {
            e.preventDefault();
            this._handleCanvasMouseUp(e.changedTouches[0]);
        }
    },

    _updateCropHandles: function() {
        if (!this.cropRect) { this.cropHandles = []; return; }
        const { x, y, w, h } = this.cropRect;
        this.cropHandles = [
            { id: 'tl', x: x, y: y }, { id: 'tm', x: x + w / 2, y: y }, { id: 'tr', x: x + w, y: y },
            { id: 'ml', x: x, y: y + h / 2 }, { id: 'mr', x: x + w, y: y + h / 2 },
            { id: 'bl', x: x, y: y + h }, { id: 'bm', x: x + w / 2, y: y + h }, { id: 'br', x: x + w, y: y + h }
        ];
    },
    _drawCropHandles: function() {
        if (!this.cropRect || !this.cropHandles || this.cropHandles.length === 0 || this.currentTool !== 'crop') return;
        if (this.isCropping && (this.cropRect.w === 0 || this.cropRect.h === 0)) return;

        this.ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
        this.ctx.strokeStyle = 'rgba(0, 0, 0, 0.5)';
        this.ctx.lineWidth = 1;
        const handleSize = 8;

        this.cropHandles.forEach(handle => {
            this.ctx.fillRect(handle.x - handleSize / 2, handle.y - handleSize / 2, handleSize, handleSize);
            this.ctx.strokeRect(handle.x - handleSize / 2, handle.y - handleSize / 2, handleSize, handleSize);
        });
    },
    _getHandleAt: function(mouseX, mouseY) {
        if (this.currentTool !== 'crop' || !this.cropHandles || this.cropHandles.length === 0 || this.isCropping) return null;
        const handleSize = 12;
        for (const handle of this.cropHandles) {
            if (Math.abs(mouseX - handle.x) < handleSize / 2 && Math.abs(mouseY - handle.y) < handleSize / 2) {
                return handle.id;
            }
        }
        return null;
    },

    _getResizeCursor: function(handleId) {
        switch (handleId) {
            case 'tl': case 'br': return 'nwse-resize';
            case 'tr': case 'bl': return 'nesw-resize';
            case 'tm': case 'bm': return 'ns-resize';
            case 'ml': case 'mr': return 'ew-resize';
            default: return 'default';
        }
    },
    _resizeCropRect: function(mouseX, mouseY) {
        if (!this.activeCropHandle || !this.cropRect) return;
        const { x: oX, y: oY, w: oW, h: oH } = this.cropRect;
        let nX = oX, nY = oY, nW = oW, nH = oH;

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

        let tX = nX, tY = nY, tW = nW, tH = nH;
        if (tW < 0) { tX += tW; tW = Math.abs(tW); }
        if (tH < 0) { tY += tH; tH = Math.abs(tH); }
        // 使用 AppSettings 中的常量
        tW = Math.max(AppSettings.ui.screenshotEditor.minCropSize, tW); tH = Math.max(AppSettings.ui.screenshotEditor.minCropSize, tH);
        tX = Math.max(0, Math.min(tX, this.canvasEl.width - tW));
        tY = Math.max(0, Math.min(tY, this.canvasEl.height - tH));
        tW = Math.min(tW, this.canvasEl.width - tX);
        tH = Math.min(tH, this.canvasEl.height - tY);
        tW = Math.max(AppSettings.ui.screenshotEditor.minCropSize, tW); tH = Math.max(AppSettings.ui.screenshotEditor.minCropSize, tH);
        if (tX + tW > this.canvasEl.width) tX = this.canvasEl.width - tW;
        if (tY + tH > this.canvasEl.height) tY = this.canvasEl.height - tH;

        this.cropRect = { x: tX, y: tY, w: tW, h: tH };
        this._updateCropHandles();
    }
};