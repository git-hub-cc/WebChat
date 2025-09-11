/**
 * @file ttsStore.js
 * @description (Vue Refactor - NEW FILE)
 *              Manages all state and logic related to Text-to-Speech functionality.
 *              It tracks the TTS status for each message ('loading', 'ready', 'playing', 'error')
 *              and handles the creation and caching of audio object URLs.
 * @module Stores
 */
import { defineStore } from 'pinia';
import { ref } from 'vue';
import { apiService } from '@/services/apiService';
import { log } from '@/utils';

// A private module-level Map to store the mapping of messageId -> blob:url
// This prevents memory leaks as we can track and revoke URLs.
const audioUrlCache = new Map();

export const useTtsStore = defineStore('tts', () => {
    // --- STATE ---
    // Tracks the TTS state for each message ID.
    // Possible states: 'idle', 'loading', 'ready', 'playing', 'error'
    const messageTtsState = ref({});

    // --- ACTIONS ---

    /**
     * The main action to request TTS for a message. It handles caching via the
     * apiService and updates the reactive state for the UI to consume.
     * @param {object} message - The message object to generate speech for.
     * @param {object} message.senderContact - The contact object of the AI sender.
     */
    async function requestTtsForMessage(message) {
        if (!message || !message.id || !message.senderContact) return;

        // Prevent duplicate requests if already loading or ready
        if (['loading', 'ready', 'playing'].includes(messageTtsState.value[message.id])) {
            return;
        }

        messageTtsState.value[message.id] = 'loading';

        try {
            // apiService now handles caching via dbService and returns the blob
            const audioBlob = await apiService.requestTtsForMessage(message.senderContact, message.content);

            if (audioBlob) {
                // If there's an old URL for this message ID, revoke it
                if (audioUrlCache.has(message.id)) {
                    URL.revokeObjectURL(audioUrlCache.get(message.id));
                }

                const newUrl = URL.createObjectURL(audioBlob);
                audioUrlCache.set(message.id, newUrl);

                // Update the state reactively
                messageTtsState.value[message.id] = 'ready';
                log(`TTS audio is ready for message ${message.id}`, 'INFO');
            } else {
                throw new Error("Received null or empty blob from TTS service.");
            }
        } catch (error) {
            log(`TTS request failed for message ${message.id}: ${error.message}`, 'ERROR');
            messageTtsState.value[message.id] = 'error';
        }
    }

    /**
     * Toggles play/pause for a given message's TTS audio by changing its state.
     * The component (`MessageBubble.vue`) will watch this state to control the audio element.
     * @param {string} messageId - The ID of the message to toggle playback for.
     */
    function togglePlay(messageId) {
        const audioUrl = audioUrlCache.get(messageId);
        if (!audioUrl) {
            log(`No audio URL found for message ${messageId} to play.`, 'WARN');
            messageTtsState.value[messageId] = 'error';
            return;
        }

        // If another audio is playing, stop it first by changing its state
        Object.keys(messageTtsState.value).forEach(msgId => {
            if (msgId !== messageId && messageTtsState.value[msgId] === 'playing') {
                messageTtsState.value[msgId] = 'ready';
            }
        });

        // Toggle play/pause for the current audio
        if (messageTtsState.value[messageId] === 'playing') {
            messageTtsState.value[messageId] = 'ready';
        } else if (messageTtsState.value[messageId] === 'ready') {
            messageTtsState.value[messageId] = 'playing';
        }
    }

    /**
     * Sets the state for a message when playback finishes or is manually stopped.
     * Called by the audio element's 'onended' or 'onpause' event handlers in the component.
     * @param {string} messageId - The ID of the message whose playback has finished.
     */
    function setPlaybackFinished(messageId) {
        if (messageTtsState.value[messageId] === 'playing') {
            messageTtsState.value[messageId] = 'ready';
        }
    }

    /**
     * Cleans up all created Object URLs to prevent memory leaks.
     * Should be called when the application unloads.
     */
    function cleanup() {
        log(`Cleaning up ${audioUrlCache.size} cached TTS audio URLs.`, 'INFO');
        audioUrlCache.forEach(url => URL.revokeObjectURL(url));
        audioUrlCache.clear();
    }

    // Add a cleanup hook for when the page is closed
    window.addEventListener('beforeunload', cleanup);

    return {
        messageTtsState,
        audioUrlCache, // Expose for components to get the URL
        requestTtsForMessage,
        togglePlay,
        setPlaybackFinished,
    };
});