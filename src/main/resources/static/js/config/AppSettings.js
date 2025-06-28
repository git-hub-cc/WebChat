/**
 * @file AppSettings.js
 * @description 全局配置文件。该文件定义了整个应用程序中使用的常量和默认设置，
 *              包括重连策略、超时时间、媒体约束、UI行为、日志级别以及服务器和 WebRTC 的默认配置。
 *              用户在设置中修改的某些值（如 AI API 配置）会覆盖此处的默认值。
 *              注意：大模型提供商的配置已移至独立的 LLMProviders.js 文件。
 * @module Config
 * @exports {object} AppSettings - 包含所有配置项的全局对象。
 */
const AppSettings = {
    /**
     * 日志级别配置
     * 可选值: 'DEBUG', 'INFO', 'WARN', 'ERROR'
     * 'DEBUG' 用于开发时详细排查问题，'INFO' 或 'ERROR' 用于生产环境。
     */
    logLevel: 'DEBUG',
    /**
     * WebRTC 连接断开后的自动重连配置
     */
    reconnect: {
        maxAttempts: 3,      // 最大尝试次数
        delay: 3000,         // 初始延迟（毫秒）
        backoffFactor: 1.5   // 延迟时间的指数增长因子 (0 表示不增长)
    },
    /**
     * 各种操作的超时时间配置（毫秒）
     */
    timeouts: {
        iceGathering: 3000,  // ICE 候选者收集超时。现在 SDP 会在此之前发送。
        connection: 5000,   // WebRTC 连接建立总超时
        networkCheck: 5000, // 网络类型检查超时
        signalingResponse: 5000 // 等待信令服务器响应的超时
    },
    /**
     * 媒体相关配置
     */
    media: {
        music: '/music/call.mp3', // 呼叫音乐文件路径
        chunkSize: 64 * 1024, // 文件/消息分片传输时每个分片的大小（字节）
        maxAudioDuration: 60, // 语音消息最大录制时长（秒）
        imageCompression: 0.8, // 图片压缩质量 (0-1)
        maxFileSize: 50 * 1024 * 1024, // 最大上传文件大小 (50 MB)
        maxStickerSize: 3 * 1024 * 1024, // ADDED: 3 MB for stickers
        audioConstraints: {    // 音频采集约束，用于提高通话质量
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
        }
    },
    /**
     * UI 行为相关配置
     */
    ui: {
        messageRenderBatchSize: 30, // 初始加载消息批次大小 (ChatAreaUIManager未使用，可考虑移除或整合)
        virtualScrollBatchSize: 20, // 虚拟滚动时加载的批次大小 (ChatAreaUIManager未使用，可考虑移除或整合)
        virtualScrollThreshold: 150, // 触发虚拟滚动的阈值 (像素)
        typingIndicatorTimeout: 3000, // “正在输入”指示器超时时间
        messageRetractionWindow: 5 * 60 * 1000 // 消息可撤回时间窗口 (5分钟)
    },
    /**
     * AI 相关配置
     */
    ai: {
        sessionTime: 10 * 60 * 1000, // AI 对话上下文的有效时间窗口（10分钟） - 单独聊天
        groupAiSessionTime: 3 * 60 * 1000, // AI 群聊上下文的有效时间窗口（3分钟）- 群聊
        promptSuffix: "一般回复1句话，具有多变、丰富台词潜力（通过表情、姿态、情境暗示）。",
        groupPromptSuffix: "当前情境说明：你现在处于一个群聊环境中，**冒号（:）之前的是用户名，冒号（:）之后的是该用户的发言内容。一般回复1句话，具有多变、丰富台词潜力（通过表情、姿态、情境暗示），小概率触发调侃其它用户。",
    },
    /**
     * 服务器相关配置。
     * 这些是默认值，UI 管理器将从 localStorage 加载用户配置的值来覆盖它们。
     * 注意：AI 的 apiEndpoint 和 model 的默认值现在由 LLMProviders.js 管理。
     *      此处仅保留 AI 和 TTS 的非提供商特定配置作为最终回退。
     */
    server: {
        signalingServerUrl: 'ws://localhost:8080/signaling', // 本地开发示例
        lobbyApiEndpoint: 'http://localhost:8080/api/monitor/online-user-ids', // 本地开发示例
        api_key: "Bearer sk-xxxx", // API 密钥
        max_tokens: 2048, // AI 回复最大令牌数
        ttsApiEndpoint: 'https://gsv2p.acgnai.top', // TTS API 端点
    },
    /**
     * WebRTC RTCPeerConnection 的详细配置
     */
    peerConnectionConfig: {
        // TODO
        iceServers: [
            {
                urls: [
                    "turn:175.178.216.24:3478"
                ],
                username: "test",
                credential: "123456"
            },
            // 可以添加更多 STUN/TURN 服务器
        ],
        iceTransportPolicy: 'all', // 'all' 或 'relay'
        bundlePolicy: 'max-bundle', // 'balanced', 'max-compat', 'max-bundle'
        rtcpMuxPolicy: 'require',   // 'negotiate' 或 'require'
        iceCandidatePoolSize: 0,   // 预先收集的 ICE 候选者数量
        sdpSemantics: 'unified-plan', // SDP 语义 ('plan-b' 或 'unified-plan')
    },

    /**
     * @description 自适应音频质量配置
     */
    adaptiveAudioQuality: {
        interval: 5000, // 检查间隔 (毫秒)
        logStatsToConsole: true, // 是否在控制台打印统计信息
        baseGoodConnectionThresholds: { // 良好连接的基准阈值
            rtt: 120,        // 往返时延 (ms)
            packetLoss: 0.01, // 丢包率 (0.0 到 1.0)
            jitter: 20       // 抖动 (ms)
        },
        audioQualityProfiles: [ // 音频质量配置档案数组，从低到高
            { levelName: "极低", maxAverageBitrate: 8000,  sdpFmtpLine: "minptime=40;useinbandfec=1;stereo=0;maxaveragebitrate=8000;cbr=1;maxplaybackrate=8000",   description: "非常差的网络，优先保障连接" },
            { levelName: "较低", maxAverageBitrate: 12000, sdpFmtpLine: "minptime=20;useinbandfec=1;stereo=0;maxaveragebitrate=12000;cbr=1;maxplaybackrate=12000", description: "较差网络，基础通话" },
            { levelName: "标准", maxAverageBitrate: 16000, sdpFmtpLine: "minptime=10;useinbandfec=1;stereo=0;maxaveragebitrate=16000;cbr=0;maxplaybackrate=16000", description: "一般网络，标准音质" },
            { levelName: "较高", maxAverageBitrate: 20000, sdpFmtpLine: "minptime=10;useinbandfec=1;stereo=0;maxaveragebitrate=20000;cbr=0;maxplaybackrate=20000", description: "良好网络，提升音质" },
            { levelName: "极高", maxAverageBitrate: 48000, sdpFmtpLine: "minptime=5;useinbandfec=1;stereo=1;maxaveragebitrate=48000;cbr=0;maxplaybackrate=48000",  description: "优秀网络，最佳音质" }
        ],
        initialProfileIndex: 2, // 初始配置档案索引 (对应 "标准")
        switchToHigherCooldown: 10000, // 提升质量的冷却时间 (毫秒)
        switchToLowerCooldown: 5000,   // 降低质量的冷却时间 (毫秒)
        stabilityCountForUpgrade: 2,   // 连续多少次良好检查后才提升质量
        badQualityDowngradeThreshold: 2 // 连续多少次差质量检查后才降低质量
    }
};