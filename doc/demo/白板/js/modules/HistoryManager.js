// js/modules/HistoryManager.js
import appState from "../AppState.js";

class HistoryManager {
    constructor(canvas) {
        this.canvas = canvas;
        this.history = [];
        this.historyIndex = -1; // 当前所在的历史点
        this.isTimeTraveling = false; // 是否处于“时间旅行”预览模式
        this.isUpdating = false;

        this.undoBtn = document.getElementById('undo-btn');
        this.redoBtn = document.getElementById('redo-btn');

        this._initEventListeners();
        this.saveState();
    }

    _initEventListeners() {
        // ... (保留之前的事件监听) ...
        appState.on('canvas:modified', () => {
            // 如果正在时间旅行，则不自动保存新状态
            if (!this.isUpdating && !this.isTimeTraveling) {
                this.saveState();
            }
        });

        // ... (保留按钮和快捷键监听) ...
        this.undoBtn.addEventListener('click', () => this.undo());
        this.redoBtn.addEventListener('click', () => this.redo());
    }

    /**
     * 新增：检查是否需要从当前历史点创建新分支
     * @returns {boolean} - true 表示可以继续，false 表示已取消
     */
    async branchingCheck() {
        if (this.isTimeTraveling) {
            // 使用我们的模态框进行确认
            const modal = new (await import('./Modal.js')).default();
            const bodyHtml = `<p>您正在一个旧的历史版本上进行修改。确认后，所有在此之后的修改记录都将被删除。</p><p><strong>此操作不可撤销！</strong></p>`;
            const confirmation = await modal.show("创建新的历史分支？", bodyHtml);

            if (confirmation) {
                // 用户确认，裁剪历史记录
                this.history = this.history.slice(0, this.historyIndex + 1);
                this.isTimeTraveling = false; // 结束时间旅行模式
                return true; // 允许操作继续
            } else {
                return false; // 用户取消，阻止操作
            }
        }
        return true; // 不在时间旅行模式，正常操作
    }

    saveState() {
        // ... (保留 saveState 的核心逻辑) ...
        if (this.historyIndex < this.history.length - 1) {
            this.history = this.history.slice(0, this.historyIndex + 1);
        }
        const state = this.canvas.toJSON(['id']); // 确保对象的自定义 'id' 属性被序列化
        this.history.push(state);
        this.historyIndex++;
        this.updateButtons();
    }

    undo() {
        if (this.historyIndex > 0) {
            this.isTimeTraveling = true; // 进入时间旅行模式
            this.historyIndex--;
            this.loadState(this.history[this.historyIndex]);
        }
    }

    redo() {
        if (this.historyIndex < this.history.length - 1) {
            this.historyIndex++;
            this.loadState(this.history[this.historyIndex]);
            // 如果重做到最新的状态，则退出时间旅行模式
            if (this.historyIndex === this.history.length - 1) {
                this.isTimeTraveling = false;
            }
        }
    }

    /**
     * 新增：跳转到指定的历史记录索引
     * @param {number} index - 历史记录的索引
     */
    goToState(index) {
        if (index >= 0 && index < this.history.length) {
            this.isTimeTraveling = (index < this.history.length - 1); // 如果不是最新的状态，则进入时间旅行
            this.historyIndex = index;
            this.loadState(this.history[this.historyIndex]);
        }
    }

    loadState(state) {
        this.isUpdating = true;
        this.canvas.loadFromJSON(state, () => {
            this.canvas.renderAll();
            appState.emit('canvas:updated');
            this.updateButtons();
            this.isUpdating = false;
        });
    }

    updateButtons() {
        this.undoBtn.disabled = this.historyIndex <= 0;
        this.redoBtn.disabled = this.historyIndex >= this.history.length - 1;
    }
}

export default HistoryManager;