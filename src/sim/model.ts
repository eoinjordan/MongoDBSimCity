import type {
  Sim,
  SimConfig,
  SimConfigPatch,
  SimState,
  Topology,
  TopologyDef,
  WorkloadDef,
  WorkloadId,
} from '../core/types.ts'
import { approach, clamp01, makeRng } from '../core/util.ts'
import { evictionPressure, WIREDTIGER_DEFAULTS } from './wiredtiger.ts'

/**
 * A small behavioural model of a MongoDB 9.0 server under load.
 *
 * Everything here is ILLUSTRATIVE and scaled for legibility. The goal is that
 * switching workload or topology produces a believable, readable change across
 * the districts and dataflow — not that any figure matches a benchmark.
 */

export const WORKLOADS: WorkloadDef[] = [
  { id: 'oltp', label: 'OLTP · transactions' },
  { id: 'analytics', label: 'Analytics · aggregation' },
  { id: 'vector-rag', label: 'Vector search · agent RAG' },
  { id: 'timeseries', label: 'Time series · ingest' },
  { id: 'idle', label: 'Idle' },
]

export const TOPOLOGIES: TopologyDef[] = [
  { id: 'standalone', label: 'Standalone' },
  { id: 'replica-set', label: 'Replica set (3)' },
  { id: 'sharded', label: 'Sharded (3 × 3)' },
]

export const TOPOLOGY_IDS: Topology[] = TOPOLOGIES.map((t) => t.id)

/** 9.0 feature toggles the settings drawer can tick. Display/config only. */
export const FEATURE_CHOICES: { id: string; label: string }[] = [
  { id: 'queryStats', label: '$queryStats sampling on by default (1%)' },
  { id: 'wasmJs', label: 'Server-side JavaScript on the WASM engine' },
  { id: 'constraintValidation', label: 'Schema validation level: constraint' },
  { id: 'qeSubstring', label: 'Queryable Encryption prefix / suffix / substring' },
  { id: 'perOpMemoryLimit', label: 'Per-operation memory limit' },
  { id: 'queryKnobs', label: 'Per-shape query knobs and maxTimeMS' },
  { id: 'workloadManagement', label: 'Intelligent workload management' },
  { id: 'openTelemetry', label: 'OpenTelemetry export' },
]

/**
 * The reviewed, ILLUSTRATIVE figures the model runs on. These are the defaults;
 * the settings drawer tunes a live copy, but leaving them alone reproduces the
 * values documented in docs/verification.md exactly.
 */
export const DEFAULT_SIM_CONFIG: SimConfig = {
  opsCeil: { standalone: 24_000, 'replica-set': 20_000, sharded: 60_000 },
  latencyBase: { standalone: 0.9, 'replica-set': 2.2, sharded: 3.4 },
  workloads: {
    oltp: { query: 0.55, index: 0.7, storage: 0.6, repl: 0.75, cache: 0.62, dirty: 0.12, opsScale: 1, hitRate: 0.97, docs: 1200, connections: 240, stages: 2 },
    analytics: { query: 0.9, index: 0.45, storage: 0.85, repl: 0.15, cache: 0.88, dirty: 0.04, opsScale: 0.18, hitRate: 0.72, docs: 2000, connections: 24, stages: 7 },
    'vector-rag': { query: 0.6, index: 0.8, storage: 0.5, repl: 0.2, cache: 0.7, dirty: 0.03, opsScale: 0.25, hitRate: 0.9, docs: 600, connections: 60, stages: 4 },
    timeseries: { query: 0.3, index: 0.35, storage: 0.8, repl: 0.7, cache: 0.55, dirty: 0.25, opsScale: 0.9, hitRate: 0.95, docs: 1600, connections: 400, stages: 1 },
    idle: { query: 0.04, index: 0.03, storage: 0.05, repl: 0.08, cache: 0.3, dirty: 0.01, opsScale: 0.01, hitRate: 0.99, docs: 20, connections: 4, stages: 1 },
  },
  memory: { cacheGB: 4, perOpLimitGB: 1, ...WIREDTIGER_DEFAULTS },
  enabledFeatures: ['queryStats', 'wasmJs', 'qeSubstring', 'perOpMemoryLimit', 'queryKnobs'],
}

function cloneConfig(c: SimConfig): SimConfig {
  return {
    opsCeil: { ...c.opsCeil },
    latencyBase: { ...c.latencyBase },
    workloads: {
      oltp: { ...c.workloads.oltp },
      analytics: { ...c.workloads.analytics },
      'vector-rag': { ...c.workloads['vector-rag'] },
      timeseries: { ...c.workloads.timeseries },
      idle: { ...c.workloads.idle },
    },
    memory: { ...c.memory },
    enabledFeatures: [...c.enabledFeatures],
  }
}

function applyConfigPatch(c: SimConfig, patch: SimConfigPatch): void {
  if (patch.opsCeil) Object.assign(c.opsCeil, patch.opsCeil)
  if (patch.latencyBase) Object.assign(c.latencyBase, patch.latencyBase)
  if (patch.memory) Object.assign(c.memory, patch.memory)
  if (patch.enabledFeatures) c.enabledFeatures = [...patch.enabledFeatures]
  if (patch.workloads) {
    for (const id of Object.keys(patch.workloads) as WorkloadId[]) {
      const profile = patch.workloads[id]
      if (profile) Object.assign(c.workloads[id], profile)
    }
  }
}

export function createSim(): Sim {
  let rng = makeRng(0x4d44)
  const config = cloneConfig(DEFAULT_SIM_CONFIG)

  const state: SimState = {
    t: 0,
    workload: 'oltp',
    topology: 'replica-set',
    opsPerSec: 0,
    p99Ms: 0,
    cacheHit: 0,
    connections: 0,
    stages: 2,
    util: { query: 0, index: 0, storage: 0, repl: 0 },
    cacheOccupancy: 0,
    dirtyFraction: 0,
    docsInFlight: 0,
    paused: false,
  }

  /** Small, bounded per-district liveliness so bars never sit dead flat. */
  function jitter(base: number, phase: number): number {
    const wobble = 0.05 * Math.sin(state.t * 1.7 + phase) + (rng() - 0.5) * 0.02
    return clamp01(base + base * wobble)
  }

  function refreshMetrics(): void {
    const w = config.workloads[state.workload]
    const m = config.memory
    const pressure = evictionPressure(clamp01(state.cacheOccupancy), m)
    state.opsPerSec = config.opsCeil[state.topology] * w.opsScale * state.util.query
    state.cacheHit = clamp01(w.hitRate * (1 - 0.3 * pressure))
    state.p99Ms = config.latencyBase[state.topology] * (1 + 2 * state.util.query + 3 * pressure)
    state.connections = Math.round(w.connections * (0.5 + 0.5 * state.util.query))
    state.stages = w.stages
  }

  function update(dt: number): void {
    if (state.paused || !Number.isFinite(dt) || dt <= 0) return
    dt = Math.min(dt, 0.1)
    state.t += dt

    const tgt = config.workloads[state.workload]
    const rate = 2.2 // how fast utilisation chases its target
    state.util.query = approach(state.util.query, jitter(tgt.query, 0.4), rate, dt)
    state.util.index = approach(state.util.index, jitter(tgt.index, 1.9), rate, dt)
    state.util.storage = approach(state.util.storage, jitter(tgt.storage, 3.1), rate, dt)
    state.util.repl = approach(state.util.repl, jitter(tgt.repl, 2.6), rate, dt)
    state.cacheOccupancy = approach(state.cacheOccupancy, jitter(tgt.cache, 2.4), rate, dt)
    state.dirtyFraction = approach(state.dirtyFraction, jitter(tgt.dirty, 0.9), rate, dt)
    state.docsInFlight = approach(state.docsInFlight, tgt.docs, 1.6, dt)

    refreshMetrics()
  }

  return {
    state,
    update,
    setWorkload(id: WorkloadId) {
      state.workload = id
      refreshMetrics()
    },
    setTopology(topology: Topology) {
      state.topology = topology
      refreshMetrics()
    },
    togglePause() {
      state.paused = !state.paused
    },
    configure(patch) {
      applyConfigPatch(config, patch)
      refreshMetrics()
    },
    getConfig() {
      return cloneConfig(config)
    },
    reset() {
      rng = makeRng(0x4d44)
      state.t = 0
      state.workload = 'oltp'
      state.topology = 'replica-set'
      state.opsPerSec = 0
      state.p99Ms = 0
      state.cacheHit = 0
      state.connections = 0
      state.stages = 2
      state.util.query = state.util.index = state.util.storage = state.util.repl = 0
      state.cacheOccupancy = 0
      state.dirtyFraction = 0
      state.docsInFlight = 0
      state.paused = false
    },
  }
}
