const Utils = {
    // 日志级别
    logLevels: {
        DEBUG: 0,
        INFO: 1,
        WARN: 2,
        ERROR: 3
    },

    // 当前日志级别
    currentLogLevel: 0,

    // 记录日志
    log: function (message, level = this.logLevels.DEBUG) {
        if (level >= this.currentLogLevel) {
            const debugInfo = document.getElementById('debugInfo');
            const timestamp = new Date().toLocaleTimeString();

            let prefix = '';
            switch (level) {
                case this.logLevels.INFO:
                    prefix = '[信息] ';
                    break;
                case this.logLevels.WARN:
                    prefix = '[警告] ';
                    break;
                case this.logLevels.ERROR:
                    prefix = '[错误] ';
                    break;
                default:
                    prefix = '[调试] ';
            }

            debugInfo.innerHTML = `[${timestamp}] ${prefix}${message}<br>` + debugInfo.innerHTML;

            // 限制日志条数
            const lines = debugInfo.innerHTML.split('<br>');
            if (lines.length > 10) {
                debugInfo.innerHTML = lines.slice(0, 10).join('<br>');
            }

            // 在控制台也记录日志
            if (level === this.logLevels.ERROR) {
                console.error(message);
            } else if (level === this.logLevels.WARN) {
                console.warn(message);
            } else {
                console.log(message);
            }
        }
    },

    // 网络类型检测
    checkNetworkType: async function () {
        try {
            const pc = new RTCPeerConnection();
            const candidates = [];

            pc.onicecandidate = (e) => {
                if (e.candidate) {
                    candidates.push(e.candidate);
                }
            };

            await pc.createDataChannel("");
            await pc.createOffer().then(offer => pc.setLocalDescription(offer));
            await new Promise(r => setTimeout(r, 1000));

            pc.close();

            const hasIPv4 = candidates.some(c => c.address && c.address.indexOf('.') !== -1);
            const hasIPv6 = candidates.some(c => c.address && c.address.indexOf(':') !== -1);
            const hasRelay = candidates.some(c => c.type === 'relay');
            const hasUdp = candidates.some(c => c.protocol === 'udp');
            const hasTcp = candidates.some(c => c.protocol === 'tcp');

            return {
                ipv4: hasIPv4,
                ipv6: hasIPv6,
                relay: hasRelay,
                udp: hasUdp,
                tcp: hasTcp,
                count: candidates.length
            };
        } catch (error) {
            Utils.log(`网络检测失败: ${error.message}`, Utils.logLevels.ERROR);
            return null;
        }
    },

    // 分块发送大文件
    sendInChunks: function (data, sendFunc, chunkSize = 128 * 1024) {
        // 如果数据小于阈值，直接发送
        if (data.length < chunkSize) {
            return sendFunc(data);
        }

        // 否则分块发送
        const chunks = [];
        const totalChunks = Math.ceil(data.length / chunkSize);
        const fileId = new Date().getTime();

        for (let i = 0; i < totalChunks; i++) {
            const start = i * chunkSize;
            const end = Math.min(data.length, start + chunkSize);
            chunks.push(data.substring(start, end));
        }

        Utils.log(`文件过大，分为${totalChunks}块发送`, Utils.logLevels.INFO);

        // 发送元数据
        sendFunc(JSON.stringify({
            type: 'file-meta',
            id: fileId,
            totalChunks: totalChunks
        }));

        // 逐块发送
        chunks.forEach((chunk, index) => {
            setTimeout(() => {
                sendFunc(JSON.stringify({
                    type: 'file-chunk',
                    id: fileId,
                    chunk: chunk,
                    index: index
                }));
            }, index * 100); // 添加小延迟避免发送过快
        });
    },

    // 生成随机ID
    generateId: function() {
        return Math.random().toString(36).substring(2, 10);
    },

    // 格式化时间
    formatTime: function (seconds) {
        const minutes = Math.floor(seconds / 60).toString().padStart(2, '0');
        const secs = Math.floor(seconds % 60).toString().padStart(2, '0');
        return `${minutes}:${secs}`;
    },

    // 格式化日期
    formatDate: function(date) {
        const now = new Date();
        const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const yesterday = new Date(today);
        yesterday.setDate(yesterday.getDate() - 1);

        if (date.getTime() > today.getTime()) {
            return date.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
        } else if (date.getTime() > yesterday.getTime()) {
            return '昨天';
        } else {
            return `${date.getMonth() + 1}月${date.getDate()}日`;
        }
    }
};