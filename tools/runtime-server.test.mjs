import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { request } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRuntimeServer, loopbackOrAllowed } from './runtime-server.mjs'

function fakeSource(docs) {
  let calls = 0
  let closed = 0
  return {
    factory: async () => ({
      async serverStatus() { return docs[Math.min(calls++, docs.length - 1)] },
      async close() { closed++ },
    }),
    get calls() { return calls },
    get closed() { return closed },
  }
}

async function listen(server) {
  await new Promise((done) => server.listen(0, '127.0.0.1', done))
  const { port } = server.address()
  return { port, origin: `http://127.0.0.1:${port}`, close: () => new Promise((done) => server.close(done)) }
}

const DOC = { version: '9.0.2', host: 'h', opcounters: { query: 1 } }

test('status endpoint returns serverStatus from the injected source and rejects foreign hosts', async (context) => {
  const dist = await mkdtemp(join(tmpdir(), 'simcity-'))
  await writeFile(join(dist, 'index.html'), '<!doctype html><title>x</title>')
  const source = fakeSource([DOC])
  const server = createRuntimeServer({ statusSource: source.factory, distRoot: dist })
  const { origin, port, close } = await listen(server)
  context.after(close)
  const ok = await fetch(`${origin}/api/mongo/status`)
  assert.equal(ok.status, 200)
  assert.deepEqual(await ok.json(), { status: DOC })
  const page = await fetch(`${origin}/`)
  assert.equal(page.status, 200)
  assert.equal(page.headers.get('content-type'), 'text/html')
  // fetch() refuses to send a forged Host header, so use a raw request for this one.
  const foreignStatus = await new Promise((done, fail) => {
    const req = request({ host: '127.0.0.1', port, path: '/api/mongo/status', headers: { host: `evil.example:${port}` } }, (res) => { res.resume(); done(res.statusCode) })
    req.on('error', fail)
    req.end()
  })
  assert.equal(foreignStatus, 403)
  const badOrigin = await fetch(`${origin}/api/mongo/status`, { headers: { origin: 'https://evil.example' } })
  assert.equal(badOrigin.status, 403)
  assert.equal((await fetch(`${origin}/api/nope`)).status, 404)
  assert.equal((await fetch(`${origin}/../package.json`)).status, 404)
})

test('sample endpoint takes two snapshots a configurable gap apart and serialises concurrent samples', async (context) => {
  const source = fakeSource([{ ...DOC, uptime: 1 }, { ...DOC, uptime: 3, opcounters: { query: 11 } }])
  const sleeps = []
  const server = createRuntimeServer({ statusSource: source.factory, sleep: async (ms) => { sleeps.push(ms) } })
  const { origin, close } = await listen(server)
  context.after(close)
  const headers = { 'Content-Type': 'application/json', 'X-SimCity-Request': '1' }
  const noHeader = await fetch(`${origin}/api/mongo/sample`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"seconds":2}' })
  assert.equal(noHeader.status, 415)
  const bad = await fetch(`${origin}/api/mongo/sample`, { method: 'POST', headers, body: '{"seconds":99}' })
  assert.equal(bad.status, 400)
  const good = await fetch(`${origin}/api/mongo/sample`, { method: 'POST', headers, body: '{"seconds":2}' })
  assert.equal(good.status, 200)
  const body = await good.json()
  assert.equal(body.seconds, 2)
  assert.equal(body.before.uptime, 1)
  assert.equal(body.after.opcounters.query, 11)
  assert.deepEqual(sleeps, [2000])
  assert.equal(source.calls, 2)
})

test('source failures surface as 502 and the source is closed with the server', async () => {
  const server = createRuntimeServer({ statusSource: async () => { throw new Error('connect ECONNREFUSED') } })
  const { origin, close } = await listen(server)
  const response = await fetch(`${origin}/api/mongo/status`)
  assert.equal(response.status, 502)
  assert.match((await response.json()).error, /ECONNREFUSED/)
  await close()
  assert.throws(() => createRuntimeServer({}), /statusSource/)
})

test('MONGO_URL validation accepts mongodb schemes only', () => {
  assert.equal(loopbackOrAllowed('mongodb://127.0.0.1:27017/?directConnection=true'), 'mongodb://127.0.0.1:27017/?directConnection=true')
  assert.equal(loopbackOrAllowed('mongodb+srv://cluster.example.net/'), 'mongodb+srv://cluster.example.net/')
  assert.throws(() => loopbackOrAllowed('http://127.0.0.1:27017'), /mongodb:\/\//)
})
