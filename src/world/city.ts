import * as THREE from 'three'
import type { DistrictId, SimState } from '../core/types'
import { DistrictBuild } from './build'
import { createCache } from './cache'
import { createSearch, createSharding, createTier } from './deployment'
import { DISTRICTS, districtById } from './districts'
import { createIndexes, createJournal, createQueryEngine, createReplication } from './engines'
import { createGround } from './ground'

export interface CityLabel {
  id: DistrictId
  name: string
  position: THREE.Vector3
}

export interface CityHandle {
  object: THREE.Group
  pickables: THREE.Object3D[]
  labels: CityLabel[]
  update(dt: number, s: SimState): void
}

/** Height above each district centre at which its floating label sits. */
const LABEL_Y: Record<DistrictId, number> = {
  cache: 9,
  query: 9.5,
  indexes: 6,
  replication: 6.5,
  journal: 3,
  clients: 3.5,
  sharding: 4,
  security: 3.5,
  search: 6,
}

export function createCity(): CityHandle {
  const object = new THREE.Group()
  object.add(createGround())

  const def = (id: DistrictId) => districtById(id)!
  const builds: DistrictBuild[] = [
    createCache(def('cache')),
    createQueryEngine(def('query')),
    createIndexes(def('indexes')),
    createReplication(def('replication')),
    createJournal(def('journal')),
    createTier(def('clients'), (s) => (s.workload === 'idle' ? 0.08 : 0.3 + s.util.query * 0.5)),
    createSharding(def('sharding')),
    createTier(def('security'), (s) => (s.workload === 'idle' ? 0.06 : 0.2 + s.util.query * 0.35)),
    createSearch(def('search')),
  ]

  const pickables: THREE.Object3D[] = []
  for (const b of builds) {
    object.add(b.group)
    pickables.push(b.group)
  }

  const labels: CityLabel[] = DISTRICTS.map((d) => ({
    id: d.id,
    name: d.name,
    position: d.pos.clone().setY(LABEL_Y[d.id]),
  }))

  function update(dt: number, s: SimState): void {
    for (const b of builds) b.update(dt, s)
  }

  return { object, pickables, labels, update }
}
