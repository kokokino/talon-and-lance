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

# Deploy to Meteor Galaxy
meteor deploy talon-and-lance.kokokino.com --settings settings.production.json
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

### Determinism Strategy
All game physics use integer arithmetic (positions in 1/256th pixel units) — no floating point in game logic. Seedable PRNG (mulberry32) for all randomness. Game state serialized as flat `Int32Array` for microsecond save/restore during rollbacks.

### SSO Flow
1. User clicks "Launch" in Hub → Hub generates RS256-signed JWT
2. User redirected to `/sso?token=<jwt>` on spoke
3. Spoke validates JWT signature with Hub's public key
4. Spoke calls Hub API for fresh user data
5. Spoke creates local Meteor session via custom `Accounts.registerLoginHandler`

### Key Directories
- `imports/netcode/` - Rollback engine (game-agnostic): RollbackSession, InputQueue, StateBuffer, TimeSync, SyncTestSession, InputEncoder
- `imports/netcode/transport/` - Transport layer: PeerJSTransport (P2P), GeckosTransport (relay), TransportManager (orchestrator)
- `imports/game/` - Game-specific code: GameLoop (fixed-timestep), InputReader (keyboard sampling)
- `imports/hub/` - Hub integration (SSO handler, API client, subscription checking)
- `imports/lib/collections/` - MongoDB collections (GameRooms, ChatMessages)
- `imports/ui/components/` - Mithril components including `RequireAuth` and `RequireSubscription` HOCs
- `imports/ui/pages/` - Route pages including `SsoCallback` for SSO handling, LobbyPage, GamePage
- `server/methods/` - Meteor methods (room CRUD, matchmaking, chat, subscriptions)
- `server/publications/` - Data publications (rooms.lobby, rooms.current, userData)
- `server/relay/` - geckos.io server bridge for WebRTC relay fallback
- `server/accounts.js` - Custom login handler for SSO

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

### Meteor-Mithril Reactivity
The `MeteorWrapper` component in `client/main.js` bridges Meteor's reactivity with Mithril:
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
