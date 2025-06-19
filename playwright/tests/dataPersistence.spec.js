// tests/dataPersistence.spec.js
const { test, expect } = require('@playwright/test');

test.describe('数据持久化功能 (LocalStorage 和 IndexedDB)', () => {

    test.beforeEach(async ({ page }) => {
        // 清理 localStorage 和 IndexedDB 以确保测试的独立性
        // 注意：直接操作 IndexedDB 比较复杂，通常在测试前通过应用提供的“清除数据”功能来完成。
        // 如果应用没有该功能，可以考虑在测试环境中每次运行前删除 IndexedDB 文件（如果可能）。
        // Playwright 本身不直接提供清空 IndexedDB 的 API。
        // 我们这里会尝试清空 localStorage，并假设 IndexedDB 是干净的或由 AppInitializer 处理。
        await page.evaluate(() => localStorage.clear());
        await page.goto('/');
        await expect(page.locator('#connectionStatusText')).toContainText(/初始化完成，准备连接|用户注册成功|信令服务器已连接|已从本地加载|使用现有id/, { timeout: 20000 });
    });

    test('修改AI设置后刷新页面，设置应被保留', async ({ page }) => {
        const testApiKey = `test_api_key_${Date.now()}`;
        const testModel = `test_model_${Date.now()}`;

        // 1. 打开设置模态框并修改AI API密钥和模型
        await page.locator('#mainMenuBtn').click();
        const settingsModal = page.locator('#mainMenuModal');
        await settingsModal.locator('h3.collapsible-header:has-text("AI 与 API 配置")').click();
        const apiKeyInput = settingsModal.locator('#apiKeyInput');
        const modelInput = settingsModal.locator('#apiModelInput');

        await apiKeyInput.fill(testApiKey);
        await modelInput.fill(testModel);

        // 使输入框失焦以保存
        await settingsModal.locator('h2:has-text("菜单与设置")').click();
        await expect(page.locator('.notification.notification-success:has-text("Api_key 设置已保存。")')).toBeVisible();
        await expect(page.locator('.notification.notification-success:has-text("Model 设置已保存。")')).toBeVisible(); // 等待两个通知
        await settingsModal.locator('.close-modal-btn').click();

        // 2. 刷新页面
        await page.reload();
        // 等待应用重新初始化
        await expect(page.locator('#connectionStatusText')).toContainText(/初始化完成，准备连接|用户注册成功|信令服务器已连接|已从本地加载|使用现有id/, { timeout: 20000 });


        // 3. 再次打开设置模态框，验证设置是否被保留
        await page.locator('#mainMenuBtn').click();
        await settingsModal.locator('h3.collapsible-header:has-text("AI 与 API 配置")').click();

        await expect(settingsModal.locator('#apiKeyInput')).toHaveValue(testApiKey);
        await expect(settingsModal.locator('#apiModelInput')).toHaveValue(testModel);

        // 清理
        await settingsModal.locator('.close-modal-btn').click();
    });

    test('添加联系人后刷新页面，联系人应被保留', async ({ page }) => {
        const contactId = `persist_user_${Date.now()}`;
        const contactName = '持久化测试用户';

        // 1. 添加一个新联系人
        await page.locator('#newChatFab').click();
        const newContactModal = page.locator('#newContactGroupModal');
        await newContactModal.locator('#newPeerIdInput').fill(contactId);
        await newContactModal.locator('#newPeerNameInput').fill(contactName);
        await newContactModal.locator('#confirmNewContactBtn').click();
        await expect(page.locator(`.notification.notification-success:has-text('联系人 "${contactName}" 已添加。')`)).toBeVisible();
        await expect(newContactModal).toBeHidden();


        // 2. 验证联系人出现在列表中
        const contactInListInitially = page.locator(`#chatListNav li[data-id="${contactId}"] .chat-list-name:has-text("${contactName}")`);
        await expect(contactInListInitially).toBeVisible();

        // 3. 刷新页面
        await page.reload();
        await expect(page.locator('#connectionStatusText')).toContainText(/初始化完成，准备连接|用户注册成功|信令服务器已连接|已从本地加载|使用现有id/, { timeout: 20000 });


        // 4. 验证联系人仍然存在于列表中
        //    需要确保 ChatManager.renderChatList 完成
        //    通常，如果应用初始化完成，列表也会渲染完成
        const contactInListAfterReload = page.locator(`#chatListNav li[data-id="${contactId}"] .chat-list-name:has-text("${contactName}")`);
        await expect(contactInListAfterReload).toBeVisible({ timeout: 10000 }); // 增加等待时间，因为DB加载可能需要时间
    });

    test('发送消息后刷新页面，聊天记录应被保留', async ({ page }) => {
        const contactId = `chat_persist_user_${Date.now()}`;
        const contactName = '聊天记录持久化';
        const messageText1 = "这是第一条测试消息，应该被保存。";
        const messageText2 = "这是第二条测试消息，也应该被保存。";

        // 1. 添加联系人并打开聊天
        await page.locator('#newChatFab').click();
        const newContactModal = page.locator('#newContactGroupModal');
        await newContactModal.locator('#newPeerIdInput').fill(contactId);
        await newContactModal.locator('#newPeerNameInput').fill(contactName);
        await newContactModal.locator('#confirmNewContactBtn').click();
        await page.locator(`#chatListNav li[data-id="${contactId}"]`).click();
        await expect(page.locator('#currentChatTitleMain')).toHaveText(contactName);

        // 2. 发送两条消息
        const messageInput = page.locator('#messageInput');
        await messageInput.fill(messageText1);
        await page.locator('#sendButtonMain').click();
        await expect(page.locator(`.message.sent .message-content:has-text("${messageText1}")`)).toBeVisible();

        await messageInput.fill(messageText2);
        await page.locator('#sendButtonMain').click();
        await expect(page.locator(`.message.sent .message-content:has-text("${messageText2}")`)).toBeVisible();

        // 3. 刷新页面
        await page.reload();
        await expect(page.locator('#connectionStatusText')).toContainText(/初始化完成，准备连接|用户注册成功|信令服务器已连接|已从本地加载|使用现有id/, { timeout: 20000 });


        // 4. 重新打开与该联系人的聊天
        //    ChatManager.init 会加载聊天记录
        const contactListItem = page.locator(`#chatListNav li[data-id="${contactId}"]`);
        await expect(contactListItem).toBeVisible({timeout: 10000}); // 等待列表渲染
        await contactListItem.click();
        await expect(page.locator('#currentChatTitleMain')).toHaveText(contactName);

        // 5. 验证两条消息都存在于聊天框中
        //    ChatAreaUIManager._renderInitialMessageBatch 会加载最新的消息
        const chatBox = page.locator('#chatBox');
        await expect(chatBox.locator(`.message.sent .message-content:has-text("${messageText1}")`)).toBeVisible({ timeout: 5000 });
        await expect(chatBox.locator(`.message.sent .message-content:has-text("${messageText2}")`)).toBeVisible({ timeout: 5000 });

        // 6. 验证消息顺序 (如果需要，但通常显示顺序就是存储顺序)
        const messages = await chatBox.locator('.message.sent .message-content').allTextContents();
        // 假设是按时间顺序追加，那么 messageText1 应该在 messageText2 之前
        // 注意：这里获取的是所有 .sent 消息，如果测试更复杂，需要更精确的定位器
        const text1Index = messages.findIndex(msg => msg.includes(messageText1));
        const text2Index = messages.findIndex(msg => msg.includes(messageText2));
        expect(text1Index).not.toBe(-1);
        expect(text2Index).not.toBe(-1);
        expect(text1Index).toBeLessThan(text2Index);
    });
});