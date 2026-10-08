import * as THREE from 'three'
import { COLOR } from '../core/theme'
import type { SimState } from '../core/types'
import { reduceMotion } from '../core/util'
import { districtById } from '../world/districts'

/**
 * The dataflow. Colour is meaning: cyan is documents being read (client ->
 * query engine -> indexes -> cache -> client), orange is writes landing in the
 * cache and the journal, amber is the oplog reaching the secondaries, green is
 * change streams feeding mongot and agents, grey is checkpoints flushing dirty
 * pages to disk, and pink is the balancer moving chunks. Particle speed tracks
 * the matching utilisation, so a busy query engine visibly pulls harder.
 */
interface FlowSpec {
  color: number
  points: THREE.Vector3[]
  count: number
  size: number
  speedOf: (s: SimState) => number
}

interface Flow {
  curve: THREE.CatmullRomCurve3
  mesh: THREE.InstancedMesh
  count: number
  size: number
  phase: number
  speedOf: (s: SimState) => number
}

function pos(id: string, y: number): THREE.Vector3 {
  return districtById(id)!.pos.clone().setY(y)
}

/** Where the three bits of context outside the city sit. Shared with main.ts labels. */
export const CONTEXT = {
  applications: new THREE.Vector3(0, 2.6, -46),
  secondaries: new THREE.Vector3(52, 2.6, 0),
  disk: new THREE.Vector3(0, 1.5, 52),
}

export interface FlowField {
  object: THREE.Group
  update(dt: number, s: SimState): void
  reset(): void
}

export function createFlows(): FlowField {
  const object = new THREE.Group()

  const specs: FlowSpec[] = [
    // Documents read: applications -> query engine -> indexes -> cache -> back out.
    {
      color: COLOR.document,
      count: 22,
      size: 0.42,
      speedOf: (s) => 0.2 + s.util.query,
      points: [CONTEXT.applications.clone(), pos('query', 3), pos('indexes', 3), new THREE.Vector3(0, 8, 0), pos('clients', 2.5), CONTEXT.applications.clone()],
    },
    // Writes: applications -> query engine -> cache -> journal.
    {
      color: COLOR.write,
      count: 16,
      size: 0.4,
      speedOf: (s) => 0.15 + s.util.storage * 0.9,
      points: [CONTEXT.applications.clone(), pos('query', 3), new THREE.Vector3(0, 5, -12), pos('cache', 3), new THREE.Vector3(0, 4, 13), pos('journal', 2)],
    },
    // Oplog: cache -> replication -> the secondaries beyond the city.
    {
      color: COLOR.oplog,
      count: 12,
      size: 0.34,
      speedOf: (s) => (s.topology === 'standalone' ? 0.04 : 0.12 + s.util.repl * 0.9),
      points: [pos('cache', 3), new THREE.Vector3(13, 5, 0), pos('replication', 3), CONTEXT.secondaries.clone()],
    },
    // Change streams: replication -> mongot search, and on to agents.
    {
      color: COLOR.changeStream,
      count: 10,
      size: 0.32,
      speedOf: (s) => (s.workload === 'vector-rag' ? 0.7 : 0.12 + s.util.repl * 0.4),
      points: [pos('replication', 3), new THREE.Vector3(26, 6, 13), pos('search', 2.5)],
    },
    // Checkpoints: dirty pages flushed from the cache through the journal yard to disk.
    {
      color: COLOR.checkpoint,
      count: 10,
      size: 0.32,
      speedOf: (s) => 0.08 + s.dirtyFraction * 1.6,
      points: [pos('cache', 3), new THREE.Vector3(0, 5, 14), pos('journal', 1.8), CONTEXT.disk.clone()],
    },
    // Balancer: chunk migrations between the sharding layer and the data.
    {
      color: COLOR.chunk,
      count: 8,
      size: 0.3,
      speedOf: (s) => (s.topology === 'sharded' ? 0.3 + s.util.query * 0.5 : 0.03),
      points: [pos('sharding', 2.5), new THREE.Vector3(12, 6, -12), pos('cache', 3)],
    },
  ]

  const flows: Flow[] = specs.map((spec, fi) => {
    const curve = new THREE.CatmullRomCurve3(spec.points, false, 'catmullrom', 0.5)
    const geo = new THREE.SphereGeometry(spec.size, 12, 12)
    const mat = new THREE.MeshStandardMaterial({
      color: spec.color,
      emissive: spec.color,
      emissiveIntensity: 1.2,
      metalness: 0.1,
      roughness: 0.3,
    })
    const mesh = new THREE.InstancedMesh(geo, mat, spec.count)
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    object.add(mesh)
    // Deterministic phase spread so a reset reproduces the same animation.
    return { curve, mesh, count: spec.count, size: spec.size, phase: fi * 0.13, speedOf: spec.speedOf }
  })

  const dummy = new THREE.Object3D()

  function reset(): void {
    for (let fi = 0; fi < flows.length; fi++) flows[fi].phase = fi * 0.13
  }

  function update(dt: number, s: SimState): void {
    // Re-checked each frame so a runtime change to the motion preference is honoured.
    const still = reduceMotion()
    for (const flow of flows) {
      if (!still) flow.phase = (flow.phase + flow.speedOf(s) * dt * 0.12) % 1
      for (let i = 0; i < flow.count; i++) {
        const frac = (flow.phase + i / flow.count) % 1
        const p = flow.curve.getPointAt(frac)
        // A gentle size pulse so packets read as moving even when slow.
        const pulse = 0.8 + 0.35 * Math.sin(s.t * 6 + i)
        dummy.position.copy(p)
        dummy.scale.setScalar(pulse)
        dummy.updateMatrix()
        flow.mesh.setMatrixAt(i, dummy.matrix)
      }
      flow.mesh.instanceMatrix.needsUpdate = true
    }
  }

  update(0, {
    util: { query: 0.5, index: 0.5, storage: 0.5, repl: 0.5 }, cacheOccupancy: 0.5, dirtyFraction: 0.1, t: 0,
    workload: 'oltp', topology: 'replica-set',
  } as SimState)
  return { object, update, reset }
}
