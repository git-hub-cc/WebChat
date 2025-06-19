// tests/messageContextMenu.spec.js
const { test, expect } = require('@playwright/test');

test.describe('消息上下文菜单功能', () => {
    let contactId;
    let contactName;

    test.beforeEach(async ({ page }) => {
        contactId = `context_menu_user_${Date.now()}`;
        contactName = '菜单测试对象';

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

    test('双击自己发送的消息应显示包含“删除”和“撤回”的上下文菜单', async ({ page }) => {
        const messageText = "双击测试这条消息";
        await page.locator('#messageInput').fill(messageText);
        await page.locator('#sendButtonMain').click();
        const sentMessage = page.locator(`.message.sent .message-content:has-text("${messageText}")`).locator('ancestor::div[contains(@class, "message")]');
        await expect(sentMessage).toBeVisible();

        // 双击消息
        await sentMessage.dblclick();

        // 验证上下文菜单
        const contextMenu = page.locator('#customMessageContextMenu');
        await expect(contextMenu).toBeVisible();
        await expect(contextMenu.locator('button:has-text("删除")')).toBeVisible();
        await expect(contextMenu.locator('button:has-text("撤回")')).toBeVisible(); // 撤回按钮应可见，因为消息是刚发送的
    });

    test('右键点击自己发送的消息应显示包含“删除”和“撤回”的上下文菜单', async ({ page }) => {
        const messageText = "右键测试这条消息";
        await page.locator('#messageInput').fill(messageText);
        await page.locator('#sendButtonMain').click();
        const sentMessage = page.locator(`.message.sent .message-content:has-text("${messageText}")`).locator('ancestor::div[contains(@class, "message")]');
        await expect(sentMessage).toBeVisible();

        // 右键点击消息
        await sentMessage.click({ button: 'right' });

        // 验证上下文菜单
        const contextMenu = page.locator('#customMessageContextMenu');
        await expect(contextMenu).toBeVisible();
        await expect(contextMenu.locator('button:has-text("删除")')).toBeVisible();
        await expect(contextMenu.locator('button:has-text("撤回")')).toBeVisible();
    });

    test('双击收到的消息应显示仅包含“删除”的上下文菜单', async ({ page }) => {
        // 模拟接收一条消息（这在端到端测试中比较困难，除非我们能控制另一个客户端或mock ConnectionManager）
        // 为了简化，我们手动在DOM中插入一条模拟的接收消息
        // 这不是最佳实践，但对于专注于测试上下文菜单的UI逻辑是可行的
        const receivedMessageText = "这是收到的测试消息";
        const messageId = `received_msg_${Date.now()}`;
        await page.evaluate(({ msgText, msgId, currentUserId }) => {
            const chatBox = document.getElementById('chatBox');
            if (chatBox) {
                const msgDiv = document.createElement('div');
                msgDiv.className = 'message received'; // 关键是 'received' 类
                msgDiv.setAttribute('data-message-id', msgId);
                msgDiv.setAttribute('data-sender-id', 'other_user_id'); // 确保 sender 不是当前用户
                msgDiv.setAttribute('data-timestamp', Date.now().toString());
                msgDiv.innerHTML = `
                    <div class="message-sender">对方</div>
                    <div class="message-content-wrapper">
                        <div class="message-content">${msgText}</div>
                    </div>
                    <div class="timestamp">${new Date().toLocaleTimeString()}</div>
                `;
                chatBox.appendChild(msgDiv);
            }
        }, { msgText: receivedMessageText, msgId: messageId, currentUserId: await page.evaluate(() => UserManager.userId) });

        const receivedMessage = page.locator(`.message.received[data-message-id="${messageId}"]`);
        await expect(receivedMessage).toBeVisible();

        // 双击收到的消息
        await receivedMessage.dblclick();

        // 验证上下文菜单
        const contextMenu = page.locator('#customMessageContextMenu');
        await expect(contextMenu).toBeVisible();
        await expect(contextMenu.locator('button:has-text("删除")')).toBeVisible();
        await expect(contextMenu.locator('button:has-text("撤回")')).toBeHidden(); // 撤回按钮不应出现
    });

    test('点击上下文菜单外部或按Escape键应关闭菜单', async ({ page }) => {
        const messageText = "测试关闭菜单";
        await page.locator('#messageInput').fill(messageText);
        await page.locator('#sendButtonMain').click();
        const sentMessage = page.locator(`.message.sent .message-content:has-text("${messageText}")`).locator('ancestor::div[contains(@class, "message")]');
        await expect(sentMessage).toBeVisible();

        // 打开菜单
        await sentMessage.dblclick();
        const contextMenu = page.locator('#customMessageContextMenu');
        await expect(contextMenu).toBeVisible();

        // 1. 测试点击外部关闭
        //    点击聊天区域的空白处（例如聊天框本身，但不是消息）
        const chatBox = page.locator('#chatBox');
        await chatBox.click({ position: { x: 1, y: 1 } }); // 点击聊天框的左上角
        await expect(contextMenu).toBeHidden();

        // 2. 重新打开菜单，测试按Escape键关闭
        await sentMessage.dblclick();
        await expect(contextMenu).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(contextMenu).toBeHidden();
    });

    test('上下文菜单应在3秒后自动隐藏', async ({ page }) => {
        // ChatAreaUIManager.CONTEXT_MENU_AUTOHIDE_DURATION 设置为 3000
        const messageText = "测试自动隐藏菜单";
        await page.locator('#messageInput').fill(messageText);
        await page.locator('#sendButtonMain').click();
        const sentMessage = page.locator(`.message.sent .message-content:has-text("${messageText}")`).locator('ancestor::div[contains(@class, "message")]');
        await expect(sentMessage).toBeVisible();

        // 打开菜单
        await sentMessage.dblclick();
        const contextMenu = page.locator('#customMessageContextMenu');
        await expect(contextMenu).toBeVisible();

        // 等待超过3秒，验证菜单是否隐藏
        await expect(contextMenu).toBeHidden({ timeout: 3500 }); // 略微增加超时以确保计时器触发
    });
});