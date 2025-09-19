import { dbService } from './dbService';
import { log, generateVideoThumbnail } from '@/utils';

/**
 * @file mediaCacheService.js
 * @description Manages Blob Object URLs to prevent memory leaks and race conditions.
 *              Acts as a centralized singleton for creating and revoking media URLs.
 */

const urlCache = new Map();

export const mediaCacheService = {
    /**
     * --- ✅ MODIFICATION START: Upgraded getUrl to handle thumbnail generation ---
     * Gets a blob URL for a given file hash. It can fetch either the main file or its thumbnail.
     * For videos, it generates and caches a thumbnail on the first request.
     * @param {string} fileHash - The SHA-256 hash of the file.
     * @param {boolean} [getThumbnail=false] - If true, fetches/generates the thumbnail URL.
     * @returns {Promise<string|null>} The blob URL or null if not found/failed.
     */
    async getUrl(fileHash, getThumbnail = false) {
        if (!fileHash) return null;

        const cacheKey = getThumbnail ? `${fileHash}_thumb` : fileHash;
        if (urlCache.has(cacheKey)) {
            return urlCache.get(cacheKey);
        }

        try {
            const cacheItem = await dbService.getItem('fileCache', fileHash);
            if (!cacheItem?.fileBlob) {
                log(`Media blob not found in DB for hash: ${fileHash}`, 'WARN');
                return null;
            }

            // --- Core thumbnail generation logic ---
            if (getThumbnail && cacheItem.fileBlob.type.startsWith('video/')) {
                // 1. Check if thumbnail blob already exists in DB
                if (cacheItem.thumbnailBlob instanceof Blob) {
                    const thumbUrl = URL.createObjectURL(cacheItem.thumbnailBlob);
                    urlCache.set(cacheKey, thumbUrl);
                    return thumbUrl;
                }

                // 2. If not, generate, save, and return it
                log(`Generating thumbnail for video hash: ${fileHash}`, 'DEBUG');
                try {
                    const thumbDataUrl = await generateVideoThumbnail(cacheItem.fileBlob);
                    // Convert Data URL back to Blob for efficient storage
                    const thumbResponse = await fetch(thumbDataUrl);
                    const thumbBlob = await thumbResponse.blob();

                    // Update the database record with the new thumbnail blob
                    const updatedCacheItem = { ...cacheItem, thumbnailBlob: thumbBlob };
                    await dbService.setItem('fileCache', updatedCacheItem);

                    // Create, cache in memory, and return the new URL
                    const thumbUrl = URL.createObjectURL(thumbBlob);
                    urlCache.set(cacheKey, thumbUrl);
                    return thumbUrl;
                } catch (thumbError) {
                    log(`Failed to generate/cache thumbnail for ${fileHash}: ${thumbError}`, 'ERROR');
                    return null; // Return null on failure, so UI shows no poster
                }
            }
            // --- End of thumbnail logic ---

            // Default behavior: return the URL for the main file
            const url = URL.createObjectURL(cacheItem.fileBlob);
            urlCache.set(fileHash, url);
            return url;
        } catch (error) {
            log(`Error fetching media from DB in mediaCacheService: ${error}`, 'ERROR');
            return null;
        }
    },
    /**
     * --- ✅ MODIFICATION END ---
     */

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

window.addEventListener('beforeunload', () => {
    mediaCacheService.cleanup();
});