import type { Bus } from '../core/bus'
import type { DistrictId } from '../core/types'
import { clear, el } from './dom'

interface TourStep {
  focus: DistrictId | 'home'
  title: string
  body: string
}

/**
 * A guided walk along the request road: one write and one read, from a driver
 * through the gates and the pipeline into the storage engine, down to disk,
 * out to the secondaries, and back to an agent asking for similar documents.
 */
const STEPS: TourStep[] = [
  {
    focus: 'home',
    title: 'A MongoDB 9.0 server, from above',
    body: 'Read it west to east. Applications on the left, then the gates every request passes, then the query pipeline, then the WiredTiger cache with disk below and mongot above, then the oplog and the secondaries. Let’s follow a document.',
  },
  {
    focus: 'clients',
    title: 'Applications and agents',
    body: 'A driver sends BSON; 9.0 validates every object on the way in. The two lime pods are agents: an MCP server and a change-stream consumer. What they may do is decided inside the database, never by the model.',
  },
  {
    focus: 'gateway',
    title: 'The gates',
    body: 'Security is a gate on every request, not a building. A connection authenticates once; each operation is then checked against the roles of that identity. Watch a gate flash red when it refuses. The ring on top is Queryable Encryption: fields that stay encrypted through the gate and inside the server, now with substring queries in 9.0.',
  },
  {
    focus: 'mongos',
    title: 'mongos and the config servers',
    body: 'Only in the sharded topology. Routers use the config servers’ metadata to send each operation to the shard that owns the chunk, and the balancer keeps chunks even. Switch to Sharded and this district and its pink routing appear.',
  },
  {
    focus: 'query',
    title: 'The query pipeline',
    body: 'Eight stage blocks on a conveyor; the lit ones are the stages this workload runs. OLTP is two stages, an aggregation is seven. 9.0 caps one operation at 1 GB or 20% of memory, samples 1% of operations into $queryStats, and lets you pin knobs and a maxTimeMS to a query shape.',
  },
  {
    focus: 'cache',
    title: 'The WiredTiger cache',
    body: 'Green pages are documents, violet pages are indexes, in the same cache; the little tree is a B-tree the planner walks, and violet keys travel back to the pipeline. Orange pages are dirty. The thresholds are real: eviction starts at 80%, at 95% application threads evict and latency climbs. Try Analytics.',
  },
  {
    focus: 'disk',
    title: 'Disk, journal and checkpoints',
    body: 'Four collection files, two index files, and the cyan journal ribbon in front. A committed write is in the journal before the next checkpoint sweeps the files, every 60 s or 2 GB by default. The dirty share of the cache is what that sweep flushes.',
  },
  {
    focus: 'replication',
    title: 'The oplog and the secondaries',
    body: 'Every write becomes an oplog entry; the two secondaries beside the primary tail and apply it a beat behind. A majority write concern waits for one of them. Pick Standalone and they leave the city.',
  },
  {
    focus: 'mongot',
    title: 'mongot: search and vector search',
    body: 'A separate Lucene-based process kept in sync by consuming change streams from the oplog. $search and $vectorSearch stages are routed to it and rejoin the pipeline. Pick the agent-RAG workload to see it wake.',
  },
]

export interface Tour {
  toggle(): void
  start(): void
  stop(): void
  next(): void
  prev(): void
  readonly active: boolean
}

export function createTour(bus: Bus): Tour {
  const layer = document.getElementById('tour-layer')!
  let i = 0
  let active = false

  function present(): void {
    const step = STEPS[i]
    if (step.focus === 'home') bus.emit('camera:home', undefined)
    else {
      bus.emit('camera:focus', { id: step.focus })
      bus.emit('district:select', { id: step.focus })
    }
    clear(layer)
    const dots = el('div', { class: 'tour-dots' }, STEPS.map((_, k) => el('i', { class: k === i ? 'on' : '' })))
    layer.append(
      el('div', { class: 'tour-card' }, [
        el('div', { class: 'step', text: `Step ${i + 1} of ${STEPS.length}` }),
        el('h2', { text: step.title }),
        el('p', { text: step.body }),
        el('div', { class: 'tour-nav' }, [
          el('button', { class: 'btn', text: '‹ Back', onclick: () => prev() }),
          el('button', { class: 'btn', text: i === STEPS.length - 1 ? 'Finish' : 'Next ›', onclick: () => next() }),
          el('div', { class: 'spacer' }),
          dots,
          el('button', { class: 'btn', text: 'Exit', onclick: () => stop() }),
        ]),
      ]),
    )
  }

  function start(): void {
    active = true
    i = 0
    layer.classList.add('show')
    present()
  }

  function stop(): void {
    active = false
    layer.classList.remove('show')
    bus.emit('district:select', { id: null })
    bus.emit('camera:home', undefined)
  }

  function next(): void {
    if (!active) return
    if (i >= STEPS.length - 1) return stop()
    i++
    present()
  }

  function prev(): void {
    if (!active || i === 0) return
    i--
    present()
  }

  return {
    toggle: () => (active ? stop() : start()),
    start,
    stop,
    next,
    prev,
    get active() {
      return active
    },
  }
}
