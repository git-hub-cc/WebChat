/**
 * @file 全局应用配置
 * @description 定义了整个应用程序中使用的常量和默认设置。
 *              包括重连策略、超时时间、媒体约束、UI行为、日志级别以及服务器和 WebRTC 的默认配置。
 *              注意：用户在设置中修改的某些值会覆盖此处的默认值。大模型相关的配置已移至独立的 LLMProviders.js 文件。
 * @module Config/AppSettings
 * @exports {object} AppSettings - 包含所有应用配置项的全局对象。
 * @dependency 无
 */
const AppSettings = {
    /**
     * @description 通用常量，在多个模块中使用。
     */
    constants: {
        /**
         * 日志级别定义。
         * 0: DEBUG - 最详细的日志，用于开发调试。
         * 1: INFO - 普通信息性日志。
         * 2: WARN - 警告，表示潜在问题。
         * 3: ERROR - 错误，影响程序正常运行。
         */
        logLevels: { DEBUG: 0, INFO: 1, WARN: 2, ERROR: 3 },
        /**
         * 手动连接流程中使用的内部占位符ID。
         */
        manualPlaceholderPeerId: '_manual_placeholder_peer_id_',
    },

    // 日志级别配置, 可选值: 'DEBUG', 'INFO', 'WARN', 'ERROR'
    // 'DEBUG' 用于开发时详细排查问题，'INFO' 或 'ERROR' 用于生产环境。
    logLevel: 'DEBUG',

    /**
     * @description WebRTC 和 WebSocket 连接断开后的自动重连策略。
     */
    reconnect: {
        // WebRTC 的重连配置
        webrtc: {
            maxAttempts: 3,      // 最大尝试次数
            delay: 3000,         // 初始延迟（毫秒）
            backoffFactor: 1.5   // 延迟时间的指数增长因子 (0 表示不增长)
        },
        // WebSocket 的重连配置
        websocket: {
            maxAttempts: 3,        // 最大尝试次数
            initialDelay: 2000,    // 初始延迟 (毫秒)
            backoffFactor: 2,      // 指数退避因子
            maxDelay: 30000        // 最大延迟 (毫秒)
        }
    },

    /**
     * @description 各种网络操作的超时时间配置（单位：毫秒）。
     */
    timeouts: {
        iceGathering: 3000,  // ICE 候选者收集超时。SDP 将在此之前发送。
        connection: 5000,   // WebRTC 连接建立总超时
        networkCheck: 5000, // 网络类型检查超时
        signalingResponse: 5000 // 等待信令服务器响应的超时
    },

    /**
     * @description 定时器间隔配置（单位：毫秒）。
     */
    timers: {
        websocketHeartbeat: 25000, // WebSocket 心跳间隔
        groupMemberRefresh: 3000,  // 群组成员详情页自动刷新间隔
        lobbyAutoRefresh: 5000     // 人员大厅自动刷新间隔
    },

    /**
     * @description 媒体相关配置，包括文件处理、音视频约束等。
     */
    media: {
        music: 'music/call.mp3', // 呼叫音乐文件路径
        chunkSize: 64 * 1024,    // 文件/消息分片传输时每个分片的大小（64KB）
        dataChannelBufferThreshold: 2 * 1024 * 1024, // 数据通道缓冲区的“高水位”阈值 (2MB)，超出后将暂停发送以等待缓冲区清空
        dataChannelBufferCheckInterval: 200, // 检查数据通道缓冲区是否清空的间隔 (200ms)
        maxAudioDuration: 60,    // 语音消息最大录制时长（秒）
        imageCompression: 0.8,   // 图片压缩质量 (0-1)
        maxFileSize: 500 * 1024 * 1024, // 最大上传文件大小 (500 MB)
        maxStickerSize: 3 * 1024 * 1024, // 贴图最大文件大小 (3 MB)
        screenshotEditor: { // 截图编辑器配置
            minCropSize: 20,           // 裁剪框最小尺寸 (px)
            defaultMarkColor: '#FF0000', // 默认标记颜色
            defaultMarkLineWidth: 3    // 默认标记线宽
        },
        audioConstraints: {    // 音频采集约束，用于提高通话质量
            echoCancellation: true, // 回声消除
            noiseSuppression: true, // 噪音抑制
            autoGainControl: true,  // 自动增益控制
        }
    },

    /**
     * @description 群组相关配置。
     */
    group: {
        maxMembers: 20 // 群组成员上限
    },

    /**
     * @description UI 行为相关配置。
     */
    ui: {
        messageRenderBatchSize: 30, // 初始加载消息批次大小
        chatContextLoadCount: 10,   // 点击跳转到消息时，上下文加载的数量
        chatScrollLoadBatchSize: 15,// 虚拟滚动时加载的批次大小
        virtualScrollThreshold: 150,// 触发虚拟滚动的阈值 (像素)
        typingIndicatorTimeout: 3000, // “正在输入”指示器超时时间 (毫秒)
        messageRetractionWindow: 5 * 60 * 1000, // 消息可撤回时间窗口 (5分钟)
        contextMenuAutoHideDuration: 3000, // 消息上下文菜单自动隐藏时间 (毫秒)
        unconnectedMemberNotificationCooldown: 30000, // 群聊未连接成员通知冷却时间 (毫秒)
        notificationDefaultDuration: 5000, // 默认通知显示时长 (毫秒)
        notificationErrorDuration: 8000,   // 错误通知显示时长 (毫秒)
        resourceGridLoadBatchSize: 15, // 资源预览网格加载批次大小
        resourceGridScrollThreshold: 100 // 资源预览网格滚动加载阈值 (像素)
    },

    /**
     * @description AI 相关配置。
     */
    ai: {
        sessionTime: 10 * 60 * 1000, // AI 单聊上下文的有效时间窗口 (10分钟)
        groupAiSessionTime: 3 * 60 * 1000, // AI 群聊上下文的有效时间窗口 (3分钟)
        promptSuffix: "一般回复1句话，具有多变、丰富台词潜力（通过表情、姿态、情境暗示）。",
        groupPromptSuffix: "当前情境说明：你现在处于一个群聊环境中，**冒号（:）之前的是用户名，冒号（:）之后的是该用户的发言内容。一般回复1句话，具有多变、丰富台词潜力（通过表情、姿态、情境暗示），小概率触发调侃其它用户。",
    },

    /**
     * @description 服务器相关配置。
     *              这些是默认值，UI 管理器将从 localStorage 加载用户配置的值来覆盖它们。
     *              注意：AI 的 apiEndpoint 和 model 的默认值现在由 LLMProviders.js 管理。
     */
    server: {
        // TODO: 应从服务器动态获取或根据环境配置
        signalingServerUrl: 'wss://175.178.216.24/signaling',
        lobbyApiEndpoint: 'https://175.178.216.24/api/monitor/online-user-ids',
        api_key: "Bearer sk-xxxx", // API 密钥
        max_tokens: 2048,          // AI 回复最大令牌数
        ttsApiEndpoint: 'https://gsv2p.acgnai.top', // TTS API 端点
    },

    /**
     * @description WebRTC RTCPeerConnection 的详细配置。
     */
    peerConnectionConfig: {
        // TODO: 应从服务器动态获取或根据环境配置
        iceServers: [
            {
                urls: ["turn:175.178.216.24:3478"],
                username: "test",
                credential: "123456"
            },
        ],
        iceTransportPolicy: 'all',      // 'all' 或 'relay'
        bundlePolicy: 'max-bundle',     // 'balanced', 'max-compat', 'max-bundle'
        rtcpMuxPolicy: 'require',       // 'negotiate' 或 'require'
        iceCandidatePoolSize: 0,        // 预先收集的 ICE 候选者数量
        sdpSemantics: 'unified-plan',   // SDP 语义 ('plan-b' 或 'unified-plan')
    },

    /**
     * @description 自适应音频质量配置，用于在通话中根据网络状况动态调整音频参数。
     */
    adaptiveAudioQuality: {
        interval: 5000,          // 检查网络状况的间隔 (毫秒)
        logStatsToConsole: true, // 是否在控制台打印统计信息
        baseGoodConnectionThresholds: { // 判断网络状况良好的基准阈值
            rtt: 120,        // 往返时延 (ms)，越低越好
            packetLoss: 0.01, // 丢包率 (0.0 到 1.0)，越低越好
            jitter: 20       // 抖动 (ms)，越低越好
        },
        // 音频质量配置档案数组，从低到高排序
        audioQualityProfiles: [
            { levelName: "极低", maxAverageBitrate: 8000,  sdpFmtpLine: "minptime=40;useinbandfec=1;stereo=0;maxaveragebitrate=8000;cbr=1;maxplaybackrate=8000",   description: "非常差的网络，优先保障连接" },
            { levelName: "较低", maxAverageBitrate: 12000, sdpFmtpLine: "minptime=20;useinbandfec=1;stereo=0;maxaveragebitrate=12000;cbr=1;maxplaybackrate=12000", description: "较差网络，基础通话" },
            { levelName: "标准", maxAverageBitrate: 16000, sdpFmtpLine: "minptime=10;useinbandfec=1;stereo=0;maxaveragebitrate=16000;cbr=0;maxplaybackrate=16000", description: "一般网络，标准音质" },
            { levelName: "较高", maxAverageBitrate: 20000, sdpFmtpLine: "minptime=10;useinbandfec=1;stereo=0;maxaveragebitrate=20000;cbr=0;maxplaybackrate=20000", description: "良好网络，提升音质" },
            { levelName: "极高", maxAverageBitrate: 48000, sdpFmtpLine: "minptime=5;useinbandfec=1;stereo=1;maxaveragebitrate=48000;cbr=0;maxplaybackrate=48000",  description: "优秀网络，最佳音质" }
        ],
        initialProfileIndex: 2,          // 初始配置档案索引 (对应 "标准")
        switchToHigherCooldown: 10000,   // 提升质量的冷却时间 (毫秒)
        switchToLowerCooldown: 5000,     // 降低质量的冷却时间 (毫秒)
        stabilityCountForUpgrade: 2,     // 连续多少次良好检查后才提升质量
        badQualityDowngradeThreshold: 2  // 连续多少次差质量检查后才降低质量
    }
};