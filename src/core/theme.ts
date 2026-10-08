/**
 * A green city. Everything structural leans on MongoDB's greens; the few warm
 * colours are reserved for things that are genuinely different in kind: gold for
 * the auth gates, orange for writes, amber for the oplog, pink for routers.
 * Colour is meaning, never decoration.
 */
export const COLOR = {
  ground: 0x06201a,
  grid: 0x12463a,
  bus: 0x1f6b55,
  // Districts
  clients: 0x9ad8c0,
  gateway: 0xe8c547,
  mongos: 0xff5db1,
  query: 0x2dd4bf,
  cache: 0x00ed64,
  disk: 0x0f9d6c,
  repl: 0xffb020,
  mongot: 0xb1ff05,
  // Things inside districts
  index: 0x9b6cff,
  journal: 0x22d3ee,
  dirty: 0xff8a3d,
  pressure: 0xff4d4d,
  // Dataflow
  document: 0x8ff7c4,
  write: 0xff8a3d,
  indexKey: 0x9b6cff,
  oplog: 0xffb020,
  changeStream: 0xb1ff05,
  checkpoint: 0x7fb8a4,
  route: 0xff5db1,
} as const
