# 企业微信定时消息推送 Server

一个本地可运行的企业微信消息推送服务，支持在网页里保存多条 webhook、按任务选择 webhook、配置多条消息内容和定时规则。

## 支持的消息类型

按企业微信“消息推送配置说明”实现：

- `text`
- `markdown`
- `markdown_v2`
- `image`
- `news`
- `file`
- `voice`
- `template_card`

图片消息支持上传图片、填写图片链接，或直接粘贴 `base64 + md5`。文件和语音支持即时上传并发送；如果要保存成定时任务，建议先通过企微上传接口获得 `media_id` 后填入表单。

`text` 支持 `mentioned_list` 和 `mentioned_mobile_list`。`markdown` 支持填写 userId 提及列表，服务端会追加为 `<@userid>` 语法；`markdown_v2` 按企微文档不支持提及扩展。

一个任务可以配置多条消息。发送时按列表顺序串行发送，每条消息之间默认间隔 5 秒，以避开企微 webhook 的 QPS 限制。

## 运行

```bash
npm install
npm start
```

然后打开：

```text
http://localhost:3077
```

数据保存在 `data/store.json`，该目录已加入 `.gitignore`，避免 webhook 被提交。

## Electron 桌面应用

开发启动：

```bash
npm run electron:dev
```

Electron 会启动一个内嵌本地服务并使用随机端口，不占用 `3077`，桌面版数据保存在系统应用数据目录。
关闭窗口后应用会留在系统托盘中继续运行定时任务；从托盘菜单选择“退出”才会停止内嵌服务。

本机目录包验证：

```bash
npm run pack:local
```

生成安装包：

```bash
npm run dist
```

Windows NSIS 安装包：

```bash
npm run dist:win
```

Windows 免安装目录包：

```bash
npm run dist:win:dir
```

`dist` 已加入 `.gitignore`。跨平台目标已在 `package.json` 中配置：macOS `dmg/zip`、Windows `nsis`、Linux `AppImage/deb`。

## 定时规则

界面提供：

- 只发送一次：设置一个开始时间，到点发送一次。
- 每天：设置每天的固定时间。
- 每周：可多选周一到周日，并设置固定时间。
- 每隔 N 分钟：设置开始时间、间隔分钟和可选结束时间。
- 自定义 cron：使用 5 段 cron。

```text
分 时 日 月 周
```

默认时区是 `Asia/Shanghai`。
