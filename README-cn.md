# AI 角色扮演聊天平台

[![GitHub stars](https://img.shields.io/github/stars/git-hub-cc/WebChat.svg?style=social)](https://github.com/git-hub-cc/WebChat/stargazers)
[![GitHub forks](https://img.shields.io/github/forks/git-hub-cc/WebChat.svg?style=social)](https://github.com/git-hub-cc/WebChat/network/members)

[English Version](./README.md)

这是一款功能丰富、现代化的 Web 聊天应用，现已全面重构。前端采用 **Vue 3**、**Vite** 和 **Pinia** 构建，实现了组件化和高效的状态管理；后端则由健壮的 **Java Spring Boot** 驱动。应用利用 **WebRTC** 进行用户间的直接媒体通信，支持文本、文件共享、语音/贴图消息以及实时音频/视频/屏幕共享通话。

项目引入了创新的 **联邦网络 (Federation)** 功能，允许多个独立的后端实例互联，实现跨服务器的用户状态同步和无缝通信。AI 系统也得到了显著增强，支持 **API 密钥池**、**记忆书 (Memory Book)** 功能以实现长期记忆、**角色卡导入/导出**、**文本转语音 (TTS)** 和 **语音转文本 (STT)**，带来前所未有的深度沉浸式交互体验。

**在线演示：**
* https://ppmc.club/webchat-vue/
* https://git-hub-cc.github.io/WebChat/

## ✨ 功能特性

*   **核心通信 (WebRTC):**
    *   **一对一和群组聊天：** 进行私人对话或创建拥有多个成员（包括人类和AI）的群组。
        *   支持文本、文件共享、语音消息和贴图。
    *   **实时音视频通话：** 高质量的一对一音视频通话，具备通话质量监控和自适应调整。
        *   支持最小化通话窗口和全屏视图切换。
    *   **屏幕共享：** 与聊天对象共享您的整个屏幕或特定应用窗口。

*   **联邦网络 & 可扩展性:**
    *   **跨服用户感知：** 多个独立的后端服务器可以互联成一个联邦网络。
    *   **全局在线大厅：** “人员大厅”现在可以展示所有联邦服务器上的在线用户，并标明其来源。
    *   **无缝跨服通信：** 用户可以像在本地一样与任何联邦服务器上的联系人发起 WebRTC 连接和聊天，后端会自动处理信令路由。
    *   **持久化服务器身份：** 每个后端实例拥有一个持久化的唯一ID（GUID），确保联邦网络的稳定性。

*   **AI 助手与高级交互:**
    *   **动态 AI 角色:** 通过主题系统提供基于流行 IP 的 AI 角色，每个角色都有独特的性格、背景故事和行为模式。
    *   **记忆书与 AI 提取：** 定义关键信息类别（如“爱好”、“背景故事”），并触发 AI 分析对话历史以填充“记忆书”，为 AI 提供持久化、结构化的长期记忆。
    *   **角色卡管理：** 以可移植的 JSON 格式导入和导出 AI 角色的定义，包括其性格、提示词和内嵌的头像数据。
    *   **文本转语音 (TTS):** AI 回复可以通过专门的 TTS Store 和可配置的 API 转换成语音，支持动态模型/音色选择，并通过 IndexedDB 缓存音频以优化性能。
    *   **语音转文本 (STT):** 在与 AI 聊天时，可使用语音输入（Speech-to-Text）功能，实现免提对话。
    *   **健壮的 API 代理:** 后端代理所有对外部 AI API 的请求，支持 **API 密钥池**以提高可用性和分摊负载，并能智能处理速率限制。

*   **现代化的用户界面与体验 (UI/UX):**
    *   **Vue 3 组件化架构:** 整个前端基于 Vue 3、Vite 和 Pinia 重构，实现了高度模块化、可维护的代码和卓越的性能。
    *   **高级主题化系统：**
        *   支持多种主题，并提供浅色和深色模式的自动切换。
        *   **自定义背景：** 为浅色和深色模式分别设置独特的背景图片。
    *   **虚拟滚动：** 使用 `vue-virtual-scroller` 高效渲染长聊天记录和联系人列表，即使有数千条消息也能保持流畅。
    *   **精致的加载状态：** 使用骨架屏（Skeleton Loaders）优化加载体验，减少感知等待时间。
    *   **内置截图编辑器：** 提供强大的客户端截图工具，可在发送前进行裁剪和矩形标记。
    *   **资源中心：** 在详情面板中集中浏览聊天中的所有图片、视频和文件，并提供日历视图进行快速日期导航。

*   **配置与管理:**
    *   **类型安全的后端配置：** 使用 `@ConfigurationProperties` 实现了配置的类型安全和集中管理。
    *   **多提供商 LLM 支持：** 在前端设置中轻松切换预设的多个大语言模型（LLM）提供商（如 OpenAI, Anthropic, DeepSeek），并自动填充端点和模型列表。
    *   **全面的数据持久化：** 使用 IndexedDB 在浏览器本地存储聊天记录、联系人、设置、贴图、记忆书和媒体文件缓存。

## 📸 截图

以下是应用程序运行中的一些截图，展示了不同的功能和主题：

**聊天界面：**
*   桌面视图：
    ![聊天界面 - 桌面](./screenshots/Chat%20Interface/Desktop/img.png)
*   移动视图：
    <img src="./screenshots/Chat%20Interface/Mobile/merge.png" alt="Chat Interface - Mobile">

**视频通话：**
*   启用画中画（PiP）模式的视频通话：
    ![启用画中画的视频通话](./screenshots/Video%20Call%20with%20PiP/img.png)

**主题示例：**
*   蜡笔小新主题（浅色模式）：
    ![蜡笔小新主题 - 浅色](./screenshots/Themes/%E8%9C%A1%E7%AC%94%E5%B0%8F%E6%96%B0-%E6%B5%85%E8%89%B2.png)
*   迷宫饭主题（浅色模式）：
    ![迷宫饭主题 - 浅色](./screenshots/Themes/%E8%BF%B7%E5%AE%AB%E9%A5%AD-%E6%B5%85%E8%89%B2.png)
*   迷宫饭主题（深色模式）：
    ![迷宫饭主题 - 深色](./screenshots/Themes/%E8%BF%B7%E5%AE%AB%E9%A5%AD-%E6%B7%B1%E8%89%B2.png)

## 🛠️ 技术栈

*   **前端：** **Vue 3**, **Vite**, **Pinia**, **simple-peer** (WebRTC), **vue-virtual-scroller**
*   **后端：** **Java 17**, **Spring Boot 3**, Spring WebFlux, Spring WebSocket, Maven
*   **核心通信技术：** WebRTC (RTCPeerConnection, RTCDataChannel, MediaStream API)
*   **信令与联邦：** WebSockets
*   **NAT 穿透：** STUN/TURN (推荐使用 Coturn)
*   **本地存储：** IndexedDB

## ⚙️ 工作原理

1.  **初始化：** 客户端生成或从 IndexedDB 加载唯一用户 ID，并通过 Pinia stores 初始化应用状态。
2.  **信令与连接：** 客户端连接到 WebSocket 信令服务器并注册自己。对于P2P通信，它使用服务器交换 SDP 和 ICE 候选者以建立直接的 WebRTC 连接。
3.  **联邦网络：**
    *   每个后端服务器启动时，会主动连接到其配置中的`peers`（伙伴服务器）。
    *   服务器之间通过专用的控制消息 (`FederatedControlMessage`) 交换心跳和各自的在线用户列表。
    *   当一个客户端需要连接一个不在同一服务器上的用户时，其信令消息 (`SignalingMessage`) 会被其连接的服务器智能路由到目标用户所在的服务器。
4.  **AI 交互：**
    *   发往 AI 角色的消息被发送到后端代理。
    *   后端注入上下文（包括**记忆书**内容），从**API密钥池**中选择一个密钥，并调用配置的 LLM API。
    *   AI 的文本回复随后通过 **TTS Store** 触发 TTS 服务调用，生成语音并缓存。
5.  **数据持久化：** 所有联系人、聊天消息、设置和自定义数据都通过 `dbService` 存储在浏览器的 IndexedDB 中。

## 🚀 快速开始与安装

### 先决条件

*   **Node.js** (v18+) 和 **npm** (用于前端)
*   **Java 17** 和 **Maven** (用于后端)
*   支持 WebRTC 的现代 Web 浏览器（例如，Chrome, Firefox）
*   Docker (推荐，用于运行 TURN 服务器)

### 1. 配置应用程序

*   **后端 (`resources/application.yml`):**
    *   配置 `server.port`。
    *   在 `federation` 部分设置 `self-url` 和 `peers` 列表以启用联邦功能。
    *   在 `openai.api` 部分填入您的 OpenAI 兼容 API 的 `base_url`、`model` 和 `api_keys` 列表。
*   **前端 (`src/config/AppSettings.js`):**
    *   更新 `server.signalingServerUrl` 和 `server.allOnlineUsersApiEndpoint` 指向您的后端地址。
    *   配置 `peerConnectionConfig.iceServers` (STUN/TURN)。

### 2. 部署 TURN 服务器 (推荐)

为保证连接的可靠性，强烈建议部署 TURN 服务器。项目提供了 Coturn 的 `docker-compose.yml` 文件。编辑 `turnserver.conf`，设置您的 `realm` 和用户凭据，然后运行 `docker-compose up -d`。

### 3. 运行后端与前端

1.  **后端：**
    ```bash
    # 运行 Spring Boot 应用
    mvn spring-boot:run
    ```

2.  **前端：**
    ```bash
    # 导航到 Vue 项目根目录
    cd /vue
    # 安装依赖
    npm install
    # 启动开发服务器 (用于开发)
    npm run dev
    # 或构建用于生产的静态文件
    npm run build
    ```
    构建后，将 `dist` 目录下的所有文件部署到任何静态文件服务器（如 Nginx）上。

在两个浏览器窗口中打开应用以测试P2P通信。

## 🚀 使用方法

*   **主菜单 (☰)：** 访问您的用户 ID、网络状态和所有设置。
*   **交互管理 (+):** 在此集中式模态框中添加联系人、创建群组、导入/导出角色卡以及管理记忆书要素集。
*   **聊天：** 选择一个聊天，输入消息，附加文件 (📎)、发送语音消息 (🎙️)、使用贴图/表情 (😀)，或进行截图 (📸)。
*   **详情面板 (👥 或点击头部信息):** 查看聊天信息、管理群组成员、配置 AI 设置（TTS、记忆书）以及浏览聊天中的媒体资源。
*   **人员大厅 (👥):** 查看所有联邦服务器上的在线用户，并可以添加他们为联系人。

## 🎨 主题化

应用具有强大而灵活的主题系统：
*   **主题定义：** 在 `src/config/ThemeList.js` 中定义主题，将名称与 CSS 文件和数据 JSON 文件关联起来。
*   **CSS:** 样式文件位于 `public/themes/` 目录。
*   **数据 (`public/data/`):** JSON 文件定义了主题特定的特殊联系人，包括其性格、提示词和`chapters`（故事章节）。
*   **自定义背景：** 用户可以为浅色和深色模式设置自定义背景图片，这些图片会缓存在 IndexedDB 中。

## 🏗️ 模块化设计与核心组件

**前端 (Vue 3):**

*   **Stores (Pinia):**
    *   `userStore`: 管理用户、联系人和全网在线用户列表。
    *   `chatStore`: 管理所有聊天消息和临时消息状态。
    *   `groupStore`: 负责群组的创建、成员管理和群消息广播逻辑。
    *   `callStore`: 处理 WebRTC 音视频通话的所有状态和逻辑。
    *   `settingsStore`: 管理主题、配色方案和 API 配置。
    *   `ttsStore`: 专门管理 TTS 请求、状态和音频缓存。
    *   `memoryStore`: 负责记忆书的定义、生成和存储。
    *   `uiStore`: 控制所有 UI 状态，如模态框、面板、加载状态等。
*   **Services:**
    *   `webrtcService`: 封装 `simple-peer`，处理所有 WebRTC 连接和数据传输。
    *   `apiService`: 负责所有与后端的 HTTP 通信，包括 AI 和 TTS 请求。
    *   `dbService`: IndexedDB 的抽象层，提供简洁的数据持久化 API。
*   **Components:** 应用程序被拆分为可复用的 Vue 组件，遵循最佳实践，如 `ChatList`、`MessageBubble`、`DetailsPanel` 等。

**后端 (Java Spring Boot):**
*   采用标准包结构： `config`, `controller`, `dto`, `handler`, `service` 等。
*   `SignalingWebSocketHandler`: 作为 WebSocket 的统一入口，处理来自客户端和伙伴服务器的所有消息。
*   `FederationService` & `FederationRoutingService`: 共同构成了联邦网络的核心，负责伙伴连接管理、用户状态同步和跨服消息路由。

## 💡 未来增强

*   **端到端加密 (E2EE):** 为 DataChannel 消息实现额外的加密层。
*   **去中心化群聊：** 探索用于较小群组的完全网状 WebRTC 连接，或用于较大群组的 GossipSub 类协议。
*   **群组音视频通话：** 集成 SFU（选择性转发单元）。
*   **消息状态：** 已发送/已送达/已读回执。
*   **高级 AI 与记忆：**
    *   **自主记忆管理：** 在记忆书功能基础上，让 AI 能够自主决定何时及记录何事，创造更自然的长期记忆。
    *   **高级推理：** 研究并集成如**思维链 (CoT)** 等技术，以支持更复杂的问题解决。
    *   **主动交互：** 探索 AI 基于其记忆和性格在适当时机主动发起有意义对话的能力。

## 🤝 贡献指南

欢迎贡献！请随时 fork 仓库，在功能分支上进行更改，然后提交拉取请求。对于重大更改，请先开启一个 issue 进行讨论。

## 🙏 致谢与归属

本项目利用并受到多个概念和资源的启发。我们向其创建者和社区表示感谢。
*   **WebRTC 和 WebSockets：** 使此应用程序成为可能的核心通信和信令技术。感谢浏览器供应商提供这些功能。
*   **Java Spring Boot & Coturn:** 用于构建健壮和可扩展的后端服务及 TURN 中继。
*   **AI 聊天补全 (可选功能)：**
    *   该应用程序旨在与 **OpenAI 兼容的 API 端点**集成 (通过后端 `application.yml` 配置)。用户需要提供自己的端点和 API 密钥。
    *   在 `public/data/` 目录中定义的 AI 角色和系统提示**灵感来源于流行知识产权 (IP) 中的角色**。此内容**仅用于演示和个人/教育用途**，与相应 IP 持有者无关，也未受其认可。
*   **文本转语音 (TTS) (可选功能)：**
    *   我们感谢 **GPT-SoVITS** 及类似开源 TTS 项目的开发者为可访问的语音合成技术所做的贡献。特别感谢以下 GPT-SoVITS 社区贡献者 (排名不分先后)：
        *   **GPT-SoVITS 核心开发者：** [@花儿不哭 (FlowerNotCry)](https://space.bilibili.com/5760446)
        *   **模型训练与分享：** [@红血球AE3803 (RedBloodCellAE3803)](https://space.bilibili.com/6589795), [@白菜工厂1145号员工 (CabbageFactoryEmployee1145)](https://space.bilibili.com/518098961)
        *   **推理优化与在线服务 (GSV AI Lab)：** [@AI-Hobbyist](https://gsv.acgnai.top/)
    *   用户有责任确保遵守他们配置和使用的任何 TTS API 的服务条款。
*   **主题化与角色数据：**
    *   角色主题 (CSS 和 JSON 数据文件) 是定制创建的，**灵感来源于上述 IP 的视觉风格和角色**。它们旨在用于说明目的并展示应用程序的**主题化**能力。
    *   本项目的仓库**不直接包含**这些 IP 的任何受版权保护的资产 (例如，游戏/动漫本身的原始图像、音频文件)。
*   **音乐：**
    *   呼叫等待音乐 `/music/call.mp3` 来自哆啦A梦。
*   **通用 Web 技术、灵感与其他感谢：**
    *   **记忆书概念与灵感：** [SillyTavern](https://github.com/SillyTavern/SillyTavern)。
    *   **主题概念与灵感：** [卤v (LuV)](https://space.bilibili.com/1290496974)。
    *   **本项目也在以下地址开源：** [https://github.com/git-hub-cc/WebChat](https://github.com/git-hub-cc/WebChat) (欢迎 Star 和 Fork！)

**免责声明：** 本项目仅用于教育和演示目的。在使用或改编此代码时，请尊重任何外部 API、服务或知识产权的所有相关版权和服条款。