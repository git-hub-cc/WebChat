// js/modules/Modal.js

class Modal {
    constructor() {
        this.modalOverlay = null;
        this.resolvePromise = null;
    }

    /**
     * 显示一个模态框
     * @param {string} title - 模态框的标题
     * @param {string} bodyHtml - 模态框主体部分的 HTML 内容
     * @returns {Promise<object|null>} - 返回一个 Promise，当用户点击按钮时解析。
     *                                   如果点击主按钮，则解析为表单数据对象。
     *                                   如果点击取消按钮，则解析为 null。
     */
    show(title, bodyHtml) {
        return new Promise((resolve) => {
            this.resolvePromise = resolve;

            // 创建模态框的 DOM
            this.modalOverlay = document.createElement('div');
            this.modalOverlay.className = 'modal-overlay';
            this.modalOverlay.innerHTML = `
                <div class="modal-content">
                    <div class="modal-header">
                        <h3>${title}</h3>
                    </div>
                    <form class="modal-body">
                        ${bodyHtml}
                    </form>
                    <div class="modal-footer">
                        <button class="modal-btn secondary" data-action="cancel">取消</button>
                        <button class="modal-btn primary" data-action="confirm">确认</button>
                    </div>
                </div>
            `;

            document.body.appendChild(this.modalOverlay);

            // 添加事件监听
            this.modalOverlay.addEventListener('click', this._handleEvents.bind(this));

            // 触发显示动画
            requestAnimationFrame(() => {
                this.modalOverlay.classList.add('visible');
            });
        });
    }

    _handleEvents(e) {
        const action = e.target.dataset.action;
        if (action === 'confirm') {
            const form = this.modalOverlay.querySelector('form');
            const formData = new FormData(form);
            const data = Object.fromEntries(formData.entries());
            this.resolvePromise(data);
            this.close();
        } else if (action === 'cancel' || e.target === this.modalOverlay) {
            // 点击取消按钮或遮罩层本身
            this.resolvePromise(null);
            this.close();
        }
    }

    close() {
        if (!this.modalOverlay) return;

        this.modalOverlay.classList.remove('visible');
        // 等待动画结束后再从 DOM 中移除
        this.modalOverlay.addEventListener('transitionend', () => {
            if (this.modalOverlay) {
                this.modalOverlay.remove();
                this.modalOverlay = null;
            }
        }, { once: true });
    }
}

export default Modal;