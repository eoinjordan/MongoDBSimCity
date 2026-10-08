/**
 * Small, pure, checkable pieces of MongoDB's memory story. These are the only
 * places in the model where a real documented number is used as a rule rather
 * than as an illustrative scale, and docs/verification.md works each one by hand.
 *
 *  - WiredTiger eviction thresholds (defaults): eviction_target 80%,
 *    eviction_trigger 95%, eviction_dirty_target 5%, eviction_dirty_trigger 20%.
 *  - Default WiredTiger cache size: the larger of 50% of (RAM - 1 GB) and 256 MB.
 *  - MongoDB 9.0 per-operation memory limit: the larger of 1 GB and 20% of the
 *    memory available to the server process.
 *  - MongoDB 9.0 maxConcurrentMultiDocumentTransactions default: 10,000.
 */

export interface EvictionThresholds {
  evictionTarget: number
  evictionTrigger: number
  dirtyTarget: number
  dirtyTrigger: number
}

export const WIREDTIGER_DEFAULTS: EvictionThresholds = {
  evictionTarget: 0.8,
  evictionTrigger: 0.95,
  dirtyTarget: 0.05,
  dirtyTrigger: 0.2,
}

export const MAX_CONCURRENT_MULTI_DOCUMENT_TRANSACTIONS = 10_000

const GiB = 1024 ** 3

function unit(value: number, name: string): number {
  if (!Number.isFinite(value) || value < 0 || value > 1) throw new RangeError(`${name} must be a finite fraction between 0 and 1`)
  return value
}

export function validateThresholds(t: EvictionThresholds): EvictionThresholds {
  unit(t.evictionTarget, 'evictionTarget')
  unit(t.evictionTrigger, 'evictionTrigger')
  unit(t.dirtyTarget, 'dirtyTarget')
  unit(t.dirtyTrigger, 'dirtyTrigger')
  if (t.evictionTarget >= t.evictionTrigger) throw new RangeError('evictionTarget must be below evictionTrigger')
  if (t.dirtyTarget >= t.dirtyTrigger) throw new RangeError('dirtyTarget must be below dirtyTrigger')
  return t
}

/**
 * How hard eviction is working: 0 at or below the target, rising linearly to
 * 1 at the trigger and clamped above it.
 */
export function evictionPressure(occupancy: number, t: EvictionThresholds = WIREDTIGER_DEFAULTS): number {
  validateThresholds(t)
  unit(occupancy, 'occupancy')
  if (occupancy <= t.evictionTarget) return 0
  if (occupancy >= t.evictionTrigger) return 1
  return (occupancy - t.evictionTarget) / (t.evictionTrigger - t.evictionTarget)
}

/** Same shape for the dirty share of the cache. */
export function dirtyPressure(dirty: number, t: EvictionThresholds = WIREDTIGER_DEFAULTS): number {
  validateThresholds(t)
  unit(dirty, 'dirty')
  if (dirty <= t.dirtyTarget) return 0
  if (dirty >= t.dirtyTrigger) return 1
  return (dirty - t.dirtyTarget) / (t.dirtyTrigger - t.dirtyTarget)
}

/**
 * Past either trigger, WiredTiger pulls application threads into doing
 * eviction themselves, which is when operation latency visibly climbs.
 */
export function applicationThreadsEvict(occupancy: number, dirty: number, t: EvictionThresholds = WIREDTIGER_DEFAULTS): boolean {
  return evictionPressure(occupancy, t) >= 1 || dirtyPressure(dirty, t) >= 1
}

/** Default WiredTiger internal cache size for a server with `ramGB` of memory. */
export function defaultCacheSizeGB(ramGB: number): number {
  if (!Number.isFinite(ramGB) || ramGB < 0) throw new RangeError('RAM must be a finite, non-negative number of GB')
  return Math.max(0.25, 0.5 * (ramGB - 1))
}

/** MongoDB 9.0: the most memory one query operation may use, in bytes. */
export function perOperationMemoryLimitBytes(availableBytes: number): number {
  if (!Number.isSafeInteger(availableBytes) || availableBytes < 0) throw new RangeError('Available memory must be a non-negative safe integer of bytes')
  return Math.max(GiB, Math.floor(0.2 * availableBytes))
}
