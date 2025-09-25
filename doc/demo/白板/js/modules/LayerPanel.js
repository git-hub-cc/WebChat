// js/modules/LayerPanel.js
import appState from '../AppState.js';

class LayerPanel {
    constructor(canvas, historyManager) {
        this.canvas = canvas;
        this.historyManager = historyManager;
        this.layerListEl = document.getElementById('layer-list');

        this._initEventListeners();
        this.render(); // 初始渲染
    }

    _initEventListeners() {
        // 监听画布更新事件，以刷新图层列表
        appState.on('canvas:modified', () => this.render());
        appState.on('canvas:updated', () => this.render());

        // 监听画布的选择事件，以高亮图层列表项
        this.canvas.on('selection:created', () => this.updateSelectionHighlight());
        this.canvas.on('selection:updated', () => this.updateSelectionHighlight());
        this.canvas.on('selection:cleared', () => this.updateSelectionHighlight());

        // 点击图层列表项，触发时间旅行或选中对象
        this.layerListEl.addEventListener('click', (e) => {
            const item = e.target.closest('.layer-item');
            if (item && item.dataset.historyIndex) {
                const historyIndex = parseInt(item.dataset.historyIndex, 10);
                const objId = item.dataset.id;
                const currentHistoryIndex = this.historyManager.historyIndex;

                if (historyIndex > currentHistoryIndex) {
                    // 如果点击的是“未来”的图层，则跳转到它出现的那个历史点
                    this.historyManager.goToState(historyIndex);
                } else {
                    // 如果点击的是当前或过去的图层
                    // 1. 如果不在那个历史点，先跳转
                    if (currentHistoryIndex !== historyIndex) {
                        this.historyManager.goToState(historyIndex);
                    }
                    // 2. 然后选中画布上对应的对象
                    const obj = this.canvas.getObjects().find(o => o.id === objId);
                    if (obj) {
                        this.canvas.setActiveObject(obj).renderAll();
                    }
                }
            }
        });
    }

    /**
     * 优化后的渲染方法：从全部历史记录构建图层列表
     */
    render() {
        this.layerListEl.innerHTML = '';

        const allObjectsMap = new Map();
        const history = this.historyManager.history;
        const currentHistoryIndex = this.historyManager.historyIndex;

        // 1. 遍历所有历史记录，收集所有出现过的对象及其首次出现的历史索引
        for (let i = 0; i < history.length; i++) {
            const state = history[i];
            state.objects.forEach(obj => {
                // 只记录每个对象首次出现的位置
                if (!allObjectsMap.has(obj.id)) {
                    allObjectsMap.set(obj.id, {
                        ...obj, // 存储对象信息（如类型、名称）
                        firstAppearanceIndex: i // 记录首次出现的历史索引
                    });
                }
            });
        }

        // 2. 将 Map 转换为数组并反转，以匹配视觉堆叠顺序
        const allLayers = Array.from(allObjectsMap.values()).reverse();

        // 3. 渲染每个图层项
        allLayers.forEach(layerInfo => {
            const item = document.createElement('li');
            item.className = 'layer-item';
            item.dataset.id = layerInfo.id;
            item.dataset.historyIndex = layerInfo.firstAppearanceIndex;

            // 关键逻辑：判断图层是否属于“未来”
            // 如果一个图层首次出现的历史点晚于当前预览的历史点，那么它就是“未来”的。
            if (layerInfo.firstAppearanceIndex > currentHistoryIndex) {
                item.classList.add('future');
            }

            const icon = this.getIconForType(layerInfo.type);
            const name = layerInfo.name || layerInfo.type || 'Object';

            item.innerHTML = `
                <span class="layer-item-icon">${icon}</span>
                <span class="layer-item-name">${name}</span>
            `;
            this.layerListEl.appendChild(item);
        });

        this.updateSelectionHighlight();
    }

    /**
     * 根据画布的当前选择，更新图层列表项的高亮状态
     */
    updateSelectionHighlight() {
        const activeObjects = this.canvas.getActiveObjects();
        const activeIds = activeObjects.map(o => o.id);

        this.layerListEl.querySelectorAll('.layer-item').forEach(item => {
            // 只有非未来的图层才需要高亮
            if (activeIds.includes(item.dataset.id) && !item.classList.contains('future')) {
                item.classList.add('active');
            } else {
                item.classList.remove('active');
            }
        });
    }

    getIconForType(type) {
        switch (type) {
            case 'rect': return '⬜';
            case 'circle': return '⭕';
            case 'line': return '📏';
            case 'i-text': return '🔤';
            case 'path': return '✍️'; // 新增：为自由绘制路径（画笔、标记笔）设置图标
            default: return '🎨';
        }
    }
}

export default LayerPanel;