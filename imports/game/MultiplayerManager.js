// MultiplayerManager — Orchestrates the full multiplayer lifecycle.
// Creates GameSimulation + Level1Scene renderer, handles room finding,
// WebRTC setup, drop-in/drop-out, and input routing.

import { Meteor } from 'meteor/meteor';
import { Tracker } from 'meteor/tracker';
import { GameSimulation } from './GameSimulation.js';
import { GameLoop } from './GameLoop.js';
import { InputReader } from './InputReader.js';
import { InputEncoder, MessageType } from '../netcode/InputEncoder.js';
import { RollbackSession } from '../netcode/RollbackSession.js';
import { TransportManager } from '../netcode/transport/TransportManager.js';
import { GameRooms } from '../lib/collections/gameRooms.js';
import { MAX_HUMANS } from './physics/stateLayout.js';

export class MultiplayerManager {
  /**
   * @param {{
   *   gameMode: string,
   *   paletteIndex: number,
   *   renderer: Level1Scene,
   *   scene: BabylonScene,
   *   engine: BabylonEngine,
   *   canvas: HTMLCanvasElement,
   *   orthoBottom: number,
   *   orthoTop: number,
   *   onQuitToMenu: Function,
   *   onGameOver: Function,
   * }} config
   */
  constructor(config) {
    this._gameMode = config.gameMode;
    this._paletteIndex = config.paletteIndex;
    this._renderer = config.renderer;
    this._scene = config.scene;
    this._engine = config.engine;
    this._canvas = config.canvas;
    this._orthoBottom = config.orthoBottom;
    this._orthoTop = config.orthoTop;
    this._onQuitToMenu = config.onQuitToMenu;
    this._onGameOver = config.onGameOver;

    this._roomId = null;
    this._playerSlot = 0;
    this._simulation = null;
    this._gameLoop = null;
    this._inputReader = null;
    this._transport = null;
    this._session = null;
    this._roomSubscription = null;
    this._roomComputation = null;
    this._connectedPeers = new Map(); // peerId -> playerSlot
    this._preSessionInputBuffer = [];
    this._incomingMessageBuffer = [];
    this._incomingPeerEvents = [];
    this._lastResyncTime = 0;
    this._resyncAuthority = 0; // lowest active slot is the resync authority
    this._destroyed = false;
  }

  /**
   * Start the multiplayer flow:
   * 1. Find/create room
   * 2. Start game immediately in solo mode
   * 3. Watch for other players joining
   */
  async start() {
    // 1. Find or create a room
    const result = await Meteor.callAsync('matchmaking.findOrCreate', this._gameMode, this._paletteIndex);
    this._roomId = result.roomId;
    this._playerSlot = result.playerSlot;

    // Tell the renderer which slot is the local player (for HUD)
    this._renderer._localPlayerSlot = this._playerSlot;

    // 2. Create game simulation with room's shared seed
    const room = GameRooms.findOne(this._roomId);
    const seed = room?.gameSeed ?? (Date.now() >>> 0);
    this._simulation = new GameSimulation({
      gameMode: this._gameMode,
      seed,
      orthoBottom: this._orthoBottom,
      orthoTop: this._orthoTop,
    });

    // Activate local player
    this._simulation.activatePlayer(this._playerSlot, this._paletteIndex);
    this._simulation.startGame();

    // 3. Set up input reader (attached to Babylon scene)
    this._inputReader = new InputReader();
    this._inputReader.attach(this._scene);
    this._scene.attachControl();

    // 4. Create game loop in solo mode
    this._gameLoop = new GameLoop({
      game: this._simulation,
      renderer: this._renderer,
      inputReader: this._inputReader,
      localPlayerIndex: this._playerSlot,
    });

    this._gameLoop.onNetworkEvent = (event) => this._handleNetworkEvent(event);
    this._gameLoop.messageDrain = () => this.drainMessages();
    this._gameLoop.postTickDrain = () => this.drainPeerEvents();
    this._gameLoop.start();

    // 5. Initialize transport and register PeerJS ID
    this._transport = new TransportManager();
    const serverUrl = Meteor.absoluteUrl();
    const localPeerId = await this._transport.initialize(serverUrl, this._roomId, Meteor.userId());
    await Meteor.callAsync('rooms.setPeerJsId', this._roomId, localPeerId);

    // Set up message handler
    this._transport.onReceive((peerId, data) => {
      this._handleTransportMessage(peerId, data);
    });

    // Buffer peer lifecycle events so they are processed during drainMessages(),
    // not mid-tick from a WebRTC callback.
    this._transport.onPeerConnected = (peerId) => {
      this._incomingPeerEvents.push({ type: 'connected', peerId });
    };
    this._transport.onPeerDisconnected = (peerId) => {
      this._incomingPeerEvents.push({ type: 'disconnected', peerId });
    };

    // 6. Subscribe to room and watch for new players (after transport is ready)
    this._subscribeToRoom();
  }

  /**
   * Clean up everything.
   */
  destroy() {
    this._destroyed = true;

    if (this._gameLoop) {
      this._gameLoop.stop();
      this._gameLoop = null;
    }

    if (this._inputReader) {
      this._inputReader.detach();
      this._inputReader = null;
    }

    if (this._transport) {
      this._transport.destroy();
      this._transport = null;
    }

    if (this._roomComputation) {
      this._roomComputation.stop();
      this._roomComputation = null;
    }

    if (this._roomSubscription) {
      this._roomSubscription.stop();
      this._roomSubscription = null;
    }

    // Leave room
    if (this._roomId) {
      Meteor.callAsync('rooms.leave', this._roomId).catch(() => {});
      this._roomId = null;
    }

    this._simulation = null;
    this._session = null;
    this._incomingPeerEvents = [];
  }

  /**
   * Submit the final score.
   */
  async submitScore() {
    if (!this._simulation || !this._roomId) {
      return;
    }

    const state = this._simulation.getState();
    if (!state) {
      return;
    }

    const localPlayer = state.humans[this._playerSlot];
    if (localPlayer && localPlayer.active) {
      try {
        await Meteor.callAsync(
          'highScores.submit',
          localPlayer.score,
          this._gameMode,
          state.waveNumber
        );
      } catch (err) {
        console.warn('[MultiplayerManager] Failed to submit score:', err.message);
      }
    }
  }

  // ---- Private ----

  _subscribeToRoom() {
    this._roomSubscription = Meteor.subscribe('rooms.current', this._roomId);

    this._roomComputation = Tracker.autorun(() => {
      if (this._destroyed) {
        return;
      }

      const room = GameRooms.findOne(this._roomId);
      if (!room) {
        return;
      }

      // Check for new players
      for (const player of room.players) {
        if (player.userId === Meteor.userId()) {
          continue; // skip self
        }

        // If this player has a PeerJS ID and we haven't connected yet
        if (player.peerJsId && !this._connectedPeers.has(player.peerJsId)) {
          this._connectToPeer(player);
        }
      }
    });
  }

  async _connectToPeer(player) {
    if (this._destroyed || !this._transport) {
      return;
    }

    this._connectedPeers.set(player.peerJsId, player.slot);

    // Initiate WebRTC connection
    this._transport.connectToPeers([player.peerJsId]);
  }

  _handlePeerConnected(peerId) {
    const playerSlot = this._connectedPeers.get(peerId);
    if (playerSlot === undefined) {
      return;
    }

    console.log('[MultiplayerManager] Peer connected:', peerId, 'slot:', playerSlot);

    // Remove connected peer from auto-input on ALL peers so their real
    // inputs are used instead of defaulting to 0 (Issue A).
    // Also reset the peer's input queue to the current frame so the
    // prediction gap check doesn't block the session (the queue had a
    // stale confirmedFrame from when the slot was auto-input).
    if (this._session) {
      this._session.autoInputSlots.delete(playerSlot);
      this._session.inputQueues[playerSlot].reset();
      this._session.inputQueues[playerSlot].confirmedFrame = this._simulation._frame - 1;
      this._session.setPeerConnected(playerSlot, true);
      this._session.peerSynchronized[playerSlot] = true;
      this._session.peerLastRecvTime[playerSlot] = Date.now();
    }

    // Only the resync authority activates joining players and sends state sync.
    // This prevents multiple peers from independently activating the same joiner
    // at different simulation frames (which would diverge RNG state).
    // The joiner waits to receive STATE_SYNC before transitioning to multiplayer.
    if (this._playerSlot === this._resyncAuthority) {
      // Host: activate the joiner in the simulation, send state, start rollback
      const room = GameRooms.findOne(this._roomId);
      const playerData = room?.players.find(p => p.peerJsId === peerId);
      const palette = playerData?.paletteIndex ?? 0;
      this._simulation.activatePlayer(playerSlot, palette);

      const stateBuffer = this._simulation.serialize();
      const frame = this._simulation._frame;
      const syncMsg = InputEncoder.encodeStateSyncMessage(frame, stateBuffer);
      // Broadcast STATE_SYNC to ALL connected peers (including joiner)
      // so existing peers see the new player activation (Issue B).
      for (const [pid] of this._connectedPeers) {
        this._transport.send(pid, syncMsg);
      }

      if (this._gameLoop.soloMode) {
        this._setupRollbackSession();
      } else if (this._session) {
        // Reset host session to match the peers who received STATE_SYNC.
        // Without this, the host's input queues for existing peers have
        // stale confirmedFrames that cause prediction gap mismatches and
        // rollback issues after the join.
        this._session.resetToFrame(frame);
        this._gameLoop._recentLocalInputs = [];
      }
    }
    // Non-authority peers: STATE_SYNC handler will update state
  }

  _handlePeerDisconnected(peerId) {
    const playerSlot = this._connectedPeers.get(peerId);
    if (playerSlot === undefined) {
      return;
    }

    console.log('[MultiplayerManager] Peer disconnected:', peerId, 'slot:', playerSlot);

    // Do NOT call deactivatePlayer() directly — it mutates game state outside
    // the rollback flow. Instead, mark the slot as disconnected so that
    // _gatherInputs() feeds DISCONNECT_BIT (0x08) as input. GameSimulation.tick()
    // sees the bit and sets char.active = false deterministically inside the
    // tick loop, which survives rollback/resimulation.

    // Mark slot as disconnected + auto-input in session and clear stale checksums
    if (this._session) {
      this._session.disconnectedSlots.add(playerSlot);
      this._session.autoInputSlots.add(playerSlot);

      for (const [frame, peerChecksums] of this._session.remoteChecksums) {
        peerChecksums.delete(playerSlot);
        if (peerChecksums.size === 0) {
          this._session.remoteChecksums.delete(frame);
        }
      }
    }

    this._connectedPeers.delete(peerId);

    // If the disconnected peer was the resync authority, promote the
    // lowest remaining active slot (local player or connected peer).
    if (playerSlot === this._resyncAuthority) {
      this._recomputeResyncAuthority();
      console.log('[MultiplayerManager] Resync authority migrated to slot', this._resyncAuthority);
    }

    // If no more remote players, transition back to solo
    if (this._connectedPeers.size === 0 && this._gameLoop) {
      this._gameLoop.transitionToSolo();
      this._session = null;
    }
  }

  _recomputeResyncAuthority() {
    // Authority is the lowest active slot: local player or any connected peer.
    // All peers compute this independently and agree because they see the
    // same set of connect/disconnect events.
    const activeSlots = new Set();
    activeSlots.add(this._playerSlot);
    for (const [, slot] of this._connectedPeers) {
      activeSlots.add(slot);
    }
    let lowest = this._playerSlot;
    for (const slot of activeSlots) {
      if (slot < lowest) {
        lowest = slot;
      }
    }
    this._resyncAuthority = lowest;
  }

  _setupRollbackSession() {
    // Only truly unoccupied slots are auto-input. Connected peers must go
    // through the input queue so rollback can correct mispredictions.
    const autoSlots = new Set();
    for (let i = 0; i < MAX_HUMANS; i++) {
      if (i === this._playerSlot) {
        continue;
      }
      let hasPlayer = false;
      for (const [, slot] of this._connectedPeers) {
        if (slot === i) {
          hasPlayer = true;
          break;
        }
      }
      if (!hasPlayer) {
        autoSlots.add(i);
      }
    }

    this._session = new RollbackSession({
      numPlayers: MAX_HUMANS,
      localPlayerIndex: this._playerSlot,
      startFrame: this._simulation._frame,
      autoInputSlots: autoSlots,
    });

    // Mark all connected peers as connected in session (for disconnect detection)
    const now = Date.now();
    for (const [, slot] of this._connectedPeers) {
      this._session.setPeerConnected(slot, true);
      this._session.peerSynchronized[slot] = true;
      this._session.peerLastRecvTime[slot] = now;
    }

    // Start immediately (skip sync handshake for drop-in)
    this._session.running = true;

    // Drain any input messages that arrived before the session was created
    for (const msg of this._preSessionInputBuffer) {
      const inputs = msg.inputs || [{ frame: msg.frame, input: msg.input }];
      for (let i = inputs.length - 1; i >= 0; i--) {
        if (inputs[i].frame >= this._simulation._frame) {
          this._session.addRemoteInput(msg.playerIndex, inputs[i].frame, inputs[i].input);
        }
      }
    }
    this._preSessionInputBuffer = [];

    this._gameLoop.transitionToMultiplayer(this._session, this._transport);
  }

  _handleTransportMessage(peerId, data) {
    if (this._destroyed) {
      return;
    }
    this._incomingMessageBuffer.push({ peerId, data });
  }

  /**
   * Process buffered peer lifecycle events (connect/disconnect).
   * Called by GameLoop via postTickDrain AFTER the tick while-loop
   * so that any pending rollbacks (triggered by inputs in messageDrain)
   * have resolved before player activation mutates game state.
   */
  drainPeerEvents() {
    const peerEvents = this._incomingPeerEvents;
    this._incomingPeerEvents = [];
    for (const event of peerEvents) {
      try {
        if (event.type === 'connected') {
          this._handlePeerConnected(event.peerId);
        } else if (event.type === 'disconnected') {
          this._handlePeerDisconnected(event.peerId);
        }
      } catch (err) {
        console.error('[MultiplayerManager] Peer event error:', event.type, err);
      }
    }
  }

  /**
   * Process all buffered network messages (INPUT, STATE_SYNC, CHECKSUM).
   * Called by GameLoop before the tick catch-up loop so that all
   * confirmed inputs are available during rapid catch-up ticks,
   * reducing unnecessary rollbacks.
   */
  drainMessages() {
    const messages = this._incomingMessageBuffer;
    this._incomingMessageBuffer = [];

    for (const { peerId, data } of messages) {
      try {
        const buffer = data instanceof ArrayBuffer ? data : data.buffer;
        const msgType = InputEncoder.getMessageType(buffer);

        if (msgType === MessageType.INPUT) {
          const msg = InputEncoder.decodeInputMessage(buffer);
          if (this._session) {
            // Process redundant inputs oldest-first so confirmInput sees them in order
            const inputs = msg.inputs || [{ frame: msg.frame, input: msg.input }];
            for (let i = inputs.length - 1; i >= 0; i--) {
              this._session.addRemoteInput(msg.playerIndex, inputs[i].frame, inputs[i].input);
            }
            this._session.peerLastRecvTime[msg.playerIndex] = Date.now();
          } else {
            // Buffer inputs arriving before session is set up (e.g., before STATE_SYNC)
            if (this._preSessionInputBuffer.length < 600) {
              this._preSessionInputBuffer.push(msg);
            }
          }
        } else if (msgType === MessageType.STATE_SYNC) {
          // Only accept STATE_SYNC from the current resync authority
          const senderSlot = this._connectedPeers.get(peerId);
          if (senderSlot === undefined || senderSlot !== this._resyncAuthority) {
            if (senderSlot !== undefined) {
              console.warn('[MultiplayerManager] Ignoring STATE_SYNC from non-authority peer', senderSlot, '(authority:', this._resyncAuthority, ')');
            }
            continue;
          }
          const msg = InputEncoder.decodeStateSyncMessage(buffer);
          const frameDelta = this._simulation._frame - msg.frame;
          if (!this._gameLoop.soloMode && this._session && frameDelta > 120) {
            console.warn('[MultiplayerManager] Ignoring stale STATE_SYNC, delta:', frameDelta);
          } else {
            // Received state sync from host — load it
            this._simulation.deserialize(msg.stateData);
            // Set up rollback from this frame
            if (this._gameLoop.soloMode) {
              this._setupRollbackSession();
            } else if (this._session) {
              this._session.resetToFrame(msg.frame);
              this._gameLoop._recentLocalInputs = [];
              console.warn('[MultiplayerManager] Resync received, reset to frame', msg.frame);
            }
          }
        } else if (msgType === MessageType.CHECKSUM) {
          if (this._session) {
            const msg = InputEncoder.decodeChecksumMessage(buffer);
            const peerSlot = this._connectedPeers.get(peerId);
            if (peerSlot !== undefined) {
              this._session.addRemoteChecksum(peerSlot, msg.frame, msg.checksum);
              this._session.peerLastRecvTime[peerSlot] = Date.now();
            }
          }
        }
      } catch (err) {
        console.warn('[MultiplayerManager] Bad message from', peerId, ':', err);
      }
    }
  }

  _handleNetworkEvent(event) {
    if (event.type === 'Disconnected') {
      // Find which peerId this corresponds to
      for (const [peerId, slot] of this._connectedPeers) {
        if (slot === event.peer) {
          this._handlePeerDisconnected(peerId);
          break;
        }
      }
    } else if (event.type === 'DesyncDetected') {
      // Only the resync authority sends authoritative resync state.
      // This prevents multiple peers from independently sending
      // competing resyncs in 3+ player games.
      if (this._playerSlot === this._resyncAuthority) {
        const now = Date.now();
        if (!this._lastResyncTime || (now - this._lastResyncTime) > 3000) {
          this._lastResyncTime = now;
          const stateBuffer = this._simulation.serialize();
          const frame = this._simulation._frame;
          const syncMsg = InputEncoder.encodeStateSyncMessage(frame, stateBuffer);
          // Broadcast to ALL connected peers so everyone converges to the
          // same authoritative state (critical for 3-4 player games)
          for (const [peerId] of this._connectedPeers) {
            this._transport.send(peerId, syncMsg);
          }
          console.warn('[MultiplayerManager] Resync broadcast to all peers at frame', frame);
        }
      }
    }
  }
}
