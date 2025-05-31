const _Utils_logLevels = { DEBUG: 0, INFO: 1, WARN: 2, ERROR: 3, ALL: 4 }; // Private-like variable

const Utils = {
    logLevels: _Utils_logLevels,
    currentLogLevel: _Utils_logLevels.DEBUG, // Default, can be overridden by setLogLevelFromConfig

    setLogLevelFromConfig: function() {
        if (typeof Config !== 'undefined' && Config.logLevel && typeof Config.logLevel === 'string') {
            this.currentLogLevel = this.logLevels[Config.logLevel.toUpperCase()] || this.logLevels.DEBUG;
            // console.log(`Utils: Log level set to ${Config.logLevel} (${this.currentLogLevel})`); // For sanity check during init
        }
    },

    log: function (message, level = this.logLevels.DEBUG) {
        if (level >= this.currentLogLevel) {
            const timestamp = new Date().toLocaleTimeString();
            const prefixes = { 0: '[DBG]', 1: '[INF]', 2: '[WRN]', 3: '[ERR]' };
            const prefix = prefixes[level] || '[LOG]';

            const logMessage = `[${timestamp}] ${prefix} ${message}`;

            // console output
            if (level === this.logLevels.ALL) console.log(logMessage);
            else if (level === this.logLevels.ERROR) console.error(logMessage);
            else if (level === this.logLevels.DEBUG) console.debug(logMessage);
            else if (level === this.logLevels.WARN) console.warn(logMessage);
            else if (level === this.logLevels.INFO) console.info(logMessage);

            // UI debug output (optional, can be removed if not needed)
            // const debugInfo = document.getElementById('debugInfo'); // Assuming a debug panel
            // if (debugInfo) {
            //     debugInfo.innerHTML = `${Utils.escapeHtml(logMessage)}<br>` + debugInfo.innerHTML;
            //     const lines = debugInfo.innerHTML.split('<br>');
            //     if (lines.length > 50) debugInfo.innerHTML = lines.slice(0, 50).join('<br>');
            // }
        }
    },

    escapeHtml: function(str) {
        if (typeof str !== 'string') return '';
        return str.replace(/[&<>"']/g, function (match) {
            return {
                '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'
            }[match];
        });
    },

    checkNetworkType: async function () {
        try {
            const pc = new RTCPeerConnection(); // Using default config for basic host candidate gathering
            const candidates = [];
            let candidateGatheringDone = false;

            pc.onicecandidate = (e) => {
                if (e.candidate) {
                    candidates.push(e.candidate);
                } else {
                    candidateGatheringDone = true;
                }
            };

            pc.createDataChannel("check");
            const offer = await pc.createOffer();
            await pc.setLocalDescription(offer);

            await new Promise(resolve => {
                const startTime = Date.now();
                const checkInterval = setInterval(() => {
                    if (candidateGatheringDone || (Date.now() - startTime > 1500)) {
                        clearInterval(checkInterval);
                        resolve();
                    }
                }, 100);
            });

            pc.close();

            const hasIPv4 = candidates.some(c => c.address && c.address.includes('.'));
            const hasIPv6 = candidates.some(c => c.address && c.address.includes(':'));
            const hasRelay = candidates.some(c => c.type === 'relay'); // Note: Will only be true if TURN server in default config or mDNS relay
            const hasUdp = candidates.some(c => c.protocol === 'udp');
            const hasTcp = candidates.some(c => c.protocol === 'tcp');

            return {
                ipv4: hasIPv4,
                ipv6: hasIPv6,
                relay: hasRelay,
                udp: hasUdp,
                tcp: hasTcp,
                count: candidates.length,
                error: null
            };
        } catch (error) {
            Utils.log(`Network type check failed: ${error.message}`, Utils.logLevels.ERROR);
            return { ipv4: false, ipv6: false, relay: false, udp: false, tcp: false, count: 0, error: error.message };
        }
    },

    sendInChunks: function (dataString, sendFunc, peerId, fileId = null, chunkSize = Config.chunkSize || 64 * 1024) {
        if (dataString.length <= chunkSize) {
            return sendFunc(dataString);
        }

        const totalChunks = Math.ceil(dataString.length / chunkSize);
        const currentFileId = fileId || `${Date.now()}-${Utils.generateId(6)}`;

        Utils.log(`Sending large data to ${peerId} (ID: ${currentFileId}) in ${totalChunks} chunks.`, Utils.logLevels.INFO);

        sendFunc(JSON.stringify({
            type: 'chunk-meta',
            chunkId: currentFileId,
            totalChunks: totalChunks,
            originalType: JSON.parse(dataString).type
        }));

        if (!ConnectionManager.pendingSentChunks) ConnectionManager.pendingSentChunks = {};
        ConnectionManager.pendingSentChunks[currentFileId] = {
            total: totalChunks,
            sent: 0,
            data: dataString // Store the full data string temporarily
        };


        // Send chunks with a small delay to avoid overwhelming the data channel
        for (let i = 0; i < totalChunks; i++) {
            // Closure to capture current i
            ((currentIndex) => {
                setTimeout(() => {
                    const start = currentIndex * chunkSize;
                    const end = Math.min(dataString.length, start + chunkSize);
                    const chunkData = dataString.substring(start, end);

                    sendFunc(JSON.stringify({
                        type: 'chunk-data',
                        chunkId: currentFileId,
                        index: currentIndex,
                        payload: chunkData
                    }));

                    // Update sent count and clean up if all sent
                    const pending = ConnectionManager.pendingSentChunks[currentFileId];
                    if (pending) {
                        pending.sent++;
                        if (pending.sent === pending.total) {
                            delete ConnectionManager.pendingSentChunks[currentFileId];
                            Utils.log(`All chunks for ${currentFileId} sent to ${peerId}.`, Utils.logLevels.INFO);
                        }
                    }
                }, currentIndex * 20); // Increased delay slightly, 20ms. Adjust as needed.
            })(i);
        }
    },
    reassembleChunk: function(message, peerId) {
        if (!ConnectionManager.pendingReceivedChunks) ConnectionManager.pendingReceivedChunks = {};
        if (!ConnectionManager.pendingReceivedChunks[peerId]) ConnectionManager.pendingReceivedChunks[peerId] = {};

        const peerChunks = ConnectionManager.pendingReceivedChunks[peerId];

        if (message.type === 'chunk-meta') {
            peerChunks[message.chunkId] = {
                id: message.chunkId,
                total: message.totalChunks,
                received: 0,
                chunks: new Array(message.totalChunks),
                originalType: message.originalType // Storing the original type (e.g., 'file')
            };
            Utils.log(`Receiving chunked data ${message.chunkId} from ${peerId}, total: ${message.totalChunks}. Original type: ${message.originalType}`, Utils.logLevels.DEBUG);
            return null; // Explicitly return null for chunk-meta
        }

        if (message.type === 'chunk-data') {
            const assembly = peerChunks[message.chunkId];
            if (assembly && assembly.chunks[message.index] === undefined) {
                assembly.chunks[message.index] = message.payload;
                assembly.received++;

                // Utils.log(`Received chunk ${message.index + 1}/${assembly.total} for ${message.chunkId} (original type: ${assembly.originalType})`, Utils.logLevels.DEBUG);


                if (assembly.received === assembly.total) {
                    const fullDataString = assembly.chunks.join('');
                    const assembledId = assembly.id; // Store before deleting
                    const originalType = assembly.originalType; // Store before deleting
                    delete peerChunks[message.chunkId]; // Clean up before parsing, in case parsing fails

                    Utils.log(`All chunks for ${assembledId} received from ${peerId}. Reassembled. Original type was: ${originalType}. Full length: ${fullDataString.length}`, Utils.logLevels.INFO);
                    try {
                        const reassembledMessage = JSON.parse(fullDataString);
                        // Verify original type integrity
                        if (reassembledMessage.type !== originalType) {
                            Utils.log(`Reassembled message type (${reassembledMessage.type}) differs from stored original type (${originalType}) for ID ${assembledId}. This might indicate an issue if original message structure is unexpected. Using reassembled type.`, Utils.logLevels.WARN);
                            // The type from fullDataString (reassembledMessage.type) should be the authoritative one.
                        }
                        return reassembledMessage;
                    } catch (e) {
                        Utils.log(`Error parsing reassembled message from ${peerId} (ID: ${assembledId}, OriginalType: ${originalType}): ${e.message}`, Utils.logLevels.ERROR);
                        return null; // Error during reassembly or parse
                    }
                }
                return null; // Still waiting for more chunks
            } else if (assembly && assembly.chunks[message.index] !== undefined) {
                Utils.log(`Duplicate chunk ${message.index} for ${message.chunkId} (original type: ${assembly.originalType}) from ${peerId}. Ignoring.`, Utils.logLevels.WARN);
                return null;
            } else {
                Utils.log(`Received chunk-data for unknown/completed assembly ${message.chunkId} (Type in msg: ${message.type}) from ${peerId}. Ignoring.`, Utils.logLevels.WARN);
                return null;
            }
        }

        // If message.type is neither 'chunk-meta' nor 'chunk-data'
        // This case means reassembleChunk was called with an already fully formed message.
        // This shouldn't happen if the ConnectionManager.onmessage logic is correct, as it checks type before calling.
        Utils.log(`Utils.reassembleChunk received non-chunk message type: ${message.type} from ${peerId}. This is unexpected. Returning null.`, Utils.logLevels.WARN);
        return null;
    },

    generateId: function(length = 8) {
        return Math.random().toString(36).substring(2, 2 + length);
    },

    formatTime: function(totalSeconds) {
        const minutes = Math.floor(totalSeconds / 60).toString().padStart(2, '0');
        const seconds = Math.floor(totalSeconds % 60).toString().padStart(2, '0');
        return `${minutes}:${seconds}`;
    },

    formatDate: function(dateObj, includeTime = true) {
        if (!(dateObj instanceof Date) || isNaN(dateObj)) {
            return 'Invalid Date';
        }
        const now = new Date();
        const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const yesterday = new Date(today);
        yesterday.setDate(today.getDate() - 1);

        let dateString;
        if (dateObj >= today) { // Today
            dateString = includeTime ? dateObj.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Today';
        } else if (dateObj >= yesterday) { // Yesterday
            dateString = 'Yesterday' + (includeTime ? ` ${dateObj.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : '');
        } else if (dateObj.getFullYear() === now.getFullYear()){ // This year, but older than yesterday
            dateString = dateObj.toLocaleDateString([], { month: 'short', day: 'numeric' }) + (includeTime ? ` ${dateObj.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : '');
        }
        else { // Older than this year
            dateString = dateObj.toLocaleDateString([], { year: 'numeric', month: 'short', day: 'numeric' }) + (includeTime ? ` ${dateObj.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : '');
        }
        return dateString;
    }
};