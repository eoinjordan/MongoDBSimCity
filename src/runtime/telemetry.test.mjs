import assert from 'node:assert/strict'
import test from 'node:test'
import { describe, measureRate, normalizeSnapshot } from './telemetry.ts'

const status = (overrides = {}) => ({
  version: '9.0.2',
  host: 'rubikpi3',
  process: 'mongod',
  uptime: 120,
  opcounters: { insert: 10, query: 20, update: 5, delete: 1, getmore: 2, command: 62 },
  wiredTiger: { cache: { 'maximum bytes configured': 1000, 'bytes currently in the cache': 610, 'tracked dirty bytes in the cache': 50 } },
  connections: { current: 7 },
  repl: { setName: 'rs0' },
  ...overrides,
})

test('normalizeSnapshot reads version, topology, counters, cache use and connections', () => {
  const s = normalizeSnapshot(status())
  assert.deepEqual(s, {
    version: '9.0.2', host: 'rubikpi3', uptimeSeconds: 120, topology: 'replica-set', opsTotal: 100,
    cacheUsed: 0.61, cacheDirty: 0.05, connections: 7,
  })
})

test('normalizeSnapshot classifies standalone, mongos and unknown deployments', () => {
  assert.equal(normalizeSnapshot(status({ repl: undefined })).topology, 'standalone')
  assert.equal(normalizeSnapshot(status({ repl: {} })).topology, 'standalone')
  assert.equal(normalizeSnapshot(status({ process: 'mongos', repl: undefined })).topology, 'sharded')
  assert.equal(normalizeSnapshot(status({ repl: { hosts: [] } })).topology, 'unknown')
})

test('normalizeSnapshot tolerates missing sections and Long-ish numbers', () => {
  const s = normalizeSnapshot({ version: '9.0.2', host: 'h', opcounters: { insert: { low: 5, high: 0 }, query: { $numberLong: '7' } } })
  assert.equal(s.opsTotal, 12)
  assert.equal(s.cacheUsed, null)
  assert.equal(s.cacheDirty, null)
  assert.equal(s.connections, null)
  assert.equal(s.uptimeSeconds, 0)
  assert.throws(() => normalizeSnapshot({}), /missing version or host/)
  assert.throws(() => normalizeSnapshot(null), /missing version or host/)
})

test('measureRate divides the counter delta by the sample length and rejects restarts', () => {
  const before = normalizeSnapshot(status())
  const after = normalizeSnapshot(status({ uptime: 125, opcounters: { insert: 10, query: 520, update: 5, delete: 1, getmore: 2, command: 62 } }))
  assert.deepEqual(measureRate(before, after, 5), { opsPerSecond: 100, seconds: 5 })
  assert.throws(() => measureRate(after, before, 5), /backwards/)
  assert.throws(() => measureRate(before, after, 0), RangeError)
})

test('describe renders a compact status line', () => {
  const s = normalizeSnapshot(status())
  assert.equal(describe(s), 'MongoDB 9.0.2 · replica-set | cache 61% used, 5% dirty | 7 connections')
  assert.equal(describe(s, { opsPerSecond: 12.345, seconds: 5 }), 'MongoDB 9.0.2 · replica-set | 12.3 ops/s over 5s | cache 61% used, 5% dirty | 7 connections')
  assert.equal(describe(normalizeSnapshot({ version: '9.0.2', host: 'h' })), 'MongoDB 9.0.2 · standalone')
})
