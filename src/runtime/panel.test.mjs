import assert from 'node:assert/strict'
import test from 'node:test'
import { createMeasurePanel } from './panel.ts'
import { installDom } from '../../tests/helpers/dom.mjs'

const STATUS = { version: '9.0.2', host: 'h', uptime: 10, opcounters: { query: 100 }, repl: { setName: 'rs0' } }
const flush = () => new Promise((done) => setTimeout(done, 0))

function fixture(context, responder) {
  const environment = installDom({ html: '<div id="hud"></div>' })
  context.after(environment.cleanup)
  const calls = []
  const fetchImpl = async (url, init) => {
    calls.push({ url: String(url), init })
    const result = responder(String(url), init)
    return { ok: result.ok ?? true, status: result.status ?? 200, json: async () => result.body }
  }
  const panel = createMeasurePanel(environment.document.getElementById('hud'), fetchImpl)
  const q = (selector) => panel.querySelector(selector)
  return { environment, panel, calls, q, buttons: panel.querySelectorAll('button'), status: q('output') }
}

test('panel renders collapsed with a loopback endpoint and sample disabled until connected', (context) => {
  const { panel, buttons, status } = fixture(context, () => ({ body: {} }))
  assert.equal(panel.tagName, 'DETAILS')
  assert.equal(panel.querySelector('summary').textContent, 'Measured server')
  assert.equal(buttons[0].textContent, 'Connect')
  assert.equal(buttons[1].disabled, true)
  assert.equal(status.textContent, 'Not connected')
})

test('connect reads status, sample measures a rate, and both report through the status line', async (context) => {
  let n = 0
  const { buttons, status, calls } = fixture(context, (url) => {
    if (url.endsWith('/api/mongo/status')) return { body: { status: STATUS } }
    n++
    return { body: { before: STATUS, after: { ...STATUS, uptime: 15, opcounters: { query: 600 } }, seconds: 5 } }
  })
  buttons[0].click()
  await flush()
  await flush()
  assert.equal(status.textContent, 'MongoDB 9.0.2 · replica-set')
  assert.equal(buttons[1].disabled, false)
  buttons[1].click()
  await flush()
  await flush()
  assert.equal(status.textContent, 'MongoDB 9.0.2 · replica-set | 100.0 ops/s over 5s')
  assert.equal(n, 1)
  assert.equal(calls[1].init.method, 'POST')
  assert.equal(calls[1].init.headers['X-SimCity-Request'], '1')
  assert.deepEqual(JSON.parse(calls[1].init.body), { seconds: 5 })
})

test('service errors and non-loopback endpoints are reported without throwing', async (context) => {
  const { buttons, status, q } = fixture(context, () => ({ ok: false, status: 502, body: { error: 'connect ECONNREFUSED' } }))
  buttons[0].click()
  await flush()
  await flush()
  assert.equal(status.textContent, 'connect ECONNREFUSED')
  const endpoint = q('input[type="url"]')
  endpoint.value = 'http://example.com/'
  endpoint.dispatchEvent(new endpoint.ownerDocument.defaultView.Event('input', { bubbles: true }))
  buttons[0].click()
  await flush()
  await flush()
  assert.equal(status.textContent, 'Use a loopback HTTP(S) service origin')
  assert.equal(buttons[1].disabled, true)
})
