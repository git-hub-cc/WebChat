# P2P Modern Web Chat Application

[![GitHub stars](https://img.shields.io/github/stars/git-hub-cc/P2P-Web-Chat.svg?style=social)](https://github.com/git-hub-cc/P2P-Web-Chat/stargazers)
[![GitHub forks](https://img.shields.io/github/forks/git-hub-cc/P2P-Web-Chat.svg?style=social)](https://github.com/git-hub-cc/P2P-Web-Chat/network/members)

[中文版](./README-cn.md)

A feature-rich, modern peer-to-peer (P2P) web chat application built with vanilla JavaScript, HTML, and CSS. It leverages WebRTC for direct P2P communication, supporting text, file sharing, voice messages, and real-time audio/video/screen-sharing calls, minimizing reliance on central servers after initial peer discovery via a WebSocket-based signaling server. The application also features themed AI assistant contacts with Text-to-Speech (TTS) capabilities.

**Live Demo:**
https://175.178.216.24/

## ✨ Features

*   **Core P2P Communication (WebRTC):**
    *   **One-to-One and Group Chats:** Engage in private conversations or create groups.
        *   Text Messages
        *   File Sharing (images, videos, documents)
        *   Voice Messages
    *   **Real-time Audio/Video Calls:** Initiate and receive P2P audio/video calls (one-to-one).
        *   Video calls support Picture-in-Picture (PiP) mode, allowing you to multitask.
    *   **Screen Sharing:** Share your screen with peers.
*   **Signaling & P2P Architecture:**
    *   Uses a WebSocket server for initial peer discovery, offer/answer exchange, and ICE candidate negotiation.
    *   Establishes direct peer-to-peer connections using WebRTC.
    *   Includes STUN/TURN server configuration for NAT traversal.
    *   Automatic reconnection attempts to the signaling server.
*   **Contact & Group Management:**
    *   Add, remove, and list contacts.
    *   Create, manage, and participate in group chats.
    *   Group chats currently operate in a group owner relay mode: the owner receives messages from members and forwards them to other members in the group.
    *   Group owners can control member addition/removal.
*   **AI Assistant Contacts:**
    *   Themed AI characters based on popular fictional IPs (e.g., Genshin Impact, Renegade Immortal, Shrouding the Heavens).
    *   Generates AI responses via a configurable OpenAI-compatible API.
    *   **Text-to-Speech (TTS):** AI responses can be played as audio via a configurable TTS API (e.g., GSV AI Lab).
    *   Customizable TTS settings (voice, speed, emotion, etc.) for each AI contact.
*   **User Interface & Experience (UI/UX):**
    *   **Modular Design:** Clear separation of concerns through various UI managers.
    *   **Responsive Design:** Adapts to different screen sizes (desktop/mobile).
    *   **Theming:**
        *   Supports multiple themes (e.g., Genshin Impact, Battle Through the Heavens, Renegade Immortal, Shrouding the Heavens, Crayon Shin-chan, Delicious in Dungeon, Jujutsu Kaisen, Telegram).
        *   Most themes offer light and dark modes.
        *   Theme selection persists across sessions.
        *   Auto-detects system color scheme ("Auto" mode).
    *   **Rich Media Preview:** Preview images, audio, and basic files before sending.
    *   **Notifications:** In-app UI notifications for various events (new messages, incoming calls, system events).
    *   **Modals:** For settings, new contact/group, calls, confirmations, etc.
    *   **User ID Management:** Auto-generated user ID with copy option and configurable settings.
*   **Data Persistence:**
    *   Uses IndexedDB (`DBManager`) to store chat history, contacts, user info, and settings locally in the browser.
*   **Network & Connection Management:**
    *   Network status monitoring with UI indicators and quality indicators.
    *   Option for manual connection via SDP offer/answer exchange.
    *   Automatic P2P reconnection attempts between peers.
    *   Large messages/files are chunked over DataChannels for reliable transfer.
*   **Configuration:**
    *   External `Config.js` file for easy setup of server URLs (signaling, AI, TTS, TURN), timeouts, and other parameters.
    *   User-configurable settings (e.g., auto-connect to contacts).
*   **Error Handling:**
    *   Global error handlers for UI and application logic.
    *   Graceful degradation for image loading errors.

## 📸 Screenshots

Here are some glimpses of the application in action, showcasing different features and themes:

**Chat Interface:**
*   Desktop View:
    ![Chat Interface - Desktop](screenshots/Chat%20Interface/Desktop/img.png)
*   Mobile View:
*
  <img src="./screenshots/Chat%20Interface/Mobile/01.png" alt="Chat Interface - Mobile 1" style="width:30%;">
  <img src="./screenshots/Chat%20Interface/Mobile/02.png" alt="Chat Interface - Mobile 2" style="width:30%;">
  <img src="./screenshots/Chat%20Interface/Mobile/03.png" alt="Chat Interface - Mobile 3" style="width:30%;">

**Video Call:**
*   Video Call with Picture-in-Picture (PiP) enabled:
    ![Video Call with PiP](screenshots/Video%20Call%20with%20PiP/04.png)
**Theme Examples:**
*   Crayon Shin-chan Theme (Light Mode):
    ![Crayon Shin-chan Theme - Light](screenshots/Themes/%E8%9C%A1%E7%AC%94%E5%B0%8F%E6%96%B0-%E6%B5%85%E8%89%B2.png)
*   Delicious in Dungeon Theme (Light Mode):
    ![Delicious in Dungeon Theme - Light](screenshots/Themes/%E8%BF%B7%E5%AE%AB%E9%A5%AD-%E6%B5%85%E8%89%B2.png)
*   Delicious in Dungeon Theme (Dark Mode):
    ![Delicious in Dungeon Theme - Dark](screenshots/Themes/%E8%BF%B7%E5%AE%AB%E9%A5%AD-%E6%B7%B1%E8%89%B2.png)

## 🛠️ Tech Stack

*   **Frontend:** HTML5, CSS3, Vanilla JavaScript (ES6+ Modules)
*   **Core P2P Tech:** WebRTC (RTCPeerConnection, RTCDataChannel, MediaStream API)
*   **Signaling:** WebSockets
*   **Local Storage:** IndexedDB
*   **APIs (External, if using AI features):**
    *   OpenAI-compatible API for AI chat completions.
    *   GSV AI Lab (or similar service) for Text-to-Speech.

## ⚙️ How it Works

1.  **Initialization:** When a user opens the app, a unique User ID is generated or loaded from local storage.
2.  **Signaling:** The client connects to a WebSocket-based signaling server. This server helps peers discover each other and exchange messages (like SDP offers/answers and ICE candidates) needed to establish a direct connection.
3.  **P2P Connection:** Once signaling is complete, a direct WebRTC `RTCPeerConnection` is established between users.
    *   `RTCDataChannel` is used for text messages, file info, voice message data, and group chat messages (relayed by the group owner).
    *   `MediaStreams` are used for audio/video call data.
4.  **Local Persistence:** All contacts, chat messages, and user settings are stored in the browser's IndexedDB, making them available across sessions.
5.  **Group Chat:** Group chats are currently relayed by the group owner. The owner receives messages from members and forwards them to other members in the group.

## 🚀 Quick Start & Installation

### Prerequisites

*   A modern web browser with WebRTC support (e.g., Chrome, Firefox, Edge, Safari).
*   Java 17 and Maven (if you want to run the provided Spring Boot signaling server).

### 1. Configure the Application

*   Open `js/Config.js` (or `Config.js` in the root directory).
*   **Crucial:** Update the `server` object with your actual URLs and credentials:
    *   `signalingServerUrl`: Your WebSocket signaling server URL. The app might be pre-configured to use `wss://175.178.216.24/signaling`.
    *   `apiEndpoint` (for AI features): Your OpenAI-compatible API endpoint.
    *   `api_key` (for AI features): Your API key for the AI service.
    *   `model` (for AI features): The AI model you want to use.
    *   `ttsApiEndpoint` (for AI features): Your TTS API endpoint (e.g., GSV AI Lab).
    *   `iceServers`: Configure your STUN/TURN server details for NAT traversal. Default settings or examples might be provided (e.g., `turn:175.178.216.24:3478`). **Replace these with your own or trusted public servers.**
*   Adjust other settings in `Config.js` as needed (timeouts, log levels, etc.).

### 2. Signaling Server (Choose one)

*   **Option A: Use a Public Signaling Server (if available and trusted)**
    *   If the `signalingServerUrl` in `js/Config.js` points to an operational public server (like the pre-configured `wss://175.178.216.24/signaling`), you might not need to run your own for initial testing.

*   **Option B: Run the Bundled Spring Boot Signaling Server (`P2P-Web-Chat-Boot`)**
    1.  Clone the repository:
        ```bash
        git clone https://github.com/git-hub-cc/P2P-Web-Chat.git # Or your specific repository URL
        cd P2P-Web-Chat
        ```
    2.  Navigate to the Spring Boot project directory (e.g., `P2P-Web-Chat-Boot`).
    3.  Build and run the server using Maven:
        ```bash
        mvn spring-boot:run
        ```
        This will typically start the server on `http://localhost:8080`. The WebSocket endpoint will be `ws://localhost:8080/signaling` (or as configured in the Spring Boot app).
    4.  **Important:** If you run your own signaling server, you **must** update `signalingServerUrl` in `js/Config.js` to point to your local server address (e.g., `ws://localhost:8080/signaling`) and modify `api_key` and other configurations as needed.

### 3. Access in Browser

*   Open your browser and navigate to the address where the frontend application is being served (if running the Spring Boot server locally, this is often `http://localhost:8080`, or another address if you deploy static files elsewhere).
*   Open the application in two different browser windows or on two different devices (on the same network if using a local signaling server without NAT traversal configured for it) to test P2P functionality.
*   To ensure P2P connections work between different machines/networks, make sure your signaling server and TURN server are correctly configured and accessible.

## 🚀 Usage

*   **User ID:** A unique User ID is generated and stored on first launch. This ID is used for P2P connections. You can find and copy your ID from the main menu (☰).
*   **Main Menu (☰):**
    *   **User ID:** View and copy your User ID.
    *   **Network Status:** Check WebRTC capability and signaling server connection status.
    *   **Preferences:** Toggle auto-connect to contacts.
    *   **AI Server Configuration:** Set API endpoints, keys, and models for AI and TTS.
    *   **Theme & Color Scheme:** Choose your preferred app theme and color mode (Light/Dark/Auto).
    *   **Manual Connect:** Initiate or respond to a manual P2P connection by exchanging SDP (Session Description Protocol) info.
    *   **Danger Zone:** Reset connections, clear contacts, or clear all chat history.
*   **Adding Contacts:**
    *   Click the floating action button (+) to open the "New Chat/Group" modal.
    *   Enter the peer's ID and an optional name to add a contact.
    *   An initial connection attempt will be made.
*   **Creating Groups:**
    *   In the "New Chat/Group" modal, switch to the group tab and enter a group name.
    *   Group members can be managed from the details panel when the group chat is open (by the owner).
*   **Starting Chats/Calls:**
    *   Select a contact or group from the sidebar list.
    *   Use the input field to send text messages.
    *   Use the icons to attach files (📎), send voice messages (🎙️), or initiate video (📹), audio (📞), or screen-sharing (🖥️) calls.
*   **AI Contacts:**
    *   Special AI contacts are pre-loaded based on the selected theme.
    *   Interact with them like regular contacts.
    *   Their TTS settings can be configured in the details panel (ⓘ).
*   **Details Panel (ⓘ):**
    *   View contact/group information.
    *   Clear chat history for the current chat.
    *   Delete contact, leave/disband group (owner permission).
    *   Manage group members (if group owner).
    *   Configure TTS for AI contacts.

## 🎨 Theming

The application supports a flexible theming system:

*   **Theme Files:**
    *   CSS files are located in the `css/` directory (e.g., `Genshin Impact-light.css`, `Battle Through the Heavens-dark.css`). These define the visual appearance.
    *   JavaScript data files are in the `data/` directory (e.g., `Genshin Impact.js`, `Battle Through the Heavens.js`). These define theme-specific `SPECIAL_CONTACTS_DEFINITIONS`, including AI characters, initial messages, system prompts, and default TTS configurations.
*   **Theme Selection:**
    *   Themes can be selected from the main menu (☰).
    *   Selection includes base theme and color scheme (Light, Dark, Auto).
    *   `ThemeLoader.js` handles loading the appropriate CSS and JS data files based on user choice and system preference (for "Auto" mode).
*   **Adding a New Theme:**
    1.  Create new CSS files for your theme in the `css/` directory (e.g., `mytheme-light.css`, `mytheme-dark.css`). Define custom CSS variables and styles.
    2.  (Optional) If your theme has unique AI characters, create a new JS data file in `data/` (e.g., `mytheme.js`) defining `SPECIAL_CONTACTS_DEFINITIONS`.
    3.  Register your theme in the `ThemeLoader.themes` object in `ThemeLoader.js`.

## 🏗️ Modular Design & Core Frontend Components

The JavaScript codebase is modular, promoting separation of concerns and maintainability. Core modules include:

*   **Core Logic & Managers:**
    *   `AppInitializer.js`: Initializes the application, sets up event listeners.
    *   `ConnectionManager.js`: Manages WebSocket signaling and WebRTC peer connections.
    *   `DBManager.js`: Handles IndexedDB operations for local data storage.
    *   `UserManager.js`: Manages user identity, settings, and contacts.
    *   `ChatManager.js`: Manages chat sessions, loading/saving messages.
    *   `MessageManager.js`: Handles sending and displaying different types of messages.
    *   `GroupManager.js`: Manages group creation, membership, and group message broadcasting.
    *   `MediaManager.js`: Handles file attachments, voice recording, and previews.
    *   `VideoCallManager.js`: Manages one-to-one video/audio calls, screen sharing, stream handling, and UI.
    *   `MessageTtsHandler.js`: Manages TTS playback for messages.
    *   `ThemeLoader.js`: Handles loading themes and associated data.
    *   `Config.js`: Stores application-wide configurations (STUN/TURN, server URLs, timeouts, etc.).
    *   `Utils.js`: Provides utility functions (logging, formatting, ID generation).
    *   `EventEmitter.js`: A simple event emitter for decoupled communication between modules.
*   **UI Management:**
    *   `UIManager.js` (Overall UI coordinator, or for specific aspects if not further broken down)
    *   `ChatAreaUIManager.js`: Manages the main chat area UI.
    *   `SidebarUIManager.js`: Manages the contact/chat sidebar.
    *   `DetailsPanelUIManager.js`: Manages the right-side details panel.
    *   `ModalManager.js`: Handles creation and display of various modals.
    *   `NotificationManager.js`: Manages in-app notifications.
    *   `LayoutManager.js`: Manages overall app layout and responsiveness.
    *   `MediaUIManager.js`: Manages UI aspects for media (previews, etc.).
    *   `VideoCallUIManager.js` (UI part of `VideoCallManager`): Manages call-related UI elements.
    *   `SettingsUIManager.js`: Manages settings UI/modals.
    *   `TtsUIManager.js`: Manages UI for TTS configuration.

## 💡 Future Enhancements

*   **End-to-End Encryption (E2EE):** Implement symmetric encryption (e.g., AES) for DataChannel messages on top of inherent DTLS security for true E2EE of chat content.
*   **Decentralized Group Chat:**
    *   Explore full-mesh P2P connections for smaller groups.
    *   Investigate GossipSub-like protocols (e.g., inspired by libp2p-gossipsub) for more scalable and resilient group messaging.
*   **Group Audio/Video Calls:** Integrate SFUs (Selective Forwarding Units) or MCUs (Multipoint Conferencing Units) to support multi-party A/V calls, as WebRTC mesh is inefficient for many participants.
*   **Offline Messaging:** If the signaling server can queue messages for offline users.
*   **User Presence:** More detailed online/offline/typing indicators.
*   **Message Status:** Sent/Delivered/Read receipts.

## 🤝 Contribution Guide

Contributions are welcome! If you'd like to contribute, please feel free to fork the repository, make your changes, and then submit a pull request. For major changes, please open an issue first to discuss what you would like to change.

1.  Fork the Project
2.  Create your Feature Branch (`git checkout -b feature/AmazingFeature`)
3.  Commit your Changes (`git commit -m 'Add some AmazingFeature'`)
4.  Push to the Branch (`git push origin feature/AmazingFeature`)
5.  Open a Pull Request

## 🙏 Acknowledgements & Attributions

This project utilizes and is inspired by several concepts and resources. We extend our gratitude to their creators and communities.

*   **WebRTC & WebSockets:** The core P2P and signaling technologies that make this application possible. Thanks to the browser vendors for providing these capabilities.
*   **AI Chat Completions (Optional Feature):**
    *   The application is designed to integrate with **OpenAI-compatible API endpoints** (configurable in `Config.js`). Users need to provide their own endpoint and API key.
    *   AI characters and system prompts defined in `data/*.js` files (e.g., `Genshin Impact.js`, `Battle Through the Heavens.js`) are **inspired by characters from popular intellectual properties (IPs)** such as Genshin Impact, Battle Through the Heavens, Renegade Immortal, Shrouding the Heavens, Crayon Shin-chan, Delicious in Dungeon, and Jujutsu Kaisen. This content is **for demonstration and personal/educational use only** and is not affiliated with or endorsed by the respective IP holders.
*   **Text-to-Speech (TTS) (Optional Feature):**
    *   We appreciate the developers of GPT-SoVITS and similar open-source TTS projects for their contributions to accessible speech synthesis technology. Special thanks to the following GPT-SoVITS community contributors (in no particular order):
        *   **GPT-SoVITS Core Developer:** [@花儿不哭 (FlowerNotCry)](https://space.bilibili.com/5760446)
        *   **Model Training & Sharing:** [@红血球AE3803 (RedBloodCellAE3803)](https://space.bilibili.com/6589795), [@白菜工厂1145号员工 (CabbageFactoryEmployee1145)](https://space.bilibili.com/518098961)
        *   **Inference Optimization & Online Service (GSV AI Lab):** [@AI-Hobbyist](https://gsv.acgnai.top/)
    *   Users are responsible for ensuring compliance with the terms of service of any TTS API they configure and use.
*   **Theming & Character Data:**
    *   Character themes (CSS and JavaScript data files) are custom-created, **inspired by the visual styles and characters of the aforementioned IPs**. They are intended for illustrative purposes and to showcase the application's **theming** capabilities.
    *   This project's repository **does not directly include** any copyrighted assets (e.g., original images, audio files from the games/anime themselves) from these IPs. Avatar images are illustrative representations.
*   **Signaling & TURN Servers:**
    *   The `Config.js` file contains placeholder configurations for signaling and TURN servers (e.g., `turn:175.178.216.24:3478`). Users must deploy or configure their own reliable signaling and TURN servers for P2P communication, especially across different networks and behind NATs. Lists of public STUN servers often shared by the community (e.g., if a `stun_servers.txt` file exists) can also be a resource.
*   **Music:**
    *   The call waiting music `/music/call.mp3` is from Doraemon.
*   **General Web Technologies, Inspirations & Other Thanks:**
    *   This project is built using standard web technologies (HTML, CSS, JavaScript) and relies on features provided by modern web browsers.
    *   Inspiration was drawn from various P2P chat applications and the following resources and community members:
        *   **Conversational AI Services (Example):** [Alibaba Cloud Bailian Large Model Platform](https://bailian.console.aliyun.com/), and similar.
        *   **Page Layout & UI Inspiration:** [Telegram Web](https://web.telegram.org/).
        *   **Theme Concepts & Inspiration:** [@卤v (LuV)](https://space.bilibili.com/1290496974).
        *   **Material Resources:** Thanks to the many unnamed contributors on the internet for open material resources (users should ensure compliance when using materials).
        *   **This project is also open-sourced at:** [https://github.com/git-hub-cc/P2P-Web-Chat](https://github.com/git-hub-cc/P2P-Web-Chat) (Stars & Forks welcome!)

**Disclaimer:** This project is for educational and demonstrational purposes only. Please respect all relevant copyrights and terms of service of any external APIs, services, or intellectual property when using or adapting this code.