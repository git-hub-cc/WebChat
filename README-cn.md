# P2P 现代 Web 聊天应用

[![GitHub stars](https://img.shields.io/github/stars/git-hub-cc/P2P-Web-Chat.svg?style=social)](https://github.com/git-hub-cc/P2P-Web-Chat/stargazers)
[![GitHub forks](https://img.shields.io/github/forks/git-hub-cc/P2P-Web-Chat.svg?style=social)](https://github.com/git-hub-cc/P2P-Web-Chat/network/members)

[English Version](./README.md)

一款功能丰富、现代化的点对点（P2P）Web聊天应用，使用原生 JavaScript、HTML 和 CSS 构建。它利用 WebRTC 进行直接的 P2P 通信，支持文本、文件共享、语音消息以及实时音频/视频/屏幕共享通话，通过基于 WebSocket 的信令服务器完成初始对等发现后，最大限度地减少了对中央服务器的依赖。该应用还配备了具有文本转语音（TTS）功能的主题化 AI 助手联系人。

**在线演示：**
https://175.178.216.24/

## ✨ 功能特性

*   **核心 P2P 通信 (WebRTC):**
    *   **一对一和群组聊天：**进行私人对话或创建群组。
        *   文本消息
        *   文件共享（图片、视频、文档）
        *   语音消息
    *   **实时音频/视频通话：**发起和接收 P2P 音频/视频通话（一对一）。
        *   视频通话支持画中画（PiP）模式，让您可以同时处理多项任务。
    *   **屏幕共享：**与对等方共享您的屏幕。
*   **信令与 P2P 架构：**
    *   使用 WebSocket 服务器进行初始对等发现、offer/answer 交换和 ICE 候选者协商。
    *   使用 WebRTC 建立直接的点对点连接。
    *   包含用于 NAT 穿透的 STUN/TURN 服务器配置。
    *   自动尝试重新连接到信令服务器。
*   **联系人与群组管理：**
    *   添加、移除和列出联系人。
    *   创建、管理和参与群组聊天。
    *   群组聊天目前以群主中继模式运行：群主接收成员的消息，并将其转发给群组中的其他成员。
    *   群主可以控制成员的添加/移除。
*   **AI 助手联系人：**
    *   基于流行虚拟 IP 的主题化 AI 角色（例如，原神、仙逆、遮天）。
    *   通过可配置的 OpenAI 兼容 API 生成 AI 回复。
    *   **文本转语音 (TTS)：**AI 回复可以通过可配置的 TTS API（例如，GSV AI Lab）作为音频播放。
    *   为每个 AI 联系人提供可自定义的 TTS 设置（语音、语速、情感等）。
*   **用户界面与体验 (UI/UX):**
    *   **模块化设计：**通过各种 UI 管理器实现清晰的关注点分离。
    *   **响应式设计：**适应不同的屏幕尺寸（桌面/移动设备）。
    *   **主题化：**
        *   支持多种主题（例如，原神、斗破苍穹、仙逆、遮天、蜡笔小新、迷宫饭、咒术回战、Telegram）。
        *   大多数主题提供浅色和深色模式。
        *   主题选择在会话间保持不变。
        *   自动检测系统颜色方案（“自动”模式）。
    *   **富媒体预览：**在发送前预览图像、音频和基本文件。
    *   **通知：**针对各种事件（新消息、来电、系统事件）的应用内 UI 通知。
    *   **模态框：**用于设置、新建联系人/群组、通话、确认等。
    *   **用户 ID 管理：**自动生成用户 ID，提供复制选项和可配置设置。
*   **数据持久化：**
    *   使用 IndexedDB (`DBManager`) 在浏览器本地存储聊天记录、联系人、用户信息和设置。
*   **网络与连接管理：**
    *   带有 UI 指示器和质量指示器的网络状态监控。
    *   通过 SDP offer/answer 交换进行手动连接的选项。
    *   对等方之间自动 P2P 重新连接尝试。
    *   大消息/文件通过 DataChannel 分块进行可靠传输。
*   **配置：**
    *   外部 `Config.js` 文件，方便设置服务器 URL（信令、AI、TTS、TURN）、超时和其他参数。
    *   用户可配置的设置（例如，自动连接到联系人）。
*   **错误处理：**
    *   针对 UI 和应用逻辑的全局错误处理程序。
    *   图像加载错误的优雅降级处理。

## 📸 截图

以下是应用程序运行中的一些截图，展示了不同的功能和主题：

**聊天界面：**
*   桌面视图：
    ![聊天界面 - 桌面](screenshots/Chat%20Interface/Desktop/img.png)
*   移动视图：
*   
    <img src="./screenshots/Chat%20Interface/Mobile/01.png" alt="聊天界面 - 移动版 1" style="width:30%;">
    <img src="./screenshots/Chat%20Interface/Mobile/02.png" alt="聊天界面 - 移动版 2" style="width:30%;">
    <img src="./screenshots/Chat%20Interface/Mobile/03.png" alt="聊天界面 - 移动版 3" style="width:30%;">

**视频通话：**
*   启用画中画（PiP）模式的视频通话：
    ![启用画中画的视频通话](screenshots/Video%20Call%20with%20PiP/04.png)

**主题示例：**
*   蜡笔小新主题（浅色模式）：
    ![蜡笔小新主题 - 浅色](screenshots/Themes/%E8%9C%A1%E7%AC%94%E5%B0%8F%E6%96%B0-%E6%B5%85%E8%89%B2.png)
*   迷宫饭主题（浅色模式）：
    ![迷宫饭主题 - 浅色](screenshots/Themes/%E8%BF%B7%E5%AE%AB%E9%A5%AD-%E6%B5%85%E8%89%B2.png)
*   迷宫饭主题（深色模式）：
    ![迷宫饭主题 - 深色](screenshots/Themes/%E8%BF%B7%E5%AE%AB%E9%A5%AD-%E6%B7%B1%E8%89%B2.png)

## 🛠️ 技术栈

*   **前端：** HTML5, CSS3, 原生 JavaScript (ES6+ 模块)
*   **核心 P2P 技术：** WebRTC (RTCPeerConnection, RTCDataChannel, MediaStream API)
*   **信令：** WebSockets
*   **本地存储：** IndexedDB
*   **API (外部，如果使用 AI 功能)：**
    *   OpenAI 兼容的 API 用于 AI 聊天补全。
    *   GSV AI Lab（或类似服务）用于文本转语音。

## ⚙️ 工作原理

1.  **初始化：**当用户打开应用时，会生成一个唯一的用户 ID 或从本地存储加载。
2.  **信令：**客户端连接到基于 WebSocket 的信令服务器。此服务器帮助对等方发现彼此并交换建立直接连接所需的消息（如 SDP offer/answer 和 ICE 候选者）。
3.  **P2P 连接：**信令完成后，用户之间将建立直接的 WebRTC `RTCPeerConnection` 连接。
    *   `RTCDataChannel` 用于文本消息、文件信息、语音消息数据和群聊消息（由群主中继）。
    *   `MediaStreams` 用于音频/视频通话数据。
4.  **本地持久化：**所有联系人、聊天消息和用户设置都存储在浏览器的 IndexedDB 中，使其在会话间可用。
5.  **群组聊天：**群组聊天目前由群主中继。群主接收成员的消息，并将其转发给群组中的其他成员。

## 🚀 快速开始与安装

### 先决条件

*   支持 WebRTC 的现代 Web 浏览器（例如，Chrome, Firefox, Edge, Safari）。
*   Java 17 和 Maven（如果您想运行提供的 Spring Boot 信令服务器）。

### 1. 配置应用程序

*   打开 `js/Config.js`（或根目录下的 `Config.js`）。
*   **关键：**使用您的实际 URL 和凭据更新 `server` 对象：
    *   `signalingServerUrl`: 您的 WebSocket 信令服务器 URL。应用可能已预配置为使用 `wss://175.178.216.24/signaling`。
    *   `apiEndpoint` (用于 AI 功能): 您的 OpenAI 兼容 API 端点。
    *   `api_key` (用于 AI 功能): 您的 AI 服务 API 密钥。
    *   `model` (用于 AI 功能): 您想使用的 AI 模型。
    *   `ttsApiEndpoint` (用于 AI 功能): 您的 TTS API 端点 (例如，GSV AI Lab)。
    *   `iceServers`: 配置您的 STUN/TURN 服务器详细信息以进行 NAT 穿透。可能提供了默认设置或示例 (例如, `turn:175.178.216.24:3478`)。**请将其替换为您自己的或受信任的公共服务器。**
*   根据需要调整 `Config.js` 中的其他设置（超时、日志级别等）。

### 2. 信令服务器 (选择一个)

*   **选项 A：使用公共信令服务器 (如果可用且受信任)**
    *   如果 `js/Config.js` 中的 `signalingServerUrl` 指向一个可操作的公共服务器 (如预配置的 `wss://175.178.216.24/signaling`)，您可能不需要为初始测试运行自己的服务器。

*   **选项 B：运行捆绑的 Spring Boot 信令服务器 (`P2P-Web-Chat-Boot`)**
    1.  克隆仓库：
        ```bash
        git clone https://github.com/git-hub-cc/P2P-Web-Chat.git # 或您的特定仓库 URL
        cd P2P-Web-Chat
        ```
    2.  导航到 Spring Boot 项目目录 (例如, `P2P-Web-Chat-Boot`)。
    3.  使用 Maven 构建并运行服务器：
        ```bash
        mvn spring-boot:run
        ```
        这通常会在 `http://localhost:8080` 上启动服务器。WebSocket 端点将是 `ws://localhost:8080/signaling` (或在 Spring Boot 应用中配置的)。
    4.  **重要：**如果您运行自己的信令服务器，您**必须**更新 `js/Config.js` 中的 `signalingServerUrl` 以指向您的本地服务器地址 (例如, `ws://localhost:8080/signaling`)，并根据需要修改 `api_key` 和其他配置。

### 3. 在浏览器中访问

*   打开浏览器并导航到前端应用程序提供服务的地址（如果本地运行 Spring Boot 服务器，这通常是 `http://localhost:8080`，或者如果您将静态文件部署到其他地方，则为其他地址）。
*   在两个不同的浏览器窗口或两个不同的设备上打开应用程序（如果在没有为其配置 NAT 穿透的本地信令服务器的同一网络上）以测试 P2P 功能。
*   为确保 P2P 连接在不同机器/网络之间正常工作，请确保您的信令服务器和 TURN 服务器已正确配置且可访问。

## 🚀 使用方法

*   **用户 ID：**首次启动时会生成并存储一个唯一的用户 ID。此 ID 用于 P2P 连接。您可以从主菜单 (☰) 中找到并复制您的 ID。
*   **主菜单 (☰)：**
    *   **用户 ID：**查看并复制您的用户 ID。
    *   **网络状态：**检查 WebRTC 能力和信令服务器连接状态。
    *   **偏好设置：**切换是否自动连接到联系人。
    *   **AI 服务器配置：**设置 AI 和 TTS 的 API 端点、密钥和模型。
    *   **主题与颜色方案：**选择您偏好的应用主题和颜色模式（浅色/深色/自动）。
    *   **手动连接：**通过交换 SDP (会话描述协议) 信息来发起或响应手动 P2P 连接。
    *   **危险区域：**重置连接、清除联系人或清除所有聊天记录。
*   **添加联系人：**
    *   点击浮动操作按钮 (+) 打开“新建聊天/群组”模态框。
    *   输入对方的 ID 和可选的名称以添加联系人。
    *   将尝试进行初始连接。
*   **创建群组：**
    *   在“新建聊天/群组”模态框中，切换到群组标签页并输入群组名称。
    *   当群聊打开时，群成员可以从详情面板进行管理（由群主操作）。
*   **开始聊天/通话：**
    *   从侧边栏列表中选择一个联系人或群组。
    *   使用输入字段发送文本消息。
    *   使用图标附加文件 (📎)、发送语音消息 (🎙️)，或发起视频 (📹)、音频 (📞) 或屏幕共享 (🖥️) 通话。
*   **AI 联系人：**
    *   根据所选主题预加载特殊的 AI 联系人。
    *   像与常规联系人一样与他们互动。
    *   他们的 TTS 设置可以在详情面板 (ⓘ) 中配置。
*   **详情面板 (ⓘ)：**
    *   查看联系人/群组信息。
    *   清除当前聊天的聊天记录。
    *   删除联系人、离开/解散群组（群主权限）。
    *   管理群组成员（如果群主）。
    *   配置 AI 联系人的 TTS。

## 🎨 主题化

该应用程序支持灵活的主题系统：

*   **主题文件：**
    *   CSS 文件位于 `css/` 目录中 (例如, `Genshin Impact-light.css`, `Battle Through the Heavens-dark.css`)。这些文件定义了视觉外观。
    *   JavaScript 数据文件位于 `data/` 目录中 (例如, `Genshin Impact.js`, `Battle Through the Heavens.js`)。这些文件定义了特定主题的 `SPECIAL_CONTACTS_DEFINITIONS`，包括 AI 角色、初始消息、系统提示和默认 TTS 配置。
*   **主题选择：**
    *   可以从主菜单 (☰) 中选择主题。
    *   选择包括基础主题和颜色方案（浅色、深色、自动）。
    *   `ThemeLoader.js` 根据用户选择和系统偏好（对于“自动”模式）处理加载适当的 CSS 和 JS 数据文件。
*   **添加新主题：**
    1.  在 `css/` 目录中为您的主题创建新的 CSS 文件 (例如, `mytheme-light.css`, `mytheme-dark.css`)。定义自定义 CSS 变量和样式。
    2.  （可选）如果您的主题具有独特的 AI 角色，请在 `data/` 目录中创建一个新的 JS 数据文件 (例如, `mytheme.js`)，定义 `SPECIAL_CONTACTS_DEFINITIONS`。
    3.  在 `ThemeLoader.js` 的 `ThemeLoader.themes` 对象中注册您的主题。

## 🏗️ 模块化设计与核心前端组件

JavaScript 代码库是模块化的，促进了关注点分离和可维护性。核心模块包括：

*   **核心逻辑与管理器：**
    *   `AppInitializer.js`: (应用初始化器) 初始化应用程序，设置事件监听器。
    *   `ConnectionManager.js`: (连接管理器) 管理 WebSocket 信令和 WebRTC 对等连接。
    *   `DBManager.js`: (数据库管理器) 处理 IndexedDB 操作以进行本地数据存储。
    *   `UserManager.js`: (用户管理器) 管理用户身份、设置和联系人。
    *   `ChatManager.js`: (聊天管理器) 管理聊天会话、加载/保存消息。
    *   `MessageManager.js`: (消息管理器) 处理发送和显示不同类型的消息。
    *   `GroupManager.js`: (群组管理器) 管理群组创建、成员资格和群组消息广播。
    *   `MediaManager.js`: (媒体管理器) 处理文件附件、语音录制和预览。
    *   `VideoCallManager.js`: (视频通话管理器) 管理一对一视频/音频通话、屏幕共享、流处理和 UI。
    *   `MessageTtsHandler.js`: (消息TTS处理器) 管理消息的 TTS 播放。
    *   `ThemeLoader.js`: (主题加载器) 处理加载主题和相关数据。
    *   `Config.js`: (配置) 存储应用范围的配置 (STUN/TURN, 服务器 URL, 超时等)。
    *   `Utils.js`: (工具函数) 提供实用功能 (日志记录, 格式化, ID 生成)。
    *   `EventEmitter.js`: (事件发射器) 一个简单的事件发射器，用于模块间的解耦通信。
*   **UI 管理：**
    *   `UIManager.js` (整体 UI 协调器，或用于未进一步细分的特定方面)
    *   `ChatAreaUIManager.js`: (聊天区域UI管理器) 管理主聊天区域 UI。
    *   `SidebarUIManager.js`: (侧边栏UI管理器) 管理联系人/聊天侧边栏。
    *   `DetailsPanelUIManager.js`: (详情面板UI管理器) 管理右侧详情面板。
    *   `ModalManager.js`: (模态框管理器) 处理各种模态框的创建和显示。
    *   `NotificationManager.js`: (通知管理器) 管理应用内通知。
    *   `LayoutManager.js`: (布局管理器) 管理整体应用布局和响应性。
    *   `MediaUIManager.js`: (媒体UI管理器) 管理媒体的 UI 方面 (预览等)。
    *   `VideoCallUIManager.js` (`VideoCallManager` 的 UI 部分): 管理与通话相关的 UI 元素。
    *   `SettingsUIManager.js`: (设置UI管理器) 管理设置 UI/模态框。
    *   `TtsUIManager.js`: (TTS UI管理器) 管理 TTS 配置的 UI。

## 💡 未来增强

*   **端到端加密 (E2EE)：** 在固有的 DTLS 安全性之上，为 DataChannel 消息实现对称加密（例如 AES），以实现聊天内容的真正 E2EE。
*   **去中心化群聊：**
    *   探索用于较小群组的全网状 P2P 连接。
    *   研究类似 GossipSub 的协议（例如，受 libp2p-gossipsub 启发），以实现更具可扩展性和弹性的群组消息传递。
*   **群组音视频通话：** 集成 SFU (选择性转发单元) 或 MCU (多点会议单元) 以支持多方音视频通话，因为 WebRTC 网状结构对于许多参与者而言效率低下。
*   **离线消息：** 如果信令服务器可以为离线用户排队消息。
*   **用户状态：** 更详细的在线/离线/输入中指示器。
*   **消息状态：** 已发送/已送达/已读回执。

## 🤝 贡献指南

欢迎贡献！如果您想做出贡献，请随时 fork 仓库，进行更改，然后提交拉取请求。对于重大更改，请先开启一个 issue 来讨论您想要更改的内容。

1.  Fork 本项目
2.  创建您的功能分支 (`git checkout -b feature/AmazingFeature`)
3.  提交您的更改 (`git commit -m 'Add some AmazingFeature'`)
4.  推送到分支 (`git push origin feature/AmazingFeature`)
5.  开启一个拉取请求 (Pull Request)

## 🙏 致谢与归属

本项目利用并受到多个概念和资源的启发。我们向其创建者和社区表示感谢。

*   **WebRTC 和 WebSockets：** 使此应用程序成为可能的核心 P2P 和信令技术。感谢浏览器供应商提供这些功能。
*   **AI 聊天补全 (可选功能)：**
    *   该应用程序旨在与 **OpenAI 兼容的 API 端点**集成 (可在 `Config.js` 中配置)。用户需要提供自己的端点和 API 密钥。
    *   在 `data/*.js` 文件 (例如, `Genshin Impact.js`, `Battle Through the Heavens.js`) 中定义的 AI 角色和系统提示**灵感来源于流行知识产权 (IP) 中的角色**，如原神、斗破苍穹、仙逆、遮天、蜡笔小新、迷宫饭和咒术回战。此内容**仅用于演示和个人/教育用途**，与相应 IP 持有者无关，也未受其认可。
*   **文本转语音 (TTS) (可选功能)：**
    *   我们感谢 GPT-SoVITS 及类似开源 TTS 项目的开发者为可访问的语音合成技术所做的贡献。特别感谢以下 GPT-SoVITS 社区贡献者 (排名不分先后)：
        *   **GPT-SoVITS 核心开发者：** [@花儿不哭 (FlowerNotCry)](https://space.bilibili.com/5760446)
        *   **模型训练与分享：** [@红血球AE3803 (RedBloodCellAE3803)](https://space.bilibili.com/6589795), [@白菜工厂1145号员工 (CabbageFactoryEmployee1145)](https://space.bilibili.com/518098961)
        *   **推理优化与在线服务 (GSV AI Lab)：** [@AI-Hobbyist](https://gsv.acgnai.top/)
    *   用户有责任确保遵守他们配置和使用的任何 TTS API 的服务条款。
*   **主题化与角色数据：**
    *   角色主题 (CSS 和 JavaScript 数据文件) 是定制创建的，**灵感来源于上述 IP 的视觉风格和角色**。它们旨在用于说明目的并展示应用程序的**主题化**能力。
    *   本项目的仓库**不直接包含**这些 IP 的任何受版权保护的资产 (例如，游戏/动漫本身的原始图像、音频文件)。头像图像是说明性的表示。
*   **信令与 TURN 服务器：**
    *   `Config.js` 文件包含信令和 TURN 服务器的占位符配置 (例如, `turn:175.178.216.24:3478`)。用户必须部署或配置自己可靠的信令 和 TURN 服务器以进行 P2P 通信，尤其是在不同网络和 NAT 之后。社区经常共享的公共 STUN 服务器列表 (例如，如果存在 `stun_servers.txt` 文件) 也可以作为资源。
*   **音乐：**
    *   呼叫等待音乐 `/music/call.mp3` 来自哆啦A梦。
*   **通用 Web 技术、灵感与其他感谢：**
    *   本项目使用标准的 Web 技术 (HTML, CSS, JavaScript) 构建，并依赖于现代 Web 浏览器提供的功能。
    *   灵感来源于各种 P2P 聊天应用程序以及以下资源和社区成员：
        *   **对话式 AI 服务 (示例)：** [阿里云百炼大模型平台](https://bailian.console.aliyun.com/)及类似服务。
        *   **页面布局与 UI 灵感：** [Telegram Web](https://web.telegram.org/)。
        *   **主题概念与灵感：** [@卤v (LuV)](https://space.bilibili.com/1290496974)。
        *   **素材资源：** 感谢互联网上许多无名贡献者提供的开放素材资源 (用户在使用素材时应确保合规)。
        *   **本项目也在以下地址开源：** [https://github.com/git-hub-cc/P2P-Web-Chat](https://github.com/git-hub-cc/P2P-Web-Chat) (欢迎 Star 和 Fork！)

**免责声明：** 本项目仅用于教育和演示目的。在使用或改编此代码时，请尊重任何外部 API、服务或知识产权的所有相关版权和服条款。
