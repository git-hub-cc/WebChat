# P2P Web Chat (点对点网页聊天)

[![GitHub stars](https://img.shields.io/github/stars/git-hub-cc/P2P-Web-Chat.svg?style=social)](https://github.com/git-hub-cc/P2P-Web-Chat/stargazers)
[![GitHub forks](https://img.shields.io/github/forks/git-hub-cc/P2P-Web-Chat.svg?style=social)](https://github.com/git-hub-cc/P2P-Web-Chat/network/members)

一个现代化的、点对点的网页聊天应用，使用 HTML、CSS 和原生 JavaScript 构建，利用 WebRTC 进行直接通信，并辅以一个基于 WebSocket 的信令服务器。

**在线演示：**
https://175.178.216.24/

## ✨ 功能特性

*   **一对一 & 群组聊天：** 进行私密对话或创建群组。
    *   文本消息
    *   文件共享 (图片、视频、文档)
    *   语音消息
*   **实时通信：**
    *   一对一视频 & 音频通话
    *   视频通话画中画 (PiP) 模式，方便多任务处理。
*   **数据持久化：**
    *   聊天记录、联系人和用户设置使用 IndexedDB 存储在您的浏览器本地。
*   **用户体验：**
    *   联系人管理 (添加、移除、列表)
    *   适用于桌面和移动设备的响应式设计。
    *   用户可配置的设置 (用户 ID、自动连接联系人)。
    *   网络状态显示 & 质量指示器。
    *   新消息、通话和系统事件的通知。
*   **P2P 架构：**
    *   使用 WebRTC 建立直接的点对点连接。
    *   通过 WebSocket 服务器处理信令，用于连接协商。
    *   包含 STUN/TURN 服务器配置，用于 NAT 穿透。

## 🛠️ 技术栈

*   **前端：** HTML5, CSS3, 原生 JavaScript (ES6+ 模块)
*   **核心 P2P 技术：** WebRTC (RTCPeerConnection, RTCDataChannel, MediaStreams)
*   **信令：** WebSocket
*   **本地存储：** IndexedDB
*   **后端 (信令服务器)：** 本仓库包含一个 Java Spring Boot 应用 (`P2P-Web-Chat-Boot`)，可作为信令服务器。

## ⚙️ 工作原理

1.  **初始化：** 用户打开应用时，会生成一个唯一的用户 ID 或从本地存储加载。
2.  **信令：** 客户端连接到一个基于 WebSocket 的信令服务器。该服务器帮助对等端发现彼此并交换建立直接连接所需的消息 (如 SDP offer/answer 和 ICE candidates)。
3.  **P2P 连接：** 信令完成后，用户之间会建立一个直接的 WebRTC `RTCPeerConnection`。
    *   `RTCDataChannel` 用于发送文本消息、文件信息、语音消息数据以及群聊消息 (由群主中继)。
    *   `MediaStreams` 用于音频和视频通话数据。
4.  **本地持久化：** 所有联系人、聊天消息和用户设置都存储在浏览器的 IndexedDB 中，可在不同会话间保持。
5.  **群聊：** 群聊目前由群主中继。群主接收来自成员的消息，并将其转发给群组中的其他成员。

## 🚀 开始使用

### 先决条件

*   支持 WebRTC 的现代网页浏览器 (例如 Chrome, Firefox, Edge, Safari)。
*   Node.js 和 npm (可选，用于本地开发时使用 `live-server` 或类似工具)。
*   Java 17 和 Maven (如果您想运行提供的 Spring Boot 信令服务器)。

### 运行应用

#### 1. 信令服务器 (选择一个选项)

*   **选项 A: 使用提供的公共信令服务器 (如果可用且可信)**
    *   应用已在 `js/ConnectionManager.js` 中预配置为使用 `wss://175.178.216.24/signaling`。
    *   如果此服务器运行正常，您可能无需运行自己的信令服务器即可进行初步测试。

*   **选项 B: 运行内含的 Spring Boot 信令服务器**
    1.  克隆仓库：
        ```bash
        git clone https://github.com/git-hub-cc/P2P-Web-Chat.git
        cd P2P-Web-Chat
        ```
    2.  Spring Boot 项目通常命名为 `P2P-Web-Chat-Boot` 或位于根目录。如果是子目录，请导航至其目录。
    3.  使用 Maven 构建并运行服务器：
        ```bash
        mvn spring-boot:run
        ```
        这通常会在 `http://localhost:8080` 启动服务器。WebSocket 端点将是 `ws://localhost:8080/signaling` (或在 Spring Boot 应用中配置的地址)。
    4.  **重要：** 如果您运行自己的信令服务器，**必须** 更新 `js/ConnectionManager.js` 中的 `signalingServerUrl` 以指向您的本地服务器地址 (例如 `ws://localhost:8080/signaling`)。

#### 2. 前端

1.  前端由静态 HTML、CSS 和 JavaScript 文件组成。
2.  **强烈建议通过本地 HTTP 服务器提供前端文件**，因为浏览器安全限制 (CORS、`file://` 协议对 `type="module"` 脚本和媒体访问的限制)。
    *   如果您有 Node.js，可以使用 `live-server`：
        ```bash
        npm install -g live-server
        cd P2P-Web-Chat # (导航到前端文件的根目录)
        live-server
        ```
    *   或者，使用 Python 内置的 HTTP 服务器 (Python 3)：
        ```bash
        cd P2P-Web-Chat # (导航到前端文件的根目录)
        python -m http.server
        ```
        然后在浏览器中打开 `http://localhost:8000` (或显示的端口)。
3.  在两个不同的浏览器窗口或两台不同的设备上打开 `index.html` 文件 (如果使用本地信令服务器且没有为其配置 NAT 穿透，则设备需在同一网络下) 以测试 P2P 功能。

## 🔧 配置

*   **STUN/TURN 服务器：** 在 `js/Config.js` 中配置。这些对于 NAT 穿透至关重要，以便在不同网络之间建立 P2P 连接。项目包含一组默认配置。
*   **信令服务器 URL：** 在 `js/ConnectionManager.js` 中配置。

## 🧩 关键前端组件

JavaScript 代码库是模块化的：

*   `AppInitializer.js`: 初始化应用，设置事件监听器。
*   `UIManager.js`: 管理所有 UI 交互、DOM 更新和响应式设计。
*   `DBManager.js`: 处理 IndexedDB 操作，用于本地数据存储。
*   `UserManager.js`: 管理用户身份、设置和联系人。
*   `ConnectionManager.js`: 管理 WebSocket 信令和 WebRTC 对等连接。
*   `ChatManager.js`: 管理聊天会话，加载/保存消息。
*   `MessageManager.js`: 处理发送和显示不同类型的消息。
*   `GroupManager.js`: 管理群组创建、成员关系和群组消息广播。
*   `MediaManager.js`: 处理文件附件、语音录制和预览。
*   `VideoCallManager.js`: 管理一对一视频和音频通话，包括流处理和 UI。
*   `Config.js`: 存储应用范围的配置 (STUN/TURN、超时等)。
*   `Utils.js`: 提供工具函数 (日志记录、格式化、ID 生成)。
*   `EventEmitter.js`: 一个简单的事件发射器，用于模块间的解耦通信。

## 💡 未来增强

基于 `doc.md` 和常见的 P2P 聊天改进：

*   **端到端加密：** 在固有的 DTLS 安全性之上，为 DataChannel 消息实现对称加密 (例如 AES)，以实现聊天内容的真正端到端加密。
*   **去中心化群聊：**
    *   为较小规模的群组探索全网状 (full mesh) P2P 连接。
    *   研究类似 GossipSub 的协议 (例如，受 libp2p-gossipsub 启发)，以实现更具可扩展性和弹性的群组消息传递。
*   **群组视频/音频通话：** 集成 SFU (选择性转发单元) 或 MCU (多点会议单元) 以支持多方视频/音频通话，因为 WebRTC 网状结构对于许多参与者而言效率低下。
*   **改进的 UI/UX：** 进一步完善用户界面和体验。
*   **离线消息：** 如果信令服务器可以为离线用户排队消息。
*   **用户状态：** 更详细的在线/离线/正在输入指示器。
*   **消息状态：** 已发送/已送达/已读回执。

## 🤝 贡献

欢迎贡献！如果您想做出贡献，请随时 fork 本仓库，进行更改，然后提交拉取请求 (Pull Request)。对于重大更改，请先开启一个 issue 来讨论您想要更改的内容。

1.  Fork 项目
2.  创建您的功能分支 (`git checkout -b feature/AmazingFeature`)
3.  提交您的更改 (`git commit -m 'Add some AmazingFeature'`)
4.  推送到分支 (`git push origin feature/AmazingFeature`)
5.  开启一个 Pull Request


## 🙏 致谢

*   WebRTC 和浏览器供应商提供的 P2P 功能。
*   各种 P2P 聊天应用的启发。
*   社区经常共享的公共 STUN 服务器列表 (参见 `stun_servers.txt`)。
