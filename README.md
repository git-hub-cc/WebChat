# P2P Web Chat

[![GitHub stars](https://img.shields.io/github/stars/git-hub-cc/P2P-Web-Chat.svg?style=social)](https://github.com/git-hub-cc/P2P-Web-Chat/stargazers)
[![GitHub forks](https://img.shields.io/github/forks/git-hub-cc/P2P-Web-Chat.svg?style=social)](https://github.com/git-hub-cc/P2P-Web-Chat/network/members)

A modern, peer-to-peer web chat application built with HTML, CSS, and Vanilla JavaScript, utilizing WebRTC for direct communication and a WebSocket-based signaling server.

**Live Demo:**
https://175.178.216.24/

## ✨ Features

*   **1-to-1 & Group Chat:** Engage in private conversations or create groups.
    *   Text Messaging
    *   File Sharing (Images, Videos, Documents)
    *   Voice Messages
*   **Real-time Communication:**
    *   1-to-1 Video & Audio Calls
    *   Picture-in-Picture (PiP) mode for video calls, allowing you to multitask.
*   **Data Persistence:**
    *   Chat history, contacts, and user settings are stored locally in your browser using IndexedDB.
*   **User Experience:**
    *   Contact Management (Add, Remove, List)
    *   Responsive Design for desktop and mobile devices.
    *   User-configurable Settings (User ID, Auto-Connect to contacts).
    *   Network Status Display & Quality Indicators.
    *   Notifications for new messages, calls, and system events.
*   **P2P Architecture:**
    *   Direct peer-to-peer connections established using WebRTC.
    *   Signaling handled via a WebSocket server for connection negotiation.
    *   Includes STUN/TURN server configurations for NAT traversal.

## 🛠️ Tech Stack

*   **Frontend:** HTML5, CSS3, Vanilla JavaScript (ES6+ Modules)
*   **Core P2P Technology:** WebRTC (RTCPeerConnection, RTCDataChannel, MediaStreams)
*   **Signaling:** WebSocket
*   **Local Storage:** IndexedDB
*   **Backend (Signaling Server):** The repository includes a Java Spring Boot application (`P2P-Web-Chat-Boot`) that can serve as the signaling server.

## ⚙️ How it Works

1.  **Initialization:** When a user opens the application, a unique User ID is generated or loaded from local storage.
2.  **Signaling:** The client connects to a WebSocket-based signaling server. This server helps peers discover each other and exchange messages necessary to establish a direct connection (like SDP offers/answers and ICE candidates).
3.  **P2P Connection:** Once signaling is complete, a direct WebRTC `RTCPeerConnection` is established between users.
    *   `RTCDataChannel` is used for sending text messages, file information, voice message data, and group chat messages (relayed by the group owner).
    *   `MediaStreams` are used for audio and video call data.
4.  **Local Persistence:** All contacts, chat messages, and user settings are stored in the browser's IndexedDB, making them available across sessions.
5.  **Group Chat:** Group chats are currently owner-relayed. The group owner receives messages from members and forwards them to other members in the group.

## 🚀 Getting Started

### Prerequisites

*   A modern web browser with WebRTC support (e.g., Chrome, Firefox, Edge, Safari).
*   Node.js and npm (optional, for using `live-server` or similar tools for local development).
*   Java 17 and Maven (if you want to run the provided Spring Boot signaling server).

### Running the Application

#### 1. Signaling Server (Choose one option)

*   **Option A: Use the provided public signaling server (if available and trusted)**
    *   The application is pre-configured in `js/ConnectionManager.js` to use `wss://175.178.216.24/signaling`.
    *   If this server is operational, you might not need to run your own signaling server for initial testing.

*   **Option B: Run the included Spring Boot Signaling Server**
    1.  Clone the repository:
        ```bash
        git clone https://github.com/git-hub-cc/P2P-Web-Chat.git
        cd P2P-Web-Chat
        ```
    2.  The Spring Boot project is likely named `P2P-Web-Chat-Boot` or is at the root. Navigate to its directory if it's a sub-directory.
    3.  Build and run the server using Maven:
        ```bash
        mvn spring-boot:run
        ```
        This will typically start the server on `http://localhost:8080`. The WebSocket endpoint would be `ws://localhost:8080/signaling` (or as configured in the Spring Boot app).
    4.  **Important:** If you run your own signaling server, you **must** update the `signalingServerUrl` in `js/ConnectionManager.js` to point to your local server address (e.g., `ws://localhost:8080/signaling`).

#### 2. Frontend

1.  The frontend consists of static HTML, CSS, and JavaScript files.
2.  **It's highly recommended to serve the frontend files via a local HTTP server** due to browser security restrictions (CORS, `file://` protocol limitations for `type="module"` scripts and media access).
    *   If you have Node.js, you can use `live-server`:
        ```bash
        npm install -g live-server
        cd P2P-Web-Chat # (navigate to the root of the frontend files)
        live-server
        ```
    *   Alternatively, use Python's built-in HTTP server (Python 3):
        ```bash
        cd P2P-Web-Chat # (navigate to the root of the frontend files)
        python -m http.server
        ```
        Then open `http://localhost:8000` (or the port shown) in your browser.
3.  Open the `index.html` file in two different browser windows or on two different devices (on the same network if using a local signaling server without NAT traversal for it) to test P2P functionality.

## 🔧 Configuration

*   **STUN/TURN Servers:** Configured in `js/Config.js`. These are crucial for NAT traversal to enable P2P connections across different networks. The project includes a default set.
*   **Signaling Server URL:** Configured in `js/ConnectionManager.js`.

## 🧩 Key Frontend Components

The JavaScript codebase is modular:

*   `AppInitializer.js`: Initializes the application, sets up event listeners.
*   `UIManager.js`: Manages all UI interactions, DOM updates, and responsiveness.
*   `DBManager.js`: Handles IndexedDB operations for local data storage.
*   `UserManager.js`: Manages user identity, settings, and contacts.
*   `ConnectionManager.js`: Manages WebSocket signaling and WebRTC peer connections.
*   `ChatManager.js`: Manages chat sessions, loading/saving messages.
*   `MessageManager.js`: Handles sending and displaying different types of messages.
*   `GroupManager.js`: Manages group creation, membership, and message broadcasting for groups.
*   `MediaManager.js`: Handles file attachments, voice recording, and previews.
*   `VideoCallManager.js`: Manages 1-to-1 video and audio calls, including stream handling and UI.
*   `Config.js`: Stores application-wide configurations (STUN/TURN, timeouts, etc.).
*   `Utils.js`: Provides utility functions (logging, formatting, ID generation).
*   `EventEmitter.js`: A simple event emitter for decoupled communication between modules.

## 💡 Future Enhancements

Based on `doc.md` and common P2P chat improvements:

*   **End-to-End Encryption:** Implement symmetric encryption (e.g., AES) for DataChannel messages on top of the inherent DTLS security for true E2EE of chat content.
*   **Decentralized Group Chat:**
    *   Explore full mesh P2P connections for smaller groups.
    *   Investigate GossipSub-like protocols (e.g., inspired by libp2p-gossipsub) for more scalable and resilient group messaging.
*   **Group Video/Audio Calls:** Integrate an SFU (Selective Forwarding Unit) or MCU (Multipoint Conferencing Unit) for multi-party video/audio calls, as WebRTC mesh becomes inefficient for many participants.
*   **Improved UI/UX:** Further refinements to user interface and experience.
*   **Offline Messaging:** If the signaling server can queue messages for offline users.
*   **User Presence:** More detailed online/offline/typing indicators.
*   **Message Status:** Sent/Delivered/Read receipts.

## 🤝 Contributing

Contributions are welcome! If you'd like to contribute, please feel free to fork the repository, make your changes, and submit a pull request. For major changes, please open an issue first to discuss what you would like to change.

1.  Fork the Project
2.  Create your Feature Branch (`git checkout -b feature/AmazingFeature`)
3.  Commit your Changes (`git commit -m 'Add some AmazingFeature'`)
4.  Push to the Branch (`git push origin feature/AmazingFeature`)
5.  Open a Pull Request


## 🙏 Acknowledgements

*   WebRTC and browser vendors for providing the P2P capabilities.
*   Inspiration from various P2P chat applications.
*   The list of public STUN servers often shared by the community (see `stun_servers.txt`).
