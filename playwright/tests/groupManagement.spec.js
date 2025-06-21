// tests/groupManagement.spec.js
const { test, expect } = require('@playwright/test');

test.describe('群组创建与成员管理功能', () => {
    const newGroupName = `测试群组_${Date.now()}`;
    // 假设存在一个可以被添加为成员的普通联系人
    const REGULAR_CONTACT_ID_TO_ADD = 'test_user_002';
    const REGULAR_CONTACT_NAME_TO_ADD = '普通联系人小明';

    test.beforeEach(async ({ page }) => {
        // 导航到应用
        await page.goto('/');
        // 等待应用初始化
        await expect(page.locator('#connectionStatusText')).toContainText(/初始化完成，准备连接|用户注册成功|信令服务器已连接|已从本地加载|使用现有id/, { timeout: 20000 });

        // 预先添加一个普通联系人，用于后续的加群操作
        // (如果这个联系人已经在其他测试中被添加且数据持久化，可以考虑跳过这一步或确保其存在)
        await page.locator('#newChatFab').click();
        const newContactModal = page.locator('#newContactGroupModal');
        await expect(newContactModal).toBeVisible();
        await newContactModal.locator('#newPeerIdInput').fill(REGULAR_CONTACT_ID_TO_ADD);
        await newContactModal.locator('#newPeerNameInput').fill(REGULAR_CONTACT_NAME_TO_ADD);
        await newContactModal.locator('#confirmNewContactBtn').click();
        await expect(page.locator(`.notification.notification-success:has-text("联系人 \\"${REGULAR_CONTACT_NAME_TO_ADD}\\" 已添加。")`)).toBeVisible({ timeout: 5000 });
        await expect(newContactModal).toBeHidden(); // 模态框应关闭
    });

    test('应该能够创建新群组，添加和移除成员', async ({ page }) => {
        // 1. 点击 "新聊天/群组" FAB 按钮
        await page.locator('#newChatFab').click();
        const newContactGroupModal = page.locator('#newContactGroupModal');
        await expect(newContactGroupModal).toBeVisible();

        // 2. 输入群组名称
        await newContactGroupModal.locator('#newGroupNameInput').fill(newGroupName);
        // (可选) 输入自定义群组 ID，这里我们让它自动生成

        // 3. 点击 "创建 / 修改群组" 按钮
        await newContactGroupModal.locator('#confirmNewGroupBtnModal').click();

        // 4. 断言模态框已关闭
        await expect(newContactGroupModal).toBeHidden();
        // 5. 断言成功创建群组的通知出现
        await expect(page.locator(`.notification.notification-success:has-text("群组 \\"${newGroupName}\\" 已创建。")`)).toBeVisible({ timeout: 5000 });

        // 6. 断言新群组出现在聊天列表中，并且当前聊天已切换到该群组
        const newGroupInList = page.locator(`#chatListNav .chat-list-item.active .chat-list-name:has-text("${newGroupName}")`);
        await expect(newGroupInList).toBeVisible();
        await expect(page.locator('#currentChatTitleMain')).toHaveText(newGroupName);
        const currentGroupId = await newGroupInList.locator('xpath=ancestor::li').getAttribute('data-id'); // 获取群组ID

        // --- 添加成员 ---
        // 7. 打开群组详情面板
        await page.locator('#chatDetailsBtnMain').click();
        const detailsPanel = page.locator('#detailsPanel');
        await expect(detailsPanel).toBeVisible();
        await expect(detailsPanel.locator('#detailsPanelTitle')).toContainText(`${newGroupName} 信息`);

        // 8. 在详情面板的 "添加成员" 下拉框中选择之前创建的普通联系人
        const contactsDropdown = detailsPanel.locator('#contactsDropdownDetails');
        await expect(contactsDropdown).toBeVisible();
        // 使用部分文本匹配，因为选项可能是 "普通联系人小明" 或 "普通联系人小明 (AI助手)"
        // 这里我们假设它不是AI助手
        await contactsDropdown.selectOption({ label: REGULAR_CONTACT_NAME_TO_ADD });


        // 9. 点击 "添加" 按钮
        await detailsPanel.locator('#addMemberBtnDetails').click();

        // 10. 断言成功添加成员的通知出现
        await expect(page.locator(`.notification.notification-success:has-text("${REGULAR_CONTACT_NAME_TO_ADD} 已被添加到群组。")`)).toBeVisible({ timeout: 5000 });

        // 11. 验证成员列表中包含新添加的成员
        const memberListDetails = detailsPanel.locator('#groupMemberListDetails');
        const addedMemberItem = memberListDetails.locator(`.member-item-detail:has-text("${REGULAR_CONTACT_NAME_TO_ADD}")`);
        await expect(addedMemberItem).toBeVisible();
        // 验证群组成员数量已更新 (例如，从1变为2)
        await expect(detailsPanel.locator('#groupMemberCount')).toHaveText('2'); // 群主 + 新成员

        // --- 移除成员 ---
        // 12. 点击刚添加成员旁边的移除按钮 "✕"
        const removeMemberButton = addedMemberItem.locator('button.remove-member-btn-detail');
        await expect(removeMemberButton).toBeVisible();
        await removeMemberButton.click();

        // 13. 断言成功移除成员的通知出现
        await expect(page.locator(`.notification.notification-success:has-text("${REGULAR_CONTACT_NAME_TO_ADD} 已被移出群组。")`)).toBeVisible({ timeout: 5000 });

        // 14. 验证成员列表中不再包含该成员
        await expect(addedMemberItem).toBeHidden();
        // 验证群组成员数量已更新 (例如，从2变回1)
        await expect(detailsPanel.locator('#groupMemberCount')).toHaveText('1');

        // 15. 关闭详情面板
        await page.locator('#closeDetailsBtnMain').click();
        await expect(detailsPanel).toBeHidden();
    });
});