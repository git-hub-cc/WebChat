// tests/groupChat.spec.js
const { test, expect } = require('@playwright/test');

test.describe('群组聊天功能', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('/');
        await expect(page.locator('#connectionStatusText')).toContainText(/初始化完成，准备连接|用户注册成功|信令服务器已连接|已从本地加载|使用现有id/, { timeout: 20000 });
    });

    test('应该能够成功创建一个新群组', async ({ page }) => {
        const newGroupName = `测试群组_${Date.now()}`;

        // 1. 点击 "新聊天/群组" FAB 按钮
        await page.locator('#newChatFab').click();

        // 2. 断言 "管理联系人与群组" 模态框已出现
        const newGroupModal = page.locator('#newContactGroupModal');
        await expect(newGroupModal).toBeVisible();
        await expect(newGroupModal.locator('h2')).toHaveText('管理联系人与群组');

        // 3. 在 "群组名称" 输入框中输入内容
        const groupNameInput = newGroupModal.locator('#newGroupNameInput');
        await groupNameInput.fill(newGroupName);
        await expect(groupNameInput).toHaveValue(newGroupName);

        // 4. (可选) 留空群组 ID 输入框以自动生成ID
        const groupIdInput = newGroupModal.locator('#newGroupIdInput');
        await expect(groupIdInput).toBeVisible(); //确保它存在
        await expect(groupIdInput).toHaveValue('');


        // 5. 点击 "创建 / 修改群组" 按钮
        const confirmButton = newGroupModal.locator('#confirmNewGroupBtnModal');
        await confirmButton.click();

        // 6. 断言模态框已关闭
        await expect(newGroupModal).toBeHidden();

        // 7. 断言成功通知出现
        const successNotification = page.locator('.notification.notification-success');
        await expect(successNotification).toBeVisible({ timeout: 5000 });
        await expect(successNotification.locator('.notification-message')).toHaveText(`群组 "${newGroupName}" 已创建。`);

        // 8. 断言新群组出现在聊天列表中 (所有或群组标签下)
        //    并且当前聊天区域已切换到新创建的群组
        const chatList = page.locator('#chatListNav');
        await expect(chatList.locator(`li .chat-list-name:has-text("${newGroupName}")`)).toBeVisible();

        const currentChatTitle = page.locator('#currentChatTitleMain');
        await expect(currentChatTitle).toHaveText(newGroupName);
        await expect(page.locator('#currentChatStatusMain')).toContainText('1 名成员'); // 创建者自己

        // 9. (可选) 断言通知消失
        await expect(successNotification).toBeHidden({ timeout: 6000 });
    });

    test('群主应该能够添加联系人到群组并在详情面板编辑AI提示词', async ({ page }) => {
        const groupName = `AI提示词测试群_${Date.now()}`;
        const contactIdToAdd = 'test_contact_for_group';
        const contactNameToAdd = '组员小明';
        const aiContactId = 'AI_Paimon'; // 假设 Paimon 是主题中定义的 AI
        const aiContactName = 'Paimon';
        const newAiPrompt = 'Paimon，现在请扮演一个严厉的老师。';

        // --- 前置步骤: 创建一个普通联系人和一个群组 ---
        // 添加普通联系人
        await page.locator('#newChatFab').click();
        const newContactModal = page.locator('#newContactGroupModal');
        await newContactModal.locator('#newPeerIdInput').fill(contactIdToAdd);
        await newContactModal.locator('#newPeerNameInput').fill(contactNameToAdd);
        await newContactModal.locator('#confirmNewContactBtn').click();
        await expect(newContactModal).toBeHidden();
        await expect(page.locator('.notification.notification-success:has-text("联系人 \"组员小明\" 已添加。")')).toBeVisible();

        // 创建群组
        await page.locator('#newChatFab').click();
        await newContactModal.locator('#newGroupNameInput').fill(groupName);
        await newContactModal.locator('#confirmNewGroupBtnModal').click();
        await expect(newContactModal).toBeHidden();
        await expect(page.locator(`.notification.notification-success:has-text("群组 \"${groupName}\" 已创建。")`)).toBeVisible();
        // 新群组应该已打开
        await expect(page.locator('#currentChatTitleMain')).toHaveText(groupName);
        const currentGroupId = await page.locator(`#chatListNav li.active[data-type="group"]`).getAttribute('data-id');
        expect(currentGroupId).not.toBeNull();

        // --- 测试步骤: 添加成员和编辑AI提示词 ---
        // 1. 打开群组详情面板
        await page.locator('#chatDetailsBtnMain').click();
        const detailsPanel = page.locator('#detailsPanel');
        await expect(detailsPanel).toBeVisible();
        await expect(detailsPanel.locator('#detailsName')).toHaveText(groupName);

        // 2. 添加 AI 成员 (Paimon)
        const contactsDropdown = detailsPanel.locator('#contactsDropdownDetails');
        await contactsDropdown.selectOption({ label: `${aiContactName} (AI助手)` });
        await detailsPanel.locator('#addMemberBtnDetails').click();
        await expect(page.locator(`.notification.notification-success:has-text("${aiContactName} 已被添加到群组。")`)).toBeVisible();
        await expect(detailsPanel.locator(`.member-item-detail:has-text("${aiContactName}")`)).toBeVisible();
        // 检查系统消息
        await expect(page.locator(`#chatBox .message.user:has-text("${aiContactName} 加入了群聊")`)).toBeVisible();


        // 3. 验证 AI 提示词编辑区域出现
        const groupAiPromptsSection = detailsPanel.locator('#groupAiPromptsSection');
        await expect(groupAiPromptsSection).toBeVisible();
        const paimonPromptEditor = groupAiPromptsSection.locator(`.ai-prompt-editor-item[data-ai-id="${aiContactId}"]`);
        await expect(paimonPromptEditor).toBeVisible();
        await expect(paimonPromptEditor.locator('h5')).toHaveText(`AI角色: ${aiContactName}`);

        // 4. 编辑 Paimon 的提示词
        const promptTextarea = paimonPromptEditor.locator('textarea.group-ai-prompt-textarea');
        await promptTextarea.fill(newAiPrompt);
        await expect(promptTextarea).toHaveValue(newAiPrompt);

        // 5. 点击保存
        await paimonPromptEditor.locator('button:has-text("保存指示")').click();

        // 6. 验证成功通知
        await expect(page.locator(`.notification.notification-success:has-text('AI "${aiContactName}" 在此群组的行为指示已更新。')`)).toBeVisible();

        // 7. 验证群聊中出现系统消息通知提示词变更
        // 注意：UserManager.userName 在测试环境中默认为 "我"
        await expect(page.locator(`#chatBox .message.system:has-text('您更新了 AI "${aiContactName}" 在群组中的行为指示。')`)).toBeVisible();

        // 8. 关闭详情面板
        await page.locator('#closeDetailsBtnMain').click();
        await expect(detailsPanel).toBeHidden();
    });
});