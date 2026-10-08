import type { Bus } from '../core/bus'

export interface Controls {
  dispose(): void
}

/** Number keys 1..5 select workloads in HUD order. */
export const WORKLOAD_KEYS: Record<string, string> = {
  '1': 'oltp',
  '2': 'analytics',
  '3': 'vector-rag',
  '4': 'timeseries',
  '5': 'idle',
}

/**
 * Global keyboard shortcuts. Every key maps to a bus event so the rest of the
 * app never listens to the keyboard directly; `Escape` is the one exception,
 * routed to a dismiss callback that closes whatever overlay is topmost.
 */
export function createControls(bus: Bus, onDismiss: () => void): Controls {
  function onKey(e: KeyboardEvent): void {
    const target = e.target as HTMLElement | null
    if (target && ['INPUT', 'SELECT', 'TEXTAREA'].includes(target.tagName)) return
    if (e.metaKey || e.ctrlKey || e.altKey) return

    if (WORKLOAD_KEYS[e.key]) {
      bus.emit('workload:change', { id: WORKLOAD_KEYS[e.key] })
      return
    }
    switch (e.key) {
      case 't':
      case 'T':
        bus.emit('tour:toggle', undefined)
        break
      case 'k':
      case 'K':
      case 'p':
      case 'P':
        bus.emit('pause:toggle', undefined)
        break
      case 'h':
      case 'H':
        bus.emit('camera:home', undefined)
        break
      case 'n':
      case 'N':
        bus.emit('theme:toggle', undefined)
        break
      case 'r':
      case 'R':
        bus.emit('reset', undefined)
        break
      case '?':
      case '/':
        bus.emit('help:toggle', undefined)
        e.preventDefault()
        break
      case 'Escape':
        onDismiss()
        break
      default:
        return
    }
  }

  window.addEventListener('keydown', onKey)
  return {
    dispose() {
      window.removeEventListener('keydown', onKey)
    },
  }
}
