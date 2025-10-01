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
            maxAttempts: 5, // 增加重试次数
            backoffBase: 1000, // 初始重试延迟
            maxDelay: 10000, // 最大重试延迟
        }
    },
    timeouts: {
        iceGathering: 3000,
        connection: 5000,
        networkCheck: 5000,
        signalingResponse: 5000,
        callRequest: 30000,
        iceChecking: 8000, // 新增：ICE 'checking' 状态超时
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
        },
        qualityPresets: {
            'auto': { maxBitrate: null, resolution: null }, // Null means let the browser decide
            '480p': { maxBitrate: 700 * 1000, resolution: { height: 480 } },
            '720p': { maxBitrate: 1500 * 1000, resolution: { height: 720 } },
        },
        abr: { // Adaptive Bitrate Rules
            poorNetworkThreshold: { packetLoss: 0.05, rtt: 350 }, // Conditions to downgrade quality
            goodNetworkThreshold: { packetLoss: 0.02, rtt: 150 }, // Conditions to upgrade quality
            downgradeBitrate: 500 * 1000, // Bitrate for poor network conditions
            minBitrate: 300 * 1000,
            maxBitrate: 2000 * 1000,
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
        // --- 本地开发环境示例 ---
        // signalingServerUrl: 'ws://localhost:8080/signaling',
        // allOnlineUsersApiEndpoint: 'http://localhost:8080/api/monitor/all-online-users',
        // mapLocationsApiEndpoint: 'http://localhost:8080/api/map/locations', // [新增] 地图API端点
        // apiEndpoint: "http://localhost:8080/v1/chat/completions",

        // --- 生产环境配置 ---
        signalingServerUrl: 'wss://ppmc.club/webchat/signaling',
        allOnlineUsersApiEndpoint: 'https://ppmc.club/webchat/api/monitor/all-online-users',
        mapLocationsApiEndpoint: 'https://ppmc.club/webchat/api/map/locations', // [新增] 地图API端点
        apiEndpoint: "https://ppmc.club/webchat/v1/chat/completions",

        model: "THUDM/GLM-4-32B-0414",
        api_key: "Bearer sk-xxxx",
        max_tokens: 2048,
        ttsApiEndpoint: 'https://gsv2p.acgnai.top',
    },
    peerConnectionConfig: {
        iceServers: [
            {
                urls: "turn:ppmc.club:3478?transport=udp",
                username: "test",
                credential: "123456"
            },
            {
                urls: "turn:ppmc.club:3478?transport=tcp",
                username: "test",
                credential: "123456"
            },
            {
                urls: "turns:ppmc.club:5349?transport=tcp",
                username: "test",
                credential: "123456"
            },
            { urls: "stun:stun.miwifi.com:3478" },
            { urls: "stun:stun.chat.bilibili.com:3478" },
            { urls: "stun:stun.linphone.org:3478" },
            { urls: "stun:stun.cloudflare.com:3478" },
            { urls: "stun:stun.nextcloud.com:443" },
            { urls: "stun:stun.l.google.com:19302" }
        ],
        iceTransportPolicy: 'all',
        bundlePolicy: 'max-bundle',
        rtcpMuxPolicy: 'require',
        iceCandidatePoolSize: 0,
        sdpSemantics: 'unified-plan',
    },
};