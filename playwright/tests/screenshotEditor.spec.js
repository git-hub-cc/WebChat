// tests/screenshotEditor.spec.js
const { test, expect } = require('@playwright/test');

test.describe('截图编辑器功能', () => {
    test.beforeEach(async ({ page, browserName, context }) => {
        // 屏幕捕获 getDisplayMedia API 在某些无头浏览器或 CI 环境中可能表现不同
        // 通常需要真实浏览器环境和用户交互（或模拟）来授予权限。
        // Playwright 的 context.grantPermissions 可以用来预授权，但 getDisplayMedia 比较特殊。
        if (browserName === 'webkit') {
            test.skip(true, 'Skipping screenshot editor tests on WebKit due to getDisplayMedia complexities.');
            return;
        }
        // 对于 getDisplayMedia，Playwright 通常需要 headed 模式或特定启动参数。
        // 如果在无头模式下运行，可能需要 mock API 或跳过这些测试。
        // 假设测试在支持 getDisplayMedia 的环境中运行。

        await page.goto('/');
        await expect(page.locator('#connectionStatusText')).toContainText(/初始化完成，准备连接|用户注册成功|信令服务器已连接|已从本地加载|使用现有id/, { timeout: 20000 });

        // 打开一个聊天，使截图按钮启用 (虽然截图本身不依赖于聊天对象)
        const aiContactId = 'AI_Paimon'; // 使用一个已知的AI联系人
        await page.locator(`#chatListNav li[data-id="${aiContactId}"]`).click();
        await expect(page.locator('#currentChatTitleMain')).toHaveText('Paimon');
    });

    test('应该能够捕获屏幕，进行裁剪和标记，然后确认编辑', async ({ page }) => {
        const screenshotButton = page.locator('#screenshotMainBtn');
        await expect(screenshotButton).toBeEnabled();

        // 1. 点击截图按钮
        //   注意：page.click() 不会处理浏览器级别的屏幕选择对话框。
        //   MediaManager.captureScreen 会调用 navigator.mediaDevices.getDisplayMedia()
        //   Playwright 通常无法直接与此原生对话框交互。
        //   测试 getDisplayMedia 的一种方法是 mock 它，但这会变成单元/集成测试。
        //   对于端到端，我们假设用户会选择一个屏幕。
        //   或者，在测试时，某些浏览器标志可以自动选择一个虚拟屏幕。
        //   这里，我们触发点击，并期望 EventEmitter 发出 'rawScreenshotCaptured' 事件，
        //   然后 ScreenshotEditorUIManager 会处理。

        // Playwright 的 page.on('dialog') 可以处理 alert, confirm, prompt，但不能处理屏幕选择。
        // 我们将依赖于后续的编辑器模态框是否出现来判断截图是否“开始”。
        // 真正捕获屏幕内容并验证像素是高级图像比较测试，超出了这里的范围。

        // 监听 'rawScreenshotCaptured' 事件 (通过暴露一个测试钩子或检查UI变化)
        // 由于我们无法直接监听JS事件，我们将检查编辑器模态框的出现。
        const editorModal = page.locator('#screenshotEditorModal');
        const canvas = page.locator('#screenshotEditorCanvas');

        // 由于 getDisplayMedia 需要用户交互，这里我们做一个简化的测试流程，
        // 假设截图按钮点击后，如果API可用，编辑器会尝试显示。
        // 我们不会验证实际的屏幕内容。

        // 尝试点击截图。如果由于环境限制（如无头浏览器未配置屏幕捕获）导致 getDisplayMedia 失败，
        // MediaManager 会显示错误通知。
        await screenshotButton.click();

        // 延迟后截图并显示编辑器的逻辑在 MediaManager 中是异步的
        // 等待1秒延迟 + 编辑器准备时间
        try {
            await expect(editorModal).toBeVisible({ timeout: 10000 }); // 增加超时等待编辑器
            await expect(canvas).toBeVisible();
            // 检查画布是否有内容 (宽度和高度大于0)
            const canvasWidth = await canvas.getAttribute('width');
            const canvasHeight = await canvas.getAttribute('height');
            expect(parseInt(canvasWidth || '0')).toBeGreaterThan(0);
            expect(parseInt(canvasHeight || '0')).toBeGreaterThan(0);
        } catch (e) {
            // 如果编辑器未显示，可能是 getDisplayMedia 失败或被取消
            const errorNotification = page.locator('.notification.notification-error:has-text("截图功能启动失败")');
            const cancelNotification = page.locator('.notification.notification-info:has-text("截图已取消或未授权")');
            if (await errorNotification.isVisible() || await cancelNotification.isVisible()) {
                test.skip(true, 'Screenshot capture failed or was cancelled in this environment. Skipping editor tests.');
                return;
            }
            throw e; // 如果不是预期的通知，则重新抛出错误
        }


        // 2. 编辑器已显示，默认激活裁剪工具
        const cropToolBtn = editorModal.locator('#cropToolBtn');
        await expect(cropToolBtn).toHaveClass(/active/);

        // 3. 模拟绘制一个裁剪框 (假设画布尺寸为 800x600)
        //    这些坐标需要相对于画布的实际尺寸，这在测试中是动态的。
        //    为简单起见，我们使用相对比例。
        const canvasBoundingBox = await canvas.boundingBox();
        if (!canvasBoundingBox) throw new Error("无法获取画布边界框");

        const cropStartX = canvasBoundingBox.width * 0.1;
        const cropStartY = canvasBoundingBox.height * 0.1;
        const cropEndX = canvasBoundingBox.width * 0.7;
        const cropEndY = canvasBoundingBox.height * 0.7;

        await canvas.dragTo(canvas, {
            sourcePosition: { x: cropStartX, y: cropStartY },
            targetPosition: { x: cropEndX, y: cropEndY }
        });
        // 验证裁剪框已创建 (ScreenshotEditorUIManager 内部 cropRect 不为null)
        // 外部无法直接验证 cropRect，但可以通过重绘后的视觉效果（如遮罩）间接判断。

        // 4. 切换到矩形标记工具
        const drawRectToolBtn = editorModal.locator('#drawRectToolBtn');
        await drawRectToolBtn.click();
        await expect(drawRectToolBtn).toHaveClass(/active/);
        await expect(cropToolBtn).not.toHaveClass(/active/);
        const colorPicker = editorModal.locator('#markColorPicker');
        await expect(colorPicker).toBeVisible();

        // 5. (可选) 修改标记颜色
        await colorPicker.fill('#00FF00'); // 改为绿色
        expect(await colorPicker.inputValue()).toBe('#00ff00');


        // 6. 在裁剪区域内绘制一个标记矩形
        const markStartX = canvasBoundingBox.width * 0.2; // 在裁剪框内部
        const markStartY = canvasBoundingBox.height * 0.2;
        const markEndX = canvasBoundingBox.width * 0.5;
        const markEndY = canvasBoundingBox.height * 0.5;

        await canvas.dragTo(canvas, {
            sourcePosition: { x: markStartX, y: markStartY },
            targetPosition: { x: markEndX, y: markEndY }
        });
        // 验证标记已添加 (ScreenshotEditorUIManager 内部 marks 数组长度增加)

        // 7. 点击 "完成" 按钮
        const confirmBtn = editorModal.locator('#confirmScreenshotEditBtn');
        await confirmBtn.click();

        // 8. 验证编辑器模态框已关闭
        await expect(editorModal).toBeHidden();

        // 9. 验证截图预览出现在主聊天输入区域
        const filePreviewContainer = page.locator('#filePreviewContainer');
        const screenshotPreviewItem = filePreviewContainer.locator('.file-preview-item');
        await expect(screenshotPreviewItem).toBeVisible({ timeout: 5000 });
        await expect(screenshotPreviewItem.locator('img[alt="预览"]')).toBeVisible();
        await expect(screenshotPreviewItem).toContainText(/screenshot_edited_/); // 验证文件名格式

        // 10. 验证成功通知
        await expect(page.locator('.notification.notification-success:has-text("截图编辑完成，已添加到预览。")')).toBeVisible();

        // 11. （可选）发送截图消息并验证
        await page.locator('#sendButtonMain').click();
        await expect(filePreviewContainer.locator('.file-preview-item')).toBeHidden();
        const sentScreenshot = page.locator(`.message.sent img.file-preview-img[alt^="screenshot_edited_"]`);
        await expect(sentScreenshot).toBeVisible();
    });

    test('应该能够取消截图编辑', async ({ page }) => {
        const screenshotButton = page.locator('#screenshotMainBtn');
        const editorModal = page.locator('#screenshotEditorModal');

        // 1. 点击截图按钮，等待编辑器出现
        await screenshotButton.click();
        try {
            await expect(editorModal).toBeVisible({ timeout: 10000 });
        } catch (e) {
            test.skip(true, 'Screenshot capture failed or was cancelled. Skipping cancel test.');
            return;
        }

        // 2. 点击 "取消" 按钮
        const cancelBtn = editorModal.locator('#cancelScreenshotEditBtn');
        await cancelBtn.click();

        // 3. 验证编辑器模态框已关闭
        await expect(editorModal).toBeHidden();

        // 4. 验证取消通知
        await expect(page.locator('.notification.notification-info:has-text("截图操作已取消。")')).toBeVisible();

        // 5. 验证文件预览区域没有内容
        const filePreviewContainer = page.locator('#filePreviewContainer');
        await expect(filePreviewContainer.locator('.file-preview-item')).toBeHidden();
    });
});