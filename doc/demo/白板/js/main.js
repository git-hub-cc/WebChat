// js/main.js (修复版)

import CanvasManager from './modules/CanvasManager.js';
import ToolbarManager from './modules/ToolbarManager.js';
import PropertyPanel from './modules/PropertyPanel.js';
import HistoryManager from './modules/HistoryManager.js';
import LayerPanel from './modules/LayerPanel.js';
import ExportManager from './modules/ExportManager.js';

class App {
    constructor() {
        // 1. 创建唯一的 Fabric.js 画布实例，这是所有模块共享的“真理之源”
        const fabricCanvas = new fabric.Canvas('canvas', {
            backgroundColor: 'transparent',
            selection: true,
            stopContextMenu: true,
            fireRightClick: true,
        });

        // 2. 初始化所有功能模块，并将唯一的 fabricCanvas 实例注入其中
        const historyManager = new HistoryManager(fabricCanvas);

        // 关键改动：将 fabricCanvas 实例直接传给 CanvasManager
        const canvasManager = new CanvasManager(fabricCanvas, historyManager);

        const layerPanel = new LayerPanel(fabricCanvas, historyManager);

        const propertyPanel = new PropertyPanel(fabricCanvas);

        // 其他不需要直接操作画布内部逻辑的模块可以保持原样，或也接受实例以备后用
        const toolbarManager = new ToolbarManager();
        const exportManager = new ExportManager(fabricCanvas);

        console.log('App re-initialized with a single source of truth for the canvas.');
    }
}

// 启动应用
window.addEventListener('load', () => {
    new App();
});