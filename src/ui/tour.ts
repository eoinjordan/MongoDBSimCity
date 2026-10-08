import type { Bus } from '../core/bus'
import type { DistrictId } from '../core/types'
import { clear, el } from './dom'

interface TourStep {
  focus: DistrictId | 'home'
  title: string
  body: string
}

/**
 * A short guided walk through one write and one read, following a document
 * from a driver into the server, through the storage engine, out to the
 * secondaries and back to an agent asking for similar documents.
 */
const STEPS: TourStep[] = [
  {
    focus: 'home',
    title: 'A MongoDB 9.0 server, from above',
    body: 'One mongod process. The WiredTiger cache sits in the middle; the query engine, indexes, replication and the journal surround it. The corners are the deployment around it. Let’s follow a document through.',
  },
  {
    focus: 'clients',
    title: 'Clients, drivers and agents',
    body: 'A driver sends BSON over the wire protocol (validated by default in 9.0). An AI agent arrives the same way, through the MongoDB MCP server. Everything it may do is decided here, inside the database, not by the model.',
  },
  {
    focus: 'query',
    title: 'The query engine',
    body: 'Each command is parsed, planned and executed stage by stage. 9.0 caps a single operation at 1 GB or 20% of available memory, samples 1% of operations into $queryStats by default, and lets you pin knobs and a maxTimeMS to one query shape.',
  },
  {
    focus: 'indexes',
    title: 'Indexes',
    body: 'B-tree keys let the planner skip straight to the right documents. Watch the lanes ripple harder on the OLTP and agent-RAG workloads, where almost every read is index-driven.',
  },
  {
    focus: 'cache',
    title: 'The WiredTiger cache',
    body: 'Pages live here; orange ones are dirty. The thresholds are real: eviction starts at 80% full, and at 95% the application threads themselves are pulled in to evict and latency climbs. Try Analytics and watch the column redden.',
  },
  {
    focus: 'journal',
    title: 'Journal and checkpoints',
    body: 'A committed write is in the write-ahead journal before the next checkpoint writes a consistent snapshot to disk. The dirty share of the cache is exactly what the next checkpoint has to flush.',
  },
  {
    focus: 'replication',
    title: 'Replication and the oplog',
    body: 'Every write becomes an oplog entry streamed to the secondaries; a majority write concern waits for most of them. Switch to Standalone and the ring goes dark. Change streams read this same stream.',
  },
  {
    focus: 'search',
    title: 'mongot: search and vector search',
    body: 'A separate Lucene-based process keeps full-text and vector indexes in sync by consuming change streams. $search and $vectorSearch are routed to it by mongod. Pick the agent-RAG workload to see it wake.',
  },
  {
    focus: 'sharding',
    title: 'Sharding',
    body: 'Pick the sharded topology: mongos routers, config servers and the balancer light up, and the ops ceiling rises because work spreads across shards. 9.0 adds metadata-consistency checks and shard-draining status.',
  },
  {
    focus: 'security',
    title: 'Security and Queryable Encryption',
    body: 'Roles decide what each identity may do. Queryable Encryption keeps fields encrypted inside the server; 9.0 makes prefix, suffix and substring queries on those fields generally available and retires mongocryptd.',
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
