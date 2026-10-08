import assert from 'node:assert/strict'
import test from 'node:test'
import { createSim, DEFAULT_SIM_CONFIG, FEATURE_CHOICES, TOPOLOGY_IDS, WORKLOADS } from './model.ts'
import { createClock } from './clock.ts'

function advance(sim, steps = 180) {
  for (let step = 0; step < steps; step++) sim.update(1 / 60)
}

test('reset restores every field and the deterministic random sequence', () => {
  const sim = createSim()
  const initial = structuredClone(sim.state)
  advance(sim)
  const firstRun = structuredClone(sim.state)
  sim.setWorkload('analytics')
  sim.setTopology('sharded')
  sim.togglePause()
  sim.reset()
  assert.deepEqual(sim.state, initial)
  advance(sim)
  assert.deepEqual(sim.state, firstRun)
})

test('pause freezes time and all simulated values', () => {
  const sim = createSim()
  advance(sim)
  sim.togglePause()
  const paused = structuredClone(sim.state)
  advance(sim)
  assert.deepEqual(sim.state, paused)
  sim.togglePause()
  sim.update(1 / 60)
  assert.ok(sim.state.t > paused.t)
})

test('invalid deltas cannot corrupt the model and long gaps are bounded', () => {
  const sim = createSim()
  const initial = structuredClone(sim.state)
  for (const delta of [0, -1, NaN, Infinity, -Infinity]) sim.update(delta)
  assert.deepEqual(sim.state, initial)
  sim.update(600)
  assert.equal(sim.state.t, 0.1)
})

test('topology changes refresh metrics even while paused', () => {
  const sim = createSim()
  advance(sim)
  sim.togglePause()
  const query = sim.state.util.query
  sim.setTopology('sharded')
  assert.equal(sim.state.opsPerSec, 60_000 * 1 * query)
  assert.equal(sim.state.util.query, query)
  sim.setTopology('standalone')
  assert.equal(sim.state.opsPerSec, 24_000 * query)
})

test('idle serves almost nothing and every topology scales the ops ceiling consistently', () => {
  const sim = createSim()
  advance(sim)
  assert.ok(sim.state.opsPerSec > 1000)
  sim.setWorkload('idle')
  advance(sim, 600)
  assert.ok(sim.state.opsPerSec < 50)
  sim.setWorkload('oltp')
  advance(sim, 600)
  sim.togglePause()
  const query = sim.state.util.query
  for (const topology of TOPOLOGY_IDS) {
    sim.setTopology(topology)
    assert.equal(sim.state.opsPerSec, DEFAULT_SIM_CONFIG.opsCeil[topology] * query)
  }
})

test('all workload and topology combinations remain finite and bounded', () => {
  for (const workload of WORKLOADS) {
    for (const topology of TOPOLOGY_IDS) {
      const sim = createSim()
      sim.setWorkload(workload.id)
      sim.setTopology(topology)
      advance(sim, 600)
      for (const value of [...Object.values(sim.state.util), sim.state.cacheOccupancy, sim.state.dirtyFraction, sim.state.cacheHit]) {
        assert.ok(Number.isFinite(value) && value >= 0 && value <= 1)
      }
      for (const value of [sim.state.opsPerSec, sim.state.p99Ms, sim.state.docsInFlight, sim.state.connections]) {
        assert.ok(Number.isFinite(value) && value >= 0)
      }
      assert.ok(sim.state.p99Ms <= 3.4 * 6)
      assert.ok(Number.isInteger(sim.state.stages) && sim.state.stages >= 1 && sim.state.stages <= 8)
    }
  }
})

test('cache pressure costs latency and hit rate: analytics runs the cache past the 80% target', () => {
  const oltp = createSim()
  oltp.setWorkload('oltp')
  advance(oltp, 900)
  const analytics = createSim()
  analytics.setWorkload('analytics')
  advance(analytics, 900)
  assert.ok(analytics.state.cacheOccupancy > 0.8)
  assert.ok(oltp.state.cacheOccupancy < 0.8)
  assert.ok(analytics.state.cacheHit < oltp.state.cacheHit)
  assert.ok(analytics.state.p99Ms > oltp.state.p99Ms)
})

test('30, 60, and 144 Hz rendering produce identical simulation states', () => {
  const results = [30, 60, 144].map((refreshRate) => {
    const sim = createSim()
    const clock = createClock(sim.update)
    for (let frame = 0; frame <= refreshRate * 3; frame++) {
      clock.advance(frame * 1000 / refreshRate)
    }
    return structuredClone(sim.state)
  })
  assert.deepEqual(results[0], results[1])
  assert.deepEqual(results[1], results[2])
})

test('the clock discards paused time and bounds background-tab catch-up', () => {
  const sim = createSim()
  const clock = createClock(sim.update)
  clock.advance(0)
  clock.advance(1000 / 60)
  const beforePause = sim.state.t
  clock.advance(60_000, false)
  assert.equal(sim.state.t, beforePause)
  clock.reset()
  clock.advance(120_000)
  assert.equal(sim.state.t, beforePause)
  clock.advance(180_000)
  assert.ok(sim.state.t - beforePause <= 0.1 + 1e-9)
})

test('clock rejects non-finite timestamps and reset drops fractional accumulated time', () => {
  const sim = createSim()
  const clock = createClock(sim.update)
  for (const timestamp of [NaN, Infinity, -Infinity]) assert.equal(clock.advance(timestamp), false)
  assert.equal(clock.advance(0), false)
  assert.equal(clock.advance(10), false)
  clock.reset()
  assert.equal(clock.advance(1000), false)
  assert.equal(clock.advance(1010), false)
  assert.equal(sim.state.t, 0)
  assert.equal(clock.advance(1017), true)
  assert.equal(sim.state.t, 1 / 60)
})

test('configure edits a live copy, getConfig returns copies, and defaults can be restored', () => {
  const sim = createSim()
  advance(sim)
  sim.togglePause()
  const query = sim.state.util.query
  sim.configure({ opsCeil: { 'replica-set': 1000 } })
  assert.equal(sim.state.opsPerSec, 1000 * query)
  const copy = sim.getConfig()
  copy.opsCeil['replica-set'] = 5
  assert.equal(sim.getConfig().opsCeil['replica-set'], 1000)
  sim.configure({ enabledFeatures: ['wasmJs'] })
  assert.deepEqual(sim.getConfig().enabledFeatures, ['wasmJs'])
  assert.ok(FEATURE_CHOICES.every((f) => typeof f.id === 'string' && f.label.length > 0))
  sim.configure(DEFAULT_SIM_CONFIG)
  assert.deepEqual(sim.getConfig(), DEFAULT_SIM_CONFIG)
  assert.equal(sim.state.opsPerSec, 20_000 * query)
})

test('idle reduces modeled load and reset preserves state-object identity', () => {
  const sim = createSim()
  const state = sim.state
  const utilization = state.util
  advance(sim, 300)
  const busy = structuredClone(state)
  sim.setWorkload('idle')
  advance(sim, 300)
  assert.ok(state.opsPerSec < busy.opsPerSec)
  assert.ok(state.p99Ms < busy.p99Ms)
  assert.ok(state.cacheOccupancy < busy.cacheOccupancy)
  sim.reset()
  assert.equal(sim.state, state)
  assert.equal(sim.state.util, utilization)
})
