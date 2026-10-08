import * as THREE from 'three'
import { COLOR } from '../core/theme'
import type { DistrictDef, SimState } from '../core/types'
import { DistrictBuild, districtGroup, glow, roundedBox, surface } from './build'

/* ============================================================================
 * Below and beside the cache: the disk tier (collection and index files plus
 * the journal ribbon), and the replication tier (oplog ring, primary, and
 * secondaries that only exist when the topology has them).
 * ==========================================================================*/

/** Disk: four collection file stacks, two index file stacks, and a journal ribbon that scrolls towards the files. */
export function createDisk(def: DistrictDef): DistrictBuild {
  const group = districtGroup(def)

  const slab = new THREE.Mesh(roundedBox(20, 0.6, 12, 0.3), surface(def.color, { emissiveIntensity: 0.1, roughness: 0.75 }))
  slab.position.y = 0.3
  slab.receiveShadow = true
  group.add(slab)

  // File stacks: thin plates. Collections are green, index files violet.
  const PLATES = 7
  const stacks: { mats: THREE.MeshStandardMaterial[]; index: boolean }[] = []
  const spots: [number, boolean][] = [[-7.5, false], [-4.5, false], [-1.5, false], [1.5, false], [4.5, true], [7.5, true]]
  for (const [x, index] of spots) {
    const mats: THREE.MeshStandardMaterial[] = []
    for (let p = 0; p < PLATES; p++) {
      const m = surface(index ? COLOR.index : def.color, { emissiveIntensity: 0.2, roughness: 0.5 })
      const plate = new THREE.Mesh(roundedBox(2.2, 0.28, 2.2, 0.08), m)
      plate.position.set(x, 0.75 + p * 0.36, -2.6)
      plate.castShadow = true
      group.add(plate)
      mats.push(m)
    }
    stacks.push({ mats, index })
  }

  // The journal: a ribbon of log segments along the front edge, scrolling east to west towards the files.
  const SEGMENTS = 22
  const segMat = surface(0xffffff, { emissiveIntensity: 0.6, roughness: 0.4 })
  segMat.emissive = new THREE.Color(COLOR.journal)
  const ribbon = new THREE.InstancedMesh(roundedBox(0.7, 0.3, 1.2, 0.06), segMat, SEGMENTS)
  ribbon.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
  ribbon.position.set(0, 0.75, 3.6)
  group.add(ribbon)
  const base = new THREE.Color(COLOR.journal)
  const dummy = new THREE.Object3D()
  const color = new THREE.Color()

  const checkpointMat = glow(def.color, 0.3)
  const checkpointBar = new THREE.Mesh(roundedBox(19, 0.2, 0.4, 0.05), checkpointMat)
  checkpointBar.position.set(0, 0.72, 0.2)
  group.add(checkpointBar)

  function update(_dt: number, s: SimState): void {
    // Journal segments scroll with write pressure; the lit fraction tracks documents in flight.
    const flow = s.t * (1 + s.util.storage * 6)
    const lit = Math.min(1, s.docsInFlight / 2000)
    for (let i = 0; i < SEGMENTS; i++) {
      const phase = ((i + flow) % SEGMENTS) / SEGMENTS
      const on = phase < lit
      dummy.position.set((i - (SEGMENTS - 1) / 2) * 0.85, 0, 0)
      dummy.scale.set(1, on ? 1 + 0.6 * (0.5 + 0.5 * Math.sin(flow + i)) : 0.4, 1)
      dummy.updateMatrix()
      ribbon.setMatrixAt(i, dummy.matrix)
      color.copy(base).multiplyScalar(on ? 0.9 : 0.15)
      ribbon.setColorAt(i, color)
    }
    ribbon.instanceMatrix.needsUpdate = true
    if (ribbon.instanceColor) ribbon.instanceColor.needsUpdate = true
    // A checkpoint sweeps the file stacks roughly every six seconds, brighter the dirtier the cache.
    const cycle = (s.t % 6) / 6
    const sweep = cycle < 0.25 ? 1 - cycle / 0.25 : 0
    checkpointMat.emissiveIntensity = 0.15 + sweep * (0.4 + s.dirtyFraction * 2)
    for (let k = 0; k < stacks.length; k++) {
      const st = stacks[k]
      for (let p = 0; p < st.mats.length; p++) {
        const written = sweep * Math.max(0, 1 - Math.abs(p / PLATES - cycle * 4) * 2)
        st.mats[p].emissiveIntensity = 0.12 + s.util.storage * 0.3 + written * 0.9
      }
    }
  }

  update(0, { util: { storage: 0.5 }, docsInFlight: 800, dirtyFraction: 0.1, t: 0 } as SimState)
  return { group, update }
}

/** Replication: the oplog ring and primary at the district centre, with two secondary nodes that appear with the topology. */
export function createReplication(def: DistrictDef): DistrictBuild {
  const group = districtGroup(def)

  const pad = new THREE.Mesh(roundedBox(10, 0.5, 10, 0.3), surface(def.color, { emissiveIntensity: 0.12, roughness: 0.7 }))
  pad.position.y = 0.25
  pad.receiveShadow = true
  group.add(pad)

  const primaryMat = surface(def.color, { emissiveIntensity: 0.4, roughness: 0.45 })
  const primary = new THREE.Mesh(roundedBox(2.4, 4.2, 2.4, 0.25), primaryMat)
  primary.position.y = 0.5 + 2.1
  primary.castShadow = true
  group.add(primary)

  const ringMat = glow(def.color, 0.7)
  const ring = new THREE.Mesh(new THREE.TorusGeometry(3.4, 0.14, 10, 48), ringMat)
  ring.rotation.x = Math.PI / 2
  ring.position.y = 0.9
  group.add(ring)

  // Secondaries: compact copies of the primary with their own little cache and disk.
  interface Node { root: THREE.Group; mats: THREE.MeshStandardMaterial[] }
  const secondaries: Node[] = []
  for (const z of [-20, 20]) {
    const root = new THREE.Group()
    root.position.set(0, 0, z)
    const mats: THREE.MeshStandardMaterial[] = []
    const plinth = new THREE.Mesh(roundedBox(8, 0.5, 8, 0.3), surface(def.color, { emissiveIntensity: 0.1, roughness: 0.7 }))
    plinth.position.y = 0.25
    plinth.receiveShadow = true
    root.add(plinth)
    const pm = surface(def.color, { emissiveIntensity: 0.2, roughness: 0.45 })
    const member = new THREE.Mesh(roundedBox(2, 3, 2, 0.2), pm)
    member.position.set(-1.8, 2, 0)
    member.castShadow = true
    root.add(member)
    mats.push(pm)
    const cm = surface(COLOR.cache, { emissiveIntensity: 0.3, roughness: 0.5 })
    const cache = new THREE.Mesh(roundedBox(2.4, 0.8, 2.4, 0.15), cm)
    cache.position.set(1.8, 0.9, -1.4)
    root.add(cache)
    mats.push(cm)
    const dm = surface(COLOR.disk, { emissiveIntensity: 0.2, roughness: 0.6 })
    const disk = new THREE.Mesh(roundedBox(2.4, 0.5, 1.6, 0.12), dm)
    disk.position.set(1.8, 0.75, 1.6)
    root.add(disk)
    mats.push(dm)
    group.add(root)
    secondaries.push({ root, mats })
  }

  function update(_dt: number, s: SimState): void {
    const u = s.util.repl
    const replicating = s.topology !== 'standalone'
    ringMat.emissiveIntensity = replicating ? 0.3 + u * 1.3 : 0.08
    primaryMat.emissiveIntensity = 0.3 + u * 0.8
    for (let i = 0; i < secondaries.length; i++) {
      const node = secondaries[i]
      node.root.visible = replicating
      // Secondaries apply the oplog a beat behind the primary.
      const beat = 0.5 + 0.5 * Math.sin(s.t * (2 + u * 6) - (i + 1) * 1.2)
      node.mats[0].emissiveIntensity = 0.12 + u * beat * 1.1
      node.mats[1].emissiveIntensity = 0.2 + u * beat * 0.6
      node.mats[2].emissiveIntensity = 0.15 + s.dirtyFraction * 0.8
    }
  }

  update(0, { util: { repl: 0.5 }, topology: 'replica-set', dirtyFraction: 0.1, t: 0 } as SimState)
  return { group, update }
}
