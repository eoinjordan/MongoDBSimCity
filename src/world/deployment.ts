import * as THREE from 'three'
import type { DistrictDef, SimState } from '../core/types'
import { makeRng } from '../core/util'
import { DistrictBuild, districtGroup, glow, roundedBox, surface } from './build'

/* ============================================================================
 * The corners: the wider deployment around one mongod. Clients and agents,
 * the sharding layer, the security boundary and the mongot search process.
 * ==========================================================================*/

/**
 * A packaged block with a core and a grid of pulsing units. Used for the client
 * tier and the security boundary. `activityOf` maps the sim to a 0..1 pulse.
 */
export function createTier(def: DistrictDef, activityOf: (s: SimState) => number): DistrictBuild {
  const group = districtGroup(def)

  const pkg = new THREE.Mesh(roundedBox(9, 0.9, 7, 0.3), surface(def.color, { emissiveIntensity: 0.14, roughness: 0.5 }))
  pkg.position.y = 0.55
  pkg.castShadow = true
  pkg.receiveShadow = true
  group.add(pkg)

  const coreMat = glow(def.color, 0.5)
  const core = new THREE.Mesh(roundedBox(4.4, 0.5, 4.4, 0.15), coreMat)
  core.position.y = 1.15
  group.add(core)

  const G = 5
  const COUNT = G * G
  const PITCH = 0.78
  const HALF = ((G - 1) * PITCH) / 2
  const mat = surface(0xffffff, { emissiveIntensity: 0.5, roughness: 0.4 })
  mat.emissive = new THREE.Color(def.color)
  const blocks = new THREE.InstancedMesh(roundedBox(0.55, 0.4, 0.55, 0.06), mat, COUNT)
  blocks.position.y = 1.35
  group.add(blocks)

  const base = new THREE.Color(def.color)
  const dummy = new THREE.Object3D()
  const color = new THREE.Color()
  for (let i = 0; i < COUNT; i++) {
    const gx = i % G
    const gz = (i / G) | 0
    dummy.position.set(gx * PITCH - HALF, 0, gz * PITCH - HALF)
    dummy.updateMatrix()
    blocks.setMatrixAt(i, dummy.matrix)
  }
  blocks.instanceMatrix.needsUpdate = true

  function update(_dt: number, s: SimState): void {
    const a = activityOf(s)
    coreMat.emissiveIntensity = 0.3 + a * 1.3
    for (let i = 0; i < COUNT; i++) {
      const b = 0.2 + a * (0.4 + 0.5 * Math.sin(s.t * 3 + i))
      color.copy(base).multiplyScalar(b)
      blocks.setColorAt(i, color)
    }
    if (blocks.instanceColor) blocks.instanceColor.needsUpdate = true
  }

  return { group, update }
}

/** Sharding: a grid of chunks with the balancer sweeping migrations across it. */
export function createSharding(def: DistrictDef): DistrictBuild {
  const group = districtGroup(def)

  const G = 12
  const COUNT = G * G
  const PITCH = 0.72
  const HALF = ((G - 1) * PITCH) / 2

  const frameMat = surface(def.color, { emissiveIntensity: 0.22, roughness: 0.5 })
  const frame = new THREE.Mesh(roundedBox(G * PITCH + 2, 0.7, G * PITCH + 2, 0.3), frameMat)
  frame.position.y = 0.35
  frame.receiveShadow = true
  group.add(frame)

  const geo = roundedBox(0.5, 0.5, 0.5, 0.08)
  const mat = surface(0xffffff, { emissiveIntensity: 0.6, roughness: 0.35 })
  mat.emissive = new THREE.Color(def.color)
  const chunks = new THREE.InstancedMesh(geo, mat, COUNT)
  chunks.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
  chunks.castShadow = true
  chunks.position.y = 0.9
  group.add(chunks)

  const base = new THREE.Color(def.color)
  const dummy = new THREE.Object3D()
  const color = new THREE.Color()

  function update(_dt: number, s: SimState): void {
    const u = s.topology === 'sharded' ? 0.3 + s.util.query * 0.7 : 0.08
    // The balancer: a diagonal wavefront of chunk migrations sweeping the grid.
    const front = (s.t * 6) % (G * 2)
    for (let i = 0; i < COUNT; i++) {
      const gx = i % G
      const gz = (i / G) | 0
      const d = Math.abs(gx + gz - front)
      const active = Math.max(0, 1 - d * 0.55) * u
      const h = 0.4 + active * 2.4
      dummy.position.set(gx * PITCH - HALF, (h * 0.5) / 2, gz * PITCH - HALF)
      dummy.scale.set(1, h, 1)
      dummy.updateMatrix()
      chunks.setMatrixAt(i, dummy.matrix)
      color.copy(base).multiplyScalar(0.18 + active * 0.95)
      chunks.setColorAt(i, color)
    }
    chunks.instanceMatrix.needsUpdate = true
    if (chunks.instanceColor) chunks.instanceColor.needsUpdate = true
    frameMat.emissiveIntensity = 0.1 + u * 0.5
  }

  update(0, { util: { query: 0.6 }, topology: 'sharded', t: 0 } as SimState)
  return { group, update }
}

/** mongot: a separate process with its own index pillars and a sync beacon. */
export function createSearch(def: DistrictDef): DistrictBuild {
  const group = districtGroup(def)
  const rng = makeRng(0x53454e53)

  const pad = new THREE.Mesh(roundedBox(8, 0.4, 8, 0.3), surface(def.color, { emissiveIntensity: 0.12, roughness: 0.7 }))
  pad.position.y = 0.2
  pad.receiveShadow = true
  group.add(pad)

  const pillarMat = surface(def.color, { emissiveIntensity: 0.3, roughness: 0.4 })
  const pillars: THREE.Mesh[] = []
  const spots = [
    [-2, -2],
    [2, -2],
    [-2, 2],
    [2, 2],
    [0, 0],
  ]
  for (const [x, z] of spots) {
    const h = 1.4 + rng() * 0.8
    const p = new THREE.Mesh(roundedBox(1.1, h, 1.1, 0.2), pillarMat.clone())
    p.position.set(x, 0.4 + h / 2, z)
    p.castShadow = true
    group.add(p)
    pillars.push(p)
  }

  // The change-stream sync beacon.
  const beaconMat = glow(def.color, 0.9)
  const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.5, 16, 16), beaconMat)
  beacon.position.y = 4
  group.add(beacon)

  function update(_dt: number, s: SimState): void {
    const wake = s.workload === 'vector-rag' ? 0.9 : s.workload === 'idle' ? 0.15 : 0.35
    const breathe = 0.5 + 0.5 * Math.sin(s.t * 1.4)
    beaconMat.emissiveIntensity = 0.4 + (wake + breathe * 0.3) * 1.1
    beacon.position.y = 4 + breathe * 0.3
    for (let i = 0; i < pillars.length; i++) {
      const m = pillars[i].material as THREE.MeshStandardMaterial
      m.emissiveIntensity = 0.18 + (wake * 0.5 + 0.5 * (0.5 + 0.5 * Math.sin(s.t * 1.4 + i)))
    }
  }

  return { group, update }
}
