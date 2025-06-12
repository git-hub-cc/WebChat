/**
 * 此文件定义了一个专用于缓存管理的定时任务。
 *
 * 主要职责:
 * - 通过`@Scheduled`注解，配置一个定时执行的任务。
 * - 每日凌晨定时调用`OpenAIService`中的缓存清理方法，以清空过期的角色状态数据。
 *
 * 关联:
 * - `OpenAIService`: 调用其`clearCharacterStateCache`方法。
 * - `BootApplication`: 需要有`@EnableScheduling`注解来启用此定时任务。
 */
package club.ppmc.scheduler;

import club.ppmc.service.OpenAIService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

@Component
public class CacheManagerTask {

    private static final Logger logger = LoggerFactory.getLogger(CacheManagerTask.class);

    private final OpenAIService openAIService;

    public CacheManagerTask(OpenAIService openAIService) {
        this.openAIService = openAIService;
    }

    /**
     * 每日凌晨4点（上海时间）执行，清空角色的事件和心情缓存。
     * Cron表达式 "0 0 4 * * *" 表示每天的 04:00:00。
     * `zone`属性确保任务在指定的时区执行，避免了服务器时区设置不一致的问题。
     */
    @Scheduled(cron = "0 0 4 * * *", zone = "Asia/Shanghai")
    public void clearCharacterCacheDaily() {
        logger.info("定时任务触发：开始清理每日角色缓存。");
        try {
            openAIService.clearCharacterStateCache();
            logger.info("定时缓存清理任务成功完成。");
        } catch (Exception e) {
            // 捕获并记录所有异常，防止定时任务因未捕获的异常而停止后续执行。
            logger.error("执行定时缓存清理任务时发生错误。", e);
        }
    }
}