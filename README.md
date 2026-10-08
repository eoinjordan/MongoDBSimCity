# MongoDBSimCity

**Walk through a MongoDB 9.0 server. Watch a document flow. Understand what the database is doing.**

An explorable 3D model where districts are the parts of a `mongod` and motion is
the dataflow between them. Follow a write from a driver into the query engine,
through the WiredTiger cache, out to the journal and the secondaries, and watch
an agent's vector search come back through `mongot`.

No installation to explore — it runs in a browser with WebGL2. View here:
https://eoinjordan.github.io/MongoDBSimCity/

> **Independent & non-commercial.** Not affiliated with, sponsored by, or endorsed
> by MongoDB, Inc. MongoDB, WiredTiger and Atlas are trademarks of MongoDB, Inc.
> Every number shown is **illustrative** and scaled to be readable — a teaching
> model, **not** a benchmark or sizing guidance. The few documented rules the
> model does use (WiredTiger's eviction thresholds, the default cache size, the
> 9.0 per-operation memory limit and transaction cap) are quoted and worked by
> hand in [docs/verification.md](docs/verification.md).

A sibling of [HexagonNPUSimCity](https://github.com/eoinjordan/HexagonNPUSimCity)
(the Qualcomm Hexagon NPU, same engine), both inspired by
[PGSimCity](https://github.com/NikolayS/PGSimCity), which does this for PostgreSQL.

## What you are looking at

| District | What it is |
|---|---|
| **WiredTiger cache** (centre, green) | The storage engine's in-memory pages. Lit pages track occupancy, orange ones are dirty, and the column reddens as eviction pressure builds past the real 80% target towards the 95% trigger. |
| **Query engine** (north, blue) | Parse, plan, execute. 9.0's per-operation memory limit, `$queryStats` sampling, per-shape query settings and the WASM JavaScript engine live here. |
| **Indexes** (west, violet) | B-tree keys the planner walks instead of scanning. Lanes ripple with index-driven workloads. |
| **Replication · oplog** (east, amber) | A primary and two secondaries joined by the oplog ring. Goes dark in the standalone topology. |
| **Journal · checkpoints** (south, cyan) | The write-ahead log and the periodic snapshot to disk. The dirty share of the cache is what the next checkpoint flushes. |
| **Clients · drivers · agents** (corner) | Applications, the MongoDB MCP server and change-stream consumers. The database decides what an agent may do. |
| **Sharding · mongos** (corner) | Routers, config servers and the chunk balancer. Lights up only in the sharded topology. |
| **Security · encryption** (corner) | Roles, audit and Queryable Encryption, including 9.0's prefix/suffix/substring queries on encrypted strings. |
| **mongot · search & vector** (corner) | The separate Lucene-based process that keeps search and vector indexes in sync from change streams. Wakes on the agent-RAG workload. |

Colour is meaning, never decoration: documents being read are **cyan**, writes are
**orange**, the oplog is **amber**, change streams are **green**, checkpoints are
**grey**, chunk migrations are **pink**.

## Controls

- **Workload** — OLTP, Analytics, Vector search · agent RAG, Time series, Idle (keys `1`–`5`).
- **Topology** — Standalone, Replica set, Sharded. Scales the ops ceiling and the latency floor and switches districts on and off.
- `T` guided tour · `K` pause · `H` establishing shot · `N` day/night · `R` reset · `?` keys and legend.
- **Settings (⚙)** edits every illustrative figure live, including the WiredTiger thresholds and a set of 9.0 feature toggles. "Restore defaults" returns to the reviewed values.
- **Measured server** (bottom panel) connects to a local service that runs `serverStatus` against a MongoDB you operate and shows the real version, topology, cache use and a sampled ops/s. Real numbers, kept separate from the model.

## Quick start

```bash
npm install
npm run dev      # open the printed localhost URL
```

```bash
npm run build        # production build to dist/
npm run preview      # serve the built site
```

## Verify

```bash
npm run typecheck    # tsc --noEmit
npm test             # module unit and component integration tests (node:test + jsdom)
npm run test:coverage
npm run test:browser # real WebGL component tests (install Chromium first)
npm run test:app     # production app tests under a Pages-style subpath
```

CI runs all of the above on every push and pull request; a green run on `main`
deploys `dist/` to GitHub Pages.

## Documentation

- [docs/verification.md](docs/verification.md) — which numbers are documented MongoDB rules, which are invented for legibility, and the worked examples the unit tests check.
- [NOTICE](NOTICE) — trademarks, affiliation and the model disclaimer.

### Measuring a real server

```bash
npm run build
MONGO_URL="mongodb://127.0.0.1:27017/?directConnection=true" npm run measure
# open http://127.0.0.1:4318 and expand "Measured server"
```

The service only answers its own loopback origin, never exposes the connection
string to the page, and only ever runs `serverStatus`. Point `MONGO_URL` at any
MongoDB 4.4+ (the panel was built against 9.0.2 Community on a RUBIK Pi 3).

## Project layout

```
src/core      types, theme, typed event bus, helpers
src/sim       the behavioural model (model.ts) and the documented WiredTiger rules (wiredtiger.ts)
src/world     districts.ts (single source of truth) and the 3D builders
src/engine    renderer, camera rig, labels, picker, dataflow particles
src/ui        HUD, inspector, tour, help, settings, keyboard
src/runtime   "Measured server" panel and serverStatus normalisation
tools         local measurement service (runtime-server.mjs)
docs          verification.md
tests         browser (Playwright) specs and fixtures
```

## License

Apache-2.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE).
