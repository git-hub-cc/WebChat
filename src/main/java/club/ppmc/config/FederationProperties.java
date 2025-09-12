/**
 * 定义联邦相关的配置属性。
 *
 * 主要职责:
 * - 从 `application.yml` 中安全地加载伙伴服务器节点列表 (`peers`) 和
 *   当前服务器的公开地址 (`selfUrl`)。
 * - 用于服务发现，让当前实例知道可以与哪些其他实例通信，并能正确标识自己。
 */
package club.ppmc.config;

import java.util.List;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.validation.annotation.Validated;
import jakarta.validation.constraints.NotNull;

@ConfigurationProperties(prefix = "federation")
@Validated
public record FederationProperties(
        @NotNull String selfUrl,
        List<String> peers
) {}