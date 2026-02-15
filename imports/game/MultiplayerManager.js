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
    this._lastResyncReceivedTime = 0;
    this._resyncAuthority = 0; // lowest active slot is the resync authority
    this._waitingForSync = false;
    this._joinTimeoutId = null;
    this._joiningOverlay = null;
    this._heartbeatInterval = null;
    this._beforeUnloadHandler = null;
    this._visibilityHandler = null;
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

    // If joining an existing room, show overlay and defer rendering until STATE_SYNC
    if (!result.isNewRoom) {
      this._waitingForSync = true;
      this._showJoiningOverlay();
      this._joinTimeoutId = setTimeout(() => {
        this._hideJoiningOverlay();
        if (this._waitingForSync && this._gameLoop) {
          this._gameLoop.renderer = this._renderer;
          this._waitingForSync = false;
          console.warn('[MultiplayerManager] Join timeout — starting without STATE_SYNC');
        }
      }, 15000);
    }

    // 2. Create game simulation with room's shared seed (from method result, not minimongo)
    const seed = result.gameSeed;
    if (seed === undefined || seed === null) {
      console.error('[MultiplayerManager] Room document missing gameSeed! Cannot start — desync guaranteed.');
      alert('Failed to start game: missing game seed. Returning to menu.');
      this._simulation?.deactivatePlayer?.(this._playerSlot);
      this._onQuitToMenu();
      return;
    }
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

    // 4. Create game loop in solo mode (defer renderer if waiting for sync)
    this._gameLoop = new GameLoop({
      game: this._simulation,
      renderer: this._waitingForSync ? null : this._renderer,
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

    // 7. Start heartbeat and browser lifecycle handlers
    this._startRoomHeartbeat();
  }

  /**
   * Clean up everything.
   */
  destroy() {
    this._destroyed = true;

    if (this._heartbeatInterval) {
      clearInterval(this._heartbeatInterval);
      this._heartbeatInterval = null;
    }
    if (this._beforeUnloadHandler) {
      window.removeEventListener('beforeunload', this._beforeUnloadHandler);
      this._beforeUnloadHandler = null;
    }
    if (this._visibilityHandler) {
      document.removeEventListener('visibilitychange', this._visibilityHandler);
      this._visibilityHandler = null;
    }

    if (this._joinTimeoutId) {
      clearTimeout(this._joinTimeoutId);
      this._joinTimeoutId = null;
    }
    this._hideJoiningOverlay();

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

  _startRoomHeartbeat() {
    this._touchRoom();
    this._heartbeatInterval = setInterval(() => {
      this._touchRoom();
    }, 2 * 60 * 1000); // every 2 minutes

    this._beforeUnloadHandler = () => {
      if (this._roomId) {
        Meteor.callAsync('rooms.leave', this._roomId).catch(() => {});
      }
    };
    window.addEventListener('beforeunload', this._beforeUnloadHandler);

    this._visibilityHandler = () => {
      if (document.visibilityState === 'visible') {
        this._touchRoom();
      }
    };
    document.addEventListener('visibilitychange', this._visibilityHandler);
  }

  _touchRoom() {
    if (!this._roomId || this._destroyed) {
      return;
    }
    Meteor.callAsync('rooms.touch', this._roomId).catch((err) => {
      if (err.error === 'room-not-found') {
        console.warn('[MultiplayerManager] Room no longer exists, returning to menu');
        this._onQuitToMenu();
      }
    });
  }

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

      // Detect removed players — build set of current peerIds from room document
      const currentPeerIds = new Set();
      for (const player of room.players) {
        if (player.peerJsId) {
          currentPeerIds.add(player.peerJsId);
        }
      }
      for (const [peerId] of this._connectedPeers) {
        if (!currentPeerIds.has(peerId)) {
          // Guard against duplicate events (autorun may fire multiple times before drain)
          const alreadyBuffered = this._incomingPeerEvents.some(
            e => e.type === 'disconnected' && e.peerId === peerId
          );
          if (!alreadyBuffered) {
            this._incomingPeerEvents.push({ type: 'disconnected', peerId });
          }
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

    if (this._session) {
      this._session.setPeerConnected(playerSlot, true);
      this._session.peerSynchronized[playerSlot] = true;
      this._session.peerLastRecvTime[playerSlot] = Date.now();

      // Only the authority modifies autoInputSlots and resets queues here.
      // Non-authority peers will receive STATE_SYNC which calls resetToFrame(),
      // and then remove the slot from autoInput in the STATE_SYNC handler.
      if (this._playerSlot === this._resyncAuthority) {
        this._session.autoInputSlots.delete(playerSlot);
        this._session.inputQueues[playerSlot].reset();
        this._session.inputQueues[playerSlot].confirmedFrame = this._simulation._frame - 1;
      }
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
        this._seedRecentLocalInputs(frame);
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
      this._session.peerDisconnected[playerSlot] = true;
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

    // If no more remote players, transition back to solo.
    // Directly deactivate the leaving player because solo mode feeds
    // neutral input (0) — DISCONNECT_BIT would never be processed.
    if (this._connectedPeers.size === 0 && this._gameLoop) {
      this._simulation.deactivatePlayer(playerSlot);
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
          // Only accept STATE_SYNC from the current resync authority,
          // unless no STATE_SYNC has been received from any peer within 5s (fallback)
          const senderSlot = this._connectedPeers.get(peerId);
          if (senderSlot === undefined) {
            continue;
          }
          if (senderSlot !== this._resyncAuthority) {
            const now = Date.now();
            const timeSinceLastResync = now - (this._lastResyncReceivedTime || 0);
            if (timeSinceLastResync < 5000) {
              console.warn('[MultiplayerManager] Ignoring STATE_SYNC from non-authority peer', senderSlot, '(authority:', this._resyncAuthority, ')');
              continue;
            }
            console.warn('[MultiplayerManager] Accepting STATE_SYNC from non-authority peer', senderSlot, '(authority timeout fallback)');
          }
          const msg = InputEncoder.decodeStateSyncMessage(buffer);
          const frameDelta = this._simulation._frame - msg.frame;
          if (!this._gameLoop.soloMode && this._session && frameDelta > 120) {
            console.warn('[MultiplayerManager] Stale STATE_SYNC, delta:', frameDelta, '— requesting fresh resync');
            const resyncReq = InputEncoder.encodeResyncRequest(this._simulation._frame);
            this._transport.send(peerId, resyncReq);
          } else {
            // Received state sync from host — load it
            this._lastResyncReceivedTime = Date.now();
            this._simulation.deserialize(msg.stateData);
            // Reveal the game now that we have correct state
            if (this._waitingForSync) {
              this._gameLoop.renderer = this._renderer;
              this._hideJoiningOverlay();
              if (this._joinTimeoutId) {
                clearTimeout(this._joinTimeoutId);
                this._joinTimeoutId = null;
              }
              this._waitingForSync = false;
            }
            // Set up rollback from this frame
            if (this._gameLoop.soloMode) {
              this._setupRollbackSession();
            } else if (this._session) {
              this._session.resetToFrame(msg.frame);
              this._seedRecentLocalInputs(msg.frame);
              // Ensure all connected peers are removed from autoInput
              for (const [, slot] of this._connectedPeers) {
                this._session.autoInputSlots.delete(slot);
              }
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
        } else if (msgType === MessageType.RESYNC_REQUEST) {
          // A peer's STATE_SYNC was too stale — send them a fresh one
          if (this._playerSlot === this._resyncAuthority && this._transport) {
            const stateBuffer = this._simulation.serialize();
            const frame = this._simulation._frame;
            const syncMsg = InputEncoder.encodeStateSyncMessage(frame, stateBuffer);
            this._transport.send(peerId, syncMsg);
            console.warn('[MultiplayerManager] Fresh STATE_SYNC sent to', peerId, 'at frame', frame, '(resync request)');
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

  _showJoiningOverlay() {
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;z-index:9999;display:flex;flex-direction:column;align-items:center;justify-content:center;background:radial-gradient(ellipse at 50% 100%, rgba(255,100,0,0.15), transparent 60%) #000;';

    const title = document.createElement('div');
    title.style.cssText = 'color:#FFD700;font-size:36px;font-family:monospace;letter-spacing:4px;';
    title.textContent = 'JOINING GAME';

    const subtitle = document.createElement('div');
    subtitle.style.cssText = 'color:#fff;font-size:18px;font-family:monospace;margin-top:16px;opacity:0.7;';
    subtitle.textContent = 'Syncing with other players';

    const dots = document.createElement('span');
    dots.style.cssText = 'color:#fff;font-size:18px;font-family:monospace;opacity:0.7;';
    dots.textContent = '.';
    let dotCount = 1;
    this._dotInterval = setInterval(() => {
      dotCount = (dotCount % 3) + 1;
      dots.textContent = '.'.repeat(dotCount);
    }, 400);

    subtitle.appendChild(dots);
    overlay.appendChild(title);
    overlay.appendChild(subtitle);
    document.body.appendChild(overlay);
    this._joiningOverlay = overlay;
  }

  _hideJoiningOverlay() {
    if (this._dotInterval) {
      clearInterval(this._dotInterval);
      this._dotInterval = null;
    }
    if (this._joiningOverlay) {
      this._joiningOverlay.remove();
      this._joiningOverlay = null;
    }
  }

  // Seed _recentLocalInputs with neutral inputs after a resync/reset so the
  // first few outgoing packets still carry full redundancy (5 entries).
  // Without this, 1-4 packets after resync carry fewer entries and any
  // packet loss forces the remote peer to predict.
  _seedRecentLocalInputs(frame) {
    this._gameLoop._recentLocalInputs = [];
    for (let i = 0; i < 5; i++) {
      this._gameLoop._recentLocalInputs.push({ frame, input: 0 });
    }
  }
}
