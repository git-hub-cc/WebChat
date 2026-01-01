/**
 * @file AppSettings.js
 * @description (Vue Refactor) 全局配置文件。
 *              定义了整个应用程序中使用的常量和默认设置。
 *              [本次更新] 优化了 STUN/TURN 服务器列表以适应国内网络环境，并增加了网络探测超时时间。
 */
export default {
    // --- 日志设置 ---
    logLevel: 'DEBUG',
    logLevels: {
        DEBUG: 0,
        INFO: 1,
        WARN: 2,
        ERROR: 3
    },

    // --- 重连策略 ---
    reconnect: {
        maxAttempts: 3,
        delay: 3000,
        backoffFactor: 1.5,
        websocket: {
            maxAttempts: 5,    // WebSocket 专用重试次数
            backoffBase: 1000, // 初始重试延迟 (ms)
            maxDelay: 10000,   // 最大重试延迟 (ms)
        }
    },

    // --- 超时设置 ---
    timeouts: {
        // [优化] 增加 ICE 收集超时时间，避免因网络抖动导致 STUN 测试误报失败
        iceGathering: 5000,
        connection: 5000,
        networkCheck: 5000,
        signalingResponse: 5000,
        callRequest: 30000,
        iceChecking: 8000, // ICE 'checking' 状态超时
    },

    // --- 网络与传输 ---
    network: {
        websocketHeartbeatInterval: 25000,
        dataChannelHighThreshold: 2 * 1024 * 1024, // DataChannel 缓冲区高水位阈值 (2MB)
        dataChannelBufferCheckInterval: 200,
        onlineUserRefreshInterval: 120000, // 自动刷新在线用户列表间隔 (2分钟)
    },

    // --- 媒体与质量 ---
    media: {
        music: 'music/call.mp3',
        chunkSize: 256 * 1024,
        maxAudioDuration: 60,
        imageCompression: 0.8,
        maxFileSize: 1024 * 1024 * 1024, // 1GB
        maxStickerSize: 3 * 1024 * 1024, // 3MB
        audioConstraints: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
        },
        // 通话质量预设
        qualityPresets: {
            'auto': { maxBitrate: null, resolution: null }, // Null 表示由浏览器自动决定
            '480p': { maxBitrate: 700 * 1000, resolution: { height: 480 } },
            '720p': { maxBitrate: 1500 * 1000, resolution: { height: 720 } },
        },
        // 屏幕共享预设
        screenSharePresets: {
            'auto': {
                label: '自动',
                resolution: {},
                frameRate: { ideal: 15, max: 30 }
            },
            'text': {
                label: '文本清晰',
                resolution: { width: 1920, height: 1080 },
                frameRate: { ideal: 10, max: 15 }
            },
            'motion': {
                label: '流畅动态',
                resolution: { width: 1280, height: 720 },
                frameRate: { ideal: 30, max: 30 }
            }
        },
        // 自适应码率规则 (ABR)
        abr: {
            poorNetworkThreshold: { packetLoss: 0.05, rtt: 350 }, // 降级阈值
            goodNetworkThreshold: { packetLoss: 0.02, rtt: 150 }, // 升级阈值
            downgradeBitrate: 500 * 1000,
            minBitrate: 300 * 1000,
            maxBitrate: 2000 * 1000,
        }
    },

    // --- UI 交互 ---
    ui: {
        messageRetractionWindow: 2 * 60 * 1000, // 2分钟内可撤回
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

    // --- 聊天配置 ---
    chat: {
        maxGroupMembers: 20
    },

    // --- AI 配置 ---
    ai: {
        sessionTime: 10 * 60 * 1000,
        groupAiSessionTime: 3 * 60 * 1000,
        promptSuffix: "一般回复1句话，具有多变、丰富台词潜力（通过表情、姿态、情境暗示）。",
        groupPromptSuffix: "当前情境说明：你现在处于一个群聊环境中，**冒号（:）之前的是用户名，冒号（:）之后的是该用户的发言内容。一般回复1句话，具有多变、丰富台词潜力（通过表情、姿态、情境暗示），小概率触发调侃其它用户。",
    },

    // --- 服务器端点 ---
    server: {
        signalingServerUrl: 'wss://ppmc.club/webchat/signaling',
        allOnlineUsersApiEndpoint: 'https://ppmc.club/webchat/api/v1/monitor/all-online-users',
        mapLocationsApiEndpoint: 'https://ppmc.club/webchat/api/v1/locations',
        apiEndpoint: "https://ppmc.club/webchat/api/v1/chat/completions",
        model: "THUDM/GLM-4-32B-0414",
        api_key: "Bearer sk-xxxx",
        max_tokens: 2048,
        ttsApiEndpoint: 'https://gsv2p.acgnai.top',
    },

    // --- WebRTC 对等连接配置 ---
    peerConnectionConfig: {
        // [优化] 移除了 Google 和 Cloudflare 等国内访问不佳的节点，保留自建 TURN 和国内速度较快的 STUN。
        // 注意：TURN 服务器本身也具备 STUN 功能，因此只要 TURN 正常，STUN 功能通常也是正常的。
        iceServers: [
            // 1. 自建 TURN 服务器 (最高优先级)
            {
                urls: "turn:ppmc.club?transport=udp",
                username: "test",
                credential: "123456"
            },
            {
                urls: "turn:ppmc.club?transport=tcp",
                username: "test",
                credential: "123456"
            },
            {
                urls: "turns:ppmc.club",
                username: "test",
                credential: "123456"
            },
            // 2. 国内访问较快的公共 STUN (作为备选)
            { urls: "stun:stun.miwifi.com:3478" },
            { urls: "stun:stun.chat.bilibili.com:3478" }
        ],
        iceTransportPolicy: 'all',
        bundlePolicy: 'max-bundle',
        rtcpMuxPolicy: 'require',
        iceCandidatePoolSize: 0,
        sdpSemantics: 'unified-plan',
    },
};