import assert from 'node:assert/strict'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { apply as applyPlugin } from '../index.js'
import { decodeBody, parseMultipart, startFakeSmtp } from './fake-smtp.mjs'

function createMockContext() {
  const handlers = new Map()
  const options = new Map()
  const tools = []
  const logs = []
  const ctx = {
    on(event, listener, listenerOptions) {
      const list = handlers.get(event) ?? []
      list.push(listener)
      handlers.set(event, list)
      options.set(event, listenerOptions)
    },
    logger(_scope) {
      return {
        info: (message) => logs.push(['info', message]),
        warn: (message) => logs.push(['warn', message]),
        error: (message) => logs.push(['error', message]),
      }
    },
    tools: { register: (definition) => tools.push(definition) },
    effect: (callback) => callback(),
    get: () => undefined,
  }
  return { ctx, handlers, tools, logs, options }
}

async function waitFor(predicate, timeoutMs = 4000) {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    if (await predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  throw new Error('timed out waiting for condition')
}

const smtp = await startFakeSmtp()
const secretsDir = await mkdtemp(join(tmpdir(), 'dsh-notify-'))
const passwordFile = join(secretsDir, 'password')
await writeFile(passwordFile, 'app-password\n', { mode: 0o600 })

const baseConfig = {
  smtpHost: '127.0.0.1',
  smtpPort: smtp.port,
  secure: false,
  starttls: false,
  user: 'sender@example.com',
  to: 'receiver@example.com',
  passwordFile,
  passwordEnv: 'DSH_SMTP_PASSWORD_TEST',
  subjectPrefix: '[DSH]',
  notifyOnQuestion: true,
  notifyOnApproval: true,
  notifyOnTurnEnd: false,
  timeoutMs: 5000,
}

const { ctx, handlers, tools, options } = createMockContext()
applyPlugin(ctx, baseConfig)

assert.equal(options.get('user-questions/request').prepend, true)
assert.equal(options.get('approval/request').prepend, true)
assert.equal(tools.length, 1)
assert.equal(tools[0].name, 'send_email')

// 1) Manual tool call delivers a real SMTP message.
const toolResult = await tools[0].execute(
  { subject: '任务完成', body: '构建成功，用时 42 秒。' },
  { agent: undefined, signal: undefined },
)
assert.equal(toolResult.delivered, true, JSON.stringify(toolResult))
assert.equal(toolResult.to, 'receiver@example.com')
assert.equal(smtp.messages.length, 1)
assert.equal(smtp.messages[0].from, 'sender@example.com')
assert.deepEqual(smtp.messages[0].to, ['receiver@example.com'])
assert.deepEqual(smtp.messages[0].auth, ['sender@example.com', 'app-password'])
assert.equal(decodeBody(smtp.messages[0].data), '构建成功，用时 42 秒。')
assert.match(smtp.messages[0].data, /Subject: =\?UTF-8\?B\?/)
console.log('✓ send_email 工具通过真实 SMTP 会话投递')

// 2) ask_user_question hook sends an alert and delegates with next().
let nextCalled = false
const questionHandler = handlers.get('user-questions/request')[0]
const questionAnswer = await questionHandler(
  {
    questions: [
      {
        id: 'q1',
        header: '确认',
        question: '是否继续执行后续步骤？',
        options: [{ label: '继续' }, { label: '停止' }],
      },
    ],
    agent: { session: { id: 's1', header: { cwd: '/srv/dsh' } } },
  },
  async () => {
    nextCalled = true
    return { answers: [] }
  },
)
assert.equal(nextCalled, true)
assert.deepEqual(questionAnswer, { answers: [] })
await waitFor(() => smtp.messages.length === 2)
assert.equal(decodeBody(smtp.messages[1].data), '1. 确认 是否继续执行后续步骤？\n选项: 继续 / 停止\n\nSession: s1\nCWD: /srv/dsh')
console.log('✓ 等待回答时自动发邮件，并正确委托 next()')

// 3) approval hook sends an alert.
const approvalHandler = handlers.get('approval/request')[0]
let approvalNext = false
await approvalHandler(
  {
    agent: { session: { id: 's2', header: { cwd: '/srv/dsh' } } },
    toolName: 'bash',
    reason: '需要写入工作区外文件',
  },
  async () => {
    approvalNext = true
    return 'denied'
  },
)
assert.equal(approvalNext, true)
await waitFor(() => smtp.messages.length === 3)
assert.match(decodeBody(smtp.messages[2].data), /工具: bash/)
assert.match(decodeBody(smtp.messages[2].data), /原因: 需要写入工作区外文件/)
console.log('✓ 等待权限确认时自动发邮件')

// 4) Missing recipient is reported without throwing.
const missingRecipient = await tools[0].execute(
  { subject: 'x', body: 'y', to: '' },
  {},
)
assert.equal(missingRecipient.delivered, true) // to omitted -> falls back to config
const noRecipientCtx = createMockContext()
applyPlugin(noRecipientCtx.ctx, { ...baseConfig, to: '' })
const noRecipient = await noRecipientCtx.tools[0].execute({ subject: 'x', body: 'y' }, {})
assert.equal(noRecipient.delivered, false)
assert.match(noRecipient.error, /收件人/)
console.log('✓ 缺少收件人时返回可读错误而非抛异常')

// 5) Missing password is reported with the expected hint.
const noPasswordCtx = createMockContext()
applyPlugin(noPasswordCtx.ctx, { ...baseConfig, passwordFile: join(secretsDir, 'missing') })
const noPassword = await noPasswordCtx.tools[0].execute({ subject: 'x', body: 'y' }, {})
assert.equal(noPassword.delivered, false)
assert.match(noPassword.error, /授权码/)
console.log('✓ 缺少授权码时返回可读错误')

// 6) turn-end summaries are opt-in and skip delegated sessions.
const turnCtx = createMockContext()
applyPlugin(turnCtx.ctx, { ...baseConfig, notifyOnTurnEnd: true })
const sessionEvent = turnCtx.handlers.get('session/event')[0]
const before = smtp.messages.length
await sessionEvent(
  { id: 's3', header: { cwd: '/srv/dsh' } },
  { type: 'assistant/message', data: { message: { content: [{ type: 'text', text: '全部测试通过' }] } } },
)
await sessionEvent(
  { id: 's3', header: { cwd: '/srv/dsh' } },
  { type: 'turn/end', data: { turn: 2, reason: { kind: 'completed' } } },
)
await waitFor(() => smtp.messages.length === before + 1)
assert.equal(decodeBody(smtp.messages.at(-1).data), '状态: completed\n\n全部测试通过\nSession: s3\nCWD: /srv/dsh')
console.log('✓ turn 结束摘要按配置发送')

const delegatedBefore = smtp.messages.length
await sessionEvent(
  { id: 's4', header: { cwd: '/srv/dsh', delegationDepth: 1 } },
  { type: 'assistant/message', data: { message: { content: [{ type: 'text', text: '子任务' }] } } },
)
await sessionEvent(
  { id: 's4', header: { cwd: '/srv/dsh', delegationDepth: 1 } },
  { type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } },
)
await new Promise((resolve) => setTimeout(resolve, 150))
assert.equal(smtp.messages.length, delegatedBefore)
console.log('✓ 子 agent 的 turn 不重复推送')

// 7) Attachments: relative path resolved from the session cwd, multipart MIME,
//    RFC 2231 encoded non-ASCII filename, exact payload.
const attachmentDir = await mkdtemp(join(tmpdir(), 'dsh-attach-'))
const attachmentName = '报告-附件.txt'
const attachmentText = '附件内容 ABC 123\n第二行'
await writeFile(join(attachmentDir, attachmentName), attachmentText)
const beforeAttach = smtp.messages.length
const attachResult = await tools[0].execute(
  { subject: '带附件', body: '见附件，正文第一段。', attachments: [attachmentName] },
  { agent: { session: { header: { cwd: attachmentDir } } } },
)
assert.equal(attachResult.delivered, true, JSON.stringify(attachResult))
assert.match(attachResult.attachments, /报告-附件\.txt/)
const attachRaw = smtp.messages[beforeAttach].data
assert.match(attachRaw, /Content-Type: multipart\/mixed; boundary="/)
const parts = parseMultipart(attachRaw)
assert.equal(parts.length, 2)
assert.equal(parts[0].data.toString('utf8'), '见附件，正文第一段。')
assert.match(parts[1].headers, /Content-Disposition: attachment/)
assert.match(parts[1].headers, /filename\*=UTF-8''%E6%8A%A5%E5%91%8A-%E9%99%84%E4%BB%B6\.txt/)
assert.equal(parts[1].data.toString('utf8'), attachmentText)
console.log('✓ 附件按 multipart/mixed 编码并原样送达（含中文文件名）')

// 8) Missing attachment fails before any SMTP session with a readable error.
const missingAttachment = await tools[0].execute(
  { subject: 'x', body: 'y', attachments: [join(attachmentDir, '不存在.txt')] },
  {},
)
assert.equal(missingAttachment.delivered, false)
assert.match(missingAttachment.error, /附件不存在/)
console.log('✓ 附件不存在时返回可读错误')

// 9) Oversized attachment is rejected by the configured byte limit.
const sizeCtx = createMockContext()
applyPlugin(sizeCtx.ctx, { ...baseConfig, maxAttachmentBytes: 4 })
const oversize = await sizeCtx.tools[0].execute(
  { subject: 'x', body: 'y', attachments: [join(attachmentDir, attachmentName)] },
  {},
)
assert.equal(oversize.delivered, false)
assert.match(oversize.error, /附件过大/)
console.log('✓ 附件超过大小上限时拒绝发送')

await smtp.close()
console.log('\n全部 10 项检查通过')
