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
            { urls: 'stun:stun.hoiio.com:3478' },
            { urls: 'stun:stun.siplogin.de:3478' },
            { urls: 'stun:stun.zadarma.com:3478' },
            { urls: 'stun:stun.solcon.nl:3478' },
            { urls: 'stun:stun.sonetel.net:3478' },
            { urls: 'stun:stun.solnet.ch:3478' },
            { urls: 'stun:stun.freeswitch.org:3478' },
            { urls: 'stun:stun.sonetel.com:3478' }
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
    logLevel: 'ERROR',
};

// Apply log level from config
// if (Utils && Utils.logLevels && Config.logLevel) {
//     Utils.currentLogLevel = Utils.logLevels[Config.logLevel.toUpperCase()] || Utils.logLevels.DEBUG;
// }