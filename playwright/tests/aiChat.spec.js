// tests/aiChat.spec.js
const { test, expect } = require('@playwright/test');

test.describe('AI 聊天功能', () => {
    const DEFAULT_AI_CONTACT_ID = 'AI_Paimon'; // 假设这是默认主题中的一个AI
    const DEFAULT_AI_CONTACT_NAME = 'Paimon';

    test.beforeEach(async ({ page }) => {
        await page.goto('/');
        await expect(page.locator('#connectionStatusText')).toContainText(/初始化完成，准备连接|用户注册成功|信令服务器已连接|已从本地加载|使用现有id/, { timeout: 20000 });

        // 确保默认AI联系人 Paimon 在列表中可见
        // ( UserManager.init 和 ThemeLoader.init 应该已经处理了这个)
        const paimonInList = page.locator(`#chatListNav li[data-id="${DEFAULT_AI_CONTACT_ID}"] .chat-list-name:has-text("${DEFAULT_AI_CONTACT_NAME}")`);
        await expect(paimonInList).toBeVisible({ timeout: 10000 }); // 等待AI联系人加载
    });

    test('应该能够向AI联系人发送消息并接收回复', async ({ page }) => {
        // 1. 点击AI联系人 "Paimon"
        await page.locator(`#chatListNav li[data-id="${DEFAULT_AI_CONTACT_ID}"]`).click();

        // 2. 验证聊天头部已更新为 "Paimon"
        const chatHeaderTitle = page.locator('#currentChatTitleMain');
        await expect(chatHeaderTitle).toHaveText(DEFAULT_AI_CONTACT_NAME);
        const chatHeaderStatus = page.locator('#currentChatStatusMain');
        await expect(chatHeaderStatus).toContainText('AI 助手'); // 状态可能包含 "服务可用" 或 "服务不可用"

        // 3. 获取消息输入框并启用它（如果 ChatManager.openChat 后未自动启用）
        const messageInput = page.locator('#messageInput');
        await expect(messageInput).toBeEnabled();

        // 4. 输入消息并发送
        const userMessageText = `你好, ${DEFAULT_AI_CONTACT_NAME}!`;
        await messageInput.fill(userMessageText);
        await page.locator('#sendButtonMain').click();

        // 5. 验证用户消息已显示在聊天框
        const userMessageInChat = page.locator(`.message.sent .message-content:has-text("${userMessageText}")`);
        await expect(userMessageInChat).toBeVisible();
        await expect(messageInput).toHaveValue(''); // 输入框应被清空

        // 6. 验证AI“正在思考...”消息出现
        const thinkingMessage = page.locator(`.message.system:has-text("${DEFAULT_AI_CONTACT_NAME} 正在思考...")`);
        await expect(thinkingMessage).toBeVisible({ timeout: 3000 });

        // 7. 等待AI的回复 (这可能需要较长时间，取决于API响应速度)
        //    AI的回复将是一个 .message.received.character-message.AI_Paimon 元素
        //    我们期望 "正在思考..." 消息消失，然后出现AI的回复
        await expect(thinkingMessage).toBeHidden({ timeout: 30000 }); // AI应该在30秒内回复

        const aiResponseMessage = page.locator(`.message.received.character-message.${DEFAULT_AI_CONTACT_ID} .message-content`);
        await expect(aiResponseMessage).toBeVisible({ timeout: 5000 }); // 等待回复出现
        const aiResponseText = await aiResponseMessage.textContent();
        expect(aiResponseText.trim()).not.toBe(''); // AI回复不应为空
        expect(aiResponseText.trim()).not.toMatch(/抱歉，发生了一个错误/); // 不应是错误消息
        expect(aiResponseText.trim()).not.toBe('▍'); // 不应只是流式光标

        Utils.log(`AI (${DEFAULT_AI_CONTACT_NAME}) 回复: ${aiResponseText.substring(0, 50)}...`, Utils.logLevels.INFO);
    });

    test('AI应该在群聊中对@提及做出响应', async ({ page }) => {
        const groupName = `AI提及测试群_${Date.now()}`;
        const aiContactIdToMention = DEFAULT_AI_CONTACT_ID;
        const aiContactNameToMention = DEFAULT_AI_CONTACT_NAME;
        const userMessageText = `你好呀 @${aiContactNameToMention}，今天天气怎么样？`;

        // --- 前置步骤: 创建一个群组并添加AI成员 ---
        await page.locator('#newChatFab').click();
        const newContactModal = page.locator('#newContactGroupModal');
        await newContactModal.locator('#newGroupNameInput').fill(groupName);
        await newContactModal.locator('#confirmNewGroupBtnModal').click();
        await expect(newContactModal).toBeHidden();
        await expect(page.locator(`.notification.notification-success:has-text("群组 \"${groupName}\" 已创建。")`)).toBeVisible();

        // 新群组应该已打开
        await expect(page.locator('#currentChatTitleMain')).toHaveText(groupName);
        const currentGroupId = await page.locator(`#chatListNav li.active[data-type="group"]`).getAttribute('data-id');

        // 打开群组详情面板添加AI
        await page.locator('#chatDetailsBtnMain').click();
        const detailsPanel = page.locator('#detailsPanel');
        await expect(detailsPanel).toBeVisible();
        const contactsDropdown = detailsPanel.locator('#contactsDropdownDetails');
        // 等待下拉列表被Paimon填充
        await expect(contactsDropdown.locator(`option:has-text("${aiContactNameToMention} (AI助手)")`)).toBeVisible({timeout: 5000});
        await contactsDropdown.selectOption({ label: `${aiContactNameToMention} (AI助手)` });
        await detailsPanel.locator('#addMemberBtnDetails').click();
        await expect(page.locator(`.notification.notification-success:has-text("${aiContactNameToMention} 已被添加到群组。")`)).toBeVisible();
        await detailsPanel.locator('#closeDetailsBtnMain').click();
        await expect(detailsPanel).toBeHidden();
        // --- 前置结束 ---

        // 1. 确保当前聊天是目标群组
        await page.locator(`#chatListNav li[data-id="${currentGroupId}"]`).click(); // 重新点击以确保
        await expect(page.locator('#currentChatTitleMain')).toHaveText(groupName);

        // 2. 输入包含@提及的消息并发送
        const messageInput = page.locator('#messageInput');
        await messageInput.fill(userMessageText);
        await page.locator('#sendButtonMain').click();

        // 3. 验证用户消息已显示
        const userMessageInChat = page.locator(`.message.sent .message-content:has-text("${userMessageText}")`);
        await expect(userMessageInChat).toBeVisible();
        await expect(messageInput).toHaveValue('');

        // 4. 验证AI“正在思考...”消息（群组特定）出现
        const thinkingMessage = page.locator(`.message.system:has-text("${aiContactNameToMention} (在群组 ${groupName} 中) 正在思考...")`);
        await expect(thinkingMessage).toBeVisible({ timeout: 5000 });

        // 5. 等待AI在群聊中的回复
        await expect(thinkingMessage).toBeHidden({ timeout: 45000 }); // 群聊AI回复可能稍慢

        // AI 的回复会有 .message.received 类，并且 sender 是 AI的ID
        // 并且会包含 AI 的名字作为发送者显示
        const aiGroupResponseMessage = page.locator(`.message.received[data-sender-id="${aiContactIdToMention}"] .message-content`);
        await expect(aiGroupResponseMessage).toBeVisible({ timeout: 10000 }); // 等待回复出现

        const aiResponseText = await aiGroupResponseMessage.textContent();
        expect(aiResponseText.trim()).not.toBe('');
        expect(aiResponseText.trim()).not.toMatch(/抱歉，我在群组 .* 中回复时遇到了问题/);
        expect(aiResponseText.trim()).not.toBe('▍');

        // 验证消息发送者名称是AI的名称
        const aiSenderNameElement = page.locator(`.message.received[data-sender-id="${aiContactIdToMention}"] .message-sender`);
        await expect(aiSenderNameElement).toHaveText(aiContactNameToMention);

        Utils.log(`群聊AI (${aiContactNameToMention}) 回复: ${aiResponseText.substring(0,50)}...`, Utils.logLevels.INFO);
    });
});