/**
 * Pure helpers that turn a real `serverStatus` document into the few numbers
 * the measurement panel shows. Nothing here touches the network; the local
 * service in tools/runtime-server.mjs does that and feeds the raw document in.
 */
export type MeasuredTopology = 'standalone' | 'replica-set' | 'sharded' | 'unknown'

export interface ServerSnapshot {
  version: string
  host: string
  uptimeSeconds: number
  topology: MeasuredTopology
  /** Sum of opcounters at the moment of the snapshot. */
  opsTotal: number
  /** 0..1 share of the configured WiredTiger cache in use, or null if not reported. */
  cacheUsed: number | null
  /** 0..1 dirty share of the configured cache, or null if not reported. */
  cacheDirty: number | null
  /** Connections currently open, or null if not reported. */
  connections: number | null
}

export interface RateSample {
  opsPerSecond: number
  seconds: number
}

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

function finite(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) && value >= 0 ? value : null
  if (typeof value === 'bigint') return Number(value)
  // The driver may hand back {low, high} Long objects or {$numberLong} EJSON.
  const r = record(value)
  if (typeof r.$numberLong === 'string') return finite(Number(r.$numberLong))
  if (typeof r.low === 'number' && typeof r.high === 'number') return r.high * 4294967296 + (r.low >>> 0)
  return null
}

export function normalizeSnapshot(payload: unknown): ServerSnapshot {
  const data = record(payload)
  const version = typeof data.version === 'string' ? data.version : ''
  const host = typeof data.host === 'string' ? data.host : ''
  if (!version || !host) throw new Error('serverStatus is missing version or host')
  const uptime = finite(data.uptime)
  const op = record(data.opcounters)
  const opsTotal = ['insert', 'query', 'update', 'delete', 'getmore', 'command']
    .map((k) => finite(op[k]) ?? 0)
    .reduce((a, b) => a + b, 0)
  const wt = record(data.wiredTiger)
  const cache = record(wt.cache)
  const max = finite(cache['maximum bytes configured'])
  const used = finite(cache['bytes currently in the cache'])
  const dirty = finite(cache['tracked dirty bytes in the cache'])
  const repl = record(data.repl)
  const process = typeof data.process === 'string' ? data.process : 'mongod'
  const topology: MeasuredTopology = process === 'mongos'
    ? 'sharded'
    : typeof repl.setName === 'string' && repl.setName
      ? 'replica-set'
      : data.repl === undefined || Object.keys(repl).length === 0
        ? 'standalone'
        : 'unknown'
  const conns = record(data.connections)
  return {
    version,
    host,
    uptimeSeconds: uptime ?? 0,
    topology,
    opsTotal,
    cacheUsed: max && used !== null ? Math.min(1, used / max) : null,
    cacheDirty: max && dirty !== null ? Math.min(1, dirty / max) : null,
    connections: finite(conns.current),
  }
}

/** Ops per second between two snapshots taken `seconds` apart. */
export function measureRate(before: ServerSnapshot, after: ServerSnapshot, seconds: number): RateSample {
  if (!Number.isFinite(seconds) || seconds <= 0) throw new RangeError('Sample length must be a positive number of seconds')
  if (after.opsTotal < before.opsTotal || after.uptimeSeconds < before.uptimeSeconds) {
    throw new Error('Counters went backwards; the server restarted during the sample')
  }
  return { opsPerSecond: (after.opsTotal - before.opsTotal) / seconds, seconds }
}

export function describe(s: ServerSnapshot, rate?: RateSample): string {
  const parts = [`MongoDB ${s.version} · ${s.topology}`]
  if (rate) parts.push(`${rate.opsPerSecond.toFixed(1)} ops/s over ${rate.seconds}s`)
  if (s.cacheUsed !== null) parts.push(`cache ${Math.round(s.cacheUsed * 100)}% used${s.cacheDirty !== null ? `, ${Math.round(s.cacheDirty * 100)}% dirty` : ''}`)
  if (s.connections !== null) parts.push(`${s.connections} connections`)
  return parts.join(' | ')
}
