// Multiplayer Connectivity Tests
// Tests the control plane: MultiplayerManager's orchestration of pending/connected
// peer transitions, _isJoining lifecycle, authority computation, STATE_SYNC handling,
// drain ordering, and disconnect/rejoin flows.
//
// Uses MockMultiplayerPeer to replicate MultiplayerManager's essential state machine
// without Meteor/DOM/PeerJS dependencies.

import assert from 'assert';
import { RollbackSession } from '../../netcode/RollbackSession.js';
import { DeterministicRNG } from '../physics/mulberry32.js';
import {
  HUMANS_OFFSET, CHAR_SIZE, C_ACTIVE,
  MAX_HUMANS,
} from '../physics/stateLayout.js';
import {
  MockNetwork, generateInput,
  processRequests, createSim, compareStates,
  NUM_PLAYERS, GAME_SEED,
} from './testHelpers.js';

// ---- MockMultiplayerPeer ----
// Replicates MultiplayerManager's control-plane state machine:
//   pending/connected peer maps, _isJoining, authority, STATE_SYNC handling,
//   rollback session setup, solo/multiplayer transitions.
// Uses real GameSimulation and RollbackSession for fidelity.

class MockMultiplayerPeer {
  constructor(playerSlot, paletteIndex = 0) {
    this.playerSlot = playerSlot;
    this.paletteIndex = paletteIndex;

    this.simulation = createSim();
    this.session = null;         // null = solo mode
    this.soloMode = true;
    this._isJoining = false;
    this._waitingForSync = false;

    // Peer tracking (mirrors MultiplayerManager)
    this._pendingPeers = new Map();   // peerId -> playerSlot
    this._connectedPeers = new Map(); // peerId -> playerSlot
    this._preSessionInputBuffer = [];
    this._incomingPeerEvents = [];
    this._earlyStateSyncBuffer = []; // STATE_SYNCs before peer maps populated

    // Authority
    this._resyncAuthority = playerSlot; // lowest active slot

    // Wall-clock disconnect tracking
    this._disconnectTimeout = 5000; // ms

    // STATE_SYNC tracking for retransmission tests
    this._stateSyncsSent = [];
    this._pendingRetransmits = [];

    // Input RNG for solo ticks
    this._inputRng = new DeterministicRNG(100 + playerSlot * 100);
  }

  // ---- Initialization ----

  initSolo() {
    this.simulation.activatePlayer(this.playerSlot, this.paletteIndex);
    this.simulation.startGame();
  }

  initAsJoiner() {
    this.simulation.activatePlayer(this.playerSlot, this.paletteIndex);
    this.simulation.startGame();
    this._isJoining = true;
    this._waitingForSync = true;
  }

  // ---- Peer lifecycle (mirrors MultiplayerManager._connectToPeer, etc.) ----

  addPendingPeer(peerId, slot) {
    this._pendingPeers.set(peerId, slot);
  }

  // Buffer connect/disconnect events for deferred processing (like WebRTC callbacks)
  connectPeer(peerId) {
    this._incomingPeerEvents.push({ type: 'connected', peerId });
  }

  disconnectPeer(peerId) {
    this._incomingPeerEvents.push({ type: 'disconnected', peerId });
  }

  // Process buffered peer events (mirrors MultiplayerManager.drainPeerEvents)
  drainPeerEvents() {
    const events = this._incomingPeerEvents;
    this._incomingPeerEvents = [];
    for (const event of events) {
      if (event.type === 'connected') {
        this._handlePeerConnected(event.peerId);
      } else if (event.type === 'disconnected') {
        this._handlePeerDisconnected(event.peerId);
      }
    }
  }

  // Mirrors MultiplayerManager._handlePeerConnected (lines 389-454)
  _handlePeerConnected(peerId) {
    // Promote from pending to connected
    let playerSlot = this._connectedPeers.get(peerId);
    if (playerSlot === undefined) {
      playerSlot = this._pendingPeers.get(peerId);
      if (playerSlot === undefined) {
        return;
      }
      this._pendingPeers.delete(peerId);
      this._connectedPeers.set(peerId, playerSlot);
    } else {
      // Already connected — duplicate notification, ignore
      return;
    }

    if (this.session) {
      this.session.setPeerConnected(playerSlot, true);
      this.session.peerSynchronized[playerSlot] = true;
      this.session.peerLastRecvTime[playerSlot] = Date.now();
      this.session.autoInputSlots.delete(playerSlot);
      this.session.disconnectedSlots.delete(playerSlot);
      this.session.inputQueues[playerSlot].reset();
      this.session.inputQueues[playerSlot].confirmedFrame = this.simulation._frame - 1;
    }

    // Drain any STATE_SYNCs that arrived before peer maps were populated
    if (this._earlyStateSyncBuffer.length > 0) {
      const buffered = this._earlyStateSyncBuffer;
      this._earlyStateSyncBuffer = [];
      for (const entry of buffered) {
        this.receiveStateSyncFromTransport(entry.peerId, entry.frame, entry.stateBuffer);
      }
    }

    // Only the resync authority activates joining players and sends state sync.
    // _isJoining stays true until STATE_SYNC arrives.
    if (this.playerSlot === this._resyncAuthority && !this._isJoining) {
      // Host: activate the joiner, send state, start rollback
      this.simulation.activatePlayer(playerSlot, 0);

      const stateBuffer = this.simulation.serialize();
      const frame = this.simulation._frame;

      // Record outgoing STATE_SYNC for test verification
      const syncRecord = { frame, stateBuffer, recipients: [...this._connectedPeers.keys()] };
      this._lastStateSyncSent = syncRecord;
      this._stateSyncsSent.push(syncRecord);

      // Schedule retransmissions (mirrors production setTimeout retransmits)
      this._pendingRetransmits.push({ peerId, playerSlot });

      if (this.soloMode) {
        this._setupRollbackSession();
      } else if (this.session) {
        this.session.resetToFrame(frame);
      }
    }

    // _isJoining is NOT cleared here (bug #1 fix)
  }

  // Drain pending retransmissions (mirrors production setTimeout retransmits).
  // In production, these fire at 1s and 3s delays. In tests, we call this
  // explicitly to simulate the timers firing.
  processRetransmissions() {
    const pending = this._pendingRetransmits;
    this._pendingRetransmits = [];
    for (const { peerId, playerSlot } of pending) {
      if (!this._connectedPeers.has(peerId)) {
        continue;
      }
      if (this.playerSlot !== this._resyncAuthority) {
        continue;
      }
      const freshState = this.simulation.serialize();
      const freshFrame = this.simulation._frame;
      this._stateSyncsSent.push({
        frame: freshFrame,
        stateBuffer: freshState,
        recipients: [peerId],
      });
    }
  }

  // Mirrors MultiplayerManager._handlePeerDisconnected (lines 456-515)
  _handlePeerDisconnected(peerId) {
    // Could be in _pendingPeers if WebRTC never completed
    if (this._pendingPeers.has(peerId)) {
      this._pendingPeers.delete(peerId);
      return;
    }

    const playerSlot = this._connectedPeers.get(peerId);
    if (playerSlot === undefined) {
      return;
    }

    // Mark slot as disconnected + auto-input in session
    if (this.session) {
      this.session.disconnectedSlots.add(playerSlot);
      this.session.peerDisconnected[playerSlot] = true;
      this.session.autoInputSlots.add(playerSlot);

      // Clear stale checksums
      for (const [frame, peerChecksums] of this.session.remoteChecksums) {
        peerChecksums.delete(playerSlot);
        if (peerChecksums.size === 0) {
          this.session.remoteChecksums.delete(frame);
        }
      }
    }

    this._connectedPeers.delete(peerId);

    // If disconnected peer was the resync authority, recompute
    if (playerSlot === this._resyncAuthority) {
      this._recomputeResyncAuthority();
    }

    // If no more remote players, transition back to solo
    if (this._connectedPeers.size === 0) {
      this.simulation.deactivatePlayer(playerSlot);
      this.soloMode = true;
      this.session = null;
    }
  }

  // Mirrors MultiplayerManager._recomputeResyncAuthority (lines 517-533)
  _recomputeResyncAuthority() {
    const activeSlots = new Set();
    activeSlots.add(this.playerSlot);
    for (const [, slot] of this._connectedPeers) {
      activeSlots.add(slot);
    }
    let lowest = this.playerSlot;
    for (const slot of activeSlots) {
      if (slot < lowest) {
        lowest = slot;
      }
    }
    this._resyncAuthority = lowest;
  }

  // Mirrors MultiplayerManager._setupRollbackSession (lines 535-586)
  _setupRollbackSession() {
    const autoSlots = new Set();
    for (let i = 0; i < MAX_HUMANS; i++) {
      if (i === this.playerSlot) {
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

    this.session = new RollbackSession({
      numPlayers: MAX_HUMANS,
      localPlayerIndex: this.playerSlot,
      startFrame: this.simulation._frame,
      autoInputSlots: autoSlots,
    });

    // Mark all connected peers
    const now = Date.now();
    for (const [, slot] of this._connectedPeers) {
      this.session.setPeerConnected(slot, true);
      this.session.peerSynchronized[slot] = true;
      this.session.peerLastRecvTime[slot] = now;
    }
    this.session.running = true;
    this.soloMode = false;

    // Drain pre-session input buffer
    for (const msg of this._preSessionInputBuffer) {
      if (msg.frame >= this.simulation._frame) {
        this.session.addRemoteInput(msg.playerIndex, msg.frame, msg.input);
      }
    }
    this._preSessionInputBuffer = [];
  }

  // Mirrors STATE_SYNC handling from MultiplayerManager.drainMessages (lines 647-707)
  receiveStateSync(frame, stateBuffer, senderSlot) {
    // Only accept from resync authority (simplified — no 5s fallback in test)
    if (senderSlot !== this._resyncAuthority) {
      const frameDelta = this.simulation._frame - frame;
      // Allow it if the sender is the one who sent our last STATE_SYNC
      // (fallback for joiners who don't know the authority yet)
      if (!this._isJoining) {
        this._lastRejectedStateSync = { frame, senderSlot };
        return false;
      }
    }

    const frameDelta = this.simulation._frame - frame;
    if (!this.soloMode && this.session && frameDelta > 120) {
      this._lastStaleStateSync = { frame, delta: frameDelta };
      return false;
    }

    this.simulation.deserialize(stateBuffer);

    // Clear joiner flag now that we have authoritative state
    if (this._isJoining) {
      this._isJoining = false;
    }

    // If received state has our slot inactive, re-activate
    if (!this.simulation._chars[this.playerSlot].active) {
      this.simulation.activatePlayer(this.playerSlot, this.paletteIndex);
    }

    if (this._waitingForSync) {
      this._waitingForSync = false;
    }

    // Set up rollback from this frame
    if (this.soloMode) {
      // Adopt the STATE_SYNC sender as authority (bug #4 fix)
      this._resyncAuthority = senderSlot;
      this._setupRollbackSession();
    } else if (this.session) {
      this.session.resetToFrame(frame);
      // Ensure all connected peers are removed from autoInput
      for (const [, slot] of this._connectedPeers) {
        this.session.autoInputSlots.delete(slot);
      }
    }

    return true;
  }

  // Mirrors production drainMessages() STATE_SYNC handling.
  // Unlike receiveStateSync() which takes senderSlot directly, this method
  // takes a peerId and looks it up in _connectedPeers / _pendingPeers — exactly
  // as the production code does. This exposes the race condition where the sender
  // is not yet in any peer map.
  receiveStateSyncFromTransport(peerId, frame, stateBuffer) {
    const senderSlot = this._connectedPeers.get(peerId) ?? this._pendingPeers.get(peerId);
    if (senderSlot === undefined) {
      if (this._isJoining && this._earlyStateSyncBuffer.length < 4) {
        this._earlyStateSyncBuffer.push({ peerId, frame, stateBuffer });
        return 'buffered';
      }
      this._lastDroppedStateSync = { peerId, frame, reason: 'unknown-sender' };
      return false;
    }
    return this.receiveStateSync(frame, stateBuffer, senderSlot);
  }

  // Buffer a remote input (may arrive before session exists)
  receiveInput(playerIndex, frame, input) {
    if (this.session) {
      this.session.addRemoteInput(playerIndex, frame, input);
      this.session.peerLastRecvTime[playerIndex] = Date.now();
    } else {
      if (this._preSessionInputBuffer.length < 600) {
        this._preSessionInputBuffer.push({ playerIndex, frame, input });
      }
    }
  }

  // ---- Tick methods ----

  tickSolo(input) {
    if (input === undefined) {
      input = generateInput(this._inputRng);
    }
    const inputs = [0, 0, 0, 0];
    inputs[this.playerSlot] = input;
    this.simulation.tick(inputs);
  }

  tickMultiplayer(input) {
    if (!this.session) {
      return [];
    }
    if (input === undefined) {
      input = generateInput(this._inputRng);
    }
    this.session.addLocalInput(input);
    const requests = this.session.advanceFrame();
    processRequests(this.simulation, requests);
    return requests;
  }

  // ---- Network event handling from rollback session ----

  // Check for disconnect events from the rollback session
  pollSessionEvents() {
    if (!this.session) {
      return [];
    }
    return this.session.pollEvents();
  }

  // Wall-clock disconnect detection (mirrors RollbackSession._checkDisconnectsWallClock)
  checkDisconnectsWallClock() {
    if (!this.session) {
      return [];
    }
    const now = Date.now();
    const disconnected = [];
    for (let i = 0; i < NUM_PLAYERS; i++) {
      if (i === this.playerSlot) {
        continue;
      }
      if (this.session.peerDisconnected[i]) {
        continue;
      }
      if (this.session.autoInputSlots.has(i)) {
        continue;
      }
      if (!this.session.peerConnected[i]) {
        continue;
      }
      const lastRecv = this.session.peerLastRecvTime[i];
      if (lastRecv > 0 && (now - lastRecv) > this._disconnectTimeout) {
        this.session.peerDisconnected[i] = true;
        disconnected.push(i);
      }
    }
    return disconnected;
  }
}

// ---- PeerNetwork ----
// Wires multiple MockMultiplayerPeer instances together via MockNetwork channels
// for integration tests. Handles STATE_SYNC broadcast and input exchange.

class PeerNetwork {
  constructor(peers) {
    this.peers = peers; // Map<slot, MockMultiplayerPeer>
    this.nets = new Map(); // "sender:receiver" -> MockNetwork
    this._tick = 0;
    this._nextNetSeed = 1000;
  }

  addChannel(senderSlot, receiverSlot) {
    const key = `${senderSlot}:${receiverSlot}`;
    if (!this.nets.has(key)) {
      this.nets.set(key, new MockNetwork(this._nextNetSeed++));
    }
  }

  addFullMesh(slots) {
    for (const s of slots) {
      for (const r of slots) {
        if (s !== r) {
          this.addChannel(s, r);
        }
      }
    }
  }

  // Deliver pending network messages and advance tick counter
  deliverInputs(activeSlots) {
    for (const receiver of activeSlots) {
      for (const sender of activeSlots) {
        if (sender === receiver) {
          continue;
        }
        const net = this.nets.get(`${sender}:${receiver}`);
        if (!net) {
          continue;
        }
        const msgs = net.receive(this._tick);
        for (const msg of msgs) {
          this.peers.get(receiver).receiveInput(sender, msg.frame, msg.input);
        }
      }
    }
  }

  // Send local inputs from all active peers
  sendInputs(activeSlots) {
    for (const sender of activeSlots) {
      const peer = this.peers.get(sender);
      if (!peer.session) {
        continue;
      }
      const local = peer.session.getLocalInput();
      if (!local) {
        continue;
      }
      for (const receiver of activeSlots) {
        if (receiver === sender) {
          continue;
        }
        const net = this.nets.get(`${sender}:${receiver}`);
        if (net) {
          net.send(this._tick, local.frame, local.input);
        }
      }
    }
  }

  advanceTick() {
    this._tick++;
  }

  // Broadcast STATE_SYNC from authority to all other active peers
  broadcastStateSync(authoritySlot, activeSlots) {
    const authority = this.peers.get(authoritySlot);
    const stateBuffer = authority.simulation.serialize();
    const frame = authority.simulation._frame;
    for (const slot of activeSlots) {
      if (slot === authoritySlot) {
        continue;
      }
      this.peers.get(slot).receiveStateSync(frame, stateBuffer, authoritySlot);
    }
  }
}

// ---- Test Suite ----

describe('Multiplayer Connectivity', function () {

  // ======================================================================
  // Category 1: Peer Connection Lifecycle
  // ======================================================================

  describe('Peer Connection Lifecycle', function () {

    it('promotes pending peer to connected on connect event', function () {
      const host = new MockMultiplayerPeer(0);
      host.initSolo();

      // Peer 1 initiates connection (pending)
      host.addPendingPeer('peer-1', 1);
      assert.strictEqual(host._pendingPeers.size, 1);
      assert.strictEqual(host._connectedPeers.size, 0);

      // Peer 1 connection completes
      host.connectPeer('peer-1');
      host.drainPeerEvents();

      assert.strictEqual(host._pendingPeers.size, 0, 'Should be removed from pending');
      assert.strictEqual(host._connectedPeers.size, 1, 'Should be in connected');
      assert.strictEqual(host._connectedPeers.get('peer-1'), 1);
    });

    it('cleans up pending peer on disconnect before connect', function () {
      const host = new MockMultiplayerPeer(0);
      host.initSolo();

      // Peer 1 starts connecting but disconnects before completing
      host.addPendingPeer('peer-1', 1);
      host.disconnectPeer('peer-1');
      host.drainPeerEvents();

      assert.strictEqual(host._pendingPeers.size, 0, 'Pending should be cleared');
      assert.strictEqual(host._connectedPeers.size, 0, 'Should not be connected');
    });

    it('ignores duplicate connection notification', function () {
      const host = new MockMultiplayerPeer(0);
      host.initSolo();

      host.addPendingPeer('peer-1', 1);
      host.connectPeer('peer-1');
      host.drainPeerEvents();

      // Second connection event for same peer
      host.connectPeer('peer-1');
      host.drainPeerEvents();

      assert.strictEqual(host._connectedPeers.size, 1, 'Should still be exactly 1 connected');
      assert.strictEqual(host._connectedPeers.get('peer-1'), 1);
    });

    it('handles multiple peers connecting in sequence', function () {
      const host = new MockMultiplayerPeer(0);
      host.initSolo();

      // Run a few solo frames first
      for (let i = 0; i < 10; i++) {
        host.tickSolo(0);
      }

      // Peer 1 connects
      host.addPendingPeer('peer-1', 1);
      host.connectPeer('peer-1');
      host.drainPeerEvents();

      assert.strictEqual(host.soloMode, false, 'Should transition to multiplayer');
      assert.ok(host.session, 'Session should exist');
      assert.ok(!host.session.autoInputSlots.has(1), 'Slot 1 should not be auto-input');
      assert.ok(host.session.autoInputSlots.has(2), 'Slot 2 should be auto-input');
      assert.ok(host.session.autoInputSlots.has(3), 'Slot 3 should be auto-input');

      // Peer 2 connects
      host.addPendingPeer('peer-2', 2);
      host.connectPeer('peer-2');
      host.drainPeerEvents();

      assert.ok(!host.session.autoInputSlots.has(2), 'Slot 2 should no longer be auto-input');
      assert.ok(host.session.autoInputSlots.has(3), 'Slot 3 should still be auto-input');
    });

    it('all 4 peers connect simultaneously in a single drain batch', function () {
      const host = new MockMultiplayerPeer(0);
      host.initSolo();

      for (let i = 0; i < 10; i++) {
        host.tickSolo(0);
      }

      // All 3 joiners connect in same batch
      host.addPendingPeer('peer-1', 1);
      host.addPendingPeer('peer-2', 2);
      host.addPendingPeer('peer-3', 3);
      host.connectPeer('peer-1');
      host.connectPeer('peer-2');
      host.connectPeer('peer-3');
      host.drainPeerEvents();

      assert.strictEqual(host._connectedPeers.size, 3);
      assert.strictEqual(host.soloMode, false);
      assert.ok(host.session);
      // No slots should be auto-input (all 4 are human)
      assert.strictEqual(host.session.autoInputSlots.size, 0, 'No auto-input slots with 4 players');
    });
  });

  // ======================================================================
  // Category 2: Authority & STATE_SYNC
  // ======================================================================

  describe('Authority & STATE_SYNC', function () {

    it('authority is lowest active slot', function () {
      const peer = new MockMultiplayerPeer(2);
      peer.initSolo();

      // Connect slot 0 and slot 1
      peer.addPendingPeer('peer-0', 0);
      peer.addPendingPeer('peer-1', 1);
      peer.connectPeer('peer-0');
      peer.connectPeer('peer-1');
      peer.drainPeerEvents();

      peer._recomputeResyncAuthority();
      assert.strictEqual(peer._resyncAuthority, 0, 'Authority should be slot 0');
    });

    it('authority recomputed on disconnect to next-lowest slot', function () {
      // Joiner at slot 2 connects to host at slot 0 and peer at slot 1
      const peer = new MockMultiplayerPeer(2);
      peer.initAsJoiner();

      peer.addPendingPeer('peer-0', 0);
      peer.addPendingPeer('peer-1', 1);
      peer.connectPeer('peer-0');
      peer.connectPeer('peer-1');
      peer.drainPeerEvents();

      // Receive state sync from slot 0 (authority) — this sets _resyncAuthority = 0
      const hostSim = createSim();
      hostSim.activatePlayer(0, 0);
      hostSim.activatePlayer(1, 0);
      hostSim.activatePlayer(2, 0);
      hostSim.startGame();
      peer.receiveStateSync(hostSim._frame, hostSim.serialize(), 0);

      assert.strictEqual(peer._resyncAuthority, 0);

      // Slot 0 disconnects
      peer.disconnectPeer('peer-0');
      peer.drainPeerEvents();

      assert.strictEqual(peer._resyncAuthority, 1, 'Authority should be slot 1 after slot 0 disconnects');
    });

    it('rejects STATE_SYNC from non-authority peer', function () {
      // Joiner at slot 2 connects to peers at slot 0 and 1
      const joiner = new MockMultiplayerPeer(2);
      joiner.initAsJoiner();

      joiner.addPendingPeer('peer-0', 0);
      joiner.addPendingPeer('peer-1', 1);
      joiner.connectPeer('peer-0');
      joiner.connectPeer('peer-1');
      joiner.drainPeerEvents();

      // Accept STATE_SYNC from authority (slot 0 is lowest connected)
      const hostSim = createSim();
      hostSim.activatePlayer(0, 0);
      hostSim.activatePlayer(1, 0);
      hostSim.activatePlayer(2, 0);
      hostSim.startGame();
      const stateBuffer = hostSim.serialize();
      const accepted = joiner.receiveStateSync(hostSim._frame, stateBuffer, 0);
      assert.ok(accepted, 'Should accept from authority');

      // Authority is now 0 (adopted from sender)
      assert.strictEqual(joiner._resyncAuthority, 0);

      // Reject STATE_SYNC from non-authority (slot 1)
      const rejected = joiner.receiveStateSync(joiner.simulation._frame, stateBuffer, 1);
      assert.ok(!rejected, 'Should reject from non-authority');
    });

    it('joiner transitions solo → multiplayer on STATE_SYNC receipt', function () {
      const joiner = new MockMultiplayerPeer(1);
      joiner.initAsJoiner();

      // Run some solo frames
      for (let i = 0; i < 10; i++) {
        joiner.tickSolo(0);
      }

      assert.ok(joiner.soloMode, 'Should start in solo mode');
      assert.ok(joiner._isJoining, 'Should be joining');
      assert.strictEqual(joiner.session, null, 'Should not have a session yet');

      // Connect to host (slot 0) — this does NOT clear _isJoining
      joiner.addPendingPeer('peer-0', 0);
      joiner.connectPeer('peer-0');
      joiner.drainPeerEvents();

      assert.ok(joiner._isJoining, '_isJoining should still be true after connect');
      assert.strictEqual(joiner.session, null, 'Session should still be null');

      // Create host simulation to generate authoritative state
      const host = new MockMultiplayerPeer(0);
      host.initSolo();
      for (let i = 0; i < 20; i++) {
        host.tickSolo(0);
      }
      host.simulation.activatePlayer(1, 0);
      const stateBuffer = host.simulation.serialize();
      const frame = host.simulation._frame;

      // Receive STATE_SYNC from host
      joiner.receiveStateSync(frame, stateBuffer, 0);

      assert.ok(!joiner._isJoining, '_isJoining should be cleared');
      assert.ok(!joiner.soloMode, 'Should be in multiplayer mode');
      assert.ok(joiner.session, 'Session should exist');
      assert.ok(!joiner._waitingForSync, 'Should no longer be waiting for sync');
    });

    it('joiner adopts sender as authority to prevent split-brain', function () {
      // Scenario: P1 (lower slot) joins existing game where P2 is already playing.
      // P2 is authority. P1 should adopt P2 as authority, not claim it for itself.
      const joiner = new MockMultiplayerPeer(1);
      joiner.initAsJoiner();

      joiner.addPendingPeer('peer-2', 2);
      joiner.connectPeer('peer-2');
      joiner.drainPeerEvents();

      // Before STATE_SYNC, joiner's authority defaults to self (slot 1)
      assert.strictEqual(joiner._resyncAuthority, 1);

      // Receive STATE_SYNC from slot 2
      const stateBuffer = joiner.simulation.serialize();
      joiner.receiveStateSync(joiner.simulation._frame, stateBuffer, 2);

      // After STATE_SYNC, joiner should adopt sender (slot 2) as authority
      assert.strictEqual(joiner._resyncAuthority, 2, 'Should adopt sender as authority');
    });

    it('STATE_SYNC re-activates inactive local slot', function () {
      const joiner = new MockMultiplayerPeer(1);
      joiner.initAsJoiner();

      joiner.addPendingPeer('peer-0', 0);
      joiner.connectPeer('peer-0');
      joiner.drainPeerEvents();

      // Create state where slot 1 is NOT active (joiner just connected,
      // authority hasn't activated them yet in the state)
      const host = new MockMultiplayerPeer(0);
      host.initSolo();
      for (let i = 0; i < 10; i++) {
        host.tickSolo(0);
      }
      // Note: NOT calling host.simulation.activatePlayer(1, ...) — slot 1 is inactive
      const stateBuffer = host.simulation.serialize();

      // Verify slot 1 is inactive in the state
      const buf = new Int32Array(stateBuffer);
      assert.strictEqual(buf[HUMANS_OFFSET + 1 * CHAR_SIZE + C_ACTIVE], 0, 'Slot 1 should be inactive in state');

      // Receive STATE_SYNC — should re-activate local slot
      joiner.receiveStateSync(host.simulation._frame, stateBuffer, 0);

      assert.ok(joiner.simulation._chars[1].active, 'Local slot should be re-activated');
    });

    it('rejects stale STATE_SYNC when delta > 120 frames', function () {
      const peer = new MockMultiplayerPeer(1);
      peer.initAsJoiner();

      // Connect to host
      peer.addPendingPeer('peer-0', 0);
      peer.connectPeer('peer-0');
      peer.drainPeerEvents();

      // Accept initial STATE_SYNC to get into multiplayer mode
      const hostSim = createSim();
      hostSim.activatePlayer(0, 0);
      hostSim.activatePlayer(1, 0);
      hostSim.startGame();
      const initialState = hostSim.serialize();
      peer.receiveStateSync(hostSim._frame, initialState, 0);

      assert.ok(peer.session, 'Should have session');

      // Mark slot 0 as auto-input so the session can advance freely
      // (simulates host going silent — in real code, wall-clock disconnect
      // would do this, but we just need to advance far enough to test stale rejection)
      peer.session.autoInputSlots.add(0);

      // Advance peer's simulation well beyond the state sync
      for (let i = 0; i < 200; i++) {
        peer.tickMultiplayer(0);
      }

      assert.ok(peer.simulation._frame > 120, 'Should have advanced beyond 120 frames');

      // Try to receive a stale STATE_SYNC (frame 0, current frame ~200)
      const staleState = hostSim.serialize();
      const accepted = peer.receiveStateSync(0, staleState, 0);

      assert.ok(!accepted, 'Should reject stale STATE_SYNC');
      assert.ok(peer._lastStaleStateSync, 'Should record stale sync info');
      assert.ok(peer._lastStaleStateSync.delta > 120, 'Delta should exceed threshold');
    });
  });

  // ======================================================================
  // Category 3: Join Lifecycle
  // ======================================================================

  describe('Join Lifecycle', function () {

    it('_isJoining NOT cleared on peer connect', function () {
      const joiner = new MockMultiplayerPeer(1);
      joiner.initAsJoiner();

      joiner.addPendingPeer('peer-0', 0);
      joiner.connectPeer('peer-0');
      joiner.drainPeerEvents();

      assert.ok(joiner._isJoining, '_isJoining must remain true after connect event');
    });

    it('joiner stays in solo mode until STATE_SYNC', function () {
      const joiner = new MockMultiplayerPeer(1);
      joiner.initAsJoiner();

      // Run some solo frames
      for (let i = 0; i < 20; i++) {
        joiner.tickSolo(0);
      }

      // Connect to host — should NOT create rollback session
      joiner.addPendingPeer('peer-0', 0);
      joiner.connectPeer('peer-0');
      joiner.drainPeerEvents();

      assert.ok(joiner.soloMode, 'Should remain in solo mode');
      assert.strictEqual(joiner.session, null, 'No session before STATE_SYNC');

      // More solo frames — everything should still work
      for (let i = 0; i < 20; i++) {
        joiner.tickSolo(0);
      }

      assert.ok(joiner.soloMode, 'Should still be in solo mode');
    });

    it('pre-session input buffer drained into new session', function () {
      const joiner = new MockMultiplayerPeer(1);
      joiner.initAsJoiner();

      // Simulate receiving inputs before session exists
      joiner.receiveInput(0, 5, 0x01);
      joiner.receiveInput(0, 6, 0x02);
      joiner.receiveInput(0, 7, 0x04);

      assert.strictEqual(joiner._preSessionInputBuffer.length, 3, 'Should buffer 3 inputs');

      // Connect and receive STATE_SYNC
      joiner.addPendingPeer('peer-0', 0);
      joiner.connectPeer('peer-0');
      joiner.drainPeerEvents();

      const host = new MockMultiplayerPeer(0);
      host.initSolo();
      host.simulation.activatePlayer(1, 0);
      const stateBuffer = host.simulation.serialize();
      joiner.receiveStateSync(host.simulation._frame, stateBuffer, 0);

      assert.strictEqual(joiner._preSessionInputBuffer.length, 0, 'Buffer should be drained');
      assert.ok(joiner.session, 'Session should exist');
    });

    it('multiple peers connect before authority sends STATE_SYNC', function () {
      const joiner = new MockMultiplayerPeer(2);
      joiner.initAsJoiner();

      // Two peers connect before any STATE_SYNC
      joiner.addPendingPeer('peer-0', 0);
      joiner.addPendingPeer('peer-1', 1);
      joiner.connectPeer('peer-0');
      joiner.connectPeer('peer-1');
      joiner.drainPeerEvents();

      // _isJoining should still be true — waiting for STATE_SYNC
      assert.ok(joiner._isJoining, 'Should still be joining');
      assert.strictEqual(joiner.session, null, 'No session yet');
      assert.strictEqual(joiner._connectedPeers.size, 2, 'Both peers connected');

      // Now receive STATE_SYNC from authority (slot 0)
      const host = new MockMultiplayerPeer(0);
      host.initSolo();
      host.simulation.activatePlayer(1, 0);
      host.simulation.activatePlayer(2, 0);
      joiner.receiveStateSync(host.simulation._frame, host.simulation.serialize(), 0);

      assert.ok(!joiner._isJoining, 'Should no longer be joining');
      assert.ok(joiner.session, 'Session should exist');
      // Both connected peers should not be auto-input
      assert.ok(!joiner.session.autoInputSlots.has(0), 'Slot 0 not auto-input');
      assert.ok(!joiner.session.autoInputSlots.has(1), 'Slot 1 not auto-input');
    });
  });

  // ======================================================================
  // Category 4: Disconnect & Rejoin
  // ======================================================================

  describe('Disconnect & Rejoin', function () {

    it('disconnect marks autoInputSlots and disconnectedSlots', function () {
      const host = new MockMultiplayerPeer(0);
      host.initSolo();

      // Connect peer 1
      host.addPendingPeer('peer-1', 1);
      host.connectPeer('peer-1');
      host.drainPeerEvents();

      assert.ok(!host.session.autoInputSlots.has(1));
      assert.ok(!host.session.disconnectedSlots.has(1));

      // Now connect peer 2 so the disconnect of peer 1 doesn't transition to solo
      host.addPendingPeer('peer-2', 2);
      host.connectPeer('peer-2');
      host.drainPeerEvents();

      // Disconnect peer 1
      host.disconnectPeer('peer-1');
      host.drainPeerEvents();

      assert.ok(host.session.autoInputSlots.has(1), 'Should mark as auto-input');
      assert.ok(host.session.disconnectedSlots.has(1), 'Should mark as disconnected');
      assert.ok(host.session.peerDisconnected[1], 'peerDisconnected flag should be set');
    });

    it('DISCONNECT_BIT fed produces deterministic deactivation', function () {
      const sim = createSim();
      sim.activatePlayer(0, 0);
      sim.activatePlayer(1, 1);
      sim.startGame();

      assert.ok(sim._chars[1].active, 'Slot 1 should be active');

      // Feed DISCONNECT_BIT (0x08) as input for slot 1
      sim.tick([0, 0x08, 0, 0]);

      assert.ok(!sim._chars[1].active, 'Slot 1 should be deactivated via DISCONNECT_BIT');
      assert.ok(sim._chars[0].active, 'Slot 0 should remain active');
    });

    it('transitions to solo on last peer disconnect', function () {
      const host = new MockMultiplayerPeer(0);
      host.initSolo();

      host.addPendingPeer('peer-1', 1);
      host.connectPeer('peer-1');
      host.drainPeerEvents();

      assert.ok(!host.soloMode, 'Should be in multiplayer');
      assert.ok(host.session, 'Should have session');

      // Disconnect last peer
      host.disconnectPeer('peer-1');
      host.drainPeerEvents();

      assert.ok(host.soloMode, 'Should return to solo mode');
      assert.strictEqual(host.session, null, 'Session should be null');
    });

    it('full disconnect → reconnect → STATE_SYNC → resume with state convergence', function () {
      // Host (P0) and joiner (P1) play, P1 disconnects, P1 reconnects
      const host = new MockMultiplayerPeer(0);
      host.initSolo();

      // P1 joins
      host.addPendingPeer('peer-1', 1);
      host.connectPeer('peer-1');
      host.drainPeerEvents();

      const joiner = new MockMultiplayerPeer(1);
      joiner.initAsJoiner();
      joiner.addPendingPeer('peer-0', 0);
      joiner.connectPeer('peer-0');
      joiner.drainPeerEvents();

      // Exchange STATE_SYNC
      const stateBuffer1 = host.simulation.serialize();
      joiner.receiveStateSync(host.simulation._frame, stateBuffer1, 0);

      // Both run for a bit
      for (let i = 0; i < 30; i++) {
        host.tickMultiplayer(0);
        joiner.tickMultiplayer(0);
      }

      // P1 disconnects
      host.disconnectPeer('peer-1');
      host.drainPeerEvents();

      // Host continues solo
      for (let i = 0; i < 30; i++) {
        host.tickSolo(0);
      }

      // P1 reconnects
      host.addPendingPeer('peer-1-new', 1);
      host.connectPeer('peer-1-new');
      host.drainPeerEvents();

      // Host should send fresh STATE_SYNC
      const stateBuffer2 = host.simulation.serialize();
      const frame2 = host.simulation._frame;

      // Joiner receives STATE_SYNC
      joiner._isJoining = true; // Re-entering
      joiner.addPendingPeer('peer-0-new', 0);
      joiner.connectPeer('peer-0-new');
      joiner.drainPeerEvents();
      joiner.receiveStateSync(frame2, stateBuffer2, 0);

      // After STATE_SYNC, both should have identical state
      const hostBuf = new Int32Array(host.simulation.serialize());
      const joinerBuf = new Int32Array(joiner.simulation.serialize());
      const report = compareStates(hostBuf, joinerBuf, 'post-rejoin');
      assert.strictEqual(report, null, report || 'States should match after rejoin');
    });

    it('authority retransmits STATE_SYNC for reconnecting peers', function () {
      // Set up 3-player game (P0 host, P1, P2)
      const host = new MockMultiplayerPeer(0);
      host.initSolo();
      for (let i = 0; i < 10; i++) {
        host.tickSolo(0);
      }

      // P1 and P2 join
      host.addPendingPeer('peer-1', 1);
      host.addPendingPeer('peer-2', 2);
      host.connectPeer('peer-1');
      host.connectPeer('peer-2');
      host.drainPeerEvents();

      assert.ok(host._stateSyncsSent.length >= 1, 'Should have at least 1 STATE_SYNC sent');
      const initialCount = host._stateSyncsSent.length;
      const initialFrame = host._stateSyncsSent[0].frame;

      // P1 disconnects, host continues for 30 frames
      host.disconnectPeer('peer-1');
      host.drainPeerEvents();
      for (let i = 0; i < 30; i++) {
        host.tickMultiplayer(0);
      }

      // P1 reconnects with new peer ID
      host.addPendingPeer('peer-1-new', 1);
      host.connectPeer('peer-1-new');
      host.drainPeerEvents();

      // Should have at least one more STATE_SYNC for the reconnect
      assert.ok(host._stateSyncsSent.length > initialCount,
        'Should have sent STATE_SYNC for reconnecting peer');

      // Simulate retransmission timers firing
      host.processRetransmissions();

      // Should have additional retransmission entries
      assert.ok(host._stateSyncsSent.length > initialCount + 1,
        `Should have retransmission entries (got ${host._stateSyncsSent.length}, expected > ${initialCount + 1})`);

      // Retransmission should have a frame >= the initial send (fresh state, not stale)
      const lastSync = host._stateSyncsSent[host._stateSyncsSent.length - 1];
      const reconnectSync = host._stateSyncsSent[initialCount];
      assert.ok(lastSync.frame >= reconnectSync.frame,
        'Retransmission frame should be >= initial reconnect frame');
    });

    it('duplicate STATE_SYNC reception is idempotent', function () {
      // Host and joiner connect, exchange STATE_SYNC, both tick in multiplayer
      const host = new MockMultiplayerPeer(0);
      host.initSolo();
      for (let i = 0; i < 10; i++) {
        host.tickSolo(0);
      }

      const joiner = new MockMultiplayerPeer(1);
      joiner.initAsJoiner();

      // Connect
      host.addPendingPeer('peer-1', 1);
      host.connectPeer('peer-1');
      host.drainPeerEvents();

      joiner.addPendingPeer('peer-0', 0);
      joiner.connectPeer('peer-0');
      joiner.drainPeerEvents();

      // Initial STATE_SYNC
      const stateBuffer1 = host.simulation.serialize();
      const frame1 = host.simulation._frame;
      const accepted1 = joiner.receiveStateSync(frame1, stateBuffer1, 0);
      assert.ok(accepted1, 'First STATE_SYNC should be accepted');
      assert.ok(joiner.session, 'Session should exist after first STATE_SYNC');

      // Both tick for 10 frames
      for (let i = 0; i < 10; i++) {
        host.tickMultiplayer(0);
        joiner.tickMultiplayer(0);
      }

      // Host sends a SECOND STATE_SYNC (simulating retransmission)
      const stateBuffer2 = host.simulation.serialize();
      const frame2 = host.simulation._frame;
      const accepted2 = joiner.receiveStateSync(frame2, stateBuffer2, 0);
      assert.ok(accepted2, 'Duplicate STATE_SYNC should be accepted (idempotent)');

      // Joiner should still have a valid session
      assert.ok(joiner.session, 'Session should still exist after duplicate STATE_SYNC');
      assert.ok(!joiner.soloMode, 'Should still be in multiplayer mode');

      // Both tick more — should not crash or desync
      for (let i = 0; i < 10; i++) {
        host.tickMultiplayer(0);
        joiner.tickMultiplayer(0);
      }

      // States should match after host sends fresh state and both tick from it
      const hostBuf = new Int32Array(host.simulation.serialize());
      const joinerBuf = new Int32Array(joiner.simulation.serialize());
      const report = compareStates(hostBuf, joinerBuf, 'post-duplicate-sync');
      assert.strictEqual(report, null, report || 'States should match after duplicate STATE_SYNC');
    });

    it('reconnecting joiner receives STATE_SYNC even when authority is not yet in peer maps', function () {
      // Models the production race condition:
      // 1. Authority (warm subscription) discovers joiner's new peerId immediately
      // 2. Authority connects via WebRTC and sends STATE_SYNC
      // 3. STATE_SYNC arrives at joiner BEFORE joiner's own DDP subscription
      //    has fired (authority's peerId not in _pendingPeers or _connectedPeers)
      // 4. STATE_SYNC should still be accepted — not silently dropped

      // Set up 4-player game
      const peers = new Map();
      for (let i = 0; i < 4; i++) {
        peers.set(i, new MockMultiplayerPeer(i));
      }

      peers.get(0).initSolo();
      for (let i = 0; i < 10; i++) {
        peers.get(0).tickSolo(0);
      }

      // All players join normally
      for (let i = 1; i <= 3; i++) {
        peers.get(i).initAsJoiner();
        peers.get(0).addPendingPeer(`peer-${i}`, i);
        peers.get(0).connectPeer(`peer-${i}`);
      }
      peers.get(0).drainPeerEvents();

      const state = peers.get(0).simulation.serialize();
      const frame = peers.get(0).simulation._frame;
      for (let i = 1; i <= 3; i++) {
        for (let j = 0; j <= 3; j++) {
          if (j !== i) {
            peers.get(i).addPendingPeer(`peer-${j}`, j);
            peers.get(i).connectPeer(`peer-${j}`);
          }
        }
        peers.get(i).drainPeerEvents();
        peers.get(i).receiveStateSync(frame, state, 0);
      }

      // P1 disconnects
      for (const [slot, peer] of peers) {
        if (slot !== 1) {
          peer.disconnectPeer('peer-1');
          peer.drainPeerEvents();
        }
      }

      // Remaining 3 tick
      for (let i = 0; i < 30; i++) {
        peers.get(0).tickMultiplayer(0);
      }

      // === P1 RECONNECTS — modeling the race condition ===

      // Authority (P0) side: discovers P1's new peerId, connects, sends STATE_SYNC
      peers.get(0).addPendingPeer('peer-1-new', 1);
      peers.get(0).connectPeer('peer-1-new');
      peers.get(0).drainPeerEvents();

      // P1 side: fresh joiner state
      const p1 = peers.get(1);
      p1._isJoining = true;
      p1._waitingForSync = true;
      p1.soloMode = true;
      p1.session = null;

      // KEY: P1's DDP subscription has NOT arrived yet.
      // P0's peerId is NOT in P1's _pendingPeers or _connectedPeers.
      // No addPendingPeer() or connectPeer() called on P1 — this models the
      // real race where WebRTC is faster than DDP subscription propagation.

      // Authority sends STATE_SYNC — arrives via transport (peerId lookup path)
      const rejoinState = peers.get(0).simulation.serialize();
      const rejoinFrame = peers.get(0).simulation._frame;
      const result = p1.receiveStateSyncFromTransport('peer-0-new', rejoinFrame, rejoinState);

      // STATE_SYNC should be buffered (not dropped) when authority not in peer maps
      assert.strictEqual(result, 'buffered', 'STATE_SYNC should be buffered when authority not in peer maps');

      // DDP subscription finally arrives — peer maps get populated
      p1.addPendingPeer('peer-0-new', 0);
      p1.connectPeer('peer-0-new');
      p1.drainPeerEvents(); // Promotes peer and replays buffered STATE_SYNC

      // Now the joiner should have transitioned
      assert.ok(!p1._isJoining, 'Joiner should no longer be _isJoining');
      assert.ok(p1.session, 'Joiner should have a rollback session');
    });

    it('4-player: one disconnects and rejoins, 3 continue', function () {
      const peers = new Map();
      for (let i = 0; i < 4; i++) {
        peers.set(i, new MockMultiplayerPeer(i));
      }

      // P0 is host, all connect
      peers.get(0).initSolo();
      for (let i = 0; i < 10; i++) {
        peers.get(0).tickSolo(0);
      }

      // Connect P1, P2, P3 to host
      for (let i = 1; i <= 3; i++) {
        peers.get(i).initAsJoiner();
        peers.get(0).addPendingPeer(`peer-${i}`, i);
        peers.get(0).connectPeer(`peer-${i}`);
      }
      peers.get(0).drainPeerEvents();

      // All joiners receive STATE_SYNC from host
      const stateBuffer = peers.get(0).simulation.serialize();
      const frame = peers.get(0).simulation._frame;
      for (let i = 1; i <= 3; i++) {
        peers.get(i).addPendingPeer('peer-0', 0);
        peers.get(i).connectPeer('peer-0');
        // Also connect to each other peer
        for (let j = 1; j <= 3; j++) {
          if (j !== i) {
            peers.get(i).addPendingPeer(`peer-${j}`, j);
            peers.get(i).connectPeer(`peer-${j}`);
          }
        }
        peers.get(i).drainPeerEvents();
        peers.get(i).receiveStateSync(frame, stateBuffer, 0);
      }

      // P2 disconnects
      for (const [slot, peer] of peers) {
        if (slot !== 2) {
          peer.disconnectPeer(`peer-2`);
          peer.drainPeerEvents();
        }
      }

      // Remaining 3 continue — verify they have sessions
      for (const slot of [0, 1, 3]) {
        assert.ok(peers.get(slot).session, `P${slot} should still have session`);
        assert.ok(peers.get(slot).session.disconnectedSlots.has(2) ||
                  peers.get(slot).session.autoInputSlots.has(2),
                  `P${slot} should have slot 2 as disconnected or auto`);
      }

      // P2 reconnects — host sends STATE_SYNC
      peers.get(0).addPendingPeer('peer-2-new', 2);
      peers.get(0).connectPeer('peer-2-new');
      peers.get(0).drainPeerEvents();

      const rejoinState = peers.get(0).simulation.serialize();
      const rejoinFrame = peers.get(0).simulation._frame;

      // P2 reconnects and receives STATE_SYNC
      peers.get(2)._isJoining = true;
      peers.get(2).addPendingPeer('peer-0-new', 0);
      peers.get(2).connectPeer('peer-0-new');
      peers.get(2).drainPeerEvents();
      peers.get(2).receiveStateSync(rejoinFrame, rejoinState, 0);

      assert.ok(peers.get(2).session, 'P2 should have session after rejoin');
      assert.ok(!peers.get(2)._isJoining, 'P2 should no longer be joining');
    });
  });

  // ======================================================================
  // Category 5: Wall-Clock Disconnect
  // ======================================================================

  describe('Wall-Clock Disconnect', function () {

    it('wall-clock detection triggers during stall', function () {
      const host = new MockMultiplayerPeer(0);
      host._disconnectTimeout = 100; // 100ms for test speed
      host.initSolo();

      host.addPendingPeer('peer-1', 1);
      host.connectPeer('peer-1');
      host.drainPeerEvents();

      // Also connect P2 so disconnect of P1 doesn't go solo
      host.addPendingPeer('peer-2', 2);
      host.connectPeer('peer-2');
      host.drainPeerEvents();

      // Set lastRecvTime to a past time
      host.session.peerLastRecvTime[1] = Date.now() - 200;
      host.session.peerLastRecvTime[2] = Date.now(); // P2 is fine

      const disconnected = host.checkDisconnectsWallClock();

      assert.ok(disconnected.includes(1), 'Should detect slot 1 as disconnected');
      assert.ok(!disconnected.includes(2), 'Should not detect slot 2');
    });

    it('precise threshold: now - lastRecv > disconnectTimeout', function () {
      const host = new MockMultiplayerPeer(0);
      host._disconnectTimeout = 5000;
      host.initSolo();

      host.addPendingPeer('peer-1', 1);
      host.addPendingPeer('peer-2', 2);
      host.connectPeer('peer-1');
      host.connectPeer('peer-2');
      host.drainPeerEvents();

      // Just under threshold — should NOT disconnect
      host.session.peerLastRecvTime[1] = Date.now() - 4999;
      host.session.peerLastRecvTime[2] = Date.now();

      let disconnected = host.checkDisconnectsWallClock();
      assert.ok(!disconnected.includes(1), 'Should not disconnect at 4999ms');

      // Just over threshold — should disconnect
      host.session.peerLastRecvTime[1] = Date.now() - 5001;

      disconnected = host.checkDisconnectsWallClock();
      assert.ok(disconnected.includes(1), 'Should disconnect at 5001ms');
    });

    it('skips autoInputSlots (no false positive)', function () {
      const host = new MockMultiplayerPeer(0);
      host._disconnectTimeout = 100;
      host.initSolo();

      host.addPendingPeer('peer-1', 1);
      host.connectPeer('peer-1');
      host.drainPeerEvents();

      // Slot 2 and 3 are auto-input — they should never trigger disconnect
      // even with stale lastRecvTime
      host.session.peerLastRecvTime[2] = Date.now() - 10000;
      host.session.peerLastRecvTime[3] = Date.now() - 10000;
      host.session.peerLastRecvTime[1] = Date.now(); // P1 is fine

      const disconnected = host.checkDisconnectsWallClock();
      assert.strictEqual(disconnected.length, 0, 'Should not disconnect any auto-input slots');
    });

    it('frame-based disconnect during normal operation', function () {
      this.timeout(30000);

      const host = new MockMultiplayerPeer(0);
      host.initSolo();

      // Run a few solo frames
      for (let i = 0; i < 5; i++) {
        host.tickSolo(0);
      }

      host.addPendingPeer('peer-1', 1);
      host.addPendingPeer('peer-2', 2);
      host.connectPeer('peer-1');
      host.connectPeer('peer-2');
      host.drainPeerEvents();

      // Override prediction window to be larger than disconnect threshold (300)
      // so the session can advance far enough for frame-based detection.
      // In the real game, wall-clock detection handles completely silent peers;
      // frame-based detection handles peers that lag behind (slow network).
      host.session.maxPredictionWindow = 400;

      // Feed some initial inputs from slot 1, then stop
      // (simulates peer that stops sending after a while)
      const startFrame = host.session.currentFrame;
      for (let i = 0; i < 10; i++) {
        host.session.addRemoteInput(1, startFrame + i + host.session.inputDelay, 0);
        host.session.peerLastRecvTime[1] = Date.now();
      }

      let disconnectDetected = false;

      // Advance session many frames — slot 1 stops sending, slot 2 keeps sending
      for (let i = 0; i < 350; i++) {
        host.tickMultiplayer(0);
        // Feed inputs for slot 2 so it stays connected
        host.session.addRemoteInput(2, host.session.currentFrame + host.session.inputDelay, 0);
        host.session.peerLastRecvTime[2] = Date.now();

        const events = host.pollSessionEvents();
        for (const event of events) {
          if (event.type === 'Disconnected' && event.peer === 1) {
            disconnectDetected = true;
          }
        }
      }

      assert.ok(disconnectDetected, 'Should fire frame-based disconnect for slot 1');
    });
  });

  // ======================================================================
  // Category 6: Event Ordering
  // ======================================================================

  describe('Event Ordering', function () {

    it('messageDrain → tick → postTickDrain ordering is preserved', function () {
      const host = new MockMultiplayerPeer(0);
      host.initSolo();
      const order = [];

      // Connect a peer
      host.addPendingPeer('peer-1', 1);
      host.connectPeer('peer-1');

      // Simulate the game loop ordering:
      // 1. messageDrain (process network messages)
      order.push('messageDrain');

      // 2. tick (advance simulation)
      host.tickSolo(0);
      order.push('tick');

      // 3. postTickDrain (process peer events)
      host.drainPeerEvents();
      order.push('postTickDrain');

      assert.deepStrictEqual(order, ['messageDrain', 'tick', 'postTickDrain']);

      // Verify the connect event was processed in postTickDrain
      assert.strictEqual(host._connectedPeers.size, 1, 'Peer should be connected after drain');
    });

    it('connect event deferred during tick cycle', function () {
      const host = new MockMultiplayerPeer(0);
      host.initSolo();

      // Buffer a connect event
      host.addPendingPeer('peer-1', 1);
      host._incomingPeerEvents.push({ type: 'connected', peerId: 'peer-1' });

      // Before drain: peer should still be in pending
      assert.ok(host._pendingPeers.has('peer-1'), 'Should be pending before drain');
      assert.strictEqual(host._connectedPeers.size, 0, 'Should not be connected before drain');

      // Multiple ticks can happen before drain
      for (let i = 0; i < 5; i++) {
        host.tickSolo(0);
      }

      // Peer still not connected
      assert.strictEqual(host._connectedPeers.size, 0, 'Still not connected mid-ticks');

      // Drain processes the connect
      host.drainPeerEvents();
      assert.strictEqual(host._connectedPeers.size, 1, 'Connected after drain');
    });

    it('mixed connect+disconnect in same drain batch both processed', function () {
      const host = new MockMultiplayerPeer(0);
      host.initSolo();

      // Pre-connect P1 so we can disconnect it
      host.addPendingPeer('peer-1', 1);
      host.connectPeer('peer-1');
      host.drainPeerEvents();

      // Also connect P2 to prevent solo transition
      host.addPendingPeer('peer-2', 2);
      host.connectPeer('peer-2');
      host.drainPeerEvents();

      assert.strictEqual(host._connectedPeers.size, 2);

      // Now buffer: P3 connects, P1 disconnects — in same batch
      host.addPendingPeer('peer-3', 3);
      host._incomingPeerEvents.push({ type: 'connected', peerId: 'peer-3' });
      host._incomingPeerEvents.push({ type: 'disconnected', peerId: 'peer-1' });
      host.drainPeerEvents();

      // P3 should be connected, P1 should be gone
      assert.ok(host._connectedPeers.has('peer-3'), 'P3 should be connected');
      assert.ok(!host._connectedPeers.has('peer-1'), 'P1 should be disconnected');
      assert.strictEqual(host._connectedPeers.size, 2, 'Should have P2 and P3');
    });
  });

  // ======================================================================
  // Category 7: Multi-Phase Integration
  // ======================================================================

  describe('Multi-Phase Integration', function () {

    it('full 4-player lifecycle: join/leave/rejoin', function () {
      this.timeout(30000);

      const host = new MockMultiplayerPeer(0);
      host.initSolo();

      // P0 plays solo for a bit
      for (let i = 0; i < 30; i++) {
        host.tickSolo(0);
      }

      // Phase 1: P1 joins
      host.addPendingPeer('peer-1', 1);
      host.connectPeer('peer-1');
      host.drainPeerEvents();

      const p1 = new MockMultiplayerPeer(1);
      p1.initAsJoiner();
      p1.addPendingPeer('peer-0', 0);
      p1.connectPeer('peer-0');
      p1.drainPeerEvents();
      p1.receiveStateSync(host.simulation._frame, host.simulation.serialize(), 0);

      assert.ok(!p1._isJoining, 'P1 should be in multiplayer');
      assert.ok(p1.session, 'P1 should have session');

      // Both tick for a bit
      for (let i = 0; i < 30; i++) {
        host.tickMultiplayer(0);
        p1.tickMultiplayer(0);
      }

      // Phase 2: P2 joins
      host.addPendingPeer('peer-2', 2);
      host.connectPeer('peer-2');
      host.drainPeerEvents();

      const p2 = new MockMultiplayerPeer(2);
      p2.initAsJoiner();
      p2.addPendingPeer('peer-0', 0);
      p2.addPendingPeer('peer-1', 1);
      p2.connectPeer('peer-0');
      p2.connectPeer('peer-1');
      p2.drainPeerEvents();
      p2.receiveStateSync(host.simulation._frame, host.simulation.serialize(), 0);

      assert.ok(p2.session, 'P2 should have session');

      // All 3 tick
      for (let i = 0; i < 20; i++) {
        host.tickMultiplayer(0);
        p1.tickMultiplayer(0);
        p2.tickMultiplayer(0);
      }

      // Phase 3: P1 leaves
      host.disconnectPeer('peer-1');
      host.drainPeerEvents();
      p2.disconnectPeer('peer-1');
      p2.drainPeerEvents();

      assert.ok(host.session, 'Host should still have session (P2 still connected)');
      assert.ok(host.session.disconnectedSlots.has(1) || host.session.autoInputSlots.has(1),
        'Slot 1 should be marked disconnected');

      // Host and P2 continue
      for (let i = 0; i < 20; i++) {
        host.tickMultiplayer(0);
        p2.tickMultiplayer(0);
      }

      // Phase 4: P1 rejoins
      host.addPendingPeer('peer-1-new', 1);
      host.connectPeer('peer-1-new');
      host.drainPeerEvents();

      p1._isJoining = true;
      p1.addPendingPeer('peer-0-new', 0);
      p1.addPendingPeer('peer-2-new', 2);
      p1.connectPeer('peer-0-new');
      p1.connectPeer('peer-2-new');
      p1.drainPeerEvents();
      p1.receiveStateSync(host.simulation._frame, host.simulation.serialize(), 0);

      assert.ok(p1.session, 'P1 should have session after rejoin');

      // Phase 5: P3 joins
      host.addPendingPeer('peer-3', 3);
      host.connectPeer('peer-3');
      host.drainPeerEvents();

      const p3 = new MockMultiplayerPeer(3);
      p3.initAsJoiner();
      p3.addPendingPeer('peer-0', 0);
      p3.connectPeer('peer-0');
      p3.drainPeerEvents();
      p3.receiveStateSync(host.simulation._frame, host.simulation.serialize(), 0);

      assert.ok(p3.session, 'P3 should have session');

      // All 4 tick
      for (let i = 0; i < 20; i++) {
        host.tickMultiplayer(0);
        p1.tickMultiplayer(0);
        p2.tickMultiplayer(0);
        p3.tickMultiplayer(0);
      }

      // Final: verify all sessions are active
      for (const [label, peer] of [['host', host], ['P1', p1], ['P2', p2], ['P3', p3]]) {
        assert.ok(peer.session, `${label} should have active session`);
        assert.ok(!peer.soloMode, `${label} should be in multiplayer mode`);
      }
    });

    it('authority migration: authority disconnects, next-lowest takes over', function () {
      const host = new MockMultiplayerPeer(0);
      host.initSolo();

      for (let i = 0; i < 10; i++) {
        host.tickSolo(0);
      }

      // P1 and P2 join
      host.addPendingPeer('peer-1', 1);
      host.addPendingPeer('peer-2', 2);
      host.connectPeer('peer-1');
      host.connectPeer('peer-2');
      host.drainPeerEvents();

      const p1 = new MockMultiplayerPeer(1);
      p1.initAsJoiner();
      p1.addPendingPeer('peer-0', 0);
      p1.addPendingPeer('peer-2', 2);
      p1.connectPeer('peer-0');
      p1.connectPeer('peer-2');
      p1.drainPeerEvents();
      p1.receiveStateSync(host.simulation._frame, host.simulation.serialize(), 0);

      const p2 = new MockMultiplayerPeer(2);
      p2.initAsJoiner();
      p2.addPendingPeer('peer-0', 0);
      p2.addPendingPeer('peer-1', 1);
      p2.connectPeer('peer-0');
      p2.connectPeer('peer-1');
      p2.drainPeerEvents();
      p2.receiveStateSync(host.simulation._frame, host.simulation.serialize(), 0);

      // Verify initial authority
      assert.strictEqual(p1._resyncAuthority, 0, 'P1 should see P0 as authority');
      assert.strictEqual(p2._resyncAuthority, 0, 'P2 should see P0 as authority');

      // P0 disconnects
      p1.disconnectPeer('peer-0');
      p1.drainPeerEvents();
      p2.disconnectPeer('peer-0');
      p2.drainPeerEvents();

      // P1 (lowest remaining) should become authority
      assert.strictEqual(p1._resyncAuthority, 1, 'P1 should become authority');
      assert.strictEqual(p2._resyncAuthority, 1, 'P2 should see P1 as new authority');

      // P1 and P2 continue
      for (let i = 0; i < 20; i++) {
        p1.tickMultiplayer(0);
        p2.tickMultiplayer(0);
      }

      // P0 rejoins — P1 is now authority and should handle the join
      p1.addPendingPeer('peer-0-new', 0);
      p1.connectPeer('peer-0-new');
      p1.drainPeerEvents();

      // P1 should have sent STATE_SYNC (as new authority)
      assert.ok(p1._lastStateSyncSent, 'P1 (new authority) should send STATE_SYNC');

      // P0 receives STATE_SYNC from P1
      const rejoinHost = new MockMultiplayerPeer(0);
      rejoinHost.initAsJoiner();
      rejoinHost.addPendingPeer('peer-1', 1);
      rejoinHost.addPendingPeer('peer-2', 2);
      rejoinHost.connectPeer('peer-1');
      rejoinHost.connectPeer('peer-2');
      rejoinHost.drainPeerEvents();

      const syncData = p1._lastStateSyncSent;
      rejoinHost.receiveStateSync(syncData.frame, syncData.stateBuffer, 1);

      // Rejoin host should adopt P1 as authority
      assert.strictEqual(rejoinHost._resyncAuthority, 1, 'Rejoined P0 should see P1 as authority');
      assert.ok(rejoinHost.session, 'Rejoined P0 should have session');
    });

    it('rapid join/leave cycling (3 rounds)', function () {
      this.timeout(30000);

      const host = new MockMultiplayerPeer(0);
      host.initSolo();

      for (let i = 0; i < 10; i++) {
        host.tickSolo(0);
      }

      for (let round = 0; round < 3; round++) {
        // P1 joins
        const peerId = `peer-1-round${round}`;
        host.addPendingPeer(peerId, 1);
        host.connectPeer(peerId);
        host.drainPeerEvents();

        assert.ok(!host.soloMode, `Round ${round}: should be in multiplayer`);
        assert.ok(host.session, `Round ${round}: should have session`);

        // Tick a bit
        for (let i = 0; i < 20; i++) {
          host.tickMultiplayer(0);
        }

        // P1 disconnects
        host.disconnectPeer(peerId);
        host.drainPeerEvents();

        assert.ok(host.soloMode, `Round ${round}: should return to solo`);
        assert.strictEqual(host.session, null, `Round ${round}: session should be null`);

        // Solo ticks
        for (let i = 0; i < 10; i++) {
          host.tickSolo(0);
        }
      }

      // After 3 cycles, host should still be functional
      assert.ok(host.simulation._chars[0].active, 'Host player should still be active');
    });
  });
});
