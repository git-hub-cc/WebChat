/**
 * @file EmojiStickerUIManager.js
 * @description 管理表情和贴图面板的 UI 和交互。
 * @module EmojiStickerManager
 * @exports {object} EmojiStickerUIManager
 * @dependencies Utils, DBManager, MessageManager, MediaManager, NotificationUIManager, EventEmitter
 */
const EmojiStickerUIManager = {
    panelEl: null,
    toggleBtnEl: null,
    emojiGridEl: null,
    stickerGridEl: null,
    addStickerBtnEl: null,
    stickerInputEl: null,
    isPanelOpen: false,
    _objectUrls: new Map(), // To keep track of created object URLs for cleanup

    // A selection of common emojis
    EMOJI_LIST: [
        // --- 笑脸与人物 (Smileys & People) ---
        // 第 1 行
        '😀', '😄', '😅', '😂', '😉', '😊', '😇', '🥰', '😍', '🤩', '😘', '😗', '😚', '😙',
        // 第 2 行
        '😋', '😛', '😜', '🤪', '😝', '🤑', '🤗', '🤭', '🤫', '🤔', '🤐', '🤨', '😐', '😑',
        // 第 3 行
        '😶', '😏', '😒', '🙄', '😬', '🤥', '😌', '😔', '😪', '🤤', '😴', '😷', '🤒', '🤕',
        // 第 4 行
        '🤢', '🤮', '🤧', '🥵', '🥶', '🥴', '😵', '🤯', '🤠', '🥳', '😎', '🤓', '🧐', '😕',
        // 第 5 行
        '😟', '🙁', '☹️', '😮', '😯', '😲', '😳', '🥺', '😦', '😧', '😨', '😰', '😥', '😢',
        // 第 6 行
        '😭', '😱', '😖', '😣', '😞', '😓', '😩', '😫', '🥱', '😤', '😡', '😠', '🤬', '😈',
        // 第 7 行
        '👿', '💀', '☠️', '💩', '🤡', '👹', '👺', '👻', '👽', '👾', '🤖', '😺', '😸', '😹',
        // 第 8 行
        '😻', '😼', '😽', '🙀', '😿', '😾', '🙈', '🙉', '🙊', '💋', '💌', '💘', '💝', '💖',
        // 第 9 行
        '💗', '💓', '💞', '💕', '💟', '❣️', '💔', '❤️', '🧡', '💛', '💚', '💙', '💜', '🤎',
        // 第 10 行
        '🖤', '🤍', '💯', '💢', '💥', '💫', '💦', '💨', '🕳️', '💣', '💬', '👁️‍🗨️', '🗨️', '🗯️',
        // 第 11 行
        '💭', '💤', '👋', '🤚', '🖐️', '✋', '🖖', '👌', '🤏', '✌️', '🤞', '🤟', '🤘',
        // 第 12 行
        '🤙', '👈', '👉', '👆', '🖕', '👇', '☝️', '👍', '👎', '✊', '👊', '🤛', '🤜', '👏',
        // 第 13 行
        '🙌', '👐', '🤲', '🤝', '🙏', '✍️', '💅', '🤳', '💪', '🦾', '🦵', '🦿', '🦶', '👂',
        // 第 14 行
        '🦻', '👃', '🧠', '🦷', '🦴', '👀', '👁️', '👅', '👄', '👶', '🧒', '👦', '👧', '🧑',
        // 第 15 行 (及之后的人物)
        '👱', '👨', '🧔', '👨‍🦰', '👨‍🦱', '👨‍🦳', '👨‍🦲', '👩', '👩‍🦰', '🧑‍', '👩‍🦱', '🧑‍', '👩‍🦳', '🧑‍',

        // --- 动物与自然 (Animals & Nature) ---
        '🌹', '🥀', '🌺', '🌻', '🌼', '🌷', '🌱', '🌲', '🌳', '🌴', '🌵', '🌾', '🌿', '🍀',
        '🍁', '🍂', '🍃',

        // --- 食物与饮料 (Food & Drink) ---
        '🍇', '🍈', '🍉', '🍊', '🍋', '🍌', '🍍', '🥭', '🍎', '🍏', '🍐', '🍑', '🍒', '🍓',
        '🥝', '🍅', '🥥', '🥑', '🍆', '🥔', '🥕', '🌽', '🌶️', '🥒', '🥬', '🥦', '🧄', '🧅',
        '🍄', '🥜', '🌰', '🍞', '🥐', '🥖', '🥨', '🥯', '🥞', '🧇', '🧀', '🍖', '🍗', '🥩',
        '🥓', '🍔', '🍟', '🍕', '🌭', '🥪', '🌮', '🌯', '🥙', '🧆', '🥚', '🍳', '🥘', '🍲',
        '🥣', '🥗', '🍿', '🧈', '🧂', '🥫', '🍱', '🍘', '🍙', '🍚', '🍛', '🍜', '🍝', '🍠',
        '🍢', '🍣', '🍤', '🍥', '🥮', '🍡', '🥟', '🥠', '🥡', '🦀', '🦞', '🦐', '🦑', '🦪',
        '🍦', '🍧', '🍨', '🍩', '🍪', '🎂', '🍰', '🧁', '🥧', '🍫', '🍬', '🍭', '🍮', '🍯',
        '🍼', '🥛', '☕', '🍵', '🍶', '🍾', '🍷', '🍸', '🍹', '🍺', '🍻', '🥂', '🥃', '🥤',
        '🧃', '🧉', '🧊', '🥢', '🍽️', '🍴', '🥄', '🔪', '🏺',

        // --- 活动 (Activity) ---
        '🌍', '🌙', '⭐', '🌟', '✨', '⚡', '🔥', '🎉', '🎊', '🎈', '🎁', '🎀', '🧧', '⚽',
        '🏀', '🏈', '⚾', '🥎', '🎾', '🏐', '🏉', '🎱', '🏓', '🏸', '🥅', '🏒', '🏑', '🥍',
        '🏏', '🎯', '⛳', '🪁', '🏹', '🎣', '🤿', '🥊', '🥋', '🎽', '🛹', '🛷', '⛸️', '🥌',
        '🎿', '⛷️', '🏂', '🪂', '🏋️', '🤺', '🤸', '🤽', '🤾', '🤹', '🧘', '🛀', '🛌', '🎤',
        '🎧', '🎼', '🎹', '🥁', '🎷', '🎺', '🎸', '🪕', '🎻', '🎲', '♟️', '🎯', '🎳', '🎮',
        '🎰', '🧩',

        // --- 旅行与地点 (Travel & Places) ---
        '🚗', '🚕', '🚙', '🚌', '🚎', '🏎️', '🚓', '🚑', '🚒', '🚐', '🚚', '🚛', '🚜', '🚀',
        '✈️', '🚁', '🚂', '🚃', '🚄', '🚅', '🚆', '🚇', '🚈', '🚉', '🚊', '🚝', '🚞', '🚋',
        '🚡', '🚠', '🚟', '🚢', '🚤', '🛥️', '🛳️', '⛴️', '⚓', '⛽', '🚧', '🚦', '🚥', '🛑',
        '🗿', '🎪', '🎡', '🎢', '🎠', '⛲', '⛺', '🏠', '🏡', '🏢', '🏣', '🏤', '🏥', '🏦',
        '🏨', '🏪', '🏫', '🏬', '🏭', '🏯', '🏰', '💒', '🗼', '🗽', '⛪', '🕌', '🛕', '🕍',
        '⛩️', '🕋',

        // --- 物品 (Objects) ---
        '💰', '💴', '💵', '💶', '💷', '💸', '💳', '🧾', '💻', '📱', '☎️', '📞', '💡', '🕯️',
        '🔌', '🔋', '🔧', '🔨', '🛠️', '⛏️', '⚙️', '⛓️', '🔫', '🧨', '💣', '🔪', '🗡️', '🛡️',
        '🚬', '⚰️', '⚱️', '💊', '💉', '🩸', '🧬', '🔬', '🔭', '📡', '🛰️', '🧯', '🪓', '🧲',
        '🧰', '🧱',  '🚪', '🛏️', '🛋️', '🚽', '🚿', '🛁', '🧼', '🪒', '🧴', '🧻',
        '🧹', '🧺', '🧽', '🔑', '🗝️', '💌', '📫', '📪', '📬', '📭', '📦', '🏷️', '🔖',

        // --- 符号 (Symbols) ---
        '🚩', '🏳️', '🏴', '🏁', '🏳️‍🌈', '🏳️‍⚧️', '✅', '❌', '❓', '❗', '⁉️', '‼️', '⭕', '🚫',
        '💯', '🆘', '♨️', '🛑', '🌀', '💤', '💠', '🔷', '🔶', '🔹', '🔸', '🔺', '🔻', '🟥',
        '🟦', '🟨', '🟩', '🟪', '🟫',  '▪️', '◾', '◼️', '⬛', '▫️', '◽', '◻️', '⬜'
    ],

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

    _bindEvents: function() {
        this.toggleBtnEl.addEventListener('click', (e) => {
            e.stopPropagation();
            this.togglePanel();
        });

        this.addStickerBtnEl.addEventListener('click', () => this.stickerInputEl.click());
        this.stickerInputEl.addEventListener('change', this._handleStickerUpload.bind(this));

        // Close panel when clicking outside
        document.addEventListener('click', (e) => {
            if (this.isPanelOpen && !this.panelEl.contains(e.target) && e.target !== this.toggleBtnEl) {
                this.togglePanel(false);
            }
        });

        // Tab switching logic
        const tabs = this.panelEl.querySelectorAll('.menu-tab-item');
        tabs.forEach(tab => {
            tab.addEventListener('click', () => {
                const targetId = tab.dataset.tab;
                tabs.forEach(t => t.classList.remove('active'));
                tab.classList.add('active');

                this.panelEl.querySelectorAll('.menu-tab-content').forEach(content => {
                    content.classList.remove('active');
                });
                this.panelEl.querySelector(`#${targetId}TabContent`).classList.add('active');
            });
        });

        EventEmitter.on('stickerFileProcessed', this._saveAndDisplaySticker.bind(this));
    },

    togglePanel: function(forceState) {
        this.isPanelOpen = (typeof forceState === 'boolean') ? forceState : !this.isPanelOpen;
        this.panelEl.style.display = this.isPanelOpen ? 'flex' : 'none';

        if (this.isPanelOpen) {
            this._loadStickers();
        } else {
            this._cleanupObjectUrls(); // Clean up when panel closes
        }
    },

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

    _onEmojiClick: function(emoji) {
        const input = document.getElementById('messageInput');
        const start = input.selectionStart;
        const end = input.selectionEnd;
        input.value = input.value.substring(0, start) + emoji + input.value.substring(end);
        input.selectionStart = input.selectionEnd = start + emoji.length;
        input.focus();
    },

    _loadStickers: async function() {
        this.stickerGridEl.innerHTML = '';
        this._cleanupObjectUrls();
        try {
            const stickers = await DBManager.getAllItems('stickers');
            stickers.forEach(sticker => this._addStickerToGrid(sticker));
        } catch (error) {
            Utils.log("加载贴图失败。", Utils.logLevels.ERROR);
            NotificationUIManager.showNotification("加载自定义贴图失败。", "error");
        }
    },

    _addStickerToGrid: function(stickerData) {
        const stickerItemEl = document.createElement('div');
        stickerItemEl.className = 'sticker-item';
        stickerItemEl.title = stickerData.name;

        const img = document.createElement('img');
        const objectURL = URL.createObjectURL(stickerData.blob);
        this._objectUrls.set(stickerData.id, objectURL); // Track the URL
        img.src = objectURL;
        img.alt = stickerData.name;

        stickerItemEl.appendChild(img);
        stickerItemEl.addEventListener('click', () => this._onStickerClick(stickerData));
        this.stickerGridEl.appendChild(stickerItemEl);
    },

    _onStickerClick: function(stickerData) {
        MessageManager.sendSticker(stickerData);
        this.togglePanel(false);
    },

    _handleStickerUpload: function(event) {
        const file = event.target.files[0];
        if (file) {
            MediaManager.processStickerFile(file);
        }
        this.stickerInputEl.value = ''; // Reset for next selection
    },

    _saveAndDisplaySticker: async function(stickerFileObject) {
        try {
            await DBManager.setItem('stickers', stickerFileObject);
            this._addStickerToGrid(stickerFileObject);
            NotificationUIManager.showNotification("贴图已成功添加！", "success");
        } catch (error) {
            Utils.log(`保存贴图失败: ${error}`, Utils.logLevels.ERROR);
            NotificationUIManager.showNotification("保存贴图失败。", "error");
        }
    },

    _cleanupObjectUrls: function() {
        this._objectUrls.forEach(url => URL.revokeObjectURL(url));
        this._objectUrls.clear();
    }
};