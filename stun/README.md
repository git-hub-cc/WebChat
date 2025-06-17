# WebRTC STUN/TURN 服务器使用指南

本文档指导您如何配置项目中的 `Config.js` 文件，以使用不同的 STUN/TURN 服务器来优化 WebRTC 通信。

## 如何修改 `Config.js`

核心步骤是编辑 `Config.js` 文件中的 `peerConnectionConfig.iceServers` 数组。

文件路径: `Config.js` (/src/main/resources/static/js)

找到以下部分：

```javascript
// Config.js
const ConfigObj = {
    // ... 其他配置 ...

    peerConnectionConfig: {
        iceServers: [
            // 在这里添加您的服务器配置
            // 示例:
            // {
            //     urls: ["stun:stun.example.com:3478"]
            // },
            // {
            //     urls: [
            //         "turn:turn.example.com:3478?transport=udp",
            //         "turn:turn.example.com:3478?transport=tcp"
            //     ],
            //     username: "your_username",
            //     credential: "your_password"
            // }
        ],
        // ... 其他 WebRTC 配置 ...
    },

    // ... 其他配置 ...
};

window.Config = ConfigObj;
```

## 配置选项

### 选项 1：使用 Docker 自建 TURN/STUN 服务器 (推荐)

如果您希望拥有一个稳定可靠的 TURN/STUN 服务，推荐使用 Docker 和 Coturn 自建。

**前提条件:**
*   已安装 Docker 和 Docker Compose。
*   您有一台具有公网 IP 地址的服务器。

**步骤:**

1.  **准备配置文件**:
    *   **`docker-compose.yml`**: 使用项目提供的 `docker-compose.yml` 文件。它定义了 Coturn 服务。
        ```yaml
        version: '3.8'

        services:
          coturn:
            image: coturn/coturn
            container_name: coturn
            restart: always
            ports:
              - "3478:3478"        # STUN/TURN UDP & TCP
              - "3478:3478/udp"
              - "5349:5349"        # TLS/DTLS for TURN (if enabled)
              - "5349:5349/udp"
              - "50000-50100:50000-50100/udp" # UDP Relay ports
            volumes:
              - ./turnserver.conf:/etc/coturn/turnserver.conf # 映射配置文件
            command: ["-c", "/etc/coturn/turnserver.conf"]
            # 可选: 如果端口映射复杂，或避免Docker网络问题，可以考虑host模式
            # network_mode: "host"
        ```
    *   **`turnserver.conf`**: 这是 Coturn 的配置文件。您需要根据您的服务器情况进行修改。关键配置：
        ```ini
        # turnserver.conf (示例节选 - 请参考项目提供的完整文件)
        listening-port=3478
        # tls-listening-port=5349 # 如果启用 TLS/DTLS

        # ！！重要：替换为您的服务器公网 IP 或域名
        # 如果留空，coturn 会尝试自动检测，但明确指定更可靠
        # listening-ip=YOUR_SERVER_PUBLIC_IP
        # relay-ip=YOUR_SERVER_PUBLIC_IP
        realm=YOUR_SERVER_PUBLIC_IP_OR_DOMAIN

        # 启用长期凭据机制
        lt-cred-mech

        # ！！重要：修改为您的用户名和强密码
        user=test:123456

        # UDP 中继端口范围
        min-port=50000
        max-port=50100

        # ... 其他配置 ...
        ```
        **请务必修改 `realm` 为您的服务器公网 IP 或域名，并为 `user` 设置一个安全的用户名和密码。**

2.  **启动 Coturn 服务**:
    将 `docker-compose.yml` 和修改后的 `turnserver.conf` 文件放在服务器的同一个目录下，然后运行：
    ```bash
    docker-compose up -d
    ```
    Coturn 服务将在后台启动。

3.  **配置服务器防火墙**:
    确保您的服务器防火墙（例如 ufw, firewalld, iptables, 或云服务商的安全组）允许以下端口的入站流量：
    *   `3478/tcp`
    *   `3478/udp`
    *   `5349/tcp` (如果启用了 TLS)
    *   `5349/udp` (如果启用了 DTLS)
    *   `50000-50100/udp` (或您在 `turnserver.conf` 中配置的 UDP 中继端口范围)

4.  **在 `Config.js` 中配置**:
    获取您在 `turnserver.conf` 中设置的服务器信息：
    *   **服务器地址**: `YOUR_SERVER_PUBLIC_IP_OR_DOMAIN` (您在 `realm` 或 `relay-ip` 中指定的)
    *   **端口**: `3478` (或 `5349` 如果使用 `turns:`)
    *   **用户名**: `test` (或您在 `user` 中设置的用户名)
    *   **密码**: `123456` (或您在 `user` 中设置的密码)

    将这些信息添加到 `Config.js` 的 `iceServers` 数组中：
    ```javascript
    // Config.js -> peerConnectionConfig -> iceServers:
    [
        {
            urls: [
                "turn:YOUR_SERVER_PUBLIC_IP_OR_DOMAIN:3478?transport=udp",
                "turn:YOUR_SERVER_PUBLIC_IP_OR_DOMAIN:3478?transport=tcp"
                // 如果启用了 TLS/DTLS 并使用了 5349 端口:
                // "turns:YOUR_SERVER_PUBLIC_IP_OR_DOMAIN:5349?transport=tcp"
            ],
            username: "test", // 替换为您的用户名
            credential: "123456" // 替换为您的密码
        }
        // ... 可以添加其他 STUN 服务器作为备用 ...
    ]
    ```

### 选项 2：使用公共 STUN 服务器

您可以直接在 `Config.js` 中添加已知的公共 STUN 服务器。

**示例:**
```javascript
// Config.js -> peerConnectionConfig -> iceServers:
[
    {
        urls: ["stun:stun.l.google.com:19302"] // Google STUN 服务器
    },
    {
        urls: ["stun:stun.miwifi.com:3478"]    // 小米路由器的 STUN (示例)
    }
    // 您可以添加更多公共 STUN 服务器
]
```

### 选项 3：使用 Python 脚本查找并添加 STUN 服务器

您可以使用提供的 Python 脚本 (`stun_tester.py`) 来测试并找到可用的 STUN 服务器，然后将它们添加到 `Config.js`。

1.  **准备服务器列表**:
    创建一个名为 `stun_servers.txt` 的文件，每行包含一个 `host:port` 格式的 STUN 服务器地址。
    ```
    # stun_servers.txt 示例
    stun.l.google.com:19302
    stun.xten.com:3478
    # ... 从提供的列表或网络上搜集更多
    ```

2.  **运行脚本**:
    在包含 `stun_tester.py` 和 `stun_servers.txt` 的目录中执行：
    ```bash
    python stun_tester.py
    ```

3.  **获取结果并更新 `Config.js`**:
    脚本会输出测试结果。选择表现良好的服务器，并按以下格式添加到 `Config.js` 的 `iceServers` 数组中：

    ```javascript
    // Config.js -> peerConnectionConfig -> iceServers:
    [
        // ... 可能已有的其他服务器配置 ...
        {
            urls: ["stun:BEST_STUN_SERVER_FROM_SCRIPT_1:PORT"]
        },
        {
            urls: ["stun:BEST_STUN_SERVER_FROM_SCRIPT_2:PORT"]
        }
    ]
    ```

## 最终 `Config.js` 示例

修改后的 `iceServers` 数组可能如下所示，优先使用自建的 TURN 服务器，并辅以公共 STUN 服务器：

```javascript
// Config.js -> peerConnectionConfig
peerConnectionConfig: {
    iceServers: [
        // 自建的 TURN 服务器 (通过 Docker 部署)
        {
            urls: [
                "turn:your-server-public-ip.com:3478?transport=udp", // 替换为您的服务器信息
                "turn:your-server-public-ip.com:3478?transport=tcp"
            ],
            username: "your_turn_user", // 替换为您的用户名
            credential: "your_turn_password" // 替换为您的密码
        },
        // 从 Python 脚本找到的或已知的公共 STUN 服务器
        {
            urls: ["stun:stun.l.google.com:19302"]
        },
        {
            urls: ["stun:stun.miwifi.com:3478"] // 示例
        }
    ],
    iceTransportPolicy: 'all', // 通常保持 'all'
    // ...
}
```

**重要提示:**
*   **自建 TURN 服务器是保证连接可靠性的最佳选择。**
*   公共 STUN 服务器可以作为辅助，但不应完全依赖它们进行生产环境的 TURN 中继。
*   修改 `Config.js` 后，通常需要重新加载或重新构建您的应用程序才能使更改生效。