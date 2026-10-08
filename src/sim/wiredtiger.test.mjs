import assert from 'node:assert/strict'
import test from 'node:test'
import {
  applicationThreadsEvict,
  defaultCacheSizeGB,
  dirtyPressure,
  evictionPressure,
  MAX_CONCURRENT_MULTI_DOCUMENT_TRANSACTIONS,
  perOperationMemoryLimitBytes,
  validateThresholds,
  WIREDTIGER_DEFAULTS,
} from './wiredtiger.ts'

const GiB = 1024 ** 3

test('the defaults are WiredTiger’s documented eviction thresholds', () => {
  assert.deepEqual(WIREDTIGER_DEFAULTS, { evictionTarget: 0.8, evictionTrigger: 0.95, dirtyTarget: 0.05, dirtyTrigger: 0.2 })
  assert.equal(MAX_CONCURRENT_MULTI_DOCUMENT_TRANSACTIONS, 10_000)
})

test('eviction pressure is 0 at the target, 1 at the trigger, and linear between (docs/verification.md)', () => {
  assert.equal(evictionPressure(0), 0)
  assert.equal(evictionPressure(0.8), 0)
  assert.ok(Math.abs(evictionPressure(0.875) - 0.5) < 1e-12)
  assert.ok(Math.abs(evictionPressure(0.92) - 0.8) < 1e-12)
  assert.equal(evictionPressure(0.95), 1)
  assert.equal(evictionPressure(1), 1)
})

test('dirty pressure uses the dirty thresholds', () => {
  assert.equal(dirtyPressure(0.05), 0)
  assert.ok(Math.abs(dirtyPressure(0.125) - 0.5) < 1e-12)
  assert.equal(dirtyPressure(0.2), 1)
  assert.equal(dirtyPressure(0.35), 1)
})

test('application threads evict past either trigger and not before', () => {
  assert.equal(applicationThreadsEvict(0.9, 0.1), false)
  assert.equal(applicationThreadsEvict(0.95, 0.0), true)
  assert.equal(applicationThreadsEvict(0.5, 0.2), true)
  assert.equal(applicationThreadsEvict(0.949, 0.199), false)
})

test('custom thresholds must be ordered fractions', () => {
  assert.throws(() => validateThresholds({ evictionTarget: 0.9, evictionTrigger: 0.8, dirtyTarget: 0.05, dirtyTrigger: 0.2 }), RangeError)
  assert.throws(() => validateThresholds({ evictionTarget: 0.8, evictionTrigger: 0.95, dirtyTarget: 0.2, dirtyTrigger: 0.2 }), RangeError)
  assert.throws(() => validateThresholds({ evictionTarget: -0.1, evictionTrigger: 0.95, dirtyTarget: 0.05, dirtyTrigger: 0.2 }), RangeError)
  assert.throws(() => evictionPressure(1.5), RangeError)
  assert.throws(() => evictionPressure(NaN), RangeError)
  const custom = { evictionTarget: 0.5, evictionTrigger: 0.75, dirtyTarget: 0.1, dirtyTrigger: 0.3 }
  assert.equal(evictionPressure(0.625, custom), 0.5)
})

test('default cache size is max(256 MB, 50% of RAM minus 1 GB)', () => {
  assert.equal(defaultCacheSizeGB(1), 0.25)
  assert.equal(defaultCacheSizeGB(1.5), 0.25)
  assert.equal(defaultCacheSizeGB(4), 1.5)
  assert.equal(defaultCacheSizeGB(8), 3.5)
  assert.equal(defaultCacheSizeGB(64), 31.5)
  assert.throws(() => defaultCacheSizeGB(-1), RangeError)
  assert.throws(() => defaultCacheSizeGB(Infinity), RangeError)
})

test('9.0 per-operation memory limit is max(1 GB, 20% of available memory)', () => {
  assert.equal(perOperationMemoryLimitBytes(0), GiB)
  assert.equal(perOperationMemoryLimitBytes(4 * GiB), GiB)
  assert.equal(perOperationMemoryLimitBytes(5 * GiB), GiB)
  assert.equal(perOperationMemoryLimitBytes(10 * GiB), 2 * GiB)
  assert.equal(perOperationMemoryLimitBytes(64 * GiB), Math.floor(12.8 * GiB))
  assert.throws(() => perOperationMemoryLimitBytes(-1), RangeError)
  assert.throws(() => perOperationMemoryLimitBytes(1.5), RangeError)
})
