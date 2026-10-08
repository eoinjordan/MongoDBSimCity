# Verification

MongoDBSimCity is an illustrative model. Almost every number on screen is a scale
chosen so that switching workload or topology produces a readable change. This
page separates the handful of **documented rules** the model uses from the
**invented figures** it animates, and works the documented ones by hand so the
unit tests in `src/sim/wiredtiger.test.mjs` can be checked against this text.

## Documented rules (quoted, not invented)

| Rule | Source | In the model |
|---|---|---|
| WiredTiger `eviction_target` 80%, `eviction_trigger` 95% | WiredTiger cache configuration defaults | `src/sim/wiredtiger.ts` `WIREDTIGER_DEFAULTS`; drives the cache column colour and the latency penalty |
| WiredTiger `eviction_dirty_target` 5%, `eviction_dirty_trigger` 20% | same | `dirtyPressure()`, dirty-page tint in the cache and journal districts |
| Default WiredTiger cache = max(256 MB, 50% × (RAM − 1 GB)) | MongoDB storage engine docs | `defaultCacheSizeGB()` (settings drawer caption only) |
| MongoDB 9.0 per-operation memory limit = max(1 GB, 20% of memory available to the process) | MongoDB 9.0 release notes, "Per-Operation Memory Limit" | `perOperationMemoryLimitBytes()`; the query-engine blurb |
| MongoDB 9.0 `maxConcurrentMultiDocumentTransactions` default 10,000 | MongoDB 9.0 release notes | `MAX_CONCURRENT_MULTI_DOCUMENT_TRANSACTIONS`; the clients blurb |

Other 9.0 facts quoted in district blurbs and the tour (and nothing more is done
with them): `$queryStats` sampling 1% of reads and writes by default; server-side
JavaScript re-enabled on a WebAssembly engine; `constraint` validation level;
query settings as a command field, query knobs and per-shape `maxTimeMS`;
Queryable Encryption prefix/suffix/substring GA and `mongocryptd` deprecated;
time series stored as a single namespace of buckets; BSON validated on ingest by
default; change-stream cursor metrics and initial-sync phase metrics; the
sharding metadata-consistency additions; and that self-managed `mongot` needs
MongoDB 8.3 or later with a keyfile replica set. All from the MongoDB 9.0 release
notes and the MongoDB Search self-managed installation guide.

## Worked examples

### Eviction pressure

`evictionPressure(occupancy)` is 0 at or below the 80% target, 1 at or above the
95% trigger, and linear between:

| occupancy | (occ − 0.80) / 0.15 | pressure |
|---|---|---|
| 0.80 | 0 / 0.15 | 0 |
| 0.875 | 0.075 / 0.15 | 0.5 |
| 0.92 | 0.12 / 0.15 | 0.8 |
| 0.95 | 0.15 / 0.15 | 1 |
| 1.00 | clamped | 1 |

The same shape applies to the dirty share with 5% and 20%: dirty 0.125 gives
(0.125 − 0.05) / 0.15 = 0.5.

`applicationThreadsEvict(occupancy, dirty)` is true when either pressure reaches
1, so (0.95, 0.0) and (0.5, 0.2) are true while (0.949, 0.199) is false. That is
the moment WiredTiger makes application threads do eviction work and it is why
the model's p99 latency climbs past the trigger.

### Default cache size

| RAM (GB) | 50% × (RAM − 1) | max with 0.25 | cache (GB) |
|---|---|---|---|
| 1 | 0 | 0.25 | 0.25 |
| 1.5 | 0.25 | 0.25 | 0.25 |
| 4 | 1.5 | 1.5 | 1.5 |
| 8 | 3.5 | 3.5 | 3.5 |
| 64 | 31.5 | 31.5 | 31.5 |

### 9.0 per-operation memory limit

With 1 GiB = 1,073,741,824 bytes:

| available memory | 20% | max with 1 GiB | limit |
|---|---|---|---|
| 0 | 0 | 1 GiB | 1 GiB |
| 4 GiB | 0.8 GiB | 1 GiB | 1 GiB |
| 5 GiB | 1 GiB | 1 GiB | 1 GiB |
| 10 GiB | 2 GiB | 2 GiB | 2 GiB |
| 64 GiB | 12.8 GiB | 12.8 GiB | floor(12.8 GiB) |

## Illustrative figures (invented, reviewed for legibility)

Defaults live in `DEFAULT_SIM_CONFIG` in `src/sim/model.ts`. The settings
drawer edits a live copy; "Restore defaults" returns to exactly these values.

**Ops ceiling by topology (ops/s):** standalone 24,000 · replica set 20,000 ·
sharded 60,000. **p99 latency floor (ms):** 0.9 · 2.2 · 3.4. A replica set is
slower than a standalone because a majority write waits for acknowledgement; a
sharded cluster adds a router hop but multiplies capacity.

**Workload profiles** (targets, 0..1 unless noted):

| workload | query | index | storage | repl | cache | dirty | ops scale | hit rate | docs |
|---|---|---|---|---|---|---|---|---|---|
| OLTP | 0.55 | 0.70 | 0.60 | 0.75 | 0.62 | 0.12 | 1.00 | 0.97 | 1200 |
| Analytics | 0.90 | 0.45 | 0.85 | 0.15 | 0.88 | 0.04 | 0.18 | 0.72 | 2000 |
| Vector search · agent RAG | 0.60 | 0.80 | 0.50 | 0.20 | 0.70 | 0.03 | 0.25 | 0.90 | 600 |
| Time series | 0.30 | 0.35 | 0.80 | 0.70 | 0.55 | 0.25 | 0.90 | 0.95 | 1600 |
| Idle | 0.04 | 0.03 | 0.05 | 0.08 | 0.30 | 0.01 | 0.01 | 0.99 | 20 |

**Metric formulas** (`refreshMetrics()` in `src/sim/model.ts`):

- `opsPerSec = opsCeil[topology] × opsScale × util.query`
- `cacheHit = hitRate × (1 − 0.3 × evictionPressure(cacheOccupancy))`
- `p99Ms = latencyBase[topology] × (1 + 2 × util.query + 3 × evictionPressure(cacheOccupancy))`

So on the replica-set default, OLTP at a settled `util.query` of 0.55 reads
20,000 × 1.0 × 0.55 = 11,000 ops/s, and Analytics, whose cache target of 0.88
sits past the 80% eviction target, shows a lower hit rate and a higher p99 than
OLTP. `src/sim/model.test.mjs` checks both.

None of these are measurements. The "Measured server" panel is the only place
real numbers appear, and they come straight from `serverStatus` on a MongoDB
you run yourself.
