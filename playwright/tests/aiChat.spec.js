// tests/aiChat.spec.js
const { test, expect } = require('@playwright/test');

test.describe('AI 聊天功能', () => {
    const DEFAULT_AI_CONTACT_ID = 'AI_Kazuha_原神'; // 假设这是默认主题中的一个AI
    const DEFAULT_AI_CONTACT_NAME = '枫原万叶';

    test.beforeEach(async ({ page }) => {
        await page.goto('/');
        await expect(page.locator('#connectionStatusText')).toContainText(/初始化完成，准备连接|用户注册成功|信令服务器已连接|已从本地加载|使用现有id/, { timeout: 20000 });

        // 确保默认AI联系人 Kazuha 在列表中可见
        const defaultAiContactInList = page.locator(`#chatListNav li[data-id="${DEFAULT_AI_CONTACT_ID}"] .chat-list-name:has-text("${DEFAULT_AI_CONTACT_NAME}")`);
        await expect(defaultAiContactInList).toBeVisible({ timeout: 10000 }); // 等待AI联系人加载
    });

    test('应该能够向AI联系人发送消息并接收回复', async ({ page }) => {
        // 1. 点击AI联系人
        await page.locator(`#chatListNav li[data-id="${DEFAULT_AI_CONTACT_ID}"]`).click();

        // 2. 验证聊天头部已更新
        const chatHeaderTitle = page.locator('#currentChatTitleMain');
        await expect(chatHeaderTitle).toHaveText(DEFAULT_AI_CONTACT_NAME);
        const chatHeaderStatus = page.locator('#currentChatStatusMain');
        await expect(chatHeaderStatus).toContainText('AI 助手'); // 确认状态是AI助手

        // 3. 获取消息输入框并启用它
        const messageInput = page.locator('#messageInput');
        await expect(messageInput).toBeEnabled();

        // 4. 输入消息并发送
        const userMessageText = `你好, ${DEFAULT_AI_CONTACT_NAME}!`;
        await messageInput.fill(userMessageText);
        await page.locator('#sendButtonMain').click();

        // 5. 验证用户消息已显示在聊天框
        const userMessageInChat = page.locator(`.message.sent .message-content:has-text("${userMessageText}")`);
        await expect(userMessageInChat).toBeVisible();
        await expect(messageInput).toHaveValue(''); // 输入框应清空

        // 6. 验证AI“正在思考...”消息出现
        const thinkingMessage = page.locator(`.message.system:has-text("${DEFAULT_AI_CONTACT_NAME} 正在思考...")`);
        await expect(thinkingMessage).toBeVisible({ timeout: 30000 });

        // 7. 等待AI的回复
        // “正在思考”消息应该消失
        await expect(thinkingMessage).toBeHidden({ timeout: 30000 }); // 给AI足够的时间响应

        const aiResponseMessage = page.locator(`.message.received.character-message.${DEFAULT_AI_CONTACT_ID} .message-content`);
        await expect(aiResponseMessage).toBeVisible({ timeout: 5000 }); // AI回复应该可见
        const aiResponseText = await aiResponseMessage.textContent();
        expect(aiResponseText.trim()).not.toBe(''); // 回复不应为空
        expect(aiResponseText.trim()).not.toMatch(/抱歉，发生了一个错误/); // 不应是错误消息
        expect(aiResponseText.trim()).not.toBe('▍'); // 不应只是流式光标

        console.log(`AI (${DEFAULT_AI_CONTACT_NAME}) 回复: ${aiResponseText.substring(0, 50)}...`);
    });

    test('AI应该在群聊中对@提及做出响应', async ({ page }) => {
        const groupName = `测试群聊_AI提及_${Date.now()}`;
        const aiMentionMessageText = `@${DEFAULT_AI_CONTACT_NAME} 你在群里吗？`;

        // 1. 创建一个新的群组
        await page.locator('#newChatFab').click(); // 打开新建联系人/群组模态框
        await page.locator('#newGroupNameInput').fill(groupName);
        await page.locator('#confirmNewGroupBtnModal').click(); // 确认创建群组
        await expect(page.locator(`#chatListNav .chat-list-item .chat-list-name:has-text("${groupName}")`)).toBeVisible({ timeout: 5000 });

        // 2. 打开新创建的群组
        await page.locator(`#chatListNav .chat-list-item .chat-list-name:has-text("${groupName}")`).click();
        await expect(page.locator('#currentChatTitleMain')).toHaveText(groupName);

        // 3. 将AI添加到群组
        await page.locator('#chatDetailsBtnMain').click(); // 打开详情面板
        await expect(page.locator('#detailsPanel')).toBeVisible();
        const contactsDropdown = page.locator('#contactsDropdownDetails');
        await contactsDropdown.selectOption({ value: DEFAULT_AI_CONTACT_ID }); // 通过value选择AI
        await page.locator('#addMemberBtnDetails').click();

        // 验证顶部成功通知
        const successNotification = page.locator(`.notification-container .notification.notification-success .notification-message:has-text("${DEFAULT_AI_CONTACT_NAME} 已被添加到群组。")`);
        await expect(successNotification).toBeVisible({ timeout: 3000 }); // 给通知一点时间出现

        // 验证AI是否已添加到成员列表 (在详情面板中)
        const memberListDetails = page.locator('#groupMemberListDetails');
        // 检查成员列表中是否有包含AI名称的项
        await expect(memberListDetails.locator(`.member-item-detail:has-text("${DEFAULT_AI_CONTACT_NAME}")`)).toBeVisible({ timeout: 5000 });
        // (可选) 检查群聊中的系统消息，提示AI已加入
        // await expect(page.locator(`.message.user .message-content:has-text("${DEFAULT_AI_CONTACT_NAME} 加入了群聊")`)).toBeVisible({ timeout: 5000 });

        // 4. 在群聊中发送提及AI的消息
        const messageInput = page.locator('#messageInput');
        await expect(messageInput).toBeEnabled();
        await messageInput.fill(aiMentionMessageText);
        await page.locator('#sendButtonMain').click();

        // 5. 验证用户消息已显示
        const userMentionMessageInChat = page.locator(`.message.sent .message-content:has-text("${aiMentionMessageText}")`);
        await expect(userMentionMessageInChat).toBeVisible();

        // 6. 验证AI“正在思考...”消息出现 (群聊版本)
        const groupThinkingMessage = page.locator(`.message.system:has-text("${DEFAULT_AI_CONTACT_NAME} (在群组 ${groupName} 中) 正在思考...")`);
        await expect(groupThinkingMessage).toBeVisible({ timeout: 30000 });

        // 7. 等待AI的回复
        await expect(groupThinkingMessage).toBeHidden({ timeout: 30000 }); // 给AI足够的时间响应

        // AI的回复应该可见，并且发送者应该是AI
        const groupAiResponseMessage = page.locator(`.message.received[data-sender-id="${DEFAULT_AI_CONTACT_ID}"] .message-content`);
        await expect(groupAiResponseMessage).toBeVisible({ timeout: 5000 });

        const groupAiResponseText = await groupAiResponseMessage.textContent();
        expect(groupAiResponseText.trim()).not.toBe('');
        expect(groupAiResponseText.trim()).not.toMatch(/抱歉，我(?:在群组.*中回复时)?遇到了问题/);
        expect(groupAiResponseText.trim()).not.toBe('▍');

        console.log(`群聊中AI (${DEFAULT_AI_CONTACT_NAME}) 对提及的回复: ${groupAiResponseText.substring(0, 50)}...`);

    });
});