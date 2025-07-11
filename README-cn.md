# AI 角色扮演聊天平台

[![GitHub stars](https://img.shields.io/github/stars/git-hub-cc/WebChat.svg?style=social)](https://github.com/git-hub-cc/WebChat/stargazers)
[![GitHub forks](https://img.shields.io/github/forks/git-hub-cc/WebChat.svg?style=social)](https://github.com/git-hub-cc/WebChat/network/members)

[English Version](./README.md)

一款功能丰富、现代化的 Web 聊天应用，前端使用原生 JavaScript、HTML 和 CSS 构建，后端采用 Java Spring Boot。它利用 WebRTC 进行用户间的直接媒体通信，支持文本、文件共享、语音/贴图消息以及实时音频/视频/屏幕共享通话。应用现已包含强大的**“记忆书”**功能以增强AI的长期记忆，**角色卡导入/导出**功能便于分享，以及**个性化的自定义背景图片**。AI系统支持动态上下文、智能摘要和文本转语音（TTS），带来生动且深度沉浸的交互体验。

**在线演示：**
* https://ppmc.club/webchat/
* https://git-hub-cc.github.io/WebChat/

## ✨ 功能特性

*   **核心通信 (WebRTC):**
    *   **一对一和群组聊天：**进行私人对话或创建群组。
        *   支持文本、文件共享、语音消息和贴图。
    *   **实时音视频通话：**高质量的一对一音视频通话，支持自适应码率调整。
        *   视频通话支持画中画（PiP）模式，方便多任务处理。
    *   **屏幕共享：**与聊天对象共享您的屏幕。
*   **AI 助手联系人：**
    *   基于流行虚拟 IP 的主题化 AI 角色（例如，原神、仙逆、蜡笔小新等）。
    *   通过可配置的 OpenAI 兼容 API 生成 AI 回复 (由后端代理)。
    *   **记忆书与AI提取：** 定义关键信息类别（如“爱好”、“背景故事”），并触发AI分析对话历史以填充“记忆书”，为AI提供持久化、结构化的长期记忆。
    *   **角色卡管理：** 以可移植的JSON格式导入和导出AI角色的定义，包括其性格、提示词和内嵌的头像。
    *   **文本转语音 (TTS)：** AI 回复可以通过可配置的 TTS API 作为音频播放，支持动态模型/音色选择和 IndexedDB 缓存以优化性能。
*   **用户界面与体验 (UI/UX):**
    *   **模块化与响应式设计：** 清晰的关注点分离，并自适应桌面/移动端屏幕。
    *   **高级主题化：**
        *   支持多种主题，并提供浅色和深色模式。
        *   **自定义背景：** 为浅色和深色模式分别设置独特的背景图片。
        *   **平滑过渡：** 在切换主题或打开模态框时，具有无缝的淡入淡出动画效果。
    *   **AI提及建议：** 在群聊中输入“@”可轻松提及并触发AI成员。
    *   **虚拟滚动：** 高效渲染长聊天记录。
    *   **截图编辑器：** 内置工具，可在发送前裁剪和标注截图。
    *   **资源预览：** 在详情面板中浏览聊天中的所有图片、视频和文件，并支持日历视图进行日期导航。
*   **配置与管理：**
    *   **标签页式设置界面：** 清晰、有组织的设置模态框，方便管理所有配置。
    *   **多提供商LLM支持：** 轻松切换预设的多个大语言模型（LLM）提供商（如OpenAI, Anthropic, DeepSeek），并自动填充端点和模型列表。
    *   **数据持久化：** 使用 IndexedDB (`DBManager.js`) 在浏览器本地存储聊天记录、联系人、用户设置和自定义数据。
*   **后端服务 (Java Spring Boot):**
    *   **WebSocket 信令服务器：** 处理 WebRTC 连接建立。
    *   **AI 聊天与工具使用代理：** 一个健壮的外部AI API代理，现支持MCP（Meta Call Protocol）以实现工具调用。
    *   **API 速率限制与监控：** 保护后端接口并提供基础的服务器状态监控。

## 📸 截图

以下是应用程序运行中的一些截图，展示了不同的功能和主题：

**聊天界面：**
*   桌面视图：
    ![聊天界面 - 桌面](screenshots/Chat%20Interface/Desktop/img.png)
*   移动视图：
<img src="./screenshots/Chat%20Interface/Mobile/merge.png" alt="Chat Interface - Mobile">

**视频通话：**
*   启用画中画（PiP）模式的视频通话：
    ![启用画中画的视频通话](screenshots/Video%20Call%20with%20PiP/img.png)

**主题示例：**
*   蜡笔小新主题（浅色模式）：
    ![蜡笔小新主题 - 浅色](screenshots/Themes/%E8%9C%A1%E7%AC%94%E5%B0%8F%E6%96%B0-%E6%B5%85%E8%89%B2.png)
*   迷宫饭主题（浅色模式）：
    ![迷宫饭主题 - 浅色](screenshots/Themes/%E8%BF%B7%E5%AE%AB%E9%A5%AD-%E6%B5%85%E8%89%B2.png)
*   迷宫饭主题（深色模式）：
    ![迷宫饭主题 - 深色](screenshots/Themes/%E8%BF%B7%E5%AE%AB%E9%A5%AD-%E6%B7%B1%E8%89%B2.png)

## 🛠️ 技术栈

*   **前端：** HTML5, CSS3, 原生 JavaScript (ES6+ 模块)
*   **后端：** Java 17, Spring Boot, Spring WebFlux, Spring WebSocket, Maven
*   **核心通信技术：** WebRTC (RTCPeerConnection, RTCDataChannel, MediaStream API)
*   **信令：** WebSockets
*   **NAT 穿透：** STUN/TURN (推荐使用 Coturn)
*   **本地存储：** IndexedDB

## ⚙️ 工作原理

1.  **初始化：** 生成或从 IndexedDB 加载唯一用户 ID。
2.  **信令与连接：** 客户端连接到 WebSocket 信令服务器。对于P2P通信，它使用服务器交换 SDP 和 ICE 候选者以建立直接的 WebRTC 连接。
3.  **AI 交互：**
    *   发往 AI 角色的用户消息被发送到后端代理。
    *   后端注入上下文（包括**记忆书**内容），并调用配置的 LLM API。
    *   AI 的文本回复随后被发送到 TTS 服务以生成语音。
4.  **记忆提取：** “记忆书”功能将对话记录发送给AI，要求其根据用户定义的类别提取并总结关键信息，这些信息随后被存储并注入到未来的提示中。
5.  **数据持久化：** 所有联系人、聊天消息、设置和自定义数据（如贴图和记忆书）都存储在浏览器的 IndexedDB 中。

## 🚀 快速开始与安装

### 先决条件

*   支持 WebRTC 的现代 Web 浏览器（例如，Chrome, Firefox）。
*   Java 17 和 Maven（用于运行后端）。
*   Docker (推荐，用于运行 TURN 服务器)。

### 1. 配置应用程序

*   **前端 (`js/config/AppSettings.js`)：** 设置您的 `signalingServerUrl` 和 `iceServers` (STUN/TURN)。
*   **后端 (Spring Boot `application.properties`)：** 配置您的 AI/TTS API 密钥、URL、CORS源等服务器设置。前端的 `LLMProviders.js` 文件应与您后端代理可用的模型保持一致。

### 2. 部署 TURN 服务器 (推荐)

为保证连接的可靠性，强烈建议部署 TURN 服务器。项目提供了 Coturn 的 `docker-compose.yml` 文件。编辑 `turnserver.conf`，设置您的 `realm` 和用户凭据，然后运行 `docker-compose up -d`。

### 3. 运行后端与前端

1.  **后端：** 导航到 Spring Boot 项目目录并运行 `mvn spring-boot:run`。
2.  **前端：** 使用任何 HTTP 服务器（如 Nginx）托管静态文件（HTML, CSS, JS）。确保 `AppSettings.js` `LLMProviders.js` 中的 URL 指向您正在运行的后端。

在两个浏览器窗口中打开应用以测试P2P通信。

## 🚀 使用方法

*   **主菜单 (☰)：** 访问您的用户 ID、网络状态和所有设置。
*   **交互管理 (+):** 在此集中式模态框中添加联系人、创建群组、导入/导出角色卡以及管理记忆书要素集。
*   **聊天：** 选择一个聊天，输入消息，附加文件 (📎)、发送语音消息 (🎙️)、使用贴图/表情 (😀)，或进行截图 (📸)。
*   **详情面板 (ⓘ)：** 查看聊天信息、管理群组成员、配置AI设置（TTS、记忆书）以及浏览聊天中的媒体资源。

## 🎨 主题化

应用具有强大而灵活的主题系统：
*   **主题定义：** 在 `js/config/ThemeList.js` 中定义主题，将名称与 CSS 文件和数据 JSON 文件关联起来。
*   **CSS:** 样式文件位于 `css/` 目录。
*   **数据 (`data/`):** JSON 文件定义了主题特定的特殊联系人，包括他们的性格、提示词和`chapters`（故事章节）。
*   **自定义背景：** 用户可以为浅色和深色模式设置自定义背景图片，这些图片会缓存在 IndexedDB 中。

## 🏗️ 模块化设计与核心组件

**前端 (JavaScript):**

*   **配置 (`js/config/`):** `AppSettings.js`, `LLMProviders.js`, `EmojiList.js`, `ThemeList.js`, `McpTools.js`.
*   **核心逻辑:** `AppInitializer.js`, `ConnectionManager.js`, `DBManager.js`, `UserManager.js`, `ChatManager.js`, `MessageManager.js`, `GroupManager.js`, `MediaManager.js`, `VideoCallManager.js`, `ThemeLoader.js`, `Utils.js`, `EventEmitter.js`, `TimerManager.js`, **`CharacterCardManager.js`**, **`MemoryBookManager.js`**.
*   **处理器 (`js/handler/`):** `AiApiHandler.js`, `DataChannelHandler.js`, `TtsApiHandler.js`, `VideoCallHandler.js`.
*   **UI 管理器 (`js/UI/`):** `ChatAreaUIManager.js`, `DetailsPanelUIManager.js`, `LayoutUIManager.js`, `MediaUIManager.js`, `ModalUIManager.js`, `NotificationUIManager.js`, `ScreenshotEditorUIManager.js`, `SettingsUIManager.js`, `SidebarUIManager.js`, `VideoCallUIManager.js`, **`TtsUIManager.js`**, **`EmojiStickerUIManager.js`**.

**后端 (Java Spring Boot):**
*   采用标准包结构： `config`, `controller`, `handler`, `interceptor`, `model`, `service`, `scheduler`。

## 🛠️ 辅助工具与脚本

项目包含一些用于开发的 Python 辅助脚本：`delete_minified_files.py`, `minify_and_replace.py`, `resize_images.py`, 和 `test_stun_servers.py`。

## 💡 未来增强

*   **端到端加密 (E2EE):** 为 DataChannel 消息实现额外的加密层。
*   **去中心化群聊：** 探索用于较小群组的完全网状 WebRTC 连接，或用于较大群组的 GossipSub 类协议。
*   **群组音视频通话：** 集成 SFU（选择性转发单元）。
*   **消息状态：** 已发送/已送达/已读回执。
*   **高级 AI 与记忆：**
    *   **自主记忆管理：** 在记忆书功能基础上，让 AI 能够自主决定何时及记录何事，创造更自然的长期记忆。
    *   **高级推理：** 研究并集成如**思维链 (CoT)** 和**工具使用 (MCP)** 等技术，以支持更复杂的问题解决、记忆提取和通用推理。
    *   **主动交互：** 探索 AI 基于其记忆和性格在适当时机主动发起有意义对话的能力。
*   **富有表现力的 AI 语音：** 进一步优化 TTS 集成，赋予 AI 角色更具情感和个性化的语音表达。

## 🤝 贡献指南

欢迎贡献！请随时 fork 仓库，在功能分支上进行更改，然后提交拉取请求。对于重大更改，请先开启一个 issue 进行讨论。

## 🙏 致谢与归属

本项目利用并受到多个概念和资源的启发。我们向其创建者和社区表示感谢。
*   **WebRTC 和 WebSockets：** 使此应用程序成为可能的核心通信和信令技术。感谢浏览器供应商提供这些功能。
*   **Java Spring Boot & Coturn:** 用于构建健壮和可扩展的后端服务及 TURN 中继。
*   **AI 聊天补全 (可选功能)：**
    *   该应用程序旨在与 **OpenAI 兼容的 API 端点**集成 (通过后端 Spring Boot 应用配置)。用户需要提供自己的端点和 API 密钥。
    *   在 `data/*.js` 文件 (例如, `原神.json`, `斗破苍穹.json`) 中定义的 AI 角色和系统提示**灵感来源于流行知识产权 (IP) 中的角色**，如原神、斗破苍穹、仙逆、遮天、蜡笔小新、迷宫饭和咒术回战。此内容**仅用于演示和个人/教育用途**，与相应 IP 持有者无关，也未受其认可。
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
    *   前端 `AppSettings.js` 文件和后端配置包含信令和 TURN 服务器的占位符配置。用户必须部署或配置自己可靠的信令 和 TURN 服务器以进行 WebRTC 通信，尤其是在不同网络和 NAT 之后。
*   **音乐：**
    *   呼叫等待音乐 `/music/call.mp3` 来自哆啦A梦。
*   **通用 Web 技术、灵感与其他感谢：**
    *   本项目使用标准的 Web 技术 (HTML, CSS, JavaScript) 和 Java Spring Boot 构建，并依赖于现代 Web 浏览器提供的功能。
    *   灵感来源于各种 Web 聊天应用程序以及以下资源和社区成员：
        *   **对话式 AI 服务 (示例)：** [阿里云百炼大模型平台](https://bailian.console.aliyun.com/)及类似服务。
        *   **记忆书概念与灵感：** [SillyTavern](https://github.com/SillyTavern/SillyTavern)。
        *   **主题概念与灵感：** [卤v (LuV)](https://space.bilibili.com/1290496974)。
        *   **素材资源：** 感谢互联网上许多无名贡献者提供的开放素材资源 (用户在使用素材时应确保合规)。
        *   **本项目也在以下地址开源：** [https://github.com/git-hub-cc/WebChat](https://github.com/git-hub-cc/WebChat) (欢迎 Star 和 Fork！)
**免责声明：** 本项目仅用于教育和演示目的。在使用或改编此代码时，请尊重任何外部 API、服务或知识产权的所有相关版权和服条款。