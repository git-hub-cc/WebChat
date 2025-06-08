// MODIFIED: MediaManager.js
// - UI preview logic moved to MediaUIManager.js.
// - Calls MediaUIManager for UI updates.
const MediaManager = {
    mediaRecorder: null,
    audioChunks: [],
    recordingTimer: null,
    recordingStartTime: null,
    recordingDuration: 0,
    audioStream: null,

    initVoiceRecording: function() {
        const voiceButton = document.getElementById('voiceButtonMain');
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
            Utils.log('Browser does not support media devices.', Utils.logLevels.WARN);
            if(voiceButton) voiceButton.disabled = true;
        }
        // Event listeners for voiceButton (mousedown, mouseup, touchstart, touchend)
        // are complex and could be managed here or in ChatAreaUIManager.
        // For now, keeping them in AppInitializer/ChatAreaUIManager as they trigger MediaManager methods.
    },

    requestMicrophonePermission: async function() {
        if (this.mediaRecorder && this.audioStream?.active && this.mediaRecorder.state !== "inactive") return true;
        this.releaseAudioResources();
        try {
            this.audioStream = await navigator.mediaDevices.getUserMedia({ audio: Config.media.audioConstraints || true });
            const options = { mimeType: 'audio/webm;codecs=opus' };
            if (!MediaRecorder.isTypeSupported(options.mimeType)) {
                options.mimeType = 'audio/ogg;codecs=opus';
                if(!MediaRecorder.isTypeSupported(options.mimeType)) options.mimeType = 'audio/webm';
            }
            this.mediaRecorder = new MediaRecorder(this.audioStream, options);
            this.mediaRecorder.ondataavailable = (event) => { if (event.data.size > 0) this.audioChunks.push(event.data); };
            this.mediaRecorder.onstop = () => {
                if (this.audioChunks.length === 0) { Utils.log("No audio data recorded.", Utils.logLevels.WARN); this.releaseAudioResources(); return; }
                const audioBlob = new Blob(this.audioChunks, { type: this.mediaRecorder.mimeType });
                const reader = new FileReader();
                reader.onloadend = () => {
                    MessageManager.audioData = reader.result;
                    MessageManager.audioDuration = this.recordingDuration;
                    if (typeof MediaUIManager !== 'undefined') MediaUIManager.displayAudioPreview(reader.result, this.recordingDuration);
                };
                reader.readAsDataURL(audioBlob);
                this.audioChunks = [];
            };
            Utils.log('Microphone permission granted.', Utils.logLevels.INFO);
            return true;
        } catch (error) {
            Utils.log(`Error getting mic permission: ${error}`, Utils.logLevels.ERROR);
            NotificationManager.showNotification('Microphone access denied or unavailable.', 'error');
            const voiceButton = document.getElementById('voiceButtonMain');
            if(voiceButton) voiceButton.disabled = true;
            this.releaseAudioResources();
            return false;
        }
    },

    startRecording: async function() {
        if (this.mediaRecorder && this.mediaRecorder.state === 'recording') return;
        const permissionGranted = await this.requestMicrophonePermission();
        if (!permissionGranted) return;
        try {
            this.audioChunks = [];
            this.mediaRecorder.start();
            this.recordingStartTime = Date.now();
            this.recordingDuration = 0;
            if (typeof MediaUIManager !== 'undefined') MediaUIManager.setRecordingButtonActive(true);
            this._updateRecordingTimerInterval(); // Start UI timer updates
            Utils.log('Audio recording started.', Utils.logLevels.INFO);
        } catch (error) {
            Utils.log(`Failed to start recording: ${error}`, Utils.logLevels.ERROR);
            this.releaseAudioResources();
        }
    },

    stopRecording: function() {
        if (!this.mediaRecorder || this.mediaRecorder.state !== 'recording') {
            if (typeof MediaUIManager !== 'undefined') MediaUIManager.setRecordingButtonActive(false);
            this.releaseAudioResources();
            return;
        }
        try {
            this.mediaRecorder.stop(); // Triggers ondataavailable and onstop
            clearInterval(this.recordingTimer);
            this.recordingTimer = null;
            if (typeof MediaUIManager !== 'undefined') MediaUIManager.setRecordingButtonActive(false);
            Utils.log('Audio recording stopped.', Utils.logLevels.INFO);
        } catch (error) {
            Utils.log(`Failed to stop recording: ${error}`, Utils.logLevels.ERROR);
            this.releaseAudioResources();
        }
    },

    _updateRecordingTimerInterval: function() { // Renamed to avoid conflict with UI function
        if (this.recordingTimer) clearInterval(this.recordingTimer); // Clear existing if any
        const updateUI = () => {
            if (!this.recordingStartTime) return;
            const elapsedSeconds = Math.floor((Date.now() - this.recordingStartTime) / 1000);
            this.recordingDuration = elapsedSeconds;
            if (typeof MediaUIManager !== 'undefined') MediaUIManager.updateRecordingButtonTimerUI(elapsedSeconds, Config.media.maxAudioDuration);
            if (elapsedSeconds >= Config.media.maxAudioDuration) this.stopRecording();
        };
        updateUI(); // Initial call
        this.recordingTimer = setInterval(updateUI, 1000);
    },

    // resetRecordingButton and updateRecordingTimer are now in MediaUIManager

    playAudio: function(buttonElement) { // This is for playing received/sent voice messages, not previews
        const audioDataUrl = buttonElement.dataset.audio;
        if (!audioDataUrl) return;
        const existingAudio = buttonElement.querySelector('audio.playing-audio-instance');
        if (existingAudio) { existingAudio.pause(); existingAudio.remove(); buttonElement.innerHTML = '▶'; return; }

        document.querySelectorAll('audio.playing-audio-instance').forEach(aud => {
            aud.pause();
            const btn = aud.closest('.voice-message')?.querySelector('.play-voice-btn');
            if(btn) btn.innerHTML = '▶';
            aud.remove();
        });

        const audio = new Audio(audioDataUrl);
        audio.className = "playing-audio-instance";
        buttonElement.innerHTML = '❚❚';
        audio.play().catch(e => { Utils.log("Error playing audio: "+e, Utils.logLevels.ERROR); buttonElement.innerHTML = '▶'; });
        audio.onended = () => { buttonElement.innerHTML = '▶'; audio.remove(); };
        audio.onerror = () => { buttonElement.innerHTML = '⚠️'; setTimeout(() => {buttonElement.innerHTML = '▶'; audio.remove();}, 2000); };
    },

    releaseAudioResources: function() {
        if (this.audioStream) { this.audioStream.getTracks().forEach(track => track.stop()); this.audioStream = null; Utils.log('Mic stream released.', Utils.logLevels.INFO); }
        if (this.mediaRecorder?.state !== "inactive") try { this.mediaRecorder.stop(); } catch(e) { /* ignore */ }
        this.mediaRecorder = null; this.audioChunks = [];
        if (this.recordingTimer) { clearInterval(this.recordingTimer); this.recordingTimer = null; }
    },

    formatFileSize: function(bytes) { // Utility, can stay here or move to Utils.js
        if (bytes === 0) return '0 Bytes';
        const k = 1024; const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    },

    // displayFilePreview is now in MediaUIManager

    handleFileSelect: async function(event) {
        const file = event.target.files[0];
        if (!file) return;
        if (file.size > Config.media.maxFileSize) {
            NotificationManager.showNotification(`File too large. Max: ${this.formatFileSize(Config.media.maxFileSize)}.`, 'error');
            event.target.value = ''; return;
        }
        try {
            const reader = new FileReader();
            reader.onload = (e) => {
                MessageManager.selectedFile = { data: e.target.result, type: file.type, name: file.name, size: file.size };
                if (typeof MediaUIManager !== 'undefined') MediaUIManager.displayFilePreview(MessageManager.selectedFile);
            };
            reader.readAsDataURL(file);
        } catch (error) {
            Utils.log(`Error handling file select: ${error}`, Utils.logLevels.ERROR);
            NotificationManager.showNotification('Error processing file.', 'error');
        }
        event.target.value = '';
    },
};