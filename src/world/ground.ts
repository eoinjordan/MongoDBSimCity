import * as THREE from 'three'
import { COLOR } from '../core/theme'
import { districtById, REQUEST_PATH } from './districts'

/**
 * The floor: a dark evergreen plane, a faint grid, the request road running
 * west to east through the districts in request order, and three side rails
 * from the cache: down to disk, up to mongot, and from the oplog out to each
 * secondary.
 */
export const SIDE_RAILS: [string, string][] = [['cache', 'disk'], ['cache', 'mongot']]

export function createGround(): THREE.Group {
  const group = new THREE.Group()

  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(240, 200),
    new THREE.MeshStandardMaterial({ color: COLOR.ground, metalness: 0.2, roughness: 0.9 }),
  )
  floor.rotation.x = -Math.PI / 2
  floor.position.y = -0.02
  floor.receiveShadow = true
  group.add(floor)

  const grid = new THREE.GridHelper(240, 96, COLOR.grid, COLOR.grid)
  const gridMat = grid.material as THREE.Material
  gridMat.transparent = true
  gridMat.opacity = 0.35
  group.add(grid)

  const railMat = new THREE.MeshStandardMaterial({
    color: COLOR.bus,
    emissive: COLOR.document,
    emissiveIntensity: 0.25,
    metalness: 0.4,
    roughness: 0.4,
  })
  const rail = (a: THREE.Vector3, b: THREE.Vector3, width: number) => {
    const dx = b.x - a.x
    const dz = b.z - a.z
    const len = Math.hypot(dx, dz)
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(len, 0.08, width), railMat)
    mesh.position.set((a.x + b.x) / 2, 0.05, (a.z + b.z) / 2)
    mesh.rotation.y = -Math.atan2(dz, dx)
    group.add(mesh)
  }

  // The request road.
  for (let i = 0; i < REQUEST_PATH.length - 1; i++) {
    rail(districtById(REQUEST_PATH[i])!.pos, districtById(REQUEST_PATH[i + 1])!.pos, 1.2)
  }
  // Side rails.
  for (const [from, to] of SIDE_RAILS) rail(districtById(from)!.pos, districtById(to)!.pos, 0.5)
  // Oplog rails to the two secondaries.
  const repl = districtById('replication')!.pos
  for (const z of [-20, 20]) rail(repl, repl.clone().setZ(z), 0.5)

  return group
}
