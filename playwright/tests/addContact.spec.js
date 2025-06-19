// tests/addContact.spec.js
const { test, expect } = require('@playwright/test');

test.describe('添加新联系人功能', () => {
    // 在每个测试用例开始前，导航到应用的首页
    // 假设您的应用在本地通过 http-server 或类似工具运行在某个端口，
    // 并且您已在 playwright.config.js 中设置了 baseURL
    // 如果没有设置 baseURL，请使用 page.goto('http://localhost:PORT_NUMBER/');
    test.beforeEach(async ({ page }) => {
        await page.goto('/'); // 导航到 baseURL
        // 等待应用核心部分加载完成，例如等待 noChatSelectedScreen 中的文本出现
        // 这是为了确保 AppInitializer.js 已经运行完毕
        await expect(page.locator('#connectionStatusText')).toContainText(/初始化完成，准备连接|用户注册成功|信令服务器已连接|已从本地加载|使用现有id/, { timeout: 20000 }); // 增加超时
    });

    test('应该能够通过模态框成功添加一个新联系人', async ({ page }) => {
        // 1. 定位并点击 "新聊天/群组" FAB 按钮
        const newChatFab = page.locator('#newChatFab');
        await expect(newChatFab).toBeVisible(); // 确保按钮可见
        await newChatFab.click();

        // 2. 断言 "新建联系人/群组" 模态框已出现
        const newContactModal = page.locator('#newContactGroupModal');
        await expect(newContactModal).toBeVisible();
        await expect(newContactModal.locator('h2')).toHaveText('管理联系人与群组');

        // 3. 在 "对方 ID" 输入框中输入内容
        const peerIdInput = newContactModal.locator('#newPeerIdInput');
        await peerIdInput.fill('test_user_001');
        await expect(peerIdInput).toHaveValue('test_user_001');

        // 4. 在 "对方昵称" 输入框中输入内容
        const peerNameInput = newContactModal.locator('#newPeerNameInput');
        await peerNameInput.fill('测试联系人');
        await expect(peerNameInput).toHaveValue('测试联系人');

        // 5. 点击 "添加 / 修改联系人" 按钮
        const confirmButton = newContactModal.locator('#confirmNewContactBtn');
        await confirmButton.click();

        // 6. 断言模态框已关闭/隐藏
        // Playwright 的 toHaveAttribute 和 toBeHidden/toBeVisible 都有自动等待机制
        await expect(newContactModal).toBeHidden();

        // 7. 断言成功通知出现并包含正确文本
        // 通知是动态添加和移除的，所以需要等待其出现
        const successNotification = page.locator('.notification.notification-success');
        await expect(successNotification).toBeVisible({ timeout: 5000 }); // 等待通知出现
        await expect(successNotification.locator('.notification-message')).toHaveText('联系人 "测试联系人" 已添加。');

        // 8. (可选) 断言通知在一段时间后消失
        // NotificationUIManager.js 中设置的消失时间是 5000ms (error 是 8000ms) + 300ms 动画
        await expect(successNotification).toBeHidden({ timeout: 6000 }); // 总共等待约 6 秒
    });

    test('尝试添加自己为联系人时应显示错误', async ({ page }) => {
        // 获取当前用户的 ID，这里我们假设可以通过某种方式获取
        // 在实际测试中，如果用户 ID 是动态生成的，这会比较复杂
        // 为了简化，我们先从 SettingsUIManager 的 UI 获取（如果已显示）
        // 或者，如果 UserManager.userId 是全局可访问的，可以从那里获取
        // 但在测试环境中，直接访问应用内部变量通常不推荐
        // 另一种方法是让应用在某个地方显示用户ID（例如设置菜单），然后从那里读取

        // 假设在 AppInitializer 后，ID已在 #modalUserIdValue 中
        const userIdSpan = page.locator('#modalUserIdValue');
        const currentUserId = await userIdSpan.textContent();
        expect(currentUserId).not.toBe('生成中...'); // 确保ID已生成

        // 打开模态框
        await page.locator('#newChatFab').click();
        const newContactModal = page.locator('#newContactGroupModal');
        await expect(newContactModal).toBeVisible();

        // 输入当前用户的ID
        await newContactModal.locator('#newPeerIdInput').fill(currentUserId);
        await newContactModal.locator('#newPeerNameInput').fill('我自己');

        // 点击确认
        await newContactModal.locator('#confirmNewContactBtn').click();

        // 断言错误通知出现
        const errorNotification = page.locator('.notification.notification-error');
        await expect(errorNotification).toBeVisible({ timeout: 5000 });
        await expect(errorNotification.locator('.notification-message')).toHaveText('您不能添加自己为联系人。');

        // 断言模态框仍然可见 (因为添加失败，模态框不应关闭)
        await expect(newContactModal).toBeVisible();

        // 关闭模态框以清理状态
        await newContactModal.locator('.close-modal-btn').click();
        await expect(newContactModal).toBeHidden();
    });
});