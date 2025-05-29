const Config = {
    // ICE服务器配置
    iceServers: [
        {
            "urls": [
                "turn:stun.evan-brass.net",
                "turn:stun.evan-brass.net?transport=tcp",
                "stun:stun.evan-brass.net"
            ],
            "username": "guest",
            "credential": "password"
        }
    ],

    // WebRTC PeerConnection Configuration
    peerConnectionConfig: {
        iceTransportPolicy: 'all', // 'all' or 'relay'
        bundlePolicy: 'max-bundle', // Recommended for performance
        rtcpMuxPolicy: 'require',   // Recommended
        iceCandidatePoolSize: 0,   // 0 for immediate candidate gathering, or a small number like 5-10
        sdpSemantics: 'unified-plan', // Standard
    },

    // Reconnection Strategy
    reconnect: {
        maxAttempts: 3,       // Max number of reconnection attempts
        delay: 3000,          // Initial delay in ms
        backoffFactor: 1.5    // Multiplier for subsequent delays
    },

    // Timeouts
    timeouts: {
        iceGathering: 8000,   // Max time for ICE gathering (ms)
        connection: 15000,    // Max time for connection to establish (ms)
        networkCheck: 10000,  // Interval for checking network stats during calls (ms)
        signalingResponse: 10000 // Timeout for waiting for signaling server responses
    },

    // Media Settings
    media: {
        maxAudioDuration: 60,  // Max voice note duration in seconds
        imageCompression: 0.8, // JPEG compression quality (0.0 to 1.0)
        maxFileSize: 25 * 1024 * 1024, // 25MB max file size
    },

    // DataChannel & Messaging
    chunkSize: 64 * 1024, // 64KB for message chunking (some browsers have ~64KB limit for DC messages)
                          // Test this value, browsers like Firefox might support larger chunks (up to 256KB or 1MB)
                          // But 64KB is safer for cross-browser. SCTP has a path MTU.

    // UI Settings
    ui: {
        messageRenderBatchSize: 30, // Number of messages to render at once when scrolling
        typingIndicatorTimeout: 3000 // ms
    },

    // Logging Level ('DEBUG', 'INFO', 'WARN', 'ERROR')
    logLevel: 'DEBUG', // Set to 'INFO' or 'WARN' for production
};

// Apply log level from config
// if (Utils && Utils.logLevels && Config.logLevel) {
//     Utils.currentLogLevel = Utils.logLevels[Config.logLevel.toUpperCase()] || Utils.logLevels.DEBUG;
// }