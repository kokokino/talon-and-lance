# Joust Remake: Rollback Networking Plan

## Context

We're building a Joust-style multiplayer arcade game as a new Meteor 3.x spoke app in the Kokokino ecosystem. The game needs low-latency multiplayer for up to 4 players per room, playable by people around the world. We're implementing GGPO-style rollback netcode (learning from GGRS's request-based API pattern) in plain JavaScript, using PeerJS for P2P WebRTC connections and geckos.io as a server-side WebRTC relay fallback for the ~15% of players behind restrictive NATs.

---

## Architecture Overview

```
┌──────────────────────────────────────────────────┐
│                  Meteor Server                    │
│  ┌────────────┐ ┌────────────┐ ┌───────────────┐ │
│  │ Matchmaking │ │  Accounts  │ │ Game Results  │ │
│  │  (Methods)  │ │   (SSO)    │ │ (Collections) │ │
│  └─────┬──────┘ └────────────┘ └───────────────┘ │
│        │                                          │
│  ┌─────┴──────────────────────────┐               │
│  │  geckos.io WebRTC Relay        │               │
│  │  (fallback for NAT failures)   │               │
│  └────────────────────────────────┘               │
└──────────────────────────────────────────────────┘
         │ WebSocket (lobby)    │ WebRTC (fallback)
         │                      │
    ┌────┴──────────────────────┴────┐
    │         Browser Clients        │
    │  ┌──────────┐  ┌──────────┐   │
    │  │ Player A │──│ Player B │   │  ← PeerJS P2P (primary)
    │  └──────────┘  └──────────┘   │
    │  ┌──────────┐  ┌──────────┐   │
    │  │ Player C │──│ Player D │   │
    │  └──────────┘  └──────────┘   │
    └───────────────────────────────┘
```

**During lobby:** Meteor handles matchmaking, accounts, room management via WebSocket (DDP).
**During gameplay:** Players communicate directly via PeerJS WebRTC DataChannels (P2P). Meteor is uninvolved.
**Fallback:** If P2P fails for a player pair, that pair communicates via geckos.io through the Meteor server (still WebRTC/UDP-like, not TCP).
**After game:** Results sent back to Meteor via Methods.

---

## Component Breakdown

### 1. Rollback Engine (`imports/netcode/`)

A standalone rollback netcode module inspired by GGRS's request-based API. No framework dependencies — pure game-agnostic JS.

#### Core Files

**`imports/netcode/RollbackSession.js`** — Main session orchestrator
- Manages the rollback loop: predict, simulate, detect misprediction, rollback, resimulate
- Returns an array of requests (GGRS pattern) instead of invoking callbacks
- Request types: `SaveGameState`, `LoadGameState`, `AdvanceFrame`
- Configurable: `maxPredictionWindow` (default 8), `inputDelay` (default 2), `disconnectTimeout` (default 5000ms)
- Tracks `confirmedFrame` (highest frame with all inputs received) and `currentFrame`
- Handles frame advantage balancing between peers

```javascript
// Usage pattern (game loop calls this each tick)
session.addLocalInput(localInput);
const requests = session.advanceFrame();

for (const request of requests) {
  switch (request.type) {
    case 'SaveGameState':
      request.cell.save(game.serialize());
      break;
    case 'LoadGameState':
      game.deserialize(request.cell.load());
      break;
    case 'AdvanceFrame':
      game.tick(request.inputs);
      break;
  }
}
```

**`imports/netcode/InputQueue.js`** — Per-player input tracking
- Circular buffer storing inputs indexed by frame number
- Tracks which frames have confirmed vs predicted inputs
- Prediction strategy: repeat last confirmed input
- Detects misprediction when confirmed input differs from what was predicted
- Methods: `addInput(frame, input, predicted)`, `getInput(frame)`, `getConfirmedFrame()`, `hasMisprediction(frame)`

**`imports/netcode/StateBuffer.js`** — Ring buffer of game state snapshots
- Fixed-size circular buffer (16 slots) storing serialized game states
- Each slot: `{ frame, state, checksum }`
- Methods: `save(frame, state)`, `load(frame)`, `getChecksum(frame)`
- State is stored as `ArrayBuffer` (fast copy via `.slice()`)

**`imports/netcode/TimeSync.js`** — Frame timing and advantage balancing
- Tracks local vs remote frame counts
- Calculates frame advantage per peer
- Recommends frame skips when local client is too far ahead (WaitRecommendation)
- Uses running average of round-trip times to adjust input delay dynamically

**`imports/netcode/SyncTestSession.js`** — Determinism validation tool
- Runs the game with forced rollbacks every frame at configurable depth
- Checksums game state after rollback+resimulate and compares to original
- Detects non-determinism bugs without needing network
- Essential for development — run this before testing multiplayer

**`imports/netcode/InputEncoder.js`** — Binary input serialization
- Encodes per-frame input as compact binary (1-2 bytes per player)
- Input format for Joust: `{ left, right, flap }` = 3 bits per player
- Network message format: `[messageType(1B), frame(4B), playerInputs(1B per player)]`
- Also encodes input ACKs and sync messages

#### Events (polled each frame)

```javascript
const events = session.pollEvents();
// Event types:
// { type: 'Synchronizing', peer, total, count }
// { type: 'Synchronized', peer }
// { type: 'NetworkInterrupted', peer, disconnectTimeout }
// { type: 'NetworkResumed', peer }
// { type: 'Disconnected', peer }
// { type: 'DesyncDetected', frame, localChecksum, remoteChecksum, peer }
// { type: 'WaitRecommendation', skipFrames }
```

---

### 2. Transport Layer (`imports/netcode/transport/`)

Abstracted transport so the rollback engine doesn't care whether data goes P2P or through relay.

**`imports/netcode/transport/Transport.js`** — Interface
```javascript
// All transports implement:
// send(peerId, data)        — send ArrayBuffer to peer
// onReceive(callback)       — register receive handler: callback(peerId, data)
// connect(peerId)           — initiate connection
// disconnect(peerId)        — close connection
// getStats(peerId)          — { ping, sendQueueLen }
// isConnected(peerId)       — boolean
```

**`imports/netcode/transport/PeerJSTransport.js`** — Primary P2P transport
- Wraps PeerJS DataConnection
- Configures DataChannels for unreliable/unordered delivery:
  ```javascript
  peer.connect(remotePeerId, {
    reliable: false,
    serialization: 'none'  // raw binary, no BinaryPack overhead
  });
  connection.dataChannel.binaryType = 'arraybuffer';
  ```
- Uses PeerJS cloud signaling server for simplicity (can switch to self-hosted later)
- Implements heartbeat (every 1s) to detect dead connections (PeerJS doesn't fire `close` reliably)
- On connection failure after 3s timeout, fires `onFallbackNeeded(peerId)` event

**`imports/netcode/transport/GeckosTransport.js`** — Fallback relay transport
- Client-side: Uses `@geckos.io/client` to connect to Meteor server
- Messages routed through server to target peer
- Same interface as PeerJSTransport — rollback engine doesn't know the difference
- Message format: `[targetPeerId(16B), payload]` — server strips peerId and routes

**`imports/netcode/transport/TransportManager.js`** — Orchestrates connections
- For each peer pair, attempts PeerJS P2P first
- If P2P fails (3s timeout), falls back to GeckosTransport for that specific pair
- Other peer pairs remain P2P — fallback is per-pair, not global
- Exposes unified `send(peerId, data)` and `onReceive(callback)` to rollback engine
- Tracks which peers are P2P vs relayed for stats display

---

### 3. Server-Side Relay (`server/relay/`)

**`server/relay/geckosBridge.js`** — geckos.io server integration
- Attaches geckos.io to Meteor's HTTP server: `io.addServer(WebApp.httpServer)`
- On client connect: authenticates via Meteor userId (passed as connection metadata)
- Routes messages between players in the same game room
- Minimal logic — just forwards ArrayBuffer payloads between paired clients
- Tracks active relay connections per room for cleanup on disconnect

```javascript
import geckos from '@geckos.io/server';

const io = geckos();
io.addServer(WebApp.httpServer);

io.onConnection(channel => {
  const { roomId, userId } = channel.userData;

  channel.onRaw(data => {
    // Extract target peer from message header, forward to them
    const targetPeerId = extractTarget(data);
    const payload = extractPayload(data);
    forwardToPlayer(roomId, targetPeerId, payload);
  });

  channel.onDisconnect(() => {
    cleanupPlayer(roomId, userId);
  });
});
```

---

### 4. Matchmaking & Room Management (`server/methods/`, `imports/lib/collections/`)

**New Collection: `GameRooms`** (`imports/lib/collections/gameRooms.js`)
```javascript
// Schema:
// {
//   _id: String,
//   hostId: String,           // Meteor userId of room creator
//   players: [{               // Current players (max 4)
//     userId: String,
//     username: String,
//     peerJsId: String,       // PeerJS peer ID for WebRTC setup
//     ready: Boolean,
//     slot: Number            // Player slot (0-3)
//   }],
//   status: String,           // 'waiting' | 'starting' | 'playing' | 'finished'
//   maxPlayers: Number,       // 2-4
//   settings: {               // Game config
//     npcBuzzards: Number,    // 0-20
//     lives: Number,
//     map: String
//   },
//   createdAt: Date,
//   startedAt: Date,
//   finishedAt: Date
// }
```

**New Methods** (`server/methods/roomMethods.js`)
- `rooms.create(settings)` — Create room, host joins automatically
- `rooms.join(roomId)` — Join existing room (validates not full, not started)
- `rooms.leave(roomId)` — Leave room (if host leaves, migrate or close)
- `rooms.setReady(roomId, ready)` — Toggle ready state
- `rooms.setPeerJsId(roomId, peerJsId)` — Register PeerJS ID for WebRTC setup
- `rooms.start(roomId)` — Host starts game (all players must be ready)
- `rooms.reportResult(roomId, results)` — Submit game results when finished

**New Publication** (`server/publications/roomPublications.js`)
- `rooms.lobby` — All rooms with status 'waiting' (for lobby browser)
- `rooms.current` — Reactive room data for joined players (status changes, player list, PeerJS IDs)

---

### 5. Connection Flow (Step by Step)

```
1. LOBBY PHASE (Meteor DDP)
   ├── Host calls rooms.create() → new GameRoom in 'waiting' status
   ├── Other players browse lobby, call rooms.join()
   ├── Room publication pushes player list updates reactively
   ├── Each player generates PeerJS ID, calls rooms.setPeerJsId()
   ├── Players toggle ready, host sees all ready → calls rooms.start()
   └── Room status changes to 'starting'

2. CONNECTION PHASE (PeerJS + fallback)
   ├── All players receive 'starting' status via publication
   ├── Each player reads other players' PeerJS IDs from room data
   ├── TransportManager attempts P2P connections to all peers:
   │   ├── PeerJS.connect(remotePeerJsId, { reliable: false })
   │   ├── Wait up to 3 seconds for DataChannel to open
   │   ├── If success → mark peer as P2P ✓
   │   └── If fail → fall back to geckos.io relay for this peer
   ├── For geckos fallback:
   │   ├── Client connects to Meteor's geckos.io server
   │   ├── Server authenticates via userId, associates with room
   │   └── Messages relay through server (still UDP-like WebRTC)
   ├── Once all peer pairs connected (P2P or relay) → ready
   └── All players send 'connected' confirmation → game begins

3. GAMEPLAY PHASE (WebRTC only, Meteor uninvolved)
   ├── Fixed-timestep game loop runs at 60fps
   ├── Each tick:
   │   ├── Sample local input (left, right, flap)
   │   ├── Send input to all peers via TransportManager
   │   ├── Receive remote inputs from peers
   │   ├── Feed inputs to RollbackSession.advanceFrame()
   │   ├── Process returned requests (save/load/advance)
   │   ├── Poll events (sync status, disconnects, desync)
   │   └── Render current game state
   └── Game continues until win condition or all disconnected

4. POSTGAME PHASE (Meteor DDP)
   ├── Winner determined locally (deterministic = same result everywhere)
   ├── Host calls rooms.reportResult() with final scores
   ├── Room status → 'finished'
   └── Players return to lobby
```

---

### 6. Determinism Strategy

For a Joust-style 2D arcade game, full determinism is achievable without fixed-point math:

**Use integer arithmetic for all game physics:**
- Positions: stored as 1/256th pixel units (multiply by 256)
- Velocities: integer sub-pixel units per frame
- Gravity, flap force, collision: all integer constants
- No `Math.sin/cos` needed (no rotation physics)
- No floating point in game logic at all

**Seedable PRNG:**
- Use mulberry32 for all randomness (NPC spawn positions, egg hatch timing, etc.)
- PRNG seed is part of serialized game state
- On rollback, seed restores to exact value at that frame

**Game state serialization:**
- Flat `Int32Array` containing all game state
- Layout: `[frame, rngSeed, p0.x, p0.y, p0.vx, p0.vy, p0.state, ..., npc0.x, ...]`
- Estimated size: ~200 integers = 800 bytes
- Serialize: `state.slice()` (microseconds)
- Deserialize: `state.set(snapshot)` (microseconds)

**Checksum for desync detection:**
- Simple hash of the Int32Array each frame (e.g., FNV-1a)
- Exchange checksums periodically (every 60 frames = once per second)
- If mismatch → fire DesyncDetected event

---

### 7. Game Loop Integration

```javascript
// imports/game/GameLoop.js

const TICK_RATE = 60;
const TICK_MS = 1000 / TICK_RATE;

function startGameLoop(session, game, renderer, inputReader) {
  let accumulator = 0;
  let lastTime = performance.now();

  function loop(now) {
    const delta = now - lastTime;
    lastTime = now;
    accumulator += delta;

    // Fixed timestep: may run multiple ticks per render frame
    while (accumulator >= TICK_MS) {
      // 1. Read local input
      const localInput = inputReader.sample();

      // 2. Feed to rollback session
      session.addLocalInput(localInput);
      const requests = session.advanceFrame();

      // 3. Process GGRS-style requests
      for (const request of requests) {
        switch (request.type) {
          case 'SaveGameState':
            request.cell.save(game.serialize());
            break;
          case 'LoadGameState':
            game.deserialize(request.cell.load());
            break;
          case 'AdvanceFrame':
            game.tick(request.inputs);
            break;
        }
      }

      // 4. Handle network events
      for (const event of session.pollEvents()) {
        handleNetworkEvent(event);
      }

      accumulator -= TICK_MS;
    }

    // 5. Render current state (outside fixed timestep)
    renderer.draw(game.state);
    requestAnimationFrame(loop);
  }

  requestAnimationFrame(loop);
}
```

---

### 8. npm Dependencies

```
# P2P WebRTC (primary transport)
peerjs                    # ~13K stars, browser P2P WebRTC

# Server WebRTC relay (fallback transport)
@geckos.io/server         # Server-side WebRTC DataChannels
@geckos.io/client         # Client-side connection to geckos server
```

No other networking dependencies needed. The rollback engine is pure JS with no dependencies.

---

### 9. File Structure (New Spoke App)

```
joust/
├── imports/
│   ├── netcode/                      # Rollback engine (game-agnostic)
│   │   ├── RollbackSession.js        # Main session orchestrator
│   │   ├── InputQueue.js             # Per-player input ring buffer
│   │   ├── StateBuffer.js            # Game state snapshot ring buffer
│   │   ├── TimeSync.js               # Frame timing & advantage
│   │   ├── SyncTestSession.js        # Determinism validator
│   │   ├── InputEncoder.js           # Binary input serialization
│   │   └── transport/
│   │       ├── Transport.js          # Transport interface
│   │       ├── PeerJSTransport.js    # P2P WebRTC via PeerJS
│   │       ├── GeckosTransport.js    # Relay WebRTC via geckos.io
│   │       └── TransportManager.js   # P2P-first with fallback
│   ├── lib/
│   │   └── collections/
│   │       └── gameRooms.js          # Room collection + constants
│   ├── game/                         # Game-specific (not in this plan)
│   │   ├── JoustGame.js              # Deterministic simulation
│   │   ├── GameLoop.js               # Fixed-timestep loop
│   │   └── InputReader.js            # Keyboard sampling
│   └── ui/                           # Mithril components (not in this plan)
│       └── pages/
│           ├── LobbyPage.js
│           └── GamePage.js
├── server/
│   ├── main.js
│   ├── methods/
│   │   └── roomMethods.js            # Room CRUD + matchmaking
│   ├── publications/
│   │   └── roomPublications.js       # Lobby + room state
│   └── relay/
│       └── geckosBridge.js           # geckos.io server relay
├── client/
│   └── main.js                       # Mithril routing
└── package.json
```

---

### 10. Implementation Order

1. **Rollback engine** — RollbackSession, InputQueue, StateBuffer (test with SyncTestSession locally, no network)
2. **Transport layer** — PeerJSTransport first (P2P only, no fallback yet)
3. **Room management** — Meteor methods/publications for matchmaking
4. **Integration** — Connect rollback engine to transport, wire up game loop
5. **Fallback relay** — Add geckos.io server bridge + GeckosTransport + TransportManager fallback logic
6. **Polish** — Desync detection, disconnect handling, reconnection, stats display

---

### 11. Verification & Testing

- **SyncTestSession**: Run every frame with forced rollbacks during development. Any checksum mismatch = non-determinism bug. Fix before testing multiplayer.
- **Local multiplayer test**: Open 2-4 browser tabs on localhost. PeerJS connects them P2P via loopback. Verify inputs sync, no desync.
- **Simulated latency**: Chrome DevTools network throttling to test rollback behavior under 100-300ms latency.
- **NAT fallback test**: Block PeerJS connection (firewall rule) to force geckos.io fallback. Verify game plays identically.
- **Desync detection**: Intentionally introduce non-determinism (e.g., `Math.random()` in game logic) and verify DesyncDetected event fires.
- **Disconnect handling**: Kill a browser tab mid-game. Verify other players see Disconnected event and game handles it gracefully.
