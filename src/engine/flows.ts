import * as THREE from 'three'
import { COLOR } from '../core/theme'
import type { SimState } from '../core/types'
import { reduceMotion } from '../core/util'
import { districtById } from '../world/districts'

/**
 * The dataflow. The unit of motion is a document: a small rounded BSON slab,
 * not a sphere. Pale green documents are reads coming back through the gates;
 * orange ones are writes heading for the cache and the journal; violet cubes
 * are index keys handed from the cache's B-trees to the planner; amber is the
 * oplog reaching the secondaries; lime is change streams feeding mongot and
 * the agents; grey-green is checkpoints flushing dirty pages to disk; pink is
 * mongos routing when sharded. Particle speed tracks the matching utilisation.
 */
type Shape = 'document' | 'key' | 'entry'

interface FlowSpec {
  color: number
  shape: Shape
  points: THREE.Vector3[]
  count: number
  size: number
  speedOf: (s: SimState) => number
  /** Hidden when false: flows that only exist in some topologies. */
  activeIn?: (s: SimState) => boolean
}

interface Flow {
  curve: THREE.CatmullRomCurve3
  mesh: THREE.InstancedMesh
  count: number
  phase: number
  speedOf: (s: SimState) => number
  activeIn?: (s: SimState) => boolean
}

function pos(id: string, y: number, dz = 0): THREE.Vector3 {
  return districtById(id)!.pos.clone().setY(y).add(new THREE.Vector3(0, 0, dz))
}

function geometryFor(shape: Shape, size: number): THREE.BufferGeometry {
  if (shape === 'document') return new THREE.BoxGeometry(size * 1.2, size * 0.5, size * 1.6)
  if (shape === 'key') return new THREE.BoxGeometry(size, size, size)
  return new THREE.SphereGeometry(size * 0.55, 10, 10)
}

export interface FlowField {
  object: THREE.Group
  update(dt: number, s: SimState): void
  reset(): void
}

export function createFlows(): FlowField {
  const object = new THREE.Group()

  const specs: FlowSpec[] = [
    // Reads: application -> gates -> pipeline -> cache, and the documents come back on a higher arc.
    {
      color: COLOR.document, shape: 'document', count: 24, size: 0.6,
      speedOf: (s) => 0.2 + s.util.query,
      points: [pos('clients', 2.5, 2), pos('gateway', 2.6, 2), pos('query', 2.8, 2), pos('cache', 4, 0), pos('query', 7, -2), pos('gateway', 7.5, -2), pos('clients', 3.5, -2)],
    },
    // Writes: application -> gates -> pipeline -> cache -> journal on disk.
    {
      color: COLOR.write, shape: 'document', count: 16, size: 0.55,
      speedOf: (s) => 0.15 + s.util.storage * 0.9,
      points: [pos('clients', 2.2, 3.5), pos('gateway', 2.2, 3.5), pos('query', 2.4, 3.5), pos('cache', 3.6, 2), pos('cache', 2.5, 12), pos('disk', 1.4, -4)],
    },
    // Index keys: the B-trees in the cache answer the planner.
    {
      color: COLOR.indexKey, shape: 'key', count: 12, size: 0.3,
      speedOf: (s) => 0.2 + s.util.index * 1.2,
      points: [pos('cache', 6.5, 0).add(new THREE.Vector3(5.5, 0, 0)), new THREE.Vector3(4, 8, 0), pos('query', 3.5, 0)],
    },
    // Oplog: cache -> oplog ring -> each secondary.
    {
      color: COLOR.oplog, shape: 'entry', count: 10, size: 0.5,
      speedOf: (s) => 0.12 + s.util.repl * 0.9,
      activeIn: (s) => s.topology !== 'standalone',
      points: [pos('cache', 3, 0), new THREE.Vector3(30, 5, 0), pos('replication', 3, 0), pos('replication', 2.2, -20)],
    },
    {
      color: COLOR.oplog, shape: 'entry', count: 10, size: 0.5,
      speedOf: (s) => 0.12 + s.util.repl * 0.9,
      activeIn: (s) => s.topology !== 'standalone',
      points: [pos('cache', 3, 0), new THREE.Vector3(30, 5, 0), pos('replication', 3, 0), pos('replication', 2.2, 20)],
    },
    // Change streams: oplog -> mongot, and oplog -> the agents.
    {
      color: COLOR.changeStream, shape: 'entry', count: 10, size: 0.45,
      speedOf: (s) => (s.workload === 'vector-rag' ? 0.7 : 0.12 + s.util.repl * 0.4),
      points: [pos('replication', 3, 0), new THREE.Vector3(32, 7, -16), pos('mongot', 3, 0)],
    },
    {
      color: COLOR.changeStream, shape: 'entry', count: 8, size: 0.4,
      speedOf: (s) => 0.1 + s.util.repl * 0.4,
      points: [pos('replication', 3.5, 0), new THREE.Vector3(0, 11, -8), pos('clients', 3, -3)],
    },
    // Checkpoints: dirty pages flushed from the cache down to the data files.
    {
      color: COLOR.checkpoint, shape: 'entry', count: 10, size: 0.45,
      speedOf: (s) => 0.08 + s.dirtyFraction * 1.6,
      points: [pos('cache', 3, 4), new THREE.Vector3(12, 4, 14), pos('disk', 1.2, -3)],
    },
    // mongos routing in front of the gates, sharded only.
    {
      color: COLOR.route, shape: 'document', count: 10, size: 0.5,
      speedOf: (s) => 0.25 + s.util.query * 0.6,
      activeIn: (s) => s.topology === 'sharded',
      points: [pos('clients', 2.6, -4), pos('mongos', 2.4, 4), pos('gateway', 3.2, -4), pos('query', 2.8, -2)],
    },
  ]

  const flows: Flow[] = specs.map((spec, fi) => {
    const curve = new THREE.CatmullRomCurve3(spec.points, false, 'catmullrom', 0.5)
    const geo = geometryFor(spec.shape, spec.size)
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
    return { curve, mesh, count: spec.count, phase: fi * 0.13, speedOf: spec.speedOf, activeIn: spec.activeIn }
  })

  const dummy = new THREE.Object3D()
  const tangent = new THREE.Vector3()

  function reset(): void {
    for (let fi = 0; fi < flows.length; fi++) flows[fi].phase = fi * 0.13
  }

  function update(dt: number, s: SimState): void {
    // Re-checked each frame so a runtime change to the motion preference is honoured.
    const still = reduceMotion()
    for (const flow of flows) {
      flow.mesh.visible = flow.activeIn ? flow.activeIn(s) : true
      if (!still) flow.phase = (flow.phase + flow.speedOf(s) * dt * 0.12) % 1
      for (let i = 0; i < flow.count; i++) {
        const frac = (flow.phase + i / flow.count) % 1
        const p = flow.curve.getPointAt(frac)
        // Documents face along their path; a gentle size pulse keeps slow ones readable.
        const pulse = 0.8 + 0.35 * Math.sin(s.t * 6 + i)
        dummy.position.copy(p)
        flow.curve.getTangentAt(frac, tangent)
        dummy.lookAt(p.clone().add(tangent))
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
