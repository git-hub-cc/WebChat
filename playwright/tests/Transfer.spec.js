// tests/fileTransfer.spec.js
const { test, expect } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

// 辅助函数：创建一个临时文件用于测试
function createDummyFile(fileName, content = 'dummy content', mimeType = 'text/plain') {
    const filePath = path.join(__dirname, fileName); // 将文件创建在测试脚本同级目录
    fs.writeFileSync(filePath, content);
    return { filePath, mimeType };
}

test.describe('文件传输与预览功能', () => {
    let dummyTextFile;
    let dummyImageFile;

    test.beforeAll(() => {
        // 在所有测试开始前创建虚拟文件
        dummyTextFile = createDummyFile('test_upload.txt', '这是Playwright测试文件内容。');
        // 创建一个非常小的base64编码的1x1像素红色PNG作为图片
        const base64Image = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
        const imageContent = Buffer.from(base64Image.split(',')[1], 'base64');
        dummyImageFile = createDummyFile('test_image.png', imageContent, 'image/png');
    });

    test.afterAll(() => {
        // 所有测试结束后删除虚拟文件
        if (dummyTextFile && fs.existsSync(dummyTextFile.filePath)) fs.unlinkSync(dummyTextFile.filePath);
        if (dummyImageFile && fs.existsSync(dummyImageFile.filePath)) fs.unlinkSync(dummyImageFile.filePath);
    });

    test.beforeEach(async ({ page }) => {
        await page.goto('/');
        await expect(page.locator('#connectionStatusText')).toContainText(/初始化完成，准备连接|用户注册成功|信令服务器已连接|已从本地加载|使用现有id/, { timeout: 20000 });

        // 前置：添加一个普通联系人用于测试文件发送
        const contactId = 'file_receiver_001';
        const contactName = '文件接收方';
        await page.locator('#newChatFab').click();
        const newContactModal = page.locator('#newContactGroupModal');
        await newContactModal.locator('#newPeerIdInput').fill(contactId);
        await newContactModal.locator('#newPeerNameInput').fill(contactName);
        await newContactModal.locator('#confirmNewContactBtn').click();
        await expect(newContactModal).toBeHidden();
        await expect(page.locator(`.notification.notification-success:has-text('联系人 "${contactName}" 已添加。')`)).toBeVisible();

        // 打开与该联系人的聊天
        await page.locator(`#chatListNav li[data-id="${contactId}"]`).click();
        await expect(page.locator('#currentChatTitleMain')).toHaveText(contactName);
        // 在这里，我们不测试实际的 P2P 连接，只测试UI和前端逻辑
    });

    test('应该能够预览并发送文本文件', async ({ page }) => {
        // 1. 点击附件按钮 (需要确保聊天界面已启用，通常是自动的)
        //    由于 setInputFiles 会直接作用于 fileInput，我们不需要实际点击 attachBtn
        const fileInput = page.locator('#fileInput');
        await fileInput.setInputFiles(dummyTextFile.filePath);

        // 2. 验证文件预览出现在输入区域
        const filePreviewContainer = page.locator('#filePreviewContainer');
        await expect(filePreviewContainer.locator('.file-preview-item')).toBeVisible();
        await expect(filePreviewContainer).toContainText(path.basename(dummyTextFile.filePath)); // 验证文件名
        await expect(filePreviewContainer).toContainText('📄'); // 验证文件图标

        // 3. 点击发送按钮
        await page.locator('#sendButtonMain').click();

        // 4. 验证文件预览已从输入区域消失
        await expect(filePreviewContainer.locator('.file-preview-item')).toBeHidden();

        // 5. 验证文件消息已显示在聊天框中
        const fileMessageInChat = page.locator(`.message.sent .file-info:has-text("${path.basename(dummyTextFile.filePath)}")`);
        await expect(fileMessageInChat).toBeVisible();
        await expect(fileMessageInChat.locator('.download-btn')).toBeVisible();
        await expect(fileMessageInChat.locator('.download-btn')).toHaveAttribute('download', path.basename(dummyTextFile.filePath));
    });

    test('应该能够预览并发送图片文件，并查看大图', async ({ page }) => {
        // 1. 通过 setInputFiles 选择图片
        const fileInput = page.locator('#fileInput');
        await fileInput.setInputFiles(dummyImageFile.filePath);

        // 2. 验证图片预览出现在输入区域
        const filePreviewContainer = page.locator('#filePreviewContainer');
        await expect(filePreviewContainer.locator('.file-preview-item img[alt="预览"]')).toBeVisible();
        await expect(filePreviewContainer).toContainText(path.basename(dummyImageFile.filePath));

        // 3. 点击发送按钮
        await page.locator('#sendButtonMain').click();

        // 4. 验证图片消息已显示在聊天框中
        const imageMessageInChat = page.locator(`.message.sent img.file-preview-img[alt="${path.basename(dummyImageFile.filePath)}"]`);
        await expect(imageMessageInChat).toBeVisible();

        // 5. 点击聊天框中的图片预览
        await imageMessageInChat.click();

        // 6. 验证全尺寸图片查看器模态框出现
        const imageViewerModal = page.locator('.modal-like.image-viewer');
        await expect(imageViewerModal).toBeVisible();
        const fullImage = imageViewerModal.locator(`img[alt="${path.basename(dummyImageFile.filePath)}"]`);
        await expect(fullImage).toBeVisible();
        const imgSrc = await fullImage.getAttribute('src');
        expect(imgSrc).not.toBeNull(); // 确保 src 属性存在
        expect(imgSrc?.startsWith('data:image/')).toBe(true); // 验证是 data URL

        // 7. 点击模态框关闭它
        await imageViewerModal.click(); // 点击模态框本身来关闭
        await expect(imageViewerModal).toBeHidden();
    });

    test('应该能够取消已选择的文件预览', async ({ page }) => {
        // 1. 选择一个文件
        const fileInput = page.locator('#fileInput');
        await fileInput.setInputFiles(dummyTextFile.filePath);

        // 2. 验证文件预览出现
        const filePreviewContainer = page.locator('#filePreviewContainer');
        const previewItem = filePreviewContainer.locator('.file-preview-item');
        await expect(previewItem).toBeVisible();

        // 3. 点击预览中的取消按钮
        await previewItem.locator('button.cancel-file-preview').click();

        // 4. 验证文件预览已消失
        await expect(previewItem).toBeHidden();

        // 5. 验证 MessageManager.selectedFile 是否被清空 (间接验证：输入框可输入，发送按钮作用于文本)
        const messageInput = page.locator('#messageInput');
        await messageInput.fill("测试取消文件后发送文本");
        await page.locator('#sendButtonMain').click();
        await expect(page.locator(`.message.sent .message-content:has-text("测试取消文件后发送文本")`)).toBeVisible();
        // 确保没有文件消息被发送
        await expect(page.locator(`.message.sent .file-info`)).toBeHidden({ timeout: 500 });
    });
});