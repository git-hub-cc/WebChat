// tests/settings.spec.js
const { test, expect } = require('@playwright/test');

test.describe('设置与配置功能', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('/');
        await expect(page.locator('#connectionStatusText')).toContainText(/初始化完成，准备连接|用户注册成功|信令服务器已连接|已从本地加载|使用现有id/, { timeout: 20000 });
    });

    test('应该能够修改并保存 AI API Endpoint 设置', async ({ page }) => {
        const newApiEndpoint = 'https://example.com/test-api/v1/chat';

        // 1. 点击主菜单按钮打开设置模态框
        await page.locator('#mainMenuBtn').click();
        const settingsModal = page.locator('#mainMenuModal');
        await expect(settingsModal).toBeVisible();

        // 2. 展开 AI 与 API 配置部分 (如果它是折叠的)
        const aiConfigHeader = settingsModal.locator('h3.collapsible-header:has-text("AI 与 API 配置")');
        const aiConfigContent = aiConfigHeader.locator('+ .collapsible-content');
        if (await aiConfigContent.isHidden()) {
            await aiConfigHeader.click();
            await expect(aiConfigContent).toBeVisible();
        }

        // 3. 定位 API Endpoint 输入框并修改其值
        const apiEndpointInput = settingsModal.locator('#apiEndpointInput');
        await apiEndpointInput.fill(newApiEndpoint);
        await expect(apiEndpointInput).toHaveValue(newApiEndpoint);

        // 4. 使输入框失焦以触发保存 (例如，点击模态框的其他部分)
        await settingsModal.locator('h2:has-text("菜单与设置")').click(); // 点击标题部分

        // 5. 断言成功通知
        const successNotification = page.locator('.notification.notification-success');
        await expect(successNotification).toBeVisible({ timeout: 5000 });
        await expect(successNotification.locator('.notification-message')).toHaveText('ApiEndpoint 设置已保存。');

        // 6. (重要) 验证 localStorage 中的值是否已更新
        const storedValue = await page.evaluate(() => localStorage.getItem('aiSetting_apiEndpoint'));
        expect(storedValue).toBe(newApiEndpoint);

        // 7. 关闭模态框
        await settingsModal.locator('.close-modal-btn').click();
        await expect(settingsModal).toBeHidden();
    });

    test('应该能够切换主题和配色方案且无需刷新页面', async ({ page }) => {
        // --- 切换主题 ---
        // 1. 打开设置模态框
        await page.locator('#mainMenuBtn').click();
        const settingsModal = page.locator('#mainMenuModal');
        await expect(settingsModal).toBeVisible();

        // 2. 点击当前主题以展开选项
        const themeSelectedValue = settingsModal.locator('#themeSelectedValue');
        const initialThemeText = await themeSelectedValue.textContent(); // 例如 "原神"
        await themeSelectedValue.click();
        const themeOptionsContainer = settingsModal.locator('#themeOptionsContainer');
        await expect(themeOptionsContainer).toBeVisible();

        // 3. 选择一个不同的主题 (假设 "蜡笔小新-浅色" 存在并且与当前配色方案兼容)
        //    Themes are defined in ThemeLoader.js
        const newThemeOption = themeOptionsContainer.locator('.option:has-text("蜡笔小新")').first();
        // Ensure the option is for the current color scheme, default is 'light'
        // We will find the option for 蜡笔小新 with 浅色
        const targetThemeKey = "蜡笔小新-浅色";
        const targetThemeName = "蜡笔小新";
        const newThemeOptionForColorScheme = themeOptionsContainer.locator(`.option[data-theme-key="${targetThemeKey}"]`);

        await expect(newThemeOptionForColorScheme).toBeVisible();
        await newThemeOptionForColorScheme.click();


        // 4. 断言模态框自动关闭
        await expect(settingsModal).toBeHidden({ timeout: 1000 }); // 主题切换很快

        // 5. 断言主题切换成功通知
        await expect(page.locator(`.notification.notification-success:has-text('主题已切换为 "${targetThemeName}"')`)).toBeVisible();


        // 6. 验证 CSS 文件链接已更改
        const themeStylesheet = page.locator('#theme-stylesheet');
        await expect(themeStylesheet).toHaveAttribute('href', `css/${targetThemeKey}.css`);


        // --- 切换配色方案 ---
        // 7. 重新打开设置模态框
        await page.locator('#mainMenuBtn').click();
        await expect(settingsModal).toBeVisible();

        // 8. 点击当前配色方案以展开选项
        const colorSchemeSelectedValue = settingsModal.locator('#colorSchemeSelectedValue');
        await colorSchemeSelectedValue.click();
        const colorSchemeOptionsContainer = settingsModal.locator('#colorSchemeOptionsContainer');
        await expect(colorSchemeOptionsContainer).toBeVisible();

        // 9. 选择 "深色模式"
        const darkSchemeOption = colorSchemeOptionsContainer.locator('.option:has-text("深色模式")');
        await darkSchemeOption.click();

        // 10. 断言模态框自动关闭
        await expect(settingsModal).toBeHidden({ timeout: 1000 });

        // 11. 断言主题 CSS 已切换到 "蜡笔小新-深色" (因为当前主题是蜡笔小新，配色方案变了)
        await expect(themeStylesheet).toHaveAttribute('href', 'css/蜡笔小新-深色.css');
        // 12. 断言 localStorage 中的配色方案偏好已更新
        const storedColorScheme = await page.evaluate(() => localStorage.getItem('selectedColorScheme'));
        expect(storedColorScheme).toBe('dark');

        // 13. (可选) 验证一个具体的颜色变化，例如 body 背景色
        // This depends on the actual CSS values in 蜡笔小新-深色.css
        // await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(expected, r, g, b)');
    });

    test('应该能够清除缓存并看到页面准备刷新的通知', async ({ page }) => {
        // 1. 打开设置模态框
        await page.locator('#mainMenuBtn').click();
        const settingsModal = page.locator('#mainMenuModal');
        await expect(settingsModal).toBeVisible();

        // 2. 找到并点击 "重置页面" (清除缓存) 按钮
        const clearCacheButton = settingsModal.locator('#modalClearCacheBtn');
        await clearCacheButton.click();

        // 3. 断言确认模态框出现
        const confirmationModal = page.locator('#genericConfirmationModal');
        await expect(confirmationModal).toBeVisible();
        await expect(confirmationModal.locator('h2')).toHaveText('警告：清除缓存');
        await expect(confirmationModal.locator('p')).toContainText('您确定要清除所有本地缓存吗？');

        // 4. 点击 "确定清除"
        // Playwright will wait for navigation implicitly if the click causes a reload
        // However, our app shows a notification *before* reload.
        // We need to handle this carefully.
        // We can listen for the 'load' event to confirm reload, or check notification first.

        // For now, let's just check the notification before the reload timeout happens.
        await confirmationModal.locator('button:has-text("确定清除")').click();

        // 5. 断言成功通知
        const successNotification = page.locator('.notification.notification-success');
        await expect(successNotification).toBeVisible({ timeout: 5000 });
        await expect(successNotification.locator('.notification-message')).toHaveText('所有缓存已成功清除。页面即将刷新...');

        // At this point, the page would typically reload after a 2s timeout.
        // Asserting the reload itself in Playwright can be tricky as the test context might be lost.
        // For this test, verifying the notification is a good enough indication the process started.
        // To test the reload, one might listen for 'load' event or check for initial state after an explicit wait.
    });
});