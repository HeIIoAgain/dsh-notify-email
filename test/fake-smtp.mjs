/** A tiny SMTP sink for tests: plaintext, no TLS, AUTH LOGIN/PLAIN accepted. */
import net from 'node:net'

export function startFakeSmtp() {
  const messages = []
  const auth = []
  const server = net.createServer((socket) => {
    let buffer = ''
    let inData = false
    let data = ''
    let from = ''
    let recipients = []
    let authStep = 0
    socket.setEncoding('utf8')
    socket.write('220 fake.local ESMTP ready\r\n')

    socket.on('data', (chunk) => {
      buffer += chunk
      let index = buffer.indexOf('\r\n')
      while (index !== -1) {
        const line = buffer.slice(0, index)
        buffer = buffer.slice(index + 2)
        index = buffer.indexOf('\r\n')

        if (inData) {
          if (line === '.') {
            inData = false
            messages.push({ from, to: [...recipients], data, auth: [...auth] })
            socket.write('250 2.0.0 queued as 0001\r\n')
          } else {
            data += `${line}\r\n`
          }
          continue
        }

        if (/^EHLO/i.test(line)) {
          socket.write('250-fake.local\r\n250-AUTH LOGIN PLAIN\r\n250 SIZE 10485760\r\n')
        } else if (/^AUTH LOGIN/i.test(line)) {
          authStep = 1
          socket.write('334 VXNlcm5hbWU6\r\n')
        } else if (/^AUTH PLAIN (.+)$/i.test(line)) {
          const token = /^AUTH PLAIN (.+)$/i.exec(line)[1]
          auth.push(Buffer.from(token, 'base64').toString('utf8').replaceAll('\u0000', ':'))
          socket.write('235 2.7.0 accepted\r\n')
        } else if (authStep === 1) {
          auth.push(Buffer.from(line, 'base64').toString('utf8'))
          authStep = 2
          socket.write('334 UGFzc3dvcmQ6\r\n')
        } else if (authStep === 2) {
          auth.push(Buffer.from(line, 'base64').toString('utf8'))
          authStep = 0
          socket.write('235 2.7.0 accepted\r\n')
        } else if (/^MAIL FROM:/i.test(line)) {
          from = line.replace(/^MAIL FROM:\s*/i, '').replace(/[<>]/g, '')
          socket.write('250 2.1.0 ok\r\n')
        } else if (/^RCPT TO:/i.test(line)) {
          recipients.push(line.replace(/^RCPT TO:\s*/i, '').replace(/[<>]/g, ''))
          socket.write('250 2.1.5 ok\r\n')
        } else if (/^DATA/i.test(line)) {
          inData = true
          socket.write('354 end with <CRLF>.<CRLF>\r\n')
        } else if (/^QUIT/i.test(line)) {
          socket.write('221 2.0.0 bye\r\n')
          socket.end()
          return
        } else if (/^(RSET|NOOP)/i.test(line)) {
          socket.write('250 ok\r\n')
        } else {
          socket.write('250 ok\r\n')
        }
      }
    })
    socket.on('error', () => {})
  })

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve({
        server,
        port: server.address().port,
        messages,
        auth,
        close: () => new Promise((done) => server.close(done)),
      })
    })
  })
}

/** Decode the base64 text/plain body of a captured raw MIME message. */
export function decodeBody(raw) {
  const separator = raw.indexOf('\r\n\r\n')
  const body = separator === -1 ? '' : raw.slice(separator + 4)
  return Buffer.from(body.trim(), 'base64').toString('utf8')
}

/** Parse one captured multipart/mixed message into decoded parts. */
export function parseMultipart(raw) {
  const boundaryMatch = /Content-Type: multipart\/mixed; boundary="([^"]+)"/.exec(raw)
  assertBoundary(boundaryMatch)
  const boundary = boundaryMatch[1]
  const body = raw.slice(raw.indexOf('\r\n\r\n') + 4)
  const chunks = body.split(`--${boundary}`).slice(1, -1)
  return chunks.map((chunk) => {
    const trimmed = chunk.replace(/^\r\n/, '')
    const split = trimmed.indexOf('\r\n\r\n')
    const headers = split === -1 ? '' : trimmed.slice(0, split)
    const payload = split === -1 ? '' : trimmed.slice(split + 4)
    return {
      headers,
      data: Buffer.from(payload.replace(/\r\n/g, '').trim(), 'base64'),
    }
  })
}

function assertBoundary(match) {
  if (match === null) throw new Error('message is not multipart/mixed')
}
