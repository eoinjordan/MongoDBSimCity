import * as THREE from 'three'
import { COLOR } from '../core/theme'
import { DISTRICTS } from './districts'

/**
 * The floor: a dark plane, a faint grid, and the storage engine's rails — from
 * the central cache to the four parts of mongod that read and write it. The
 * corners are connected by dataflow, not rails: they are other tiers and
 * processes, not pieces of the storage engine.
 */
export const RAIL_TARGETS = ['query', 'indexes', 'replication', 'journal'] as const

export function createGround(): THREE.Group {
  const group = new THREE.Group()

  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(200, 200),
    new THREE.MeshStandardMaterial({ color: COLOR.ground, metalness: 0.2, roughness: 0.9 }),
  )
  floor.rotation.x = -Math.PI / 2
  floor.position.y = -0.02
  floor.receiveShadow = true
  group.add(floor)

  const grid = new THREE.GridHelper(200, 80, COLOR.grid, COLOR.grid)
  const gridMat = grid.material as THREE.Material
  gridMat.transparent = true
  gridMat.opacity = 0.35
  group.add(grid)

  const cache = DISTRICTS.find((d) => d.id === 'cache')!
  const railMat = new THREE.MeshStandardMaterial({
    color: COLOR.bus,
    emissive: COLOR.document,
    emissiveIntensity: 0.25,
    metalness: 0.4,
    roughness: 0.4,
  })
  for (const d of DISTRICTS) {
    if (!(RAIL_TARGETS as readonly string[]).includes(d.id)) continue
    const a = cache.pos
    const b = d.pos
    const dx = b.x - a.x
    const dz = b.z - a.z
    const len = Math.hypot(dx, dz)
    const rail = new THREE.Mesh(new THREE.BoxGeometry(len, 0.08, 0.5), railMat)
    rail.position.set((a.x + b.x) / 2, 0.05, (a.z + b.z) / 2)
    rail.rotation.y = -Math.atan2(dz, dx)
    group.add(rail)
  }

  return group
}
