// tests/voiceMessage.spec.js
const { test, expect } = require('@playwright/test');

test.describe('语音消息功能', () => {
    let contactId;
    let contactName;

    test.beforeEach(async ({ page, browserName }) => {
        // 语音录制功能依赖于浏览器权限和 MediaRecorder API
        // 在 CI 环境或某些浏览器配置下可能不可用或行为不一致
        // 如果是 webkit (Safari)，可能会有权限问题或API支持问题，可以考虑跳过
        if (browserName === 'webkit') {
            test.skip(true, 'Skipping voice message tests on WebKit due to potential MediaRecorder/permission issues.');
            return;
        }

        contactId = `voice_user_${Date.now()}`;
        contactName = '语音测试伙伴';

        await page.goto('/');
        await expect(page.locator('#connectionStatusText')).toContainText(/初始化完成，准备连接|用户注册成功|信令服务器已连接|已从本地加载|使用现有id/, { timeout: 20000 });

        // 前置：添加并打开一个普通联系人聊天
        await page.locator('#newChatFab').click();
        const newContactModal = page.locator('#newContactGroupModal');
        await newContactModal.locator('#newPeerIdInput').fill(contactId);
        await newContactModal.locator('#newPeerNameInput').fill(contactName);
        await newContactModal.locator('#confirmNewContactBtn').click();
        await expect(newContactModal).toBeHidden();
        await page.locator(`#chatListNav li[data-id="${contactId}"]`).click();
        await expect(page.locator('#currentChatTitleMain')).toHaveText(contactName);

        // 尝试自动授予麦克风权限 (通常在测试环境中，可以通过浏览器启动参数或配置文件来预先授予)
        // Playwright 默认会尝试自动接受权限弹窗，但某些情况下可能需要更明确的处理
        // context.grantPermissions 可以在创建 context 时设置
        // 这里我们依赖Playwright的默认行为
    });

    test('应该能够录制并发送一段短语音消息', async ({ page }) => {
        const voiceButton = page.locator('#voiceButtonMain');
        const audioPreviewContainer = page.locator('#audioPreviewContainer');

        // 1. 确保录音按钮可见且已启用
        await expect(voiceButton).toBeVisible();
        await expect(voiceButton).toBeEnabled();

        // 2. 按下录音按钮开始录制
        //    MediaManager.startRecording 使用 mousedown/touchstart
        await voiceButton.dispatchEvent('mousedown'); // 模拟按下
        await expect(voiceButton).toHaveClass(/recording/);
        await expect(voiceButton).toHaveText('🛑'); // 按钮文本变为停止图标
        const recordingTimer = voiceButton.locator('#recordingVoiceTimer');
        await expect(recordingTimer).toBeVisible(); // 计时器出现
        await expect(recordingTimer).toHaveText('00:00');

        // 3. 等待录制几秒钟 (例如 2 秒)
        await page.waitForTimeout(2500); // 等待超过2秒，确保计时器至少跳到 00:02
        await expect(recordingTimer).not.toHaveText('00:00'); // 验证计时器已更新
        const timerText = await recordingTimer.textContent();
        expect(timerText).toMatch(/00:0[2-3]/); // 应该在 00:02 或 00:03

        // 4. 松开录音按钮停止录制
        //    MediaManager.stopRecording 使用 mouseup/touchend
        await voiceButton.dispatchEvent('mouseup'); // 模拟松开
        await expect(voiceButton).not.toHaveClass(/recording/);
        await expect(voiceButton).toHaveText('🎙️'); // 按钮恢复原状
        await expect(recordingTimer).toBeHidden(); // 计时器消失

        // 5. 验证语音预览出现在输入区域
        await expect(audioPreviewContainer.locator('.voice-message-preview')).toBeVisible();
        await expect(audioPreviewContainer).toContainText('🎙️ 语音消息');
        const previewDuration = audioPreviewContainer.locator('.voice-message-preview span').first(); // "语音消息 (mm:ss)"
        const durationMatch = (await previewDuration.textContent() || "").match(/\((\d{2}:\d{2})\)/);
        expect(durationMatch).not.toBeNull();
        expect(durationMatch?.[1]).toMatch(/00:0[2-3]/); // 预览时长应与录制时长一致

        // 6. 点击发送按钮
        await page.locator('#sendButtonMain').click();

        // 7. 验证语音预览已从输入区域消失
        await expect(audioPreviewContainer.locator('.voice-message-preview')).toBeHidden();

        // 8. 验证语音消息已显示在聊天框中
        const voiceMessageInChat = page.locator('.message.sent .voice-message');
        await expect(voiceMessageInChat).toBeVisible();
        const sentDurationElement = voiceMessageInChat.locator('.voice-duration');
        const sentDurationText = await sentDurationElement.textContent();
        expect(sentDurationText).toMatch(/00:0[2-3]/); // 验证发送的消息时长
        await expect(voiceMessageInChat.locator('button.play-voice-btn')).toBeVisible();
    });

    test('应该能够取消已录制的语音预览', async ({ page }) => {
        const voiceButton = page.locator('#voiceButtonMain');
        const audioPreviewContainer = page.locator('#audioPreviewContainer');

        // 1. 开始并结束一次短录音以产生预览
        await voiceButton.dispatchEvent('mousedown');
        await page.waitForTimeout(1500); // 录制1秒
        await voiceButton.dispatchEvent('mouseup');
        const previewItem = audioPreviewContainer.locator('.voice-message-preview');
        await expect(previewItem).toBeVisible();

        // 2. 点击预览中的 "取消" 按钮
        await previewItem.locator('button.btn-cancel-preview').click();

        // 3. 验证语音预览已消失
        await expect(previewItem).toBeHidden();

        // 4. 验证 MessageManager.audioData 是否被清空 (间接验证)
        const messageInput = page.locator('#messageInput');
        await messageInput.fill("取消语音后发送文本");
        await page.locator('#sendButtonMain').click();
        await expect(page.locator(`.message.sent .message-content:has-text("取消语音后发送文本")`)).toBeVisible();
        // 确保没有语音消息被发送
        await expect(page.locator(`.message.sent .voice-message`)).toBeHidden({ timeout: 500 });
    });
});