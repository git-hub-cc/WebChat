// js/AppState.js
class AppState {
    constructor() {
        this.activeTool = 'select'; // 默认工具
        this.listeners = {};
    }

    // 订阅状态变化
    on(event, callback) {
        if (!this.listeners[event]) {
            this.listeners[event] = [];
        }
        this.listeners[event].push(callback);
    }

    // 发布状态变化
    emit(event, data) {
        if (this.listeners[event]) {
            this.listeners[event].forEach(callback => callback(data));
        }
    }

    setActiveTool(tool) {
        if (this.activeTool !== tool) {
            this.activeTool = tool;
            this.emit('tool:changed', tool);
        }
    }
}

// 创建一个单例，以便在整个应用中共享
const appState = new AppState();
export default appState;