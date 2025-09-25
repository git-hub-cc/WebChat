// js/modules/PropertyPanel.js
import appState from "../AppState.js"; // 引入 AppState 以便发布事件

class PropertyPanel {
    constructor(canvas) {
        this.canvas = canvas;
        this.panel = document.getElementById('property-panel');

        this.propertyGroups = {
            fill: this.panel.querySelector('#prop-fill-group'),
        };

        this.inputs = {
            fill: this.panel.querySelector('#prop-fill'),
            stroke: this.panel.querySelector('#prop-stroke'),
            strokeWidth: this.panel.querySelector('#prop-stroke-width'),
            opacity: this.panel.querySelector('#prop-opacity'),
        };

        this.currentObject = null;

        this._initEventListeners();
        this.clearPanel();
    }

    _initEventListeners() {
        this.canvas.on('selection:created', (e) => this.updatePanel(e.selected[0]));
        this.canvas.on('selection:updated', (e) => this.updatePanel(e.selected[0]));
        this.canvas.on('selection:cleared', () => this.clearPanel());

        this.panel.addEventListener('input', (e) => {
            if (e.target.closest('.property-group')) {
                this.updateObjectProperties();
            }
        });
    }

    _formatColorForInput(color) {
        if (!color || color === 'transparent') {
            return '#000000';
        }
        if (color.startsWith('#')) {
            return color;
        }
        if (color.startsWith('rgb')) {
            const parts = color.match(/\d+/g);
            if (parts && parts.length >= 3) {
                const toHex = (c) => ('0' + parseInt(c, 10).toString(16)).slice(-2);
                return `#${toHex(parts[0])}${toHex(parts[1])}${toHex(parts[2])}`;
            }
        }
        return '#000000';
    }

    updatePanel(obj) {
        if (!obj) {
            this.clearPanel();
            return;
        }
        this.currentObject = obj;
        this.panel.classList.remove('disabled');

        Object.values(this.inputs).forEach(input => input.disabled = false);
        Object.values(this.propertyGroups).forEach(group => group.classList.remove('disabled'));

        const isPath = obj.type === 'path';

        if (isPath) {
            this.inputs.fill.disabled = true;
            this.propertyGroups.fill.classList.add('disabled');
        } else {
            this.inputs.fill.value = this._formatColorForInput(obj.get('fill'));
            if (obj.get('fill') === 'transparent') {
                this.inputs.fill.disabled = true;
            }
        }

        this.inputs.stroke.value = this._formatColorForInput(obj.get('stroke'));
        this.inputs.strokeWidth.value = obj.get('strokeWidth') || 0;
        this.inputs.opacity.value = obj.get('opacity') || 1;
    }

    clearPanel() {
        this.currentObject = null;
        // 当没有对象选中时，面板不再完全禁用，以便可以调整画笔工具的属性
        this.panel.classList.remove('disabled');
        Object.values(this.inputs).forEach(input => input.disabled = false);
        Object.values(this.propertyGroups).forEach(group => group.classList.remove('disabled'));

        // 对于画笔工具，填充总是禁用的
        this.inputs.fill.disabled = true;
        this.propertyGroups.fill.classList.add('disabled');
    }

    updateObjectProperties() {
        // 1. 收集当前面板上的所有属性值
        const properties = {
            stroke: this.inputs.stroke.value,
            strokeWidth: parseInt(this.inputs.strokeWidth.value, 10),
            opacity: parseFloat(this.inputs.opacity.value),
            fill: this.inputs.fill.disabled ? 'transparent' : this.inputs.fill.value
        };

        // 2. 如果有选中的对象，直接更新它
        if (this.currentObject) {
            const propertiesToSet = {
                stroke: properties.stroke,
                strokeWidth: properties.strokeWidth,
                opacity: properties.opacity,
            };
            if (this.currentObject.type !== 'path') {
                propertiesToSet.fill = properties.fill;
            }
            this.currentObject.set(propertiesToSet);
            this.currentObject.fire('modified');
            this.canvas.requestRenderAll();
        }

        // 3. **核心改动**: 无论是否有选中对象，都发布一个全局事件
        // 这样 CanvasManager 就可以监听到，并更新画笔/标记笔
        appState.emit('property:changed', properties);
    }
}

export default PropertyPanel;