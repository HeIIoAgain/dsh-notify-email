/**
 * Minimal dependency-free SMTP client.
 *
 * Supports implicit TLS (usually port 465), STARTTLS (usually port 587) and
 * plaintext (useful for a local test sink). Authentication is AUTH LOGIN or
 * AUTH PLAIN, whichever the server advertises.
 */
import net from 'node:net'
import tls from 'node:tls'

export class SmtpError extends Error {
  /**
   * @param {string} message
   * @param {string | number} [code]
   */
  constructor(message, code) {
    super(message)
    this.name = 'SmtpError'
    this.code = code
  }
}

/** Split a mixed separator-separated address list, keeping only entries with @. */
export function parseRecipients(input) {
  if (!input) return []
  return String(input)
    .split(/[,;\s]+/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0 && part.includes('@'))
}

function encodeSubject(subject) {
  // Non-ASCII subjects must be RFC 2047 encoded; ASCII is kept readable.
  if (/^[\x20-\x7E]*$/.test(subject)) return subject
  return `=?UTF-8?B?${Buffer.from(subject, 'utf8').toString('base64')}?=`
}

function wrapBase64(value, width = 76) {
  const lines = []
  for (let index = 0; index < value.length; index += width) {
    lines.push(value.slice(index, index + width))
  }
  return lines.join('\r\n')
}

function encodeRfc5987(value) {
  return encodeURIComponent(value).replace(
    /['()*]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  )
}

/** ASCII-safe header fallback plus the RFC 2231 UTF-8 form for non-ASCII names. */
function encodeAttachmentName(filename) {
  const ascii = filename.replace(/[^\x20-\x7E]/g, '_').replace(/["\\]/g, '_')
  return { ascii: ascii.length > 0 ? ascii : 'attachment', extended: encodeRfc5987(filename) }
}

/**
 * Build a UTF-8 MIME message, plain text and optionally multipart with files.
 * @param {{ from: string, to: string[], subject: string, text: string, messageId?: string, attachments?: { filename: string, contentType: string, data: Buffer }[] }} input
 * @returns {{ from: string, to: string[], subject: string, messageId: string, raw: string }}
 */
export function buildMessage({ from, to, subject, text, messageId, attachments = [] }) {
  const domain = from.includes('@') ? from.split('@')[1] : 'localhost'
  const id = messageId ?? `<${Date.now()}.${Math.random().toString(36).slice(2, 10)}@${domain}>`
  const headers = [
    `From: ${from}`,
    `To: ${to.join(', ')}`,
    `Subject: ${encodeSubject(subject)}`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: ${id}`,
    'MIME-Version: 1.0',
  ]

  let body
  if (attachments.length === 0) {
    headers.push('Content-Type: text/plain; charset=UTF-8', 'Content-Transfer-Encoding: base64')
    body = wrapBase64(Buffer.from(text, 'utf8').toString('base64'))
  } else {
    const boundary = `----dsh-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
    headers.push(`Content-Type: multipart/mixed; boundary="${boundary}"`)
    const parts = [
      [
        `--${boundary}`,
        'Content-Type: text/plain; charset=UTF-8',
        'Content-Transfer-Encoding: base64',
        '',
        wrapBase64(Buffer.from(text, 'utf8').toString('base64')),
      ].join('\r\n'),
    ]
    for (const attachment of attachments) {
      const name = encodeAttachmentName(attachment.filename)
      parts.push(
        [
          `--${boundary}`,
          `Content-Type: ${attachment.contentType}; name="${name.ascii}"`,
          'Content-Transfer-Encoding: base64',
          `Content-Disposition: attachment; filename="${name.ascii}"; filename*=UTF-8''${name.extended}`,
          '',
          wrapBase64(attachment.data.toString('base64')),
        ].join('\r\n'),
      )
    }
    body = `${parts.join('\r\n')}\r\n--${boundary}--`
  }

  return {
    from,
    to,
    subject,
    messageId: id,
    raw: `${headers.join('\r\n')}\r\n\r\n${body}\r\n`,
  }
}

class SmtpSession {
  constructor(options) {
    this.options = options
    this.socket = undefined
    this.buffer = ''
    this.incoming = []
    this.open = null
    this.responses = []
    this.waiters = []
    this.capabilities = new Map()
    this.ended = false
    this.onData = undefined
    this.onError = undefined
    this.onClose = undefined
  }

  attach(socket) {
    this.detach()
    this.socket = socket
    this.buffer = ''
    this.incoming = []
    this.open = null
    this.ended = false
    this.onData = (chunk) => {
      this.buffer += chunk
      this.drainBuffer()
    }
    this.onError = (error) => this.fail(error)
    this.onClose = () => this.fail(new SmtpError('SMTP 连接被关闭', 'closed'))
    socket.setEncoding('utf8')
    socket.on('data', this.onData)
    socket.on('error', this.onError)
    socket.on('close', this.onClose)
  }

  detach() {
    const socket = this.socket
    if (socket === undefined) return
    if (this.onData !== undefined) socket.removeListener('data', this.onData)
    if (this.onError !== undefined) socket.removeListener('error', this.onError)
    if (this.onClose !== undefined) socket.removeListener('close', this.onClose)
    this.socket = undefined
    this.onData = undefined
    this.onError = undefined
    this.onClose = undefined
  }

  fail(error) {
    if (this.ended) return
    this.ended = true
    const waiters = this.waiters
    this.waiters = []
    for (const waiter of waiters) waiter.reject(error)
  }

  drainBuffer() {
    let index = this.buffer.indexOf('\n')
    while (index !== -1) {
      const line = this.buffer.slice(0, index).replace(/\r$/, '')
      this.buffer = this.buffer.slice(index + 1)
      this.incoming.push(line)
      index = this.buffer.indexOf('\n')
    }
    this.processLines()
  }

  processLines() {
    while (this.incoming.length > 0) {
      const line = this.incoming.shift()
      this.open ??= []
      this.open.push(line)
      const match = /^(\d{3})([ -])/.exec(line)
      if (match !== null && match[2] === ' ') {
        this.responses.push({ code: Number(match[1]), lines: this.open })
        this.open = null
      }
    }
    this.deliverResponses()
  }

  deliverResponses() {
    while (this.responses.length > 0 && this.waiters.length > 0) {
      const response = this.responses.shift()
      const waiter = this.waiters.shift()
      clearTimeout(waiter.timer)
      waiter.resolve(response)
    }
  }

  readResponse(timeoutMs) {
    return new Promise((resolve, reject) => {
      const waiter = {
        resolve,
        reject,
        timer: setTimeout(() => {
          this.waiters = this.waiters.filter((entry) => entry !== waiter)
          reject(new SmtpError('SMTP 响应超时', 'timeout'))
        }, timeoutMs),
      }
      this.waiters.push(waiter)
      this.deliverResponses()
    })
  }

  async command(line, expectedCodes, timeoutMs = this.options.timeoutMs) {
    if (this.socket === undefined) throw new SmtpError('SMTP 未连接', 'not-connected')
    this.socket.write(`${line}\r\n`)
    const response = await this.readResponse(timeoutMs)
    if (!expectedCodes.includes(response.code)) {
      throw new SmtpError(
        `SMTP 命令失败（${line.split(' ')[0]}）：${response.lines.join(' | ')}`,
        response.code,
      )
    }
    return response
  }

  async greet() {
    const response = await this.readResponse(this.options.timeoutMs)
    if (response.code !== 220) {
      throw new SmtpError(`SMTP 服务拒绝连接：${response.lines.join(' | ')}`, response.code)
    }
    await this.ehlo()
  }

  async ehlo() {
    const response = await this.command(`EHLO ${this.options.clientName ?? 'dsh-notify-email'}`, [250])
    this.capabilities = new Map()
    for (const line of response.lines.slice(1)) {
      const text = line.slice(4)
      const space = text.indexOf(' ')
      const key = (space === -1 ? text : text.slice(0, space)).toUpperCase()
      this.capabilities.set(key, space === -1 ? '' : text.slice(space + 1))
    }
    return response
  }

  async startTls() {
    const raw = this.socket
    if (raw === undefined) throw new SmtpError('SMTP 未连接', 'not-connected')
    this.detach()
    const upgraded = await new Promise((resolve, reject) => {
      const secureSocket = tls.connect(
        { socket: raw, servername: this.options.host, rejectUnauthorized: true },
        () => resolve(secureSocket),
      )
      secureSocket.once('error', reject)
    })
    this.attach(upgraded)
    this.socket.setTimeout(this.options.timeoutMs, () => {
      this.socket?.destroy(new SmtpError('SMTP 连接超时', 'timeout'))
    })
    await this.ehlo()
  }

  async authenticate() {
    const { user, pass } = this.options
    if (!user) return
    const advertised = this.capabilities.get('AUTH') ?? ''
    if (/LOGIN/i.test(advertised)) {
      await this.command('AUTH LOGIN', [334])
      await this.command(Buffer.from(user, 'utf8').toString('base64'), [334])
      await this.command(Buffer.from(pass, 'utf8').toString('base64'), [235])
      return
    }
    if (/PLAIN/i.test(advertised)) {
      const token = Buffer.from(`\u0000${user}\u0000${pass}`, 'utf8').toString('base64')
      await this.command(`AUTH PLAIN ${token}`, [235])
      return
    }
    if (advertised) {
      throw new SmtpError(`SMTP 服务声明的认证方式不受支持：${advertised}`, 'auth-unsupported')
    }
    throw new SmtpError('SMTP 服务未提供 AUTH 认证，无法登录发件邮箱', 'auth-unavailable')
  }

  async connect() {
    const { host, port, secure } = this.options
    const socket = secure
      ? tls.connect({ host, port, servername: host, rejectUnauthorized: true })
      : net.connect({ host, port })
    this.attach(socket)
    await new Promise((resolve, reject) => {
      const event = secure ? 'secureConnect' : 'connect'
      const onError = (error) => {
        cleanup()
        reject(error)
      }
      const onConnect = () => {
        cleanup()
        resolve()
      }
      const cleanup = () => {
        socket.removeListener(event, onConnect)
        socket.removeListener('error', onError)
      }
      socket.once(event, onConnect)
      socket.once('error', onError)
      socket.setTimeout(this.options.timeoutMs, () => {
        socket.destroy(new SmtpError('SMTP 连接超时', 'timeout'))
      })
    })
    this.socket.setTimeout(0)
    await this.greet()
    if (!secure) {
      const supportsStartTls = this.capabilities.has('STARTTLS')
      if (this.options.starttls === true && supportsStartTls) {
        await this.command('STARTTLS', [220])
        await this.startTls()
      }
      // Some servers advertise STARTTLS only after a prior EHLO; retry once.
      if (this.options.starttls === true && !supportsStartTls) {
        await this.ehlo()
        if (this.capabilities.has('STARTTLS')) {
          await this.command('STARTTLS', [220])
          await this.startTls()
        }
      }
    }
    await this.authenticate()
  }

  async send(message) {
    await this.command(`MAIL FROM:<${message.from}>`, [250])
    for (const recipient of message.to) {
      await this.command(`RCPT TO:<${recipient}>`, [250, 251])
    }
    await this.command('DATA', [354])
    const stuffed = message.raw
      .split('\r\n')
      .map((line) => (line.startsWith('.') ? `.${line}` : line))
      .join('\r\n')
    this.socket.write(`${stuffed.endsWith('\r\n') ? stuffed : `${stuffed}\r\n`}.\r\n`)
    const response = await this.readResponse(this.options.timeoutMs)
    if (response.code !== 250) {
      throw new SmtpError(`SMTP 投递失败：${response.lines.join(' | ')}`, response.code)
    }
    return response
  }

  close() {
    if (this.ended) return
    try {
      this.socket?.write('QUIT\r\n')
      this.socket?.end()
    } catch {
      // Best effort: the message already left the client.
    }
    this.ended = true
  }
}

/**
 * Send one message. Throws SmtpError on failure.
 * @param {{ host: string, port: number, secure: boolean, starttls?: boolean, user?: string, pass?: string, timeoutMs?: number, clientName?: string }} options
 * @param {ReturnType<typeof buildMessage>} message
 */
export async function sendMail(options, message) {
  const session = new SmtpSession({
    timeoutMs: 15000,
    starttls: true,
    ...options,
  })
  try {
    await session.connect()
    return await session.send(message)
  } finally {
    session.close()
  }
}
