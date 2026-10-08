import * as THREE from 'three'
import { COLOR } from '../core/theme'
import type { DistrictDef, SimState } from '../core/types'
import { makeRng } from '../core/util'
import { DistrictBuild, districtGroup, glow, roundedBox, surface } from './build'

/* ============================================================================
 * The request road, west to east: the applications and agents that originate
 * documents, the gates every connection and operation passes through, and the
 * query pipeline that turns a command into stages.
 * ==========================================================================*/

/** Applications and agents: a row of app servers and two agent pods, lit per connection. */
export function createClients(def: DistrictDef): DistrictBuild {
  const group = districtGroup(def)
  const rng = makeRng(0xc11e)

  const pad = new THREE.Mesh(roundedBox(10, 0.4, 9, 0.3), surface(def.color, { emissiveIntensity: 0.1, roughness: 0.7 }))
  pad.position.y = 0.2
  pad.receiveShadow = true
  group.add(pad)

  // Six application servers in two rows.
  const apps: THREE.MeshStandardMaterial[] = []
  for (let i = 0; i < 6; i++) {
    const h = 1.6 + rng() * 1.2
    const m = surface(def.color, { emissiveIntensity: 0.2, roughness: 0.45 })
    const box = new THREE.Mesh(roundedBox(1.4, h, 1.4, 0.15), m)
    box.position.set(-3 + (i % 3) * 2.2, 0.4 + h / 2, -2.2 + Math.floor(i / 3) * 2.4)
    box.castShadow = true
    group.add(box)
    apps.push(m)
  }
  // Two agent pods: the MCP server and a change-stream consumer.
  const agents: THREE.MeshStandardMaterial[] = []
  for (let i = 0; i < 2; i++) {
    const m = glow(COLOR.changeStream, 0.5)
    const pod = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.8, 1.4, 6), m)
    pod.position.set(3.4, 1.1, -1.4 + i * 2.8)
    pod.castShadow = true
    group.add(pod)
    agents.push(m)
  }

  function update(_dt: number, s: SimState): void {
    const live = Math.min(6, Math.round((s.connections / 400) * 6 + 0.49))
    for (let i = 0; i < apps.length; i++) {
      const on = i < live
      apps[i].emissiveIntensity = on ? 0.35 + 0.35 * (0.5 + 0.5 * Math.sin(s.t * 3 + i)) : 0.06
    }
    const agentWake = s.workload === 'vector-rag' ? 1 : s.workload === 'idle' ? 0.1 : 0.4
    for (let i = 0; i < agents.length; i++) agents[i].emissiveIntensity = 0.2 + agentWake * (0.6 + 0.4 * Math.sin(s.t * 1.5 + i * 2))
  }

  update(0, { connections: 100, workload: 'oltp', t: 0 } as SimState)
  return { group, update }
}

/** Connection and auth gates: five turnstiles. Open ones pass traffic; one flashes red when it refuses. */
export function createGateway(def: DistrictDef): DistrictBuild {
  const group = districtGroup(def)

  const wallMat = surface(def.color, { emissiveIntensity: 0.12, roughness: 0.6 })
  const wall = new THREE.Mesh(roundedBox(2.2, 3.2, 11, 0.2), wallMat)
  wall.position.y = 1.6
  wall.castShadow = true
  wall.receiveShadow = true
  group.add(wall)

  const GATES = 5
  const bars: THREE.Mesh[] = []
  const barMats: THREE.MeshStandardMaterial[] = []
  const slotGeo = roundedBox(2.4, 2.2, 1.4, 0.1)
  const slotMat = new THREE.MeshStandardMaterial({ color: 0x03120e, roughness: 0.9 })
  for (let i = 0; i < GATES; i++) {
    const z = (i - (GATES - 1) / 2) * 2.1
    const slot = new THREE.Mesh(slotGeo, slotMat)
    slot.position.set(0, 1.3, z)
    group.add(slot)
    const m = glow(def.color, 0.8)
    const bar = new THREE.Mesh(roundedBox(0.3, 0.3, 1.5, 0.08), m)
    bar.position.set(0, 0.6, z)
    group.add(bar)
    bars.push(bar)
    barMats.push(m)
  }

  // A padlock-ish beacon for Queryable Encryption on top.
  const lockMat = glow(def.color, 0.6)
  const lock = new THREE.Mesh(new THREE.TorusGeometry(0.5, 0.12, 8, 24), lockMat)
  lock.position.set(0, 4.3, 0)
  group.add(lock)

  const refuse = new THREE.Color(COLOR.pressure)
  const pass = new THREE.Color(def.color)

  function update(_dt: number, s: SimState): void {
    const open = Math.min(GATES, Math.round(s.util.query * GATES + 0.49))
    for (let i = 0; i < GATES; i++) {
      const isOpen = i < open && s.workload !== 'idle'
      // Bars lift for open gates; one gate refuses on a slow deterministic beat.
      const refusing = i === 2 && Math.sin(s.t * 0.9) > 0.985
      bars[i].position.y = isOpen ? 2.2 : 0.6
      barMats[i].color.copy(refusing ? refuse : pass)
      barMats[i].emissive.copy(refusing ? refuse : pass)
      barMats[i].emissiveIntensity = refusing ? 1.6 : isOpen ? 0.9 : 0.25
    }
    lockMat.emissiveIntensity = 0.4 + 0.4 * (0.5 + 0.5 * Math.sin(s.t * 2))
    lock.rotation.y = s.t * 0.5
  }

  update(0, { util: { query: 0.5 }, workload: 'oltp', t: 0 } as SimState)
  return { group, update }
}

/** Query pipeline: eight stage blocks on a conveyor; the first `stages` are lit and a wave runs through them. */
export function createQueryPipeline(def: DistrictDef): DistrictBuild {
  const group = districtGroup(def)

  const STAGES = 8
  const PITCH = 1.55
  const belt = new THREE.Mesh(roundedBox(STAGES * PITCH + 1.2, 0.5, 3.6, 0.25), surface(def.color, { emissiveIntensity: 0.12, roughness: 0.6 }))
  belt.position.y = 0.25
  belt.receiveShadow = true
  group.add(belt)

  const stageMats: THREE.MeshStandardMaterial[] = []
  const stageMeshes: THREE.Mesh[] = []
  for (let i = 0; i < STAGES; i++) {
    const m = surface(def.color, { emissiveIntensity: 0.2, roughness: 0.45 })
    const block = new THREE.Mesh(roundedBox(1.1, 1.6, 2.2, 0.15), m)
    block.position.set((i - (STAGES - 1) / 2) * PITCH, 0.5 + 0.8, 0)
    block.castShadow = true
    group.add(block)
    stageMats.push(m)
    stageMeshes.push(block)
  }

  // The planner: a small spinning ring at the head of the belt.
  const ringMat = glow(def.color, 0.8)
  const ring = new THREE.Mesh(new THREE.TorusGeometry(1.1, 0.12, 10, 32), ringMat)
  ring.rotation.x = Math.PI / 2
  ring.position.set(-(STAGES / 2) * PITCH - 1.4, 1.6, 0)
  group.add(ring)

  let previousTime = 0
  function update(dt: number, s: SimState): void {
    if (s.t < previousTime || s.t === 0) ring.rotation.z = 0
    if (s.t > previousTime) ring.rotation.z += dt * (0.4 + s.util.query * 5)
    previousTime = s.t
    ringMat.emissiveIntensity = 0.4 + s.util.query * 1.4
    const front = (s.t * (2 + s.util.query * 6)) % (STAGES + 2)
    for (let i = 0; i < STAGES; i++) {
      const active = i < s.stages
      const d = Math.abs(i - front)
      const wave = active ? Math.max(0, 1 - d * 0.6) : 0
      stageMats[i].emissiveIntensity = active ? 0.25 + wave * 1.2 * (0.3 + s.util.query) : 0.05
      const h = active ? 1.6 + wave * 0.8 : 0.6
      stageMeshes[i].scale.y = h / 1.6
      stageMeshes[i].position.y = 0.5 + h / 2
    }
  }

  update(0, { util: { query: 0.5 }, stages: 2, t: 0 } as SimState)
  return { group, update }
}
