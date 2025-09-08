import { dbService } from './dbService';
import { log } from '@/utils';

/**
 * @file mediaCacheService.js
 * @description Manages Blob Object URLs to prevent memory leaks and race conditions.
 *              Acts as a centralized singleton for creating and revoking media URLs.
 */

// A Map to store the mapping of fileHash -> blob:url
const urlCache = new Map();

export const mediaCacheService = {
    /**
     * Gets a blob URL for a given file hash.
     * If the URL is already cached, it returns it. Otherwise, it fetches the blob
     * from IndexedDB, creates a new URL, caches it, and returns it.
     * @param {string} fileHash - The SHA-256 hash of the file.
     * @returns {Promise<string|null>} The blob URL or null if not found.
     */
    async getUrl(fileHash) {
        if (!fileHash) return null;

        // 1. Check in-memory cache first
        if (urlCache.has(fileHash)) {
            return urlCache.get(fileHash);
        }

        // 2. If not cached, fetch from IndexedDB
        try {
            const cacheItem = await dbService.getItem('fileCache', fileHash);
            if (cacheItem?.fileBlob instanceof Blob) {
                const url = URL.createObjectURL(cacheItem.fileBlob);
                urlCache.set(fileHash, url); // Store in cache
                return url;
            } else {
                log(`Media blob not found in DB for hash: ${fileHash}`, 'WARN');
                return null;
            }
        } catch (error) {
            log(`Error fetching media from DB in mediaCacheService: ${error}`, 'ERROR');
            return null;
        }
    },

    /**
     * Cleans up all created Object URLs.
     * This should be called when the application is about to unload.
     */
    cleanup() {
        log(`Cleaning up ${urlCache.size} cached media URLs.`, 'INFO');
        urlCache.forEach(url => URL.revokeObjectURL(url));
        urlCache.clear();
    }
};

// Add a global cleanup hook to prevent memory leaks when the user leaves the page.
window.addEventListener('beforeunload', () => {
    mediaCacheService.cleanup();
});