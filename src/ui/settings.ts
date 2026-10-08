import type { Bus } from '../core/bus'
import type { Sim, Topology, WorkloadId, WorkloadProfile } from '../core/types'
import { DEFAULT_SIM_CONFIG, FEATURE_CHOICES, TOPOLOGIES, WORKLOADS } from '../sim/model'
import { clear, el } from './dom'

export interface Settings {
  toggle(): void
  close(): void
  readonly open: boolean
}

/**
 * A deliberately understated config drawer behind the toolbar cog. It edits the
 * model's *illustrative* figures live so you can see what changing them does to
 * the server and the readouts. The defaults are untouched — "Restore defaults"
 * always returns to the reviewed values in docs/verification.md.
 */
export function createSettings(bus: Bus, sim: Sim): Settings {
  let open = false
  const drawer = el('aside', {
    id: 'settings-drawer',
    class: 'settings-drawer',
    role: 'dialog',
    'aria-label': 'Configuration — illustrative figures',
    'aria-hidden': 'true',
  })
  document.body.append(drawer)

  function setCeil(t: Topology, v: number): void {
    const opsCeil: Partial<Record<Topology, number>> = {}
    opsCeil[t] = v
    sim.configure({ opsCeil })
  }
  function setLatency(t: Topology, v: number): void {
    const latencyBase: Partial<Record<Topology, number>> = {}
    latencyBase[t] = v
    sim.configure({ latencyBase })
  }
  function setProfile(id: WorkloadId, profile: Partial<WorkloadProfile>): void {
    const workloads: Partial<Record<WorkloadId, Partial<WorkloadProfile>>> = {}
    workloads[id] = profile
    sim.configure({ workloads })
  }

  function numberRow(
    label: string,
    value: number,
    opts: { min: number; max: number; step: number },
    onChange: (v: number) => void,
  ): HTMLElement {
    const input = el('input', {
      type: 'number', value: String(value), min: String(opts.min), max: String(opts.max), step: String(opts.step), 'aria-label': label,
    }) as HTMLInputElement
    input.addEventListener('input', () => {
      const v = Number(input.value)
      if (Number.isFinite(v)) onChange(v)
    })
    return el('label', { class: 'settings-row' }, [el('span', { class: 'settings-label', text: label }), input])
  }

  function sliderRow(
    label: string,
    value: number,
    opts: { min: number; max: number; step: number; pct?: boolean },
    onChange: (v: number) => void,
  ): HTMLElement {
    const fmt = (v: number) => (opts.pct ? `${Math.round(v * 100)}%` : String(v))
    const out = el('span', { class: 'settings-val', text: fmt(value) })
    const input = el('input', {
      type: 'range', value: String(value), min: String(opts.min), max: String(opts.max), step: String(opts.step), 'aria-label': label,
    }) as HTMLInputElement
    input.addEventListener('input', () => {
      const v = Number(input.value)
      out.textContent = fmt(v)
      onChange(v)
    })
    return el('label', { class: 'settings-row settings-row--slider' }, [el('span', { class: 'settings-label', text: label }), input, out])
  }

  function featureSummary(): string {
    const enabled = sim.getConfig().enabledFeatures
    return enabled.length ? `Enabled: ${enabled.length} of ${FEATURE_CHOICES.length}` : 'No 9.0 features marked enabled'
  }

  function render(): void {
    const cfg = sim.getConfig()
    clear(drawer)

    drawer.append(
      el('div', { class: 'settings-head' }, [
        el('div', { class: 'settings-title', text: 'Settings' }),
        el('button', { class: 'settings-close', 'aria-label': 'Close settings', text: '✕', onclick: () => close() }),
      ]),
      el('p', {
        class: 'settings-note',
        text: 'Illustrative figures — changes apply live and are not benchmark values. Defaults reproduce docs/verification.md.',
      }),
    )

    const ceil = el('div', { class: 'settings-section' }, [el('h4', { text: 'Ops ceiling by topology (ops/s)' })])
    for (const t of TOPOLOGIES) ceil.append(numberRow(t.label, cfg.opsCeil[t.id], { min: 0, max: 1_000_000, step: 1000 }, (v) => setCeil(t.id, v)))
    drawer.append(ceil)

    const lat = el('div', { class: 'settings-section' }, [el('h4', { text: 'p99 latency floor by topology (ms)' })])
    for (const t of TOPOLOGIES) lat.append(numberRow(t.label, cfg.latencyBase[t.id], { min: 0, max: 100, step: 0.1 }, (v) => setLatency(t.id, v)))
    drawer.append(lat)

    const wid = sim.state.workload
    const wl = cfg.workloads[wid]
    const wlLabel = WORKLOADS.find((w) => w.id === wid)?.label ?? wid
    const wlSec = el('div', { class: 'settings-section' }, [
      el('h4', { text: `Workload profile · ${wlLabel}` }),
      el('p', { class: 'settings-hint', text: 'Editing the currently selected workload — switch workload in the top bar to tune another.' }),
    ])
    wlSec.append(
      sliderRow('Query engine target', wl.query, { min: 0, max: 1, step: 0.01, pct: true }, (v) => setProfile(wid, { query: v })),
      sliderRow('Index target', wl.index, { min: 0, max: 1, step: 0.01, pct: true }, (v) => setProfile(wid, { index: v })),
      sliderRow('Storage target', wl.storage, { min: 0, max: 1, step: 0.01, pct: true }, (v) => setProfile(wid, { storage: v })),
      sliderRow('Replication target', wl.repl, { min: 0, max: 1, step: 0.01, pct: true }, (v) => setProfile(wid, { repl: v })),
      sliderRow('Cache occupancy target', wl.cache, { min: 0, max: 1, step: 0.01, pct: true }, (v) => setProfile(wid, { cache: v })),
      sliderRow('Dirty share target', wl.dirty, { min: 0, max: 0.5, step: 0.01, pct: true }, (v) => setProfile(wid, { dirty: v })),
      sliderRow('Ops scale', wl.opsScale, { min: 0, max: 1, step: 0.01 }, (v) => setProfile(wid, { opsScale: v })),
      sliderRow('Nominal cache hit rate', wl.hitRate, { min: 0, max: 1, step: 0.01, pct: true }, (v) => setProfile(wid, { hitRate: v })),
      numberRow('Documents in flight', wl.docs, { min: 0, max: 5000, step: 10 }, (v) => setProfile(wid, { docs: v })),
      numberRow('Open connections', wl.connections, { min: 0, max: 10000, step: 10 }, (v) => setProfile(wid, { connections: v })),
      numberRow('Pipeline stages', wl.stages, { min: 1, max: 8, step: 1 }, (v) => setProfile(wid, { stages: Math.max(1, Math.min(8, Math.round(v))) })),
    )
    drawer.append(wlSec)

    const mem = el('div', { class: 'settings-section' }, [
      el('h4', { text: 'WiredTiger memory model' }),
      el('p', { class: 'settings-hint', text: 'The four eviction thresholds default to WiredTiger’s documented values; cache and per-operation sizes are illustrative.' }),
    ])
    mem.append(
      numberRow('Cache size (GB)', cfg.memory.cacheGB, { min: 0.25, max: 1024, step: 0.25 }, (v) => sim.configure({ memory: { cacheGB: v } })),
      numberRow('Per-operation limit (GB)', cfg.memory.perOpLimitGB, { min: 1, max: 1024, step: 1 }, (v) => sim.configure({ memory: { perOpLimitGB: v } })),
      sliderRow('Eviction target', cfg.memory.evictionTarget, { min: 0, max: 1, step: 0.01, pct: true }, (v) => sim.configure({ memory: { evictionTarget: v } })),
      sliderRow('Eviction trigger', cfg.memory.evictionTrigger, { min: 0, max: 1, step: 0.01, pct: true }, (v) => sim.configure({ memory: { evictionTrigger: v } })),
      sliderRow('Dirty target', cfg.memory.dirtyTarget, { min: 0, max: 1, step: 0.01, pct: true }, (v) => sim.configure({ memory: { dirtyTarget: v } })),
      sliderRow('Dirty trigger', cfg.memory.dirtyTrigger, { min: 0, max: 1, step: 0.01, pct: true }, (v) => sim.configure({ memory: { dirtyTrigger: v } })),
    )
    drawer.append(mem)

    const feats = el('div', { class: 'settings-section' }, [
      el('h4', { text: 'MongoDB 9.0 · feature toggles' }),
      el('p', { class: 'settings-hint', text: 'Illustrative — shows where these 9.0 switches would live. It records the choice but does not change the animation.' }),
    ])
    const grid = el('div', { class: 'settings-opsets' })
    const summary = el('p', { class: 'settings-summary', text: featureSummary() })
    for (const f of FEATURE_CHOICES) {
      const box = el('input', { type: 'checkbox', id: `feature-${f.id}`, checked: cfg.enabledFeatures.includes(f.id) }) as HTMLInputElement
      box.addEventListener('change', () => {
        const cur = new Set(sim.getConfig().enabledFeatures)
        if (box.checked) cur.add(f.id)
        else cur.delete(f.id)
        sim.configure({ enabledFeatures: FEATURE_CHOICES.map((c) => c.id).filter((id) => cur.has(id)) })
        summary.textContent = featureSummary()
      })
      grid.append(el('label', { class: 'settings-opset', for: `feature-${f.id}` }, [box, document.createTextNode(` ${f.label}`)]))
    }
    feats.append(grid, summary)
    drawer.append(feats)

    drawer.append(
      el('div', { class: 'settings-foot' }, [
        el('button', {
          class: 'btn',
          text: 'Restore defaults',
          onclick: () => {
            sim.configure(DEFAULT_SIM_CONFIG)
            render()
          },
        }),
      ]),
    )
  }

  // Keep the workload section in step with the active workload while open.
  bus.on('workload:change', () => {
    if (open) render()
  })

  function show(): void {
    render()
    drawer.classList.add('open')
    drawer.setAttribute('aria-hidden', 'false')
    open = true
    drawer.querySelector<HTMLElement>('button, input')?.focus()
  }
  function close(): void {
    drawer.classList.remove('open')
    drawer.setAttribute('aria-hidden', 'true')
    open = false
  }
  function toggle(): void {
    if (open) close()
    else show()
  }

  return {
    toggle,
    close,
    get open() {
      return open
    },
  }
}
