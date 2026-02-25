import { WSClient } from './WSClient.js'
import type {
  PropertyGetter,
  ActionHandler,
  CommandHandler,
  ElementDescriptor,
  PlayGuardCommand,
  PlayGuardResponse,
  PlayGuardEvent,
  PlayGuardSDKOptions
} from './types.js'

export class PlayGuardSDK {
  private static _instance: PlayGuardSDK | null = null

  private wsClient: WSClient
  private properties = new Map<string, PropertyGetter>()
  private actions = new Map<string, ActionHandler>()
  private commands = new Map<string, CommandHandler>()
  private elements = new Map<string, ElementDescriptor>()
  private clickMonitoringActive = false
  private boundPointerDown = this.onPointerDown.bind(this)

  private constructor(options: PlayGuardSDKOptions = {}) {
    const { url = 'ws://localhost:9876', reconnectDelay = 2000, autoConnect = true } = options
    this.wsClient = new WSClient(url, reconnectDelay)
    this.wsClient.onMessage = (cmd) => this.handleCommand(cmd)

    if (autoConnect) {
      this.wsClient.connect()
    }
  }

  /**
   * Get or create the singleton SDK instance.
   * Call this once in your game's entry point.
   *
   * @example
   * const sdk = PlayGuardSDK.getInstance()
   * sdk.registerProperty('score', () => gameState.score)
   */
  static getInstance(options?: PlayGuardSDKOptions): PlayGuardSDK {
    if (!PlayGuardSDK._instance) {
      PlayGuardSDK._instance = new PlayGuardSDK(options)
    }
    return PlayGuardSDK._instance
  }

  /**
   * Register a game state property that PlayGuard can read.
   *
   * @example
   * sdk.registerProperty('playerCoins', () => CurrencyManager.getCoins())
   * sdk.registerProperty('currentLevel', () => GameState.level)
   */
  registerProperty(name: string, getter: PropertyGetter): void {
    this.properties.set(name, getter)
  }

  /**
   * Register a test action that PlayGuard can trigger.
   * args are passed as strings from the test runner.
   *
   * @example
   * sdk.registerAction('giveCoins', ([amount]) => {
   *   CurrencyManager.addCoins(parseInt(amount))
   * })
   * sdk.registerAction('skipTutorial', () => GameState.skipTutorial())
   */
  registerAction(name: string, fn: ActionHandler): void {
    this.actions.set(name, fn)
  }

  /**
   * Register a complex command that returns JSON data.
   *
   * @example
   * sdk.registerCommand('getGameState', () => ({
   *   level: GameState.level,
   *   score: GameState.score,
   *   inventory: Inventory.items
   * }))
   */
  registerCommand(name: string, fn: CommandHandler): void {
    this.commands.set(name, fn)
  }

  /**
   * Register a named UI element so PlayGuard can tap it by name.
   * getPosition should return the element's current center in CSS pixels.
   *
   * @example
   * // Phaser
   * sdk.registerElement('playButton', () => ({
   *   x: playButtonSprite.x,
   *   y: playButtonSprite.y
   * }))
   *
   * // DOM
   * sdk.registerElement('loginBtn', () => {
   *   const el = document.getElementById('login-btn')
   *   const rect = el?.getBoundingClientRect()
   *   return rect ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 } : null
   * })
   */
  registerElement(name: string, getPosition: () => { x: number; y: number } | null): void {
    this.elements.set(name, { name, getPosition })
    // Start monitoring clicks once the first element is registered
    if (!this.clickMonitoringActive) {
      this.clickMonitoringActive = true
      window.addEventListener('pointerdown', this.boundPointerDown, true)
    }
  }

  /**
   * Called on every pointerdown in the game window.
   *
   * Strategy:
   *  - DOM game  → exact hit-test via document.elementFromPoint; only fires
   *                when the tap lands on (or inside) the registered element.
   *  - Canvas game → the tapped node is the <canvas> itself so DOM matching
   *                  is impossible; falls back to proximity with a strict
   *                  50 px radius so only elements actually under the finger
   *                  are reported (nearest-wins, bounded).
   */
  private onPointerDown(e: PointerEvent): void {
    if (this.elements.size === 0) return
    const { clientX, clientY } = e

    const tapped = document.elementFromPoint(clientX, clientY)
    if (!tapped) return

    if (tapped.tagName !== 'CANVAS') {
      // ── DOM game: exact hit-test ──────────────────────────────────────────
      for (const [name, el] of this.elements) {
        const pos = el.getPosition()
        if (!pos) continue
        const elAtCenter = document.elementFromPoint(pos.x, pos.y)
        if (!elAtCenter || elAtCenter.tagName === 'CANVAS') continue
        if (elAtCenter === tapped || elAtCenter.contains(tapped) || tapped.contains(elAtCenter)) {
          this.sendEvent('elementTapped', {
            element: name,
            matchType: 'dom',
            tapX: Math.round(clientX),
            tapY: Math.round(clientY),
            elementX: Math.round(pos.x),
            elementY: Math.round(pos.y)
          })
          return
        }
      }
    } else {
      // ── Canvas game: bounded proximity (≤ 35 px) ─────────────────────────
      const THRESHOLD = 35
      let closestName: string | null = null
      let closestDist = THRESHOLD
      let closestPos: { x: number; y: number } | null = null

      for (const [name, el] of this.elements) {
        const pos = el.getPosition()
        if (!pos) continue
        const dist = Math.sqrt((pos.x - clientX) ** 2 + (pos.y - clientY) ** 2)
        if (dist < closestDist) {
          closestDist = dist
          closestName = name
          closestPos = pos
        }
      }

      if (closestName !== null) {
        this.sendEvent('elementTapped', {
          element: closestName,
          matchType: 'canvas',
          tapX: Math.round(clientX),
          tapY: Math.round(clientY),
          elementX: Math.round(closestPos!.x),
          elementY: Math.round(closestPos!.y),
          dist: Math.round(closestDist)
        })
      }
    }
  }

  /** Send an unsolicited event notification to PlayGuard */
  private sendEvent(event: string, data: any): void {
    const msg: PlayGuardEvent = { type: 'event', event, data }
    this.wsClient.send(msg as any)
  }

  /** Returns true if currently connected to PlayGuard */
  isConnected(): boolean {
    return this.wsClient.isConnected()
  }

  /** Permanently disconnect and stop reconnection */
  destroy(): void {
    if (this.clickMonitoringActive) {
      window.removeEventListener('pointerdown', this.boundPointerDown, true)
      this.clickMonitoringActive = false
    }
    this.wsClient.destroy()
    PlayGuardSDK._instance = null
  }

  private respond(
    id: string,
    command: string,
    success: boolean,
    data?: any,
    error?: string
  ): void {
    const resp: PlayGuardResponse = {
      type: 'response',
      id,
      command,
      success,
      ...(data !== undefined ? { data } : {}),
      ...(error !== undefined ? { error } : {})
    }
    this.wsClient.send(resp)
  }

  private async handleCommand(cmd: PlayGuardCommand): Promise<void> {
    const { id, command, parameters } = cmd

    switch (command) {
      case 'ping':
        this.respond(id, command, true, 'pong')
        break

      case 'listCustomProperties':
        this.respond(id, command, true, { properties: [...this.properties.keys()] })
        break

      case 'listCustomActions':
        this.respond(id, command, true, { actions: [...this.actions.keys()] })
        break

      case 'listCustomCommands':
        this.respond(id, command, true, { commands: [...this.commands.keys()] })
        break

      case 'getCustomProperty': {
        const name = parameters?.name
        const getter = this.properties.get(name)
        if (!getter) {
          this.respond(id, command, false, undefined, `Property '${name}' not found`)
        } else {
          try {
            this.respond(id, command, true, { value: String(getter()) })
          } catch (e) {
            this.respond(id, command, false, undefined, String(e))
          }
        }
        break
      }

      case 'executeCustomAction': {
        const { name, args = [] } = parameters || {}
        const fn = this.actions.get(name)
        if (!fn) {
          this.respond(id, command, false, undefined, `Action '${name}' not found`)
        } else {
          try {
            await fn(args)
            this.respond(id, command, true)
          } catch (e) {
            this.respond(id, command, false, undefined, String(e))
          }
        }
        break
      }

      case 'executeCustomCommand': {
        const { name, param = '' } = parameters || {}
        const fn = this.commands.get(name)
        if (!fn) {
          this.respond(id, command, false, undefined, `Command '${name}' not found`)
        } else {
          try {
            const result = await fn(param)
            this.respond(id, command, true, result)
          } catch (e) {
            this.respond(id, command, false, undefined, String(e))
          }
        }
        break
      }

      case 'getUIElements': {
        const elements = [...this.elements.values()].map((el) => ({
          name: el.name,
          path: el.name,
          type: 'HTML5Element',
          active: true,
          position: { ...(el.getPosition() ?? { x: 0, y: 0 }), z: 0 }
        }))
        this.respond(id, command, true, { elements })
        break
      }

      case 'tapElement': {
        const { path } = parameters || {}
        const el = this.elements.get(path)
        if (!el) {
          this.respond(id, command, false, undefined, `Element '${path}' not registered`)
          return
        }
        const pos = el.getPosition()
        if (!pos) {
          this.respond(id, command, false, undefined, `Element '${path}' returned null position`)
          return
        }
        // Dispatch synthetic pointer events at the element's position
        const target = document.elementFromPoint(pos.x, pos.y)
        if (target) {
          const opts = { bubbles: true, clientX: pos.x, clientY: pos.y }
          target.dispatchEvent(new PointerEvent('pointerdown', opts))
          target.dispatchEvent(new PointerEvent('pointerup', opts))
          target.dispatchEvent(new MouseEvent('click', opts))
        }
        this.respond(id, command, true)
        break
      }

      default:
        this.respond(id, command, false, undefined, `Unknown command: ${command}`)
    }
  }
}
