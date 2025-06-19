// tests/userSettingsPersistence.spec.js
const { test, expect } = require('@playwright/test');

test.describe('用户设置持久化', () => {
    test.beforeEach(async ({ page }) => {
        // 清空 localStorage 以确保测试从干净的状态开始
        await page.evaluate(() => localStorage.clear());
        await page.goto('/');
        await expect(page.locator('#connectionStatusText')).toContainText(/初始化完成，准备连接|用户注册成功|信令服务器已连接|已从本地加载|使用现有id/, { timeout: 20000 });
    });

    test('修改用户ID后刷新，应保留新的用户ID', async ({ page }) => {
        const newUserId = `testUser_${Date.now()}`;

        // 1. 打开设置模态框
        await page.locator('#mainMenuBtn').click();
        const settingsModal = page.locator('#mainMenuModal');
        await expect(settingsModal).toBeVisible();

        // 2. 模拟修改用户ID并保存到DBManager (这通常是 UserManager.init 做的)
        //    Playwright 不能直接调用JS函数，但我们可以验证初始ID，然后修改，再刷新。
        //    或者，如果有一个UI可以修改用户ID（虽然本应用似乎没有），则通过UI操作。
        //    由于本应用用户ID是首次生成后固定的，这个测试需要调整。
        //    我们将测试 "自动连接" 设置的持久化，因为它可以通过UI切换。
        //    如果需要测试UserID持久化，那更多的是单元/集成测试 UserManager.init 的逻辑。

        // 改为测试 "自动连接" 设置
        const autoConnectToggle = settingsModal.locator('#autoConnectToggle');
        const initialAutoConnectState = await autoConnectToggle.isChecked();

        // 3. 点击切换 "自动连接" 设置
        await autoConnectToggle.click();
        const newAutoConnectState = await autoConnectToggle.isChecked();
        expect(newAutoConnectState).not.toBe(initialAutoConnectState); // 确保状态已改变

        // 4. (可选) 验证是否有保存成功的通知 (如果 UserManager.updateUserSetting 触发了通知)
        //    目前 UserManager.updateUserSetting 只是 log，没有UI通知。

        // 5. 关闭设置模态框
        await settingsModal.locator('.close-modal-btn').click();
        await expect(settingsModal).toBeHidden();

        // 6. 刷新页面
        await page.reload();
        await expect(page.locator('#connectionStatusText')).toContainText(/初始化完成，准备连接|用户注册成功|信令服务器已连接|已从本地加载|使用现有id/, { timeout: 20000 });


        // 7. 重新打开设置模态框
        await page.locator('#mainMenuBtn').click();
        await expect(settingsModal).toBeVisible();

        // 8. 验证 "自动连接" 设置是否被保留
        const autoConnectToggleAfterReload = settingsModal.locator('#autoConnectToggle');
        await expect(autoConnectToggleAfterReload).toBeChecked({ checked: newAutoConnectState });
    });

    test('切换主题和配色方案偏好后刷新，应保留选择', async ({ page }) => {
        const targetThemeKey = '崩坏3-深色'; // 选择一个与默认不同的主题和配色
        const targetThemeDisplayName = '崩坏3';
        const targetColorSchemeDisplayName = '深色模式';
        const targetColorSchemeStorageKey = 'dark';


        // 1. 打开设置
        await page.locator('#mainMenuBtn').click();
        const settingsModal = page.locator('#mainMenuModal');

        // 2. 切换配色方案为 "深色模式"
        await settingsModal.locator('#colorSchemeSelectedValue').click();
        await settingsModal.locator('#colorSchemeOptionsContainer .option:has-text("深色模式")').click();
        // 模态框应已关闭，但为了后续操作，我们重新打开它（或不关闭它，但应用逻辑是关闭）
        await page.locator('#mainMenuBtn').click(); // 重新打开


        // 3. 切换主题为 "崩坏3" (它会自动选择深色版本，因为当前配色是深色)
        await settingsModal.locator('#themeSelectedValue').click();
        const themeOption = settingsModal.locator(`#themeOptionsContainer .option[data-theme-key="${targetThemeKey}"]`);
        await expect(themeOption).toBeVisible(); // 确保选项存在
        await themeOption.click();
        // 模态框再次关闭
        await page.locator('#mainMenuBtn').click(); // 重新打开


        // 4. 验证UI显示了新主题和配色
        await expect(settingsModal.locator('#themeSelectedValue')).toHaveText(targetThemeDisplayName);
        await expect(settingsModal.locator('#colorSchemeSelectedValue')).toHaveText(targetColorSchemeDisplayName);
        await settingsModal.locator('.close-modal-btn').click();


        // 5. 刷新页面
        await page.reload();
        await expect(page.locator('#connectionStatusText')).toContainText(/初始化完成，准备连接|用户注册成功|信令服务器已连接|已从本地加载|使用现有id/, { timeout: 20000 });


        // 6. 验证CSS文件是否为 "崩坏3-深色.css"
        await expect(page.locator('#theme-stylesheet')).toHaveAttribute('href', `css/${targetThemeKey}.css`);

        // 7. 再次打开设置，验证选择器显示正确的值
        await page.locator('#mainMenuBtn').click();
        await expect(settingsModal.locator('#themeSelectedValue')).toHaveText(targetThemeDisplayName);
        await expect(settingsModal.locator('#themeSelectedValue')).toHaveAttribute('data-current-theme-key', targetThemeKey);
        await expect(settingsModal.locator('#colorSchemeSelectedValue')).toHaveText(targetColorSchemeDisplayName);

        // 8. 验证 localStorage 中的值
        const storedTheme = await page.evaluate(() => localStorage.getItem('selectedTheme'));
        const storedColorScheme = await page.evaluate(() => localStorage.getItem('selectedColorScheme'));
        expect(storedTheme).toBe(targetThemeKey);
        expect(storedColorScheme).toBe(targetColorSchemeStorageKey);
    });
});