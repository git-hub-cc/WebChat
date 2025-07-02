/**
 * @file 管理表情和贴图面板的 UI 和交互
 * @description 负责初始化表情/贴图面板的 UI 元素、绑定事件、加载和展示数据，并处理用户交互（如选择表情、上传贴图等）。
 * @module ChatInputArea - 该模块主要被聊天输入区域引用
 * @exports {object} EmojiStickerUIManager - 表情贴图 UI 管理器单例对象
 * @dependency Utils, DBManager, MessageManager, MediaManager, NotificationUIManager, EventEmitter
 */
const EmojiStickerUIManager = {
    // --- 变量声明 ---
    // 排序：常量 -> 依赖/上下文 -> 状态变量

    // 预设的常用 Emoji 列表，用于在面板中展示
    EMOJI_LIST: [
        // --- 笑脸与人物 (Smileys & People) ---
        '😀', '😄', '😅', '😂', '😉', '😊', '😇', '🥰', '😍', '🤩', '😘', '😗', '😚', '😙', '😋', '😛', '😜', '🤪', '😝', '🤑', '🤗', '🤭', '🤫', '🤔', '🤐', '🤨', '😐', '😑', '😶', '😏', '😒', '🙄', '😬', '🤥', '😌', '😔', '😪', '🤤', '😴', '😷', '🤒', '🤕', '🤢', '🤮', '🤧', '🥵', '🥶', '🥴', '😵', '🤯', '🤠', '🥳', '😎', '🤓', '🧐', '😕', '😟', '🙁', '☹️', '😮', '😯', '😲', '😳', '🥺', '😦', '😧', '😨', '😰', '😥', '😢', '😭', '😱', '😖', '😣', '😞', '😓', '😩', '😫', '🥱', '😤', '😡', '😠', '🤬', '😈', '👿', '💀', '☠️', '💩', '🤡', '👹', '👺', '👻', '👽', '👾', '🤖', '😺', '😸', '😹', '😻', '😼', '😽', '🙀', '😿', '😾', '🙈', '🙉', '🙊', '💋', '💌', '💘', '💝', '💖', '💗', '💓', '💞', '💕', '💟', '❣️', '💔', '❤️', '🧡', '💛', '💚', '💙', '💜', '🤎', '🖤', '🤍', '💯', '💢', '💥', '💫', '💦', '💨', '🕳️', '💣', '💬', '👁️‍🗨️', '🗨️', '🗯️', '💭', '💤', '👋', '🤚', '🖐️', '✋', '🖖', '👌', '🤏', '✌️', '🤞', '🤟', '🤘', '🤙', '👈', '👉', '👆', '🖕', '👇', '☝️', '👍', '👎', '✊', '👊', '🤛', '🤜', '👏', '🙌', '👐', '🤲', '🤝', '🙏', '✍️', '💅', '🤳', '💪', '🦾', '🦵', '🦿', '🦶', '👂', '🦻', '👃', '🧠', '🦷', '🦴', '👀', '👁️', '👅', '👄', '👶', '🧒', '👦', '👧', '🧑', '👱', '👨', '🧔', '👨‍🦰', '👨‍🦱', '👨‍🦳', '👨‍🦲', '👩', '👩‍🦰', '🧑‍', '👩‍🦱', '🧑‍', '👩‍🦳', '🧑‍',
        // --- 动物与自然 (Animals & Nature) ---
        '🌹', '🥀', '🌺', '🌻', '🌼', '🌷', '🌱', '🌲', '🌳', '🌴', '🌵', '🌾', '🌿', '🍀', '🍁', '🍂', '🍃',
        // --- 食物与饮料 (Food & Drink) ---
        '🍇', '🍈', '🍉', '🍊', '🍋', '🍌', '🍍', '🥭', '🍎', '🍏', '🍐', '🍑', '🍒', '🍓', '🥝', '🍅', '🥥', '🥑', '🍆', '🥔', '🥕', '🌽', '🌶️', '🥒', '🥬', '🥦', '🧄', '🧅', '🍄', '🥜', '🌰', '🍞', '🥐', '🥖', '🥨', '🥯', '🥞', '🧇', '🧀', '🍖', '🍗', '🥩', '🥓', '🍔', '🍟', '🍕', '🌭', '🥪', '🌮', '🌯', '🥙', '🧆', '🥚', '🍳', '🥘', '🍲', '🥣', '🥗', '🍿', '🧈', '🧂', '🥫', '🍱', '🍘', '🍙', '🍚', '🍛', '🍜', '🍝', '🍠', '🍢', '🍣', '🍤', '🍥', '🥮', '🍡', '🥟', '🥠', '🥡', '🦀', '🦞', '🦐', '🦑', '🦪', '🍦', '🍧', '🍨', '🍩', '🍪', '🎂', '🍰', '🧁', '🥧', '🍫', '🍬', '🍭', '🍮', '🍯', '🍼', '🥛', '☕', '🍵', '🍶', '🍾', '🍷', '🍸', '🍹', '🍺', '🍻', '🥂', '🥃', '🥤', '🧃', '🧉', '🧊', '🥢', '🍽️', '🍴', '🥄', '🔪', '🏺',
        // --- 活动 (Activity) ---
        '🌍', '🌙', '⭐', '🌟', '✨', '⚡', '🔥', '🎉', '🎊', '🎈', '🎁', '🎀', '🧧', '⚽', '🏀', '🏈', '⚾', '🥎', '🎾', '🏐', '🏉', '🎱', '🏓', '🏸', '🥅', '🏒', '🏑', '🥍', '🏏', '🎯', '⛳', '🪁', '🏹', '🎣', '🤿', '🥊', '🥋', '🎽', '🛹', '🛷', '⛸️', '🥌', '🎿', '⛷️', '🏂', '🪂', '🏋️', '🤺', '🤸', '🤽', '🤾', '🤹', '🧘', '🛀', '🛌', '🎤', '🎧', '🎼', '🎹', '🥁', '🎷', '🎺', '🎸', '🪕', '🎻', '🎲', '♟️', '🎯', '🎳', '🎮', '🎰', '🧩',
        // --- 旅行与地点 (Travel & Places) ---
        '🚗', '🚕', '🚙', '🚌', '🚎', '🏎️', '🚓', '🚑', '🚒', '🚐', '🚚', '🚛', '🚜', '🚀', '✈️', '🚁', '🚂', '🚃', '🚄', '🚅', '🚆', '🚇', '🚈', '🚉', '🚊', '🚝', '🚞', '🚋', '🚡', '🚠', '🚟', '🚢', '🚤', '🛥️', '🛳️', '⛴️', '⚓', '⛽', '🚧', '🚦', '🚥', '🛑', '🗿', '🎪', '🎡', '🎢', '🎠', '⛲', '⛺', '🏠', '🏡', '🏢', '🏣', '🏤', '🏥', '🏦', '🏨', '🏪', '🏫', '🏬', '🏭', '🏯', '🏰', '💒', '🗼', '🗽', '⛪', '🕌', '🛕', '🕍', '⛩️', '🕋',
        // --- 物品 (Objects) ---
        '💰', '💴', '💵', '💶', '💷', '💸', '💳', '🧾', '💻', '📱', '☎️', '📞', '💡', '🕯️', '🔌', '🔋', '🔧', '🔨', '🛠️', '⛏️', '⚙️', '⛓️', '🔫', '🧨', '💣', '🔪', '🗡️', '🛡️', '🚬', '⚰️', '⚱️', '💊', '💉', '🩸', '🧬', '🔬', '🔭', '📡', '🛰️', '🧯', '🪓', '🧲', '𧰰', '🧱', '🚪', '🛏️', '🛋️', '🚽', '🚿', '🛁', '🧼', '🪒', '🧴', '🧻', '🧹', '🧺', '🧽', '🔑', '🗝️', '💌', '📫', '📪', '📬', '📭', '📦', '🏷️', '🔖',
        // --- 符号 (Symbols) ---
        '🚩', '🏳️', '🏴', '🏁', '🏳️‍🌈', '🏳️‍⚧️', '✅', '❌', '❓', '❗', '⁉️', '‼️', '⭕', '🚫', '💯', '🆘', '♨️', '🛑', '🌀', '💤', '💠', '🔷', '🔶', '🔹', '🔸', '🔺', '🔻', '🟥', '🟦', '🟨', '🟩', '🟪', '🟫', '🟧', '▪️', '◾', '◼️', '⬛', '▫️', '◽', '◻️', '⬜'
    ],
    // NOTE: 用于追踪通过 URL.createObjectURL 创建的 Blob URL，以便在面板关闭时及时释放，防止内存泄漏。
    _objectUrls: new Map(),

    // --- UI 元素引用 ---
    panelEl: null, // 表情/贴图面板的根元素
    toggleBtnEl: null, // 用于打开/关闭面板的按钮
    emojiGridEl: null, // 展示 Emoji 的网格容器
    stickerGridEl: null, // 展示贴图的网格容器
    addStickerBtnEl: null, // “添加贴图”按钮
    stickerInputEl: null, // 用于上传贴图文件的隐藏 <input> 元素

    // --- 状态变量 ---
    isPanelOpen: false, // 标记面板当前是否为打开状态

    // --- 方法定义 ---
    // 排序：对外暴露方法 -> 内部逻辑方法 -> 工具类方法

    /**
     * 初始化模块，获取 DOM 元素并绑定事件
     * @function init
     * @returns {void}
     */
    init: function() {
        this.panelEl = document.getElementById('emojiStickerPanel');
        this.toggleBtnEl = document.getElementById('emojiStickerBtn');
        this.emojiGridEl = document.getElementById('emojiGrid');
        this.stickerGridEl = document.getElementById('stickerGrid');
        this.addStickerBtnEl = document.getElementById('addStickerBtn');
        this.stickerInputEl = document.getElementById('stickerInput');

        if (!this.panelEl || !this.toggleBtnEl) {
            Utils.log("EmojiStickerUIManager: 关键 UI 元素未找到。", Utils.logLevels.ERROR);
            return;
        }

        this._bindEvents();
        this._populateEmojiGrid();
    },

    /**
     * 切换表情/贴图面板的显示和隐藏状态
     * @function togglePanel
     * @param {boolean} [forceState] - 可选，强制设置面板状态 (true: 打开, false: 关闭)
     * @returns {void}
     */
    togglePanel: function(forceState) {
        this.isPanelOpen = (typeof forceState === 'boolean') ? forceState : !this.isPanelOpen;
        this.panelEl.style.display = this.isPanelOpen ? 'flex' : 'none';

        // 当面板打开时，加载贴图；关闭时，清理资源
        if (this.isPanelOpen) {
            this._loadStickers();
        } else {
            this._cleanupObjectUrls();
        }
    },

    /**
     * 绑定所有必要的事件监听器
     * @function _bindEvents
     * @returns {void}
     * @private
     */
    _bindEvents: function() {
        // 1. 绑定面板开关按钮的点击事件
        this.toggleBtnEl.addEventListener('click', (e) => {
            e.stopPropagation();
            this.togglePanel();
        });

        // 2. 绑定“添加贴图”按钮，触发隐藏的文件输入框
        this.addStickerBtnEl.addEventListener('click', () => this.stickerInputEl.click());
        this.stickerInputEl.addEventListener('change', this._handleStickerUpload.bind(this));

        // 3. 绑定全局点击事件，用于在面板外部点击时关闭面板
        document.addEventListener('click', (e) => {
            if (this.isPanelOpen && !this.panelEl.contains(e.target) && e.target !== this.toggleBtnEl) {
                this.togglePanel(false);
            }
        });

        // 4. 绑定面板内部的 Tab (表情/贴图) 切换逻辑
        const tabs = this.panelEl.querySelectorAll('.menu-tab-item');
        tabs.forEach(tab => {
            tab.addEventListener('click', () => {
                const targetId = tab.dataset.tab;
                // 移除所有 tab 的激活状态，并为当前点击的 tab 添加
                tabs.forEach(t => t.classList.remove('active'));
                tab.classList.add('active');

                // 隐藏所有内容面板，并显示与当前 tab 对应的内容面板
                this.panelEl.querySelectorAll('.menu-tab-content').forEach(content => {
                    content.classList.remove('active');
                });
                this.panelEl.querySelector(`#${targetId}TabContent`).classList.add('active');
            });
        });

        // 5. 监听贴图文件处理完成的全局事件，以便保存和显示新贴图
        EventEmitter.on('stickerFileProcessed', this._saveAndDisplaySticker.bind(this));
    },

    /**
     * 使用预设的 EMOJI_LIST 填充 Emoji 网格
     * @function _populateEmojiGrid
     * @returns {void}
     * @private
     */
    _populateEmojiGrid: function() {
        this.emojiGridEl.innerHTML = '';
        this.EMOJI_LIST.forEach(emoji => {
            const emojiEl = document.createElement('span');
            emojiEl.className = 'emoji-item';
            emojiEl.textContent = emoji;
            emojiEl.title = emoji;
            emojiEl.addEventListener('click', () => this._onEmojiClick(emoji));
            this.emojiGridEl.appendChild(emojiEl);
        });
    },

    /**
     * 处理 Emoji 点击事件，将其插入到消息输入框
     * @function _onEmojiClick
     * @param {string} emoji - 被点击的 Emoji 字符
     * @returns {void}
     * @private
     */
    _onEmojiClick: function(emoji) {
        const input = document.getElementById('messageInput');
        const start = input.selectionStart;
        const end = input.selectionEnd;
        // 在光标位置插入 emoji
        input.value = input.value.substring(0, start) + emoji + input.value.substring(end);
        // 更新光标位置并聚焦
        input.selectionStart = input.selectionEnd = start + emoji.length;
        input.focus();
    },

    /**
     * 从数据库异步加载所有贴图并显示在网格中
     * @function _loadStickers
     * @returns {Promise<void>}
     * @private
     */
    _loadStickers: async function() {
        this.stickerGridEl.innerHTML = '';
        this._cleanupObjectUrls(); // 加载前先清理旧的 URL
        try {
            const stickers = await DBManager.getAllItems('stickers');
            stickers.forEach(sticker => this._addStickerToGrid(sticker));
        } catch (error) {
            Utils.log("加载贴图失败。", Utils.logLevels.ERROR);
            NotificationUIManager.showNotification("加载自定义贴图失败。", "error");
        }
    },

    /**
     * 将单个贴图数据对象转换为 DOM 元素并添加到贴图网格中
     * @function _addStickerToGrid
     * @param {object} stickerData - 包含 id, name, blob 等信息的贴图对象
     * @returns {void}
     * @private
     */
    _addStickerToGrid: function(stickerData) {
        const stickerItemEl = document.createElement('div');
        stickerItemEl.className = 'sticker-item';
        stickerItemEl.title = stickerData.name;

        const img = document.createElement('img');
        // 为 Blob 数据创建临时的 URL
        const objectURL = URL.createObjectURL(stickerData.blob);
        this._objectUrls.set(stickerData.id, objectURL); // 追踪 URL 以便后续释放
        img.src = objectURL;
        img.alt = stickerData.name;

        stickerItemEl.appendChild(img);
        stickerItemEl.addEventListener('click', () => this._onStickerClick(stickerData));
        this.stickerGridEl.appendChild(stickerItemEl);
    },

    /**
     * 处理贴图点击事件，发送贴图消息并关闭面板
     * @function _onStickerClick
     * @param {object} stickerData - 被点击的贴图数据对象
     * @returns {void}
     * @private
     */
    _onStickerClick: function(stickerData) {
        MessageManager.sendSticker(stickerData);
        this.togglePanel(false);
    },

    /**
     * 处理用户选择贴图文件的事件
     * @function _handleStickerUpload
     * @param {Event} event - 文件输入框的 change 事件对象
     * @returns {void}
     * @private
     */
    _handleStickerUpload: function(event) {
        const file = event.target.files[0];
        if (file) {
            // 将文件交给 MediaManager 进行预处理（如压缩、格式转换等）
            MediaManager.processStickerFile(file);
        }
        // 重置 input 的值，确保下次选择相同文件仍能触发 change 事件
        this.stickerInputEl.value = '';
    },

    /**
     * 接收处理完成的贴图对象，将其保存到数据库并更新 UI
     * @function _saveAndDisplaySticker
     * @param {object} stickerFileObject - 由 MediaManager 处理后生成的贴图对象
     * @returns {Promise<void>}
     * @private
     */
    _saveAndDisplaySticker: async function(stickerFileObject) {
        try {
            // 流程：
            // 1. 将贴图对象存入 IndexedDB
            await DBManager.setItem('stickers', stickerFileObject);
            // 2. 在 UI 上即时显示新添加的贴图
            this._addStickerToGrid(stickerFileObject);
            // 3. 给出成功提示
            NotificationUIManager.showNotification("贴图已成功添加！", "success");
        } catch (error) {
            Utils.log(`保存贴图失败: ${error}`, Utils.logLevels.ERROR);
            NotificationUIManager.showNotification("保存贴图失败。", "error");
        }
    },

    /**
     * 清理所有已创建的 Object URL，以释放浏览器内存
     * @function _cleanupObjectUrls
     * @returns {void}
     * @private
     */
    _cleanupObjectUrls: function() {
        this._objectUrls.forEach(url => URL.revokeObjectURL(url));
        this._objectUrls.clear();
    }
};