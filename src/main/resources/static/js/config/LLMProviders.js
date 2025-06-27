/**
 * @file LLMProviders.js
 * @description 存储所有支持的大语言模型（LLM）提供商的静态配置数据。
 *              该文件从 AppSettings.js 中分离出来，以提高模块化和可维护性。
 * @module LLMProviders
 * @exports {object} LLMProviders - 包含所有大模型提供商配置的全局常量对象。
 * @dependents SettingsUIManager, AiApiHandler
 */
const LLMProviders = {
    "ppmc": {
        "label": "PPMC",
        "defaultEndpoint": "http://localhost:8080/v1/chat/completions",
        "defaultModel": "qwen-turbo",
        "models": [
            { "key": "qwen-turbo", "label": "Qwen Turbo" },
        ]
    },
    "siliconflow": {
        "label": "SiliconFlow",
        "defaultEndpoint": "https://api.siliconflow.cn/v1/chat/completions",
        "defaultModel": "Qwen/Qwen3-14B",
        "models": [
            { "key": "Qwen/Qwen3-14B", "label": "Qwen3 14B" },
            { "key": "Qwen/Qwen3-30B-A3B", "label": "Qwen3 30B" },
            { "key": "THUDM/GLM-4-32B-0414", "label": "GLM-4 32B" },
            { "key": "THUDM/GLM-Z1-Rumination-32B-0414", "label": "GLM-Z1 Rumination 32B" },
            { "key": "deepseek-ai/DeepSeek-R1-0528-Qwen3-8B", "label": "DeepSeek-R1 Qwen3 8B" }
        ]
    },
    "dashscope": {
        "label": "通义千问",
        "defaultEndpoint": "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions",
        "defaultModel": "qwen-turbo",
        "models": [
            // --- 主力模型 (Aliases) ---
            { "key": "qwen-turbo", "label": "Qwen Turbo" },
            { "key": "qwen-plus", "label": "Qwen Plus" },
            { "key": "qwen-max", "label": "Qwen Max" },
            { "key": "qwen-long", "label": "Qwen Long" },

            // --- Qwen3 系列 ---
            { "key": "qwen3-32b", "label": "Qwen3 32B" },
            { "key": "qwen3-14b", "label": "Qwen3 14B" },
            { "key": "qwen3-8b", "label": "Qwen3 8B" },

            // --- Qwen2 系列 ---
            { "key": "qwen2-72b-instruct", "label": "Qwen2 72B Instruct" },
            { "key": "qwen2-57b-a14b-instruct", "label": "Qwen2 57B Instruct" },
            { "key": "qwen2-7b-instruct", "label": "Qwen2 7B Instruct" },

            // --- Qwen1.5 系列 ---
            { "key": "qwen1.5-110b-chat", "label": "Qwen1.5 110B Chat" },
            { "key": "qwen1.5-72b-chat", "label": "Qwen1.5 72B Chat" },
            { "key": "qwen1.5-32b-chat", "label": "Qwen1.5 32B Chat" },

            // --- 多模态系列 (Vision) ---
            { "key": "qwen-vl-max", "label": "Qwen VL Max" },
            { "key": "qwen-vl-plus", "label": "Qwen VL Plus" },

            // --- 第三方模型 (Third-party) ---
            { "key": "deepseek-v3", "label": "DeepSeek V3" },
            { "key": "deepseek-r1", "label": "DeepSeek R1" }
        ]
    },
    "deepseek": {
        "label": "DeepSeek",
        "defaultEndpoint": "https://api.deepseek.com/v1/chat/completions",
        "defaultModel": "deepseek-chat",
        "models": [
            { "key": "deepseek-chat", "label": "DeepSeek-V3" },
            { "key": "deepseek-reasoner", "label": "DeepSeek R1" }
        ]
    },
    "openai": {
        "label": "OpenAI",
        "defaultEndpoint": "https://api.openai.com/v1/chat/completions",
        "defaultModel": "gpt-4o",
        "models": [
            { "key": "gpt-3.5-turbo", "label": "GPT-3.5 Turbo" },
            { "key": "gpt-3.5-turbo-0125", "label": "GPT-3.5 Turbo (0125)" },
            { "key": "gpt-4o", "label": "GPT-4o" },
            { "key": "gpt-4o-mini-2024-07-18", "label": "GPT-4o mini (2024-07-18)" },
            { "key": "gpt-4o-2024-05-13", "label": "GPT-4o (2024-05-13)" },
            { "key": "gpt-4o-2024-08-06", "label": "GPT-4o (2024-08-06)" },
            { "key": "gpt-4o-2024-11-20", "label": "GPT-4o (2024-11-20)" },
            { "key": "gpt-4-turbo", "label": "GPT-4 Turbo" },
            { "key": "gpt-4-turbo-2024-04-09", "label": "GPT-4 Turbo (2024-04-09)" },
            { "key": "gpt-4-0613", "label": "GPT-4 (0613)" },
            { "key": "gpt-4.1-2025-04-14", "label": "GPT-4.1 (2025-04-14)" },
            { "key": "o1-2024-12-17", "label": "o1 (2024-12-17)" },
            { "key": "o3-mini-2025-01-31", "label": "o3-mini (2025-01-31)" },
            { "key": "o4-mini-2025-04-16", "label": "o4-mini (2025-04-16)" }
        ]
    },
    "anthropic": {
        "label": "Anthropic",
        "defaultEndpoint": "https://api.anthropic.com/v1/messages",
        "defaultModel": "claude-3-5-sonnet-latest",
        "models": [
            { "key": "claude-3-opus-20240229", "label": "Claude 3 Opus (20240229)" },
            { "key": "claude-3-sonnet-20240229", "label": "Claude 3 Sonnet (20240229)" },
            { "key": "claude-3-haiku-20240307", "label": "Claude 3 Haiku (20240307)" },
            { "key": "claude-3-5-sonnet-latest", "label": "Claude 3.5 Sonnet (Latest)" },
            { "key": "claude-3-5-sonnet-20241022", "label": "Claude 3.5 Sonnet (20241022)" },
            { "key": "claude-3-5-sonnet-20240620", "label": "Claude 3.5 Sonnet (20240620)" },
            { "key": "claude-3-5-haiku-latest", "label": "Claude 3.5 Haiku (Latest)" },
            { "key": "claude-3-5-haiku-20241022", "label": "Claude 3.5 Haiku (20241022)" },
            { "key": "claude-3-7-sonnet-latest", "label": "Claude 3.7 Sonnet (Latest)" },
            { "key": "claude-3-7-sonnet-20250219", "label": "Claude 3.7 Sonnet (20250219)" },
            { "key": "claude-opus-4-latest", "label": "Claude Opus 4 (Latest)" },
            { "key": "claude-opus-4-20250514", "label": "Claude Opus 4 (20250514)" },
            { "key": "claude-sonnet-4-latest", "label": "Claude Sonnet 4 (Latest)" },
            { "key": "claude-sonnet-4-20250514", "label": "Claude Sonnet 4 (20250514)" },
        ]
    },
    "custom": {
        "label": "自定义",
        "defaultEndpoint": "",
        "defaultModel": "",
        "models": []
    }
};