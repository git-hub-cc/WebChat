/**
 * @file ThemeList.js
 * @description 存储所有可用的主题及其配置。
 *              该文件从 ThemeLoader.js 中分离出来，以提高模块化和可维护性。
 * @module ThemeList
 * @exports {object} THEME_LIST - 包含所有主题定义的对象。
 * @dependents ThemeLoader
 */
const THEME_LIST = {
    "原神-浅色": { name: "原神", css: "css/动漫/原神-浅色.css", dataJs: "data/动漫/原神.json", defaultSpecialContacts: true  },
    "原神-深色": { name: "原神", css: "css/动漫/原神-深色.css", dataJs: "data/动漫/原神.json" },
    "迷宫饭-浅色": { name: "迷宫饭", css: "css/动漫/迷宫饭-浅色.css", dataJs: "data/动漫/迷宫饭.json" },
    "迷宫饭-深色": { name: "迷宫饭", css: "css/动漫/迷宫饭-深色.css", dataJs: "data/动漫/迷宫饭.json" },
    "斗破苍穹-浅色": { name: "斗破苍穹", css: "css/动漫/斗破苍穹-浅色.css", dataJs: "data/动漫/斗破苍穹.json" },
    "斗破苍穹-深色": { name: "斗破苍穹", css: "css/动漫/斗破苍穹-深色.css", dataJs: "data/动漫/斗破苍穹.json" },
    "崩坏3-浅色": { name: "崩坏3", css: "css/动漫/崩坏3-浅色.css", dataJs: "data/动漫/崩坏3.json" },
    "崩坏3-深色": { name: "崩坏3", css: "css/动漫/崩坏3-深色.css", dataJs: "data/动漫/崩坏3.json" },
    "蜡笔小新-浅色": { name: "蜡笔小新", css: "css/动漫/蜡笔小新-浅色.css", dataJs: "data/动漫/蜡笔小新.json"},
    "蜡笔小新-深色": { name: "蜡笔小新", css: "css/动漫/蜡笔小新-深色.css", dataJs: "data/动漫/蜡笔小新.json" },
    "英语-深色": { name: "英语", css: "css/教育/英语-深色.css", dataJs: "data/教育/英语.json" },
    "英语-浅色": { name: "英语", css: "css/教育/英语-浅色.css", dataJs: "data/教育/英语.json" },
    "计算机科学-深色": { name: "计算机科学", css: "css/教育/计算机科学-深色.css", dataJs: "data/教育/计算机科学.json" },
    "计算机科学-浅色": { name: "计算机科学", css: "css/教育/计算机科学-浅色.css", dataJs: "data/教育/计算机科学.json" },
    "MCP-深色": { name: "MCP", css: "css/系统/MCP-深色.css", dataJs: "data/系统/MCP.json" },
    "MCP-浅色": { name: "MCP", css: "css/系统/MCP-浅色.css", dataJs: "data/系统/MCP.json" },
    // "鸣潮-浅色": { name: "鸣潮", css: "css/动漫/鸣潮-浅色.css", dataJs: "data/动漫/鸣潮.json" },
    // "鸣潮-深色": { name: "鸣潮", css: "css/动漫/鸣潮-深色.css", dataJs: "data/动漫/鸣潮.json" },
    // "星穹铁道-浅色": { name: "星穹铁道", css: "css/动漫/星穹铁道-浅色.css", dataJs: "data/动漫/星穹铁道.json" },
    // "星穹铁道-深色": { name: "星穹铁道", css: "css/动漫/星穹铁道-深色.css", dataJs: "data/动漫/星穹铁道.json" },
    // "仙逆-浅色": { name: "仙逆", css: "css/动漫/仙逆-浅色.css", dataJs: "data/动漫/仙逆.json" },
    // "仙逆-深色": { name: "仙逆", css: "css/动漫/仙逆-深色.css", dataJs: "data/动漫/仙逆.json" },
    // "咒术回战-深色": { name: "咒术回战", css: "css/动漫/咒术回战-深色.css", dataJs: "data/动漫/咒术回战.json" },
    // "咒术回战-浅色": { name: "咒术回战", css: "css/动漫/咒术回战-浅色.css", dataJs: "data/动漫/咒术回战.json" },
    // "遮天-浅色": { name: "遮天", css: "css/动漫/遮天-浅色.css", dataJs: "data/动漫/遮天.json" },
    // "遮天-深色": { name: "遮天", css: "css/动漫/遮天-深色.css", dataJs: "data/动漫/遮天.json" },
    // "完美世界-浅色": { name: "完美世界", css: "css/动漫/完美世界-浅色.css", dataJs: "data/动漫/完美世界.json" },
    // "完美世界-深色": { name: "完美世界", css: "css/动漫/完美世界-深色.css", dataJs: "data/动漫/完美世界.json" },
    // "吞噬星空-浅色": { name: "吞噬星空", css: "css/动漫/吞噬星空-浅色.css", dataJs: "data/动漫/吞噬星空.json" },
    // "吞噬星空-深色": { name: "吞噬星空", css: "css/动漫/吞噬星空-深色.css", dataJs: "data/动漫/吞噬星空.json" }
};