const Config = {
    // WebRTC PeerConnection Configuration
    peerConnectionConfig: {
        iceServers: [
            // ---- Your Essential TURN Server ----
            {
                urls: [
                    "turn:175.178.216.24:3478?transport=udp",
                    "turn:175.178.216.24:3478?transport=tcp"
                ],
                username: "test",
                credential: "123456"
            },
            // ---- Priority STUN for China Region ----
            { urls: 'stun:stun.qq.com:3478' },
            { urls: 'stun:stun.miwifi.com:3478' }, // Already included from your long list, moved up
            // ---- Extensive list of other public STUN servers as further fallbacks ----
            { urls: 'stun:23.21.150.121:3478' },
        ],
        iceTransportPolicy: 'all',
        bundlePolicy: 'max-bundle',
        rtcpMuxPolicy: 'require',
        iceCandidatePoolSize: 0,
        sdpSemantics: 'unified-plan',
    },

    // ... rest of your Config.js remains the same
    reconnect: {
        maxAttempts: 3,
        delay: 3000,
        backoffFactor: 1.5
    },
    timeouts: {
        iceGathering: 8000,
        connection: 15000,
        networkCheck: 10000,
        signalingResponse: 10000
    },
    media: {
        maxAudioDuration: 60,
        imageCompression: 0.8,
        maxFileSize: 25 * 1024 * 1024,
    },
    chunkSize: 64 * 1024,
    ui: {
        messageRenderBatchSize: 30,
        typingIndicatorTimeout: 3000
    },
    logLevel: 'DEBUG',
};

// Apply log level from config
// if (Utils && Utils.logLevels && Config.logLevel) {
//     Utils.currentLogLevel = Utils.logLevels[Config.logLevel.toUpperCase()] || Utils.logLevels.DEBUG;
// }