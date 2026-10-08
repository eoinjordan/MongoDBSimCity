import { createServer } from 'node:http'
import { readFile, realpath } from 'node:fs/promises'
import { extname, resolve, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

/**
 * Local measurement service. Serves the built site and two JSON endpoints that
 * run `serverStatus` against a MongoDB you point it at (loopback by default):
 *
 *   GET  /api/mongo/status            -> { status }
 *   POST /api/mongo/sample {seconds}  -> { before, after, seconds }
 *
 * The browser never talks to MongoDB directly, and the service only accepts
 * requests from its own origin (or RUNTIME_ORIGIN) on a loopback host.
 */
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.png': 'image/png', '.json': 'application/json' }
export const DEFAULT_MONGO_URL = 'mongodb://127.0.0.1:27017/?directConnection=true'

export function loopbackOrAllowed(value) {
  const url = new URL(value)
  if (url.protocol !== 'mongodb:' && url.protocol !== 'mongodb+srv:') throw new Error('MONGO_URL must be a mongodb:// or mongodb+srv:// URL')
  return url.href
}

async function readJson(stream, limit) {
  let length = 0
  const chunks = []
  for await (const chunk of stream) {
    length += chunk.length
    if (length > limit) throw new Error('JSON payload exceeds the size limit')
    chunks.push(chunk)
  }
  return JSON.parse(Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString('utf8'))
}

/** Default status source: the official driver, loaded lazily so tests can inject a fake. */
export async function driverStatusSource(mongoUrl) {
  const { MongoClient } = await import('mongodb')
  const client = new MongoClient(mongoUrl, { serverSelectionTimeoutMS: 5000, appName: 'MongoDBSimCity-measure' })
  await client.connect()
  return {
    async serverStatus() {
      const doc = await client.db('admin').command({ serverStatus: 1, metrics: 0, locks: 0, tcmalloc: 0, logicalSessionRecordCache: 0 })
      // Strip anything that is not JSON-friendly before it crosses to the page.
      return JSON.parse(JSON.stringify(doc, (_key, value) => (typeof value === 'bigint' ? Number(value) : value)))
    },
    async close() { await client.close() },
  }
}

export function createRuntimeServer({ statusSource, distRoot = fileURLToPath(new URL('../dist/', import.meta.url)), allowedOrigins = [], sleep = (ms) => new Promise((done) => setTimeout(done, ms)) } = {}) {
  if (typeof statusSource !== 'function') throw new Error('statusSource() must return { serverStatus(), close() }')
  let busy = false
  let source = null
  async function getSource() {
    if (!source) source = await statusSource()
    return source
  }

  const server = createServer(async (request, response) => {
    const send = (status, payload) => {
      response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' })
      response.end(JSON.stringify(payload))
    }
    try {
      const port = request.socket.localPort
      const allowedHosts = [`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`]
      if (!allowedHosts.includes(request.headers.host)) return send(403, { error: 'Host rejected' })
      const origin = request.headers.origin
      if (origin && origin !== `http://${request.headers.host}` && !allowedOrigins.includes(origin)) return send(403, { error: 'Origin rejected' })
      if (origin) {
        response.setHeader('Access-Control-Allow-Origin', origin)
        response.setHeader('Vary', 'Origin')
      }
      if (request.method === 'OPTIONS') {
        response.setHeader('Access-Control-Allow-Methods', 'GET, POST')
        response.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-SimCity-Request')
        response.writeHead(204)
        return response.end()
      }
      const url = new URL(request.url, `http://${request.headers.host}`)
      if (url.pathname === '/api/mongo/status' && request.method === 'GET') {
        const src = await getSource()
        return send(200, { status: await src.serverStatus() })
      }
      if (url.pathname === '/api/mongo/sample' && request.method === 'POST') {
        if (request.headers['x-simcity-request'] !== '1' || !request.headers['content-type']?.startsWith('application/json')) return send(415, { error: 'Explicit JSON request required' })
        const input = await readJson(request, 1024)
        const seconds = Number(input.seconds)
        if (!Number.isInteger(seconds) || seconds < 1 || seconds > 30) return send(400, { error: 'seconds must be an integer from 1 to 30' })
        if (busy) return send(409, { error: 'A sample is already running' })
        busy = true
        try {
          const src = await getSource()
          const before = await src.serverStatus()
          await sleep(seconds * 1000)
          const after = await src.serverStatus()
          return send(200, { before, after, seconds })
        } finally {
          busy = false
        }
      }
      if (url.pathname.startsWith('/api/') || request.method !== 'GET') return send(404, { error: 'Not found' })
      const root = await realpath(distRoot)
      const file = await realpath(resolve(root, `.${decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname)}`))
      if (!file.startsWith(root + sep) || !MIME[extname(file)]) return send(404, { error: 'Not found' })
      response.writeHead(200, {
        'Content-Type': MIME[extname(file)],
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': "frame-ancestors 'none'; object-src 'none'; base-uri 'none'",
      })
      response.end(await readFile(file))
    } catch (error) {
      if (!response.headersSent) send(error.code === 'ENOENT' ? 404 : 502, { error: error.code === 'ENOENT' ? 'Asset missing; build the site first' : String(error.message).slice(0, 240) })
      else response.end()
    }
  })
  server.on('close', () => { source?.close?.().catch(() => {}) })
  return server
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.RUNTIME_PORT ?? 4318)
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('RUNTIME_PORT must be 1024-65535')
  const mongoUrl = loopbackOrAllowed(process.env.MONGO_URL ?? DEFAULT_MONGO_URL)
  const server = createRuntimeServer({
    statusSource: () => driverStatusSource(mongoUrl),
    allowedOrigins: process.env.RUNTIME_ORIGIN ? [new URL(process.env.RUNTIME_ORIGIN).origin] : [],
  })
  server.listen(port, '127.0.0.1', () => console.log(`Measured-server dashboard: http://127.0.0.1:${port}  (MongoDB at ${mongoUrl.replace(/\/\/[^@]*@/, '//***@')})`))
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => server.close())
}
