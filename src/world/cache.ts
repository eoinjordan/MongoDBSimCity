import * as THREE from 'three'
import { COLOR } from '../core/theme'
import type { DistrictDef, SimState } from '../core/types'
import { makeRng } from '../core/util'
import { DistrictBuild, districtGroup, glow, roundedBox, surface } from './build'

/**
 * The WiredTiger cache. A raised deck carries a grid of pages: the western
 * columns are document pages (green), the eastern third are index pages
 * (violet) with a small B-tree floating above them, because indexes are not a
 * separate component in MongoDB, they are pages in the same cache. Orange pages
 * are dirty. The central column shifts to red as eviction pressure builds past
 * the 80% target towards the 95% trigger.
 */
const GRID = 16
const INDEX_COLS = 5
const N = GRID * GRID
const PITCH = 1.02
const HALF = ((GRID - 1) * PITCH) / 2
const DECK_Y = 2.0

export function createCache(def: DistrictDef): DistrictBuild {
  const group = districtGroup(def)

  const deck = new THREE.Mesh(roundedBox(19, 1.4, 19, 0.4), surface(def.color, { emissiveIntensity: 0.16, roughness: 0.55 }))
  deck.position.y = DECK_Y - 0.7
  deck.castShadow = true
  deck.receiveShadow = true
  group.add(deck)

  const cell = roundedBox(0.82, 1.2, 0.82, 0.12)
  const mat = surface(0xffffff, { emissiveIntensity: 0.5, roughness: 0.4, metalness: 0.2 })
  mat.emissive = new THREE.Color(0xffffff)
  const pages = new THREE.InstancedMesh(cell, mat, N)
  pages.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
  pages.castShadow = true
  pages.position.y = DECK_Y
  group.add(pages)

  const docColor = new THREE.Color(def.color)
  const indexColor = new THREE.Color(COLOR.index)
  const dirtyColor = new THREE.Color(COLOR.dirty)
  const pressureColor = new THREE.Color(COLOR.pressure)
  const rng = makeRng(0x7a11)
  const threshold = new Float32Array(N)
  const dirtyRank = new Float32Array(N)
  const isIndex = new Uint8Array(N)
  const px = new Float32Array(N)
  const pz = new Float32Array(N)
  for (let i = 0; i < N; i++) {
    const gx = i % GRID
    const gz = (i / GRID) | 0
    px[i] = gx * PITCH - HALF
    pz[i] = gz * PITCH - HALF
    isIndex[i] = gx >= GRID - INDEX_COLS ? 1 : 0
    // Pages near the centre fill first, with a little noise.
    const r = Math.hypot(px[i], pz[i]) / HALF
    threshold[i] = Math.min(1, r * 0.85 + rng() * 0.25)
    dirtyRank[i] = rng()
  }

  // A small B-tree over the index pages: root, two internal nodes, four leaves.
  const tree = new THREE.Group()
  const treeX = HALF - ((INDEX_COLS - 1) * PITCH) / 2
  const nodeMat = glow(COLOR.index, 0.8)
  const nodeGeo = roundedBox(0.7, 0.5, 0.7, 0.12)
  const levels: THREE.Vector3[][] = [
    [new THREE.Vector3(0, 7.4, 0)],
    [new THREE.Vector3(-1.6, 6.2, 0), new THREE.Vector3(1.6, 6.2, 0)],
    [new THREE.Vector3(-2.4, 5, -1), new THREE.Vector3(-0.8, 5, 1), new THREE.Vector3(0.8, 5, -1), new THREE.Vector3(2.4, 5, 1)],
  ]
  const edgeMat = new THREE.LineBasicMaterial({ color: COLOR.index, transparent: true, opacity: 0.6 })
  for (let l = 0; l < levels.length; l++) {
    for (let k = 0; k < levels[l].length; k++) {
      const node = new THREE.Mesh(nodeGeo, nodeMat)
      node.position.copy(levels[l][k])
      tree.add(node)
      if (l > 0) {
        const parent = levels[l - 1][k >> 1]
        const geo = new THREE.BufferGeometry().setFromPoints([parent, levels[l][k]])
        tree.add(new THREE.Line(geo, edgeMat))
      }
    }
  }
  tree.position.set(treeX, DECK_Y - 1.4, 0)
  group.add(tree)

  // A central light column: the cache lit from within.
  const columnMat = new THREE.MeshBasicMaterial({ color: def.color, transparent: true, opacity: 0.18, side: THREE.DoubleSide })
  const column = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.9, 6, 20, 1, true), columnMat)
  column.position.set(-2.5, DECK_Y + 2.4, 0)
  group.add(column)

  const dummy = new THREE.Object3D()
  const color = new THREE.Color()

  function update(_dt: number, s: SimState): void {
    const occ = s.cacheOccupancy
    const dirty = s.dirtyFraction
    const indexHeat = 0.5 + 0.5 * s.util.index
    for (let i = 0; i < N; i++) {
      const lit = threshold[i] < occ
      const index = isIndex[i] === 1
      const isDirty = lit && !index && dirtyRank[i] < dirty
      const shimmer = lit ? 0.78 + 0.22 * Math.sin(s.t * 3 + i * 0.7) : 0.16
      const h = lit ? 1 + 1.6 * occ : 0.35
      dummy.position.set(px[i], (h * 1.2) / 2 - 0.6, pz[i])
      dummy.scale.set(1, h, 1)
      dummy.updateMatrix()
      pages.setMatrixAt(i, dummy.matrix)
      color.copy(isDirty ? dirtyColor : index ? indexColor : docColor).multiplyScalar(shimmer * (index ? indexHeat : 1))
      pages.setColorAt(i, color)
    }
    pages.instanceMatrix.needsUpdate = true
    if (pages.instanceColor) pages.instanceColor.needsUpdate = true
    nodeMat.emissiveIntensity = 0.4 + s.util.index * 1.2
    // Eviction pressure: the column shifts towards red between the 80% target and the 95% trigger.
    const pressure = Math.max(0, Math.min(1, (occ - 0.8) / 0.15))
    columnMat.color.copy(docColor).lerp(pressureColor, pressure)
    columnMat.opacity = 0.1 + 0.16 * occ + 0.2 * pressure
  }

  update(0, { cacheOccupancy: 0.4, dirtyFraction: 0.1, util: { index: 0.5 }, t: 0 } as SimState)
  return { group, update }
}
