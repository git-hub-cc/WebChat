// js/modules/ToolbarManager.js
import appState from '../AppState.js';

class ToolbarManager {
    constructor() {
        this.toolbar = document.querySelector('.toolbar');
        this.toolButtons = this.toolbar.querySelectorAll('.tool-btn');
        this.deleteBtn = document.getElementById('delete-btn'); // 获取删除按钮

        this._initEventListeners();
    }

    _initEventListeners() {
        this.toolbar.addEventListener('click', (e) => {
            const button = e.target.closest('.tool-btn');
            if (button) {
                const tool = button.dataset.tool;
                this.setActiveTool(tool);
            }
        });

        // 点击删除按钮时，发布一个删除事件
        this.deleteBtn.addEventListener('click', () => {
            appState.emit('delete:selection');
        });

        appState.on('tool:changed', (tool) => this.updateActiveButton(tool));
    }

    setActiveTool(tool) {
        appState.setActiveTool(tool);
    }

    updateActiveButton(activeTool) {
        this.toolButtons.forEach(btn => {
            if (btn.dataset.tool === activeTool) {
                btn.classList.add('active');
            } else {
                btn.classList.remove('active');
            }
        });
    }
}

export default ToolbarManager;