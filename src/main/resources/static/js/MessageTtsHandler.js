// NEW FILE: MessageTtsHandler.js
// Responsibilities:
// - Handling TTS for individual AI messages (cleaning text, requesting TTS, updating controls).
const MessageTtsHandler = {
    _currentlyPlayingTtsAudio: null,
    _currentlyPlayingTtsButton: null,

    cleanTextForTts: function (text) {
        if (typeof text !== 'string') return '';
        let cleanedText = text;
        cleanedText = cleanedText.replace(/\*.*?\*/g, '');
        cleanedText = cleanedText.replace(/【.*?】/g, '');
        cleanedText = cleanedText.replace(/\[.*?\]/g, '');
        cleanedText = cleanedText.replace(/\(.*?\)/g, '');
        cleanedText = cleanedText.replace(/（.*?）/g, '');
        const allowedCharsRegex = /[^\u4e00-\u9fff\u3040-\u309f\u30a0-\u30ff\uff65-\uff9f\u3000-\u303f\uff01-\uff5ea-zA-Z0-9\s.,!?;:'"-]/g;
        cleanedText = cleanedText.replace(allowedCharsRegex, ' ');
        cleanedText = cleanedText.replace(/\s+/g, ' ');
        return cleanedText.trim();
    },

    addTtsPlaceholder: function (parentContainer, ttsId) {
        const existingControl = parentContainer.querySelector(`.tts-control-container[data-tts-id="${ttsId}"]`);
        if (existingControl) existingControl.remove();

        const ttsControlContainer = document.createElement('span');
        ttsControlContainer.className = 'tts-control-container';
        ttsControlContainer.dataset.ttsId = ttsId;
        const spinner = document.createElement('span');
        spinner.className = 'tts-loading-spinner';
        ttsControlContainer.appendChild(spinner);
        parentContainer.appendChild(ttsControlContainer);
    },

    requestTtsForMessage: async function (text, ttsConfig, parentContainer, ttsId) {
        const currentTtsApiEndpoint = window.Config?.server?.ttsApiEndpoint;
        if (!currentTtsApiEndpoint) {
            Utils.log("TTS not triggered: Global TTS API Endpoint is not configured.", Utils.logLevels.WARN);
            this.updateTtsControlToError(parentContainer, ttsId, "TTS endpoint not configured");
            return;
        }

        const payload = {
            access_token: "guest", model_name: ttsConfig.model_name, speaker_name: ttsConfig.speaker_name,
            prompt_text_lang: ttsConfig.prompt_text_lang || "中文", emotion: ttsConfig.emotion || "默认",
            text: text, text_lang: ttsConfig.text_lang || "中文", top_k: ttsConfig.top_k || 10,
            top_p: ttsConfig.top_p || 1, temperature: ttsConfig.temperature || 1,
            text_split_method: ttsConfig.text_split_method || "按标点符号切", batch_size: ttsConfig.batch_size || 10,
            batch_threshold: ttsConfig.batch_threshold || 0.75, split_bucket: ttsConfig.split_bucket === undefined ? true : ttsConfig.split_bucket,
            speed_facter: ttsConfig.speed_facter || 1, fragment_interval: ttsConfig.fragment_interval || 0.3,
            media_type: ttsConfig.media_type || "wav", parallel_infer: ttsConfig.parallel_infer === undefined ? true : ttsConfig.parallel_infer,
            repetition_penalty: ttsConfig.repetition_penalty || 1.35, seed: ttsConfig.seed === undefined ? -1 : ttsConfig.seed,
        };
        Utils.log(`MessageTtsHandler: TTS request. Endpoint='${currentTtsApiEndpoint}' for ttsId ${ttsId}`, Utils.logLevels.DEBUG);

        try {
            const response = await fetch(currentTtsApiEndpoint, {
                method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(payload)
            });
            if (!response.ok) {
                const errorData = await response.text();
                throw new Error(`TTS API request failed status ${response.status}: ${errorData.substring(0,150)}`);
            }
            const result = await response.json();
            if (result.audio_url) {
                this._preloadAndSetAudio(result.audio_url, parentContainer, ttsId);
            } else {
                throw new Error(`TTS API response missing audio_url. Msg: ${result.msg || 'Unknown error'}`);
            }
        } catch (error) {
            Utils.log(`Error processing TTS for ttsId ${ttsId}: ${error.message}`, Utils.logLevels.ERROR);
            if (Utils.logLevel <= Utils.logLevels.DEBUG && error.stack) Utils.log(error.stack, Utils.logLevels.DEBUG);
            this.updateTtsControlToError(parentContainer, ttsId, error.message);
        }
    },
    _preloadAndSetAudio: async function(audioUrl, parentContainer, ttsId) {
        try {
            Utils.log(`MessageTtsHandler: Preloading TTS audio from ${audioUrl} for ttsId ${ttsId}`, Utils.logLevels.DEBUG);
            const audioResponse = await fetch(audioUrl);
            if (!audioResponse.ok) {
                const errorText = await audioResponse.text().catch(() => "Could not read error response body");
                throw new Error(`Failed to fetch TTS audio. Status: ${audioResponse.status}. URL: ${audioUrl}. Response: ${errorText.substring(0,100)}`);
            }
            const audioBlob = await audioResponse.blob();
            if (audioBlob.size === 0) throw new Error(`Failed to fetch TTS: Received empty blob. URL: ${audioUrl}`);
            const preloadedAudioObjectURL = URL.createObjectURL(audioBlob);
            Utils.log(`MessageTtsHandler: TTS audio preloaded for ttsId ${ttsId}. Object URL: ${preloadedAudioObjectURL}`, Utils.logLevels.DEBUG);
            this.updateTtsControlToPlay(parentContainer, ttsId, preloadedAudioObjectURL);
        } catch (preloadError) {
            Utils.log(`Error preloading TTS audio for ttsId ${ttsId} (URL: ${audioUrl}): ${preloadError.message}`, Utils.logLevels.ERROR);
            if (Utils.logLevel <= Utils.logLevels.DEBUG && preloadError.stack) Utils.log(preloadError.stack, Utils.logLevels.DEBUG);
            this.updateTtsControlToError(parentContainer, ttsId, "Audio load failed");
        }
    },


    updateTtsControlToPlay: function (parentContainer, ttsId, audioUrl) {
        const ttsControlContainer = parentContainer.querySelector(`.tts-control-container[data-tts-id="${ttsId}"]`);
        if (ttsControlContainer) {
            ttsControlContainer.innerHTML = '';
            const playButton = document.createElement('button');
            playButton.className = 'tts-play-button';
            playButton.dataset.audioUrl = audioUrl;
            playButton.title = "Play/Pause Speech";
            playButton.onclick = (e) => { e.stopPropagation(); this.playTtsAudioFromControl(playButton); };
            ttsControlContainer.appendChild(playButton);
        }
    },

    playTtsAudioFromControl: function (buttonElement) {
        const audioUrl = buttonElement.dataset.audioUrl;
        if (!audioUrl) return;

        const revokeCurrentAudioObjectURL = (audioInstance) => {
            if (audioInstance && audioInstance.src && audioInstance.src.startsWith('blob:') && audioInstance.dataset.managedObjectURL === 'true') {
                URL.revokeObjectURL(audioInstance.src);
                Utils.log(`Revoked object URL: ${audioInstance.src}`, Utils.logLevels.DEBUG);
                delete audioInstance.dataset.managedObjectURL;
            }
        };

        if (this._currentlyPlayingTtsAudio && this._currentlyPlayingTtsButton === buttonElement) {
            if (this._currentlyPlayingTtsAudio.paused) {
                this._currentlyPlayingTtsAudio.play().catch(e => Utils.log("Error resuming TTS audio: " + e, Utils.logLevels.ERROR));
                buttonElement.classList.add('playing');
            } else {
                this._currentlyPlayingTtsAudio.pause();
                buttonElement.classList.remove('playing');
            }
        } else {
            if (this._currentlyPlayingTtsAudio) {
                this._currentlyPlayingTtsAudio.pause();
                revokeCurrentAudioObjectURL(this._currentlyPlayingTtsAudio);
                if (this._currentlyPlayingTtsButton) this._currentlyPlayingTtsButton.classList.remove('playing');
            }
            this._currentlyPlayingTtsAudio = new Audio(audioUrl);
            this._currentlyPlayingTtsButton = buttonElement;
            if (audioUrl.startsWith('blob:')) this._currentlyPlayingTtsAudio.dataset.managedObjectURL = 'true';

            this._currentlyPlayingTtsAudio.play().then(() => buttonElement.classList.add('playing'))
                .catch(e => {
                    Utils.log("Error playing TTS audio: " + e, Utils.logLevels.ERROR);
                    buttonElement.classList.remove('playing');
                    buttonElement.innerHTML = '⚠️'; buttonElement.title = "Error initiating audio";
                    setTimeout(() => { if (buttonElement.innerHTML === '⚠️') { buttonElement.innerHTML = ''; buttonElement.title = "Play/Pause Speech"; } }, 2000);
                    revokeCurrentAudioObjectURL(this._currentlyPlayingTtsAudio);
                    this._currentlyPlayingTtsAudio = null; this._currentlyPlayingTtsButton = null;
                });
            this._currentlyPlayingTtsAudio.onended = () => {
                buttonElement.classList.remove('playing');
                if (this._currentlyPlayingTtsAudio && this._currentlyPlayingTtsButton === buttonElement) {
                    revokeCurrentAudioObjectURL(this._currentlyPlayingTtsAudio);
                    this._currentlyPlayingTtsAudio = null; this._currentlyPlayingTtsButton = null;
                }
            };
            this._currentlyPlayingTtsAudio.onerror = (event) => {
                Utils.log(`Error during TTS audio playback: ${event.target.error ? event.target.error.message : "Unknown"}`, Utils.logLevels.ERROR);
                buttonElement.classList.remove('playing');
                buttonElement.innerHTML = '⚠️'; buttonElement.title = "Error playing audio";
                setTimeout(() => { if (buttonElement.innerHTML === '⚠️') { buttonElement.innerHTML = ''; buttonElement.title = "Play/Pause Speech"; } }, 2000);
                if (this._currentlyPlayingTtsAudio && this._currentlyPlayingTtsButton === buttonElement) {
                    revokeCurrentAudioObjectURL(this._currentlyPlayingTtsAudio);
                    this._currentlyPlayingTtsAudio = null; this._currentlyPlayingTtsButton = null;
                }
            };
        }
    },

    updateTtsControlToError: function (parentContainer, ttsId, errorMessage = "TTS failed") {
        const ttsControlContainer = parentContainer.querySelector(`.tts-control-container[data-tts-id="${ttsId}"]`);
        if (ttsControlContainer) {
            ttsControlContainer.innerHTML = '';
            const errorIcon = document.createElement('span');
            errorIcon.className = 'tts-error-icon';
            errorIcon.textContent = '⚠️';
            errorIcon.title = errorMessage;
            ttsControlContainer.appendChild(errorIcon);
        }
    }
};