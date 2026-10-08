import * as THREE from 'three'
import type { DistrictId, SimState } from '../core/types'
import { DistrictBuild } from './build'
import { createCache } from './cache'
import { DISTRICTS, districtById } from './districts'
import { createGround } from './ground'
import { createClients, createGateway, createQueryPipeline } from './path'
import { createRouters, createSearch } from './processes'
import { createDisk, createReplication } from './storage'

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
  clients: 7.5,
  gateway: 5.5,
  mongos: 4.5,
  query: 4.2,
  cache: 10,
  disk: 4.2,
  replication: 6.5,
  mongot: 6,
}

export function createCity(): CityHandle {
  const object = new THREE.Group()
  object.add(createGround())

  const def = (id: DistrictId) => districtById(id)!
  const builds: DistrictBuild[] = [
    createClients(def('clients')),
    createGateway(def('gateway')),
    createRouters(def('mongos')),
    createQueryPipeline(def('query')),
    createCache(def('cache')),
    createDisk(def('disk')),
    createReplication(def('replication')),
    createSearch(def('mongot')),
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
