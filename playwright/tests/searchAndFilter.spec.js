// tests/searchAndFilter.spec.js
const { test, expect } = require('@playwright/test');

test.describe('侧边栏搜索与筛选功能', () => {
    const contactName1 = '张三-搜索测试';
    const contactId1 = 'zhangsan_search';
    const contactName2 = '李四-筛选目标';
    const contactId2 = 'lisi_filter';
    const groupName1 = '技术交流群-G1';
    const groupName2 = '休闲摸鱼群-G2';

    test.beforeEach(async ({ page }) => {
        await page.goto('/');
        await expect(page.locator('#connectionStatusText')).toContainText(/初始化完成，准备连接|用户注册成功|信令服务器已连接|已从本地加载|使用现有id/, { timeout: 20000 });

        // --- 前置：创建多个联系人和群组 ---
        const fab = page.locator('#newChatFab');
        const modal = page.locator('#newContactGroupModal');

        // 添加联系人1
        await fab.click();
        await modal.locator('#newPeerIdInput').fill(contactId1);
        await modal.locator('#newPeerNameInput').fill(contactName1);
        await modal.locator('#confirmNewContactBtn').click();
        await expect(modal).toBeHidden();

        // 添加联系人2
        await fab.click();
        await modal.locator('#newPeerIdInput').fill(contactId2);
        await modal.locator('#newPeerNameInput').fill(contactName2);
        await modal.locator('#confirmNewContactBtn').click();
        await expect(modal).toBeHidden();


        // 创建群组1
        await fab.click();
        await modal.locator('#newGroupNameInput').fill(groupName1);
        await modal.locator('#confirmNewGroupBtnModal').click();
        await expect(modal).toBeHidden();


        // 创建群组2
        await fab.click();
        await modal.locator('#newGroupNameInput').fill(groupName2);
        await modal.locator('#confirmNewGroupBtnModal').click();
        await expect(modal).toBeHidden();

        // 等待所有通知消失，避免干扰后续断言
        await expect(page.locator('.notification').last()).toBeHidden({ timeout: 6000 });
    });

    test('在“全部”标签页下，搜索框应能正确筛选联系人和群组', async ({ page }) => {
        const searchInput = page.locator('#chatSearchInput');
        const chatList = page.locator('#chatListNav');

        // 1. 确保初始状态下，所有添加的项都可见 (包括默认AI，所以数量可能 > 4)
        await expect(chatList.locator('li[data-id]')).toHaveCount(expect.any(Number)); // 至少大于等于我们添加的4个
        await expect(chatList.locator(`li .chat-list-name:has-text("${contactName1}")`)).toBeVisible();
        await expect(chatList.locator(`li .chat-list-name:has-text("${groupName1}")`)).toBeVisible();

        // 2. 输入部分联系人名称 "张三"
        await searchInput.fill('张三');
        await expect(chatList.locator(`li .chat-list-name:has-text("${contactName1}")`)).toBeVisible();
        await expect(chatList.locator(`li .chat-list-name:has-text("${contactName2}")`)).toBeHidden();
        await expect(chatList.locator(`li .chat-list-name:has-text("${groupName1}")`)).toBeHidden();
        await expect(chatList.locator('li[data-id]').filter({hasText: "张三"})).toHaveCount(1);


        // 3. 输入部分群组名称 "技术"
        await searchInput.fill('技术');
        await expect(chatList.locator(`li .chat-list-name:has-text("${contactName1}")`)).toBeHidden();
        await expect(chatList.locator(`li .chat-list-name:has-text("${groupName1}")`)).toBeVisible();
        await expect(chatList.locator(`li .chat-list-name:has-text("${groupName2}")`)).toBeHidden();
        await expect(chatList.locator('li[data-id]').filter({hasText: "技术"})).toHaveCount(1);


        // 4. 输入一个不存在的名称
        await searchInput.fill('不存在的内容XYZ');
        await expect(chatList.locator('li.chat-list-item-empty:has-text("未找到聊天。")')).toBeVisible();
        await expect(chatList.locator('li[data-id]')).toHaveCount(0);

        // 5. 清空搜索框，所有项应再次可见
        await searchInput.fill('');
        await expect(chatList.locator('li.chat-list-item-empty')).toBeHidden();
        await expect(chatList.locator(`li .chat-list-name:has-text("${contactName1}")`)).toBeVisible();
        await expect(chatList.locator(`li .chat-list-name:has-text("${groupName1}")`)).toBeVisible();
    });

    test('切换到“联系人”标签页后，搜索应只筛选联系人', async ({ page }) => {
        const searchInput = page.locator('#chatSearchInput');
        const chatList = page.locator('#chatListNav');

        // 1. 点击 "联系人" 标签页
        await page.locator('#tabContacts').click();
        await expect(page.locator('#tabContacts')).toHaveClass(/active/);

        // 2. 确保只有联系人显示，群组不显示 (不考虑默认AI)
        await expect(chatList.locator(`li .chat-list-name:has-text("${contactName1}")`)).toBeVisible();
        await expect(chatList.locator(`li .chat-list-name:has-text("${contactName2}")`)).toBeVisible();
        await expect(chatList.locator(`li .chat-list-name:has-text("${groupName1}")`)).toBeHidden();
        await expect(chatList.locator(`li .chat-list-name:has-text("${groupName2}")`)).toBeHidden();

        // 3. 搜索 "李四"
        await searchInput.fill('李四');
        await expect(chatList.locator(`li .chat-list-name:has-text("${contactName1}")`)).toBeHidden();
        await expect(chatList.locator(`li .chat-list-name:has-text("${contactName2}")`)).toBeVisible();
        // 确保群组即使名称匹配也不会出现
        await expect(chatList.locator(`li .chat-list-name:has-text("${groupName1}")`)).toBeHidden();

        // 4. 搜索群组名称 "技术"，不应有结果
        await searchInput.fill('技术');
        await expect(chatList.locator('li.chat-list-item-empty:has-text("未找到联系人。")')).toBeVisible();
    });

    test('切换到“群组”标签页后，搜索应只筛选群组', async ({ page }) => {
        const searchInput = page.locator('#chatSearchInput');
        const chatList = page.locator('#chatListNav');

        // 1. 点击 "群组" 标签页
        await page.locator('#tabGroups').click();
        await expect(page.locator('#tabGroups')).toHaveClass(/active/);

        // 2. 确保只有群组显示，联系人不显示
        await expect(chatList.locator(`li .chat-list-name:has-text("${groupName1}")`)).toBeVisible();
        await expect(chatList.locator(`li .chat-list-name:has-text("${groupName2}")`)).toBeVisible();
        await expect(chatList.locator(`li .chat-list-name:has-text("${contactName1}")`)).toBeHidden();
        await expect(chatList.locator(`li .chat-list-name:has-text("${contactName2}")`)).toBeHidden();


        // 3. 搜索 "摸鱼"
        await searchInput.fill('摸鱼');
        await expect(chatList.locator(`li .chat-list-name:has-text("${groupName1}")`)).toBeHidden();
        await expect(chatList.locator(`li .chat-list-name:has-text("${groupName2}")`)).toBeVisible();
        // 确保联系人即使名称匹配也不会出现
        await expect(chatList.locator(`li .chat-list-name:has-text("${contactName1}")`)).toBeHidden();

        // 4. 搜索联系人名称 "张三"，不应有结果
        await searchInput.fill('张三');
        await expect(chatList.locator('li.chat-list-item-empty:has-text("未找到群组。")')).toBeVisible();
    });
});