# AI Role-Playing Chat Platform

[![GitHub stars](https://img.shields.io/github/stars/git-hub-cc/WebChat.svg?style=social)](https://github.com/git-hub-cc/WebChat/stargazers)
[![GitHub forks](https://img.shields.io/github/forks/git-hub-cc/WebChat.svg?style=social)](https://github.com/git-hub-cc/WebChat/network/members)

[中文版本](./README-cn.md)

This is a feature-rich, modern web chat application that has been completely refactored. The frontend is built with **Vue 3**, **Vite**, and **Pinia**, enabling componentization and efficient state management, while the backend is driven by a robust **Java Spring Boot**. The application utilizes **WebRTC** for direct peer-to-peer media communication, supporting text, file sharing, voice/sticker messages, and real-time audio/video/screen-sharing calls.

The project introduces an innovative **Federation** feature, allowing multiple independent backend instances to interconnect, enabling cross-server user presence synchronization and seamless communication. The AI system has also been significantly enhanced, supporting an **API key pool**, a **Memory Book** feature for long-term memory, **character card import/export**, **Text-to-Speech (TTS)**, and **Speech-to-Text (STT)**, delivering an unprecedentedly deep and immersive interactive experience.

**Live Demo:**
* https://ppmc.club/webchat-vue/
* https://git-hub-cc.github.io/WebChat/

## ✨ Features

*   **Core Communication (WebRTC):**
    *   **One-on-one and Group Chats:** Engage in private conversations or create groups with multiple members (including both humans and AIs).
        *   Supports text, file sharing, voice messages, and stickers.
    *   **Real-time Audio/Video Calls:** High-quality one-on-one audio/video calls with call quality monitoring and adaptive adjustments.
        *   Supports minimizing the call window and toggling a full-screen view.
    *   **Screen Sharing:** Share your entire screen or a specific application window with your chat partner.

*   **Federation Network & Scalability:**
    *   **Cross-Server User Presence:** Multiple independent backend servers can interconnect to form a federated network.
    *   **Global Online Lobby:** The "People Lobby" now displays online users from all federated servers, indicating their server of origin.
    *   **Seamless Cross-Server Communication:** Users can initiate WebRTC connections and chats with contacts on any federated server as if they were local, with the backend handling signal routing automatically.
    *   **Persistent Server Identity:** Each backend instance possesses a persistent, unique ID (GUID), ensuring the stability of the federation.

*   **AI Assistant & Advanced Interaction:**
    *   **Dynamic AI Characters:** Provides AI characters based on popular IPs through a theme system, each with a unique personality, backstory, and behavior.
    *   **Memory Book with AI Extraction:** Define key information categories (e.g., "Hobbies," "Backstory") and trigger an AI to analyze conversation history to populate a "Memory Book," providing the AI with persistent, structured long-term memory.
    *   **Character Card Management:** Import and export AI character definitions in a portable JSON format, including their personality, prompts, and embedded avatar data.
    *   **Text-to-Speech (TTS):** AI responses can be converted to speech through a dedicated TTS Store and configurable APIs, supporting dynamic model/voice selection and caching audio in IndexedDB for performance optimization.
    *   **Speech-to-Text (STT):** Use voice input (Speech-to-Text) when chatting with AI for a hands-free conversational experience.
    *   **Robust API Proxy:** The backend proxies all requests to external AI APIs, supporting an **API key pool** to improve availability and distribute load, and intelligently handles rate limiting.

*   **Modern User Interface & Experience (UI/UX):**
    *   **Vue 3 Component-Based Architecture:** The entire frontend has been refactored using Vue 3, Vite, and Pinia, resulting in highly modular, maintainable code and excellent performance.
    *   **Advanced Theming System:**
        *   Supports multiple themes with automatic switching between light and dark modes.
        *   **Custom Backgrounds:** Set unique background images for light and dark modes separately.
    *   **Virtual Scrolling:** Utilizes `vue-virtual-scroller` to efficiently render long chat histories and contact lists, ensuring smooth performance even with thousands of messages.
    *   **Refined Loading States:** Employs Skeleton Loaders to optimize the loading experience and reduce perceived waiting time.
    *   **Built-in Screenshot Editor:** Provides a powerful client-side screenshot tool for cropping and rectangular markup before sending.
    *   **Resource Center:** Centrally browse all images, videos, and files within a chat in the details panel, with a calendar view for quick date navigation.

*   **Configuration & Management:**
    *   **Type-Safe Backend Configuration:** Implements type-safe and centralized configuration management using `@ConfigurationProperties`.
    *   **Multi-Provider LLM Support:** Easily switch between preset Large Language Model (LLM) providers (e.g., OpenAI, Anthropic, DeepSeek) in the frontend settings, with automatic population of endpoints and model lists.
    *   **Comprehensive Data Persistence:** Uses IndexedDB to store chat history, contacts, settings, stickers, memory books, and media file caches locally in the browser.

## 📸 Screenshots

Here are some screenshots of the application in action, showcasing different features and themes:

**Chat Interface:**
*   Desktop View:
    ![Chat Interface - Desktop](./screenshots/Chat%20Interface/Desktop/img.png)
*   Mobile View:
    <img src="./screenshots/Chat%20Interface/Mobile/merge.png" alt="Chat Interface - Mobile">

**Video Call:**
*   Video Call with Picture-in-Picture (PiP) enabled:
    ![Video Call with PiP](./screenshots/Video%20Call%20with%20PiP/img.png)

**Theme Examples:**
*   Crayon Shin-chan Theme (Light Mode):
    ![Crayon Shin-chan Theme - Light](./screenshots/Themes/%E8%9C%A1%E7%AC%94%E5%B0%8F%E6%96%B0-%E6%B5%81%E8%89%B2.png)
*   Delicious in Dungeon Theme (Light Mode):
    ![Delicious in Dungeon Theme - Light](./screenshots/Themes/%E8%BF%B7%E5%AE%AB%E9%A5%AD-%E6%B5%81%E8%89%B2.png)
*   Delicious in Dungeon Theme (Dark Mode):
    ![Delicious in Dungeon Theme - Dark](./screenshots/Themes/%E8%BF%B7%E5%AE%AB%E9%A5%AD-%E6%B7%B1%E8%89%B2.png)

## 🛠️ Tech Stack

*   **Frontend:** **Vue 3**, **Vite**, **Pinia**, **simple-peer** (WebRTC), **vue-virtual-scroller**
*   **Backend:** **Java 17**, **Spring Boot 3**, Spring WebFlux, Spring WebSocket, Maven
*   **Core Communication Tech:** WebRTC (RTCPeerConnection, RTCDataChannel, MediaStream API)
*   **Signaling & Federation:** WebSockets
*   **NAT Traversal:** STUN/TURN (Coturn is recommended)
*   **Local Storage:** IndexedDB

## ⚙️ How It Works

1.  **Initialization:** The client generates or loads a unique user ID from IndexedDB and initializes the application state via Pinia stores.
2.  **Signaling & Connection:** The client connects to the WebSocket signaling server and registers itself. For P2P communication, it uses the server to exchange SDP and ICE candidates to establish a direct WebRTC connection.
3.  **Federation Network:**
    *   Upon startup, each backend server actively connects to the `peers` configured in its settings.
    *   Servers exchange heartbeats and their respective lists of online users via dedicated control messages (`FederatedControlMessage`).
    *   When a client needs to connect to a user on a different server, its signaling message (`SignalingMessage`) is intelligently routed by its connected server to the target user's server.
4.  **AI Interaction:**
    *   Messages sent to AI characters are routed to the backend proxy.
    *   The backend injects context (including **Memory Book** content), selects a key from the **API key pool**, and calls the configured LLM API.
    *   The AI's text response then triggers a TTS service call via the **TTS Store**, generating speech which is then cached.
5.  **Data Persistence:** All contacts, chat messages, settings, and custom data are stored in the browser's IndexedDB via the `dbService`.

## 🚀 Quick Start & Installation

### Prerequisites

*   **Node.js** (v18+) and **npm** (for the frontend)
*   **Java 17** and **Maven** (for the backend)
*   A modern web browser with WebRTC support (e.g., Chrome, Firefox)
*   Docker (recommended for running the TURN server)

### 1. Configure the Application

*   **Backend (`resources/application.yml`):**
    *   Configure `server.port`.
    *   Set `self-url` and the `peers` list in the `federation` section to enable federation.
    *   Fill in the `base_url`, `model`, and `api_keys` list for your OpenAI-compatible API in the `openai.api` section.
*   **Frontend (`src/config/AppSettings.js`):**
    *   Update `server.signalingServerUrl` and `server.allOnlineUsersApiEndpoint` to point to your backend address.
    *   Configure `peerConnectionConfig.iceServers` (STUN/TURN).

### 2. Deploy a TURN Server (Recommended)

For reliable connectivity, deploying a TURN server is highly recommended. The project provides a `docker-compose.yml` file for Coturn. Edit `turnserver.conf`, set your `realm` and user credentials, then run `docker-compose up -d`.

### 3. Run the Backend and Frontend

1.  **Backend:**
    ```bash
    # Run the Spring Boot application
    mvn spring-boot:run
    ```

2.  **Frontend:**
    ```bash
    # Navigate to the Vue project root directory
    cd /vue
    # Install dependencies
    npm install
    # Start the development server (for development)
    npm run dev
    # Or build static files for production
    npm run build
    ```
    After building, deploy all files from the `dist` directory to any static file server (like Nginx).

Open the application in two browser windows to test P2P communication.

## 🚀 How to Use

*   **Main Menu (☰):** Access your user ID, network status, and all settings.
*   **Interaction Management (+):** Add contacts, create groups, import/export character cards, and manage memory book entry sets in this centralized modal.
*   **Chat:** Select a chat, type a message, attach files (📎), send voice messages (🎙️), use stickers/emojis (😀), or take a screenshot (📸).
*   **Details Panel (👥 or click header info):** View chat information, manage group members, configure AI settings (TTS, Memory Book), and browse media resources from the chat.
*   **People Lobby (👥):** View all online users across federated servers and add them as contacts.

## 🎨 Theming

The application features a powerful and flexible theming system:
*   **Theme Definitions:** Themes are defined in `src/config/ThemeList.js`, associating a name with a CSS file and a data JSON file.
*   **CSS:** Style files are located in the `public/themes/` directory.
*   **Data (`public/data/`):** JSON files define theme-specific special contacts, including their personality, prompts, and `chapters` (story segments).
*   **Custom Backgrounds:** Users can set custom background images for light and dark modes, which are cached in IndexedDB.

## 🏗️ Modular Design & Core Components

**Frontend (Vue 3):**

*   **Stores (Pinia):**
    *   `userStore`: Manages the user, contacts, and the global online user list.
    *   `chatStore`: Manages all chat messages and temporary message states.
    *   `groupStore`: Handles group creation, member management, and group message broadcasting logic.
    *   `callStore`: Manages all state and logic for WebRTC audio/video calls.
    *   `settingsStore`: Manages themes, color schemes, and API configurations.
    *   `ttsStore`: Manages TTS requests, state, and audio caching.
    *   `memoryStore`: Responsible for Memory Book definition, generation, and storage.
    *   `uiStore`: Controls all UI states, such as modals, panels, loading states, etc.
*   **Services:**
    *   `webrtcService`: A wrapper around `simple-peer` that handles all WebRTC connections and data transmission.
    *   `apiService`: Manages all HTTP communication with the backend, including AI and TTS requests.
    *   `dbService`: An abstraction layer for IndexedDB, providing a clean API for data persistence.
*   **Components:** The application is broken down into reusable Vue components following best practices, such as `ChatList`, `MessageBubble`, `DetailsPanel`, etc.

**Backend (Java Spring Boot):**
*   Follows a standard package structure: `config`, `controller`, `dto`, `handler`, `service`, etc.
*   `SignalingWebSocketHandler`: Serves as the unified entry point for WebSockets, handling all messages from clients and peer servers.
*   `FederationService` & `FederationRoutingService`: Together, they form the core of the federation network, responsible for peer connection management, user state synchronization, and cross-server message routing.

## 💡 Future Enhancements

*   **End-to-End Encryption (E2EE):** Implement an additional encryption layer for DataChannel messages.
*   **Decentralized Group Chat:** Explore full-mesh WebRTC connections for smaller groups or GossipSub-like protocols for larger ones.
*   **Group Audio/Video Calls:** Integrate an SFU (Selective Forwarding Unit).
*   **Message Status:** Sent/Delivered/Read receipts.
*   **Advanced AI & Memory:**
    *   **Autonomous Memory Management:** Building on the Memory Book, allow the AI to autonomously decide when and what to record, creating more natural long-term memories.
    *   **Advanced Reasoning:** Research and integrate techniques like **Chain of Thought (CoT)** to support more complex problem-solving.
    *   **Proactive Interaction:** Explore enabling the AI to proactively initiate meaningful conversations at appropriate times based on its memory and personality.

## 🤝 Contribution Guide

Contributions are welcome! Please feel free to fork the repository, make your changes on a feature branch, and submit a pull request. For major changes, please open an issue first to discuss.

## 🙏 Acknowledgments & Attributions

This project utilizes and is inspired by several concepts and resources. We extend our gratitude to their creators and communities.
*   **WebRTC and WebSockets:** The core communication and signaling technologies that make this application possible. Thanks to the browser vendors for implementing these features.
*   **Java Spring Boot & Coturn:** For building robust and scalable backend services and TURN relays.
*   **AI Chat Completions (Optional Feature):**
    *   This application is designed to integrate with **OpenAI-compatible API endpoints** (configured via the backend `application.yml`). Users must provide their own endpoints and API keys.
    *   The AI characters and system prompts defined in the `public/data/` directory are **inspired by characters from popular intellectual properties (IPs)**. This content is intended for **demonstration and personal/educational purposes only** and is not affiliated with or endorsed by the respective IP holders.
*   **Text-to-Speech (TTS) (Optional Feature):**
    *   We acknowledge the developers of **GPT-SoVITS** and similar open-source TTS projects for their contributions to accessible speech synthesis technology. Special thanks to the following GPT-SoVITS community contributors (in no particular order):
        *   **GPT-SoVITS Core Developer:** [@花儿不哭 (FlowerNotCry)](https://space.bilibili.com/5760446)
        *   **Model Training & Sharing:** [@红血球AE3803 (RedBloodCellAE3803)](https://space.bilibili.com/6589795), [@白菜工厂1145号员工 (CabbageFactoryEmployee1145)](https://space.bilibili.com/518098961)
        *   **Inference Optimization & Online Services (GSV AI Lab):** [@AI-Hobbyist](https://gsv.acgnai.top/)
    *   Users are responsible for ensuring compliance with the terms of service of any TTS APIs they configure and use.
*   **Theming & Character Data:**
    *   The character themes (CSS and JSON data files) are custom-created, **inspired by the visual style and characters of the aforementioned IPs**. They are intended for illustrative purposes and to showcase the application's **theming** capabilities.
    *   This project's repository **does not directly include** any copyrighted assets (e.g., original images, audio files from the games/anime themselves) from these IPs.
*   **Music:**
    *   The call waiting music `/music/call.mp3` is from Doraemon.
*   **General Web Technologies, Inspiration & Other Thanks:**
    *   **Memory Book Concept & Inspiration:** [SillyTavern](https://github.com/SillyTavern/SillyTavern).
    *   **Theming Concept & Inspiration:** [卤v (LuV)](https://space.bilibili.com/1290496974).
    *   **This project is also open-sourced at:** [https://github.com/git-hub-cc/WebChat](https://github.com/git-hub-cc/WebChat) (Stars and Forks are welcome!)

**Disclaimer:** This project is for educational and demonstrational purposes only. Please respect all relevant copyrights and terms of service of any external APIs, services, or intellectual properties when using or adapting this code.