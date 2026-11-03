# dsh-notify-email

English | [简体中文](README.md)

Email notifications for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (DSH): get mail on your phone when a turn finishes, when the agent waits for your answer, or when a tool needs your approval. The model can also send mail on demand with the `send_email` tool, attachments included.

- Zero runtime dependencies: Node built-ins only, pure ESM
- Works with any SMTP mailbox: QQ, 163, 126, Gmail, Outlook, self-hosted relays
- Attachments: `multipart/mixed`, UTF-8 filenames, size and count limits
- Secrets stay out of config: the authorization code lives in its own file and is re-read on every send

## Features

| Trigger | Behavior |
|---|---|
| `send_email` tool | Ask the agent to email a result; supports attachments |
| Waiting for an answer | Mail a reminder while `ask_user_question` is pending |
| Waiting for approval | Mail a reminder while a permission request is pending |
| Turn-end summary (opt-in) | With `notifyOnTurnEnd: true`, mail the final reply after every turn |

Automatic notifications are fire-and-forget: they never block a DSH flow, and a delivery failure only writes a Host log line.

## Install

Requires Node.js ≥ 22 and a working DSH (developed against `@deepseek-ai/dsh` 0.2.1).

```sh
# From npm (once published)
dsh plugin --profile web add dsh-notify-email

# From GitHub (commit-pinned is recommended)
dsh plugin --profile web add github:HeIIoAgain/dsh-notify-email#<commit-sha>

# Local checkout (development)
dsh plugin --profile web add link:/path/to/dsh-notify-email
```

Replace `web` with your profile name. Installation adds the bundle to that profile's `dsh.profile.bundles`.

## Configuration

Put the row in the profile patch layer (`$DSH_HOME/profiles/<profile>/cordis.patch.yml`):

```yaml
- id: notify-email
  name: 'dsh-notify-email'
  config:
    smtpHost: smtp.qq.com
    smtpPort: 465
    secure: true
    user: you@qq.com          # sender address (= SMTP login)
    from: you@qq.com          # From header, usually the same as user
    to: you@qq.com            # recipients, comma separated; may differ from user
    subjectPrefix: ''         # subject prefix, empty = none
    notifyOnQuestion: true
    notifyOnApproval: true
    notifyOnTurnEnd: false
```

> A row override replaces the whole `config`, so write every field you need.
> The From address must equal the SMTP login account; 163/QQ reject mismatches.

### Authorization code

Never put the SMTP password in YAML. Keep it in a file (re-read on every send, no restart needed):

```sh
mkdir -p ~/.dsh/notify-email
printf '%s' 'your-smtp-auth-code' > ~/.dsh/notify-email/password
chmod 600 ~/.dsh/notify-email/password
```

`passwordFile` points elsewhere; `DSH_SMTP_PASSWORD` is an environment-variable fallback.

### Common mailboxes

| Mailbox | smtpHost | Port / secure | Password |
|---|---|---|---|
| QQ Mail | `smtp.qq.com` | 465 / `true` | SMTP authorization code generated in settings |
| 163 Mail | `smtp.163.com` | 465 / `true` | Client authorization code |
| 126 Mail | `smtp.126.com` | 465 / `true` | Client authorization code |
| Gmail | `smtp.gmail.com` | 465 / `true` (or 587 / `false`) | App password (2FA required) |
| Outlook / Microsoft 365 | `smtp.office365.com` | 587 / `false` | Account or app password |
| Aliyun Mail | `smtp.aliyun.com` | 465 / `true` | Login password or authorization code |

> Port 25 is blocked by most cloud providers; use 465 or 587. On 587 set `secure: false` and the plugin negotiates STARTTLS.

## Usage

- Say **"email me the result"** → the agent calls `send_email`.
- Attach files: **"email me report.pdf and run.log as attachments"** → the agent fills `attachments` (absolute paths, or relative to the session working directory).
- Scheduled delivery: create a DSH reminder whose prompt asks to email the result; when it fires, the agent calls `send_email`.
- Want a summary after every turn: set `notifyOnTurnEnd: true`.
- Debugging missing reminders: set `debugLog: true`; the log is appended to `$DSH_HOME/notify-email/debug.log`.

### Attachments

- UTF-8 filenames (RFC 2231); Content-Type inferred from the extension (txt/md/json/csv/pdf/zip/png/jpg, otherwise `application/octet-stream`)
- Defaults: 20 MB per file, 10 files per message (`maxAttachmentBytes`, `maxAttachments`)
- Missing files, non-regular files, and oversized files fail before any SMTP connection is opened
- Automatic reminders carry no attachments; only the `send_email` tool does

## Options

| Field | Default | Meaning |
|---|---|---|
| `smtpHost` | `smtp.qq.com` | SMTP server |
| `smtpPort` | `465` | 465 implicit TLS, 587 STARTTLS |
| `secure` | `true` | Direct TLS; set `false` on 587 |
| `starttls` | `true` | Upgrade with STARTTLS when `secure` is false |
| `user` | — | SMTP login account (usually the sender address) |
| `from` | same as `user` | From address; must match the login account |
| `to` | — | Default recipients, comma separated |
| `passwordFile` | `$DSH_HOME/notify-email/password` | Authorization-code file |
| `passwordEnv` | `DSH_SMTP_PASSWORD` | Environment-variable fallback |
| `subjectPrefix` | `[DSH]` | Subject prefix; empty disables it |
| `notifyOnQuestion` | `true` | Remind while a question is pending |
| `notifyOnApproval` | `true` | Remind while an approval is pending |
| `notifyOnTurnEnd` | `false` | Mail a summary after every turn |
| `debugLog` | `false` | Append diagnostics to a log file |
| `timeoutMs` | `15000` | SMTP timeout |
| `maxAttachmentBytes` | `20971520` | Per-attachment limit in bytes |
| `maxAttachments` | `10` | Attachments per message |

## Troubleshooting

**`535 authentication failed` / `Login error`**

The authorization code was rejected. Check that: (1) it is a client authorization code, not the login password; (2) SMTP is enabled for the mailbox; (3) the From address equals the SMTP login; (4) the code has not expired — regenerate it if needed. The plugin supports IPv4/IPv6 and both AUTH LOGIN and AUTH PLAIN, so repeated 535 across all of them is a credential problem.

**Automatic reminders never arrive, but `send_email` works**

Automatic hooks are only registered when both `user` and `to` are set. Also, `user-questions/request` and `approval/request` are waterfalls already claimed by the GUI answerer, which never calls `next()`; an observer must `prepend` itself and delegate with `next()`. This plugin already does that.

**No settings form in the DSH UI?**

Correct: the plugin deliberately declares no `Config` schema, keeping it free of DSH package imports. Configure it through the patch and the authorization-code file.

**Port 25 does not work?**

Cloud providers usually block it. Use 465 or 587.

## Development

```sh
npm test        # 10 checks against a local fake SMTP server
npm run check   # syntax check
```

Layout:

```
.
├── index.js            # entry: tool, event hooks, config resolution
├── smtp.js             # dependency-free SMTP client and MIME builder
├── cordis.patch.yml    # bundle patch inserting the plugin row
├── locale/{en,zh}.json # Plugin Manager display metadata
├── icon.svg            # plugin icon
└── test/               # fake SMTP server + 10 checks
```

Implementation notes:

- The tool definition uses the registry's supported JSON Schema subset directly (`type/oneOf/properties/required/additionalProperties/items/enum/const`) instead of importing `@deepseek-ai/dsh-tools`, which keeps the package dependency-free.
- Question/approval listeners register with `{ prepend: true }` so they observe the request before the GUI answerer claims it, then delegate via `next()`.
- `smtp.js` implements implicit TLS, STARTTLS, AUTH LOGIN/PLAIN, and multipart MIME assembly.

## Security

- The authorization code lives in `$DSH_HOME/notify-email/password` (keep it `chmod 600`) or an environment variable; never in the patch or in git.
- Mail content traverses your mail provider; judge sensitive content accordingly.
- The plugin only makes outbound SMTP connections: it opens no ports and accepts no external requests. Attachment paths come from the caller, so do not let untrusted input choose them.

## License

[MIT](LICENSE)
