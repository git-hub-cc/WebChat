/**
 * @file hash.worker.js
 * @description (Vue Refactor - NEW FILE)
 *              A dedicated Web Worker for performing computationally expensive file hashing.
 *              It receives a file blob from the main thread, calculates its SHA-256 hash,
 *              and posts the result back, preventing the UI from freezing.
 */
self.onmessage = async (event) => {
    // Destructure the file blob and a unique ID for this specific task
    const { fileBlob, id } = event.data;

    try {
        // 1. Read the Blob's content into an ArrayBuffer
        const buffer = await fileBlob.arrayBuffer();
        // 2. Use the subtle crypto API to digest the buffer
        const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
        // 3. Convert the buffer to a hex string
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');

        // 4. Post the successful result back to the main thread
        self.postMessage({ id, hash: hashHex, error: null });
    } catch (error) {
        // 5. If an error occurs, post the error message back
        self.postMessage({ id, hash: null, error: error.message });
    }
};