import { el } from '../ui/dom'
import { describe, measureRate, normalizeSnapshot, type RateSample, type ServerSnapshot } from './telemetry'

/**
 * "Measured server": an opt-in panel that talks to a local service
 * (tools/runtime-server.mjs) which in turn runs `serverStatus` against a real
 * mongod. It shows the real version, topology, cache use and a sampled ops/s
 * next to the illustrative model, and never pretends one is the other.
 */
export function createMeasurePanel(root: HTMLElement, fetchImpl: typeof fetch = fetch): HTMLElement {
  const status = el('output', { class: 'runtime-status', 'aria-live': 'polite', text: 'Not connected' })
  const endpoint = el('input', { type: 'url', 'aria-label': 'Local measurement service', value: 'http://127.0.0.1:4318' })
  const seconds = el('select', { 'aria-label': 'Sample length' }, [
    el('option', { value: '2', text: '2 s' }),
    el('option', { value: '5', text: '5 s', selected: true }),
    el('option', { value: '10', text: '10 s' }),
  ])
  const connect = el('button', { type: 'button', class: 'btn', text: 'Connect' })
  const run = el('button', { type: 'button', class: 'btn', text: 'Sample ops/s', disabled: true })
  let busy = false
  let last: ServerSnapshot | null = null
  const invalidate = () => { run.disabled = true; last = null; status.textContent = 'Not connected' }
  endpoint.addEventListener('input', invalidate)

  function serviceOrigin(): string {
    const url = new URL(endpoint.value)
    if (!['http:', 'https:'].includes(url.protocol) || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
      || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error('Use a loopback HTTP(S) service origin')
    return url.origin
  }

  async function request(path: string, body?: object) {
    const response = await fetchImpl(`${serviceOrigin()}${path}`, {
      method: body ? 'POST' : 'GET',
      headers: body ? { 'Content-Type': 'application/json', 'X-SimCity-Request': '1' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(35_000),
    })
    const data = await response.json()
    if (!response.ok) throw new Error(data.error || `Service returned HTTP ${response.status}`)
    return data
  }

  async function action(work: () => Promise<void>) {
    if (busy) return
    busy = true
    connect.disabled = run.disabled = endpoint.disabled = seconds.disabled = true
    status.textContent = 'Running...'
    try { await work() } catch (error) { status.textContent = error instanceof Error ? error.message : 'Measurement request failed' }
    finally {
      busy = false
      connect.disabled = endpoint.disabled = seconds.disabled = false
      run.disabled = last === null
    }
  }

  connect.addEventListener('click', () => void action(async () => {
    invalidate()
    const data = await request('/api/mongo/status')
    last = normalizeSnapshot(data.status)
    status.textContent = describe(last)
  }))

  run.addEventListener('click', () => void action(async () => {
    const n = Number(seconds.value)
    const data = await request('/api/mongo/sample', { seconds: n })
    const before = normalizeSnapshot(data.before)
    const after = normalizeSnapshot(data.after)
    const rate: RateSample = measureRate(before, after, n)
    last = after
    status.textContent = describe(after, rate)
  }))

  const panel = el('details', { id: 'runtime-panel', class: 'runtime-panel' }, [
    el('summary', { text: 'Measured server' }),
    el('div', { class: 'runtime-fields' }, [
      el('label', { text: 'Local service' }, [endpoint]),
      el('label', { text: 'Sample' }, [seconds]),
      el('div', { class: 'runtime-actions' }, [connect, run]),
      status,
      el('small', { text: 'Reads serverStatus from a mongod you run. Real numbers; the city above stays illustrative.' }),
    ]),
  ])
  root.append(panel)
  return panel
}
