import * as THREE from 'three'
import { COLOR } from '../core/theme'
import type { DistrictDef } from '../core/types'
import { fmtNum, fmtPct } from '../core/util'

/**
 * Every district, defined once. The 3D world reads `pos`/`color` to place and
 * tint itself; the HUD legend, guided tour and inspector read the copy and the
 * live `readout`. Nothing re-derives a position or a colour anywhere else.
 *
 * Layout (top-down): a request road runs west to east along z = 0. Applications
 * and agents on the far west, then the connection and auth gates, then the query
 * pipeline, then the WiredTiger cache, then the oplog with the secondaries
 * beside it. Disk sits south of the cache (pages are flushed down to it) and
 * mongot sits north of it, fed by change streams. mongos routers only exist in
 * the sharded topology and sit north of the gates, in front of the pipeline.
 */
export const DISTRICTS: DistrictDef[] = [
  {
    id: 'clients',
    name: 'Applications · agents',
    subtitle: 'Drivers, the MCP server, change-stream consumers',
    color: COLOR.clients,
    pos: new THREE.Vector3(-50, 0, 0),
    blurb:
      'Every document starts and ends here. Drivers speak the wire protocol and ' +
      'send BSON; in 9.0 the server validates every object it ingests by default. ' +
      'AI agents arrive the same way, through the MongoDB MCP server or a driver, ' +
      'and the database, not the model, decides what they may read, write and ' +
      'act on. 9.0 caps open multi-document transactions at 10,000 per server.',
    readout: (s) => `${fmtNum(s.connections, 0)} connections · ${s.workload === 'idle' ? 'quiet' : fmtNum(s.opsPerSec, 0) + ' ops/s'}`,
  },
  {
    id: 'gateway',
    name: 'Connection · auth gates',
    subtitle: 'Listener, sessions, authentication, roles, encryption',
    color: COLOR.gateway,
    pos: new THREE.Vector3(-30, 0, 0),
    blurb:
      'Security is not a building, it is a gate on every request. A connection ' +
      'authenticates once; every operation is then checked against the roles and ' +
      'privileges of that identity. Queryable Encryption keeps named fields ' +
      'encrypted through the gate and inside the server; 9.0 makes prefix, suffix ' +
      'and substring queries on those fields generally available and retires the ' +
      'separate mongocryptd process. Audit messages now record the literal TCP peer.',
    readout: (s) => `${fmtNum(s.connections, 0)} sessions · ${fmtNum(s.opsPerSec, 0)} authorised ops/s`,
  },
  {
    id: 'mongos',
    name: 'mongos · config servers',
    subtitle: 'Routers and the sharded-cluster metadata',
    color: COLOR.mongos,
    pos: new THREE.Vector3(-30, 0, -24),
    visibleIn: ['sharded'],
    blurb:
      'In a sharded cluster the application talks to mongos, which uses the ' +
      'config servers’ metadata to route each operation to the shard that owns the ' +
      'chunk. The balancer migrates chunks to keep them even. 9.0 adds new ' +
      'checkMetadataConsistency inconsistency types, a chunk-check threshold, ' +
      'sh.shardDrainingStatus() and a large set of sharding metadata statistics. ' +
      'This district only exists when the topology is sharded.',
    readout: (s) => (s.topology === 'sharded' ? `routing · ${fmtPct(s.util.query)} load across 3 shards` : 'not present in this topology'),
  },
  {
    id: 'query',
    name: 'Query pipeline',
    subtitle: 'Parse, plan, execute, stage by stage',
    color: COLOR.query,
    pos: new THREE.Vector3(-8, 0, 0),
    blurb:
      'A command is parsed, a plan is chosen (or taken from the plan cache), and ' +
      'the executor runs it as a pipeline of stages: an index scan, a fetch, a ' +
      '$match, a $group, a $lookup, a $vectorSearch handed to mongot. In 9.0 one ' +
      'operation is capped at 1 GB or 20% of available memory, $queryStats samples ' +
      '1% of reads and writes by default, and query settings, knobs and a ' +
      'per-shape maxTimeMS can be pinned to one query shape. Server-side ' +
      'JavaScript is back, sandboxed in a WebAssembly engine.',
    readout: (s) => `${s.stages} stage${s.stages === 1 ? '' : 's'} · ${fmtNum(s.opsPerSec, 0)} ops/s · p99 ${s.p99Ms.toFixed(1)} ms`,
  },
  {
    id: 'cache',
    name: 'WiredTiger · cache',
    subtitle: 'Document pages and index pages, in memory',
    color: COLOR.cache,
    pos: new THREE.Vector3(16, 0, 0),
    blurb:
      'The storage engine keeps working pages in its own cache (by default half ' +
      'of RAM minus 1 GB). Document pages are green; index pages, the B-trees the ' +
      'planner walks, are violet and live in the very same cache. Orange pages are ' +
      'dirty. Past 80% full, eviction works to free space; past 95%, application ' +
      'threads are pulled in to help and latency climbs. Those thresholds are the ' +
      'real WiredTiger defaults.',
    readout: (s) => `occupancy ${fmtPct(s.cacheOccupancy)} · dirty ${fmtPct(s.dirtyFraction)} · hit ${fmtPct(s.cacheHit)}`,
  },
  {
    id: 'disk',
    name: 'Disk · journal · checkpoints',
    subtitle: 'Collection files, index files, the write-ahead log',
    color: COLOR.disk,
    pos: new THREE.Vector3(16, 0, 28),
    blurb:
      'Each collection and each index is a file. A committed write reaches the ' +
      'write-ahead journal (the cyan ribbon) before the next checkpoint writes a ' +
      'consistent snapshot of the data files, every 60 s or 2 GB of journal by ' +
      'default. The dirty share of the cache is exactly what the next checkpoint ' +
      'has to flush. 9.0 stores time series collections as one namespace of ' +
      'compressed buckets rather than a view over a hidden collection.',
    readout: (s) => `${fmtNum(s.docsInFlight, 0)} documents journaled · next checkpoint flushes ${fmtPct(s.dirtyFraction)}`,
  },
  {
    id: 'replication',
    name: 'Oplog · secondaries',
    subtitle: 'Replica set: primary, two secondaries, majority commit',
    color: COLOR.repl,
    pos: new THREE.Vector3(42, 0, 0),
    blurb:
      'Every write is an entry in the oplog, a capped collection the secondaries ' +
      'tail and apply. A "majority" write concern waits until most members have ' +
      'it. Change streams, and the mongot search process, read this same stream. ' +
      'Pick Standalone and the secondaries leave the city; pick Sharded and each ' +
      'shard is its own replica set. 9.0 adds initial-sync phase metrics and a ' +
      'full set of change-stream cursor metrics to serverStatus.',
    readout: (s) => (s.topology === 'standalone' ? 'no secondaries · writes acknowledged locally' : `oplog ${fmtPct(s.util.repl)} busy · majority acknowledged`),
  },
  {
    id: 'mongot',
    name: 'mongot · search & vector',
    subtitle: 'A separate Lucene-based process',
    color: COLOR.mongot,
    pos: new THREE.Vector3(16, 0, -28),
    blurb:
      'Full-text and vector search run in mongot, a separate process that keeps ' +
      'its indexes in sync by consuming change streams. Applications never talk ' +
      'to it: $search and $vectorSearch stages are routed to it by mongod and the ' +
      'results rejoin the pipeline. Self-managed mongot needs MongoDB 8.3 or later ' +
      'and a keyfile replica set. Busy when the agent-RAG workload retrieves context.',
    readout: (s) => (s.workload === 'vector-rag' ? `serving $vectorSearch · ${fmtPct(s.util.index)} load` : 'indexes in sync · idle'),
  },
]

const BY_ID = new Map(DISTRICTS.map((d) => [d.id, d]))

export function districtById(id: string): DistrictDef | undefined {
  return BY_ID.get(id as DistrictDef['id'])
}

/** Districts on the request road, in request order. */
export const REQUEST_PATH: DistrictDef['id'][] = ['clients', 'gateway', 'query', 'cache', 'replication']
