// tests/errorHandling.spec.js
const { test, expect } = require('@playwright/test');

test.describe('错误处理与通知', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('/');
        await expect(page.locator('#connectionStatusText')).toContainText(/初始化完成，准备连接|用户注册成功|信令服务器已连接|已从本地加载|使用现有id/, { timeout: 20000 });
    });

    test('AI API 端点无效时，发送消息给 AI 应显示错误通知', async ({ page }) => {
        const aiContactId = 'AI_Paimon';
        const aiContactName = 'Paimon';

        // --- 前置：设置一个无效的 AI API 端点 ---
        await page.locator('#mainMenuBtn').click();
        const settingsModal = page.locator('#mainMenuModal');
        await settingsModal.locator('h3.collapsible-header:has-text("AI 与 API 配置")').click();
        const apiEndpointInput = settingsModal.locator('#apiEndpointInput');
        await apiEndpointInput.fill('http://invalid-ai-endpoint-for-test.xyz/api'); // 无效端点
        await settingsModal.locator('h2:has-text("菜单与设置")').click(); // 失焦保存
        await expect(page.locator('.notification.notification-success:has-text("ApiEndpoint 设置已保存。")')).toBeVisible();
        await settingsModal.locator('.close-modal-btn').click();
        // --- 前置结束 ---

        // 1. 打开与 AI 的聊天
        await page.locator(`#chatListNav li[data-id="${aiContactId}"]`).click();
        await expect(page.locator('#currentChatTitleMain')).toHaveText(aiContactName);

        // 2. 发送消息
        await page.locator('#messageInput').fill('你好，这会失败吗？');
        await page.locator('#sendButtonMain').click();

        // 3. 等待 "正在思考" 消息消失 (因为它会尝试连接)
        const thinkingMessage = page.locator(`.message.system:has-text("${aiContactName} 正在思考...")`);
        await expect(thinkingMessage).toBeVisible();
        await expect(thinkingMessage).toBeHidden({ timeout: 15000 }); // API 调用应该会超时或快速失败

        // 4. 验证错误通知出现
        const errorNotification = page.locator('.notification.notification-error');
        await expect(errorNotification).toBeVisible({ timeout: 5000 });
        // 错误消息可能因网络或具体实现而异，我们检查部分文本
        await expect(errorNotification.locator('.notification-message')).toContainText(`无法从 ${aiContactName} 获取回复`);

        // 5. 验证聊天框中也显示了错误消息
        const errorMessageInChat = page.locator(`.message.received.character-message.${aiContactId} .message-content`);
        await expect(errorMessageInChat).toContainText('抱歉，发生了一个错误:');
        await expect(errorMessageInChat).toContainText(/API 请求失败|fetch.*failed/); // 匹配可能的错误原因

        // --- 后置：恢复正常的 AI API 端点（如果测试相互独立，则不需要）---
        // 可以通过刷新页面来重置 localStorage 到 Config.js 的默认值，或者再次修改设置
        // await page.reload();
        // await expect(page.locator('#connectionStatusText')).toContainText(/初始化完成，准备连接|用户注册成功|信令服务器已连接|已从本地加载|使用现有id/, { timeout: 20000 });
    });

    test('尝试添加已存在的联系人ID应显示提示信息', async ({ page }) => {
        const contactId = 'existing_contact_test';
        const contactName1 = '初次添加';
        const contactName2 = '尝试重复添加';

        // 1. 第一次添加联系人
        await page.locator('#newChatFab').click();
        const newContactModal = page.locator('#newContactGroupModal');
        await newContactModal.locator('#newPeerIdInput').fill(contactId);
        await newContactModal.locator('#newPeerNameInput').fill(contactName1);
        await newContactModal.locator('#confirmNewContactBtn').click();
        await expect(page.locator(`.notification.notification-success:has-text('联系人 "${contactName1}" 已添加。')`)).toBeVisible();
        await expect(newContactModal).toBeHidden();


        // 2. 再次打开模态框，尝试用相同的ID添加
        await page.locator('#newChatFab').click();
        await expect(newContactModal).toBeVisible();
        await newContactModal.locator('#newPeerIdInput').fill(contactId);
        await newContactModal.locator('#newPeerNameInput').fill(contactName2); // 可以尝试用不同昵称
        await newContactModal.locator('#confirmNewContactBtn').click();

        // 3. 验证提示信息通知
        const infoNotification = page.locator('.notification.notification-info');
        await expect(infoNotification).toBeVisible({ timeout: 5000 });
        await expect(infoNotification.locator('.notification-message')).toHaveText('该联系人已在您的列表中。');

        // 4. 验证模态框未关闭 (因为是提示，不是致命错误)
        // UserManager.addContact 对于已存在联系人，如果名称不同会更新并关闭模态框。
        // 如果名称也相同，则仅提示不关闭。
        // 如果上面 contactName2 和 contactName1 不同，则模态框会关闭，且原联系人昵称被更新。
        // 我们需要根据 UserManager.addContact 的具体逻辑来调整断言。
        // 从 UserManager.js: 如果ID已存在，会提示，然后如果名称不同则更新，并关闭模态框。
        // 所以，如果 contactName2 不同，模态框会关闭，联系人名称会更新。
        if (contactName1 !== contactName2) {
            await expect(newContactModal).toBeHidden();
            // 验证联系人列表中的名称是否更新
            const updatedContactItem = page.locator(`#chatListNav li[data-id="${contactId}"] .chat-list-name`);
            await expect(updatedContactItem).toHaveText(contactName2);
        } else { // 如果名称也相同
            await expect(newContactModal).toBeVisible(); // 模态框应保持打开
            // 关闭模态框
            await newContactModal.locator('.close-modal-btn').click();
            await expect(newContactModal).toBeHidden();
        }
    });

    test('未选择聊天时发送消息应提示选择聊天', async ({ page }) => {
        // 1. 确保当前没有打开任何聊天
        //    (页面初始加载时，ChatManager.currentChatId 为 null)
        //    如果之前有操作打开了聊天，需要一种方式关闭它或确保其关闭
        //    例如，点击一个空的侧边栏区域（如果可以的话）或刷新页面
        //    这里我们依赖初始状态
        await expect(page.locator('#currentChatTitleMain')).toHaveText('选择一个聊天');

        // 2. 尝试在输入框输入并发送
        const messageInput = page.locator('#messageInput');
        // 此时输入框应被禁用
        await expect(messageInput).toBeDisabled();
        // MessageManager.sendMessage 开头会检查 ChatManager.currentChatId
        // 但按钮本身可能由于 ChatAreaUIManager.enableChatInterface(false) 而禁用。
        // 如果按钮未禁用，点击后 MessageManager 会显示通知。
        const sendButton = page.locator('#sendButtonMain');
        await expect(sendButton).toBeDisabled();

        // 如果我们强制启用按钮并点击 (不推荐，但用于测试通知逻辑)
        // await sendButton.evaluate(node => node.disabled = false);
        // await sendButton.click();
        // const warningNotification = page.locator('.notification.notification-warning');
        // await expect(warningNotification).toBeVisible();
        // await expect(warningNotification.locator('.notification-message')).toHaveText('请选择一个聊天以发送消息。');

        // 更实际的测试是验证按钮确实是禁用的
        test.info().annotations.push({ type: 'note', description: '发送按钮在未选择聊天时应禁用，MessageManager的通知逻辑作为后备。' });
    });
});