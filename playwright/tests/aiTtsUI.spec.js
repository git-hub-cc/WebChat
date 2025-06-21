const {test, expect} = require('@playwright/test'); // 1. 导入 Playwright 测试模块

test.describe('AI 消息 TTS UI - 动态获取模式 (修复后 v2)', () => { // 2. 定义测试套件
    // 3. 定义测试中使用的常量
    const AI_CONTACT_ID = 'AI_Kazuha_原神';
    const AI_CONTACT_NAME = '枫原万叶';
    const AI_MESSAGE_TEXT = `你好 ${AI_CONTACT_NAME}，动态 TTS 测试！`;

    // 4. beforeEach 钩子：在每个测试用例运行前执行
    test.beforeEach(async ({page}) => {
        await page.goto('/'); // 4a. 导航到根路径
        // 4b. 等待并断言连接状态文本包含特定内容，超时30秒
        await expect(page.locator('#connectionStatusText')).toContainText(/初始化完成，准备连接|用户注册成功|信令服务器已连接|已从本地加载|使用现有id/, {timeout: 30000});

        // 4c. 定位 AI 联系人列表项：
        //    - `#chatListNav li[data-id="${AI_CONTACT_ID}"]`: 查找ID为chatListNav的元素下的、具有特定data-id属性的li元素。
        //      `${AI_CONTACT_ID}` 是模板字符串，将常量值嵌入选择器。
        //    - `.chat-list-name:has-text("${AI_CONTACT_NAME}")`: 在该li元素内，查找class为chat-list-name且包含特定文本的元素。
        const aiContactListItem = page.locator(`#chatListNav li[data-id="${AI_CONTACT_ID}"] .chat-list-name:has-text("${AI_CONTACT_NAME}")`);
        await expect(aiContactListItem).toBeVisible({timeout: 20000}); // 4d. 断言该联系人项可见，超时20秒

        // 4e. 点击整个列表项 (父级li)
        await page.locator(`#chatListNav li[data-id="${AI_CONTACT_ID}"]`).click();
        // 4f. 断言当前聊天标题为AI角色名
        await expect(page.locator('#currentChatTitleMain')).toHaveText(AI_CONTACT_NAME);

        // 4g. 点击聊天详情按钮
        await page.locator('#chatDetailsBtnMain').click();
        // 4h. 断言详情面板标题包含AI角色名
        await expect(page.locator('#detailsPanelTitle')).toContainText(`${AI_CONTACT_NAME} 信息`);
        // 4i. 断言详情面板可见
        await expect(page.locator('#detailsPanel')).toBeVisible();
    });

    // 5. 定义一个名为 "配置动态 TTS，发送消息并验证 TTS 播放" 的测试用例
    test('配置动态 TTS，发送消息并验证 TTS 播放', async ({page}) => {
        // 5a. 定位TTS配置区域
        const ttsConfigSection = page.locator('#aiTtsConfigSection');
        await expect(ttsConfigSection).toBeVisible(); // 断言可见
        // 5b. 定位TTS配置区域的头部 (可折叠)
        const ttsConfigHeader = ttsConfigSection.locator('h4.collapsible-header:has-text("TTS 配置")');
        // 5c. 定位TTS配置区域的内容部分 (紧随头部的div)
        //    `+ div.collapsible-content` 是 CSS 相邻兄弟选择器
        const ttsConfigContent = ttsConfigHeader.locator('+ div.collapsible-content');

        // 5d. 如果内容区域是隐藏的，则点击头部展开它
        if (await ttsConfigContent.isHidden()) {
            await ttsConfigHeader.click();
        }
        await expect(ttsConfigContent).toBeVisible(); // 断言内容区域可见

        // --- 模式和版本选择 ---
        // 5e. 定位TTS模式选择下拉框 (select元素)
        const ttsModeSelect = ttsConfigSection.locator(`select#ttsInput_${AI_CONTACT_ID}_tts_mode`);
        // 5f. 选择值为 "Dynamic" 的选项
        await ttsModeSelect.selectOption({value: 'Dynamic'});
        // 5g. 断言下拉框的当前值为 "Dynamic"
        await expect(ttsModeSelect).toHaveValue('Dynamic');

        // 5h. 定位模型名称的可搜索下拉框 (通常是一个自定义组件，外面是div)
        const modelNameSearchableSelect = ttsConfigSection.locator(`div.searchable-select-tts#ttsInput_${AI_CONTACT_ID}_model_name`);
        await expect(modelNameSearchableSelect).toBeVisible();

        // 5i. 定位版本选择下拉框
        const versionSelect = ttsConfigSection.locator(`select#ttsInput_${AI_CONTACT_ID}_version`);
        await versionSelect.selectOption({value: 'v4'}); // 选择 v4
        await expect(versionSelect).toHaveValue('v4'); // 断言值为 v4

        // --- 模型名称选择 ---
        // 5j. 定位模型名称可搜索下拉框内的输入框
        const modelNameInput = modelNameSearchableSelect.locator('input.searchable-select-input-tts');
        // 5k. 断言输入框启用，并增加超时等待模型加载
        await expect(modelNameInput).toBeEnabled({timeout: 25000});
        // 5l. 断言输入框的 placeholder 属性
        await expect(modelNameInput).toHaveAttribute('placeholder', '搜索/选择模型...', {timeout: 10000});

        // 5m. 在输入框中填写 AI 角色名进行搜索
        await modelNameInput.fill(AI_CONTACT_NAME);
        // 5n. 定位搜索结果选项的容器
        const modelOptionsContainer = modelNameSearchableSelect.locator('div.searchable-select-options-container-tts');
        await expect(modelOptionsContainer).toBeVisible(); // 断言选项容器可见
        // 5o. 定位包含AI角色名的第一个选项
        const targetModelOption = modelOptionsContainer.locator(`div.searchable-select-option-tts:has-text("${AI_CONTACT_NAME}")`).first();
        await expect(targetModelOption).toBeVisible(); // 断言目标选项可见
        // 5p. 获取选项的完整文本内容
        const fullModelNameText = await targetModelOption.textContent();
        if (!fullModelNameText) { // 防御性编程，确保文本不为空
            throw new Error(`无法获取包含 "${AI_CONTACT_NAME}" 的模型选项的文本内容`);
        }
        const trimmedFullModelNameText = fullModelNameText.trim(); // 去除前后空格
        await targetModelOption.click(); // 点击选中的模型选项
        // 5q. 断言输入框的值变为选中的模型全名
        await expect(modelNameInput).toHaveValue(trimmedFullModelNameText);
        // 5r. 断言选项容器隐藏 (选择后通常会关闭)
        await expect(modelOptionsContainer).toBeHidden();

        // --- 参考音频语言选择 ---
        // 5s. 定位语言选择下拉框
        const promptLangSelect = ttsConfigSection.locator(`select#ttsInput_${AI_CONTACT_ID}_prompt_text_lang`);
        // 5t. 断言语言下拉框启用 (模型选择后应该会激活)
        await expect(promptLangSelect).toBeEnabled({timeout: 20000});
        // (注释掉的代码：确认下拉框有真实选项)
        // await expect(promptLangSelect.locator('option:not([value=""]):not([disabled])').first()).toBeVisible({timeout: 10000});

        // 5u. 通过标签 "中文" 选择语言
        await promptLangSelect.selectOption({label: '中文'});
        await expect(promptLangSelect).toHaveValue('中文'); // 断言值为 "中文"

        // (注释掉的情感选择部分，逻辑类似)

        // --- 启用 TTS 和保存 ---
        // 5v. 定位启用TTS的复选框 (通过 type 和 data-tts-param 属性)
        const enableTtsCheckbox = ttsConfigSection.locator(`input[type="checkbox"][data-tts-param="enabled"]`);
        await enableTtsCheckbox.check(); // 勾选复选框
        await expect(enableTtsCheckbox).toBeChecked(); // 断言已勾选

        // 5w. 定位并点击保存按钮
        const saveTtsButton = page.locator('#saveAiTtsSettingsBtnDetails');
        await saveTtsButton.click();
        // 5x. 断言保存成功的通知消息可见
        await expect(page.locator('.notification.notification-success:has-text("TTS 设置已成功保存。")')).toBeVisible();

        // --- 关闭详情面板 ---
        // 5y. 点击关闭详情面板按钮
        await page.locator('#closeDetailsBtnMain').click();
        await expect(page.locator('#detailsPanel')).toBeHidden(); // 断言面板已隐藏

        // --- 发送消息并验证 TTS 播放 ---
        // 5z. 定位消息输入框
        const messageInput = page.locator('#messageInput');
        await messageInput.fill(AI_MESSAGE_TEXT); // 填写消息
        await page.locator('#sendButtonMain').click(); // 点击发送
        // 5aa. 断言已发送的消息出现在聊天记录中
        await expect(page.locator(`.message.sent .message-content:has-text("${AI_MESSAGE_TEXT}")`)).toBeVisible();

        // 5ab. 定位 "正在思考..." 的系统消息
        const thinkingMessage = page.locator(`.message.system:has-text("${AI_CONTACT_NAME} 正在思考...")`);
        await expect(thinkingMessage).toBeVisible({timeout: 30000}); // 断言可见
        await expect(thinkingMessage).toBeHidden({timeout: 60000}); // 断言在60秒内消失 (AI响应完成)

        // 5ac. 定位最新一条收到的AI消息 (class包含角色ID)
        const aiMessageElement = page.locator(`.message.received.character-message.${AI_CONTACT_ID}`).last();
        await expect(aiMessageElement).toBeVisible({timeout: 15000}); // 断言AI消息可见

        // 5ad. 在AI消息中定位TTS控制容器
        const ttsControlContainer = aiMessageElement.locator('.tts-control-container');
        await expect(ttsControlContainer).toBeVisible();
        // 5ae. 定位TTS加载中的 spinner
        const ttsLoadingSpinner = ttsControlContainer.locator('.tts-loading-spinner');
        await expect(ttsLoadingSpinner).toBeVisible({timeout: 5000}); // 断言 spinner 可见 (开始加载TTS)

        // 5af. 断言 spinner 在45秒内消失 (TTS加载完成)
        // await expect(ttsLoadingSpinner).toBeHidden({timeout: 45000});
        // 5ag. 定位TTS播放按钮
        const ttsPlayButton = ttsControlContainer.locator('button.tts-play-button');
        await expect(ttsPlayButton).toBeVisible({timeout: 45000}); // 断言播放按钮可见
        // 5ah. 断言播放按钮的 title 属性
        await expect(ttsPlayButton).toHaveAttribute('title', '播放/暂停语音');

        // 5ai. 点击播放按钮
        await ttsPlayButton.click();
        // 5aj. 断言按钮具有 'tts-play-button' 类 (这里可能是验证播放状态的类名，或者是一个笔误，通常是验证图标变化或 aria-label 变化)
        // 注意：toHaveClass 后面跟的是正则表达式或精确字符串。如果 'tts-play-button' 是始终存在的类，
        // 那么这个断言可能是用来确保按钮仍然是那个按钮，或者是在验证它没有变成一个表示“暂停”的特定类。
        // 根据脚本的上下文，这里更可能是想验证按钮处于“播放中”的状态，这通常通过不同的类名或属性来表示。
        // 如果是要验证播放后类名 *仍然包含* tts-play-button，那这个断言没问题。
        // 如果是想验证播放后，按钮的类名 *变成了* 某个表示“播放中”的特定类，那这里的断言需要调整。
        // 假设点击播放后，按钮仍有这个基础类，但可能会增加一个如 'playing' 的类。
        await expect(ttsPlayButton).toHaveClass(/tts-play-button/, {timeout: 10000}); // 确保按钮是播放按钮
        // 再次点击 (暂停)
        await ttsPlayButton.click();
    });
});