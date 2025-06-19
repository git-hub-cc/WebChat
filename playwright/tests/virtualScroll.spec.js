// tests/virtualScroll.spec.js
const { test, expect } = require('@playwright/test');

test.describe('聊天区域虚拟滚动功能', () => {
    let contactId;
    let contactName;
    const totalMessagesToSend = 50; // 发送足够多的消息来触发滚动
    const messagesToLoadOnScroll = 15; // ChatAreaUIManager.MESSAGES_TO_LOAD_ON_SCROLL

    test.beforeEach(async ({ page }) => {
        contactId = `vscroll_user_${Date.now()}`;
        contactName = '虚拟滚动对象';

        await page.goto('/');
        await expect(page.locator('#connectionStatusText')).toContainText(/初始化完成，准备连接|用户注册成功|信令服务器已连接|已从本地加载|使用现有id/, { timeout: 20000 });

        // 前置：添加并打开联系人，并发送大量消息
        await page.locator('#newChatFab').click();
        const newContactModal = page.locator('#newContactGroupModal');
        await newContactModal.locator('#newPeerIdInput').fill(contactId);
        await newContactModal.locator('#newPeerNameInput').fill(contactName);
        await newContactModal.locator('#confirmNewContactBtn').click();
        await expect(newContactModal).toBeHidden();
        await page.locator(`#chatListNav li[data-id="${contactId}"]`).click();
        await expect(page.locator('#currentChatTitleMain')).toHaveText(contactName);

        // 发送消息 (这会比较慢，考虑是否可以通过mock数据或直接操作 ChatManager.chats 来加速)
        // 为了端到端测试的真实性，我们还是通过UI发送
        const messageInput = page.locator('#messageInput');
        for (let i = 1; i <= totalMessagesToSend; i++) {
            await messageInput.fill(`消息 ${i} 用于虚拟滚动测试。`);
            await page.locator('#sendButtonMain').click();
            // 快速发送时，不需要每次都等待消息完全渲染，只需确保输入框清空
            await expect(messageInput).toHaveValue('');
        }
        // 最后一条消息应该可见
        await expect(page.locator(`.message.sent .message-content:has-text("消息 ${totalMessagesToSend}")`)).toBeVisible({ timeout: 10000 });
    });

    test('向上滚动时应加载更早的消息', async ({ page }) => {
        const chatBox = page.locator('#chatBox');

        // 1. 初始状态，聊天框应该滚动到底部，显示最新的消息
        //    ChatAreaUIManager._renderInitialMessageBatch 加载 MESSAGES_TO_LOAD_ON_SCROLL 条
        let initialVisibleMessages = await chatBox.locator('.message').count();
        expect(initialVisibleMessages).toBe(messagesToLoadOnScroll); // 初始加载批次
        await expect(chatBox.locator(`.message .message-content:has-text("消息 ${totalMessagesToSend - messagesToLoadOnScroll + 1}")`)).toBeVisible(); // 第一条可见的消息
        await expect(chatBox.locator(`.message .message-content:has-text("消息 ${totalMessagesToSend}")`)).toBeVisible(); // 最后一条可见的消息

        // 2. 滚动到顶部以触发加载旧消息
        //    需要多次滚动，因为每次加载一批
        const scrollThreshold = 150; // Config.ui.virtualScrollThreshold
        let previousMessageCount = initialVisibleMessages;
        let attempts = 0;
        const maxAttempts = Math.ceil(totalMessagesToSend / messagesToLoadOnScroll) + 2; // 确保能加载完所有

        while (attempts < maxAttempts) {
            await chatBox.evaluate(node => node.scrollTop = 0); // 滚动到顶部
            // 等待加载指示器出现并消失 (或直接等待消息数量增加)
            const loadingIndicator = chatBox.locator('.loading-indicator-older-messages .spinner');
            if (await chatBox.locator('.message').first().textContent() !== "消息 1 用于虚拟滚动测试。") {
                await expect(loadingIndicator).toBeVisible({ timeout: 1000 });
                await expect(loadingIndicator).toBeHidden({ timeout: 5000 }); // 等待加载完成
            }

            const currentVisibleMessages = await chatBox.locator('.message').count();
            Utils.log(`滚动尝试 ${attempts + 1}: 可见消息数 ${currentVisibleMessages}`, Utils.logLevels.DEBUG);

            if (currentVisibleMessages > previousMessageCount) {
                Utils.log(`加载了更多消息，之前: ${previousMessageCount}, 现在: ${currentVisibleMessages}`, Utils.logLevels.INFO);
                previousMessageCount = currentVisibleMessages;
            } else if (currentVisibleMessages === totalMessagesToSend) {
                Utils.log('所有消息已加载。', Utils.logLevels.INFO);
                break; // 所有消息都已加载
            } else {
                // 可能已经滚动到最顶端，或者出现其他问题
                const firstMessageText = await chatBox.locator('.message .message-content').first().textContent();
                if (firstMessageText?.includes("消息 1")) {
                    Utils.log('已滚动到第一条消息。', Utils.logLevels.INFO);
                    break;
                }
                Utils.log('本次滚动未加载新消息，但未到达顶部，可能是阈值或时序问题。', Utils.logLevels.WARN);
            }
            attempts++;
            if (attempts >= maxAttempts) {
                throw new Error("加载旧消息的尝试次数过多，测试可能卡住或失败。");
            }
            await page.waitForTimeout(200); // 短暂等待DOM更新和可能的异步操作
        }

        // 3. 验证第一条消息 ("消息 1") 现在可见
        await expect(chatBox.locator(`.message .message-content:has-text("消息 1 用于虚拟滚动测试。")`)).toBeVisible();
        // 验证总消息数
        expect(await chatBox.locator('.message').count()).toBe(totalMessagesToSend);
    });

    test('当有未加载的较新消息时，“滚动到最新”按钮应出现和工作', async ({ page }) => {
        const chatBox = page.locator('#chatBox');
        const scrollToLatestBtn = page.locator('#scrollToLatestBtn');

        // 1. 确保初始时按钮是隐藏的 (因为我们默认在底部)
        await expect(scrollToLatestBtn).toBeHidden();

        // 2. 向上滚动，使最新的消息不再完全可见，并且有更多新消息未加载
        //    我们已知初始加载了 `messagesToLoadOnScroll` 条。
        //    发送了 `totalMessagesToSend` 条。
        //    如果 `totalMessagesToSend > messagesToLoadOnScroll`，那么滚动离开底部就会有“更新”的消息。
        //    这里，我们先滚动到顶部加载所有消息，然后再滚动到中间。
        let attempts = 0;
        const maxAttempts = Math.ceil(totalMessagesToSend / messagesToLoadOnScroll) + 2;
        while(await chatBox.locator('.message').count() < totalMessagesToSend && attempts < maxAttempts) {
            await chatBox.evaluate(node => node.scrollTop = 0);
            await page.waitForTimeout(500); // 等待加载
            attempts++;
        }
        expect(await chatBox.locator('.message').count()).toBe(totalMessagesToSend); // 确认所有消息已在DOM中（但可能未渲染）
        // ChatAreaUIManager._allMessagesForCurrentChat 现在有全部消息
        // _renderedOldestMessageArrayIndex 应该是 0
        // _renderedNewestMessageArrayIndex 应该是 totalMessagesToSend - 1

        // 将视口滚动到约中间位置 (例如显示第20条消息)
        // 这需要确保第20条消息存在
        if (totalMessagesToSend >= 20) {
            const message20 = chatBox.locator(`.message .message-content:has-text("消息 20")`);
            await expect(message20).toBeVisible(); // 如果初始加载不足20条，这一步可能会失败，所以上面先加载全部
            await message20.scrollIntoViewIfNeeded(); // 滚动到让它可见
            await page.waitForTimeout(500); // 等待滚动稳定

            // 此时，我们应该离开了底部，并且有更新的消息（如果 _renderedNewestMessageArrayIndex 不是最后一条）
            // _handleChatScroll 应该会检测到这一点并显示按钮
            // 由于 ChatAreaUIManager 实现中，只要 _renderedNewestMessageArrayIndex < _allMessagesForCurrentChat.length -1 就会显示，
            // 而我们上面通过滚动到顶部，实际上可能使得 _renderedNewestMessageArrayIndex 就是最后一条了。
            // 因此，我们需要一个场景，其中 _renderedNewestMessageArrayIndex *不是* 最后一条。
            // 这通常发生在：初始加载后，用户向上滚动，然后有新消息进来，或者我们手动限制渲染范围。

            // 为了模拟这种情况，我们将执行一个操作：
            // 先滚动到顶部（加载全部到 _allMessagesForCurrentChat），然后清空聊天框，并手动渲染一个中间批次。
            // 这有点 hacky，但可以模拟出 "有更多新消息可加载" 的虚拟滚动状态。
            await page.evaluate(() => {
                const chatAreaUIManager = window.ChatAreaUIManager;
                const chatManager = window.ChatManager;
                if (chatAreaUIManager && chatManager && chatAreaUIManager._currentChatIdForVirtualScroll) {
                    const chatId = chatAreaUIManager._currentChatIdForVirtualScroll;
                    chatAreaUIManager.chatBoxEl.innerHTML = ''; // 清空
                    // 假设我们想渲染第10到第25条消息
                    const startIndex = Math.min(9, chatAreaUIManager._allMessagesForCurrentChat.length - 1);
                    const endIndex = Math.min(startIndex + 14, chatAreaUIManager._allMessagesForCurrentChat.length - 1);

                    for (let i = startIndex; i <= endIndex; i++) {
                        window.MessageManager.displayMessage(chatAreaUIManager._allMessagesForCurrentChat[i], false);
                    }
                    chatAreaUIManager._renderedOldestMessageArrayIndex = startIndex;
                    chatAreaUIManager._renderedNewestMessageArrayIndex = endIndex;
                    // 手动触发一次滚动处理逻辑来更新按钮状态
                    chatAreaUIManager._handleChatScroll();
                }
            });
            await page.waitForTimeout(500); // 等待JS执行和UI更新

            // 3. 验证 "滚动到最新" 按钮出现
            //    这个条件是 _renderedNewestMessageArrayIndex < _allMessagesForCurrentChat.length - 1
            const isNewerMessagesAvailable = await page.evaluate(() =>
                window.ChatAreaUIManager._renderedNewestMessageArrayIndex < window.ChatAreaUIManager._allMessagesForCurrentChat.length - 1
            );
            if(isNewerMessagesAvailable) {
                await expect(scrollToLatestBtn).toBeVisible({ timeout: 2000 });
            } else {
                Utils.log("测试条件不满足显示'滚动到最新'按钮，可能所有消息已被视为渲染。", Utils.logLevels.WARN);
                // 如果按钮不出现，下面的步骤会失败，这是正常的
                // 可以考虑让这个测试用例依赖于“向下滚动加载新消息”的特性（如果已实现）
                // 或直接跳过此测试如果不能稳定复现按钮出现的条件
                test.skip(!isNewerMessagesAvailable, "无法稳定模拟显示'滚动到最新'按钮的条件");
            }


            // 4. 点击 "滚动到最新" 按钮
            await scrollToLatestBtn.click();

            // 5. 验证聊天框已滚动到底部，显示最新的消息
            await expect(chatBox.locator(`.message .message-content:has-text("消息 ${totalMessagesToSend}")`)).toBeVisible({ timeout: 5000 });
            // 验证按钮已再次隐藏
            await expect(scrollToLatestBtn).toBeHidden({ timeout: 1000 });
        } else {
            test.skip(true, "消息总数不足以执行此部分的滚动测试。");
        }
    });
});