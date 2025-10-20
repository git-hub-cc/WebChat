/**
 * [已停用] 此文件定义的定时任务功能已被移除。
 *
 * 原主要职责:
 * - 每日凌晨定时调用`OpenAIService`中的缓存清理方法，以清空过期的角色状态数据。
 *
 * 关联:
 * - `BootApplication`: 需要有`@EnableScheduling`注解来启用此定时任务。
 */
package club.ppmc.scheduler;

import club.ppmc.service.OpenAIService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

@Component
public class CacheManagerTask {

    private static final Logger logger = LoggerFactory.getLogger(CacheManagerTask.class);

    public CacheManagerTask(OpenAIService openAIService) {
        // 构造函数保留以维持Spring Bean的依赖关系，但内部无逻辑
    }

    /**
     * [已停用] 原每日缓存清理任务。
     * 相关功能（角色事件和心情）已被移除，此定时任务不再需要执行。
     */
    // @Scheduled(cron = "0 0 4 * * *", zone = "Asia/Shanghai")
    public void clearCharacterCacheDaily() {
        // 方法体已清空，无操作
        logger.info("角色缓存清理任务已被停用。");
    }
}