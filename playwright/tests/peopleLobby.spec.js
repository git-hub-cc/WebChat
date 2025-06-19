// tests/peopleLobby.spec.js
const { test, expect } = require('@playwright/test');

test.describe('人员大厅功能', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('/');
        await expect(page.locator('#connectionStatusText')).toContainText(/初始化完成，准备连接|用户注册成功|信令服务器已连接|已从本地加载|使用现有id/, { timeout: 20000 });
    });

    test('应该能够打开人员大厅，看到刷新按钮，并点击用户项弹出添加联系人模态框', async ({ page }) => {
        const peopleLobbyButtonMain = page.locator('#peopleLobbyButtonMain');
        const detailsPanel = page.locator('#detailsPanel');
        const peopleLobbyContent = detailsPanel.locator('#peopleLobbyContent');

        // 1. 点击聊天头部的 "人员大厅" 按钮
        await expect(peopleLobbyButtonMain).toBeEnabled();
        await peopleLobbyButtonMain.click();

        // 2. 验证详情面板区域已显示，并且标题为 "人员大厅"
        await expect(detailsPanel).toBeVisible();
        await expect(detailsPanel.locator('#detailsPanelTitle')).toHaveText('人员大厅');
        await expect(peopleLobbyContent).toBeVisible();

        // 3. 验证刷新按钮存在
        const refreshButton = peopleLobbyContent.locator('#peopleLobbyRefreshBtn');
        await expect(refreshButton).toBeVisible();

        // 4. 等待在线用户列表加载（或显示空/加载中状态）
        // PeopleLobbyManager.show() 会自动调用 fetchOnlineUsers 和 renderLobby
        // 我们检查列表元素是否存在，并且是否有子项或者空消息
        const lobbyList = peopleLobbyContent.locator('#peopleLobbyList');
        await expect(lobbyList).toBeVisible();

        // 等待加载动画（如果有）消失，或者列表内容稳定
        // 由于API响应时间不定，我们等待一个标志性的状态：要么有用户，要么显示“无用户”
        const firstLobbyItem = lobbyList.locator('li.chat-list-item').first();
        const emptyLobbyMessage = lobbyList.locator('li.chat-list-item-empty:has-text("当前无其他在线用户。")');
        const loadingMessage = lobbyList.locator('li.chat-list-item-empty:has-text("正在加载在线用户...")');

        // 等待加载状态结束
        await expect(loadingMessage).toBeHidden({ timeout: 15000 }); // 等待加载完成

        const hasUsers = await firstLobbyItem.isVisible();
        if (hasUsers) {
            const firstUserId = await firstLobbyItem.getAttribute('data-id');
            expect(firstUserId).not.toBeNull();
            Utils.log(`人员大厅中第一个用户ID: ${firstUserId}`, Utils.logLevels.INFO);

            // 5. 点击大厅中的第一个用户项 (假设至少有一个其他用户在线)
            await firstLobbyItem.click();

            // 6. 验证 "新建联系人/群组" 模态框出现，并预填了该用户的ID
            const newContactModal = page.locator('#newContactGroupModal');
            await expect(newContactModal).toBeVisible();
            await expect(newContactModal.locator('#newPeerIdInput')).toHaveValue(firstUserId || '');
            await expect(newContactModal.locator('#newPeerNameInput')).toHaveValue(''); // 昵称应为空让用户填写
            await expect(newContactModal.locator('#newPeerNameInput')).toBeFocused();

            // 7. 关闭添加联系人模态框
            await newContactModal.locator('.close-modal-btn').click();
            await expect(newContactModal).toBeHidden();

        } else {
            // 如果没有用户，验证显示的是空消息
            await expect(emptyLobbyMessage).toBeVisible();
            Utils.log("人员大厅为空，跳过点击用户项的测试部分。", Utils.logLevels.INFO);
            test.info().annotations.push({ type: 'skip', description: '人员大厅为空，无法测试点击用户。' });
        }

        // 8. 关闭详情面板/人员大厅
        await detailsPanel.locator('#closeDetailsBtnMain').click();
        await expect(detailsPanel).toBeHidden();
    });

    test('点击人员大厅的刷新按钮应该尝试重新加载用户列表', async ({ page }) => {
        const peopleLobbyButtonMain = page.locator('#peopleLobbyButtonMain');
        const detailsPanel = page.locator('#detailsPanel');
        const peopleLobbyContent = detailsPanel.locator('#peopleLobbyContent');

        // 1. 打开人员大厅
        await peopleLobbyButtonMain.click();
        await expect(peopleLobbyContent).toBeVisible();
        const refreshButton = peopleLobbyContent.locator('#peopleLobbyRefreshBtn');
        const lobbyList = peopleLobbyContent.locator('#peopleLobbyList');

        // 2. 等待初始加载完成 (避免与刷新操作的加载状态混淆)
        await expect(lobbyList.locator('li.chat-list-item-empty:has-text("正在加载在线用户...")')).toBeHidden({ timeout: 15000 });

        // 3. 点击刷新按钮
        await refreshButton.click();

        // 4. 验证刷新按钮出现加载状态
        await expect(refreshButton).toHaveClass(/loading/, { timeout: 500 }); // 按钮应添加 loading 类
        // 并且列表可能显示加载中
        await expect(lobbyList.locator('li.chat-list-item-empty:has-text("正在加载在线用户...")')).toBeVisible({timeout:1000});


        // 5. 等待加载完成 (刷新按钮的 loading 类消失，列表更新)
        await expect(refreshButton).not.toHaveClass(/loading/, { timeout: 15000 });
        await expect(lobbyList.locator('li.chat-list-item-empty:has-text("正在加载在线用户...")')).toBeHidden({ timeout: 1000 });


        // 6. 验证列表内容被重新渲染 (至少没有报错，内容可能是用户或空消息)
        const firstLobbyItemAfterRefresh = lobbyList.locator('li.chat-list-item').first();
        const emptyLobbyMessageAfterRefresh = lobbyList.locator('li.chat-list-item-empty:has-text("当前无其他在线用户。")');
        const isVisibleFirst = await firstLobbyItemAfterRefresh.isVisible();
        const isVisibleEmpty = await emptyLobbyMessageAfterRefresh.isVisible();
        expect(isVisibleFirst || isVisibleEmpty).toBe(true); // 列表要么有用户，要么显示空消息
    });
});