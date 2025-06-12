/**
 * @file Config.js
 * @description 全局配置文件。该文件定义了整个应用程序中使用的常量和默认设置，
 *              包括重连策略、超时时间、媒体约束、UI行为、日志级别以及服务器和 WebRTC 的默认配置。
 *              用户在设置中修改的某些值（如 AI API 配置）会覆盖此处的默认值。
 * @module Config
 * @exports {object} Config - 包含所有配置项的全局对象。
 */
const Config = {
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
        messageRenderBatchSize: 30, // 批量渲染消息的大小，优化性能（当前未使用）
        typingIndicatorTimeout: 3000 // “正在输入”指示器的超时时间（当前未使用）
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
        signalingServerUrl: 'ws://localhost:8080/signaling',
        // These are defaults; UIManager will load user-configured values from localStorage.
        apiEndpoint: 'http://localhost:8080/v1/chat/completions',
        lobbyApiEndpoint: 'http://localhost:8080/api/monitor/online-user-ids',
        // 默认的 API 密钥
        api_key: "Bearer sk-xxxx",
        // 默认的 AI 模型名称
        model: "qwen-turbo-2025-04-28",
        // 默认的 AI 模型最大令牌数
        max_tokens: 2048,
        // 默认的文本转语音 (TTS) API 端点
        ttsApiEndpoint: 'https://gsv.ai-lab.top/infer_single',
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
}