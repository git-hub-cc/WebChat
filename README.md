# AI Character Role-Playing Chat Platform

[![GitHub stars](https://img.shields.io/github/stars/git-hub-cc/PPMC.svg?style=social)](https://github.com/git-hub-cc/PPMC/stargazers)
[![GitHub forks](https://img.shields.io/github/forks/git-hub-cc/PPMC.svg?style=social)](https://github.com/git-hub-cc/PPMC/network/members)

[中文版](./README-cn.md)

A feature-rich, modern web chat application built with vanilla JavaScript, HTML, and CSS for the frontend, and Java Spring Boot for the backend. It utilizes WebRTC for direct user-to-user media communication, supporting text, file sharing, voice messages, and real-time audio/video/screen-sharing calls. Initial user discovery and connection negotiation are handled by a WebSocket-based signaling server. The application now includes a powerful **"Memory Book"** feature for enhanced AI long-term memory, **Character Card import/export** for easy sharing, and **customizable backgrounds** for personalization. The AI system supports dynamic context, intelligent summarization, and Text-to-Speech (TTS), delivering a vivid and deeply engaging interactive experience.

**Online Demo:**
https://git-hub-cc.github.io/PPMC/

## ✨ Features

*   **Core Communication (WebRTC):**
    *   **One-on-One and Group Chat:** Engage in private conversations or create groups.
        *   Text messages, file sharing, and voice messages.
        *   Sticker support.
    *   **Real-time Audio/Video Calls:** High-quality, one-on-one audio/video calls with adaptive bitrate.
        *   Video calls support Picture-in-Picture (PiP) mode.
    *   **Screen Sharing:** Share your screen with your chat partner.
*   **AI Assistant Contacts:**
    *   Themed AI characters based on popular IPs (e.g., Genshin Impact, Xian Ni, Crayon Shin-chan, etc.).
    *   Generates AI replies via configurable OpenAI-compatible APIs (proxied by the backend).
    *   **Memory Book & AI Extraction:** Define key information categories (e.g., "hobbies," "background") and trigger the AI to analyze conversation history and populate a "memory book," providing persistent, structured long-term memory.
    *   **Character Card Management:** Import and export AI character definitions, including their personalities, prompts, and embedded avatars, in a portable JSON format.
    *   **Text-to-Speech (TTS):** AI replies can be played as audio via a configurable TTS API. Features dynamic model/speaker selection and IndexedDB caching for performance.
*   **User Interface & Experience (UI/UX):**
    *   **Modular & Responsive Design:** Clean separation of concerns and adaptation to desktop/mobile screens.
    *   **Advanced Theming:**
        *   Supports multiple themes with light and dark modes.
        *   **Customizable Backgrounds:** Set unique background images for both light and dark modes.
        *   **Smooth Transitions:** Seamless fade-in/fade-out animations when switching themes or opening modals.
    *   **AI Mention Suggestions:** Type `@` in group chats to easily mention and trigger AI members.
    *   **Virtual Scrolling:** Efficiently renders long chat histories.
    *   **Screenshot Editor:** Built-in tool to crop and annotate screenshots before sending.
    *   **Resource Previews:** A detailed panel to browse all images, videos, and files shared in a chat, with a calendar view for date-based navigation.
*   **Configuration & Management:**
    *   **Tab-based Settings UI:** A clear and organized settings modal for managing all configurations.
    *   **Multi-Provider LLM Support:** Easily switch between pre-configured Large Language Model (LLM) providers (e.g., OpenAI, Anthropic, DeepSeek), with automatic endpoint and model list population.
    *   **Data Persistence:** Uses IndexedDB (`DBManager.js`) to store chat history, contacts, user information, and settings locally.
*   **Backend Services (Java Spring Boot):**
    *   **WebSocket Signaling Server:** Handles WebRTC connection establishment.
    *   **AI Chat & Tool-Use Proxy:** A robust proxy for external AI APIs, now supporting MCP (Meta Call Protocol) for tool usage.
    *   **API Rate Limiting & Monitoring:** Protects backend interfaces and provides basic server status.

## 📸 Screenshots

Here are some screenshots of the application in action, showcasing different features and themes:

**Chat Interface:**
*   Desktop View:
    ![Chat Interface - Desktop](screenshots/Chat%20Interface/Desktop/img.png)
*   Mobile View:
<img src="./screenshots/Chat%20Interface/Mobile/merge.png" alt="Chat Interface - Mobile">

**Video Call:**
*   Video call with Picture-in-Picture (PiP) mode enabled:
    ![Video Call with PiP](screenshots/Video%20Call%20with%20PiP/img.png)

**Theme Examples:**
*   Crayon Shin-chan Theme (Light Mode):
    ![Crayon Shin-chan Theme - Light](screenshots/Themes/%E8%9C%A1%E7%AC%94%E5%B0%8F%E6%96%B0-%E6%B5%85%E8%89%B2.png)
*   Delicious in Dungeon Theme (Light Mode):
    ![Delicious in Dungeon Theme - Light](screenshots/Themes/%E8%BF%B7%E5%AE%AB%E9%A5%AD-%E6%B5%85%E8%89%B2.png)
*   Delicious in Dungeon Theme (Dark Mode):
    ![Delicious in Dungeon Theme - Dark](screenshots/Themes/%E8%BF%B7%E5%AE%AB%E9%A5%AD-%E6%B7%B1%E8%89%B2.png)

## 🛠️ Tech Stack

*   **Frontend:** HTML5, CSS3, Vanilla JavaScript (ES6+ Modules)
*   **Backend:** Java 17, Spring Boot, Spring WebFlux, Spring WebSocket, Maven
*   **Core Communication Technology:** WebRTC (RTCPeerConnection, RTCDataChannel, MediaStream API)
*   **Signaling:** WebSockets
*   **NAT Traversal:** STUN/TURN (Coturn recommended)
*   **Local Storage:** IndexedDB

## ⚙️ How It Works

1.  **Initialization:** A unique user ID is generated or loaded from IndexedDB.
2.  **Signaling & Connection:** The client connects to the WebSocket signaling server. For peer-to-peer communication, it uses the server to exchange SDP and ICE candidates to establish a direct WebRTC connection.
3.  **AI Interaction:**
    *   User messages for AI characters are sent to the backend proxy.
    *   The backend injects context, including content from the **Memory Book**, and calls the configured LLM API.
    *   The AI's text response is then sent to a TTS service to generate speech.
4.  **Memory Book Extraction:** The Memory Book feature sends conversation transcripts to the AI, asking it to extract and summarize key information based on user-defined categories, which is then stored and injected into future prompts.
5.  **Data Persistence:** All contacts, chat messages, settings, and custom data (like stickers and memory books) are stored in the browser's IndexedDB.

## 🚀 Quick Start & Setup

### Prerequisites

*   A modern WebRTC-enabled browser (e.g., Chrome, Firefox).
*   Java 17 & Maven (for the backend).
*   Docker (recommended for the TURN server).

### 1. Configure the Application

*   **Frontend (`js/config/AppSettings.js`):** Set your `signalingServerUrl` and `iceServers` (STUN/TURN).
*   **Backend (Spring Boot `application.properties`):** Configure your AI/TTS API keys, URLs, CORS origins, and other server settings. `LLMProviders.js` on the frontend should be updated to match the available models on your backend proxy.

### 2. Deploy a TURN Server (Recommended)

For robust connections, a TURN server is essential. A `docker-compose.yml` for Coturn is provided. Edit `turnserver.conf` with your realm and user credentials, then run `docker-compose up -d`.

### 3. Run the Backend & Frontend

1.  **Backend:** Navigate to the Spring Boot project directory and run `mvn spring-boot:run`.
2.  **Frontend:** Serve the static files (HTML, CSS, JS) using any HTTP server. Ensure the URLs in `AppSettings.js` `LLMProviders.js` point to your running backend.

Open the application in two browser windows to test peer-to-peer communication.

## 🚀 How to Use

*   **Main Menu (☰):** Access your User ID, network status, and all settings.
*   **Interaction Management (+):** Add contacts, create groups, import/export character cards, and manage Memory Book element sets from this centralized modal.
*   **Chatting:** Select a chat, type messages, attach files (📎), send voice messages (🎙️), use stickers/emojis (😀), or take screenshots (📸).
*   **Details Panel (ⓘ):** View chat info, manage group members, configure AI settings (TTS, Memory Book), and browse shared media resources.

## 🎨 Theming

The application features a powerful and flexible theming system:
*   **Theme Definition:** Themes are defined in `js/config/ThemeList.js`, linking a name to a CSS file and a data JSON file.
*   **CSS:** Styles are defined in `css/`.
*   **Data (`data/`):** JSON files define theme-specific special contacts, including their personalities, prompts, and `chapters` (story arcs).
*   **Custom Backgrounds:** Users can set custom background images for light and dark modes, which are cached in IndexedDB.

## 🏗️ Modular Design & Core Components

**Frontend (JavaScript):**

*   **Configuration (`js/config/`):** `AppSettings.js`, `LLMProviders.js`, `EmojiList.js`, `ThemeList.js`, `McpTools.js`.
*   **Core Logic:** `AppInitializer.js`, `ConnectionManager.js`, `DBManager.js`, `UserManager.js`, `ChatManager.js`, `MessageManager.js`, `GroupManager.js`, `MediaManager.js`, `VideoCallManager.js`, `ThemeLoader.js`, `Utils.js`, `EventEmitter.js`, `TimerManager.js`, **`CharacterCardManager.js`**, **`MemoryBookManager.js`**.
*   **Handlers (`js/handler/`):** `AiApiHandler.js`, `DataChannelHandler.js`, `TtsApiHandler.js`, `VideoCallHandler.js`.
*   **UI Managers (`js/UI/`):** `ChatAreaUIManager.js`, `DetailsPanelUIManager.js`, `LayoutUIManager.js`, `MediaUIManager.js`, `ModalUIManager.js`, `NotificationUIManager.js`, `ScreenshotEditorUIManager.js`, `SettingsUIManager.js`, `SidebarUIManager.js`, `VideoCallUIManager.js`, **`TtsUIManager.js`**, **`EmojiStickerUIManager.js`**.

**Backend (Java Spring Boot):**
*   Organized into standard packages: `config`, `controller`, `handler`, `interceptor`, `model`, `service`, `scheduler`.

## 🛠️ Helper Scripts & Tools

The project includes Python helper scripts for development: `delete_minified_files.py`, `minify_and_replace.py`, `resize_images.py`, and `test_stun_servers.py`.

## 💡 Future Enhancements

*   **End-to-End Encryption (E2EE):** Implement an additional layer of encryption for DataChannel messages.
*   **Decentralized Group Chat:** Explore full mesh WebRTC for smaller groups or GossipSub-like protocols for larger ones.
*   **Group Audio/Video Calls:** Integrate an SFU (Selective Forwarding Unit).
*   **Message Status:** Sent/delivered/read receipts.
*   **Advanced AI & Memory:**
    *   **Autonomous Memory Management:** Build upon the Memory Book feature to allow the AI to autonomously decide when and what to remember, creating a more organic long-term memory.
    *   **Advanced Reasoning:** Research and integrate techniques like **Chain of Thought (CoT)** and **Tool-Use (MCP)** to power more complex problem-solving, memory extraction, and general reasoning.
    *   **Proactive Interaction:** Explore AI's ability to proactively initiate meaningful conversations based on its memory and personality.
*   **Expressive AI Voice:** Further optimize TTS integration to give AI characters more emotionally nuanced and personalized voice expressions.


## 🤝 Contribution Guidelines

Contributions are welcome! Please fork the repository, make your changes on a feature branch, and submit a pull request. For major changes, please open an issue first to discuss.

## 🙏 Acknowledgements & Attributions

This project utilizes and is inspired by several concepts and resources. We extend our gratitude to their creators and communities.
*   **WebRTC and WebSockets:** The core communication and signaling technologies that make this application possible. Thanks to browser vendors for providing these capabilities.
*   **Java Spring Boot & Coturn:** For building robust and scalable backend services and TURN relay.
*   **AI Chat Completions (Optional Feature):**
    *   The application is designed to integrate with an **OpenAI-compatible API endpoint** (configured via the backend Spring Boot application). Users need to provide their own endpoint and API key.
    *   AI characters and system prompts defined in `data/*.js` files (e.g., `Genshin.json`, `BTTH.json`) are **inspired by characters from popular intellectual properties (IPs)** such as Genshin Impact, Battle Through the Heavens, Xian Ni, Shrouding the Heavens, Crayon Shin-chan, Delicious in Dungeon, and Jujutsu Kaisen. This content is for **demonstration and personal/educational use only** and is not affiliated with or endorsed by the respective IP holders.
*   **Text-to-Speech (TTS) (Optional Feature):**
    *   We appreciate the developers of GPT-SoVITS and similar open-source TTS projects for their contributions to accessible speech synthesis technology. Special thanks to the following GPT-SoVITS community contributors (in no particular order):
        *   **GPT-SoVITS Core Developer:** [@花儿不哭 (FlowerNotCry)](https://space.bilibili.com/5760446)
        *   **Model Training & Sharing:** [@红血球AE3803 (RedBloodCellAE3803)](https://space.bilibili.com/6589795), [@白菜工厂1145号员工 (CabbageFactoryEmployee1145)](https://space.bilibili.com/518098961)
        *   **Inference Optimization & Online Service (GSV AI Lab):** [@AI-Hobbyist](https://gsv.acgnai.top/)
    *   Users are responsible for ensuring compliance with the terms of service of any TTS API they configure and use.
*   **Theming & Character Data:**
    *   Character themes (CSS and JavaScript data files) are custom-created and **inspired by the visual styles and characters of the aforementioned IPs**. They are intended for illustrative purposes and to showcase the application's **theming** capabilities.
    *   The project's repository **does not directly include** any copyrighted assets (e.g., original images, audio files from the games/anime themselves) from these IPs. Avatar images are illustrative representations.
*   **Signaling & TURN Server:**
    *   The frontend `AppSettings.js` file and backend configurations contain placeholder configurations for signaling and TURN servers. Users must deploy or configure their own reliable signaling and TURN servers for WebRTC communication, especially across different networks and behind NATs.
*   **Music:**
    *   Call waiting music `/music/call.mp3` is from Doraemon.
*   **General Web Technologies, Inspiration & Other Thanks:**
    *   This project is built using standard web technologies (HTML, CSS, JavaScript) and Java Spring Boot, relying on features provided by modern web browsers.
    *   Inspiration was drawn from various web chat applications and the following resources and community members:
        *   **Conversational AI Services (Example):** [Alibaba Cloud Bailian Large Model Platform](https://bailian.console.aliyun.com/) and similar services.
        *   **Memory Book Concepts & Inspiration:** [SillyTavern](https://github.com/SillyTavern/SillyTavern).
        *   **Theme Concepts & Inspiration:** [@卤v (LuV)](https://space.bilibili.com/1290496974).
        *   **Material Resources:** Thanks to the many unnamed contributors of open material resources on the internet (users should ensure compliance when using materials).
        *   **This project is also open-sourced at:** [https://github.com/git-hub-cc/PPMC](https://github.com/git-hub-cc/PPMC) (Stars and Forks are welcome!)
*   **WebRTC and WebSockets:** The core communication and signaling technologies that make this application possible.
**Disclaimer:** This project is for educational and demonstration purposes only. Please respect all relevant copyrights and terms of service of any external APIs, services, or intellectual properties when using or adapting this code.
