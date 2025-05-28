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

    // WebRTC配置
    peerConnectionConfig: {
        iceTransportPolicy: 'all',
        bundlePolicy: 'max-bundle',
        rtcpMuxPolicy: 'require',
        iceCandidatePoolSize: 10,
        sdpSemantics: 'unified-plan'
    },

    // 重连配置
    reconnect: {
        maxAttempts: 5,
        delay: 2000,
        backoffFactor: 1.5
    },

    // 超时配置
    timeouts: {
        iceGathering: 5000,  // 更低的超时，快速失败
        connection: 8000,
        networkCheck: 5000
    },

    // 媒体配置
    media: {
        maxAudioDuration: 60,  // 60秒
        imageCompression: 0.7  // 默认压缩率
    }
};