// tests/fileUpload.spec.js
const { test, expect } = require('@playwright/test');
const path = require('path');

test.describe('文件上传与预览功能', () => {
    const AI_CONTACT_ID = 'AI_Kazuha_原神'; // 使用一个已存在的联系人进行测试
    const AI_CONTACT_NAME = '枫原万叶';
    const TEST_FILE_NAME = 'test-image.png';
    const TEST_FILE_PATH = path.join(__dirname, '..', 'test-data', TEST_FILE_NAME); // 假设测试文件在项目根目录的 test-data 文件夹下
    const TEST_FILE_TYPE = 'image/png';
    const TEST_FILE_SIZE = 1024; // 假设文件大小为 1KB

    test.beforeEach(async ({ page }) => {
        // 导航到应用
        await page.goto('/');
        // 等待应用初始化
        await expect(page.locator('#connectionStatusText')).toContainText(/初始化完成，准备连接|用户注册成功|信令服务器已连接|已从本地加载|使用现有id/, { timeout: 20000 });

        // 打开与 AI Kazuha 的聊天
        const kazuhaContactInList = page.locator(`#chatListNav li[data-id="${AI_CONTACT_ID}"] .chat-list-name:has-text("${AI_CONTACT_NAME}")`);
        await expect(kazuhaContactInList).toBeVisible({ timeout: 10000 });
        await page.locator(`#chatListNav li[data-id="${AI_CONTACT_ID}"]`).click();
        await expect(page.locator('#currentChatTitleMain')).toHaveText(AI_CONTACT_NAME);
    });

    test('应该能够选择文件，在输入框预览，并发送文件消息', async ({ page }) => {
        // 1. 定位附件按钮并确保其已启用
        const attachButton = page.locator('#attachBtnMain');
        await expect(attachButton).toBeEnabled();

        // 2. Playwright 通过监听 filechooser 事件并设置文件来模拟文件选择
        //    文件输入框 <input type="file" id="fileInput"> 是隐藏的，通过点击附件按钮触发
        const fileChooserPromise = page.waitForEvent('filechooser');
        await attachButton.click();
        const fileChooser = await fileChooserPromise;

        // 3. 设置要上传的文件
        //    注意: Playwright 的 setFiles 方法需要文件在测试运行环境的文件系统中真实存在。
        //    你需要创建一个虚拟的 test-data/test-image.png 文件，或者指向一个真实存在的测试图片。
        //    如果只是想测试流程而不关心文件内容，可以用 page.evaluate 来伪造 File 对象，但这更复杂。
        //    对于端到端测试，使用真实（小）文件更好。
        //    确保 TEST_FILE_PATH 是正确的。
        try {
            await fileChooser.setFiles(TEST_FILE_PATH);
        } catch (e) {
            console.error(`设置文件失败，请确保测试文件存在于: ${TEST_FILE_PATH}。错误: ${e.message}`);
            // 如果文件不存在，测试会失败，这里可以添加一个更友好的提示或跳过测试
            test.skip(true, `测试文件 ${TEST_FILE_PATH} 未找到，跳过此测试。`);
            return;
        }


        // 4. 验证文件预览是否出现在 filePreviewContainer 中
        const filePreviewContainer = page.locator('#filePreviewContainer');
        await expect(filePreviewContainer).toBeVisible();
        // 预览中通常会显示文件名，可能是截断的
        const displayedFileName = Utils.truncateFileName(TEST_FILE_NAME, 25); // 与 MediaUIManager.js 中截断逻辑一致
        const previewItem = filePreviewContainer.locator(`.file-preview-item:has-text("${displayedFileName}")`);
        await expect(previewItem).toBeVisible();
        // 验证预览中是否有图片 (因为我们上传的是图片)
        await expect(previewItem.locator('img[alt="预览"]')).toBeVisible();
        await expect(previewItem.locator('img[alt="预览"]')).toHaveAttribute('title', TEST_FILE_NAME);


        // 5. 点击发送按钮
        const sendButton = page.locator('#sendButtonMain');
        await expect(sendButton).toBeEnabled();
        await sendButton.click();

        // 6. 验证文件预览容器已清空
        await expect(filePreviewContainer).toBeHidden(); // 或者 toHaveText('')，取决于实现

        // 7. 验证包含文件的消息已显示在聊天框中
        const sentFileMessage = page.locator(`.message.sent .message-content-wrapper img.file-preview-img[alt="${TEST_FILE_NAME}"]`);
        await expect(sentFileMessage).toBeVisible();
        // 同时，这条消息应该包含图片预览
        await expect(sentFileMessage).toHaveAttribute('src', /^data:image\/png;base64,/); // 验证 src 是 base64 图片数据

        // 8. (对于AI聊天) 验证AI是否开始思考 (可选，因为重点是文件发送)
        const thinkingMessage = page.locator(`.message.system:has-text("${AI_CONTACT_NAME} 正在思考...")`);
        if (await thinkingMessage.isVisible({timeout: 1000})) { // AI 不会对文件消息回应，但发送行为本身会触发思考 (如果这样设计)
            // 如果AI不应该对文件消息回应，可以断言思考消息不出现或很快消失
            // await expect(thinkingMessage).toBeHidden({ timeout: 3000 }); // 根据实际行为调整
            console.log("AI 正在思考，此部分非测试重点。");
        }
    });
});

// 辅助函数，需要与 MediaUIManager.js 中的 truncateFileName 逻辑保持一致
const Utils = {
    truncateFileName: function(filename, maxLength) {
        if (typeof filename !== 'string') return '';
        if (filename.length > maxLength) {
            return filename.substring(0, maxLength) + "...";
        }
        return filename;
    }
};