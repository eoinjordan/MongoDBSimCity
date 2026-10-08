import { type Bus } from '../core/bus'
import { COLOR } from '../core/theme'
import type { SimState } from '../core/types'
import { fmtNum, fmtPct, hexCss } from '../core/util'
import { TOPOLOGIES, WORKLOADS } from '../sim/model'
import { DISTRICTS } from '../world/districts'
import { clear, el } from './dom'

export interface Hud {
  update(s: SimState): void
  setPaused(paused: boolean): void
}

interface HudDeps {
  bus: Bus
  initial: SimState
}

/** The heads-up display: brand, workload/topology controls, legend and meters. */
export function createHud(deps: HudDeps): Hud {
  const { bus } = deps
  const top = document.getElementById('hud-top')!
  const left = document.getElementById('hud-left')!
  const right = document.getElementById('hud-right')!
  const bottom = document.getElementById('hud-bottom')!
  clear(top)
  clear(left)
  clear(right)
  clear(bottom)

  /* ---- top bar ---- */
  const brand = el('div', { class: 'brand' }, [
    el('div', {
      html: `<svg viewBox="0 0 100 100" width="30" height="30"><defs><linearGradient id="hb" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#00ed64"/><stop offset="100%" stop-color="#b1ff05"/></linearGradient></defs><path d="M50 6 C 30 26, 22 44, 28 62 C 33 76, 44 84, 50 94 C 56 84, 67 76, 72 62 C 78 44, 70 26, 50 6 Z" fill="none" stroke="url(#hb)" stroke-width="6"/><path d="M50 24 L50 88" stroke="url(#hb)" stroke-width="5"/></svg>`,
    }),
    el('div', { class: 'brand-text' }, [
      el('div', { class: 'brand-title', html: 'Mongo<span>DB</span>SimCity' }),
      el('div', { class: 'brand-sub', text: 'How MongoDB 9.0 works, in 3D' }),
    ]),
  ])

  const workloadSel = el('select', {
    id: 'workload',
    'aria-label': 'Workload',
    onchange: (e: Event) => {
      const workload = WORKLOADS.find((item) => item.id === (e.target as HTMLSelectElement).value)
      if (workload) bus.emit('workload:change', { id: workload.id })
    },
  })
  for (const w of WORKLOADS) workloadSel.append(el('option', { value: w.id, text: w.label }))

  const topologySel = el('select', {
    id: 'topology',
    'aria-label': 'Illustrative deployment topology',
    'aria-describedby': 'model-caveat',
    title: 'Illustrative topology, not a sizing recommendation or a benchmark',
    onchange: (e: Event) => {
      const topology = TOPOLOGIES.find((item) => item.id === (e.target as HTMLSelectElement).value)
      if (topology) bus.emit('topology:change', { value: topology.id })
    },
  })
  for (const t of TOPOLOGIES) topologySel.append(el('option', { value: t.id, text: t.label }))
  topologySel.value = deps.initial.topology

  top.append(
    brand,
    el('div', { class: 'spacer' }),
    el('div', { class: 'control-group' }, [el('label', { for: 'workload', text: 'Workload' }), workloadSel]),
    el('div', { class: 'control-group' }, [el('label', { for: 'topology', text: 'Topology' }), topologySel]),
  )

  /* ---- left toolbar ---- */
  type VoidEvent = 'tour:toggle' | 'camera:home' | 'theme:toggle' | 'help:toggle' | 'settings:toggle'
  const tool = (glyph: string, label: string, ev: VoidEvent) =>
    el('button', { class: 'tool', title: label, 'aria-label': label, onclick: () => bus.emit(ev, undefined) }, [
      document.createTextNode(glyph),
      el('small', { text: label }),
    ])
  const pauseTool = el('button', { class: 'tool', title: 'Pause / resume (K)', 'aria-label': 'Pause or resume', onclick: () => bus.emit('pause:toggle', undefined) }, [
    document.createTextNode('⏸'),
    el('small', { text: 'Pause (K)' }),
  ])
  left.append(
    tool('▶', 'Guided tour (T)', 'tour:toggle'),
    pauseTool,
    tool('⌂', 'Establishing shot (H)', 'camera:home'),
    tool('◐', 'Day / night (N)', 'theme:toggle'),
    tool('?', 'Keys & legend (?)', 'help:toggle'),
    tool('⚙', 'Settings — tune the figures', 'settings:toggle'),
  )

  /* ---- right legend ---- */
  const legend = el('div', { class: 'card' }, [el('h3', { text: 'Districts' })])
  for (const d of DISTRICTS) {
    legend.append(
      el('button', { class: 'legend-row', 'aria-label': `Focus ${d.name}`, onclick: () => {
        bus.emit('district:select', { id: d.id })
        bus.emit('camera:focus', { id: d.id })
      } }, [
        el('span', { class: 'swatch', style: { color: hexCss(d.color), background: hexCss(d.color) } }),
        el('span', { class: 'name', text: d.name }),
      ]),
    )
  }
  legend.append(el('h3', { text: 'Dataflow', style: { marginTop: '10px' } }))
  const flowLegend: [number, string][] = [
    [COLOR.document, 'Documents read'],
    [COLOR.write, 'Writes'],
    [COLOR.indexKey, 'Index keys'],
    [COLOR.oplog, 'Oplog'],
    [COLOR.changeStream, 'Change streams'],
    [COLOR.checkpoint, 'Checkpoints'],
    [COLOR.route, 'mongos routing'],
  ]
  for (const [c, name] of flowLegend) {
    legend.append(
      el('div', { class: 'legend-row' }, [
        el('span', { class: 'swatch', style: { color: hexCss(c), background: hexCss(c) } }),
        el('span', { class: 'name', text: name }),
      ]),
    )
  }
  right.append(legend)

  /* ---- bottom meters ---- */
  const metric = (k: string) => {
    const v = el('div', { class: 'v' })
    return { node: el('div', { class: 'metric' }, [el('div', { class: 'k', text: k }), v]), v }
  }
  const mOps = metric('Ops / s')
  const mLat = metric('p99 latency')
  const mHit = metric('Cache hit')
  const mWork = metric('Workload')

  const bar = (k: string, color: number) => {
    const fill = el('div', { class: 'fill', style: { background: hexCss(color), height: '4%' } })
    return { node: el('div', { class: 'bar' }, [el('div', { class: 'k', text: k }), el('div', { class: 'track' }, [fill])]), fill }
  }
  const bQuery = bar('Query', COLOR.query)
  const bIndex = bar('Index', COLOR.index)
  const bCache = bar('Cache', COLOR.cache)
  const bRepl = bar('Repl', COLOR.repl)

  bottom.append(
    el('div', { class: 'metrics' }, [
      el('p', { id: 'model-caveat', class: 'metrics-note', text: 'Illustrative model - not benchmark measurements' }),
      mOps.node, mLat.node, mHit.node, mWork.node,
    ]),
    el('div', { class: 'bars' }, [bQuery.node, bIndex.node, bCache.node, bRepl.node]),
  )

  const workloadLabel = (id: string) => WORKLOADS.find((w) => w.id === id)?.label ?? id
  const topologyLabel = (id: string) => TOPOLOGIES.find((t) => t.id === id)?.label ?? id

  function update(s: SimState): void {
    workloadSel.value = s.workload
    topologySel.value = s.topology
    mOps.v.innerHTML = `${fmtNum(s.opsPerSec, 0)} <small>${topologyLabel(s.topology)}</small>`
    mLat.v.innerHTML = `${s.p99Ms.toFixed(1)} <small>ms</small>`
    mHit.v.textContent = fmtPct(s.cacheHit)
    mWork.v.textContent = workloadLabel(s.workload).split('·')[0].trim()
    bQuery.fill.style.height = `${Math.max(4, s.util.query * 100)}%`
    bIndex.fill.style.height = `${Math.max(4, s.util.index * 100)}%`
    bCache.fill.style.height = `${Math.max(4, s.cacheOccupancy * 100)}%`
    bRepl.fill.style.height = `${Math.max(4, s.util.repl * 100)}%`
  }

  function setPaused(paused: boolean): void {
    pauseTool.firstChild!.textContent = paused ? '▶' : '⏸'
  }

  return { update, setPaused }
}
