import type { Vector3 } from 'three'

/** Illustrative deployment shapes. They scale the ops ceiling and the latency floor, and add real nodes to the city. */
export type Topology = 'standalone' | 'replica-set' | 'sharded'
export type WorkloadId = 'oltp' | 'analytics' | 'vector-rag' | 'timeseries' | 'idle'

/**
 * Districts, west to east along the request path: applications and agents,
 * the connection and auth gates, the query pipeline, the WiredTiger cache
 * (documents and index pages together), then the oplog and the secondaries.
 * Disk sits under the cache, mongot above it, and mongos only appears when
 * the topology is sharded.
 */
export type DistrictId = 'clients' | 'gateway' | 'mongos' | 'query' | 'cache' | 'disk' | 'replication' | 'mongot'

export interface WorkloadDef {
  id: WorkloadId
  label: string
}

export interface TopologyDef {
  id: Topology
  label: string
}

export interface SimState {
  t: number
  workload: WorkloadId
  topology: Topology
  /** Illustrative operations per second served. */
  opsPerSec: number
  /** Illustrative p99 latency in milliseconds. */
  p99Ms: number
  /** 0..1 fraction of reads served from the WiredTiger cache. */
  cacheHit: number
  /** Illustrative open client connections. */
  connections: number
  /** Pipeline stages the current workload typically runs (1..8). */
  stages: number
  util: { query: number; index: number; storage: number; repl: number }
  /** 0..1 share of the WiredTiger cache holding pages. */
  cacheOccupancy: number
  /** 0..1 share of the cache that is dirty (modified, not yet checkpointed). */
  dirtyFraction: number
  /** Documents in flight through the engine this instant. */
  docsInFlight: number
  paused: boolean
}

export interface WorkloadProfile {
  query: number
  index: number
  storage: number
  repl: number
  /** Target cache occupancy, 0..1. */
  cache: number
  /** Target dirty share of the cache, 0..1. */
  dirty: number
  /** 0..1 scale on the topology's ops ceiling. */
  opsScale: number
  /** Nominal cache hit rate before eviction pressure, 0..1. */
  hitRate: number
  /** Baseline documents in flight for this workload. */
  docs: number
  /** Baseline open connections for this workload. */
  connections: number
  /** Typical number of query/aggregation stages, 1..8. */
  stages: number
}

/**
 * The WiredTiger memory model. The four eviction thresholds are WiredTiger's
 * documented defaults; the cache and per-operation sizes are illustrative.
 */
export interface MemoryModel {
  cacheGB: number
  perOpLimitGB: number
  evictionTarget: number
  evictionTrigger: number
  dirtyTarget: number
  dirtyTrigger: number
}

/**
 * The tunable, ILLUSTRATIVE figures behind the model. Defaults live in
 * DEFAULT_SIM_CONFIG (src/sim/model.ts) and match docs/verification.md; the
 * settings drawer edits copies of these, it does not change the defaults.
 */
export interface SimConfig {
  opsCeil: Record<Topology, number>
  latencyBase: Record<Topology, number>
  workloads: Record<WorkloadId, WorkloadProfile>
  memory: MemoryModel
  /** Illustrative list of enabled 9.0 feature toggles — display/config only. */
  enabledFeatures: string[]
}

export interface SimConfigPatch {
  opsCeil?: Partial<Record<Topology, number>>
  latencyBase?: Partial<Record<Topology, number>>
  workloads?: Partial<Record<WorkloadId, Partial<WorkloadProfile>>>
  memory?: Partial<MemoryModel>
  enabledFeatures?: string[]
}

export interface Sim {
  readonly state: SimState
  update(dt: number): void
  setWorkload(id: WorkloadId): void
  setTopology(topology: Topology): void
  togglePause(): void
  reset(): void
  /** Apply an illustrative-figure change live. */
  configure(patch: SimConfigPatch): void
  /** A copy of the current figures, for populating the settings UI. */
  getConfig(): SimConfig
}

export interface DistrictDef {
  id: DistrictId
  name: string
  subtitle: string
  color: number
  pos: Vector3
  blurb: string
  readout(state: SimState): string
  /** Districts that only exist in some topologies (mongos). */
  visibleIn?: Topology[]
}
