/**
 * dsh-notify-email — send DSH results to your mailbox.
 *
 * Three ways to trigger a mail:
 *  - the `send_email` tool, called by the model on request (or when a
 *    scheduled reminder fires and asks to deliver its result by email);
 *  - automatically while `ask_user_question` is waiting for an answer;
 *  - automatically while a permission approval is pending.
 * Optionally it can also mail a summary at the end of every turn.
 *
 * The plugin is a plain ESM Cordis bundle with no runtime dependencies: it
 * imports only Node built-ins, so it can be installed from a local path, from
 * GitHub, or from npm without resolving any other package.
 *
 * The SMTP password is never stored in the Cordis patch. It is read fresh on
 * every send from `passwordFile` (default `$DSH_HOME/notify-email/password`)
 * or, failing that, from `passwordEnv`.
 *
 * @module dsh-notify-email
 */
import { appendFile, readFile, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, isAbsolute, join, resolve } from 'node:path'
import { buildMessage, parseRecipients, sendMail } from './smtp.js'

export const name = 'notify-email'
export const inject = ['tools']

/** Row config defaults; a patch may override any field. */
export const DEFAULTS = {
  /** SMTP server host, e.g. `smtp.qq.com`. */
  smtpHost: 'smtp.qq.com',
  /** SMTP port: 465 (implicit TLS) or 587 (STARTTLS). */
  smtpPort: 465,
  /** `true` for implicit TLS (usually 465), `false` to negotiate STARTTLS (usually 587). */
  secure: true,
  /** When `secure` is false, upgrade with STARTTLS if the server advertises it. */
  starttls: true,
  /** SMTP login account; 163/QQ also require the From address to equal it. */
  user: '',
  /** From address; falls back to `user`. */
  from: '',
  /** Default recipients, comma separated. May differ from `user`. */
  to: '',
  /** File holding the SMTP authorization code; empty means `$DSH_HOME/notify-email/password`. */
  passwordFile: '',
  /** Environment variable used as a password fallback. */
  passwordEnv: 'DSH_SMTP_PASSWORD',
  /** Subject prefix; empty means no prefix. */
  subjectPrefix: '[DSH]',
  /** Mail a reminder while `ask_user_question` waits for an answer. */
  notifyOnQuestion: true,
  /** Mail a reminder while a permission approval is pending. */
  notifyOnApproval: true,
  /** Mail a summary at the end of every turn (opt-in). */
  notifyOnTurnEnd: false,
  /** Append diagnostics to `$DSH_HOME/notify-email/debug.log`. */
  debugLog: false,
  /** SMTP command timeout in milliseconds. */
  timeoutMs: 15000,
  /** Per-attachment size limit in bytes (default 20 MB). */
  maxAttachmentBytes: 20 * 1024 * 1024,
  /** Per-message attachment count limit. */
  maxAttachments: 10,
}

function dshHome() {
  return process.env.DSH_HOME || join(homedir(), '.dsh')
}

function expandPath(path) {
  if (path === '~') return homedir()
  if (path.startsWith('~/')) return join(homedir(), path.slice(2))
  return path
}

function passwordFilePath(config) {
  return expandPath(config.passwordFile || join(dshHome(), 'notify-email', 'password'))
}

async function resolvePassword(config) {
  const file = passwordFilePath(config)
  try {
    const value = (await readFile(file, 'utf8')).trim()
    if (value.length > 0) return value
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
  }
  const envName = config.passwordEnv
  if (envName) {
    const value = process.env[envName]
    if (typeof value === 'string' && value.trim().length > 0) return value.trim()
  }
  return undefined
}

function log(ctx, level, message) {
  try {
    const logger = typeof ctx.logger === 'function' ? ctx.logger(name) : undefined
    if (logger !== undefined && typeof logger[level] === 'function') {
      logger[level](message)
      return
    }
  } catch {
    // fall through to console
  }
  const sink = level === 'warn' || level === 'error' ? console.warn : console.log
  sink(`[${name}] ${message}`)
}

function debugLog(config, message) {
  if (!config.debugLog) return
  const file = join(dshHome(), 'notify-email', 'debug.log')
  void appendFile(file, `${new Date().toISOString()} ${message}\n`).catch(() => {})
}

const clip = (text, max = 1500) => (text.length > max ? `${text.slice(0, max)}…` : text)

function textOf(message) {
  const content = message?.content
  if (!Array.isArray(content)) return ''
  return content
    .filter((block) => block?.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text)
    .join('\n')
    .trim()
}

function sessionFooter(session) {
  const lines = []
  if (session?.id) lines.push(`Session: ${session.id}`)
  const cwd = session?.header?.cwd
  if (cwd) lines.push(`CWD: ${cwd}`)
  return lines.join('\n')
}

const CONTENT_TYPES = new Map([
  ['.txt', 'text/plain'],
  ['.md', 'text/markdown'],
  ['.log', 'text/plain'],
  ['.csv', 'text/csv'],
  ['.json', 'application/json'],
  ['.yaml', 'application/yaml'],
  ['.yml', 'application/yaml'],
  ['.xml', 'application/xml'],
  ['.html', 'text/html'],
  ['.pdf', 'application/pdf'],
  ['.zip', 'application/zip'],
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.gif', 'image/gif'],
  ['.webp', 'image/webp'],
])

function contentTypeOf(filename) {
  const dot = filename.lastIndexOf('.')
  const ext = dot === -1 ? '' : filename.slice(dot).toLowerCase()
  return CONTENT_TYPES.get(ext) ?? 'application/octet-stream'
}

/** Read and validate attachment files before opening the SMTP session. */
async function loadAttachments(config, paths, cwd) {
  if (!Array.isArray(paths) || paths.length === 0) return []
  const limit = config.maxAttachments ?? DEFAULTS.maxAttachments
  if (paths.length > limit) throw new Error(`附件数量超限：最多 ${limit} 个，本次 ${paths.length} 个`)
  const bytesLimit = config.maxAttachmentBytes ?? DEFAULTS.maxAttachmentBytes
  const attachments = []
  for (const entry of paths) {
    const text = String(entry ?? '').trim()
    if (text.length === 0) continue
    const filePath = isAbsolute(text) ? text : resolve(cwd ?? process.cwd(), text)
    let stats
    try {
      stats = await stat(filePath)
    } catch (error) {
      if (error?.code === 'ENOENT') throw new Error(`附件不存在：${filePath}`)
      throw error
    }
    if (!stats.isFile()) throw new Error(`附件不是普通文件：${filePath}`)
    if (stats.size > bytesLimit) {
      const actual = (stats.size / 1024 / 1024).toFixed(1)
      const limitText = (bytesLimit / 1024 / 1024).toFixed(0)
      throw new Error(`附件过大：${basename(filePath)} 为 ${actual}MB，上限 ${limitText}MB`)
    }
    attachments.push({
      filename: basename(filePath),
      contentType: contentTypeOf(filePath),
      data: await readFile(filePath),
    })
  }
  return attachments
}

async function deliver(config, { subject, body, to, attachments: attachmentPaths, cwd }) {
  const user = (config.user ?? '').trim()
  const from = ((config.from ?? '') || user).trim()
  if (!config.smtpHost) throw new Error('SMTP 未配置：缺少 smtpHost')
  if (!from) throw new Error('SMTP 未配置：请设置 user（发件邮箱）')
  const recipients = parseRecipients(to || config.to)
  if (recipients.length === 0) {
    throw new Error('未配置收件人：请在插件配置 to 里填写，或调用 send_email 时传 to')
  }
  const password = await resolvePassword(config)
  if (password === undefined) {
    throw new Error(
      `SMTP 授权码未配置：请把授权码写入 ${passwordFilePath(config)}，或设置环境变量 ${config.passwordEnv}`,
    )
  }
  const attachments = await loadAttachments(config, attachmentPaths, cwd)
  const message = buildMessage({
    from,
    to: recipients,
    subject: [config.subjectPrefix, subject].filter(Boolean).join(' '),
    text: body,
    attachments,
  })
  await sendMail(
    {
      host: config.smtpHost,
      port: config.smtpPort,
      secure: config.secure,
      starttls: config.starttls,
      user,
      pass: password,
      timeoutMs: config.timeoutMs,
    },
    message,
  )
  return {
    from,
    to: recipients,
    messageId: message.messageId,
    attachments: attachments.map((item) => item.filename),
  }
}

function fireAndForget(ctx, config, mail) {
  debugLog(config, `deliver start subject=${mail?.subject ?? ''}`)
  void deliver(config, mail)
    .then(() => debugLog(config, `deliver ok subject=${mail?.subject ?? ''}`))
    .catch((error) => {
      const message = error instanceof Error ? error.message : String(error)
      debugLog(config, `deliver failed: ${message}`)
      log(ctx, 'warn', `邮件通知发送失败：${message}`)
    })
}

function safeOn(ctx, event, listener, options) {
  try {
    if (options === undefined) ctx.on(event, listener)
    else ctx.on(event, listener, options)
  } catch (error) {
    log(ctx, 'warn', `无法监听 ${event}：${error instanceof Error ? error.message : String(error)}`)
  }
}

function registerHooks(ctx, config) {
  // Before the mailbox is configured, stay quiet instead of logging one
  // warning per question/approval; the send_email tool still explains what is
  // missing when the model tries it.
  if (!config.user || !config.to) {
    log(ctx, 'info', '邮箱尚未配置（user/to 为空），自动通知未启用；send_email 工具仍可返回配置提示')
    return
  }

  const lastAssistantText = new Map()
  debugLog(config, `hooks registered user=${config.user} to=${config.to}`)

  safeOn(ctx, 'session/event', (session, event) => {
    if (event?.type === 'assistant/message') {
      const text = textOf(event.data?.message)
      if (text) lastAssistantText.set(session.id, text)
      return
    }
    if (event?.type === 'turn/end') {
      const text = lastAssistantText.get(session.id)
      lastAssistantText.delete(session.id)
      if (!config.notifyOnTurnEnd) return
      if (session?.header?.delegationDepth) return
      const reason = event.data?.reason
      const kind = reason?.kind ?? 'unknown'
      const completed = kind === 'completed'
      const excerpt = text || (kind === 'error' ? String(reason?.error?.message ?? reason?.error ?? '') : '')
      fireAndForget(ctx, config, {
        subject: completed ? '任务完成' : `任务结束（${kind}）`,
        body: [`状态: ${kind}`, excerpt ? `\n${clip(excerpt)}` : '', sessionFooter(session)]
          .filter(Boolean)
          .join('\n'),
      })
    }
  })

  // `user-questions/request` and `approval/request` are scoped waterfalls: the
  // GUI answerer registered at startup claims them without calling next(), so
  // an observer must prepend itself, notify, and then delegate with next().
  safeOn(
    ctx,
    'user-questions/request',
    (request, next) => {
      debugLog(
        config,
        `question event questions=${request?.questions?.length ?? 0} agent=${request?.agent?.session?.id ?? 'none'}`,
      )
      if (config.notifyOnQuestion) {
        const questions = Array.isArray(request?.questions) ? request.questions : []
        const body =
          questions.length === 0
            ? 'Agent 正在等待你的输入。'
            : questions
                .map((item, index) => {
                  const head = item?.header ? `${item.header} ` : ''
                  const options =
                    Array.isArray(item?.options) && item.options.length > 0
                      ? `\n选项: ${item.options.map((option) => option.label).join(' / ')}`
                      : ''
                  return `${index + 1}. ${head}${item?.question ?? ''}${options}`
                })
                .join('\n')
        fireAndForget(ctx, config, {
          subject: '需要你的回答',
          body: [body, sessionFooter(request?.agent?.session)].filter(Boolean).join('\n\n'),
        })
      }
      return next()
    },
    { prepend: true },
  )

  safeOn(
    ctx,
    'approval/request',
    (request, next) => {
      debugLog(config, `approval event tool=${request?.toolName ?? 'unknown'}`)
      if (config.notifyOnApproval) {
        const reason = request?.displayReason?.zh ?? request?.reason
        fireAndForget(ctx, config, {
          subject: '需要你的确认',
          body: [
            `工具: ${request?.toolName ?? '未知'}`,
            reason ? `原因: ${reason}` : '',
            sessionFooter(request?.agent?.session),
          ]
            .filter(Boolean)
            .join('\n'),
        })
      }
      return next()
    },
    { prepend: true },
  )
}

/** The model-facing `send_email` tool definition (plain JSON Schema subset). */
function sendEmailTool(ctx, config) {
  return {
    name: 'send_email',
    description:
      'Send an email to the user. Use it when the user asks to be emailed, when a scheduled reminder fires and asks to deliver its result by email, or when a long result should reach the user\'s phone as a mail notification. Files can be attached by absolute path (or a path relative to the session working directory).',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        subject: { type: 'string', description: 'Short email subject.' },
        body: { type: 'string', description: 'Plain-text email body.' },
        to: {
          type: 'string',
          description: 'Optional recipient address (comma separated); defaults to the configured recipient.',
        },
        attachments: {
          type: 'array',
          description:
            'Optional file paths to attach (absolute, or relative to the session working directory). Each file must exist and be under the configured size limit.',
          items: { type: 'string' },
        },
      },
      required: ['subject', 'body'],
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          delivered: { type: 'boolean', description: 'Whether the SMTP server accepted the message.' },
          to: { type: 'string', description: 'Recipients that accepted the message.' },
          attachments: { type: 'string', description: 'Attached file names, comma separated.' },
          error: { type: 'string', description: 'Failure reason when delivered is false.' },
        },
        required: ['delivered'],
      },
      render: (_args, value) =>
        value.delivered
          ? [
              {
                type: 'text',
                text: `邮件已发送至 ${value.to}${value.attachments ? `，附件：${value.attachments}` : ''}`,
              },
            ]
          : [{ type: 'text', text: `邮件发送失败：${value.error}` }],
    },
    async execute(args, exec) {
      try {
        if (typeof args?.subject !== 'string' || typeof args?.body !== 'string') {
          throw new Error('send_email 需要字符串参数 subject 和 body')
        }
        if (args.attachments !== undefined && !Array.isArray(args.attachments)) {
          throw new Error('attachments 必须是文件路径字符串数组')
        }
        const result = await deliver(config, {
          subject: args.subject,
          body: args.body,
          to: args.to,
          attachments: args.attachments,
          cwd: exec?.agent?.session?.header?.cwd,
        })
        log(ctx, 'info', `email sent to ${result.to.join(', ')} (${result.messageId})`)
        return {
          delivered: true,
          to: result.to.join(', '),
          ...(result.attachments.length > 0 ? { attachments: result.attachments.join(', ') } : {}),
        }
      } catch (error) {
        return {
          delivered: false,
          error: error instanceof Error ? error.message : String(error),
        }
      }
    },
  }
}

export function apply(ctx, config = {}) {
  const resolved = { ...DEFAULTS, ...config }
  registerHooks(ctx, resolved)
  const tool = sendEmailTool(ctx, resolved)
  const register = () => ctx.tools.register(tool)
  if (typeof ctx.effect === 'function') ctx.effect(register, 'notify-email: send_email tool')
  else register()
}
