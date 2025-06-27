/**
 * @file McpTools.js
 * @description 定义 MCP (Meta Call Protocol) 可用的工具集。
 *              每个工具都包含其名称、描述、URL模板和参数定义。
 * @module McpTools
 * @exports {object} MCP_TOOLS - 全局可用的工具定义对象。
 */
const MCP_TOOLS = {
    get_weather: {
        name: "get_weather",
        description: "查询指定城市的实时天气。",
        // URL模板, {city} 是将被替换的参数占位符
        url_template: "https://wttr.in/{city}?format=j1",
        // 参数定义，用于AI理解和构建调用
        parameters: {
            type: "object",
            properties: {
                city: {
                    type: "string",
                    description: "需要查询天气的城市名称，例如：北京、上海、东京。"
                },
            },
            required: ["city"], // 声明city是必需参数
        }
    },
    duckduckgo_search: {
        name: "duckduckgo_search",
        description: "使用 DuckDuckGo 搜索引擎进行网络搜索，以获取信息。",
        // URL模板, {query} 是将被替换的参数占位符。返回JSON格式结果。
        url_template: "https://api.duckduckgo.com/?q={query}&format=json&pretty=1",
        parameters: {
            type: "object",
            properties: {
                query: {
                    type: "string",
                    description: "要搜索的关键词或问题。"
                }
            },
            required: ["query"]
        }
    },
    get_current_ip_info: {
        name: "get_current_ip_info",
        description: "获取当前设备的公网IP地址及相关的地理位置信息。",
        // 此API无需参数
        url_template: "http://ip-api.com/json/",
        parameters: {
            type: "object",
            properties: {}, // 无需任何参数
            required: []
        }
    },
    get_github_user_info: {
        name: "get_github_user_info",
        description: "获取指定 GitHub 用户的公开个人资料信息。",
        // URL模板, {username} 是将被替换的参数占位符
        url_template: "https://api.github.com/users/{username}",
        parameters: {
            type: "object",
            properties: {
                username: {
                    type: "string",
                    description: "需要查询的 GitHub 用户名，例如：'torvalds'。"
                }
            },
            required: ["username"]
        }
    }
    // 未来可在这里扩展更多工具
};