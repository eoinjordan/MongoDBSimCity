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

The city is read **west to east along the request road**, the way a request
actually travels, rather than as a hub with spokes.

| District | What it is |
|---|---|
| **Applications · agents** (far west, mint) | Where every document starts and ends: app servers lit per connection, plus two lime agent pods (an MCP server and a change-stream consumer). The database decides what an agent may do. |
| **Connection · auth gates** (gold) | Security is a gate on every request, not a building. Five turnstiles open with load; one flashes red when it refuses. The ring on top is Queryable Encryption, with 9.0's substring queries. |
| **mongos · config servers** (pink, sharded only) | Routers and the config servers' metadata. The district and its pink routing exist only when the topology is sharded. |
| **Query pipeline** (teal) | Eight stage blocks on a conveyor; the lit ones are the stages the workload runs (OLTP two, an aggregation seven). 9.0's per-operation memory limit, `$queryStats` sampling and per-shape query settings live here. |
| **WiredTiger cache** (green, with violet) | Document pages are green, index pages are violet, in the same cache, with a small B-tree above them handing keys back to the planner. Orange pages are dirty. The column reddens past the real 80% eviction target towards the 95% trigger. |
| **Disk · journal · checkpoints** (south of the cache) | Four collection files, two index files, and the cyan journal ribbon. A checkpoint sweeps the files every few seconds, brighter the dirtier the cache. |
| **Oplog · secondaries** (east, amber) | The oplog ring and primary, with two real secondary nodes beside it that apply the oplog a beat behind. They leave the city in the standalone topology. |
| **mongot · search & vector** (north of the cache, lime) | The separate Lucene-based process kept in sync by change streams. Wakes on the agent-RAG workload. |

The particles are **documents**, small BSON slabs rather than spheres. Colour is
meaning, never decoration: reads are **pale green**, writes **orange**, index keys
**violet**, the oplog **amber**, change streams **lime**, checkpoints **grey-green**
and mongos routing **pink**. The chrome is MongoDB green throughout.

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
