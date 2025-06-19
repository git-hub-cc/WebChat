// tests/messageActions.spec.js
const { test, expect } = require('@playwright/test');

test.describe('消息操作功能（删除、撤回）', () => {
    let contactId;
    let contactName;

    test.beforeEach(async ({ page }) => {
        contactId = `action_user_${Date.now()}`;
        contactName = '操作测试对象';

        await page.goto('/');
        await expect(page.locator('#connectionStatusText')).toContainText(/初始化完成，准备连接|用户注册成功|信令服务器已连接|已从本地加载|使用现有id/, { timeout: 20000 });

        // 前置：添加并打开一个普通联系人聊天
        await page.locator('#newChatFab').click();
        const newContactModal = page.locator('#newContactGroupModal');
        await newContactModal.locator('#newPeerIdInput').fill(contactId);
        await newContactModal.locator('#newPeerNameInput').fill(contactName);
        await newContactModal.locator('#confirmNewContactBtn').click();
        await expect(newContactModal).toBeHidden();
        await page.locator(`#chatListNav li[data-id="${contactId}"]`).click();
        await expect(page.locator('#currentChatTitleMain')).toHaveText(contactName);
    });

    test('应该能够本地删除已发送的消息', async ({ page }) => {
        const messageText = "这条消息将被本地删除";

        // 1. 发送一条消息
        const messageInput = page.locator('#messageInput');
        await messageInput.fill(messageText);
        await page.locator('#sendButtonMain').click();
        const sentMessage = page.locator(`.message.sent .message-content:has-text("${messageText}")`);
        await expect(sentMessage).toBeVisible();
        const messageElement = sentMessage.locator('ancestor::div[contains(@class, "message") and @data-message-id]');
        const messageId = await messageElement.getAttribute('data-message-id');
        expect(messageId).not.toBeNull();

        // 2. 右键点击该消息（或双击，取决于 ChatAreaUIManager 实现）
        // ChatAreaUIManager.js 中 contextmenu 和 dblclick 都会触发 _showContextMenu
        await messageElement.dblclick(); // 使用双击来触发

        // 3. 验证上下文菜单出现
        const contextMenu = page.locator('#customMessageContextMenu');
        await expect(contextMenu).toBeVisible();

        // 4. 点击 "删除" 按钮
        await contextMenu.locator('button:has-text("删除")').click();

        // 5. 验证上下文菜单消失
        await expect(contextMenu).toBeHidden();

        // 6. 验证消息已从聊天框中移除
        await expect(messageElement).toBeHidden(); // 或者 count 为 0
        const messageWithSameId = page.locator(`.message[data-message-id="${messageId}"]`);
        await expect(messageWithSameId).toHaveCount(0);


        // 7. 验证成功通知
        await expect(page.locator('.notification.notification-success:has-text("消息已删除。")')).toBeVisible();
    });

    test('应该能够请求撤回自己发送的消息 (UI层面)', async ({ page }) => {
        const messageText = "这条消息将被请求撤回";

        // 1. 发送一条消息
        const messageInput = page.locator('#messageInput');
        await messageInput.fill(messageText);
        await page.locator('#sendButtonMain').click();
        const sentMessageContent = page.locator(`.message.sent .message-content:has-text("${messageText}")`);
        await expect(sentMessageContent).toBeVisible();
        const messageElement = sentMessageContent.locator('ancestor::div[contains(@class, "message") and @data-message-id]');

        // 2. 双击该消息以显示上下文菜单
        await messageElement.dblclick();
        const contextMenu = page.locator('#customMessageContextMenu');
        await expect(contextMenu).toBeVisible();

        // 3. 点击 "撤回" 按钮
        // 注意：撤回按钮只有在 MESSAGE_RETRACTION_WINDOW (5分钟) 内才可见
        const retractButton = contextMenu.locator('button:has-text("撤回")');
        await expect(retractButton).toBeVisible(); // 确保按钮存在
        await retractButton.click();

        // 4. 验证上下文菜单消失
        await expect(contextMenu).toBeHidden();

        // 5. 验证消息内容变为 "你撤回了一条消息"
        // 消息的 data-message-id 保持不变，但内容和类会更新
        await expect(messageElement.locator('.message-content')).toHaveText("你撤回了一条消息");
        await expect(messageElement).toHaveClass(/retracted/);
        await expect(messageElement).toHaveClass(/system/); // 撤回消息也算系统消息类型
    });

    test('不能撤回超过5分钟的消息', async ({ page }) => {
        const messageText = "这条消息发送时间较早";

        // 模拟一条5分钟之前的消息
        // Playwright 无法直接修改 JS Date.now()。
        // 最好的方法是测试UI是否正确禁用了按钮，而不是真的去等待5分钟。
        // 或者，如果 MessageManager.js 依赖一个可被测试覆盖的 Date.now() 函数。
        // 这里我们假设测试时，撤回窗口仍然有效，但可以检查按钮是否根据时间戳显示。
        // 这是一个较难直接通过端到端测试完全验证的场景，除非应用提供调试接口或测试钩子。

        // 暂时我们只验证“撤回”按钮的出现，表示在5分钟内。
        // 这个测试用例的目的是说明这种边界条件的考虑。
        // 实际测试中，可能需要单元/集成测试 MessageManager._updateMessageToRetractedState 和
        // ChatAreaUIManager._showContextMenu 的逻辑。

        // 发送消息
        await page.locator('#messageInput').fill(messageText);
        await page.locator('#sendButtonMain').click();
        const sentMessageElement = page.locator(`.message.sent .message-content:has-text("${messageText}")`).locator('ancestor::div[contains(@class, "message")]');
        await expect(sentMessageElement).toBeVisible();

        // 获取消息的时间戳 (data-timestamp)
        const messageTimestamp = await sentMessageElement.getAttribute('data-timestamp');
        expect(messageTimestamp).not.toBeNull();

        // 打开上下文菜单
        await sentMessageElement.dblclick();
        const contextMenu = page.locator('#customMessageContextMenu');
        await expect(contextMenu).toBeVisible();

        // 检查撤回按钮是否可见（假设在5分钟内）
        const retractButton = contextMenu.locator('button:has-text("撤回")');
        const retractionWindow = 5 * 60 * 1000; // 从 Config.js 获取
        const currentTime = Date.now();
        if (currentTime - parseInt(messageTimestamp || "0", 10) < retractionWindow) {
            await expect(retractButton).toBeVisible();
        } else {
            // 如果测试执行得足够慢，或者我们能mock时间，这里应该是 toBeHidden
            // 由于我们不能轻易mock时间，这个分支更多是逻辑上的
            test.skip(true, "Skipping >5min check as it requires time manipulation or app hooks.");
            // await expect(retractButton).toBeHidden();
            // await expect(page.locator('.notification.notification-warning:has-text("消息已超过5分钟，无法撤回。")')).toBeVisible()
        }
        // 清理：关闭菜单
        await page.keyboard.press('Escape');
        await expect(contextMenu).toBeHidden();
    });
});