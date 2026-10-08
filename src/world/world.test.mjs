import assert from 'node:assert/strict'
import test from 'node:test'
import * as THREE from 'three'
import { createSim, TOPOLOGY_IDS, WORKLOADS } from '../sim/model.ts'
import { districtGroup, glow, plinth, rim, roundedBox, surface } from './build.ts'
import { createCity } from './city.ts'
import { DISTRICTS, districtById, REQUEST_PATH } from './districts.ts'
import { createGround, SIDE_RAILS } from './ground.ts'
import { assertFiniteScene, disposeScene, snapshotScene } from '../../tests/helpers/scene.mjs'

test('district metadata has unique identities, finite positions and valid live readouts', () => {
  assert.equal(DISTRICTS.length, 8)
  assert.equal(new Set(DISTRICTS.map((district) => district.id)).size, DISTRICTS.length)
  assert.equal(districtById('unknown'), undefined)
  const sim = createSim()
  for (const workload of WORKLOADS) {
    for (const topology of TOPOLOGY_IDS) {
      sim.setWorkload(workload.id)
      sim.setTopology(topology)
      sim.update(1 / 60)
      for (const district of DISTRICTS) {
        assert.equal(districtById(district.id), district)
        assert.ok(district.pos.toArray().every(Number.isFinite))
        assert.ok(district.name && district.subtitle && district.blurb)
        assert.ok(district.readout(sim.state).length > 0)
        assert.doesNotMatch(district.readout(sim.state), /NaN|Infinity|undefined/)
      }
    }
  }
})

test('the request road runs west to east on one line, with disk south, mongot north and mongos off the road', () => {
  const xs = REQUEST_PATH.map((id) => districtById(id).pos.x)
  assert.deepEqual([...xs].sort((a, b) => a - b), xs)
  for (const id of REQUEST_PATH) assert.equal(districtById(id).pos.z, 0, `${id} must sit on the road`)
  const cache = districtById('cache').pos
  assert.equal(districtById('disk').pos.x, cache.x)
  assert.ok(districtById('disk').pos.z > 0)
  assert.equal(districtById('mongot').pos.x, cache.x)
  assert.ok(districtById('mongot').pos.z < 0)
  assert.deepEqual(districtById('mongos').visibleIn, ['sharded'])
  assert.ok(districtById('mongos').pos.z !== 0)
})

test('rounded geometry respects dimensions even when radius exceeds the box size', (context) => {
  const geometry = roundedBox(2, 4, 6, 100)
  context.after(() => geometry.dispose())
  geometry.computeBoundingBox()
  const size = geometry.boundingBox.getSize(new THREE.Vector3())
  assert.ok(size.distanceTo(new THREE.Vector3(2, 4, 6)) < 1e-5)
  assert.ok(geometry.getAttribute('position').array.every(Number.isFinite))
})

test('surface and glow preserve semantic colors and explicit material options', (context) => {
  const basic = surface(0x123456)
  const custom = surface(0xabcdef, { metalness: 0, roughness: 1, emissiveIntensity: 0 })
  const luminous = glow(0x123456, 2)
  context.after(() => [basic, custom, luminous].forEach((material) => material.dispose()))
  assert.equal(basic.color.getHex(), 0x123456)
  assert.equal(basic.metalness, 0.35)
  assert.equal(custom.metalness, 0)
  assert.equal(custom.roughness, 1)
  assert.equal(custom.emissiveIntensity, 0)
  assert.equal(luminous.emissive.getHex(), 0x123456)
  assert.equal(luminous.emissiveIntensity, 2)
})

test('district primitives use independent positions and retain picking metadata', (context) => {
  const district = districtById('replication')
  const group = districtGroup(district)
  group.add(plinth(district, 12, 10), rim(district, 12, 10))
  context.after(() => disposeScene(group))
  assert.equal(group.userData.districtId, 'replication')
  assert.deepEqual(group.position.toArray(), district.pos.toArray())
  assert.notEqual(group.position, district.pos)
  assert.equal(group.children[0].receiveShadow, true)
  assert.equal(group.children[0].castShadow, true)
  assert.equal(group.children[1].isLineSegments, true)
  assertFiniteScene(group)
})

test('ground lays the request road, the side rails and two oplog rails', (context) => {
  const ground = createGround()
  context.after(() => disposeScene(ground))
  const rails = ground.children.filter((object) => object.geometry?.type === 'BoxGeometry')
  assert.equal(rails.length, REQUEST_PATH.length - 1 + SIDE_RAILS.length + 2)
  for (let i = 0; i < REQUEST_PATH.length - 1; i++) {
    const a = districtById(REQUEST_PATH[i]).pos
    const b = districtById(REQUEST_PATH[i + 1]).pos
    assert.ok(rails.some((rail) => rail.position.x === (a.x + b.x) / 2 && rail.position.z === (a.z + b.z) / 2))
  }
  assertFiniteScene(ground)
})

test('city assembles every district exactly once with matching pickables and labels', (context) => {
  const city = createCity()
  context.after(() => disposeScene(city.object))
  assert.equal(city.pickables.length, DISTRICTS.length)
  assert.equal(city.labels.length, DISTRICTS.length)
  assert.equal(city.object.children.length, DISTRICTS.length + 1)
  for (const district of DISTRICTS) {
    const group = city.pickables.find((object) => object.userData.districtId === district.id)
    const label = city.labels.find((item) => item.id === district.id)
    assert.ok(group && group.children.length > 0, `missing builder: ${district.id}`)
    assert.equal(group.parent, city.object)
    assert.deepEqual(group.position.toArray(), district.pos.toArray())
    assert.equal(label.name, district.name)
    assert.equal(label.position.x, district.pos.x)
    assert.equal(label.position.z, district.pos.z)
    assert.ok(label.position.y > 0)
    assert.notEqual(label.position, district.pos)
  }
  assertFiniteScene(city.object)
})

test('every district remains finite across workloads and topologies without growing the scene', (context) => {
  const city = createCity()
  const sim = createSim()
  context.after(() => disposeScene(city.object))
  const originalIds = []
  city.object.traverse((object) => originalIds.push(object.uuid))
  for (const workload of WORKLOADS) {
    for (const topology of TOPOLOGY_IDS) {
      sim.setWorkload(workload.id)
      sim.setTopology(topology)
      for (let step = 0; step < 12; step++) {
        sim.update(1 / 60)
        city.update(1 / 60, sim.state)
      }
      assertFiniteScene(city.object)
    }
  }
  const updatedIds = []
  city.object.traverse((object) => updatedIds.push(object.uuid))
  assert.deepEqual(updatedIds, originalIds)
})

test('animation changes the world, while zero elapsed time and frozen state preserve it', (context) => {
  const city = createCity()
  const sim = createSim()
  context.after(() => disposeScene(city.object))
  city.update(0, sim.state)
  const initial = snapshotScene(city.object)
  for (let step = 0; step < 30; step++) {
    sim.update(1 / 60)
    city.update(1 / 60, sim.state)
  }
  assert.notDeepEqual(snapshotScene(city.object), initial)
  sim.togglePause()
  const paused = snapshotScene(city.object)
  city.update(0, sim.state)
  assert.deepEqual(snapshotScene(city.object), paused)
})

test('reset restores and replays all world animations, including the planner ring rotation', (context) => {
  const city = createCity()
  const sim = createSim()
  context.after(() => disposeScene(city.object))
  city.update(0, sim.state)
  const initial = snapshotScene(city.object)
  const advance = () => {
    for (let step = 0; step < 60; step++) {
      sim.update(1 / 60)
      city.update(1 / 60, sim.state)
    }
  }
  advance()
  const firstRun = snapshotScene(city.object)
  sim.reset()
  city.update(0, sim.state)
  assert.deepEqual(snapshotScene(city.object), initial)
  advance()
  assert.deepEqual(snapshotScene(city.object), firstRun)
})

test('topology adds and removes real nodes: secondaries leave in standalone, mongos only exists when sharded', (context) => {
  const city = createCity()
  const sim = createSim()
  context.after(() => disposeScene(city.object))
  const group = (id) => city.pickables.find((object) => object.userData.districtId === id)
  const run = (topology) => {
    sim.reset()
    sim.setTopology(topology)
    for (let step = 0; step < 60; step++) {
      sim.update(1 / 60)
      city.update(1 / 60, sim.state)
    }
  }
  const secondaries = () => group('replication').children.filter((child) => child.isGroup).map((child) => child.visible)
  run('standalone')
  assert.deepEqual(secondaries(), [false, false])
  assert.equal(group('mongos').visible, false)
  run('replica-set')
  assert.deepEqual(secondaries(), [true, true])
  assert.equal(group('mongos').visible, false)
  run('sharded')
  assert.deepEqual(secondaries(), [true, true])
  assert.equal(group('mongos').visible, true)
})

test('the query pipeline lights as many stages as the workload runs', (context) => {
  const city = createCity()
  const sim = createSim()
  context.after(() => disposeScene(city.object))
  const pipeline = city.pickables.find((object) => object.userData.districtId === 'query')
  const litStages = () => pipeline.children.filter((child) => child.geometry && child.scale.y > 0.5 && child.material.emissiveIntensity > 0.1).length
  sim.setWorkload('analytics')
  for (let step = 0; step < 60; step++) { sim.update(1 / 60); city.update(1 / 60, sim.state) }
  const analytics = litStages()
  sim.setWorkload('timeseries')
  for (let step = 0; step < 60; step++) { sim.update(1 / 60); city.update(1 / 60, sim.state) }
  assert.ok(analytics > litStages())
})
