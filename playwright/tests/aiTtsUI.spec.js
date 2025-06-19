// tests/aiTtsUI.spec.js
const { test, expect } = require('@playwright/test');

test.describe('AI 消息 TTS UI 功能', () => {
    const AI_CONTACT_ID = 'AI_Paimon'; // 假设 Paimon 是默认主题中的 AI
    const AI_CONTACT_NAME = 'Paimon';

    test.beforeEach(async ({ page }) => {
        await page.goto('/');
        await expect(page.locator('#connectionStatusText')).toContainText(/初始化完成，准备连接|用户注册成功|信令服务器已连接|已从本地加载|使用现有id/, { timeout: 20000 });

        // 确保 AI 联系人在列表中
        await expect(page.locator(`#chatListNav li[data-id="${AI_CONTACT_ID}"] .chat-list-name:has-text("${AI_CONTACT_NAME}")`)).toBeVisible({ timeout: 10000 });

        // 打开与 AI 的聊天
        await page.locator(`#chatListNav li[data-id="${AI_CONTACT_ID}"]`).click();
        await expect(page.locator('#currentChatTitleMain')).toHaveText(AI_CONTACT_NAME);
    });

    test('AI 回复后应该显示 TTS 加载指示器，然后变为播放按钮', async ({ page }) => {
        const userMessageText = `Paimon，讲个笑话吧！`;
        const messageInput = page.locator('#messageInput');

        // 1. 发送消息给 AI
        await messageInput.fill(userMessageText);
        await page.locator('#sendButtonMain').click();
        await expect(page.locator(`.message.sent .message-content:has-text("${userMessageText}")`)).toBeVisible();

        // 2. 等待 AI 回复 (正在思考... -> 实际回复)
        const thinkingMessage = page.locator(`.message.system:has-text("${AI_CONTACT_NAME} 正在思考...")`);
        await expect(thinkingMessage).toBeVisible({ timeout: 3000 });
        await expect(thinkingMessage).toBeHidden({ timeout: 30000 }); // AI 响应时间

        // 3. 定位 AI 的回复消息元素
        // AI 的回复会有一个特定的 class `character-message` 和 AI 的 ID
        const aiMessageElement = page.locator(`.message.received.character-message.${AI_CONTACT_ID}`).last(); // 取最新的一条
        await expect(aiMessageElement).toBeVisible({ timeout: 5000 });

        // 4. 验证 TTS 加载指示器 (spinner) 出现
        // TTS 控件在 .message-content-wrapper 内部
        const ttsControlContainer = aiMessageElement.locator('.tts-control-container');
        await expect(ttsControlContainer).toBeVisible();
        const ttsLoadingSpinner = ttsControlContainer.locator('.tts-loading-spinner');
        await expect(ttsLoadingSpinner).toBeVisible({ timeout: 2000 }); // Spinner 应该很快出现

        // 5. 等待 TTS "完成" (spinner 消失，播放按钮出现)
        // 这取决于 TTS API 的响应速度和缓存情况
        await expect(ttsLoadingSpinner).toBeHidden({ timeout: 20000 }); // TTS API 响应时间
        const ttsPlayButton = ttsControlContainer.locator('button.tts-play-button');
        await expect(ttsPlayButton).toBeVisible({ timeout: 5000 }); // 播放按钮应该出现
        await expect(ttsPlayButton).toHaveAttribute('title', '播放/暂停语音');

        // 6. (可选) 点击播放按钮，验证其状态变化 (视觉上，如图标改变)
        //    MessageTtsHandler.js 中，播放时按钮会添加 'playing' 类，并改变伪元素内容
        //    我们可以检查 'playing' 类
        await ttsPlayButton.click();
        await expect(ttsPlayButton).toHaveClass(/playing/); // 检查是否添加了 playing 类
        // 再次点击暂停
        await ttsPlayButton.click();
        await expect(ttsPlayButton).not.toHaveClass(/playing/);
    });

    test('如果 TTS API 端点未配置，AI 回复后 TTS 控件应显示错误/重试', async ({ page }) => {
        // --- 前置：修改设置，使 TTS API 端点为空 ---
        await page.locator('#mainMenuBtn').click();
        const settingsModal = page.locator('#mainMenuModal');
        await expect(settingsModal).toBeVisible();
        const aiConfigHeader = settingsModal.locator('h3.collapsible-header:has-text("AI 与 API 配置")');
        const aiConfigContent = aiConfigHeader.locator('+ .collapsible-content');
        if (await aiConfigContent.isHidden()) {
            await aiConfigHeader.click();
        }
        const ttsApiEndpointInput = settingsModal.locator('#ttsApiEndpointInput');
        await ttsApiEndpointInput.fill(''); // 设置为空
        await settingsModal.locator('h2:has-text("菜单与设置")').click(); // 失焦保存
        await expect(page.locator('.notification.notification-success:has-text("TtsApiEndpoint 设置已保存。")')).toBeVisible();
        await settingsModal.locator('.close-modal-btn').click();
        await expect(settingsModal).toBeHidden();
        // --- 前置结束 ---

        const userMessageText = `Paimon，这次 TTS 会失败吗？`;
        const messageInput = page.locator('#messageInput');

        // 1. 发送消息给 AI
        await messageInput.fill(userMessageText);
        await page.locator('#sendButtonMain').click();

        // 2. 等待 AI 回复
        const thinkingMessage = page.locator(`.message.system:has-text("${AI_CONTACT_NAME} 正在思考...")`);
        await expect(thinkingMessage).toBeHidden({ timeout: 30000 });
        const aiMessageElement = page.locator(`.message.received.character-message.${AI_CONTACT_ID}`).last();
        await expect(aiMessageElement).toBeVisible({ timeout: 5000 });

        // 3. 验证 TTS 控件显示错误/重试状态
        const ttsControlContainer = aiMessageElement.locator('.tts-control-container');
        await expect(ttsControlContainer).toBeVisible();
        const ttsRetryButton = ttsControlContainer.locator('button.tts-retry-button');
        await expect(ttsRetryButton).toBeVisible({ timeout: 5000 }); // 错误状态应该很快出现
        await expect(ttsRetryButton).toHaveText('⚠️');
        await expect(ttsRetryButton).toHaveAttribute('title', /TTS 错误: TTS 端点未配置/); // 验证 title 包含错误信息

        // 4. （可选）测试重试按钮点击后的行为（如果实现了点击后重新请求逻辑）
        //     这里因为我们知道端点是空的，重试应该还是失败
        await ttsRetryButton.click();
        const ttsLoadingSpinner = ttsControlContainer.locator('.tts-loading-spinner');
        await expect(ttsLoadingSpinner).toBeVisible({ timeout: 1000 }); // 点击重试后应显示加载
        await expect(ttsLoadingSpinner).toBeHidden({ timeout: 5000 }); // 应该快速再次失败
        await expect(ttsRetryButton).toBeVisible(); // 重试按钮再次出现

        // --- 后置：恢复 TTS API 端点设置（如果需要，或者测试独立运行）---
        // 为了测试的独立性，最好在 afterEach 中恢复，或者在测试开始前确保是默认值。
        // 此处省略恢复步骤，假设测试各自独立。
    });
});