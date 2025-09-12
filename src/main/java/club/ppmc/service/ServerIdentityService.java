package club.ppmc.service;

import jakarta.annotation.PostConstruct;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.UUID;

/**
 * [NEW] 负责管理服务器唯一标识符 (GUID) 的服务。
 *
 * 此服务确保每个服务器实例拥有一个持久化、全局唯一的ID。
 * 它的核心逻辑是“加载或创建”：
 * 1.  在服务启动时（`@PostConstruct`），它会尝试从一个指定的文件（路径由`application.yml`中的`server.guid.path`配置，默认为`data/server.guid`）加载GUID。
 * 2.  如果文件存在且包含内容，则使用该内容作为服务器的GUID。
 * 3.  如果文件不存在或为空，服务会生成一个新的UUID，将其作为当前实例的GUID，并立即将这个新GUID写入到文件中。
 *
 * 这样就保证了服务器重启后其GUID保持不变，这对于联邦网络中节点的稳定识别至关重要。
 * 这个GUID是服务器在联邦网络中的“身份证”，与网络地址（IP/域名）无关。
 */
@Service
public class ServerIdentityService {

    private static final Logger logger = LoggerFactory.getLogger(ServerIdentityService.class);

    @Value("${server.guid.path:data/server.guid}")
    private String guidFilePath;

    private String serverGuid;

    /**
     * 初始化服务器身份。
     * 此方法在Bean创建后立即执行，实现了GUID的加载或创建逻辑。
     */
    @PostConstruct
    private void initialize() {
        try {
            Path path = Paths.get(guidFilePath);
            if (Files.exists(path)) {
                this.serverGuid = Files.readString(path).trim();
                if (this.serverGuid.isEmpty()) {
                    throw new IOException("GUID文件为空。");
                }
                logger.info("成功从 {} 加载服务器GUID: {}", guidFilePath, this.serverGuid);
            } else {
                this.serverGuid = UUID.randomUUID().toString();
                // 确保父目录存在
                if (path.getParent() != null) {
                    Files.createDirectories(path.getParent());
                }
                Files.writeString(path, this.serverGuid);
                logger.info("未找到GUID文件，已生成新的服务器GUID并保存至 {}: {}", guidFilePath, this.serverGuid);
            }
        } catch (IOException e) {
            logger.error("加载或创建服务器GUID时发生严重错误。将使用临时的内存GUID。", e);
            this.serverGuid = UUID.randomUUID().toString();
            logger.warn("当前实例正在使用临时GUID: {}", this.serverGuid);
        }
    }

    /**
     * 获取此服务器实例的持久化全局唯一ID。
     * @return The server's GUID as a String.
     */
    public String getServerGuid() {
        return this.serverGuid;
    }
}