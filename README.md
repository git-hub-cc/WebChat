# P2P 网页聊天应用

一个基于 WebRTC 技术的点对点网页聊天应用，支持多媒体通信。专为无需中央服务器的直接通信设计，针对中国网络环境进行了优化。


## 功能特点

- 📱 无需服务器的点对点直接通信
- 🔒 通过 WebRTC 实现端到端加密
- 🖼️ 图片分享和自动压缩
- 🎙️ 语音消息录制和播放
- 🔗 分享链接的预览功能
- 🌐 针对不同网络环境的自动适应
- 🔄 稳健的连接处理和自动重连机制
- 📊 实时连接质量监控

## 快速开始

### 在线演示

直接体验应用：[https://git-hub-cc.github.io/p2p-web-chat](https://git-hub-cc.github.io/p2p-web-chat)

### 本地开发

1. 克隆仓库：
```bash
git clone https://github.com/git-hub-cc/p2p-web-chat.git
cd p2p-web-chat
```

2. 简单测试，使用任意 HTTP 服务器：
```bash
# 使用 Python
python -m http.server 8000

# 使用 Node.js
npx serve
```

3. 要测试语音录制功能，需使用 HTTPS：
```bash
# 生成自签名证书
openssl req -x509 -newkey rsa:4096 -keyout key.pem -out cert.pem -days 365 -nodes

# 使用 Python 运行
python3 -m http.server 8443 --bind 127.0.0.1 --ssl-cert cert.pem --ssl-key key.pem
```

4. 在浏览器中访问 `http://localhost:8000`（或使用 HTTPS 的 `https://localhost:8443`）

## 工作原理

1. **连接建立**：第一位用户创建连接请求，分享生成的连接字符串，并等待响应。

2. **连接响应**：第二位用户粘贴连接请求信息，创建响应，并将响应字符串分享回第一位用户。

3. **连接完成**：第一位用户处理响应信息，建立两个浏览器之间的直接点对点通道。

4. **直接通信**：连接建立后，用户可以直接通过浏览器交换文本消息、图片和语音录音。

## 技术细节

- 使用 **WebRTC** 实现点对点通信
- 通过 **Data Channels** 交换文本和二进制数据
- 使用 **ICE 框架**和 STUN/TURN 服务器实现 NAT 穿透
- 通过连接质量监控实现**自适应流**
- 设计模式：模块模式、观察者模式、单例模式

## 网络优化

本应用包含针对复杂网络环境的特殊优化：

- 优先使用适合中国网络的 STUN 服务器
- 直接连接失败时自动回退到中继服务器
- UDP 被阻止时回退到 TCP
- 带超时的渐进式 ICE 候选收集
- 连接质量监控和自适应重连

## 浏览器兼容性

| 浏览器 | 支持情况 |
|---------|---------|
| Google Chrome | ✅ 完全支持 |
| Mozilla Firefox | ✅ 完全支持 |
| Microsoft Edge | ✅ 完全支持 |
| Safari | ✅ 完全支持 |
| Opera | ✅ 完全支持 |
| Chrome for Android | ✅ 完全支持 |
| Safari for iOS | ✅ 完全支持 |
| Internet Explorer | ❌ 不支持 |

## 安全考虑

- WebRTC 连接默认加密
- 建立连接后，数据不经过中央服务器
- 语音录制功能出于安全考虑需要 HTTPS
- 不在磁盘上存储数据；所有通信保持在内存中

## 许可证

本项目采用 MIT 许可证 - 详见 [LICENSE](LICENSE) 文件。

## 致谢

- WebRTC 项目及其文档
- 由谷歌、小米、腾讯等提供的公共 STUN 服务器
- 开源社区的灵感和资源

## 贡献

欢迎贡献！请随时提交 Pull Request。