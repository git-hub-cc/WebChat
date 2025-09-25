// js/modules/CanvasManager.js
import appState from '../AppState.js';

class CanvasManager {
    constructor(canvas, historyManager) {
        this.fabricCanvas = canvas;
        this.historyManager = historyManager;
        this.container = this.fabricCanvas.wrapperEl.parentNode;

        // ... (其他状态变量) ...
        this.isPanning = false;
        this.lastPosX = 0;
        this.lastPosY = 0;
        this.isDrawing = false;
        this.drawingObject = null;
        this.origin = { x: 0, y: 0 };

        this.scaleEl = document.getElementById('scale');
        this.coordsEl = document.getElementById('coords');

        this._initResize();
        this._initPanning();
        this._initZooming();
        this._initEventListeners();
        this._initObjectModificationEvents();
        this._initHotkeys();

        appState.on('tool:changed', (tool) => this.onToolChanged(tool));
        appState.on('delete:selection', () => this.deleteSelection());
        appState.on('property:changed', (properties) => this.onPropertyChange(properties));
    }

    _initResize() {
        const resizeObserver = new ResizeObserver(() => {
            this.fabricCanvas.setWidth(this.container.clientWidth);
            this.fabricCanvas.setHeight(this.container.clientHeight);
            this.fabricCanvas.renderAll();
        });
        resizeObserver.observe(this.container);
        this.fabricCanvas.setWidth(this.container.clientWidth);
        this.fabricCanvas.setHeight(this.container.clientHeight);
    }

    _initPanning() {
        this.fabricCanvas.on('mouse:down', (opt) => {
            if (opt.e.altKey || opt.e.button === 1) {
                this.isPanning = true;
                this.fabricCanvas.defaultCursor = 'grab';
                this.lastPosX = opt.e.clientX;
                this.lastPosY = opt.e.clientY;
                this.fabricCanvas.selection = false;
            }
        });

        this.fabricCanvas.on('mouse:move', (opt) => {
            if (this.isPanning) {
                const e = opt.e;
                const vpt = this.fabricCanvas.viewportTransform;
                vpt[4] += e.clientX - this.lastPosX;
                vpt[5] += e.clientY - this.lastPosY;
                this.fabricCanvas.requestRenderAll();
                this.lastPosX = e.clientX;
                this.lastPosY = e.clientY;
            }
        });

        this.fabricCanvas.on('mouse:up', () => {
            if (this.isPanning) {
                this.isPanning = false;
                this.fabricCanvas.defaultCursor = 'default';
                if (appState.activeTool === 'select') {
                    this.fabricCanvas.selection = true;
                }
                this.fabricCanvas.requestRenderAll();
            }
        });
    }

    _initZooming() {
        this.fabricCanvas.on('mouse:wheel', (opt) => {
            const delta = opt.e.deltaY;
            let zoom = this.fabricCanvas.getZoom();
            zoom *= 0.999 ** delta;
            if (zoom > 20) zoom = 20;
            if (zoom < 0.1) zoom = 0.1;
            this.fabricCanvas.zoomToPoint({ x: opt.e.offsetX, y: opt.e.offsetY }, zoom);
            opt.e.preventDefault();
            opt.e.stopPropagation();
            this.scaleEl.textContent = `缩放: ${Math.round(zoom * 100)}%`;
        });
    }

    async _initEventListeners() {
        this.fabricCanvas.on('path:created', async (e) => {
            const canProceed = await this.historyManager.branchingCheck();
            if (canProceed) {
                e.path.set({
                    id: `layer_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                });
                appState.emit('canvas:modified');
            } else {
                this.fabricCanvas.remove(e.path);
            }
        });

        this.fabricCanvas.on('mouse:down', async (o) => {
            if (this.isPanning || (o.e.button !== undefined && o.e.button !== 0)) {
                return;
            }

            const tool = appState.activeTool;
            if (tool === 'select' || tool === 'brush' || tool === 'marker') return;

            const canProceed = await this.historyManager.branchingCheck();
            if (!canProceed) {
                this.isDrawing = false;
                return;
            }

            this.isDrawing = true;
            const pointer = this.fabricCanvas.getPointer(o.e);
            this.origin.x = pointer.x;
            this.origin.y = pointer.y;
            const commonOptions = {
                left: pointer.x, top: pointer.y, stroke: '#ffffff', strokeWidth: 2, fill: 'transparent',
                selectable: false, hasControls: false,
                id: `layer_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            };
            switch (tool) {
                case 'rect': this.drawingObject = new fabric.Rect({ ...commonOptions, width: 0, height: 0 }); break;
                case 'circle': this.drawingObject = new fabric.Circle({ ...commonOptions, radius: 0 }); break;
                case 'line': this.drawingObject = new fabric.Line([pointer.x, pointer.y, pointer.x, pointer.y], commonOptions); break;
            }
            if (this.drawingObject) this.fabricCanvas.add(this.drawingObject);
        });

        this.fabricCanvas.on('mouse:move', (o) => {
            const pointer = this.fabricCanvas.getPointer(o.e);
            this.coordsEl.textContent = `位置: (${Math.round(pointer.x)}, ${Math.round(pointer.y)})`;
            if (!this.isDrawing || !this.drawingObject) return;

            switch (appState.activeTool) {
                case 'rect':
                    this.drawingObject.set({
                        width: Math.abs(pointer.x - this.origin.x),
                        height: Math.abs(pointer.y - this.origin.y),
                        left: Math.min(pointer.x, this.origin.x),
                        top: Math.min(pointer.y, this.origin.y)
                    });
                    break;
                case 'circle':
                    const radius = Math.sqrt(Math.pow(this.origin.x - pointer.x, 2) + Math.pow(this.origin.y - pointer.y, 2))/2;
                    this.drawingObject.set({
                        radius: radius,
                        left: this.origin.x + (pointer.x - this.origin.x) / 2,
                        top: this.origin.y + (pointer.y - this.origin.y) / 2,
                        originX: 'center',
                        originY: 'center'
                    });
                    break;
                case 'line':
                    this.drawingObject.set({ x2: pointer.x, y2: pointer.y });
                    break;
            }
            this.fabricCanvas.renderAll();
        });

        this.fabricCanvas.on('mouse:up', () => {
            if (this.isDrawing) {
                this.isDrawing = false;
                if (this.drawingObject) {
                    // ================== 关键修复点 ==================
                    // 对于圆形，在绘制结束后，我们需要将它的原点从'center'切换回'left'/'top'
                    // 以便与其他对象行为保持一致。
                    // 在切换的同时，必须重新计算 left/top 坐标以防止对象位置跳动。
                    if (this.drawingObject.type === 'circle') {
                        const radius = this.drawingObject.getRadiusX(); // 获取最终半径
                        this.drawingObject.set({
                            // 新的 left = 当前中心点x - 半径
                            left: this.drawingObject.left - radius,
                            // 新的 top = 当前中心点y - 半径
                            top: this.drawingObject.top - radius,
                            // 将原点设置回默认值
                            originX: 'left',
                            originY: 'top'
                        });
                    }
                    // ===============================================

                    this.drawingObject.set({ selectable: true, hasControls: true });
                    this.fabricCanvas.setActiveObject(this.drawingObject);
                }
                this.drawingObject = null;
                appState.emit('canvas:modified');
            }
        });
    }

    _initObjectModificationEvents() {
        this.fabricCanvas.on('object:modified', async () => {
            const canProceed = await this.historyManager.branchingCheck();
            if (canProceed) {
                appState.emit('canvas:modified');
            } else {
                this.historyManager.loadState(this.historyManager.history[this.historyManager.historyIndex]);
            }
        });
    }

    _initHotkeys() {
        document.addEventListener('keydown', (e) => {
            if (document.activeElement.tagName === 'INPUT') return;
            if (e.key === 'Delete' || e.key === 'Backspace') {
                e.preventDefault();
                this.deleteSelection();
            }
        });
    }

    async deleteSelection() {
        const canProceed = await this.historyManager.branchingCheck();
        if (!canProceed) return;

        const activeObjects = this.fabricCanvas.getActiveObjects();
        if (activeObjects.length > 0) {
            activeObjects.forEach(obj => this.fabricCanvas.remove(obj));
            this.fabricCanvas.discardActiveObject().renderAll();
            appState.emit('canvas:modified');
        }
    }

    _hexToRgba(hex, opacity) {
        if (!/^#([A-Fa-f0-9]{3}){1,2}$/.test(hex)) {
            hex = '#000000';
        }
        let c = hex.substring(1).split('');
        if (c.length === 3) {
            c = [c[0], c[0], c[1], c[1], c[2], c[2]];
        }
        c = '0x' + c.join('');
        const r = (c >> 16) & 255;
        const g = (c >> 8) & 255;
        const b = c & 255;
        return `rgba(${r},${g},${b},${opacity})`;
    }

    onPropertyChange(properties) {
        if (this.fabricCanvas.isDrawingMode) {
            const brush = this.fabricCanvas.freeDrawingBrush;
            brush.width = properties.strokeWidth;
            brush.color = this._hexToRgba(properties.stroke, properties.opacity);
        }
    }

    configureBrush(tool) {
        const brush = this.fabricCanvas.freeDrawingBrush;
        if (tool === 'brush') {
            brush.color = '#ffffff';
            brush.width = 2;
        } else if (tool === 'marker') {
            brush.color = 'rgba(255, 255, 0, 0.4)';
            brush.width = 20;
        }
        appState.emit('property:changed', {
            stroke: brush.color,
            strokeWidth: brush.width,
            opacity: new fabric.Color(brush.color).getAlpha()
        });
    }

    onToolChanged(tool) {
        if (tool === 'brush' || tool === 'marker') {
            this.fabricCanvas.isDrawingMode = true;
            this.fabricCanvas.selection = false;
            this.fabricCanvas.defaultCursor = 'crosshair';
            this.configureBrush(tool);
        } else {
            this.fabricCanvas.isDrawingMode = false;
            this.fabricCanvas.selection = (tool === 'select');
            this.fabricCanvas.defaultCursor = (tool === 'select') ? 'default' : 'crosshair';
        }
        this.fabricCanvas.discardActiveObject().renderAll();
    }

    getCanvas() {
        return this.fabricCanvas;
    }
}

export default CanvasManager;