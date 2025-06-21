// tests/messageDeletion.spec.js
const { test, expect } = require('@playwright/test');

test.describe('消息删除功能', () => {
    // 定义测试中使用的常量
    const AI_CONTACT_ID = 'AI_Kazuha_原神'; // 假设这是默认主题中的一个AI
    const AI_CONTACT_NAME = '枫原万叶';

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

    test('用户应该能够发送并删除自己发送的消息', async ({ page }) => {
        // 1. 获取消息输入框并输入测试消息
        const messageInput = page.locator('#messageInput');
        await expect(messageInput).toBeEnabled();
        const messageText = `这是一条要被删除的测试消息 - ${Date.now()}`;
        await messageInput.fill(messageText);

        // 2. 点击发送按钮
        await page.locator('#sendButtonMain').click();

        // 3. 验证用户发送的消息已显示在聊天框中
        const sentMessageLocator = page.locator(`.message.sent .message-content:has-text("${messageText}")`);
        await expect(sentMessageLocator).toBeVisible();

        // 4. 右键点击已发送的消息以打开上下文菜单
        //    注意：Playwright 的 rightClick() 会触发 contextmenu 事件
        await sentMessageLocator.click({ button: 'right' });

        // 5. 断言自定义上下文菜单已出现
        const contextMenu = page.locator('#customMessageContextMenu');
        await expect(contextMenu).toBeVisible();

        // 6. 断言菜单中存在 "删除" 按钮
        const deleteButton = contextMenu.locator('button:has-text("删除")');
        await expect(deleteButton).toBeVisible();

        // 7. 点击 "删除" 按钮
        await deleteButton.click();

        // 8. 断言上下文菜单已隐藏
        await expect(contextMenu).toBeHidden();

        // 9. 断言成功删除的通知出现
        const successNotification = page.locator('.notification.notification-success');
        await expect(successNotification).toBeVisible({ timeout: 5000 });
        await expect(successNotification.locator('.notification-message')).toHaveText('消息已删除。');

        // 10. 断言被删除的消息不再显示在聊天框中
        await expect(sentMessageLocator).toBeHidden();

        // 11. (可选) 验证AI的思考消息没有因为这条消息而触发 (因为是对AI的聊天，AI会响应)
        //     如果不想AI响应，应该选择一个普通联系人或在 beforeEach 中进行相应设置。
        //     这里我们简单地允许AI响应，并忽略它。
        const thinkingMessage = page.locator(`.message.system:has-text("${AI_CONTACT_NAME} 正在思考...")`);
        // 我们允许思考消息出现，但不等待其消失或AI回复，因为测试重点是删除
        if (await thinkingMessage.isVisible({ timeout: 500 })) {
            console.log("AI 正在思考，符合预期。");
        }
    });
});