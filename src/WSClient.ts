import type { PlayGuardCommand, PlayGuardResponse } from './types.js'

export class WSClient {
  private ws: WebSocket | null = null
  private readonly url: string
  private readonly reconnectDelay: number
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private connected = false
  private destroyed = false

  public onMessage: ((msg: PlayGuardCommand) => void) | null = null
  public onConnected: (() => void) | null = null
  public onDisconnected: (() => void) | null = null

  constructor(url = 'ws://localhost:9876', reconnectDelay = 2000) {
    this.url = url
    this.reconnectDelay = reconnectDelay
  }

  connect(): void {
    if (this.ws || this.destroyed) return
    this._connect()
  }

  private _connect(): void {
    if (this.destroyed) return

    try {
      this.ws = new WebSocket(this.url)

      this.ws.onopen = () => {
        this.connected = true
        console.log('[PlayGuardSDK] Connected to PlayGuard at', this.url)
        this.onConnected?.()
      }

      this.ws.onmessage = (event: MessageEvent) => {
        // Messages may be newline-delimited (same as Electron side)
        const lines = String(event.data).split('\n')
        for (const line of lines) {
          if (!line.trim()) continue
          try {
            const msg: PlayGuardCommand = JSON.parse(line)
            this.onMessage?.(msg)
          } catch {
            console.warn('[PlayGuardSDK] Failed to parse message:', line)
          }
        }
      }

      this.ws.onclose = () => {
        this.connected = false
        this.ws = null
        console.log(`[PlayGuardSDK] Disconnected. Retrying in ${this.reconnectDelay}ms...`)
        this.onDisconnected?.()
        if (!this.destroyed) {
          this.reconnectTimer = setTimeout(() => this._connect(), this.reconnectDelay)
        }
      }

      this.ws.onerror = () => {
        // onclose fires after onerror — reconnect is handled there
      }
    } catch (e) {
      console.error('[PlayGuardSDK] WebSocket constructor error:', e)
    }
  }

  send(response: PlayGuardResponse): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(response) + '\n')
    }
  }

  isConnected(): boolean {
    return this.connected
  }

  /** Permanently disconnect and stop reconnection attempts */
  destroy(): void {
    this.destroyed = true
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    this.ws?.close()
    this.ws = null
    this.connected = false
  }
}
