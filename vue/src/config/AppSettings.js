/**
 * @file AppSettings.js
 * @description (Vue Refactor) 全局配置文件。
 *              定义了整个应用程序中使用的常量和默认设置。
 */
export default {
    logLevel: 'DEBUG',
    logLevels: {
        DEBUG: 0,
        INFO: 1,
        WARN: 2,
        ERROR: 3
    },
    reconnect: {
        maxAttempts: 3,
        delay: 3000,
        backoffFactor: 1.5,
        websocket: {
            maxAttempts: 3,
            backoffBase: 2000
        }
    },
    timeouts: {
        iceGathering: 3000,
        connection: 5000,
        networkCheck: 5000,
        signalingResponse: 5000,
        callRequest: 30000,
    },
    network: {
        websocketHeartbeatInterval: 25000,
        dataChannelHighThreshold: 2 * 1024 * 1024,
        dataChannelBufferCheckInterval: 200
    },
    media: {
        music: 'music/call.mp3', // Note: In Vite, public assets are served from root
        chunkSize: 256 * 1024,
        maxAudioDuration: 60,
        imageCompression: 0.8,
        maxFileSize: 1024 * 1024 * 1024,
        maxStickerSize: 3 * 1024 * 1024,
        audioConstraints: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
        }
    },
    ui: {
        messageRetractionWindow: 2 * 60 * 1000, // 消息可撤回时间窗口 (2分钟)
        contextMenuAutoHide: 3000,
        virtualScroll: {
            batchSize: 15,
            contextLoadSize: 10
        },
        screenshotEditor: {
            minCropSize: 20,
            defaultMarkColor: '#FF0000',
            defaultMarkLineWidth: 3
        }
    },
    chat: {
        maxGroupMembers: 20
    },
    ai: {
        sessionTime: 10 * 60 * 1000,
        groupAiSessionTime: 3 * 60 * 1000,
        promptSuffix: "一般回复1句话，具有多变、丰富台词潜力（通过表情、姿态、情境暗示）。",
        groupPromptSuffix: "当前情境说明：你现在处于一个群聊环境中，**冒号（:）之前的是用户名，冒号（:）之后的是该用户的发言内容。一般回复1句话，具有多变、丰富台词潜力（通过表情、姿态、情境暗示），小概率触发调侃其它用户。",
    },
    server: {
        // signalingServerUrl: 'ws://localhost:8080/signaling',
        // // [修改] 更新API端点以支持联邦网络
        // localLobbyApiEndpoint: 'http://localhost:8080/api/monitor/online-user-ids',
        // allOnlineUsersApiEndpoint: 'http://localhost:8080/api/monitor/all-online-users',
        signalingServerUrl: 'wss://ppmc.club/webchat/signaling',
        // [修改] 更新API端点以支持联邦网络
        localLobbyApiEndpoint: 'https://ppmc.club/webchat/api/monitor/online-user-ids',
        allOnlineUsersApiEndpoint: 'https://ppmc.club/webchat/api/monitor/all-online-users',
        apiEndpoint: "https://ppmc.club/webchat/v1/chat/completions",
        model: "THUDM/GLM-4-32B-0414",
        api_key: "Bearer sk-xxxx",
        max_tokens: 2048,
        ttsApiEndpoint: 'https://gsv2p.acgnai.top',
    },
    peerConnectionConfig: {
        iceServers: [
            { urls: "stun:stun.miwifi.com:3478" },
            {
                urls: "turn:175.178.216.24:3478",
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
};