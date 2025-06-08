// NEW FILE: MediaUIManager.js
// Responsibilities:
// - Displaying UI previews for audio recordings and selected files.
// - Handling cancellation of these previews from the UI.
const MediaUIManager = {
    audioPreviewContainerEl: null,
    filePreviewContainerEl: null,

    init: function() {
        this.audioPreviewContainerEl = document.getElementById('audioPreviewContainer');
        this.filePreviewContainerEl = document.getElementById('filePreviewContainer');
        // Event listeners for play/cancel within previews are added dynamically when previews are created.
    },

    displayAudioPreview: function (audioDataUrl, duration) {
        if (!this.audioPreviewContainerEl) {
            Utils.log("Audio preview container not found.", Utils.logLevels.ERROR);
            return;
        }
        const formattedDuration = Utils.formatTime(duration);
        this.audioPreviewContainerEl.innerHTML = `
            <div class="voice-message-preview">
                <span>🎙️ Voice Message (${formattedDuration})</span>
                <audio controls src="${audioDataUrl}" style="display:none;"></audio>
                <button class="btn-play-preview">Play</button>
                <button class="btn-cancel-preview">Cancel</button>
            </div>
        `;
        const playBtn = this.audioPreviewContainerEl.querySelector('.btn-play-preview');
        const cancelBtn = this.audioPreviewContainerEl.querySelector('.btn-cancel-preview');
        const audioEl = this.audioPreviewContainerEl.querySelector('audio');

        if (playBtn && audioEl) {
            playBtn.onclick = () => {
                if (audioEl.paused) {
                    audioEl.play().catch(e => Utils.log("Error playing preview audio: " + e, Utils.logLevels.ERROR));
                    playBtn.textContent = "Pause";
                } else {
                    audioEl.pause();
                    playBtn.textContent = "Play";
                }
            };
            audioEl.onended = () => { playBtn.textContent = "Play"; };
        }
        if (cancelBtn) cancelBtn.onclick = () => MessageManager.cancelAudioData();
    },

    clearAudioPreview: function() {
        if (this.audioPreviewContainerEl) this.audioPreviewContainerEl.innerHTML = '';
    },

    displayFilePreview: function(fileObj) {
        if (!this.filePreviewContainerEl) {
            Utils.log("File preview container not found.", Utils.logLevels.ERROR);
            return;
        }
        this.filePreviewContainerEl.innerHTML = ''; // Clear previous
        const previewDiv = document.createElement('div');
        previewDiv.className = 'file-preview-item';
        let contentHtml = '';

        if (fileObj.type.startsWith('image/')) {
            contentHtml = `<img src="${fileObj.data}" alt="Preview" style="max-height: 50px; border-radius: 4px; margin-right: 8px;"> ${Utils.escapeHtml(fileObj.name)}`;
        } else if (fileObj.type.startsWith('video/')) {
            contentHtml = `🎬 ${Utils.escapeHtml(fileObj.name)} (Video)`;
        } else {
            contentHtml = `📄 ${Utils.escapeHtml(fileObj.name)} (${MediaManager.formatFileSize(fileObj.size)})`; // formatFileSize can stay in MediaManager as a utility
        }
        previewDiv.innerHTML = `<span>${contentHtml}</span><button class="cancel-file-preview" title="Remove attachment">✕</button>`;
        this.filePreviewContainerEl.appendChild(previewDiv);
        const cancelBtn = this.filePreviewContainerEl.querySelector('.cancel-file-preview');
        if (cancelBtn) cancelBtn.onclick = () => MessageManager.cancelFileData();
    },

    clearFilePreview: function() {
        if (this.filePreviewContainerEl) this.filePreviewContainerEl.innerHTML = '';
    },

    resetRecordingButtonUI: function() { // Moved from MediaManager for UI specific reset
        const voiceButton = document.getElementById('voiceButtonMain');
        if (voiceButton) {
            voiceButton.classList.remove('recording');
            voiceButton.innerHTML = '🎙️';
            const timerEl = document.getElementById('recordingVoiceTimer');
            if(timerEl) timerEl.remove();
        }
    },

    updateRecordingButtonTimerUI: function(elapsedSeconds, maxDuration) { // Moved from MediaManager
        const voiceButton = document.getElementById('voiceButtonMain'); // Assume it's been grabbed if needed
        let voiceTimerEl = document.getElementById('recordingVoiceTimer');

        if (!voiceButton && !voiceTimerEl) return; // Nothing to update

        if (!voiceTimerEl && voiceButton && voiceButton.classList.contains('recording')) {
            voiceTimerEl = document.createElement('span');
            voiceTimerEl.id = 'recordingVoiceTimer';
            voiceTimerEl.className = 'audio-timer-indicator';
            voiceButton.appendChild(voiceTimerEl);
        } else if (!voiceButton?.classList.contains('recording') && voiceTimerEl) {
            voiceTimerEl.remove(); // Clean up if somehow exists without recording class
            return;
        }


        if (voiceTimerEl) {
            voiceTimerEl.textContent = Utils.formatTime(elapsedSeconds);
        }

        if (elapsedSeconds >= maxDuration) {
            // Stop recording logic is in MediaManager, UI just reflects
            NotificationManager.showNotification(`Max recording time of ${maxDuration}s reached.`, 'info');
        }
    },

    setRecordingButtonActive: function(isActive) {
        const voiceButton = document.getElementById('voiceButtonMain');
        if (voiceButton) {
            if (isActive) {
                voiceButton.classList.add('recording');
                voiceButton.innerHTML = '🛑'; // Stop icon
                // Timer element will be added/updated by updateRecordingButtonTimerUI
            } else {
                this.resetRecordingButtonUI(); // Use the consolidated reset
            }
        }
    }
};