# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Talon & Lance** is a multiplayer arcade game inspired by the classic 1980s game Joust, built as a spoke app in the Kokokino Hub & Spoke architecture. Players ride flying ostriches and battle by jousting — the player with the higher lance wins each collision. The game uses Babylon JS with voxel sprites for rendering and implements GGPO-style rollback netcode for low-latency multiplayer (up to 4 players per room).

The Hub (kokokino.com) handles authentication and billing via Lemon Squeezy; the spoke validates SSO tokens and checks subscriptions via Hub API.

## Commands

```bash
# Development (runs on port 3030)
meteor --port 3030 --settings settings.development.json

# Or use npm script
npm run dev

# Run tests once
npm test

# Run tests in watch mode
npm run test-app

# Analyze bundle size
npm run visualize

# Deploy
npm run prod-deploy
```

## Tech Stack

| Technology | Purpose |
|------------|---------|
| **Meteor 3.4** | Real-time framework with MongoDB integration (requires Node.js 22.x) |
| **Mithril.js 2.3** | UI framework - uses JavaScript to generate HTML (no JSX) |
| **Babylon JS v8** | 3D rendering engine for voxel sprites and game visuals |
| **Pico CSS** | Classless CSS framework for minimal styling (lobby/menus) |
| **PeerJS** | P2P WebRTC DataChannels for primary game networking |
| **geckos.io** | Server-side WebRTC relay fallback for restrictive NATs |
| **jsonwebtoken** | JWT validation for SSO tokens |

## Architecture

### Game Networking
The game uses GGPO-style rollback netcode with a request-based API pattern (inspired by GGRS):
- **Lobby phase:** Meteor DDP handles matchmaking, room management, account data
- **Gameplay phase:** Players communicate directly via PeerJS WebRTC P2P DataChannels
- **Fallback:** If P2P fails for a player pair, geckos.io relays through the server (still UDP-like WebRTC)
- **Postgame:** Results sent back to Meteor via Methods

### Simulation / Renderer Split
The game has a strict separation between deterministic logic and visual rendering:

- **`GameSimulation`** (`imports/game/GameSimulation.js`) — Pure deterministic game logic. No Babylon dependencies. Owns the `Int32Array` state buffer. Implements `tick(inputs)`, `serialize()`, `deserialize()`. All physics, collision, spawning, scoring, and AI happen here.
- **`Level1Scene`** (`imports/game/scenes/Level1Scene.js`) — Babylon renderer. Reads game state and syncs meshes/sounds/HUD to match. Never mutates game state.
- **`MultiplayerManager`** (`imports/game/MultiplayerManager.js`) — Orchestrator that wires GameSimulation + Level1Scene + rollback session + transport for online play.

**Level1Scene operates in two modes:**
1. **Solo mode** (default) — Owns its own GameSimulation and InputReader, ticks simulation in its `_update()` loop.
2. **Renderer mode** (`rendererOnly: true`) — External caller (MultiplayerManager) owns GameSimulation and GameLoop. Caller invokes `draw(gameState)` each frame; Level1Scene just renders.

### Determinism Strategy
All game physics use integer arithmetic (positions in 1/256th pixel units) — no floating point in game logic. Seedable PRNG (mulberry32) for all randomness. Game state serialized as flat `Int32Array` for microsecond save/restore during rollbacks. Havok physics must **never** be used for gameplay state (not deterministic cross-platform, no snapshot/restore API) — only for cosmetic effects like voxel debris. See `documentation/PHYSICS.md` for full rationale.

### Integer Physics Implementation
- **Fixed-point scale:** `FP_SCALE = 256` (8 fractional bits). Convert with `toFP(val)` / `fromFP(val)` in `stateLayout.js`.
- **No dt parameter:** All physics functions assume 60fps fixed timestep. Constants are pre-computed as per-frame deltas (e.g., `FP_GRAVITY_PF`).
- **Reciprocal-multiply division:** Integer division without float ops — `velPerFrame(vel)` divides by 60 using `(vel * 17477) >> 20`. Also `idiv3()`, `idiv10()`. All in `stateLayout.js`.
- **No `Math.random()`:** Uses `DeterministicRNG` (mulberry32 with seed stored in game state).
- **No `Date.now()` in game logic:** All timers use frame counts (integers at 60fps).
- Float-point only appears in the renderer for visual interpolation, never in physics.

### Game State Layout
All game state lives in a flat `Int32Array` (556 ints, ~2.2KB) defined in `imports/game/physics/stateLayout.js`:
- **GLOBAL** (20 ints): frame counter, RNG seed, wave number/state, spawn timers, game mode
- **HUMANS** (4 slots × 34 ints): position, velocity, state flags, timers, score, lives
- **ENEMIES** (8 slots × 34 ints): same structure as humans
- **ENEMY_AI** (8 slots × 4 ints): direction timer, current direction, flap accumulator
- **EGGS** (8 slots × 12 ints): position, velocity, hatch state/timer, enemy type

Access pattern: `state[HUMANS_OFFSET + slotIndex * CHAR_SIZE + C_POS_X]`. Constants like `C_POS_X`, `C_VEL_Y` are field offsets within a slot.

### SSO Flow
1. User clicks "Launch" in Hub → Hub generates RS256-signed JWT
2. User redirected to `/sso?token=<jwt>` on spoke
3. Spoke validates JWT signature with Hub's public key
4. Spoke calls Hub API for fresh user data
5. Spoke creates local Meteor session via custom `Accounts.registerLoginHandler`

### Babylon Scene Architecture
`BabylonPage` (Mithril component) owns the Babylon Engine, canvas, render loop, and AudioManager. It orchestrates scene transitions between `MainMenuScene` and `Level1Scene`. Each scene class exposes `create(scene, engine, canvas)` and `dispose()`, and is instantiated by BabylonPage when transitioning.

- **MainMenuScene** — 3D menu with animated knight, arc-rotate camera, palette selector (4 knight colors), music track selector (3 music tracks + None), mode select (Team Play/PvP). Preferences saved to localStorage.
- **Level1Scene** — Full Joust gameplay: multi-tier platforms over lava, flapping flight physics, lance-height jousting, death/respawn with invincibility, egg drop mechanics, voxel explosion debris, day/night cycle.

### Render Slot System
Level1Scene uses **pre-allocated render slots** (not ECS). 12 character slots (0–3 humans, 4–11 enemies) and 8 egg slots. Each slot stores mesh references and visual-only animation state (idle blend, turn animation, vortex effect). Meshes are created when a slot becomes `active && !dead` and disposed on death or deactivation.

Character assembly: `_createSlotMeshes()` builds three rigs (bird, knight, lance) via VoxelBuilder, then `_assembleCharacter()` wires parent-child hierarchy with TransformNode pivot nodes for shoulders, hips, knees, and wings.

### Sound State Diffing
`Level1Scene._syncSounds()` compares the current frame's game state against a `_prevState` snapshot to detect transitions (e.g., `char.dead && !prev.dead` → play death sound). Cooldown timestamps via `performance.now()` prevent overlap on rapid-fire sounds. SFX use round-robin pooling in AudioManager for variant selection (e.g., `'flap'` → `'flap-1'` through `'flap-5'`).

### Voxel Model System
`VoxelBuilder` converts voxel definitions to Babylon meshes with neighbor-based face culling and flat-shaded vertex-colored cubes. Models define parts as `layers[y][z][x]` arrays (y=0 is bottom, z=0 is front facing -Z) with numeric color indices mapped through a palette object. Parts can declare a `parent` and `offset` for hierarchical assembly.

Palette system: Base palette lives in the model file. Override palettes in separate files (e.g., `knightPalettes.js`) swap specific color keys (plume, primary, accent, shield) via spread merge. `buildKnightPalette(index)` produces the final palette for a given variant.

### Implementation Status
The game is a playable Joust with polished visuals and working online multiplayer. `MultiplayerManager` orchestrates the full lifecycle: matchmaking via Meteor methods, WebRTC peer connections via `TransportManager`, rollback netcode via `RollbackSession`, drop-in/drop-out with state sync, and desync detection with authority-based resync. Games start in solo mode and seamlessly transition to rollback multiplayer when peers connect (and back to solo when they disconnect).

### Key Directories
- `imports/game/physics/` - Deterministic core: `stateLayout.js` (Int32Array layout + FP helpers), `constants.js` (all game constants), `CollisionSystem.js` (platform/joust/lava/screen-wrap), `PhysicsSystem.js` (input/friction/gravity application), `mulberry32.js` (seedable PRNG)
- `imports/game/` - `GameSimulation.js` (tick/serialize/deserialize), `GameLoop.js` (fixed 60fps timestep), `InputReader.js` (keyboard sampling with edge detection), `EnemyAI.js`, `MultiplayerManager.js` (online play orchestrator), `scoring.js` (wave composition, point values)
- `imports/game/scenes/` - Babylon scenes: MainMenuScene (menu + palette picker), Level1Scene (full Joust renderer)
- `imports/game/voxels/` - VoxelBuilder mesh generator + voxel model definitions (knight, ostrich, evil knight, buzzard, lance, egg)
- `imports/game/audio/` - AudioManager (Babylon Audio V2, SFX pooling, menu music tracks)
- `imports/netcode/` - Rollback engine (game-agnostic): RollbackSession, InputQueue, StateBuffer, TimeSync, SyncTestSession, InputEncoder
- `imports/netcode/transport/` - Transport layer: PeerJSTransport (P2P), GeckosTransport (relay), TransportManager (orchestrator)
- `imports/hub/` - Hub integration (SSO handler, API client, subscription checking)
- `imports/lib/collections/` - MongoDB collections (GameRooms, ChatMessages)
- `imports/ui/pages/` - BabylonPage (engine/scene lifecycle), SsoCallback, HomePage, auth gate pages
- `imports/ui/components/` - RequireAuth, RequireSubscription HOCs, ChatRoom/ChatMessage
- `server/methods/` - Meteor methods (room CRUD, matchmaking, chat, subscriptions)
- `server/publications/` - Data publications (rooms.lobby, rooms.current, userData)
- `server/relay/` - geckos.io server bridge for WebRTC relay fallback
- `server/accounts.js` - Custom login handler for SSO
- `documentation/` - Architecture docs (PHYSICS.md has determinism/Havok decisions, joust-remake-rollback-networking.md)

### Settings Structure
```json
{
  "public": {
    "appName": "Talon & Lance",
    "appId": "talon_and_lance",
    "hubUrl": "https://kokokino.com",
    "requiredProducts": ["product_id"]
  },
  "private": {
    "hubApiKey": "api-key-from-hub",
    "hubApiUrl": "https://kokokino.com/api/spoke",
    "hubPublicKey": "-----BEGIN PUBLIC KEY-----..."
  }
}
```

### Rspack Configuration
`rspack.config.js` externalizes `node-datachannel` (native addon used by geckos.io) on the server build. This is required because Rspack cannot bundle native `.node` addons.

## Code Conventions

### Meteor v3
- Use async/await patterns (no fibers) - e.g., `Meteor.users.findOneAsync()`, `insertAsync()`, `updateAsync()`
- Do not use `autopublish` or `insecure` packages
- When recommending Atmosphere packages, ensure Meteor v3 compatibility

### JavaScript Style
- Use `const` by default, `let` when needed, avoid `var`
- Always use curly braces with `if` blocks
- Avoid early returns - prefer single return statement at end
- Each variable declaration on its own line (no comma syntax)
- Use readable variable names (`document` not `doc`)

### UI Style
- Leverage Pico CSS patterns - avoid inline styles
- Use semantic CSS class names (`warning` not `yellow`)
- Use Mithril for UI; Blaze integration is acceptable for packages like accounts-ui
- Avoid React unless specifically instructed

### Security
- Validate all user input using `check()` from `meteor/check`
- Implement rate limiting on sensitive endpoints
- Never store Hub's private key in spoke code
- Sanitize user content before display to prevent XSS

## Patterns

### Mithril Components
Components are plain objects with lifecycle hooks:
- `oninit(vnode)` - Initialize state, start async operations
- `oncreate(vnode)` - Set up subscriptions, Tracker computations
- `onupdate(vnode)` - React to prop/state changes
- `onremove(vnode)` - Cleanup (stop computations, unsubscribe)
- `view(vnode)` - Return virtual DOM

State lives on `vnode.state`. Call `m.redraw()` after async operations complete.

### Client Routing
Routes defined in `client/main.js` using `m.route()` with `m.route.prefix = ''`. Logged-in users at `/` get `BabylonPage` (full-canvas Babylon, no Pico layout). All other pages use `Layout` wrapper (MeteorWrapper + MainLayout with Pico CSS). Auth gate pages: `/not-logged-in`, `/no-subscription`, `/session-expired`. SSO callback at `/sso`.

### Meteor-Mithril Reactivity
`MeteorWrapper` in `client/main.js` bridges Meteor's Tracker reactivity with Mithril redraws:
```javascript
Tracker.autorun(() => {
  Meteor.user(); Meteor.userId(); Meteor.loggingIn();
  m.redraw();
});
```

### Publications
- Always check `this.userId` before publishing sensitive data
- Return `this.ready()` for unauthenticated users
- Use field projections to limit exposed data

### Methods
- Use `check()` for input validation at method start
- Throw `Meteor.Error('error-code', 'message')` for client-handleable errors
- Common error codes: `not-authorized`, `not-found`, `invalid-message`, `subscription-required`

### Migrations
Uses `quave:migrations` package. Migrations in `server/migrations/` with `up()` and `down()` methods. Auto-run on startup via `Migrations.migrateTo('latest')`.

### Rate Limiting
Configure in `server/rateLimiting.js` using `DDPRateLimiter.addRule()`:
```javascript
DDPRateLimiter.addRule({ type: 'method', name: 'rooms.create' }, 5, 10000);
```

### Testing
Run with `meteor test --driver-package meteortesting:mocha`. Tests use Mocha with Node.js assert. Server-only tests wrap in `if (Meteor.isServer)`.

Game logic tests (`imports/game/tests/`) have **no Babylon dependencies** — they test GameSimulation, CollisionSystem, and multiplayer sync as pure JS. Test helpers like `makeChar(overrides)` and `makeEgg(overrides)` create slot data with sensible defaults. Determinism tests run the same seed + inputs twice and assert `Int32Array` byte-for-byte equality. Roundtrip tests: serialize → deserialize → re-serialize → assert identical buffers.

### Database Indexes
Created in `server/indexes.js` during `Meteor.startup()`. Uses TTL indexes for automatic cleanup:
```javascript
collection.createIndexAsync({ createdAt: 1 }, { expireAfterSeconds: 600 });
```
Used for SSO nonces (replay attack prevention) and subscription cache.

### Rollback Netcode
The rollback engine in `imports/netcode/` uses a request-based API pattern:
```javascript
session.addLocalInput(localInput);
const requests = session.advanceFrame();
for (const request of requests) {
  switch (request.type) {
    case 'SaveGameState': request.cell.save(game.serialize()); break;
    case 'LoadGameState': game.deserialize(request.cell.load()); break;
    case 'AdvanceFrame': game.tick(request.inputs); break;
  }
}
```
The engine is game-agnostic — it never touches game state directly. It tells the game what to do via requests. The `SyncTestSession` forces rollbacks every frame during development to catch non-determinism bugs.
