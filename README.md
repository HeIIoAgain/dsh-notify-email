# dsh-notify-email

[English](README.en.md) | 简体中文

给 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（DSH）用的邮件通知插件：任务结束、等你回答、等你授权时发邮件到你手机；模型也能用 `send_email` 工具主动发信，支持附件。

- 零运行时依赖：只用 Node 内置模块，纯 ESM，装完即用
- 任意 SMTP 邮箱：QQ / 163 / 126 / Gmail / Outlook / 自建邮件服务
- 附件：`multipart/mixed`、中文文件名、大小与数量限制
- 密钥不进配置：授权码独立文件保存，每次发送实时读取

## 功能

| 触发方式 | 说明 |
|---|---|
| `send_email` 工具 | 你对 agent 说“把结果发我邮箱”，或定时提醒到点后由 agent 调用；可带附件 |
| 等待回答时 | 出现 `ask_user_question`、需要你选择或补充信息时自动发提醒邮件 |
| 等待授权时 | 工具请求权限确认、挂起等待你点“允许”时自动发提醒邮件 |
| 回合结束摘要（可选） | `notifyOnTurnEnd: true` 时，每轮结束把最终回复摘要发到邮箱 |

自动通知是 fire-and-forget，不会阻塞 DSH 的任何流程；发送失败只写 Host 日志，不影响任务。

## 安装

需要 Node.js ≥ 22 和可用的 DSH（开发时基于 `@deepseek-ai/dsh` 0.2.1）。

```sh
# 从 npm（发布后）
dsh plugin --profile web add dsh-notify-email

# 从 GitHub（commit 固定，推荐）
dsh plugin --profile web add github:HeIIoAgain/dsh-notify-email#<commit-sha>

# 本地目录（开发调试）
dsh plugin --profile web add link:/path/to/dsh-notify-email
```

安装后插件会自动加入该 profile 的 `dsh.profile.bundles`。把 `web` 换成你实际使用的 profile 名即可。

## 配置

配置写在 profile 的 patch 层（`$DSH_HOME/profiles/<profile>/cordis.patch.yml`）：

```yaml
- id: notify-email
  name: 'dsh-notify-email'
  config:
    smtpHost: smtp.qq.com
    smtpPort: 465
    secure: true
    user: you@qq.com          # 发件邮箱（= SMTP 登录账号）
    from: you@qq.com          # 发件人地址，一般与 user 相同
    to: you@qq.com            # 收件邮箱，多个用逗号分隔；可与 user 不同
    subjectPrefix: ''         # 标题前缀，留空则不加
    notifyOnQuestion: true
    notifyOnApproval: true
    notifyOnTurnEnd: false
```

> `config` 是整体替换：按 `id` 覆盖时要把需要的字段写全。
> 发件地址必须与 SMTP 登录账号一致，否则 163/QQ 会拒信；收件地址可以是任意邮箱。

### 授权码

SMTP 密码不要写进 YAML。放进独立文件（每次发送时实时读取，改完不用重启）：

```sh
mkdir -p ~/.dsh/notify-email
printf '%s' '你的SMTP授权码' > ~/.dsh/notify-email/password
chmod 600 ~/.dsh/notify-email/password
```

也可以用 `passwordFile` 指定其他路径，或用环境变量 `DSH_SMTP_PASSWORD`（启动 `dsh` 前 export）。

### 常见邮箱参数

| 邮箱 | smtpHost | 端口 / secure | 密码 |
|---|---|---|---|
| QQ 邮箱 | `smtp.qq.com` | 465 / `true` | 设置 → 账户 → 开启 SMTP 后生成的**授权码** |
| 163 邮箱 | `smtp.163.com` | 465 / `true` | 客户端授权码 |
| 126 邮箱 | `smtp.126.com` | 465 / `true` | 客户端授权码 |
| Gmail | `smtp.gmail.com` | 465 / `true`（或 587 / `false`） | 应用专用密码（需开两步验证） |
| Outlook / Microsoft 365 | `smtp.office365.com` | 587 / `false` | 账户密码或应用密码 |
| 阿里云邮箱 | `smtp.aliyun.com` | 465 / `true` | 登录密码或授权码 |

> 25 端口通常被云厂商封禁，别用；587 端口需要 `secure: false`，插件会自动 STARTTLS。

## 使用

- 直接说：**“把刚才的结果发到我邮箱”** → agent 调 `send_email`。
- 带附件：**“把 report.pdf 和 run.log 作为附件发我邮箱”** → agent 传 `attachments`（绝对路径，或相对会话工作目录）。
- 定时：用 DSH 自带 `schedule_create` 建提醒，prompt 里写明“把结果发到邮箱”，到点触发的回合里 agent 会调 `send_email`。
- 每轮结束都要摘要：把 `notifyOnTurnEnd` 改成 `true`。
- 需要诊断自动通知为什么没触发：把 `debugLog` 改成 `true`，日志写入 `$DSH_HOME/notify-email/debug.log`。

### 附件

- 支持中文文件名（RFC 2231 编码），按扩展名自动判断 Content-Type（txt/md/json/csv/pdf/zip/png/jpg 等，其余按 `application/octet-stream`）
- 默认限制：单个 ≤ 20MB、每封 ≤ 10 个，可用 `maxAttachmentBytes` / `maxAttachments` 调整
- 文件不存在、不是普通文件、超过限制都会在读文件阶段直接报错，不会建立 SMTP 连接
- 自动提醒（提问 / 授权 / 回合结束）不带附件

## 配置项

| 字段 | 默认值 | 说明 |
|---|---|---|
| `smtpHost` | `smtp.qq.com` | SMTP 服务器 |
| `smtpPort` | `465` | 端口；465 隐式 TLS，587 STARTTLS |
| `secure` | `true` | `true` 直接 TLS；587 设为 `false` |
| `starttls` | `true` | `secure: false` 时是否升级 STARTTLS |
| `user` | — | SMTP 登录账号（通常是发件邮箱） |
| `from` | 同 `user` | 发件人地址，必须与登录账号一致 |
| `to` | — | 默认收件人，逗号分隔 |
| `passwordFile` | `$DSH_HOME/notify-email/password` | 授权码文件 |
| `passwordEnv` | `DSH_SMTP_PASSWORD` | 授权码环境变量名 |
| `subjectPrefix` | `[DSH]` | 标题前缀，留空不加 |
| `notifyOnQuestion` | `true` | 等待回答时发提醒 |
| `notifyOnApproval` | `true` | 等待授权时发提醒 |
| `notifyOnTurnEnd` | `false` | 每轮结束发摘要 |
| `debugLog` | `false` | 写诊断日志 |
| `timeoutMs` | `15000` | SMTP 超时 |
| `maxAttachmentBytes` | `20971520` | 单个附件上限（字节） |
| `maxAttachments` | `10` | 单封附件数量上限 |

## 常见问题

**535 authentication failed / Login error**

授权码不被接受。确认：① 用的是客户端授权码而不是登录密码；② 邮箱已开启 SMTP 服务；③ 发件地址与 SMTP 登录账号完全一致；④ 授权码没有过期，可重新生成。插件同时支持 IPv4/IPv6、AUTH LOGIN/PLAIN，若全部 535 基本就是凭据问题。

**为什么自动提醒没触发，但手动 `send_email` 能发？**

`user` 或 `to` 为空时自动通知不会注册。另外 `user-questions/request`、`approval/request` 是 GUI 已经抢占的 waterfall 事件，插件必须 `prepend` 才能观察到它们——本插件已处理，自研插件请注意这个坑。

**能不用 GUI 管理配置吗？**

可以，全部走 patch + 授权码文件；插件没有声明 `Config` schema，因此 DSH 设置面板不渲染配置表单（这是刻意保持零依赖的选择）。

**端口 25 发不出去？**

云厂商普遍封禁 25 端口，用 465 或 587。

## 开发

```sh
npm test        # 本地假 SMTP 服务器跑 10 项检查
npm run check   # 语法检查
```

目录：

```
.
├── index.js            # 插件入口：工具、事件钩子、配置解析
├── smtp.js             # 零依赖 SMTP 客户端与 MIME 组装
├── cordis.patch.yml    # bundle patch，插入插件行
├── locale/{en,zh}.json # 插件管理器展示文案
├── icon.svg            # 插件图标
└── test/               # fake SMTP + 10 项测试
```

实现要点：

- 工具定义直接使用 registry 接受的 JSON Schema 子集，不依赖 `@deepseek-ai/*` 包；`parameters` 用 `type/oneOf/properties/required/additionalProperties/items/enum/const`。
- 提问、授权钩子注册为 `{ prepend: true }`，先发提醒再 `next()` 把请求交给 GUI 应答器。
- SMTP 客户端支持隐式 TLS、STARTTLS、AUTH LOGIN/PLAIN，multipart 编码在 `smtp.js` 内完成。

## 安全

- 授权码只存在 `$DSH_HOME/notify-email/password`（建议 `chmod 600`）或环境变量里，不写入 patch、不进 git。
- 邮件内容会经过你的邮箱服务商，敏感信息自行判断。
- 插件只做 SMTP 出站，不监听端口、不接收外部请求；附件读取使用调用方给出的路径，注意不要让不可信输入决定路径。

## 许可证

[MIT](LICENSE)
