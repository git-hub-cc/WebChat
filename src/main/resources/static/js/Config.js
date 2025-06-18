/**
 * @file Config.js
 * @description 全局配置文件。该文件定义了整个应用程序中使用的常量和默认设置，
 *              包括重连策略、超时时间、媒体约束、UI行为、日志级别以及服务器和 WebRTC 的默认配置。
 *              用户在设置中修改的某些值（如 AI API 配置）会覆盖此处的默认值。
 *              新增：五级自适应音频质量配置及控制台日志开关。
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
        messageRenderBatchSize: 30, // 批量渲染消息的大小，优化性能（当前未使用，为虚拟滚动保留或调整）
        virtualScrollBatchSize: 20, // 虚拟滚动时一次加载/渲染的消息数量
        virtualScrollThreshold: 150, // 距离顶部多少像素时触发加载更早的消息
        typingIndicatorTimeout: 3000, // “正在输入”指示器的超时时间（当前未使用）
        messageRetractionWindow: 5 * 60 * 1000 // 消息可撤回的时间窗口（毫秒），例如 5 分钟
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
        sessionTime: 10 * 60 * 1000, // AI 对话上下文的有效时间窗口（10分钟）
        baseSystemPrompt: "一般回复1句话，回复内容口语化，可以用一个语气词，表情。",
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
        // TODO
        // signalingServerUrl: 'ws://localhost:8080/signaling',
        // // These are defaults; UIManager will load user-configured values from localStorage.
        // apiEndpoint: 'http://localhost:8080/v1/chat/completions',
        // lobbyApiEndpoint: 'http://localhost:8080/api/monitor/online-user-ids',

        signalingServerUrl: 'wss://175.178.216.24/signaling',
        // These are defaults; UIManager will load user-configured values from localStorage.
        apiEndpoint: 'https://175.178.216.24/v1/chat/completions',
        lobbyApiEndpoint: 'https://175.178.216.24/api/monitor/online-user-ids',
        // 默认的 API 密钥
        api_key: "Bearer sk-xxxx",
        // 默认的 AI 模型名称
        model: "qwen-turbo-2025-04-28",
        // 默认的 AI 模型最大令牌数
        max_tokens: 2048,
        // 默认的文本转语音 (TTS) API 端点
        ttsApiEndpoint: 'https://gsv2p.acgnai.top',
    },
    /**
     * WebRTC RTCPeerConnection 的详细配置
     */
    peerConnectionConfig: {
        iceServers: [
            {
                // STUN/TURN 服务器地址
                urls: [
                    "turn:175.178.216.24:3478?transport=udp",
                    "turn:175.178.216.24:3478?transport=tcp"
                ],
                username: "test",
                credential: "123456"
            },
        ],
        // ICE 传输策略，'all' 表示尝试所有候选者（主机、srflx、relay）
        iceTransportPolicy: 'all',
        // 轨道捆绑策略，'max-bundle' 表示尽可能将所有媒体流捆绑在单个传输上
        bundlePolicy: 'max-bundle',
        // RTCP 复用策略，'require' 表示必须在同一端口上复用 RTP 和 RTCP
        rtcpMuxPolicy: 'require',
        // ICE 候选者池大小，0 表示禁用
        iceCandidatePoolSize: 0,
        // SDP 语义，'unified-plan' 是现代标准
        sdpSemantics: 'unified-plan',
    },

    /**
     * @description 自适应音频质量配置
     */
    adaptiveAudioQuality: {
        interval: 5000, // ms, 检测网络状况的间隔时间
        logStatsToConsole: true, // 是否在控制台打印详细的评估日志
        // 基准“良好连接”阈值，用于评估的基础
        baseGoodConnectionThresholds: {
            rtt: 120,         // ms (数值越小越好)
            packetLoss: 0.01, // 1% (数值越小越好)
            jitter: 20        // ms (数值越小越好)
        },
        // 定义5个音质等级的配置 (从低到高)
        audioQualityProfiles: [
            { levelName: "极低", maxAverageBitrate: 8000, description: "非常差的网络，优先保障连接" }, // Level 0
            { levelName: "较低", maxAverageBitrate: 12000, description: "较差网络，基础通话" },       // Level 1
            { levelName: "标准", maxAverageBitrate: 16000, description: "一般网络，标准音质" },       // Level 2 (初始默认)
            { levelName: "较高", maxAverageBitrate: 20000, description: "良好网络，提升音质" },       // Level 3
            { levelName: "极高", maxAverageBitrate: 24000, description: "优秀网络，最佳音质" }        // Level 4
        ],
        initialProfileIndex: 2, // 初始默认的音质等级索引 (对应 "标准")
        // 切换逻辑参数
        switchToHigherCooldown: 10000,  // 提升等级后的冷却时间 (ms)，防止过于频繁切换
        switchToLowerCooldown: 5000,   // 降低等级后的冷却时间 (ms), 避免在网络恢复时立即再次降级
        stabilityCountForUpgrade: 2,  // 需要连续多少次检测良好才能升级 (例如，连续2次良好才升)
        badQualityDowngradeThreshold: 2 // 连续多少次检测差才考虑降级 (例如，连续2次差才降)
    }
};

window.Config = ConfigObj;