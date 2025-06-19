// tests/detailsPanel.spec.js
const { test, expect } = require('@playwright/test');

test.describe('详情面板功能', () => {
    let contactId;
    let contactName;
    const aiContactId = 'AI_Paimon'; // 假设这是默认主题的一个AI
    const aiContactName = 'Paimon';

    test.beforeEach(async ({ page }) => {
        contactId = `details_user_${Date.now()}`;
        contactName = '详情测试对象';

        await page.goto('/');
        await expect(page.locator('#connectionStatusText')).toContainText(/初始化完成，准备连接|用户注册成功|信令服务器已连接|已从本地加载|使用现有id/, { timeout: 20000 });

        // 前置：添加一个普通联系人
        await page.locator('#newChatFab').click();
        const newContactModal = page.locator('#newContactGroupModal');
        await newContactModal.locator('#newPeerIdInput').fill(contactId);
        await newContactModal.locator('#newPeerNameInput').fill(contactName);
        await newContactModal.locator('#confirmNewContactBtn').click();
        await expect(newContactModal).toBeHidden();
    });

    test('打开普通联系人聊天时，详情面板应显示正确信息和操作', async ({ page }) => {
        // 1. 打开与普通联系人的聊天
        await page.locator(`#chatListNav li[data-id="${contactId}"]`).click();
        await expect(page.locator('#currentChatTitleMain')).toHaveText(contactName);

        // 2. 点击聊天头部的详情按钮
        const chatDetailsButton = page.locator('#chatDetailsBtnMain');
        await expect(chatDetailsButton).toBeEnabled();
        await chatDetailsButton.click();

        // 3. 验证详情面板已显示，并且标题正确
        const detailsPanel = page.locator('#detailsPanel');
        await expect(detailsPanel).toBeVisible();
        await expect(detailsPanel.locator('#detailsPanelTitle')).toHaveText(`${contactName} 信息`);

        // 4. 验证联系人基本信息
        await expect(detailsPanel.locator('#detailsName')).toHaveText(contactName);
        await expect(detailsPanel.locator('#detailsId')).toHaveText(`ID: ${contactId}`);
        await expect(detailsPanel.locator('#detailsStatus')).toHaveText('离线'); // 假设默认离线

        // 5. 验证操作按钮可见 ("清空聊天记录", "删除联系人")
        await expect(detailsPanel.locator('#clearCurrentChatBtnDetails')).toBeVisible();
        await expect(detailsPanel.locator('#deleteContactBtnDetails')).toBeVisible();

        // 6. 验证 AI 相关部分、群组管理部分隐藏
        await expect(detailsPanel.locator('#aiContactAboutSection')).toBeHidden();
        await expect(detailsPanel.locator('#aiTtsConfigSection')).toBeHidden();
        await expect(detailsPanel.locator('#detailsGroupManagement')).toBeHidden();
        await expect(detailsPanel.locator('#groupAiPromptsSection')).toBeHidden();


        // 7. 验证资源预览部分可见
        await expect(detailsPanel.locator('#resourcePreviewSection')).toBeVisible();
        await expect(detailsPanel.locator('#resourcePreviewHeaderTitle')).toHaveText('资源');
        await expect(detailsPanel.locator('#resourceCategoryTabsContainer button.active')).toHaveText('图片'); // 默认图片

        // 8. 点击关闭详情按钮
        await detailsPanel.locator('#closeDetailsBtnMain').click();
        await expect(detailsPanel).toBeHidden();
    });

    test('打开AI联系人聊天时，详情面板应显示AI特定信息和TTS配置', async ({ page }) => {
        // 1. 打开与 AI 联系人的聊天
        await page.locator(`#chatListNav li[data-id="${aiContactId}"]`).click();
        await expect(page.locator('#currentChatTitleMain')).toHaveText(aiContactName);

        // 2. 点击聊天头部的详情按钮
        await page.locator('#chatDetailsBtnMain').click();

        // 3. 验证详情面板已显示，并且标题正确
        const detailsPanel = page.locator('#detailsPanel');
        await expect(detailsPanel).toBeVisible();
        await expect(detailsPanel.locator('#detailsPanelTitle')).toHaveText(`${aiContactName} 信息`);

        // 4. 验证 AI "关于" 部分可见且包含信息 (取决于 ThemeLoader.js 中 Paimon 的定义)
        const aiAboutSection = detailsPanel.locator('#aiContactAboutSection');
        await expect(aiAboutSection).toBeVisible();
        await expect(aiAboutSection.locator('#aiContactAboutName')).toHaveText(aiContactName); // 或者 aboutDetails.nameForAbout
        // 简单检查列表和文本是否存在即可，具体内容依赖主题数据
        await expect(aiAboutSection.locator('#aiContactBasicInfoList li')).not.toHaveCount(0);
        await expect(aiAboutSection.locator('#aiContactAboutText')).not.toBeEmpty();


        // 5. 验证 TTS 配置部分可见
        const aiTtsConfigSection = detailsPanel.locator('#aiTtsConfigSection');
        await expect(aiTtsConfigSection).toBeVisible();
        await expect(aiTtsConfigSection.locator('#aiTtsConfigHeader')).toContainText('TTS 配置');
        // 默认情况下，TTS 配置内容可能是折叠的，点击展开
        const ttsConfigContent = aiTtsConfigSection.locator('#aiTtsConfigContent');
        if (await ttsConfigContent.isHidden()) {
            await aiTtsConfigSection.locator('#aiTtsConfigHeader').click();
        }
        await expect(ttsConfigContent).toBeVisible();
        // 验证表单内至少有一个 TTS 模式选择框
        await expect(ttsConfigContent.locator('select[data-tts-param="tts_mode"]')).toBeVisible();
        await expect(ttsConfigContent.locator('button:has-text("保存 TTS 设置")')).toBeVisible();


        // 6. 验证普通联系人操作、群组管理部分隐藏
        await expect(detailsPanel.locator('#contactActionsDetails')).toBeHidden();
        await expect(detailsPanel.locator('#detailsGroupManagement')).toBeHidden();
        await expect(detailsPanel.locator('#groupAiPromptsSection')).toBeHidden();


        // 7. 点击资源预览的 "文件" 标签页
        await detailsPanel.locator('.resource-category-tab:has-text("文件")').click();
        await expect(detailsPanel.locator('#resourceCategoryTabsContainer button.active')).toHaveText('文件');
        // 验证网格内容可能为空或显示加载中/空消息
        const resourceGrid = detailsPanel.locator('#resourceGridContainer');
        const emptyMessage = resourceGrid.locator('.resource-grid-empty-message');
        await expect(emptyMessage.or(resourceGrid.locator('.resource-preview-item').first())).toBeVisible(); // 要么有项，要么有空消息
    });

    test('人员大厅按钮应能正确切换到人员大厅视图', async ({ page }) => {
        // 1. 点击聊天头部的 "人员大厅" 按钮
        const peopleLobbyButton = page.locator('#peopleLobbyButtonMain');
        await expect(peopleLobbyButton).toBeEnabled();
        await peopleLobbyButton.click();

        // 2. 验证详情面板区域已显示，并且标题为 "人员大厅"
        const detailsPanel = page.locator('#detailsPanel');
        await expect(detailsPanel).toBeVisible();
        await expect(detailsPanel.locator('#detailsPanelTitle')).toHaveText('人员大厅');

        // 3. 验证聊天详情内容已隐藏，人员大厅内容已显示
        await expect(detailsPanel.locator('#detailsPanelContent')).toBeHidden();
        const peopleLobbyContent = detailsPanel.locator('#peopleLobbyContent');
        await expect(peopleLobbyContent).toBeVisible();

        // 4. 验证人员大厅列表存在，并且刷新按钮可见
        await expect(peopleLobbyContent.locator('#peopleLobbyList')).toBeVisible();
        await expect(peopleLobbyContent.locator('#peopleLobbyRefreshBtn')).toBeVisible();

        // 5. (可选) 点击刷新按钮，验证列表可能更新 (或者至少没有报错)
        //    由于实际的在线用户列表是动态的，我们主要关注按钮功能
        const refreshBtn = peopleLobbyContent.locator('#peopleLobbyRefreshBtn');
        await refreshBtn.click();
        // 期望看到加载状态，然后恢复。
        await expect(refreshBtn).toHaveClass(/loading/, { timeout: 500 }); // 按钮应该有加载中的类
        await expect(refreshBtn).not.toHaveClass(/loading/, { timeout: 10000 }); // 加载应该在10秒内完成

        // 6. 再次点击人员大厅按钮，应隐藏面板 (因为已经是大厅视图)
        await peopleLobbyButton.click();
        await expect(detailsPanel).toBeHidden();
    });
});