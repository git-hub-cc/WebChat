/**
 *  WebChat应用程序的主入口点。
 *
 * 主要职责:
 * - 作为Spring Boot应用程序的启动类。
 * - `@SpringBootApplication` 包含了`@Configuration`, `@EnableAutoConfiguration`, `@ComponentScan`。
 * - `@EnableScheduling` 启用了对`@Scheduled`注解的支持，使得定时任务(如`CacheManagerTask`)能够运行。
 */
package club.ppmc;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.scheduling.annotation.EnableScheduling;

@SpringBootApplication
@EnableScheduling
public class BootApplication {

    /**
     * 应用程序的主方法。
     * @param args 命令行参数。
     */
    public static void main(String[] args) {
        SpringApplication.run(BootApplication.class, args);
    }
}