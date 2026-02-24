/** Sent FROM PlayGuard TO the game */
export interface PlayGuardCommand {
  type: 'command'
  id: string // Correlation ID for request/response matching
  command: string // e.g. 'ping', 'tapElement', 'getCustomProperty'
  parameters?: Record<string, any>
}

/** Sent FROM the game TO PlayGuard */
export interface PlayGuardResponse {
  type: 'response'
  id: string // Matches the command id
  command: string
  success: boolean
  data?: any
  error?: string
}

export type PropertyGetter = () => string | number | boolean | null
export type ActionHandler = (args: string[]) => void | Promise<void>
export type CommandHandler = (param: string) => any | Promise<any>

export interface ElementDescriptor {
  name: string
  /** Returns current center position in CSS pixels */
  getPosition: () => { x: number; y: number } | null
}

export interface PlayGuardSDKOptions {
  /** WebSocket URL to connect to. Default: 'ws://localhost:9876' */
  url?: string
  /** Auto-connect on initialization. Default: true */
  autoConnect?: boolean
  /** Reconnection delay in ms. Default: 2000 */
  reconnectDelay?: number
}
