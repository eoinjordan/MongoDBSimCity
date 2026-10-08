import * as THREE from 'three'
import { COLOR } from '../core/theme'
import type { DistrictDef } from '../core/types'
import { fmtNum, fmtPct } from '../core/util'

/**
 * Every district, defined once. The 3D world reads `pos`/`color` to place and
 * tint itself; the HUD legend, guided tour and inspector read the copy and the
 * live `readout`. Nothing re-derives a position or a colour anywhere else.
 *
 * Layout (top-down): the WiredTiger cache sits at the centre with the engine's
 * four neighbours around it — the query engine to the north, indexes to the
 * west, replication to the east, the journal and checkpoints to the south —
 * and the wider deployment on the corners: clients and agents, the sharding
 * layer, security, and the mongot search process.
 */
export const DISTRICTS: DistrictDef[] = [
  {
    id: 'cache',
    name: 'WiredTiger · cache',
    subtitle: 'Storage engine, in-memory pages',
    color: COLOR.cache,
    pos: new THREE.Vector3(0, 0, 0),
    blurb:
      'The storage engine keeps working pages of documents and index entries in ' +
      'its own cache (by default half of RAM minus 1 GB). Reads that hit here never ' +
      'touch disk; writes dirty pages here first. Past 80% full, eviction works to ' +
      'free space; past 95%, application threads are pulled in to help and latency ' +
      'climbs. Those four thresholds are the real WiredTiger defaults.',
    readout: (s) => `occupancy ${fmtPct(s.cacheOccupancy)} · dirty ${fmtPct(s.dirtyFraction)} · hit ${fmtPct(s.cacheHit)}`,
  },
  {
    id: 'query',
    name: 'Query engine',
    subtitle: 'Planner, slot-based execution, aggregation',
    color: COLOR.query,
    pos: new THREE.Vector3(0, 0, -26),
    blurb:
      'Parses each command, chooses a plan, and executes it stage by stage. In 9.0 ' +
      'a single operation is capped at 1 GB or 20% of available memory, $queryStats ' +
      'samples 1% of reads and writes by default, and query settings, knobs and a ' +
      'per-shape maxTimeMS can be pinned to one query shape. Server-side JavaScript ' +
      'is back, sandboxed in a WebAssembly engine.',
    readout: (s) => `${fmtNum(s.opsPerSec, 0)} ops/s · p99 ${s.p99Ms.toFixed(1)} ms · ${fmtPct(s.util.query)} busy`,
  },
  {
    id: 'indexes',
    name: 'Indexes',
    subtitle: 'B-trees, compound, text, geo, wildcard',
    color: COLOR.index,
    pos: new THREE.Vector3(-26, 0, 0),
    blurb:
      'Ordered B-tree keys that let the planner find documents without scanning ' +
      'a collection. Compound, multikey, text, 2dsphere and wildcard indexes all ' +
      'live here; vector and search indexes live in the separate mongot process. ' +
      '9.0 gives 2dsphere key-extraction failures named error codes and structured ' +
      'diagnostics so an unindexable document is easy to find.',
    readout: (s) => `utilisation ${fmtPct(s.util.index)}`,
  },
  {
    id: 'replication',
    name: 'Replication · oplog',
    subtitle: 'Primary, secondaries, majority commit',
    color: COLOR.repl,
    pos: new THREE.Vector3(26, 0, 0),
    blurb:
      'Every write is recorded in the oplog and streamed to secondaries. A ' +
      '"majority" write concern waits until most members have it; change streams ' +
      'and the mongot search process both read from this stream. 9.0 adds phase, ' +
      'attempt and throughput metrics for initial sync and a full set of change ' +
      'stream cursor metrics to serverStatus.',
    readout: (s) => `oplog ${fmtPct(s.util.repl)} busy · ${s.topology === 'standalone' ? 'no secondaries' : 'majority acknowledged'}`,
  },
  {
    id: 'journal',
    name: 'Journal · checkpoints',
    subtitle: 'Durability: write-ahead log and snapshots',
    color: COLOR.journal,
    pos: new THREE.Vector3(0, 0, 26),
    blurb:
      'The write-ahead journal makes a committed write survive a crash before the ' +
      'next checkpoint writes a consistent snapshot of the data files (every 60 s ' +
      'or 2 GB of journal by default). The dirty share of the cache is what a ' +
      'checkpoint has to flush. 9.0 stores time series collections as one ' +
      'namespace of compressed buckets rather than a view over a hidden one.',
    readout: (s) => `${fmtNum(s.docsInFlight, 0)} documents in flight · dirty ${fmtPct(s.dirtyFraction)}`,
  },
  {
    id: 'clients',
    name: 'Clients · drivers · agents',
    subtitle: 'Applications, MCP server, change stream consumers',
    color: COLOR.clients,
    pos: new THREE.Vector3(-25, 0, -25),
    blurb:
      'Drivers speak the wire protocol; every BSON object they send is validated ' +
      'by default in 9.0. AI agents arrive the same way, through the MongoDB MCP ' +
      'server or a driver, and the database is the control point that decides what ' +
      'they may read, write and act on. 9.0 limits open multi-document transactions ' +
      'to 10,000 per server.',
    readout: (s) => `dispatching ${s.workload === 'idle' ? 'nothing' : fmtNum(s.opsPerSec, 0) + ' ops/s'}`,
  },
  {
    id: 'sharding',
    name: 'Sharding · mongos',
    subtitle: 'Routers, config servers, chunk balancer',
    color: COLOR.sharding,
    pos: new THREE.Vector3(25, 0, -25),
    blurb:
      'Horizontal scale: a shard key splits a collection into chunks across ' +
      'shards, mongos routes each operation, and the balancer migrates chunks to ' +
      'keep them even. 9.0 adds checkMetadataConsistency inconsistency types, a ' +
      'chunk-check threshold, shard draining status, and a large set of sharding ' +
      'metadata statistics. Lit only in the sharded topology.',
    readout: (s) => (s.topology === 'sharded' ? `balancing · ${fmtPct(s.util.query)} router load` : 'not sharded in this topology'),
  },
  {
    id: 'security',
    name: 'Security · encryption',
    subtitle: 'Auth, roles, Queryable Encryption, audit',
    color: COLOR.security,
    pos: new THREE.Vector3(-25, 0, 25),
    blurb:
      'Identity-bound policy: users, roles and privileges decide what each ' +
      'connection may do. Queryable Encryption keeps fields encrypted in the ' +
      'server while still answering queries; 9.0 makes prefix, suffix and ' +
      'substring queries on encrypted strings generally available and deprecates ' +
      'the separate mongocryptd process. Audit messages gain the literal TCP peer.',
    readout: (s) => `${fmtNum(s.opsPerSec, 0)} authorised ops/s`,
  },
  {
    id: 'search',
    name: 'mongot · search & vector',
    subtitle: 'Separate Lucene-based process',
    color: COLOR.search,
    pos: new THREE.Vector3(25, 0, 25),
    blurb:
      'Full-text and vector search run in mongot, a separate process that keeps ' +
      'its indexes in sync by reading change streams. Clients never talk to it ' +
      'directly: $search and $vectorSearch stages are routed to it by mongod. ' +
      'Self-managed mongot needs MongoDB 8.3 or later and a keyfile replica set. ' +
      'Busy when the agent-RAG workload retrieves context.',
    readout: (s) => (s.workload === 'vector-rag' ? `syncing · ${fmtPct(s.util.index)} query load` : 'idle · indexes in sync'),
  },
]

const BY_ID = new Map(DISTRICTS.map((d) => [d.id, d]))

export function districtById(id: string): DistrictDef | undefined {
  return BY_ID.get(id as DistrictDef['id'])
}
