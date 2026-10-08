import * as THREE from 'three'
import type { DistrictDef, SimState } from '../core/types'
import { DistrictBuild, districtGroup, glow, roundedBox, surface } from './build'

/* ============================================================================
 * The cache's four neighbours. Each reads its own utilisation from the sim and
 * shows it as motion: the query planner's ring spins, index lanes ripple like a
 * B-tree being walked, the replica set's secondaries pulse as the oplog reaches
 * them, and the journal scrolls log segments towards disk.
 * ==========================================================================*/

/** Query engine: a control tower with a spinning planner ring. */
export function createQueryEngine(def: DistrictDef): DistrictBuild {
  const group = districtGroup(def)

  const heights = [3.2, 2.4, 1.8]
  let y = 0.6
  for (let i = 0; i < heights.length; i++) {
    const w = 5 - i * 1.1
    const box = new THREE.Mesh(roundedBox(w, heights[i], w, 0.2), surface(def.color, { emissiveIntensity: 0.16 }))
    box.position.y = y + heights[i] / 2
    box.castShadow = true
    group.add(box)
    y += heights[i]
  }

  const ringMat = glow(def.color, 0.8)
  const ring = new THREE.Mesh(new THREE.TorusGeometry(2.2, 0.16, 12, 40), ringMat)
  ring.rotation.x = Math.PI / 2
  ring.position.y = y + 0.6
  group.add(ring)

  let previousTime = 0
  function update(dt: number, s: SimState): void {
    if (s.t < previousTime || s.t === 0) ring.rotation.z = 0
    if (s.t > previousTime) ring.rotation.z += dt * (0.4 + s.util.query * 5)
    previousTime = s.t
    ringMat.emissiveIntensity = 0.4 + s.util.query * 1.4
  }

  return { group, update }
}

/** Indexes: a bank of ordered key lanes that ripple as B-trees are walked. */
export function createIndexes(def: DistrictDef): DistrictBuild {
  const group = districtGroup(def)

  const COLS = 8
  const ROWS = 4
  const COUNT = COLS * ROWS
  const PITCH = 1.15
  const geo = roundedBox(0.7, 1, 0.7, 0.1)
  const mat = surface(0xffffff, { emissiveIntensity: 0.55, roughness: 0.4 })
  mat.emissive = new THREE.Color(def.color)
  const lanes = new THREE.InstancedMesh(geo, mat, COUNT)
  lanes.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
  lanes.castShadow = true
  group.add(lanes)

  const base = new THREE.Color(def.color)
  const px = new Float32Array(COUNT)
  const pz = new Float32Array(COUNT)
  for (let i = 0; i < COUNT; i++) {
    const c = i % COLS
    const r = (i / COLS) | 0
    px[i] = c * PITCH - ((COLS - 1) * PITCH) / 2
    pz[i] = r * PITCH - ((ROWS - 1) * PITCH) / 2
  }

  const dummy = new THREE.Object3D()
  const color = new THREE.Color()

  function update(_dt: number, s: SimState): void {
    const u = s.util.index
    for (let i = 0; i < COUNT; i++) {
      const c = i % COLS
      // A wave travelling along the keys; amplitude scales with utilisation.
      const wave = 0.5 + 0.5 * Math.sin(s.t * 4 - c * 0.7)
      const h = 0.6 + u * (1.5 + wave * 3.2)
      dummy.position.set(px[i], h / 2, pz[i])
      dummy.scale.set(1, h, 1)
      dummy.updateMatrix()
      lanes.setMatrixAt(i, dummy.matrix)
      color.copy(base).multiplyScalar(0.25 + u * wave * 0.85)
      lanes.setColorAt(i, color)
    }
    lanes.instanceMatrix.needsUpdate = true
    if (lanes.instanceColor) lanes.instanceColor.needsUpdate = true
  }

  update(0, { util: { index: 0.4 }, t: 0 } as SimState)
  return { group, update }
}

/** Replication: a primary and two secondaries joined by the oplog ring. */
export function createReplication(def: DistrictDef): DistrictBuild {
  const group = districtGroup(def)

  const pad = new THREE.Mesh(roundedBox(12, 0.5, 9, 0.3), surface(def.color, { emissiveIntensity: 0.12, roughness: 0.7 }))
  pad.position.y = 0.25
  pad.receiveShadow = true
  group.add(pad)

  const members: { mesh: THREE.Mesh; mat: THREE.MeshStandardMaterial; primary: boolean }[] = []
  const spots: [number, number, boolean][] = [
    [0, -2, true],
    [-3.8, 2, false],
    [3.8, 2, false],
  ]
  for (const [x, z, primary] of spots) {
    const h = primary ? 4.2 : 3
    const mat = surface(def.color, { emissiveIntensity: primary ? 0.4 : 0.2, roughness: 0.45 })
    const mesh = new THREE.Mesh(roundedBox(2.2, h, 2.2, 0.25), mat)
    mesh.position.set(x, 0.5 + h / 2, z)
    mesh.castShadow = true
    group.add(mesh)
    members.push({ mesh, mat, primary })
  }

  const ringMat = glow(def.color, 0.7)
  const ring = new THREE.Mesh(new THREE.TorusGeometry(4.2, 0.14, 10, 48), ringMat)
  ring.rotation.x = Math.PI / 2
  ring.position.y = 0.9
  group.add(ring)

  function update(_dt: number, s: SimState): void {
    const u = s.util.repl
    const replicating = s.topology !== 'standalone'
    ringMat.emissiveIntensity = replicating ? 0.3 + u * 1.3 : 0.08
    for (let i = 0; i < members.length; i++) {
      const m = members[i]
      if (m.primary) {
        m.mat.emissiveIntensity = 0.3 + u * 0.8
        continue
      }
      // Secondaries lag the primary by a beat; dim and still in a standalone.
      const beat = 0.5 + 0.5 * Math.sin(s.t * (2 + u * 6) - i * 1.2)
      m.mat.emissiveIntensity = replicating ? 0.12 + u * beat * 1.1 : 0.04
      m.mesh.scale.y = replicating ? 1 : 0.6
      m.mesh.position.y = 0.5 + (3 * m.mesh.scale.y) / 2
    }
  }

  update(0, { util: { repl: 0.5 }, topology: 'replica-set', t: 0 } as SimState)
  return { group, update }
}

/** Journal and checkpoints: a yard of log segments scrolling towards disk. */
export function createJournal(def: DistrictDef): DistrictBuild {
  const group = districtGroup(def)

  const G = 14
  const COUNT = G * G
  const PITCH = 0.86
  const HALF = ((G - 1) * PITCH) / 2

  const pad = new THREE.Mesh(roundedBox(G * PITCH + 1.6, 0.4, G * PITCH + 1.6, 0.3), surface(def.color, { emissiveIntensity: 0.12, roughness: 0.7 }))
  pad.position.y = 0.2
  pad.receiveShadow = true
  group.add(pad)

  const geo = roundedBox(0.66, 0.22, 0.66, 0.06)
  const mat = surface(0xffffff, { emissiveIntensity: 0.6, roughness: 0.4 })
  mat.emissive = new THREE.Color(def.color)
  const segments = new THREE.InstancedMesh(geo, mat, COUNT)
  segments.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
  group.add(segments)

  const base = new THREE.Color(def.color)
  const dirtyColor = new THREE.Color(0xff8a3d)
  const dummy = new THREE.Object3D()
  const color = new THREE.Color()

  function update(_dt: number, s: SimState): void {
    const frac = Math.max(0, Math.min(1, s.docsInFlight / 2000))
    for (let i = 0; i < COUNT; i++) {
      const gx = i % G
      const gz = (i / G) | 0
      // Segments fill from the cache side (north) towards disk (south).
      const resident = gz / G < frac
      const scroll = 0.5 + 0.5 * Math.sin(s.t * 5 - gz * 0.6 - gx * 0.15)
      const b = resident ? 0.35 + scroll * 0.6 : 0.08
      const h = resident ? 0.6 + scroll * 1.1 : 0.35
      dummy.position.set(gx * PITCH - HALF, 0.5, gz * PITCH - HALF)
      dummy.scale.set(1, h, 1)
      dummy.updateMatrix()
      segments.setMatrixAt(i, dummy.matrix)
      color.copy(base).lerp(dirtyColor, resident ? s.dirtyFraction : 0).multiplyScalar(b)
      segments.setColorAt(i, color)
    }
    segments.instanceMatrix.needsUpdate = true
    if (segments.instanceColor) segments.instanceColor.needsUpdate = true
  }

  update(0, { docsInFlight: 400, dirtyFraction: 0.1, t: 0 } as SimState)
  return { group, update }
}
