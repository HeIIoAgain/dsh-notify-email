# v1.0.0 — 首个公开版本

> **English summary:** A DeepSeek Harness plugin that emails you when a turn ends,
> when the agent waits for an answer or an approval — plus a `send_email` tool with
> attachment support. Zero runtime dependencies: Node built-ins only.

给 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（DSH）用的邮件通知插件。
任务结束、等你回答、等你授权时发邮件到手机；模型也能用 `send_email` 工具主动发信，带附件。

## 亮点

- **零运行时依赖**：只用 Node 内置模块，纯 ESM，装完即用，不拉一堆传递依赖
- **三种自动提醒**：等待回答（`notifyOnQuestion`）、等待授权（`notifyOnApproval`）、回合结束摘要（`notifyOnTurnEnd`，默认关闭）
- **`send_email` 工具**：对 agent 说「把结果发我邮箱」即可，支持多个附件
- **中文文件名**：`multipart/mixed` + RFC 2231 编码，文件名不乱码
- **密钥不进配置**：SMTP 授权码独立文件保存，每次发送实时读取，改完不用重启
- **任意 SMTP 邮箱**：QQ / 163 / 126 / Gmail / Outlook / 阿里云 / 自建，465 隐式 TLS 与 587 STARTTLS 都支持
- **fire-and-forget**：自动通知不阻塞 DSH 任何流程，发送失败只写 Host 日志

## 安装

```sh
# 从 GitHub（commit 固定，推荐）
dsh plugin --profile web add github:HeIIoAgain/dsh-notify-email#<commit-sha>

# 从本地目录（开发调试）
dsh plugin --profile web add link:/path/to/dsh-notify-email
```

把 `web` 换成你实际使用的 profile 名。要求 Node.js ≥ 22。

## 配置

写在 profile 的 patch 层（`$DSH_HOME/profiles/<profile>/cordis.patch.yml`）：

```yaml
- id: notify-email
  name: 'dsh-notify-email'
  config:
    smtpHost: smtp.qq.com
    smtpPort: 465
    secure: true
    user: you@qq.com
    to: you@qq.com
    notifyOnQuestion: true
    notifyOnApproval: true
    notifyOnTurnEnd: false
```

授权码放独立文件，不写进 YAML：

```sh
mkdir -p ~/.dsh/notify-email
printf '%s' '你的SMTP授权码' > ~/.dsh/notify-email/password
chmod 600 ~/.dsh/notify-email/password
```

## 验证（不需要真实邮箱）

```sh
npm run check   # node --check 语法检查
npm test        # 起本地假 SMTP 服务器，跑 10 项检查
```

CI 在 Ubuntu（Node 22/24）、Windows（22）、macOS（24）上跑同样的三步，外加
`npm pack --dry-run` 校验发布包内容。

## 已知限制

- 邮件内容会经过你的邮箱服务商，敏感信息自行判断
- 自动提醒不带附件（附件只走 `send_email` 工具）
- 没有声明 `Config` schema，因此 DSH 设置面板不渲染配置表单——这是刻意保持零依赖的选择，配置全走 patch + 授权码文件
- 25 端口普遍被云厂商封禁，用 465 或 587

## 许可

MIT。非官方项目，与 DeepSeek 官方无关联。

---

**Full Changelog**: https://github.com/HeIIoAgain/dsh-notify-email/blob/main/CHANGELOG.md
