/**
 * @file transferStore.js
 * @description (Vue Refactor - NEW FILE)
 *              一个专门用于管理文件传输状态的轻量级 Pinia Store。
 *              它高频更新传输进度，而不会对核心的 chatStore 造成性能影响。
 * @module Stores
 */
import { defineStore } from 'pinia';
import { reactive } from 'vue';
import { log } from '@/utils';

export const useTransferStore = defineStore('transfer', () => {
    // --- STATE ---
    // reactive() is suitable for complex nested objects.
    // Structure: { [fileHash]: { peerId, receivedBytes, totalBytes, speedBps, etaSeconds, startTime, status } }
    const transfers = reactive({});

    // --- ACTIONS ---

    /**
     * Registers a new file transfer when its metadata is received.
     * @param {string} fileHash - The unique identifier for the file transfer.
     * @param {string} peerId - The ID of the peer the file is from.
     * @param {number} totalBytes - The total size of the file in bytes.
     */
    function startTransfer(fileHash, peerId, totalBytes) {
        if (transfers[fileHash]) {
            log(`Transfer for ${fileHash} already started. Ignoring duplicate start signal.`, 'WARN');
            return;
        }
        transfers[fileHash] = {
            peerId,
            receivedBytes: 0,
            totalBytes,
            speedBps: 0,
            etaSeconds: Infinity,
            startTime: Date.now(),
            status: 'receiving',
        };
        log(`Started tracking transfer for ${fileHash} from ${peerId}`, 'DEBUG');
    }

    /**
     * Updates the progress of an ongoing file transfer.
     * @param {string} fileHash - The identifier of the transfer.
     * @param {number} receivedChunkSize - The size of the newly received chunk in bytes.
     */
    function updateProgress(fileHash, receivedChunkSize) {
        const transfer = transfers[fileHash];
        if (transfer) {
            transfer.receivedBytes += receivedChunkSize;
        }
    }

    /**
     * Periodically calculates transfer speed and ETA for all ongoing transfers.
     * This should be called with a throttle/debounce mechanism.
     */
    function calculateStats() {
        const now = Date.now();
        for (const hash in transfers) {
            const transfer = transfers[hash];
            if (transfer.status !== 'receiving') continue;

            const elapsedTimeSeconds = (now - transfer.startTime) / 1000;
            if (elapsedTimeSeconds > 0) {
                // Calculate average speed in Bytes per Second
                transfer.speedBps = transfer.receivedBytes / elapsedTimeSeconds;

                // Calculate Estimated Time of Arrival in seconds
                const remainingBytes = transfer.totalBytes - transfer.receivedBytes;
                transfer.etaSeconds = transfer.speedBps > 0 ? remainingBytes / transfer.speedBps : Infinity;
            }
        }
    }

    /**
     * Marks a transfer as completed and removes it after a short delay.
     * @param {string} fileHash - The identifier of the completed transfer.
     */
    function endTransfer(fileHash) {
        const transfer = transfers[fileHash];
        if (transfer) {
            transfer.status = 'completed';
            transfer.etaSeconds = 0;
            // Remove from tracking after a short delay to allow UI to update
            setTimeout(() => {
                delete transfers[fileHash];
            }, 2000);
            log(`Ended tracking transfer for ${fileHash}`, 'DEBUG');
        }
    }

    /**
     * Marks transfers from a disconnected peer as failed.
     * @param {string} peerId - The ID of the disconnected peer.
     */
    function failTransfersForPeer(peerId) {
        let failedCount = 0;
        for (const hash in transfers) {
            if (transfers[hash].peerId === peerId && transfers[hash].status === 'receiving') {
                transfers[hash].status = 'failed';
                failedCount++;
            }
        }
        if (failedCount > 0) {
            log(`Marked ${failedCount} transfers as failed for disconnected peer ${peerId}`, 'WARN');
        }
    }


    return {
        transfers,
        startTransfer,
        updateProgress,
        calculateStats,
        endTransfer,
        failTransfersForPeer,
    };
});