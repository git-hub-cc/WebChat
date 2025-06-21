// tests/clearChatHistory.spec.js
const { test, expect } = require('@playwright/test');

test.describe('清空聊天记录功能', () => {
    // 定义测试中使用的常量
    const AI_CONTACT_ID = 'AI_Kazuha_原神';
    const AI_CONTACT_NAME = '枫原万叶';
    const PLACEHOLDER_TEXT_AFTER_CLEAR = `与 ${AI_CONTACT_NAME} 开始对话吧！`; // ChatAreaUIManager 中为特殊联系人清空后的占位文本

    // 在每个测试用例前执行
    test.beforeEach(async ({ page }) => {
        // 导航到应用首页
        await page.goto('/');
        // 等待应用初始化完成
        await expect(page.locator('#connectionStatusText')).toContainText(/初始化完成，准备连接|用户注册成功|信令服务器已连接|已从本地加载|使用现有id/, { timeout: 20000 });

        // 点击AI联系人 Kazuha，打开聊天
        const kazuhaContactInList = page.locator(`#chatListNav li[data-id="${AI_CONTACT_ID}"] .chat-list-name:has-text("${AI_CONTACT_NAME}")`);
        await expect(kazuhaContactInList).toBeVisible({ timeout: 10000 });
        await page.locator(`#chatListNav li[data-id="${AI_CONTACT_ID}"]`).click();
        // 确认聊天头部已更新为 Kazuha
        await expect(page.locator('#currentChatTitleMain')).toHaveText(AI_CONTACT_NAME);
    });

    test('用户应该能够清空当前AI聊天的消息记录', async ({ page }) => {
        // 1. 获取消息输入框
        const messageInput = page.locator('#messageInput');
        await expect(messageInput).toBeEnabled();

        // 2. 发送两条测试消息
        const message1Text = `测试消息1 - ${Date.now()}`;
        const message2Text = `测试消息2 - ${Date.now()}`;

        await messageInput.fill(message1Text);
        await page.locator('#sendButtonMain').click();
        await expect(page.locator(`.message.sent .message-content:has-text("${message1Text}")`)).toBeVisible();

        // 等待AI可能的回应（不验证内容，只确保对话流程继续）
        let thinkingMessage = page.locator(`.message.system:has-text("${AI_CONTACT_NAME} 正在思考...")`);
        if (await thinkingMessage.isVisible({timeout: 1000})) {
            await expect(thinkingMessage).toBeHidden({ timeout: 30000 }); // 等AI回应完
        }

        await messageInput.fill(message2Text);
        await page.locator('#sendButtonMain').click();
        await expect(page.locator(`.message.sent .message-content:has-text("${message2Text}")`)).toBeVisible();

        thinkingMessage = page.locator(`.message.system:has-text("${AI_CONTACT_NAME} 正在思考...")`);
        if (await thinkingMessage.isVisible({timeout: 1000})) {
            await expect(thinkingMessage).toBeHidden({ timeout: 30000 }); // 等AI回应完
        }

        // 3. 打开详情面板
        await page.locator('#chatDetailsBtnMain').click();
        const detailsPanel = page.locator('#detailsPanel');
        await expect(detailsPanel).toBeVisible();

        // 4. 点击 "清空聊天记录" 按钮
        const clearChatButton = detailsPanel.locator('#clearCurrentChatBtnDetails');
        await expect(clearChatButton).toBeVisible();
        await expect(clearChatButton).toBeEnabled();
        await clearChatButton.click();

        // 5. 断言确认模态框已出现
        const confirmationModal = page.locator('#genericConfirmationModal');
        await expect(confirmationModal).toBeVisible();
        // 6. 验证确认消息内容
        await expect(confirmationModal.locator('.modal-body p')).toHaveText('您确定要清空此聊天中的消息吗？此操作无法撤销。');

        // 7. 点击确认模态框中的 "确认" 按钮
        //    注意：确认按钮的文本可能是动态的，但class通常是固定的（如 btn-danger）
        await confirmationModal.locator('button.btn-danger:has-text("确认")').click();

        // 8. 断言确认模态框已隐藏
        await expect(confirmationModal).toBeHidden();

        // 9. 断言成功清空的通知出现
        const successNotification = page.locator('.notification.notification-success');
        await expect(successNotification).toBeVisible({ timeout: 5000 });
        await expect(successNotification.locator('.notification-message')).toHaveText('聊天记录已清空。');

        // 10. 验证聊天框现在显示的是占位文本 (对于AI联系人)
        const chatBox = page.locator('#chatBox');
        const placeholderMessage = chatBox.locator(`.system-message:has-text("${PLACEHOLDER_TEXT_AFTER_CLEAR}")`);
        await expect(placeholderMessage).toBeVisible();

        // 11. 验证之前发送的消息不再可见
        await expect(page.locator(`.message.sent .message-content:has-text("${message1Text}")`)).toBeHidden();
        await expect(page.locator(`.message.sent .message-content:has-text("${message2Text}")`)).toBeHidden();

        // 12. 关闭详情面板
        await page.locator('#closeDetailsBtnMain').click();
        await expect(detailsPanel).toBeHidden();
    });
});