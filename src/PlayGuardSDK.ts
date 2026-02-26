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
   * Register a named UI element so PlayGuard can tap it programmatically.
   * getPosition must return the element's center in viewport CSS pixels —
   * used by the `tapElement` test command to dispatch synthetic events.
   *
   * For tap *detection* (observing what the user taps), call notifyTapped()
   * from your game's own click/tap handler instead.
   *
   * @example
   * // Phaser — convert game coords to viewport CSS pixels
   * const canvas = document.querySelector('canvas')!
   * sdk.registerElement('playButton', () => {
   *   const rect = canvas.getBoundingClientRect()
   *   const sx = rect.width  / canvas.width
   *   const sy = rect.height / canvas.height
   *   return { x: rect.left + playBtn.x * sx, y: rect.top + playBtn.y * sy }
   * })
   *
   * // DOM element
   * sdk.registerElement('loginBtn', () => {
   *   const el = document.getElementById('login-btn')
   *   const rect = el?.getBoundingClientRect()
   *   return rect ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 } : null
   * })
   */
  registerElement(name: string, getPosition: () => { x: number; y: number } | null): void {
    this.elements.set(name, { name, getPosition })
  }

  /**
   * Notify PlayGuard that the user tapped a named element.
   * Call this directly from your game's button/tap handler — this is the
   * recommended way to report element taps since the game already knows
   * exactly which element was interacted with.
   *
   * @example
   * // Phaser
   * playButton.on('pointerdown', () => sdk.notifyTapped('playButton'))
   *
   * // DOM
   * document.getElementById('coin-btn')?.addEventListener('click', () => {
   *   sdk.notifyTapped('coinButton')
   * })
   */
  notifyTapped(name: string): void {
    this.sendEvent('elementTapped', { element: name, matchType: 'explicit' })
  }

  /**
   * Notify PlayGuard that a game function was called.
   * Shows up in the Ad-Hoc event log with the function name and arguments.
   *
   * @example
   * function addCoins(amount: number) {
   *   sdk.notifyCall('addCoins', [amount])
   *   // log shows: addCoins(1)
   *   coins += amount
   * }
   *
   * sdk.notifyCall('skipTutorial')
   * // log shows: skipTutorial()
   */
  notifyCall(name: string, args?: any[]): void {
    const label =
      args && args.length > 0
        ? `${name}(${args.map(String).join(', ')})`
        : `${name}()`
    this.sendEvent('functionCalled', { fn: name, args: args ?? [], label })
  }

  /**
   * Send a custom log message to PlayGuard.
   * Shows up in the Ad-Hoc event log with the given message and level.
   *
   * @example
   * sdk.log('Se agregó 1 moneda')
   * sdk.log('Nivel completado', 'info')
   * sdk.log('Monedas insuficientes', 'warn')
   * sdk.log('Error al guardar partida', 'error')
   */
  log(message: string, level: 'info' | 'warn' | 'error' = 'info'): void {
    this.sendEvent('logMessage', { message, level })
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
