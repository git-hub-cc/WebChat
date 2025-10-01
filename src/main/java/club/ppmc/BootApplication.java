/**
 *  WebChat应用程序的主入口点。
 *
 * 主要职责:
 * - 作为Spring Boot应用程序的启动类。
 * - `@SpringBootApplication` 包含了`@Configuration`, `@EnableAutoConfiguration`, `@ComponentScan`。
 * - `@EnableScheduling` 启用了对`@Scheduled`注解的支持，使得定时任务能够运行。
 * - `@EnableConfigurationProperties` [FIXED] 显式启用自定义的配置属性类，使其可以被注入。
 * - `@EnableJpaRepositories` [新增] 显式启用Spring Data JPA仓库功能。
 */
package club.ppmc;

import club.ppmc.config.FederationProperties;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.data.jpa.repository.config.EnableJpaRepositories; // [新增] 导入此注解
import org.springframework.scheduling.annotation.EnableScheduling;

@SpringBootApplication
@EnableScheduling
@EnableConfigurationProperties(FederationProperties.class)
@EnableJpaRepositories(basePackages = "club.ppmc.repository") // [新增] 启用JPA仓库并指定扫描包
public class BootApplication {

    /**
     * 应用程序的主方法。
     * @param args 命令行参数。
     */
    public static void main(String[] args) {
        SpringApplication.run(BootApplication.class, args);
    }
}