import * as THREE from 'three'
import type { DistrictDef, SimState } from '../core/types'
import { makeRng } from '../core/util'
import { DistrictBuild, districtGroup, roundedBox, surface } from './build'

/**
 * The WiredTiger cache — the plaza at the centre of the city. A raised deck
 * carries a grid of pages; the fraction lit tracks cache occupancy, the orange
 * ones are dirty (modified, waiting for a checkpoint), and the central column
 * reddens as eviction pressure builds past the 80% target.
 */
const GRID = 16
const N = GRID * GRID
const PITCH = 1.02
const HALF = ((GRID - 1) * PITCH) / 2
const DECK_Y = 2.0
const DIRTY = new THREE.Color(0xff8a3d)
const PRESSURE = new THREE.Color(0xff4d4d)

export function createCache(def: DistrictDef): DistrictBuild {
  const group = districtGroup(def)

  const deck = new THREE.Mesh(roundedBox(19, 1.4, 19, 0.4), surface(def.color, { emissiveIntensity: 0.16, roughness: 0.55 }))
  deck.position.y = DECK_Y - 0.7
  deck.castShadow = true
  deck.receiveShadow = true
  group.add(deck)

  const cell = roundedBox(0.82, 1.2, 0.82, 0.12)
  const mat = surface(0xffffff, { emissiveIntensity: 0.5, roughness: 0.4, metalness: 0.2 })
  mat.emissive = new THREE.Color(def.color)
  const pages = new THREE.InstancedMesh(cell, mat, N)
  pages.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
  pages.castShadow = true
  pages.position.y = DECK_Y
  group.add(pages)

  const base = new THREE.Color(def.color)
  const rng = makeRng(0x7a11)
  const threshold = new Float32Array(N)
  const dirtyRank = new Float32Array(N)
  const px = new Float32Array(N)
  const pz = new Float32Array(N)
  for (let i = 0; i < N; i++) {
    const gx = i % GRID
    const gz = (i / GRID) | 0
    px[i] = gx * PITCH - HALF
    pz[i] = gz * PITCH - HALF
    // Pages near the centre fill first, with a little noise.
    const r = Math.hypot(px[i], pz[i]) / HALF
    threshold[i] = Math.min(1, r * 0.85 + rng() * 0.25)
    dirtyRank[i] = rng()
  }

  // A central light column: the cache literally lit from within.
  const columnMat = new THREE.MeshBasicMaterial({ color: def.color, transparent: true, opacity: 0.18, side: THREE.DoubleSide })
  const column = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.9, 6, 20, 1, true), columnMat)
  column.position.y = DECK_Y + 2.4
  group.add(column)

  const dummy = new THREE.Object3D()
  const color = new THREE.Color()

  function update(_dt: number, s: SimState): void {
    const occ = s.cacheOccupancy
    const dirty = s.dirtyFraction
    for (let i = 0; i < N; i++) {
      const lit = threshold[i] < occ
      const isDirty = lit && dirtyRank[i] < dirty
      const shimmer = lit ? 0.78 + 0.22 * Math.sin(s.t * 3 + i * 0.7) : 0.16
      const h = lit ? 1 + 1.6 * occ : 0.35
      dummy.position.set(px[i], (h * 1.2) / 2 - 0.6, pz[i])
      dummy.scale.set(1, h, 1)
      dummy.updateMatrix()
      pages.setMatrixAt(i, dummy.matrix)
      color.copy(isDirty ? DIRTY : base).multiplyScalar(shimmer)
      pages.setColorAt(i, color)
    }
    pages.instanceMatrix.needsUpdate = true
    if (pages.instanceColor) pages.instanceColor.needsUpdate = true
    // Eviction pressure: the column shifts towards red between the 80% target and the 95% trigger.
    const pressure = Math.max(0, Math.min(1, (occ - 0.8) / 0.15))
    columnMat.color.copy(base).lerp(PRESSURE, pressure)
    columnMat.opacity = 0.1 + 0.16 * occ + 0.2 * pressure
  }

  update(0, { cacheOccupancy: 0.4, dirtyFraction: 0.1, t: 0 } as SimState)
  return { group, update }
}
