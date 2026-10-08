import assert from 'node:assert/strict'
import test from 'node:test'
import { createBus } from '../core/bus.ts'
import { fmtNum, fmtPct } from '../core/util.ts'
import { createClock } from '../sim/clock.ts'
import { createSim, FEATURE_CHOICES, TOPOLOGY_IDS, WORKLOADS } from '../sim/model.ts'
import { DISTRICTS, districtById } from '../world/districts.ts'
import { clear, el } from './dom.ts'
import { createControls, WORKLOAD_KEYS } from './controls.ts'
import { createHelp } from './help.ts'
import { createHud } from './hud.ts'
import { createInspector } from './panel.ts'
import { createSettings } from './settings.ts'
import { createTour } from './tour.ts'
import { installDom } from '../../tests/helpers/dom.mjs'

function fixture(context) {
  const environment = installDom({ html: '<header id="hud-top"></header><aside id="hud-left"></aside><aside id="hud-right"></aside><footer id="hud-bottom"></footer><div id="inspector"></div><div id="tour-layer"></div><div id="help-overlay" hidden></div>' })
  const cleanups = []
  context.after(() => {
    try {
      for (const cleanup of cleanups) cleanup()
    } finally {
      environment.cleanup()
    }
  })
  const bus = createBus()
  const sim = createSim()
  const hud = createHud({ bus, initial: sim.state })
  const inspector = createInspector(bus)
  const tour = createTour(bus)
  const select = (index, value) => {
    const element = environment.document.querySelectorAll('#hud-top select')[index]
    element.value = value
    element.dispatchEvent(new environment.window.Event('change', { bubbles: true }))
  }
  return { ...environment, bus, sim, hud, inspector, tour, select, onCleanup: (cleanup) => cleanups.push(cleanup) }
}

test('DOM helper creates attributes, boolean flags, styles, datasets, children and event handlers', (context) => {
  const environment = installDom()
  context.after(environment.cleanup)
  let clicks = 0
  const node = el('button', {
    class: 'action',
    title: 'Choose replication',
    disabled: true,
    hidden: false,
    'aria-label': 'Choose replication',
    style: { opacity: '0.5' },
    dataset: { district: 'replication' },
    optional: null,
    onClick: () => clicks++,
  }, ['<literal>', el('span', { text: 'Replication' })])
  assert.equal(node.className, 'action')
  assert.equal(node.title, 'Choose replication')
  assert.equal(node.disabled, true)
  assert.equal(node.hasAttribute('hidden'), false)
  assert.equal(node.hasAttribute('optional'), false)
  assert.equal(node.getAttribute('aria-label'), 'Choose replication')
  assert.equal(node.dataset.district, 'replication')
  assert.equal(node.style.opacity, '0.5')
  assert.equal(node.textContent, '<literal>Replication')
  assert.equal(node.children.length, 1)
  node.disabled = false
  node.click()
  assert.equal(clicks, 1)
})

test('DOM text is escaped, explicit HTML is supported, and clear is idempotent', (context) => {
  const environment = installDom()
  context.after(environment.cleanup)
  const text = el('div', { text: '<img src="invalid">' })
  assert.equal(text.querySelector('img'), null)
  const html = el('div', { html: '<strong>Replication</strong>' })
  assert.equal(html.querySelector('strong').textContent, 'Replication')
  clear(html)
  clear(html)
  assert.equal(html.childNodes.length, 0)
  assert.equal(el('div').childNodes.length, 0)
})

test('HUD lists every workload, topology and district without duplicating on remount', (context) => {
  const { document, bus, sim } = fixture(context)
  const selects = document.querySelectorAll('#hud-top select')
  assert.deepEqual([...selects[0].options].map((option) => option.value), WORKLOADS.map((workload) => workload.id))
  assert.deepEqual([...selects[1].options].map((option) => option.value), TOPOLOGY_IDS)
  assert.equal(selects[1].value, sim.state.topology)
  for (const district of DISTRICTS) assert.ok(document.getElementById('hud-right').textContent.includes(district.name))
  createHud({ bus, initial: sim.state })
  assert.equal(document.querySelectorAll('#hud-top select').length, 2)
  assert.equal(document.querySelectorAll('#hud-left .tool').length, 6)
  assert.equal(document.querySelectorAll('#hud-bottom .metric').length, 4)
})

test('HUD emits validated selectors and ignores unknown input values', (context) => {
  const { bus, select } = fixture(context)
  const received = []
  bus.on('workload:change', (payload) => received.push(payload))
  bus.on('topology:change', (payload) => received.push(payload))
  select(0, 'analytics')
  select(1, 'sharded')
  select(0, 'invalid-workload')
  select(1, 'invalid-topology')
  assert.deepEqual(received, [{ id: 'analytics' }, { value: 'sharded' }])
})

test('HUD keeps the illustrative qualifier next to metrics and labels both selectors', (context) => {
  const { document } = fixture(context)
  const caveat = document.querySelector('#hud-bottom #model-caveat')
  assert.match(caveat.textContent, /illustrative.*not benchmark measurements/i)
  assert.equal(caveat.hidden, false)
  assert.equal(document.getElementById('topology').getAttribute('aria-describedby'), caveat.id)
  for (const id of ['topology', 'workload']) assert.ok(document.querySelector(`label[for="${id}"]`))
})

test('HUD toolbar and district legend dispatch the expected action contracts', (context) => {
  const { document, bus } = fixture(context)
  const received = []
  const events = ['tour:toggle', 'pause:toggle', 'camera:home', 'theme:toggle', 'help:toggle', 'settings:toggle']
  for (const event of events) bus.on(event, () => received.push(event))
  for (const tool of document.querySelectorAll('#hud-left .tool')) tool.click()
  assert.deepEqual(received, events)
  const selections = []
  bus.on('district:select', (payload) => selections.push(['select', payload.id]))
  bus.on('camera:focus', (payload) => selections.push(['focus', payload.id]))
  document.querySelector('#hud-right .legend-row').click()
  assert.deepEqual(selections, [['select', 'cache'], ['focus', 'cache']])
})

test('HUD reflects metrics, selections, utilization and pause state after updates', (context) => {
  const { document, sim, hud } = fixture(context)
  sim.setWorkload('analytics')
  sim.setTopology('sharded')
  for (let step = 0; step < 120; step++) sim.update(1 / 60)
  hud.update(sim.state)
  const selects = document.querySelectorAll('#hud-top select')
  const metrics = document.querySelectorAll('#hud-bottom .v')
  assert.equal(selects[0].value, 'analytics')
  assert.equal(selects[1].value, 'sharded')
  assert.ok(metrics[0].textContent.includes(fmtNum(sim.state.opsPerSec, 0)))
  assert.ok(metrics[0].textContent.includes('Sharded'))
  assert.ok(metrics[1].textContent.includes(sim.state.p99Ms.toFixed(1)))
  assert.equal(metrics[2].textContent, fmtPct(sim.state.cacheHit))
  assert.equal(metrics[3].textContent, 'Analytics')
  for (const bar of document.querySelectorAll('#hud-bottom .fill')) {
    assert.ok(parseFloat(bar.style.height) >= 0 && parseFloat(bar.style.height) <= 100)
  }
  const pause = document.querySelectorAll('#hud-left .tool')[1]
  const initial = pause.innerHTML
  hud.setPaused(true)
  assert.notEqual(pause.innerHTML, initial)
  hud.setPaused(false)
  assert.equal(pause.innerHTML, initial)
})

test('inspector renders every district and refreshes only the current live readout', (context) => {
  const { document, sim, inspector } = fixture(context)
  const root = document.getElementById('inspector')
  for (const district of DISTRICTS) {
    inspector.show(district)
    sim.update(1 / 60)
    inspector.update(sim.state)
    assert.ok(root.classList.contains('show'))
    assert.equal(root.querySelector('.t').textContent, district.name)
    assert.equal(root.querySelector('.sub').textContent, district.subtitle)
    assert.equal(root.querySelector('.blurb').textContent, district.blurb)
    assert.equal(root.querySelector('.readout').textContent, district.readout(sim.state))
    assert.equal(root.querySelectorAll('.readout').length, 1)
  }
  inspector.hide()
  const lastReadout = root.querySelector('.readout').textContent
  sim.update(0.1)
  inspector.update(sim.state)
  assert.equal(root.classList.contains('show'), false)
  assert.equal(root.querySelector('.readout').textContent, lastReadout)
})

test('inspector close requests deselection through the shared bus', (context) => {
  const { document, bus, inspector } = fixture(context)
  const selections = []
  bus.on('district:select', (payload) => selections.push(payload.id))
  inspector.show(districtById('replication'))
  document.querySelector('#inspector .close').click()
  assert.deepEqual(selections, [null])
})

test('tour ignores navigation while inactive and can traverse, finish and restart', (context) => {
  const { document, bus, tour } = fixture(context)
  const selections = []
  let homeCalls = 0
  bus.on('district:select', (payload) => selections.push(payload.id))
  bus.on('camera:home', () => homeCalls++)
  const layer = document.getElementById('tour-layer')
  tour.next()
  tour.prev()
  assert.equal(tour.active, false)
  assert.equal(layer.childNodes.length, 0)
  tour.start()
  assert.equal(tour.active, true)
  assert.ok(layer.classList.contains('show'))
  assert.equal(homeCalls, 1)
  const firstTitle = layer.querySelector('h2').textContent
  tour.prev()
  assert.equal(layer.querySelector('h2').textContent, firstTitle)
  const stepCount = layer.querySelectorAll('.tour-dots i').length
  assert.equal(stepCount, DISTRICTS.length + 1)
  for (let step = 1; step < stepCount; step++) {
    layer.querySelectorAll('.tour-nav button')[1].click()
    assert.equal(layer.querySelector('.step').textContent, `Step ${step + 1} of ${stepCount}`)
    assert.ok(districtById(selections.at(-1)))
  }
  assert.equal(new Set(selections).size, DISTRICTS.length)
  assert.equal(layer.querySelectorAll('.tour-nav button')[1].textContent, 'Finish')
  tour.next()
  assert.equal(tour.active, false)
  assert.equal(selections.at(-1), null)
  assert.equal(homeCalls, 2)
  tour.toggle()
  assert.equal(tour.active, true)
  assert.equal(layer.querySelector('h2').textContent, firstTitle)
  tour.next()
  tour.prev()
  assert.equal(layer.querySelector('h2').textContent, firstTitle)
  layer.querySelectorAll('.tour-nav button')[2].click()
  assert.equal(tour.active, false)
})

test('component integration: HUD events drive the real model, clock and inspector', (context) => {
  const { document, bus, sim, hud, inspector, tour, select } = fixture(context)
  bus.on('workload:change', ({ id }) => sim.setWorkload(id))
  bus.on('topology:change', ({ value }) => sim.setTopology(value))
  bus.on('pause:toggle', () => sim.togglePause())
  bus.on('tour:toggle', () => tour.toggle())
  bus.on('district:select', ({ id }) => id ? inspector.show(districtById(id)) : inspector.hide())
  const clock = createClock(sim.update)
  bus.on('reset', () => { sim.reset(); clock.reset() })
  select(0, 'analytics')
  select(1, 'sharded')
  for (let frame = 0; frame <= 120; frame++) clock.advance(frame * 1000 / 60, !sim.state.paused)
  hud.update(sim.state)
  assert.equal(sim.state.workload, 'analytics')
  assert.equal(sim.state.topology, 'sharded')
  assert.ok(sim.state.opsPerSec > 0)
  document.querySelector('#hud-right .legend-row').click()
  inspector.update(sim.state)
  assert.equal(document.querySelector('#inspector .readout').textContent, districtById('cache').readout(sim.state))
  document.querySelectorAll('#hud-left .tool')[1].click()
  assert.equal(sim.state.paused, true)
  const paused = structuredClone(sim.state)
  clock.advance(60_000, !sim.state.paused)
  assert.deepEqual(sim.state, paused)
  document.querySelector('#hud-left .tool').click()
  assert.equal(tour.active, true)
  tour.next()
  assert.equal(document.querySelector('#inspector .t').textContent, districtById('clients').name)
  bus.emit('reset', undefined)
  hud.update(sim.state)
  assert.deepEqual(sim.state, createSim().state)
  assert.equal(document.querySelectorAll('#hud-top select')[1].value, 'replica-set')
})

test('settings drawer edits the live figures, follows the active workload, and restores defaults', (context) => {
  const { document, bus, sim, onCleanup } = fixture(context)
  const settings = createSettings(bus, sim)
  onCleanup(() => document.getElementById('settings-drawer')?.remove())
  assert.equal(settings.open, false)
  settings.toggle()
  assert.equal(settings.open, true)
  const drawer = document.getElementById('settings-drawer')
  assert.equal(drawer.getAttribute('aria-hidden'), 'false')
  assert.match(drawer.textContent, /illustrative/i)
  assert.equal(drawer.querySelectorAll('input[type="checkbox"]').length, FEATURE_CHOICES.length)
  const ceiling = drawer.querySelector('input[aria-label="Replica set (3)"]')
  ceiling.value = '1000'
  ceiling.dispatchEvent(new document.defaultView.Event('input', { bubbles: true }))
  assert.equal(sim.getConfig().opsCeil['replica-set'], 1000)
  const box = drawer.querySelector('#feature-wasmJs')
  box.checked = false
  box.dispatchEvent(new document.defaultView.Event('change', { bubbles: true }))
  assert.ok(!sim.getConfig().enabledFeatures.includes('wasmJs'))
  assert.match(drawer.textContent, /OLTP · transactions/)
  sim.setWorkload('timeseries')
  bus.emit('workload:change', { id: 'timeseries' })
  assert.match(drawer.textContent, /Time series · ingest/)
  drawer.querySelector('.settings-foot .btn').click()
  assert.equal(sim.getConfig().opsCeil['replica-set'], 20_000)
  assert.ok(sim.getConfig().enabledFeatures.includes('wasmJs'))
  settings.close()
  assert.equal(settings.open, false)
  assert.equal(drawer.getAttribute('aria-hidden'), 'true')
})

test('keyboard controls map every documented shortcut and can be disposed', (context) => {
  const { window, bus, onCleanup } = fixture(context)
  const received = []
  let dismissals = 0
  const mapping = [
    ['t', 'tour:toggle'], ['T', 'tour:toggle'],
    ['k', 'pause:toggle'], ['K', 'pause:toggle'], ['p', 'pause:toggle'], ['P', 'pause:toggle'],
    ['h', 'camera:home'], ['H', 'camera:home'],
    ['n', 'theme:toggle'], ['N', 'theme:toggle'],
    ['r', 'reset'], ['R', 'reset'],
    ['1', 'workload:change'], ['2', 'workload:change'], ['3', 'workload:change'], ['4', 'workload:change'], ['5', 'workload:change'],
    ['?', 'help:toggle'], ['/', 'help:toggle'],
  ]
  for (const name of new Set(mapping.map((entry) => entry[1]))) bus.on(name, (payload) => received.push({ name, payload }))
  const controls = createControls(bus, () => dismissals++)
  onCleanup(() => controls.dispose())
  for (const [key] of mapping) {
    const event = new window.KeyboardEvent('keydown', { key, cancelable: true })
    window.dispatchEvent(event)
    assert.equal(event.defaultPrevented, key === '?' || key === '/')
  }
  assert.deepEqual(received.map((entry) => entry.name), mapping.map((entry) => entry[1]))
  assert.deepEqual(received.filter((entry) => entry.name === 'workload:change').map((entry) => entry.payload.id), WORKLOADS.map((w) => w.id))
  assert.deepEqual(Object.values(WORKLOAD_KEYS), WORKLOADS.map((w) => w.id))
  window.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape' }))
  assert.equal(dismissals, 1)
  const count = received.length
  window.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Unmapped' }))
  controls.dispose()
  controls.dispose()
  window.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'k' }))
  assert.equal(received.length, count)
})

test('keyboard shortcuts leave editing fields and OS/browser shortcuts untouched', (context) => {
  const { window, document, bus, onCleanup } = fixture(context)
  let calls = 0
  bus.on('pause:toggle', () => calls++)
  const controls = createControls(bus, () => calls++)
  onCleanup(() => controls.dispose())
  for (const tag of ['input', 'select', 'textarea']) {
    const input = document.createElement(tag)
    document.body.append(input)
    input.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'k', bubbles: true }))
  }
  for (const modifier of ['metaKey', 'ctrlKey', 'altKey']) {
    window.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'k', [modifier]: true }))
  }
  assert.equal(calls, 0)
})

test('help is lazy-built, labelled, focused, reusable and dismissible by button, backdrop and Escape', (context) => {
  const { window, document, bus, onCleanup } = fixture(context)
  const help = createHelp(bus)
  const controls = createControls(bus, () => help.close())
  onCleanup(() => controls.dispose())
  const overlay = document.getElementById('help-overlay')
  assert.equal(help.open, false)
  assert.equal(overlay.childNodes.length, 0)
  help.close()
  help.toggle()
  assert.equal(help.open, true)
  assert.equal(overlay.hidden, false)
  assert.equal(overlay.getAttribute('role'), 'dialog')
  assert.equal(overlay.getAttribute('aria-modal'), 'true')
  assert.ok(overlay.getAttribute('aria-label'))
  assert.equal(document.activeElement, overlay.querySelector('.help-close'))
  assert.match(overlay.textContent, /illustrative/i)
  const cameraRows = overlay.querySelectorAll('.help-grid > div:first-child .kbd-row')
  assert.equal(cameraRows[0].textContent, 'OrbitDrag')
  assert.equal(cameraRows[1].querySelector('span').textContent, 'Pan across the deployment')
  for (const district of DISTRICTS) assert.ok(overlay.textContent.includes(district.name))
  const panel = overlay.firstElementChild
  panel.click()
  assert.equal(help.open, true)
  overlay.querySelector('.help-close').click()
  assert.equal(help.open, false)
  help.toggle()
  assert.equal(overlay.firstElementChild, panel)
  overlay.click()
  assert.equal(help.open, false)
  help.toggle()
  help.toggle()
  assert.equal(help.open, false)
  help.toggle()
  window.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape' }))
  assert.equal(overlay.hidden, true)
})
