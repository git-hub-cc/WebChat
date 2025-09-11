/**
 * @file ttsDefaults.js
 * @description (Vue Refactor - NEW FILE)
 *              Defines the complete, default configuration object for TTS API requests.
 *              This ensures that every TTS request payload is complete and consistent
 *              with the original TtsApiHandler.js implementation, preventing API errors.
 * @module Config
 * @exports {object} DEFAULT_TTS_CONFIG - The default TTS parameter object.
 */
export const DEFAULT_TTS_CONFIG = {
    // Basic & Dynamic Fields
    tts_mode: 'Dynamic',
    version: 'v4',
    enabled: false,
    model_name: '', // Will be populated dynamically or by user
    prompt_text_lang: '中文',
    emotion: '默认',
    text_lang: '中文',
    text_split_method: '按标点符号切',
    seed: -1,

    // Advanced Fields with original defaults
    media_type: 'wav',
    fragment_interval: 0.3,
    speed_facter: 1.0,
    parallel_infer: true,
    batch_threshold: 0.75,
    split_bucket: true,
    batch_size: 10,
    top_k: 10,
    top_p: 1,
    temperature: 1.0,
    repetition_penalty: 1.35,

    // Fields that might not have a UI but are part of the original payload
    sample_steps: 16,
    if_sr: false,
    speaker_name: undefined, // Explicitly undefined as it's often optional
};