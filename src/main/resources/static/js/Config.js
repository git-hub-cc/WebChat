/**
 * @file Config.js
 * @description 全局配置文件。该文件定义了整个应用程序中使用的常量和默认设置，
 *              包括重连策略、超时时间、媒体约束、UI行为、日志级别以及服务器和 WebRTC 的默认配置。
 *              用户在设置中修改的某些值（如 AI API 配置）会覆盖此处的默认值。
 * @module Config
 * @exports {object} Config - 包含所有配置项的全局对象。
 */
const ConfigObj = {
    /**
     * WebRTC 连接断开后的自动重连配置
     */
    reconnect: {
        maxAttempts: 3,      // 最大尝试次数
        delay: 3000,         // 初始延迟（毫秒）
        backoffFactor: 1.5   // 延迟时间的指数增长因子
    },
    /**
     * 各种操作的超时时间配置（毫秒）
     */
    timeouts: {
        iceGathering: 3000,  // ICE 候选者收集超时。现在 SDP 会在此之前发送。
        connection: 15000,   // WebRTC 连接建立总超时
        networkCheck: 10000, // 网络类型检查超时
        signalingResponse: 10000 // 等待信令服务器响应的超时
    },
    /**
     * 媒体相关配置
     */
    media: {
        maxAudioDuration: 60, // 语音消息最大录制时长（秒）
        imageCompression: 0.8, // 图片压缩质量 (0-1)
        maxFileSize: 25 * 1024 * 1024, // 最大上传文件大小 (25 MB)
        audioConstraints: {    // 音频采集约束，用于提高通话质量
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
        }
    },
    /**
     * 文件/消息分片传输时每个分片的大小（字节）
     */
    chunkSize: 64 * 1024,
    /**
     * UI 行为相关配置
     */
    ui: {
        messageRenderBatchSize: 30,
        virtualScrollBatchSize: 20,
        virtualScrollThreshold: 150,
        typingIndicatorTimeout: 3000,
        messageRetractionWindow: 5 * 60 * 1000
    },
    /**
     * 日志级别配置
     * 可选值: 'DEBUG', 'INFO', 'WARN', 'ERROR'
     * 'DEBUG' 用于开发时详细排查问题，'INFO' 或 'ERROR' 用于生产环境。
     */
    logLevel: 'DEBUG',
    /**
     * AI 相关配置
     */
    ai: {
        sessionTime: 10 * 60 * 1000, // AI 对话上下文的有效时间窗口（10分钟） - Einzelchat
        groupAiSessionTime: 3 * 60 * 1000, // AI 群聊上下文的有效时间窗口（3分钟）- NEU
        baseSystemPrompt: "一般回复1句话，具有多变、丰富台词潜力（通过表情、姿态、情境暗示）。",
        baseGroupSystemPrompt: "当前情境说明：你现在处于一个群聊环境中，**冒号（:）之前的是用户名，冒号（:）之后的是该用户的发言内容。一般回复1句话，具有多变、丰富台词潜力（通过表情、姿态、情境暗示），小概率触发调侃其它用户。",
    },
    /**
     * 呼叫音乐文件路径
     */
    music: '/music/call.mp3',
    /**
     * 服务器相关配置。
     * 这些是默认值，UI 管理器将从 localStorage 加载用户配置的值来覆盖它们。
     */
    server: {
        signalingServerUrl: 'wss://175.178.216.24/signaling',
        apiEndpoint: 'https://175.178.216.24/v1/chat/completions',
        lobbyApiEndpoint: 'https://175.178.216.24/api/monitor/online-user-ids',
        api_key: "Bearer sk-xxxx",
        model: "qwen-turbo-2025-04-28",
        max_tokens: 2048,
        ttsApiEndpoint: 'https://gsv2p.acgnai.top',
    },
    /**
     * WebRTC RTCPeerConnection 的详细配置
     */
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

    /**
     * @description 自适应音频质量配置
     */
    adaptiveAudioQuality: {
        interval: 5000,
        logStatsToConsole: true,
        baseGoodConnectionThresholds: {
            rtt: 120,
            packetLoss: 0.01,
            jitter: 20
        },
        audioQualityProfiles: [
            { levelName: "极低", maxAverageBitrate: 8000, sdpFmtpLine: "minptime=40;useinbandfec=1;stereo=0;maxaveragebitrate=8000;cbr=1;maxplaybackrate=8000", description: "非常差的网络，优先保障连接" },
            { levelName: "较低", maxAverageBitrate: 12000, sdpFmtpLine: "minptime=20;useinbandfec=1;stereo=0;maxaveragebitrate=12000;cbr=1;maxplaybackrate=12000", description: "较差网络，基础通话" },
            { levelName: "标准", maxAverageBitrate: 16000, sdpFmtpLine: "minptime=10;useinbandfec=1;stereo=0;maxaveragebitrate=16000;cbr=0;maxplaybackrate=16000", description: "一般网络，标准音质" },
            { levelName: "较高", maxAverageBitrate: 20000, sdpFmtpLine: "minptime=10;useinbandfec=1;stereo=0;maxaveragebitrate=20000;cbr=0;maxplaybackrate=20000", description: "良好网络，提升音质" },
            { levelName: "极高", maxAverageBitrate: 48000, sdpFmtpLine: "minptime=5;useinbandfec=1;stereo=1;maxaveragebitrate=48000;cbr=0;maxplaybackrate=48000", description: "优秀网络，最佳音质" }
        ],
        initialProfileIndex: 2,
        switchToHigherCooldown: 10000,
        switchToLowerCooldown: 5000,
        stabilityCountForUpgrade: 2,
        badQualityDowngradeThreshold: 2
    }
};

window.Config = ConfigObj;