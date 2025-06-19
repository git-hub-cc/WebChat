// playwright.config.js
// @ts-check
const { devices } = require('@playwright/test');

/** @type {import('@playwright/test').PlaywrightTestConfig} */
const config = {
    // 将测试文件放在 "tests" 目录下
    testDir: './tests', // 假设您的测试文件在 "tests" 文件夹中

    // 全局超时设置 (例如，单个测试用例的超时时间)
    timeout: 30 * 1000, // 30 秒

    // 断言的默认超时
    expect: {
        timeout: 5000, // 5 秒
    },

    // 配置测试报告器
    reporter: 'html', // 生成 HTML 报告

    // 全局设置，例如 baseURL
    use: {
        baseURL: 'http://localhost:8080', // 你的应用运行的地址和端口

        // 浏览器上下文选项
        // headless: false, // 如果你想在有头模式下运行测试进行调试
        // viewport: { width: 1280, height: 720 },
        // ignoreHTTPSErrors: true,

        // 收集跟踪信息的方式，'on-first-retry' 表示在第一次重试时收集
        trace: 'on-first-retry',
    },

    // 配置项目以针对特定浏览器进行测试
    projects: [
        {
            name: 'chromium',
            use: { ...devices['Desktop Chrome'] },
        },
        // {
        //   name: 'firefox',
        //   use: { ...devices['Desktop Firefox'] },
        // },
        // {
        //   name: 'webkit',
        //   use: { ...devices['Desktop Safari'] },
        // },
    ],

    // (可选) Web 服务器配置，如果 Playwright 需要启动你的开发服务器
    // webServer: {
    //   command: 'npm run start', // 启动你应用的命令
    //   port: 8080, // 你应用监听的端口
    //   timeout: 120 * 1000,
    //   reuseExistingServer: !process.env.CI, // 在本地运行时重用已存在的服务器
    // },
};

module.exports = config;