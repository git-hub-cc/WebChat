// tests/themeSwitching.spec.js
const { test, expect } = require('@playwright/test');

test.describe('主题与配色方案切换功能', () => {
    // 在每个测试用例开始前执行的钩子函数
    test.beforeEach(async ({ page }) => {
        // 导航到应用的根路径
        await page.goto('/');
        // 等待应用核心初始化完成的标志性文本出现，超时时间设置为20秒
        await expect(page.locator('#connectionStatusText')).toContainText(/初始化完成，准备连接|用户注册成功|信令服务器已连接|已从本地加载|使用现有id/, { timeout: 20000 });
    });

    test('应该能够切换配色方案为深色模式', async ({ page }) => {
        // 1. 点击主菜单按钮，打开设置模态框
        await page.locator('#mainMenuBtn').click();
        // 2. 断言主菜单模态框可见
        const mainMenuModal = page.locator('#mainMenuModal');
        await expect(mainMenuModal).toBeVisible();

        // 3. 点击配色方案选择器的当前值部分，以展开选项
        await page.locator('#colorSchemeSelectedValue').click();
        // 4. 断言配色方案选项容器可见
        const colorSchemeOptions = page.locator('#colorSchemeOptionsContainer');
        await expect(colorSchemeOptions).toBeVisible();

        // 5. 点击 "深色模式" 选项
        //    这里使用 data-scheme-key 属性来定位选项，这是 SettingsUIManager.js 中填充选项时设置的
        await colorSchemeOptions.locator('div.option[data-scheme-key="dark"]').click();

        // 6. 断言设置模态框已关闭 (切换配色方案后应自动关闭)
        await expect(mainMenuModal).toBeHidden();

        // 7. 验证 localStorage 中的配色方案设置已更新为 "dark"
        //    page.evaluate 允许在浏览器上下文中执行 JavaScript 代码
        const selectedScheme = await page.evaluate(() => localStorage.getItem('selectedColorScheme'));
        expect(selectedScheme).toBe('dark'); // 断言值为 'dark'

        // 8. 验证当前应用的主题是一个深色主题
        //    ThemeLoader.js 会根据新的配色方案选择一个兼容的主题
        //    假设 "原神-深色" 是默认的深色主题或与 "原神-浅色" 对应的深色版本
        const selectedThemeKey = await page.evaluate(() => localStorage.getItem('selectedTheme'));
        expect(selectedThemeKey).toBe('原神-深色'); // 预期切换到原神主题的深色版本

        // 9. 验证主题样式表链接已更新为深色主题的 CSS 文件
        const themeStylesheet = page.locator('#theme-stylesheet');
        await expect(themeStylesheet).toHaveAttribute('href', 'css/原神-深色.css');

        // 10. (可选) 验证页面上某个元素的颜色是否符合深色主题
        //     例如，body 的背景色或文本颜色。这需要知道深色主题的具体样式。
        // await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(30, 30, 30)'); // 假设深色背景
    });

    test('应该能够切换到一个特定的主题 (例如：迷宫饭-浅色)', async ({ page }) => {
        // 1. 打开设置模态框
        await page.locator('#mainMenuBtn').click();
        const mainMenuModal = page.locator('#mainMenuModal');
        await expect(mainMenuModal).toBeVisible();

        // 2. 确保当前是浅色模式，以便 "迷宫饭-浅色" 可选
        //    如果默认不是浅色，或者上一个测试改变了它，需要先切换回浅色
        const currentSchemeDisplay = await page.locator('#colorSchemeSelectedValue').textContent();
        if (currentSchemeDisplay !== '自动 (浏览器)' && currentSchemeDisplay !== '浅色模式') {
            await page.locator('#colorSchemeSelectedValue').click();
            await page.locator('#colorSchemeOptionsContainer div.option[data-scheme-key="light"]').click();
            await expect(mainMenuModal).toBeHidden(); // 切换后会关闭
            await page.locator('#mainMenuBtn').click(); // 重新打开
            await expect(mainMenuModal).toBeVisible();
        }
        await expect(page.locator('#colorSchemeSelectedValue')).toHaveText(/自动 \(浏览器\)|浅色模式/);


        // 3. 点击主题选择器的当前值部分，以展开选项
        const themeSelectedValue = page.locator('#themeSelectedValue');
        await themeSelectedValue.click();
        // 4. 断言主题选项容器可见
        const themeOptions = page.locator('#themeOptionsContainer');
        await expect(themeOptions).toBeVisible();

        // 5. 点击 "迷宫饭-浅色" 主题选项
        //    ThemeLoader.themes 中 "迷宫饭-浅色" 的 key 就是 "迷宫饭-浅色"
        const targetThemeName = '迷宫饭'; // SettingsUIManager 中显示的是 name
        const targetThemeKey = '迷宫饭-浅色'; // 实际存储的 key
        const mazeThemeOption = themeOptions.locator(`div.option:has-text("${targetThemeName}")[data-theme-key="${targetThemeKey}"]`);
        await expect(mazeThemeOption).toBeVisible(); // 确保选项存在
        await mazeThemeOption.click();

        // 6. 断言设置模态框已关闭 (切换主题后应自动关闭)
        await expect(mainMenuModal).toBeHidden();

        // 7. 验证 localStorage 中的主题设置已更新为 "迷宫饭-浅色" 的 key
        const selectedTheme = await page.evaluate(() => localStorage.getItem('selectedTheme'));
        expect(selectedTheme).toBe(targetThemeKey);

        // 8. 验证主题样式表链接已更新为 "迷宫饭-浅色" 的 CSS 文件
        const themeStylesheet = page.locator('#theme-stylesheet');
        await expect(themeStylesheet).toHaveAttribute('href', 'css/迷宫饭-浅色.css');

        // 9. (可选) 验证页面上某个元素的类名或样式是否反映了新主题
        //     例如， body 是否有 'theme-迷宫饭-浅色' 类似的类名，或特定颜色。
        // await expect(page.locator('body')).toHaveClass(/theme-迷宫饭-浅色/); // 假设会添加这样的类
    });
});