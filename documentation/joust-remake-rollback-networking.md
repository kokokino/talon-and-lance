# Joust Remake: Rollback Networking Architecture

## Context

Talon & Lance is a Joust-style multiplayer arcade game built as a Meteor 3.x spoke app in the Kokokino ecosystem. The game supports low-latency multiplayer for up to 4 players per room, playable by people around the world. It implements GGPO-style rollback netcode (inspired by GGRS's request-based API pattern) in plain JavaScript, using PeerJS for P2P WebRTC connections and geckos.io as a server-side WebRTC relay fallback for the ~15% of players behind restrictive NATs.

---

## Architecture Overview

```
┌──────────────────────────────────────────────────────┐
│                    Meteor Server                      │
│  ┌─────────────┐  ┌──────────┐  ┌────────────────┐  │
│  │ Matchmaking  │  │ Accounts │  │  Game Results   │  │
│  │  (Methods)   │  │  (SSO)   │  │ (Collections)   │  │
│  └──────┬───────┘  └──────────┘  └────────────────┘  │
│         │                                             │
│  ┌──────┴─────────────────────────────┐               │
│  │  geckos.io WebRTC Relay            │               │
│  │  (fallback for NAT failures)       │               │
│  └────────────────────────────────────┘               │
└──────────────────────────────────────────────────────┘
          │ WebSocket (lobby)     │ WebRTC (fallback)
          │                       │
     ┌────┴───────────────────────┴────┐
     │          Browser Client          │
     │                                  │
     │   ┌─────────────────────────┐    │
     │   │   MultiplayerManager    │    │  ← Central orchestrator
     │   └───┬───────┬────────┬────┘    │
     │       │       │        │         │
     │  ┌────┴──┐ ┌──┴───┐ ┌─┴──────┐  │
     │  │ Game  │ │ Game │ │Rollback│  │
     │  │ Sim   │ │ Loop │ │Session │  │
     │  └───────┘ └──────┘ └────────┘  │
     │       │                │         │
     │  ┌────┴──┐    ┌───────┴──────┐  │
     │  │Level1 │    │  Transport   │  │
     │  │Scene  │    │  Manager     │  │
     │  │(render│    └───┬─────┬────┘  │
     │  │ only) │   P2P  │     │ Relay │
     │  └───────┘        │     │       │
     └───────────────────┼─────┼───────┘
                         │     │
                    PeerJS     geckos.io
```

**During lobby:** Meteor handles matchmaking, accounts, room management via WebSocket (DDP). `matchmaking.findOrCreate` is the entry point — it either joins an open room or creates one immediately.

**During gameplay:** The game starts in **solo mode** immediately. When a remote player joins the room and WebRTC connects, `MultiplayerManager` transitions seamlessly to rollback multiplayer. If all peers disconnect, it transitions back to solo mode.

**Fallback:** If P2P fails for a player pair, that pair communicates via geckos.io through the Meteor server (still WebRTC/UDP-like, not TCP). Fallback is per-pair, not global.

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
- Configurable: `maxPredictionWindow` (default **30**), `inputDelay` (default **3**), `disconnectTimeout` (default 5000ms), `disconnectFrameThreshold` (300 frames = 5s at 60fps)
- Additional config: `startFrame` (for drop-in mid-game sessions), `autoInputSlots` (Set of slot indices that always return input=0, for unoccupied player slots)
- Tracks `syncFrame` (highest frame with all inputs confirmed), `currentFrame`, and per-peer connection/disconnect state
- Handles frame advantage balancing between peers via `TimeSync`

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

Key API beyond advanceFrame:
- `addRemoteInput(peerIndex, frame, input)` — Feed incoming remote inputs (triggers misprediction tracking)
- `addRemoteChecksum(peerIndex, frame, checksum)` — Store remote checksum for desync comparison
- `setPeerConnected(peerIndex, connected)` — Update peer connection state
- `getLocalInput()` — Get the local input that should be sent to remote peers this frame
- `getCurrentChecksum()` — Get checksum for sending to peers (deferred until syncFrame confirms all inputs)
- `getStats(peerIndex)` — Get session stats: currentFrame, syncFrame, ping, frameAdvantage, predictionGap
- `resetToFrame(frame)` — Reset frame state for resync (clears queues, suppresses checksums for one interval)
- `pollEvents()` — Drain the event queue

**`imports/netcode/InputQueue.js`** — Per-player input tracking
- Circular buffer (`QUEUE_SIZE=128`) storing inputs indexed by frame number
- Tracks which frames have confirmed vs predicted inputs
- Prediction strategy: repeat `lastUserInput` (last confirmed input)
- Prediction rewriting: every `getInput()` call re-predicts from the current `lastUserInput`, so rollback resimulation gets fresh predictions reflecting newly confirmed inputs
- `confirmInput(frame, input)` returns true if the confirmed input differs from what was predicted (misprediction)
- Methods: `addInput(frame, input, predicted)`, `getInput(frame)`, `getConfirmedFrame()`, `reset()`

**`imports/netcode/StateBuffer.js`** — Ring buffer of game state snapshots
- Fixed-size circular buffer (**64 slots**) storing serialized game states
- Each slot: `{ frame, state, checksum }`
- Checksum computed via **FNV-1a** hash of the ArrayBuffer on every save
- State stored as `ArrayBuffer` (no copy on save; copy on `load()` to protect stored snapshot)
- Methods: `save(frame, state)`, `load(frame)`, `getChecksum(frame)`, `createCell(frame)`, `reset()`
- `createCell(frame)` returns a cell object with `save(state)` and `load()` methods for the GGRS-style request API

**`imports/netcode/TimeSync.js`** — Frame timing and advantage balancing
- Running average window: `HISTORY_SIZE=32`
- Tracks local vs remote frame counts per peer
- Calculates frame advantage and recommends frame waits when local client gets too far ahead
- `buildQualityReport(peerIndex)` — Build a quality report `{ frame, ping, frameAdvantage }` for sending to a peer
- `recommendFrameWait()` — Returns number of frames to wait (0 if none), scaled by measured RTT
- `getRecommendedInputDelay(peerIndex)` — Recommended input delay based on average RTT (in frames, clamped 1-15)
- `updateRemoteAdvantage(peerIndex, remoteAdvantage)` — Called when receiving quality report from peer
- `updateRoundTripTime(peerIndex, rtt)` — Record RTT measurement

**`imports/netcode/SyncTestSession.js`** — Determinism validation tool
- Runs the game with forced rollbacks every frame at configurable depth (`rollbackDepth`, default **2**)
- Checksums game state after rollback+resimulate and compares to original
- Detects non-determinism bugs without needing network
- `advanceFrame(inputs)` — Returns GGRS-style requests (save, advance, save, load, re-advance, save-for-verification)
- `verify()` — Call after processing requests to compare checksums; returns false on mismatch
- `getErrors()` — Get all recorded desync errors
- `hasErrors()` — Check if any errors have been detected
- Essential for development — run this before testing multiplayer

**`imports/netcode/InputEncoder.js`** — Binary input serialization and network messages
- Input format for Joust: `{ left, right, flap }` = 3 bits per player (bits 0-2)
- `DISCONNECT_BIT = 0x08` (bit 3) — signals player disconnection in the input stream
- **9 message types** sent over the wire:

| Type | ID | Wire Format |
|------|----|-------------|
| `INPUT` | 0x01 | `[type(1B), frame(4B), playerIndex(1B), count(1B), input0..inputN-1(1B each)]` — inputs newest-first for redundancy |
| `INPUT_ACK` | 0x02 | `[type(1B), frame(4B)]` |
| `SYNC_REQUEST` | 0x03 | `[type(1B), randomValue(4B)]` — pre-game handshake |
| `SYNC_RESPONSE` | 0x04 | `[type(1B), randomValue(4B)]` |
| `QUALITY_REPORT` | 0x05 | `[type(1B), frame(4B), ping(2B), frameAdvantage(1B signed)]` |
| `QUALITY_REPLY` | 0x06 | `[type(1B), pong(2B)]` |
| `STATE_SYNC` | 0x07 | `[type(1B), frame(4B), stateData(NB)]` — authoritative game state |
| `CHECKSUM` | 0x08 | `[type(1B), frame(4B), checksum(4B)]` |
| `RESYNC_REQUEST` | 0x09 | `[type(1B), frame(4B)]` — request fresh STATE_SYNC from authority |

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

**`imports/netcode/transport/Transport.js`** — Base class interface
```javascript
// All transports implement:
// send(peerId, data)        — send ArrayBuffer to peer
// onReceive(callback)       — register receive handler: callback(peerId, data)
// connect(peerId)           — initiate connection
// disconnect(peerId)        — close connection
// getStats(peerId)          — { ping, sendQueueLen }
// isConnected(peerId)       — boolean
// destroy()                 — clean up all connections
```

**`imports/netcode/transport/PeerJSTransport.js`** — Primary P2P transport
- Wraps PeerJS DataConnection
- Configures DataChannels for unreliable/unordered delivery:
  ```javascript
  peer.connect(remotePeerId, {
    reliable: false,
    serialization: 'raw'  // raw binary, no BinaryPack overhead
  });
  connection.dataChannel.binaryType = 'arraybuffer';
  ```
- Uses PeerJS cloud signaling server for WebRTC setup
- Implements heartbeat (every 1s) to detect dead connections (timeout after 3s)
- On connection failure after 3s timeout, fires `onFallbackNeeded(peerId)` event
- `simulatedLatencyMs` property for testing (applies half-RTT delay on both send and receive)

**`imports/netcode/transport/GeckosTransport.js`** — Fallback relay transport
- Client-side: Uses `@geckos.io/client` to connect to Meteor server
- Messages routed through server to target peer
- Same interface as PeerJSTransport — rollback engine doesn't know the difference
- Message format: `[targetPeerId(16B), payload]` — server strips peerId and routes
- Same heartbeat params: 1000ms interval, 3000ms timeout
- `simulatedLatencyMs` property for testing

**`imports/netcode/transport/TransportManager.js`** — Orchestrates connections
- For each peer pair, attempts PeerJS P2P first
- If P2P fails (3s timeout), falls back to GeckosTransport for that specific pair
- Relay transport initialized lazily — only if needed
- Other peer pairs remain P2P — fallback is per-pair, not global
- Exposes unified `send(peerId, data)` and `onReceive(callback)` to the game layer
- Callbacks: `onPeerConnected(peerId)`, `onPeerDisconnected(peerId)`, `onAllPeersConnected()`
- `getConnectionInfo()` — Returns per-peer connection info (type, connected status) for stats display
- `connectToPeers(peerIds)` — Connect to a list of peers
- `allConnected()` — Check if all expected peers are connected

---

### 3. Server-Side Relay (`server/relay/`)

**`server/relay/geckosBridge.js`** — geckos.io server integration
- Exported as `initGeckosRelay()`, called during server startup
- Attaches geckos.io to Meteor's HTTP server: `io.addServer(WebApp.httpServer)`
- On client connect: authenticates via `{ roomId, userId }` passed as connection authorization
- Routes raw binary messages between players in the same game room
- Message format: server reads 16-byte peer ID header, finds target channel, prepends sender ID, and forwards
- Tracks active relay connections per room; cleans up on disconnect

```javascript
import { initGeckosRelay } from './relay/geckosBridge.js';

Meteor.startup(() => {
  initGeckosRelay();
});
```

---

### 4. Matchmaking & Room Management

**Collection: `GameRooms`** (`imports/lib/collections/gameRooms.js`)
```javascript
// Schema:
// {
//   _id: String,
//   hostId: String,           // Meteor userId of room creator
//   gameMode: String,         // 'team' | 'pvp'
//   gameSeed: Number,         // shared deterministic seed for GameSimulation
//   players: [{               // Current players (max 4)
//     userId: String,
//     username: String,
//     peerJsId: String,       // PeerJS peer ID for WebRTC setup
//     ready: Boolean,
//     slot: Number,           // Player slot (0-3)
//     paletteIndex: Number,   // Chosen color palette (0-3)
//   }],
//   status: String,           // 'waiting' | 'starting' | 'playing' | 'finished'
//   maxPlayers: Number,       // always 4 (MAX_PLAYERS)
//   settings: Object,         // Game config
//   createdAt: Date,
//   lastActiveAt: Date,       // Updated by rooms.touch heartbeat
//   startedAt: Date,
//   finishedAt: Date,
//   results: Object,          // Final scores (set by rooms.reportResult)
// }
```

**Methods** (`server/methods/roomMethods.js` and `server/methods/matchmakingMethods.js`)
- `matchmaking.findOrCreate(gameMode, paletteIndex)` — Arcade drop-in entry point: finds an open room with matching game mode, or creates a new one. Returns `{ roomId, playerSlot, gameSeed, isNewRoom }`. If user is already in a room, returns `{ alreadyPlaying: true }`.
- `matchmaking.takeoverAndPlay(gameMode, paletteIndex)` — Leave all stale rooms, then find-or-create. Used when user confirms takeover from another session.
- `rooms.create(settings)` — Create room with custom settings (lobby model, not used by arcade flow)
- `rooms.join(roomId)` — Join existing room (validates not full, not started)
- `rooms.leave(roomId)` — Leave room (if host leaves, migrate host; if last player, finish room)
- `rooms.touch(roomId)` — Heartbeat to update `lastActiveAt` (called every 2 minutes by client)
- `rooms.setReady(roomId, ready)` — Toggle ready state (lobby model)
- `rooms.setPeerJsId(roomId, peerJsId)` — Register PeerJS ID for WebRTC setup
- `rooms.start(roomId)` — Host starts game (lobby model, requires all players ready)
- `rooms.reportResult(roomId, results)` — Submit game results when finished

**Publications** (`server/publications/roomPublications.js`)
- `rooms.lobby` — All rooms with status 'waiting' (for lobby browser)
- `rooms.current(roomId)` — Reactive room data for joined players: player list, PeerJS IDs, status, `gameSeed`

---

### 5. MultiplayerManager (`imports/game/MultiplayerManager.js`)

Central orchestrator that wires together GameSimulation, GameLoop, RollbackSession, TransportManager, and Level1Scene for online play.

**Lifecycle:**
1. `start()` calls `matchmaking.findOrCreate` to find/create a room
2. Creates `GameSimulation` with the room's shared `gameSeed`
3. Creates `GameLoop` in **solo mode** (no rollback), starts immediately
4. Initializes `TransportManager`, registers PeerJS ID in room
5. Subscribes to room publication, watches for new players via Tracker autorun
6. When a remote player's PeerJS ID appears, initiates WebRTC connection
7. On peer connect: authority activates joiner in simulation, broadcasts `STATE_SYNC`, sets up `RollbackSession`, transitions GameLoop to multiplayer
8. If all peers disconnect, transitions back to solo mode
9. `destroy()` stops everything, calls `rooms.leave`

**Message Buffering:**
Transport messages arrive asynchronously from WebRTC callbacks. MultiplayerManager buffers them and drains at specific points in the frame:
- `_incomingMessageBuffer` → drained by `drainMessages()` (called by GameLoop **before** the tick while-loop, so all catch-up ticks have the freshest confirmed inputs)
- `_incomingPeerEvents` → drained by `drainPeerEvents()` (called by GameLoop **after** the tick while-loop, so pending rollbacks resolve before player activation mutates state)

**Quality Reports:**
Every 20 ticks (~3 times per second), sends `QUALITY_REPORT` to all peers containing local frame advantage and ping. On receiving a reply, measures RTT via `Date.now()` delta.

**Room Heartbeat:**
Calls `rooms.touch` every 2 minutes to keep the room alive. Also touches on `visibilitychange` (tab becomes visible). Registers `beforeunload` handler to call `rooms.leave`.

---

### 6. Drop-In / Drop-Out

The game uses an **arcade drop-in model** — no waiting room or ready-check for gameplay. Games start immediately in solo mode and seamlessly accept new players mid-game.

**Player Join Flow:**
1. New player calls `matchmaking.findOrCreate`, gets assigned a slot in an existing room
2. New player starts GameLoop in solo mode with `_waitingForSync = true` (shows "JOINING GAME" overlay)
3. Existing players see new player's PeerJS ID via room publication, initiate WebRTC connection
4. On peer connect, the **resync authority** (lowest active player slot):
   - Activates the joiner in the simulation (`activatePlayer`)
   - Serializes current game state
   - Broadcasts `STATE_SYNC` to **all** connected peers (not just the joiner)
   - Sets up `RollbackSession` (or resets existing one via `resetToFrame`)
5. Joiner receives `STATE_SYNC`:
   - Deserializes state into its simulation
   - Hides "JOINING GAME" overlay
   - Sets up `RollbackSession` starting at the sync frame
   - Transitions GameLoop from solo to multiplayer
6. Existing peers receive the same `STATE_SYNC`, ensuring all peers converge to identical state

**Player Disconnect Flow:**
1. Disconnect detected via room publication (player removed) or transport event
2. The disconnected slot is marked in the `RollbackSession`:
   - Added to `disconnectedSlots` → `_gatherInputs()` feeds `DISCONNECT_BIT` (0x08)
   - Added to `autoInputSlots` → no longer causes prediction stalls
   - Stale remote checksums for that peer are cleared
3. `GameSimulation.tick()` sees the `DISCONNECT_BIT` in the input and sets `char.active = false` **deterministically inside the tick loop** — this survives rollback/resimulation
4. If the disconnected peer was the resync authority, authority migrates to the lowest remaining active slot
5. If no remote peers remain, GameLoop transitions back to solo mode

**Authority:**
The resync authority is always the **lowest active player slot** across all connected peers. All peers compute this independently and agree because they see the same connect/disconnect events.

---

### 7. Desync Detection & Recovery

**Checksum Exchange:**
- `RollbackSession.getCurrentChecksum()` returns a checksum every `CHECKSUM_INTERVAL` (60) frames
- Checksums are **deferred** until `syncFrame` confirms all inputs for that frame — this prevents false positives from comparing predicted-state checksums against confirmed-state checksums
- The `CHECKSUM` message (9 bytes) is broadcast to all peers by `GameLoop._tick()`

**Desync Detection:**
- When a remote checksum arrives, it's stored in `remoteChecksums` (Map of frame → peer → checksum)
- `_checkDesync()` compares local and remote checksums only for frames where `syncFrame` confirms all inputs
- On mismatch, fires `DesyncDetected` event with frame, local checksum, remote checksum, and peer index

**Recovery:**
- `MultiplayerManager._handleNetworkEvent` handles `DesyncDetected`:
  - Only the **resync authority** broadcasts recovery state
  - Rate-limited to once every 3 seconds (`_lastResyncTime`)
  - Serializes current simulation state, broadcasts `STATE_SYNC` to **all** connected peers
- Recipients:
  - Deserialize the authoritative state
  - Call `session.resetToFrame(frame)` which clears input queues, suppresses checksums for one interval, and resets the rollback state
  - Non-authority peers remove connected peers from `autoInputSlots` to resume normal input processing

**Stale STATE_SYNC Protection:**
- If a `STATE_SYNC` arrives with a frame delta > 120 from the recipient's current frame, it's rejected as stale
- The recipient sends a `RESYNC_REQUEST` to the authority, which responds with a fresh `STATE_SYNC`

---

### 8. Determinism Strategy

All game physics use **integer/fixed-point arithmetic** — no floating point in game logic:

**Fixed-point scale:** `FP_SCALE = 256` (8 fractional bits)
- Convert to FP: `toFP(val)` = `(val * 256) | 0`
- Convert from FP: `fromFP(val)` = `val / 256`
- Positions stored as 1/256th pixel units
- Velocities: integer sub-pixel units per frame

**No dt parameter:** All physics assume 60fps fixed timestep. Constants are pre-computed as per-frame deltas (e.g., `FP_GRAVITY_PF`, `FP_FRICTION_PF`).

**Reciprocal-multiply division** (no float division ops):
- `velPerFrame(vel)` — divide by 60: `(vel * 17477) >> 20`
- `idiv3(x)` — divide by 3: `(x * 21846) >> 16`
- `idiv10(x)` — divide by 10: `(x * 6554) >> 16`
- All handle negative values by negating before shift

**Seedable PRNG:**
- `DeterministicRNG` implements mulberry32
- Used for all randomness (spawn positions, egg hatch timing, wave shuffle, etc.)
- PRNG seed is part of serialized game state — on rollback, seed restores to exact value at that frame
- No `Math.random()` in game logic

**No `Date.now()` in game logic:** All timers use frame counts (integers at 60fps)

**Game state serialization:**
- Flat `Int32Array` containing all game state: **556 ints = ~2.2KB**
- Layout:
  ```
  GLOBAL           (20 ints):  frame, rngSeed, waveNumber, waveState, spawnTimer,
                               waveTransitionTimer, gameMode, gameOver,
                               spawnQueueLen, spawnQueue[0..9]
  HUMANS           (4 × 34 ints):  per-slot: active, posX, posY, velX, velY,
                               state, facingDir, isTurning, turnTimer,
                               stridePhase, isFlapping, flapTimer, dead,
                               respawnTimer, invincible, invincibleTimer,
                               joustCooldown, materializing, materializeTimer,
                               materializeDuration, materializeQuickEnd,
                               score, lives, eggsCollected, prevPosX, prevPosY,
                               nextLifeScore, paletteIndex, playerDiedWave,
                               enemyType, hitLava, platformIndex,
                               bounceCount, edgeBumpCount
  ENEMIES          (8 × 34 ints):  same structure as humans
  ENEMY_AI         (8 × 4 ints):   dirTimer, currentDir, flapAccum, enemyType
  EGGS             (8 × 12 ints):  active, posX, posY, velX, velY,
                               onPlatform, enemyType, hatchState, hatchTimer,
                               bounceCount, prevPosY, hitLava
  ```
- Access pattern: `state[HUMANS_OFFSET + slotIndex * CHAR_SIZE + C_POS_X]`
- Serialize: `new Int32Array(TOTAL_INTS)` then direct field writes — microseconds
- Deserialize: `new Int32Array(buffer)` then direct field reads — microseconds

**Checksum for desync detection:**
- FNV-1a hash of the ArrayBuffer computed on every `StateBuffer.save()`
- Exchanged every 60 frames (once per second) after syncFrame confirms inputs
- On mismatch → `DesyncDetected` event → authority broadcasts resync

---

### 9. Game Loop (`imports/game/GameLoop.js`)

The `GameLoop` class implements a fixed-timestep simulation loop that decouples rendering from game ticks. It supports two modes and can transition between them at runtime.

```javascript
const TICK_RATE = 60;
const TICK_MS = 1000 / TICK_RATE;     // ~16.67ms
const INPUT_REDUNDANCY = 5;            // send last 5 inputs per packet
const MAX_TICKS_PER_FRAME = 10;        // cap catch-up to prevent spiral
const CATASTROPHIC_CAP_MS = TICK_MS * 300;  // 5 second hard clamp
```

**Solo Mode** (default):
- `_tick()` samples input, builds a 4-slot input array (only local slot populated), calls `game.tick(inputs)` directly
- No rollback, no network

**Multiplayer Mode:**
- `_tick()` feeds input to `RollbackSession.advanceFrame()`, processes returned requests (save/load/advance), sends local input to all peers with redundancy, sends checksums, polls events
- Input redundancy: each outgoing INPUT message carries the last 5 inputs (newest-first), so peers can recover from up to 4 consecutive dropped packets

**Transitions:**
- `transitionToMultiplayer(session, transport)` — Switch from solo to rollback mode
- `transitionToSolo()` — Switch back to solo mode (clears session and transport)

**Frame loop structure** (`_loop`):
1. **messageDrain()** — Drain pending network messages (MultiplayerManager processes INPUT, STATE_SYNC, CHECKSUM, quality reports)
2. **Tick while-loop** — Run up to `MAX_TICKS_PER_FRAME` fixed ticks to catch up with wall clock time
3. **postTickDrain()** — Drain peer lifecycle events (connect/disconnect) after rollbacks have resolved
4. **Render** — Call `renderer.draw(game.state)` at display refresh rate

---

### 10. Connection Flow (Step by Step)

```
1. MATCHMAKING (Meteor DDP)
   ├── Player calls matchmaking.findOrCreate(gameMode, paletteIndex)
   ├── Server finds open room with matching mode, or creates new one
   ├── Returns { roomId, playerSlot, gameSeed, isNewRoom }
   └── If already in a room: returns { alreadyPlaying: true }

2. SOLO MODE START (immediate)
   ├── MultiplayerManager creates GameSimulation with shared gameSeed
   ├── Activates local player in assigned slot
   ├── Creates GameLoop in solo mode → game begins immediately
   ├── Initializes TransportManager, registers PeerJS ID in room
   ├── If joining existing room: shows "JOINING GAME" overlay, waits for STATE_SYNC
   └── Subscribes to rooms.current publication

3. PEER CONNECTION (PeerJS + fallback)
   ├── Room publication delivers other players' PeerJS IDs
   ├── TransportManager attempts P2P connection:
   │   ├── PeerJS.connect(remotePeerJsId, { reliable: false, serialization: 'raw' })
   │   ├── Wait up to 3 seconds for DataChannel to open
   │   ├── If success → mark peer as P2P ✓
   │   └── If fail → fall back to geckos.io relay for this peer
   └── Peer connected event buffered in _incomingPeerEvents

4. MULTIPLAYER TRANSITION (on peer connect)
   ├── postTickDrain processes peer connected event
   ├── Authority (lowest active slot):
   │   ├── Activates joiner in simulation
   │   ├── Serializes state, broadcasts STATE_SYNC to all peers
   │   ├── Creates RollbackSession (or resets existing via resetToFrame)
   │   └── Transitions GameLoop from solo to multiplayer
   ├── Joiner:
   │   ├── Receives STATE_SYNC, deserializes state
   │   ├── Hides "JOINING GAME" overlay
   │   ├── Creates RollbackSession from sync frame
   │   └── Transitions GameLoop to multiplayer
   └── Existing peers: receive STATE_SYNC, resetToFrame for convergence

5. GAMEPLAY (WebRTC, Meteor uninvolved except heartbeat)
   ├── Fixed 60fps tick with rollback
   ├── Inputs exchanged via PeerJS/geckos with 5-input redundancy
   ├── Checksums exchanged every 60 frames for desync detection
   ├── Quality reports every 20 ticks (~3x/sec) for RTT measurement
   └── Room heartbeat every 2 minutes (rooms.touch)

6. DISCONNECT
   ├── Detected via room publication or transport timeout
   ├── Slot marked with DISCONNECT_BIT → deactivated deterministically in tick
   ├── Authority migrates if needed (lowest remaining active slot)
   ├── If no peers remain → transition back to solo mode
   └── On tab close: rooms.leave via beforeunload handler
```

---

### 11. npm Dependencies

```
# P2P WebRTC (primary transport)
peerjs                    # Browser P2P WebRTC

# Server WebRTC relay (fallback transport)
@geckos.io/server         # Server-side WebRTC DataChannels
@geckos.io/client         # Client-side connection to geckos server
```

No other networking dependencies needed. The rollback engine is pure JS with no dependencies.

---

### 12. File Structure

```
talon-and-lance/
├── imports/
│   ├── netcode/                          # Rollback engine (game-agnostic)
│   │   ├── RollbackSession.js            # Main session orchestrator
│   │   ├── InputQueue.js                 # Per-player input ring buffer (128 slots)
│   │   ├── StateBuffer.js                # Game state snapshot ring buffer (64 slots)
│   │   ├── TimeSync.js                   # Frame timing, RTT, advantage balancing
│   │   ├── SyncTestSession.js            # Determinism validator (forced rollbacks)
│   │   ├── InputEncoder.js               # Binary message encode/decode (9 types)
│   │   └── transport/
│   │       ├── Transport.js              # Transport base class
│   │       ├── PeerJSTransport.js        # P2P WebRTC via PeerJS
│   │       ├── GeckosTransport.js        # Relay WebRTC via geckos.io
│   │       └── TransportManager.js       # P2P-first with per-pair fallback
│   ├── lib/
│   │   └── collections/
│   │       └── gameRooms.js              # Room collection + status/mode constants
│   ├── game/
│   │   ├── GameSimulation.js             # Deterministic simulation (tick/serialize/deserialize)
│   │   ├── GameLoop.js                   # Fixed 60fps timestep (solo + multiplayer modes)
│   │   ├── MultiplayerManager.js         # Online play orchestrator (drop-in/drop-out)
│   │   ├── InputReader.js                # Keyboard/gamepad input sampling
│   │   ├── EnemyAI.js                    # Deterministic enemy AI
│   │   ├── scoring.js                    # Wave composition, point values
│   │   ├── HighScoreTracker.js           # High score submission
│   │   ├── physics/
│   │   │   ├── stateLayout.js            # Int32Array layout, FP helpers, slot constants
│   │   │   ├── constants.js              # All game constants (FP values, platform data)
│   │   │   ├── CollisionSystem.js        # Platform/joust/lava/screen-wrap collisions
│   │   │   ├── PhysicsSystem.js          # Input/friction/gravity application
│   │   │   └── mulberry32.js             # Seedable PRNG (DeterministicRNG)
│   │   ├── scenes/
│   │   │   ├── MainMenuScene.js          # 3D menu, palette picker, mode select
│   │   │   └── Level1Scene.js            # Full Joust renderer (solo + renderer-only modes)
│   │   ├── voxels/                       # VoxelBuilder + voxel model definitions
│   │   ├── audio/                        # AudioManager (Babylon Audio V2, SFX pooling)
│   │   └── tests/
│   │       ├── GameSimulation.test.js    # Determinism, serialize/deserialize, wave system
│   │       ├── CollisionSystem.test.js   # Platform, joust, bounce, lava, screen-wrap
│   │       └── MultiplayerSync.test.js   # 2/3/4-player sync, packet loss, drop-in, desync
│   └── ui/
│       └── pages/
│           ├── BabylonPage.js            # Babylon engine/scene lifecycle
│           └── SsoCallback.js            # SSO token handler
├── server/
│   ├── main.js
│   ├── methods/
│   │   ├── roomMethods.js                # Room CRUD (create/join/leave/touch/start/result)
│   │   └── matchmakingMethods.js         # matchmaking.findOrCreate / takeoverAndPlay
│   ├── publications/
│   │   └── roomPublications.js           # rooms.lobby, rooms.current
│   └── relay/
│       └── geckosBridge.js               # geckos.io server relay (initGeckosRelay)
├── client/
│   └── main.js                           # Mithril routing
└── package.json
```

---

### 13. Testing

#### SyncTestSession (Development)
Run every frame with forced rollbacks during development. Any checksum mismatch = non-determinism bug. Fix before testing multiplayer. Configured with `rollbackDepth: 2` — rolls back 2 frames, resimulates, and compares checksums.

#### Unit Tests (`imports/game/tests/`, `imports/netcode/tests/`)

**GameSimulation.test.js** — Determinism and serialization:
- Produces identical state when run twice with same seed and inputs
- Produces different state with different seeds / different inputs
- Roundtrip serialize → deserialize preserves state byte-for-byte
- Deserialized sim continues deterministically
- Wave system, game over, game mode, input decoding

**CollisionSystem.test.js** — Physics collision logic:
- Platform landing, head bumps, edge fall-off
- Joust resolution: deadzone bounce, height-wins kill, team-play rules, PvP rules
- Bounce separation, lava kill, screen wrap, egg collection

**InputQueue.test.js** — Input prediction and correction:
- Misprediction detection when confirmInput arrives
- Re-prediction with updated baseline after rollback resimulation
- Sequential getInput/confirmInput correctness

#### Multiplayer Sync Tests (`MultiplayerSync.test.js`)

Uses a **`MockNetwork`** class — in-memory FIFO queue with realistic network simulation:
- Variable per-message delivery delay (1-N frames via deterministic RNG, configurable `maxDelay`)
- Optional packet loss via `dropRate` parameter (0.0-1.0)
- Independent random seed per channel instance

**Test cases (18 total):**

| Category | Test | Frames |
|----------|------|--------|
| 2-player basic | stays in sync for 10 seconds | 600 |
| 2-player basic | stays in sync for 5 minutes | 18000 |
| Packet loss | desyncs without redundancy (validates test harness) | — |
| Packet loss | stays in sync with 2% loss + input redundancy | — |
| Network delay | stays in sync with high delay (4-frame max) | — |
| Staggered join | player 2 joins mid-game, converges | — |
| 3-player | stays in sync for 10 seconds | 600 |
| 3-player | stays in sync with 2% packet loss | — |
| 4-player | stays in sync for 10 seconds | 600 |
| 4-player | stays in sync for 60 seconds | 3600 |
| 4-player | stays in sync with 2% packet loss | — |
| 4-player | stays in sync with high delay | — |
| 4-player staggered | all players converge | — |
| 4-player staggered | survives 2% packet loss | — |
| Disconnect/rejoin | stays in sync after disconnect and rejoin | — |
| Desync recovery | recovers via checksum detection + STATE_SYNC | — |

Test helpers build N×N `MockNetwork` meshes, run parallel `GameSimulation` + `RollbackSession` instances, and assert byte-for-byte `Int32Array` equality between all peers at the end. A diagnostic `compareStates()` utility prints first-diverging field for debugging failed tests.

#### Manual Testing
- **Local multiplayer**: Open 2-4 browser tabs on localhost. PeerJS connects them P2P via loopback.
- **Simulated latency**: Append `?latency=200` to URL for 200ms simulated RTT (applied at transport level).
- **NAT fallback**: Block PeerJS connection to force geckos.io fallback. Verify game plays identically.
- **Disconnect handling**: Kill a browser tab mid-game. Verify other players see deactivation and game continues.
