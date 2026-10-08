import * as THREE from 'three'
import type { DistrictDef, SimState } from '../core/types'
import { makeRng } from '../core/util'
import { DistrictBuild, districtGroup, glow, roundedBox, surface } from './build'

/* ============================================================================
 * Other processes around mongod: the mongos routers with their config servers
 * (sharded only), and the mongot search process.
 * ==========================================================================*/

/** mongos and config servers: three routers in a row and three config-server pillars behind them. Only visible when sharded. */
export function createRouters(def: DistrictDef): DistrictBuild {
  const group = districtGroup(def)

  const pad = new THREE.Mesh(roundedBox(12, 0.4, 8, 0.3), surface(def.color, { emissiveIntensity: 0.1, roughness: 0.7 }))
  pad.position.y = 0.2
  pad.receiveShadow = true
  group.add(pad)

  const routers: THREE.MeshStandardMaterial[] = []
  for (let i = 0; i < 3; i++) {
    const m = surface(def.color, { emissiveIntensity: 0.25, roughness: 0.45 })
    const r = new THREE.Mesh(roundedBox(2.2, 1.2, 2.2, 0.2), m)
    r.position.set(-3.6 + i * 3.6, 1, 1.8)
    r.castShadow = true
    group.add(r)
    routers.push(m)
  }
  const configs: THREE.MeshStandardMaterial[] = []
  for (let i = 0; i < 3; i++) {
    const m = surface(def.color, { emissiveIntensity: 0.15, roughness: 0.5 })
    const c = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.6, 2.6, 8), m)
    c.position.set(-2.6 + i * 2.6, 1.7, -2)
    c.castShadow = true
    group.add(c)
    configs.push(m)
  }

  function update(_dt: number, s: SimState): void {
    group.visible = s.topology === 'sharded'
    for (let i = 0; i < routers.length; i++) routers[i].emissiveIntensity = 0.2 + s.util.query * (0.6 + 0.4 * Math.sin(s.t * 4 + i * 2))
    for (let i = 0; i < configs.length; i++) configs[i].emissiveIntensity = 0.15 + 0.2 * (0.5 + 0.5 * Math.sin(s.t * 1.2 + i))
  }

  update(0, { util: { query: 0.5 }, topology: 'sharded', t: 0 } as SimState)
  return { group, update }
}

/** mongot: a separate process with its own Lucene index pillars and a change-stream sync beacon. */
export function createSearch(def: DistrictDef): DistrictBuild {
  const group = districtGroup(def)
  const rng = makeRng(0x53454e53)

  const pad = new THREE.Mesh(roundedBox(9, 0.4, 9, 0.3), surface(def.color, { emissiveIntensity: 0.1, roughness: 0.7 }))
  pad.position.y = 0.2
  pad.receiveShadow = true
  group.add(pad)

  const pillarMat = surface(def.color, { emissiveIntensity: 0.3, roughness: 0.4 })
  const pillars: THREE.Mesh[] = []
  const spots = [
    [-2.4, -2.4],
    [2.4, -2.4],
    [-2.4, 2.4],
    [2.4, 2.4],
    [0, 0],
  ]
  for (const [x, z] of spots) {
    const h = 1.4 + rng() * 0.8
    const p = new THREE.Mesh(roundedBox(1.2, h, 1.2, 0.2), pillarMat.clone())
    p.position.set(x, 0.4 + h / 2, z)
    p.castShadow = true
    group.add(p)
    pillars.push(p)
  }

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
