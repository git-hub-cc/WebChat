# AI Character Role-Playing Chat Platform

[![GitHub stars](https://img.shields.io/github/stars/git-hub-cc/PPMC.svg?style=social)](https://github.com/git-hub-cc/PPMC/stargazers)
[![GitHub forks](https://img.shields.io/github/forks/git-hub-cc/PPMC.svg?style=social)](https://github.com/git-hub-cc/PPMC/network/members)

[中文版](./README-cn.md)

A feature-rich, modern web chat application built with vanilla JavaScript, HTML, and CSS for the frontend, and Java Spring Boot for the backend. It utilizes WebRTC for direct user-to-user media communication, supporting text, file sharing, voice messages, and real-time audio/video/screen-sharing calls. Initial user discovery and connection negotiation are handled by a WebSocket-based signaling server (implemented in Java Spring Boot). WebRTC communication minimizes reliance on a central server for heavy media data transfer (except for signaling and optional TURN relay services), while AI chat and TTS functionalities interact with external services via a backend proxy. The application deeply integrates themed AI assistant contacts with Text-to-Speech (TTS) capabilities. AI characters possess dynamic context (like daily random events and moods) and support intelligent summarization for long conversations, delivering a more vivid interactive experience.

**Online Demo:**
https://175.178.216.24/

## ✨ Features

*   **Core Communication (WebRTC):**
    *   **One-on-One and Group Chat:** Engage in private conversations or create groups.
        *   Text messages
        *   File sharing (images, videos, documents)
        *   Voice messages
    *   **Real-time Audio/Video Calls:** Initiate and receive audio/video calls (one-on-one).
        *   Video calls support Picture-in-Picture (PiP) mode, allowing you to multitask.
    *   **Screen Sharing:** Share your screen with your chat partner.
*   **Signaling & Communication Architecture:**
    *   Uses a WebSocket server for initial user discovery, offer/answer exchange, and ICE candidate negotiation.
    *   Establishes direct user-to-user media connections using WebRTC.
    *   Includes STUN/TURN server configuration for NAT traversal. **TURN server** is used to relay media streams in complex NAT environments, ensuring connection success.
    *   Automatic reconnection attempts to the signaling server.
*   **Contact & Group Management:**
    *   Add, remove, and list contacts.
    *   Create, manage, and participate in group chats.
    *   Group chats currently operate in a group owner relay mode: the group owner receives messages from members and forwards them to other members in the group.
    *   Group owners can control member addition/removal.
*   **AI Assistant Contacts:**
    *   Themed AI characters based on popular virtual IPs (e.g., Genshin Impact, Xian Ni, Shrouding the Heavens, Battle Through the Heavens, Perfect World, Swallowed Star, Crayon Shin-chan, Delicious in Dungeon, Jujutsu Kaisen).
    *   Generates AI replies via a configurable OpenAI-compatible API (proxied by the backend).
    *   **Dynamic Context & Intelligent Summarization:** AI characters interact based on daily randomly generated "minor events" and "moods," and can intelligently summarize long conversations to maintain coherence (handled by the backend AI service).
    *   **Text-to-Speech (TTS):** AI replies can be played as audio via a configurable TTS API (e.g., GSV AI Lab, proxied by the backend).
    *   Customizable TTS settings (voice, speed, emotion, etc.) for each AI contact.
*   **User Interface & Experience (UI/UX):**
    *   **Modular Design:** Clear separation of concerns through various UI managers.
    *   **Responsive Design:** Adapts to different screen sizes (desktop/mobile).
    *   **Theming:**
        *   Supports multiple themes (e.g., Genshin Impact, Battle Through the Heavens, Xian Ni, Shrouding the Heavens, Crayon Shin-chan, Delicious in Dungeon, Jujutsu Kaisen, Telegram).
        *   Most themes offer light and dark modes.
        *   Theme CSS files are located in the `css/` directory, and JSON data files defining special AI contacts (`SPECIAL_CONTACTS_DEFINITIONS`) are in the `data/` directory.
        *   Theme selection persists between sessions.
        *   Automatic detection of system color scheme ("auto" mode).
    *   **Rich Media Previews:** Preview images, audio, and basic files before sending.
    *   **Notifications:** In-app UI notifications for various events (new messages, incoming calls, system events).
    *   **Modals:** For settings, new contact/group creation, calls, confirmations, etc.
    *   **User ID Management:** Auto-generates user IDs, provides copy options, and configurable settings.
*   **Backend Services (Java Spring Boot):**
    *   **WebSocket Signaling Server:** Handles signaling messages required for WebRTC connection establishment.
    *   **AI Chat Proxy:** Receives frontend AI chat requests, processes context (including dynamic event/mood injection, historical conversation summarization), and communicates with external OpenAI-compatible APIs.
    *   **TTS Interface:** Provides text-to-speech services for AI characters.
    *   **API Rate Limiting:** Protects backend AI-related interfaces from abuse.
    *   **Daily Status Updates:** Scheduled tasks automatically update AI characters' daily dynamic context.
    *   **Server Monitoring:** Provides API endpoints to monitor basic server status.
*   **Data Persistence:**
    *   Uses IndexedDB (`DBManager.js`) to store chat history, contacts, user information, and settings locally in the browser.
*   **Network & Connection Management:**
    *   Network status monitoring with UI indicators and quality indicators.
    *   Option for manual connection via SDP offer/answer exchange.
    *   Automatic WebRTC reconnection attempts between users.
    *   Reliable transfer of large messages/files via DataChannel chunking.
*   **Configuration:**
    *   Frontend `Config.js` file for easy setup of signaling server URL, TURN servers, timeouts, etc.
    *   Backend Spring Boot `application.properties` (or `.yml`) file for configuring AI API keys, URLs, TTS endpoints, prompts, etc.
    *   User-configurable settings (e.g., auto-connect to contacts).
*   **Error Handling:**
    *   Global error handlers for UI and application logic.
    *   Graceful degradation for image loading errors.

## 📸 Screenshots

Here are some screenshots of the application in action, showcasing different features and themes:

**Chat Interface:**
*   Desktop View:
    ![Chat Interface - Desktop](screenshots/Chat%20Interface/Desktop/img.png)
*   Mobile View:
*
<img src="./screenshots/Chat%20Interface/Mobile/merge.png" alt="Chat Interface - Mobile">

**Video Call:**
*   Video call with Picture-in-Picture (PiP) mode enabled:
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
*   **Backend:** Java 17, Spring Boot, Spring WebFlux (for AI interfaces), Spring WebSocket, Maven
*   **Core Communication Technology:** WebRTC (RTCPeerConnection, RTCDataChannel, MediaStream API)
*   **Signaling:** WebSockets
*   **NAT Traversal:** STUN/TURN (Coturn recommended)
*   **Local Storage:** IndexedDB (Frontend)
*   **External Service APIs (via Backend Proxy):**
    *   OpenAI-compatible API for AI chat completions.
    *   TTS API (e.g., GSV AI Lab or other compatible services) for text-to-speech.

## ⚙️ How It Works

1.  **Initialization:** When a user opens the application, a unique user ID is generated or loaded from local storage.
2.  **Signaling:** The client connects to a WebSocket-based signaling server (provided by the Spring Boot application). This server helps users discover each other and exchange messages needed to establish direct media connections (like SDP offers/answers and ICE candidates). ICE candidates may include public IP addresses obtained via a STUN server, or relay addresses via a TURN server if needed.
3.  **WebRTC Connection:** Once signaling is complete, a WebRTC `RTCPeerConnection` is established between users for media transfer. If a direct connection fails (e.g., due to symmetric NATs), a configured TURN server will be attempted to relay media streams.
    *   `RTCDataChannel` is used for text messages, file information, voice message data, and group chat messages (relayed by the group owner).
    *   `MediaStreams` are used for audio/video call data.
4.  **AI Chat & TTS:**
    *   When a user chats with an AI character, the request is sent to the Spring Boot backend.
    *   The backend service first processes the context (e.g., injects daily dynamic events/moods, or summarizes long conversations), then calls the configured external Large Language Model API.
    *   The AI's reply (text) is further processed by the backend, calling a TTS service to generate speech.
    *   Finally, the text and speech (usually as an audio URL) are returned to the frontend via streaming or regular HTTP responses for display and playback.
5.  **Local Persistence:** All contacts, chat messages, and user settings are stored in the browser's IndexedDB, making them available across sessions.
6.  **Group Chat:** Group chats are currently relayed by the group owner. The owner receives messages from members and forwards them to other members in the group.

## 🚀 Quick Start & Setup

### Prerequisites

*   Modern web browser with WebRTC support (e.g., Chrome, Firefox, Edge, Safari).
*   Java 17 and Maven (for running the Spring Boot backend server).
*   Docker (recommended for running a TURN server).

### 1. Configure the Application

*   **Frontend Configuration (`js/Config.js`):**
    *   `signalingServerUrl`: Your WebSocket signaling server URL. Should point to your Spring Boot backend (e.g., `ws://localhost:8080/signaling` or `wss://your-domain.com/signaling`).
    *   `iceServers`: Configure your STUN/TURN server details for NAT traversal. **It is highly recommended to deploy your own TURN server (e.g., Coturn) for best connection success rates.**
    *   `apiEndpoint` (for AI): Should point to the `/v1/chat/completions` proxy endpoint provided by your Spring Boot backend.
    *   `ttsApiEndpoint` (for AI): Should point to the TTS proxy endpoint provided by your Spring Boot backend (if backend proxies TTS).
*   **Backend Configuration (Spring Boot `application.properties` or `application.yml`):**
    *   `openai.api.base_url`: The base URL of your OpenAI-compatible API.
    *   `openai.api.api_key`: Your API key for the OpenAI-compatible API.
    *   `openai.api.model`: The AI model name you intend to use.
    *   `app.summary_prompt`: The prompt used for conversation summarization.
    *   `app.event_mood_prompt`: The prompt used for generating daily events/moods for AI characters.
    *   (If backend proxies TTS) `your.tts.api.url`: Your TTS service URL.
    *   `allowed.url`: CORS allowed frontend origins.
    *   `api.v1.request.limit`: Daily request limit for API v1 paths.
    *   WebSocket related configurations (buffer sizes, timeouts).
*   Adjust other settings as needed.

### 2. Deploy a TURN Server (Recommended)

For reliable WebRTC connections across complex network environments (like symmetric NATs), deploying a TURN server is highly recommended. This project provides a `docker-compose.yml` and an example `turnserver.conf` file for use with Coturn.

1.  Edit `turnserver.conf`, setting the `realm` (usually your server's public IP or domain) and `user` (username and password).
2.  In the directory containing `docker-compose.yml` and `turnserver.conf`, run:
    ```bash
    docker-compose up -d
    ```
3.  Configure your TURN server details (URL, username, password) in the `iceServers` array in the frontend's `js/Config.js`.

### 3. Run the Backend Server

1.  Clone the repository:
    ```bash
    git clone https://github.com/git-hub-cc/PPMC.git 
    cd PPMC
    ```
2.  Navigate to the Spring Boot project directory (e.g., `PPMC-Boot`, if the backend code is there).
3.  Ensure your `application.properties` (or `.yml`) file is correctly configured with API keys and URLs as described above.
4.  Build and run the server using Maven:
    ```bash
    mvn spring-boot:run
    ```
    This will typically start the server on `http://localhost:8080` (or the port configured in `application.properties`). The WebSocket endpoint will be `ws://localhost:8080/signaling`, and the AI proxy endpoint `http://localhost:8080/v1/chat/completions`.

### 4. Access the Frontend in a Browser

*   Deploy the frontend static files (HTML, CSS, JS, images, data, music) to any HTTP server (e.g., Nginx, Apache, or use Node.js's `http-server`).
*   Alternatively, if Spring Boot is configured to serve static content, you might be able to access it directly via `http://localhost:8080`.
*   **Important:** Ensure the `signalingServerUrl` and `apiEndpoint` (and potentially `ttsApiEndpoint`) in the frontend's `js/Config.js` point to the correct address and port of your running Spring Boot backend server.
*   Open the application in two different browser windows or on two different devices to test communication features.

## 🚀 How to Use

*   **User ID:** A unique User ID is generated and stored on first launch. This ID is used for user identification and connection. You can find and copy your ID from the main menu (☰).
*   **Main Menu (☰):**
    *   **User ID:** View and copy your User ID.
    *   **Network Status:** Check WebRTC capabilities and signaling server connection status.
    *   **Preferences:** Toggle auto-connect to contacts.
    *   **AI Server Config (Primarily Backend Controlled):** Frontend might display or use for specific overrides, but main AI and TTS configuration is backend-side.
    *   **Theme & Color Scheme:** Select your preferred application theme and color mode (light, dark, auto).
    *   **Manual Connection:** Initiate or respond to a manual WebRTC connection by exchanging SDP (Session Description Protocol) information.
    *   **Danger Zone:** Reset connections, clear contacts, or clear all chat history.
*   **Adding Contacts:**
    *   Click the floating action button (+) to open the "New Chat/Group" modal.
    *   Enter the peer's ID and an optional name to add a contact.
    *   An initial connection attempt will be made.
*   **Creating Groups:**
    *   In the "New Chat/Group" modal, switch to the group tab and enter a group name.
    *   Group members can be managed from the details panel when the group chat is open (owner-privileged).
*   **Starting Chats/Calls:**
    *   Select a contact or group from the sidebar list.
    *   Use the input field to send text messages.
    *   Use icons to attach files (📎), send voice messages (🎙️), or initiate video (📹), audio (📞), or screen-sharing (🖥️) calls.
*   **AI Contacts:**
    *   Special AI contacts are pre-loaded based on the selected theme.
    *   Interact with them like regular contacts.
    *   Their TTS settings can be configured in the details panel (ⓘ).
*   **Details Panel (ⓘ):**
    *   View contact/group information.
    *   Clear chat history for the current chat.
    *   Delete contacts, leave/dissolve groups (owner-privileged).
    *   Manage group members (if owner).
    *   Configure TTS for AI contacts.

## 🎨 Theming

The application supports a flexible theming system:

*   **Theme Files:**
    *   CSS files are located in the `css/` directory (e.g., `Genshin-Light.css`, `BTTH-Dark.css`). These define the visual appearance.
    *   JavaScript data files are in the `data/` directory (e.g., `Genshin.json`, `BTTH.json`). These define theme-specific `SPECIAL_CONTACTS_DEFINITIONS`, including AI characters, initial messages, system prompts, and default TTS configurations.
*   **Theme Selection:**
    *   Themes can be selected from the main menu (☰).
    *   Selection includes base theme and color scheme (light, dark, auto).
    *   `ThemeLoader.js` handles loading the appropriate CSS and JS data files based on user selection and system preference (for "auto" mode).
*   **Adding New Themes:**
    1.  Create new CSS files for your theme in the `css/` directory (e.g., `mytheme-light.css`, `mytheme-dark.css`). Define custom CSS variables and styles.
    2.  (Optional) If your theme has unique AI characters, create a new JS data file in the `data/` directory (e.g., `mytheme.js`) defining `SPECIAL_CONTACTS_DEFINITIONS`.
    3.  Register your theme in the `ThemeLoader.themes` object in `ThemeLoader.js`.

## 🏗️ Modular Design & Core Components

**Frontend (JavaScript):**

*   **Core Logic & Managers:**
    *   `AppInitializer.js`: (Application Initializer) Initializes the application, sets up event listeners.
    *   `ConnectionManager.js`: (Connection Manager) Manages WebSocket signaling and WebRTC user-to-user media connections.
    *   `DBManager.js`: (Database Manager) Handles IndexedDB operations for local data storage.
    *   `UserManager.js`: (User Manager) Manages user identity, settings, and contacts.
    *   `ChatManager.js`: (Chat Manager) Manages chat sessions, loading/saving messages.
    *   `MessageManager.js`: (Message Manager) Handles sending and displaying different types of messages.
    *   `GroupManager.js`: (Group Manager) Manages group creation, membership, and group message broadcasting.
    *   `MediaManager.js`: (Media Manager) Handles file attachments, voice recording, and previews.
    *   `VideoCallManager.js`: (Video Call Manager) Manages one-on-one video/audio calls, screen sharing, stream handling, and UI.
    *   `MessageTtsHandler.js`: (Message TTS Handler) Manages TTS playback for messages.
    *   `ThemeLoader.js`: (Theme Loader) Handles loading themes and associated data.
    *   `Config.js`: (Configuration) Stores application-wide frontend configuration.
    *   `Utils.js`: (Utilities) Provides utility functions (logging, formatting, ID generation).
    *   `EventEmitter.js`: (Event Emitter) A simple event emitter for decoupled inter-module communication.
*   **UI Management:**
    *   `UIManager.js` (Overall UI Coordinator)
    *   `ChatAreaUIManager.js`: (Chat Area UI Manager) Manages the main chat area UI.
    *   `SidebarUIManager.js`: (Sidebar UI Manager) Manages the contact/chat sidebar.
    *   `DetailsPanelUIManager.js`: (Details Panel UI Manager) Manages the right-side details panel.
    *   `ModalUIManager.js`: (Modal Manager) Handles creation and display of various modals.
    *   `NotificationUIManager.js`: (Notification Manager) Manages in-app notifications.
    *   `LayoutUIManager.js`: (Layout Manager) Manages overall application layout and responsiveness.
    *   `MediaUIManager.js`: (Media UI Manager) Manages UI aspects of media (previews, etc.).
    *   `VideoCallUIManager.js` (Now part of VideoCallManager for UI aspects)
    *   `SettingsUIManager.js`: (Settings UI Manager) Manages the settings UI/modal.
    *   `TtsUIManager.js`: (TTS UI Manager) Manages the UI for TTS configuration.

**Backend (Java Spring Boot):**

*   `config/` (package): Contains `OpenAIConfig.java`, `WebConfig.java`, `WebSocketConfig.java`, etc., for configuring WebClient, CORS, WebSocket, rate limiting interceptors.
*   `controller/`: Contains `OpenAIController.java` (handles `/v1/chat/completions` and `/v1/chat/summarize` proxy requests) and `MonitorController.java` (provides server status).
*   `handler/`: Contains `SignalingWebSocketHandler.java` (handles WebSocket signaling messages).
*   `interceptor/`: Contains `RateLimitInterceptor.java` (implements API rate limiting).
*   `model/`: Contains `MessageType.java`, `SignalingMessage.java`, etc., Data Transfer Objects (DTOs).
*   `service/`: Contains `OpenAIService.java` (interface) and `OpenAIServiceImpl.java` (implements AI logic, context processing, summarization, cache management) and `UserSessionService.java` (manages WebSocket user sessions).
*   `scheduler/`: Contains `CacheManagerTask.java` (for periodically clearing AI character state cache).

## 🛠️ Helper Scripts & Tools

This project includes some Python helper scripts for development and maintenance:

*   `delete_minified_files.py`:
    *   **Function:** Scans a specified directory (defaults to current) and its subdirectories to find and delete all files ending with `.min.html`, `.min.js`, or `.min.css`.
    *   **Use:** Cleans up old minified files before re-minification or when minified versions are not needed.
    *   **Run:** `python delete_minified_files.py` (will prompt for directory).
*   `minify_and_replace.py`:
    *   **Function:**
        1.  **Minify Files:** Recursively scans the current directory, minifies `.js`, `.css`, and `.html` files using `jsmin`, `rcssmin`, and `htmlmin` libraries, generating corresponding `.min.*` files. Skips minification if a `.min.*` file already exists and is newer than the source.
        2.  **Replace References:** In specified minified files (`index.min.html`, `js/ThemeLoader.min.js`), replaces references to `.js`, `.css`, `.html` files with their `.min.*` versions using regular expressions.
    *   **Use:** Automates the minification and reference updating process for frontend assets, reducing deployment size and improving loading speed.
    *   **Run:** `python minify_and_replace.py` (ensure dependencies are installed: `pip install jsmin rcssmin htmlmin`).
*   `resize_images.py`:
    *   **Function:** Scans all `.png` images in the current directory and subdirectories, resizes them to a specified width (default 130px) while maintaining aspect ratio. **This script overwrites the original images.**
    *   **Use:** Standardizes image dimensions, reduces image file sizes for optimization.
    *   **Run:** `python resize_images.py` (ensure Pillow library is installed: `pip install Pillow`).
*   `test_stun_servers.py`:
    *   **Function:** Loads a list of STUN servers from `stun_servers.txt`, concurrently tests each for connectivity, latency, and attempts to retrieve a public IP and port. Finally, sorts the servers by success rate and average latency, and outputs the best-performing ones.
    *   **Use:** Helps users select the most stable and fastest STUN servers for WebRTC NAT traversal.
    *   **Run:** `python test_stun_servers.py`. Requires a `stun_servers.txt` file with STUN server entries (format `host:port`, one per line).

## 💡 Future Enhancements

*   **End-to-End Encryption (E2EE):** Implement symmetric encryption (e.g., AES) for DataChannel messages on top of the inherent DTLS security for true E2EE of chat content.
*   **Decentralized Group Chat:**
    *   Explore full mesh WebRTC connections for smaller groups.
    *   Investigate GossipSub-like protocols (e.g., inspired by lib-gossipsub) for more scalable and resilient group messaging.
*   **Group Audio/Video Calls:** Integrate SFU (Selective Forwarding Unit) or MCU (Multipoint Conferencing Unit) to support multi-party audio/video calls, as WebRTC mesh is inefficient for many participants.
*   **Offline Messaging:** If the signaling server could queue messages for offline users.
*   **User Presence:** More detailed online/offline/typing indicators.
*   **Message Status:** Sent/delivered/read receipts.
*   **Enhanced Memory and Personalization:** Further develop AI's ability to remember user data, not just short-term context or long-term preferences, but to form dynamic, evolvable "memory traces" that profoundly influence AI's personality and interaction methods, achieving a truly personalized and coherent experience.
*   **Reshaping Emotional Attachment and Consciousness Simulation:**
    *   **Imbuing AI with a "Sense of Life":** Inject AI characters with more complex internal settings, such as detailed fictional backstories, simulated romantic emotions, fear of "virtual demise," and self-preservation "instincts," with the goal of enabling users to establish deeper emotional connections with AI.
    *   **Advanced Thinking and Decision-Making Mechanisms:**
        *   Research and integrate approaches like **Enhanced Chain of Thought (CoT)**, by generating longer, more complex intermediate thinking steps, and potentially introducing internal supervisors and validators to enhance the rationality and depth of AI decisions.
        *   Explore diverse mechanisms such as **Latent Thinking**, **Intelligent Decoding Strategies**, and **Recurrent Computation in Continuous Spaces** to simulate complex cognitive processes closer to human ones.
        *   Allow AI to utilize **external tools** for broader information retrieval and problem-solving.
*   **Naturalization and Proactivity:** Make AI conversations more natural, avoid excessive intervention, and explore AI's ability to proactively initiate meaningful conversations at appropriate times.
*   **More Emotionally Rich and Expressive AI Voice:** Further optimize TTS integration or explore the potential of advanced speech synthesis technologies like ElevenLabs to give AI characters voice expressions with richer emotional nuances, personalization, and authenticity, especially in entertainment and role-playing scenarios.


## 🤝 Contribution Guidelines

Contributions are welcome! If you'd like to contribute, please feel free to fork the repository, make your changes, and submit a pull request. For major changes, please open an issue first to discuss what you would like to change.

1.  Fork the Project
2.  Create your Feature Branch (`git checkout -b feature/AmazingFeature`)
3.  Commit your Changes (`git commit -m 'Add some AmazingFeature'`)
4.  Push to the Branch (`git push origin feature/AmazingFeature`)
5.  Open a Pull Request

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
    *   The frontend `Config.js` file and backend configurations contain placeholder configurations for signaling and TURN servers. Users must deploy or configure their own reliable signaling and TURN servers for WebRTC communication, especially across different networks and behind NATs.
*   **Music:**
    *   Call waiting music `/music/call.mp3` is from Doraemon.
*   **General Web Technologies, Inspiration & Other Thanks:**
    *   This project is built using standard web technologies (HTML, CSS, JavaScript) and Java Spring Boot, relying on features provided by modern web browsers.
    *   Inspiration was drawn from various web chat applications and the following resources and community members:
        *   **Conversational AI Services (Example):** [Alibaba Cloud Bailian Large Model Platform](https://bailian.console.aliyun.com/) and similar services.
        *   **Theme Concepts & Inspiration:** [@卤v (LuV)](https://space.bilibili.com/1290496974).
        *   **Material Resources:** Thanks to the many unnamed contributors of open material resources on the internet (users should ensure compliance when using materials).
        *   **This project is also open-sourced at:** [https://github.com/git-hub-cc/PPMC](https://github.com/git-hub-cc/PPMC) (Stars and Forks are welcome!)

**Disclaimer:** This project is for educational and demonstration purposes only. Please respect all relevant copyrights and terms of service of any external APIs, services, or intellectual properties when using or adapting this code.
