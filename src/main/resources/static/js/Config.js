const Config = {
    // WebRTC PeerConnection Configuration
    peerConnectionConfig: {
        iceServers: [
            {
                urls: [
                    "turn:175.178.216.24:3478?transport=udp",
                    "turn:175.178.216.24:3478?transport=tcp"
                ],
                username: "test",
                credential: "123456"
            },
        ],
        iceTransportPolicy: 'all',
        bundlePolicy: 'max-bundle',
        rtcpMuxPolicy: 'require',
        iceCandidatePoolSize: 0,
        sdpSemantics: 'unified-plan',
    },

    reconnect: {
        maxAttempts: 3,
        delay: 3000,
        backoffFactor: 1.5
    },
    timeouts: {
        iceGathering: 3000, // Reduced from 8000. SDP is sent before this now.
        connection: 15000,
        networkCheck: 10000,
        signalingResponse: 10000
    },
    media: {
        maxAudioDuration: 60,
        imageCompression: 0.8,
        maxFileSize: 25 * 1024 * 1024,
        audioConstraints: { // Added for VideoCallManager consistency
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
        }
    },
    chunkSize: 64 * 1024,
    ui: {
        messageRenderBatchSize: 30,
        typingIndicatorTimeout: 3000
    },
    logLevel: 'DEBUG', // Set to DEBUG for easier troubleshooting, change to INFO/ERROR for prod
};