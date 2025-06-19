// tests/inputAreaInteractions.spec.js
const { test, expect } = require('@playwright/test');

test.describe('聊天输入区域交互功能', () => {
    const aiContactId = 'AI_Paimon';
    const aiContactName = 'Paimon';
    let groupId; // 用于存储动态创建的群组ID
    let groupName;

    test.beforeEach(async ({ page }) => {
        groupName = `输入交互群_${Date.now()}`;

        await page.goto('/');
        await expect(page.locator('#connectionStatusText')).toContainText(/初始化完成，准备连接|用户注册成功|信令服务器已连接|已从本地加载|使用现有id/, { timeout: 20000 });

        // 前置：创建一个群组并添加AI Paimon
        await page.locator('#newChatFab').click();
        const newContactModal = page.locator('#newContactGroupModal');
        await newContactModal.locator('#newGroupNameInput').fill(groupName);
        await newContactModal.locator('#confirmNewGroupBtnModal').click();
        await expect(newContactModal).toBeHidden();
        const groupListItem = page.locator(`#chatListNav li.group .chat-list-name:has-text("${groupName}")`).locator('ancestor::li');
        groupId = await groupListItem.getAttribute('data-id');
        expect(groupId).toBeTruthy();

        // 打开群组聊天
        await groupListItem.click();
        await expect(page.locator('#currentChatTitleMain')).toHaveText(groupName);

        // 添加 Paimon 到群组
        await page.locator('#chatDetailsBtnMain').click();
        const detailsPanel = page.locator('#detailsPanel');
        await expect(detailsPanel.locator('#contactsDropdownDetails').locator(`option:has-text("${aiContactName} (AI助手)")`)).toBeVisible({timeout:5000});
        await detailsPanel.locator('#contactsDropdownDetails').selectOption({ label: `${aiContactName} (AI助手)` });
        await detailsPanel.locator('#addMemberBtnDetails').click();
        await expect(page.locator(`.notification.notification-success:has-text("${aiContactName} 已被添加到群组。")`)).toBeVisible();
        await detailsPanel.locator('#closeDetailsBtnMain').click();
    });

    test('在群聊中输入 @ 时应显示 AI 成员提及建议', async ({ page }) => {
        const messageInput = page.locator('#messageInput');
        const aiMentionSuggestions = page.locator('#aiMentionSuggestions');

        // 1. 输入 "@"
        await messageInput.type('@');
        await expect(aiMentionSuggestions).toBeVisible();
        // 验证 Paimon 在建议列表中
        await expect(aiMentionSuggestions.locator(`.mention-suggestion-item:has-text("${aiContactName}")`)).toBeVisible();

        // 2. 继续输入 Paimon名字的一部分，例如 "Pai"
        await messageInput.type('Pai'); // type 会追加
        await expect(aiMentionSuggestions).toBeVisible();
        await expect(aiMentionSuggestions.locator(`.mention-suggestion-item:has-text("${aiContactName}")`)).toBeVisible(); // Paimon 仍应匹配
        // 可以添加断言，检查不匹配的AI（如果存在）是否已消失

        // 3. 点击 Paimon 的建议项
        await aiMentionSuggestions.locator(`.mention-suggestion-item:has-text("${aiContactName}")`).click();

        // 4. 验证输入框内容已更新为 "@Paimon " (注意末尾的空格)
        await expect(messageInput).toHaveValue(`@${aiContactName} `);
        // 验证建议列表已隐藏
        await expect(aiMentionSuggestions).toBeHidden();
        // 验证光标位置在 "@Paimon " 之后
        const cursorPos = await messageInput.evaluate(el => el.selectionStart);
        expect(cursorPos).toBe(`@${aiContactName} `.length);
    });

    test('输入框中按 Enter (非 Shift/Ctrl) 应发送消息并清空建议', async ({ page }) => {
        const messageInput = page.locator('#messageInput');
        const aiMentionSuggestions = page.locator('#aiMentionSuggestions');
        const testMessage = `@${aiContactName} 你好`;

        // 1. 输入消息，并确保提及建议出现
        await messageInput.type(`@${aiContactName.substring(0,3)}`); // 输入部分名字以触发建议
        await expect(aiMentionSuggestions.locator(`.mention-suggestion-item:has-text("${aiContactName}")`)).toBeVisible();
        // 完成输入
        await messageInput.press('End'); // 移到末尾
        await messageInput.type(`你好`);
        await expect(messageInput).toHaveValue(testMessage);


        // 2. 按下 Enter 键
        await messageInput.press('Enter');

        // 3. 验证消息已发送（出现在聊天框）
        await expect(page.locator(`.message.sent .message-content:has-text("${testMessage}")`)).toBeVisible();
        // 4. 验证输入框已清空
        await expect(messageInput).toHaveValue('');
        // 5. 验证提及建议列表已隐藏
        await expect(aiMentionSuggestions).toBeHidden();
    });

    test('输入框中按 Escape 键应隐藏提及建议列表', async ({ page }) => {
        const messageInput = page.locator('#messageInput');
        const aiMentionSuggestions = page.locator('#aiMentionSuggestions');

        // 1. 输入 "@" 使建议列表出现
        await messageInput.type('@');
        await expect(aiMentionSuggestions).toBeVisible();

        // 2. 按下 Escape 键
        await messageInput.press('Escape');

        // 3. 验证提及建议列表已隐藏
        await expect(aiMentionSuggestions).toBeHidden();
        // 4. 验证输入框内容 "@" 仍然存在
        await expect(messageInput).toHaveValue('@');
    });

    test('拖放文件到聊天区域应触发文件预览（UI层面）', async ({ page }) => {
        const chatArea = page.locator('#chatArea');
        const filePreviewContainer = page.locator('#filePreviewContainer');

        // 1. 创建一个虚拟文件用于拖放
        const { filePath } = createDummyFile('drag_drop_test.txt', '拖放测试');
        const dataTransfer = await page.evaluateHandle(() => new DataTransfer());
        await dataTransfer.evaluateHandle((dt, file) => {
            const f = new File([file.content], file.name, { type: file.type });
            dt.items.add(f);
        }, { content: '拖放测试内容', name: 'drag_drop_test.txt', type: 'text/plain' });


        // 2. 模拟拖动文件到 chatArea 上方
        await chatArea.dispatchEvent('dragenter', { dataTransfer });
        await expect(chatArea).toHaveClass(/drag-over/); // 验证拖放覆盖层出现

        // 3. 模拟在 chatArea 上释放文件
        //   注意：直接 dispatch 'drop' 事件可能不足以触发 fileInput 的完整流程
        //   MediaManager.processFile 依赖于 e.dataTransfer.files
        //   Playwright 的 page.setInputFiles 是更可靠的方式来模拟文件选择
        //   但这里我们是测试拖放的UI反馈和事件链。
        //   如果拖放直接触发 processFile -> MessageManager.selectedFile -> MediaUIManager.displayFilePreview
        //   那么我们应该能看到预览。

        // 为了更可靠地测试拖放的文件处理，我们监听 'filechooser' 事件，
        // 然后使用 setFiles。但这与直接拖放的交互不同。
        // 这里的目标是测试拖放的视觉反馈和 `drop` 事件是否被 ChatAreaUIManager 处理。
        // ChatAreaUIManager 的 `drop` 事件会调用 `MediaManager.processFile`。

        // 模拟 drop
        await chatArea.dispatchEvent('drop', { dataTransfer });

        // 4. 验证拖放覆盖层消失
        await expect(chatArea).not.toHaveClass(/drag-over/);

        // 5. 验证文件预览出现 (表示 MediaManager.processFile 被调用了)
        await expect(filePreviewContainer.locator('.file-preview-item')).toBeVisible({ timeout: 5000 });
        await expect(filePreviewContainer).toContainText('drag_drop_test.txt');

        // 清理
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    });
});

// 辅助函数（与 fileTransfer.spec.js 中的类似）
function createDummyFile(fileName, content = 'dummy content', mimeType = 'text/plain') {
    const filePath = path.join(__dirname, fileName);
    fs.writeFileSync(filePath, content);
    return { filePath, mimeType };
}