**使用 Playwright 进行 UI 测试的大致步骤**

1.  **安装 Playwright 和 @playwright/test**:
    在您的项目根目录下，打开终端并运行：
    ```bash
    npm install --save-dev playwright @playwright/test
    # 或者使用 yarn
    # yarn add --dev playwright @playwright/test
    ```
    然后，安装 Playwright 支持的浏览器驱动：
    ```bash
    npx playwright install
    ```

2.  **初始化 Playwright 配置 (可选但推荐)**:
    Playwright Test runner 可以通过一个配置文件 `playwright.config.js` (或 `.ts`) 进行配置。
    ```bash
    npx playwright test
    ```
    这将引导您创建一个基础的配置文件，您可以设置 `baseURL` (例如 `http://localhost:8080`，如果您的应用在该地址运行) 等。

3.  **创建测试文件**:
    在您的项目中创建一个目录来存放测试文件，例如 `tests`。测试文件通常以 `.spec.js` 或 `.spec.ts` 结尾。

4.  **编写测试用例**:
    使用 Playwright Test 的 API 来与页面交互并进行断言。

5.  **运行测试**:
    在终端中运行：
    ```bash
    npx playwright test
    ```

6.  **查看测试报告**:
    测试运行后，Playwright 会生成一个 HTML 报告。您可以前往 `/playwright/playwright-report` 查看。
    ```