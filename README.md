# Talon & Lance

A multiplayer arcade jousting game inspired by the classic 1980s game **Joust**, built as a spoke app in the [Kokokino](https://www.kokokino.com) ecosystem.

## Overview

Players ride flying ostriches and battle by jousting — the player with the higher lance wins each collision. Up to 4 players per room compete in real-time with low-latency rollback netcode.

## Architecture

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

- **Lobby:** Meteor DDP handles matchmaking, accounts, room management
- **Gameplay:** PeerJS WebRTC P2P DataChannels for direct player-to-player communication
- **Fallback:** geckos.io server relay for players behind restrictive NATs
- **Postgame:** Results sent back to Meteor

## Tech Stack

| Technology | Purpose |
|------------|---------|
| **Meteor 3.4** | Real-time framework with MongoDB integration |
| **Mithril.js 2.3** | UI framework for lobby and menus |
| **Babylon JS v8** | 3D rendering with voxel sprites |
| **Pico CSS** | Classless CSS for minimal styling |
| **PeerJS** | P2P WebRTC DataChannels |
| **geckos.io** | Server-side WebRTC relay fallback |

## Getting Started

### Prerequisites
- Meteor 3.4+
- Node.js 22.x
- Access to a running Kokokino Hub instance (local or production)

### Installation

1. Clone this repository:
   ```bash
   git clone https://github.com/kokokino/talon-and-lance.git
   cd talon-and-lance
   ```

2. Install dependencies:
   ```bash
   meteor npm install
   ```

3. Copy the example settings file:
   ```bash
   cp settings.example.json settings.development.json
   ```

4. Run the development server:
   ```bash
   meteor --settings settings.development.json --port 3030
   ```

## Project Structure

```
talon-and-lance/
├── client/
│   ├── main.html              # Main HTML template
│   ├── main.css               # Global styles
│   └── main.js                # Client entry point with routing
├── imports/
│   ├── netcode/               # Rollback engine (game-agnostic)
│   │   ├── RollbackSession.js # Main session orchestrator
│   │   ├── InputQueue.js      # Per-player input ring buffer
│   │   ├── StateBuffer.js     # Game state snapshot ring buffer
│   │   ├── TimeSync.js        # Frame timing & advantage
│   │   ├── SyncTestSession.js # Determinism validator
│   │   ├── InputEncoder.js    # Binary input serialization
│   │   └── transport/
│   │       ├── Transport.js          # Transport interface
│   │       ├── PeerJSTransport.js    # P2P WebRTC via PeerJS
│   │       ├── GeckosTransport.js    # Relay WebRTC via geckos.io
│   │       └── TransportManager.js   # P2P-first with fallback
│   ├── game/                  # Game-specific code
│   │   ├── GameLoop.js        # Fixed-timestep loop
│   │   └── InputReader.js     # Keyboard sampling
│   ├── hub/                   # Hub integration (SSO, API, subscriptions)
│   ├── lib/
│   │   └── collections/       # MongoDB collections
│   │       ├── gameRooms.js   # Room collection + constants
│   │       └── chatMessages.js
│   └── ui/                    # Mithril components and pages
├── server/
│   ├── main.js                # Server entry point
│   ├── methods/
│   │   └── roomMethods.js     # Room CRUD + matchmaking
│   ├── publications/
│   │   └── roomPublications.js
│   ├── relay/
│   │   └── geckosBridge.js    # geckos.io server relay
│   ├── accounts.js            # Custom SSO login handler
│   ├── methods.js             # Chat & subscription methods
│   ├── publications.js        # Chat & user data publications
│   └── indexes.js             # Database indexes
├── documentation/             # Design documents and plans
├── settings.example.json
└── package.json
```

## Game Networking

Talon & Lance uses GGPO-style rollback netcode for smooth multiplayer:

1. **Input delay** (2 frames default) hides most latency
2. **Prediction** — remote inputs predicted as "repeat last known input"
3. **Rollback** — when real input arrives and differs from prediction, game rewinds and resimulates
4. **Integer physics** — all game math uses integers for perfect cross-platform determinism
5. **Checksum verification** — periodic state checksums detect desync between players

## Development

```bash
# Development server on port 3030
npm run dev

# Run tests
npm test

# Run tests in watch mode
npm run test-app
```

## Related Resources

- [Kokokino](https://www.kokokino.com) – Main platform
- [Meteor Documentation](https://docs.meteor.com/)
- [Babylon JS Documentation](https://doc.babylonjs.com/)
- [PeerJS Documentation](https://peerjs.com/docs/)

## License

MIT License – see [LICENSE](LICENSE) file for details.
