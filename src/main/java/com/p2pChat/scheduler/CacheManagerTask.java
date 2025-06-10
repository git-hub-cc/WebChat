package com.p2pChat.scheduler; // 建议放在一个新的包，如 'scheduler' 或 'tasks'

import com.p2pChat.service.OpenAIService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/**
 * 一个专用的定时任务类，负责管理应用程序的缓存。
 */
@Component // 标记为Spring组件，以便被扫描和实例化
public class CacheManagerTask {

    private static final Logger logger = LoggerFactory.getLogger(CacheManagerTask.class);

    private final OpenAIService openAIService;

    /**
     * 通过构造函数注入 OpenAIService。
     * Spring会自动将 OpenAIServiceImpl 的实例注入进来。
     * @param openAIService 业务服务
     */
    @Autowired
    public CacheManagerTask(OpenAIService openAIService) {
        this.openAIService = openAIService;
    }

    /**
     * 定时任务：每日凌晨4点调用服务层的方法来清空角色的事件和心情缓存。
     * 使用 Cron 表达式 "0 0 4 * * *" 表示每天的 4:00:00。
     * 指定时区 "Asia/Shanghai" 以确保在正确的时区执行。
     */
    @Scheduled(cron = "0 0 4 * * *", zone = "Asia/Shanghai")
    public void clearCharacterCacheDaily() {
        logger.info("Scheduled task triggered: Clearing daily character cache.");
        try {
            // 调用服务层的方法，而不是直接操作数据结构
            openAIService.clearCharacterStateCache();
            logger.info("Scheduled cache clearing task completed successfully.");
        } catch (Exception e) {
            // 捕获任何潜在的异常，防止定时任务本身失败
            logger.error("An error occurred during the scheduled cache clearing task.", e);
        }
    }
}