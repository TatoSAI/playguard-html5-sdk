# @playguard/html5-sdk

JavaScript/TypeScript SDK that enables [PlayGuard](https://github.com/TatoSAI/playguard) to test HTML5 games.

Integrates with any HTML5 game engine (Phaser, PixiJS, Three.js, vanilla JS) and exposes game state, custom actions, and named UI elements to the PlayGuard test runner via WebSocket.

## How it works

```
HTML5 Game (browser)          PlayGuard (Electron desktop app)
  ┌─────────────────┐               ┌──────────────────┐
  │ PlayGuardSDK    │◄─── ws:9876 ──│ HTML5Bridge      │
  │  registerElement│               │  tapElement       │
  │  registerProperty│              │  getCustomProperty│
  │  registerAction │               │  executeAction    │
  └─────────────────┘               └──────────────────┘
```

PlayGuard sends JSON commands over WebSocket; the SDK executes them inside the game and responds.

## Installation

```bash
npm install @playguard/html5-sdk
```

## Quick start

```typescript
import { PlayGuardSDK } from '@playguard/html5-sdk'

// Initialize once in your game's entry point
const sdk = PlayGuardSDK.getInstance()

// Expose named UI elements (PlayGuard can tap them by name)
sdk.registerElement('playButton', () => {
  const btn = document.getElementById('play-btn')
  const rect = btn?.getBoundingClientRect()
  return rect ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 } : null
})

// Expose game state properties (PlayGuard can read them in assertions)
sdk.registerProperty('score', () => gameState.score)
sdk.registerProperty('currentLevel', () => gameState.level)
sdk.registerProperty('coins', () => player.coins)

// Expose test actions (PlayGuard can trigger them)
sdk.registerAction('giveCoins', ([amount]) => {
  player.addCoins(parseInt(amount))
})
sdk.registerAction('skipTutorial', () => {
  gameState.skipTutorial()
})

// Expose complex commands (return JSON data)
sdk.registerCommand('getFullState', () => ({
  level: gameState.level,
  score: gameState.score,
  inventory: player.inventory
}))
```

## Phaser 3 example

```typescript
// In your main Scene's create()
const sdk = PlayGuardSDK.getInstance()

sdk.registerElement('startButton', () => ({
  x: this.startButton.x,
  y: this.startButton.y
}))

sdk.registerProperty('lives', () => this.registry.get('lives'))
```

## API

### `PlayGuardSDK.getInstance(options?)`
Returns the singleton SDK instance. Options:
- `url` — WebSocket URL (default: `ws://localhost:9876`)
- `autoConnect` — connect on init (default: `true`)
- `reconnectDelay` — ms between reconnect attempts (default: `2000`)

### `sdk.registerElement(name, getPosition)`
Register a named UI element. `getPosition` returns `{ x, y }` in CSS pixels or `null`.

### `sdk.registerProperty(name, getter)`
Expose a game state value. `getter` returns `string | number | boolean | null`.

### `sdk.registerAction(name, fn)`
Register a callable action. `fn` receives `string[]` args and may be async.

### `sdk.registerCommand(name, fn)`
Register a command that returns JSON data. `fn` receives a `string` param.

### `sdk.isConnected()`
Returns `true` if currently connected to PlayGuard.

### `sdk.destroy()`
Disconnect and reset the singleton.

## Building

```bash
npm run build   # compile to dist/
npm run dev     # watch mode
```

## License

MIT
