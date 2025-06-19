// tests/themeAndLayout.spec.js
const { test, expect } = require('@playwright/test');

test.describe('主题切换与响应式布局功能', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('/');
        await expect(page.locator('#connectionStatusText')).toContainText(/初始化完成，准备连接|用户注册成功|信令服务器已连接|已从本地加载|使用现有id/, { timeout: 20000 });
    });

    test('在不同窗口尺寸下，应用布局应正确响应 (移动端/桌面端视图切换)', async ({ page }) => {
        const appContainer = page.locator('.app-container');
        const sidebarNav = page.locator('#sidebarNav');
        const chatArea = page.locator('#chatArea');
        const backToListBtn = page.locator('#backToListBtn');

        // 1. 初始加载 (桌面端视图)
        await page.setViewportSize({ width: 1200, height: 800 });
        await expect(appContainer).not.toHaveClass(/mobile-view/);
        await expect(sidebarNav).toBeVisible();
        await expect(chatArea).toBeVisible(); // 主聊天区应该和侧边栏一起显示
        await expect(backToListBtn).toBeHidden(); // 返回按钮在桌面端隐藏

        // 2. 切换到移动端视图 (例如宽度 <= 768px)
        await page.setViewportSize({ width: 600, height: 800 });
        await expect(appContainer).toHaveClass(/mobile-view/);
        // 在移动端，默认应该显示聊天列表，聊天区域隐藏
        await expect(sidebarNav).toBeVisible();
        await expect(chatArea).toBeHidden();
        await expect(backToListBtn).toBeHidden(); // 此时在列表页，返回按钮不应显示

        // 3. 在移动端视图下，打开一个聊天
        //    (假设 'AI_Paimon' 是一个存在的联系人)
        const paimonContact = page.locator('#chatListNav li[data-id="AI_Paimon"]');
        await expect(paimonContact).toBeVisible();
        await paimonContact.click();

        // 4. 验证移动端视图下，聊天列表隐藏，聊天区域显示，返回按钮显示
        await expect(appContainer).toHaveClass(/chat-view-active/);
        await expect(sidebarNav).toBeHidden();
        await expect(chatArea).toBeVisible();
        await expect(backToListBtn).toBeVisible();

        // 5. 点击返回按钮
        await backToListBtn.click();

        // 6. 验证移动端视图下，回到聊天列表，聊天区域隐藏，返回按钮隐藏
        await expect(appContainer).not.toHaveClass(/chat-view-active/);
        await expect(sidebarNav).toBeVisible();
        await expect(chatArea).toBeHidden();
        await expect(backToListBtn).toBeHidden();

        // 7. 切换回桌面端视图
        await page.setViewportSize({ width: 1200, height: 800 });
        await expect(appContainer).not.toHaveClass(/mobile-view/);
        await expect(sidebarNav).toBeVisible();
        await expect(chatArea).toBeVisible(); // 打开的聊天应该保持
        await expect(page.locator('#currentChatTitleMain')).toHaveText('Paimon'); // 验证聊天头
        await expect(backToListBtn).toBeHidden();
    });

    test('切换主题后，特殊AI联系人的相关UI应更新', async ({ page }) => {
        const initialThemeKey = '原神-浅色'; // 假设这是初始主题
        const initialAiId = 'AI_Paimon';
        const initialAiName = 'Paimon';

        const newThemeKey = '崩坏3-浅色'; // 切换到的新主题
        const newThemeName = '崩坏3';
        const newThemeAiId = 'AI_AiHyperion'; // 假设这是崩坏3主题中的一个AI
        const newThemeAiName = '爱酱';


        // --- 验证初始主题下的AI ---
        // 1. 确保Paimon在列表中，并且是特殊联系人样式
        const paimonListItem = page.locator(`#chatListNav li.special-contact.${initialAiId}`);
        await expect(paimonListItem).toBeVisible();
        await expect(paimonListItem.locator('.chat-list-name')).toHaveText(initialAiName);

        // 2. 打开Paimon聊天
        await paimonListItem.click();
        await expect(page.locator('#currentChatTitleMain')).toHaveText(initialAiName);
        // 验证聊天头部的特殊样式 (基于 .character-active 和 .AI_Paimon)
        await expect(page.locator(`.chat-header-main.character-active.current-chat-${initialAiId}`)).toBeVisible();

        // --- 切换主题 ---
        // 3. 打开设置
        await page.locator('#mainMenuBtn').click();
        const settingsModal = page.locator('#mainMenuModal');
        await expect(settingsModal).toBeVisible();

        // 4. 选择新主题 "崩坏3"
        await settingsModal.locator('#themeSelectedValue').click();
        const themeOptionsContainer = settingsModal.locator('#themeOptionsContainer');
        await themeOptionsContainer.locator(`.option[data-theme-key="${newThemeKey}"]`).click();
        await expect(settingsModal).toBeHidden(); // 模态框应自动关闭
        await expect(page.locator(`.notification.notification-success:has-text('主题已切换为 "${newThemeName}"')`)).toBeVisible();

        // --- 验证新主题下的AI ---
        // 5. 验证Paimon不再是特殊联系人样式 (如果它不在新主题定义中)
        //    注意：Paimon可能仍然作为历史AI存在，但其 .special-contact 类会被移除
        const paimonListItemAfterThemeChange = page.locator(`#chatListNav li[data-id="${initialAiId}"]`);
        await expect(paimonListItemAfterThemeChange).not.toHaveClass(/special-contact/); // 不再是当前主题的特殊
        // 它现在可能是 .historical-ai-contact-active (如果存在于 this.contacts 但 isSpecial=false, isAI=true)
        // await expect(paimonListItemAfterThemeChange).toHaveClass(/historical-ai-contact-active/);

        // 6. 验证新主题的AI "爱酱" 出现在列表中，并且是特殊联系人样式
        const aiChanListItem = page.locator(`#chatListNav li.special-contact.${newThemeAiId}`);
        await expect(aiChanListItem).toBeVisible();
        await expect(aiChanListItem.locator('.chat-list-name')).toHaveText(newThemeAiName);

        // 7. 打开爱酱的聊天
        await aiChanListItem.click();
        await expect(page.locator('#currentChatTitleMain')).toHaveText(newThemeAiName);
        // 验证聊天头部有新AI的特殊样式
        await expect(page.locator(`.chat-header-main.character-active.current-chat-${newThemeAiId}`)).toBeVisible();

        // 8. 验证原先打开的Paimon聊天头部不再有特殊样式（如果Paimon不是新主题特殊AI）
        //    如果此时点击Paimon，其头部不应有 current-chat-AI_Paimon 类
        await paimonListItemAfterThemeChange.click();
        await expect(page.locator('#currentChatTitleMain')).toHaveText(initialAiName);
        await expect(page.locator(`.chat-header-main.character-active.current-chat-${initialAiId}`)).toBeHidden();
        // 并且，由于Paimon现在是历史AI (如果它不是崩坏3的特殊AI)，其头部应有历史AI的类
        await expect(page.locator('.chat-header-main.historical-ai-contact-active')).toBeVisible();
    });
});