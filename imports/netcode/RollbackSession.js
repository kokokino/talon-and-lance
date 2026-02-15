// Main rollback session orchestrator
// Manages the rollback loop: predict, simulate, detect misprediction, rollback, resimulate
// Returns an array of requests (GGRS pattern) instead of invoking callbacks
//
// Request types:
//   SaveGameState  — game should serialize its state into the provided cell
//   LoadGameState  — game should deserialize state from the provided cell
//   AdvanceFrame   — game should tick with the provided inputs

import { InputQueue } from './InputQueue.js';
import { StateBuffer } from './StateBuffer.js';
import { TimeSync } from './TimeSync.js';

const DEFAULT_MAX_PREDICTION = 8;
const DEFAULT_INPUT_DELAY = 2;
const DEFAULT_DISCONNECT_TIMEOUT = 5000;
const CHECKSUM_INTERVAL = 60; // frames between checksum exchanges

export class RollbackSession {
  constructor(config) {
    const {
      numPlayers,
      localPlayerIndex,
      maxPredictionWindow = DEFAULT_MAX_PREDICTION,
      inputDelay = DEFAULT_INPUT_DELAY,
      disconnectTimeout = DEFAULT_DISCONNECT_TIMEOUT,
      startFrame = 0,
      autoInputSlots = new Set(),
    } = config;

    this.numPlayers = numPlayers;
    this.localPlayerIndex = localPlayerIndex;
    this.maxPredictionWindow = maxPredictionWindow;
    this.inputDelay = inputDelay;
    this.disconnectTimeout = disconnectTimeout;
    this.disconnectFrameThreshold = 300; // 5 seconds at 60fps
    this.autoInputSlots = autoInputSlots; // Set of slot indices that always return input=0
    this.disconnectedSlots = new Set(); // Set of slot indices that receive DISCONNECT_BIT (0x08)

    // Per-player input queues (confirmedFrame starts at startFrame-1 so
    // prediction gap begins at 0 for drop-in sessions that start mid-game)
    this.inputQueues = [];
    for (let i = 0; i < numPlayers; i++) {
      const queue = new InputQueue();
      queue.confirmedFrame = startFrame - 1;
      this.inputQueues.push(queue);
    }

    this.stateBuffer = new StateBuffer();
    this.timeSync = new TimeSync(numPlayers, localPlayerIndex);

    // Frame tracking
    this.currentFrame = startFrame;
    this.syncFrame = startFrame - 1; // highest frame where all inputs are confirmed
    this.lastSavedFrame = startFrame - 1;

    // Event queue
    this.events = [];

    // Per-peer connection state
    this.peerConnected = new Array(numPlayers).fill(false);
    this.peerConnected[localPlayerIndex] = true; // self is always connected
    this.peerLastRecvTime = new Array(numPlayers).fill(0);
    this.peerDisconnected = new Array(numPlayers).fill(false);
    this.peerSynchronized = new Array(numPlayers).fill(false);
    this.peerSynchronized[localPlayerIndex] = true;

    // Synchronization state (pre-game handshake)
    this.syncState = new Array(numPlayers).fill(0); // count of successful roundtrips
    this.syncTotal = 4; // number of roundtrips needed to consider synced
    this.running = false;

    // Local input for this frame (set via addLocalInput)
    this.pendingLocalInput = null;

    // Track the frame of the last local input added (for getLocalInput)
    this.lastLocalInputFrame = -1;

    // Misprediction-driven rollback tracking
    this.needsRollback = false;
    this.rollbackTargetFrame = -1;

    // Checksum tracking for desync detection
    this.lastChecksumFrame = -1;
    this.remoteChecksums = new Map(); // frame -> { peerIndex -> checksum }
    this.checksumSuppressUntilFrame = -1;
  }

  // Add local input for the current frame
  addLocalInput(input) {
    this.pendingLocalInput = input;
  }

  // Called when a remote input arrives from the transport layer
  addRemoteInput(peerIndex, frame, input) {
    if (peerIndex === this.localPlayerIndex) {
      return;
    }

    const mispredicted = this.inputQueues[peerIndex].confirmInput(frame, input);

    // Update time sync
    this.timeSync.updateRemoteFrame(peerIndex, frame);
    this.peerLastRecvTime[peerIndex] = Date.now();

    // If peer was disconnected, it's back
    if (this.peerDisconnected[peerIndex]) {
      this.peerDisconnected[peerIndex] = false;
      this.events.push({ type: 'NetworkResumed', peer: peerIndex });
    }

    // If this input caused a misprediction, record the earliest rollback target
    if (mispredicted) {
      if (!this.needsRollback || frame < this.rollbackTargetFrame) {
        this.rollbackTargetFrame = frame;
      }
      this.needsRollback = true;
      return true;
    }

    return false;
  }

  // Notify that a remote peer has sent us a checksum for a specific frame
  addRemoteChecksum(peerIndex, frame, checksum) {
    if (!this.remoteChecksums.has(frame)) {
      this.remoteChecksums.set(frame, new Map());
    }
    this.remoteChecksums.get(frame).set(peerIndex, checksum);
  }

  // Main per-frame call: returns array of requests for the game to process
  advanceFrame() {
    if (!this.running) {
      return [];
    }

    const requests = [];

    // Check frame wait recommendation
    const waitFrames = this.timeSync.recommendFrameWait();
    if (waitFrames > 0) {
      this.events.push({ type: 'WaitRecommendation', skipFrames: waitFrames });
      return requests; // skip this tick
    }

    // Check if we've predicted too far ahead
    const predictionGap = this.currentFrame - this._getMinConfirmedFrame();
    if (predictionGap >= this.maxPredictionWindow) {
      return requests; // wait for remote inputs to catch up
    }

    // Add local input with delay
    const inputFrame = this.currentFrame + this.inputDelay;
    if (this.pendingLocalInput !== null) {
      this.inputQueues[this.localPlayerIndex].addInput(inputFrame, this.pendingLocalInput, false);
      this.lastLocalInputFrame = inputFrame;
      this.pendingLocalInput = null;
    }

    // Check if we need a rollback
    const rollbackFrame = this._findRollbackFrame();
    if (rollbackFrame >= 0) {
      // Load state from the rollback point
      requests.push({
        type: 'LoadGameState',
        cell: this.stateBuffer.createCell(rollbackFrame),
      });

      // Resimulate from rollback frame to current frame
      for (let f = rollbackFrame; f < this.currentFrame; f++) {
        const inputs = this._gatherInputs(f);
        requests.push({ type: 'AdvanceFrame', inputs });
        requests.push({
          type: 'SaveGameState',
          cell: this.stateBuffer.createCell(f + 1),
        });
      }
    }

    // Save state for current frame (skip if rollback already saved it)
    if (rollbackFrame < 0) {
      requests.push({
        type: 'SaveGameState',
        cell: this.stateBuffer.createCell(this.currentFrame),
      });
    }

    // Gather inputs (confirmed + predicted) for current frame
    const inputs = this._gatherInputs(this.currentFrame);

    // Advance the frame
    requests.push({ type: 'AdvanceFrame', inputs });

    this.currentFrame++;
    this.timeSync.setLocalFrame(this.currentFrame);

    // Update sync frame
    this._updateSyncFrame();

    // Periodic checksum check
    this._checkDesync();

    // Check for peer disconnects
    this._checkDisconnects();

    return requests;
  }

  // Poll and drain the event queue
  pollEvents() {
    const events = this.events;
    this.events = [];
    return events;
  }

  // Mark a peer as connected (called by transport layer)
  setPeerConnected(peerIndex, connected) {
    this.peerConnected[peerIndex] = connected;
  }

  // Handle synchronization handshake progress
  handleSyncProgress(peerIndex) {
    this.syncState[peerIndex]++;

    this.events.push({
      type: 'Synchronizing',
      peer: peerIndex,
      total: this.syncTotal,
      count: this.syncState[peerIndex],
    });

    if (this.syncState[peerIndex] >= this.syncTotal) {
      this.peerSynchronized[peerIndex] = true;
      this.events.push({ type: 'Synchronized', peer: peerIndex });

      // Check if all peers are synchronized
      if (this._allPeersSynchronized()) {
        this.running = true;
      }
    }
  }

  // Get the local input that should be sent to remote peers this frame
  getLocalInput() {
    if (this.lastLocalInputFrame < 0) {
      return null;
    }
    const result = this.inputQueues[this.localPlayerIndex].getInput(this.lastLocalInputFrame);
    return {
      frame: this.lastLocalInputFrame,
      input: result.input,
    };
  }

  // Get the checksum for the current frame (for sending to peers).
  // Uses currentFrame - 1 because advanceFrame() increments currentFrame
  // before this method is called, so the state just saved is at (currentFrame - 1).
  getCurrentChecksum() {
    const frame = this.currentFrame - 1;
    if (frame < this.checksumSuppressUntilFrame) {
      return null;
    }
    if (frame > 0 && frame % CHECKSUM_INTERVAL === 0) {
      const checksum = this.stateBuffer.getChecksum(frame);
      if (checksum !== null) {
        this.lastChecksumFrame = frame;
        return { frame, checksum };
      }
    }
    return null;
  }

  // Get current session stats
  getStats(peerIndex) {
    return {
      currentFrame: this.currentFrame,
      syncFrame: this.syncFrame,
      ping: this.timeSync.getPing(peerIndex),
      frameAdvantage: this.timeSync.getFrameAdvantage(peerIndex),
      predictionGap: this.currentFrame - this._getMinConfirmedFrame(),
    };
  }

  // --- Private methods ---

  // Gather inputs for all players at a given frame
  _gatherInputs(frame) {
    const inputs = new Array(this.numPlayers);
    for (let i = 0; i < this.numPlayers; i++) {
      if (this.disconnectedSlots.has(i)) {
        // Use real confirmed inputs for past frames, DISCONNECT_BIT only beyond
        if (frame <= this.inputQueues[i].confirmedFrame) {
          inputs[i] = this.inputQueues[i].getInput(frame).input;
        } else {
          inputs[i] = 0x08; // DISCONNECT_BIT
        }
      } else if (this.autoInputSlots.has(i)) {
        inputs[i] = 0; // auto-input slots always return 0 (no input)
      } else {
        const result = this.inputQueues[i].getInput(frame);
        inputs[i] = result.input;
      }
    }
    return inputs;
  }

  // Find the earliest frame that needs rollback due to misprediction
  _findRollbackFrame() {
    if (!this.needsRollback) {
      return -1;
    }

    this.needsRollback = false;
    let frame = this.rollbackTargetFrame;
    this.rollbackTargetFrame = -1;

    // Future-frame misprediction: the confirmed input is already in the
    // queue and will be used when we actually simulate that frame.
    // No rollback needed — we haven't simulated it yet.
    if (frame >= this.currentFrame) {
      return -1;
    }

    // Search forward for the earliest frame with a saved state.
    // The exact target may have been evicted from the ring buffer,
    // but a later state is still better than no rollback at all.
    while (frame < this.currentFrame) {
      if (this.stateBuffer.getChecksum(frame) !== null) {
        return frame;
      }
      frame++;
    }

    // All states evicted — shouldn't happen with default buffer size
    // of 16 slots and maxPredictionWindow of 8, but log for debugging.
    console.warn('[RollbackSession] Rollback state unavailable, all snapshots evicted');
    return -1;
  }

  // Get the minimum confirmed frame across all remote players
  _getMinConfirmedFrame() {
    let minFrame = Infinity;

    for (let i = 0; i < this.numPlayers; i++) {
      if (i === this.localPlayerIndex) {
        continue;
      }
      if (this.peerDisconnected[i]) {
        continue;
      }
      if (this.autoInputSlots.has(i)) {
        continue; // auto-input slots never cause stalls
      }

      const confirmed = this.inputQueues[i].getConfirmedFrame();
      if (confirmed < minFrame) {
        minFrame = confirmed;
      }
    }

    return minFrame === Infinity ? this.currentFrame : minFrame;
  }

  // Update the sync frame (highest frame where all inputs are confirmed)
  _updateSyncFrame() {
    const minConfirmed = this._getMinConfirmedFrame();
    if (minConfirmed > this.syncFrame) {
      this.syncFrame = minConfirmed;
    }
  }

  // Check for desync by comparing local and remote checksums
  _checkDesync() {
    if (this.currentFrame - 1 < this.checksumSuppressUntilFrame) {
      return;
    }

    for (const [frame, peerChecksums] of this.remoteChecksums) {
      // Only compare checksums for frames where ALL inputs are confirmed.
      // Frames beyond syncFrame have predicted inputs and will legitimately
      // differ between peers.
      if (frame > this.syncFrame) {
        continue;
      }

      const localChecksum = this.stateBuffer.getChecksum(frame);
      if (localChecksum === null) {
        continue;
      }

      for (const [peerIndex, remoteChecksum] of peerChecksums) {
        if (localChecksum !== remoteChecksum) {
          this.events.push({
            type: 'DesyncDetected',
            frame,
            localChecksum,
            remoteChecksum,
            peer: peerIndex,
          });
        }
      }

      // Clean up checksums we've already compared (including frame === syncFrame)
      // to prevent repeated DesyncDetected events for the same frame.
      this.remoteChecksums.delete(frame);
    }
  }

  // Check if any peer has timed out (frame-based for determinism)
  _checkDisconnects() {
    for (let i = 0; i < this.numPlayers; i++) {
      if (i === this.localPlayerIndex) {
        continue;
      }
      if (this.peerDisconnected[i]) {
        continue;
      }
      if (!this.peerConnected[i]) {
        continue;
      }

      const confirmedFrame = this.inputQueues[i].confirmedFrame;
      const frameLag = this.currentFrame - confirmedFrame;

      if (confirmedFrame >= 0 && frameLag > this.disconnectFrameThreshold) {
        this.peerDisconnected[i] = true;
        this.events.push({ type: 'Disconnected', peer: i });
      } else if (confirmedFrame >= 0 && frameLag > (this.disconnectFrameThreshold >> 1)) {
        this.events.push({
          type: 'NetworkInterrupted',
          peer: i,
          disconnectTimeout: this.disconnectFrameThreshold - frameLag,
        });
      }
    }
  }

  // Check if all non-local peers are synchronized
  _allPeersSynchronized() {
    for (let i = 0; i < this.numPlayers; i++) {
      if (i === this.localPlayerIndex) {
        continue;
      }
      if (!this.peerSynchronized[i]) {
        return false;
      }
    }
    return true;
  }

  // Reset frame-related state to a specific frame (used when receiving authoritative state from host).
  // Preserves running, peer connection state, and autoInputSlots.
  resetToFrame(frame) {
    this.currentFrame = frame;
    this.syncFrame = frame - 1;
    this.lastSavedFrame = frame - 1;
    this.needsRollback = false;
    this.rollbackTargetFrame = -1;
    this.pendingLocalInput = null;
    this.lastLocalInputFrame = -1;
    this.remoteChecksums.clear();
    this.checksumSuppressUntilFrame = frame + CHECKSUM_INTERVAL;
    this.stateBuffer.reset();
    for (let i = 0; i < this.numPlayers; i++) {
      this.inputQueues[i].reset();
      this.inputQueues[i].confirmedFrame = frame - 1;
    }
    this.timeSync.setLocalFrame(frame);
  }

  // Reset the entire session
  reset() {
    this.currentFrame = 0;
    this.syncFrame = -1;
    this.lastSavedFrame = -1;
    this.events = [];
    this.pendingLocalInput = null;
    this.running = false;
    this.needsRollback = false;
    this.rollbackTargetFrame = -1;
    this.lastChecksumFrame = -1;
    this.remoteChecksums.clear();
    this.checksumSuppressUntilFrame = -1;

    for (let i = 0; i < this.numPlayers; i++) {
      this.inputQueues[i].reset();
      this.peerConnected[i] = i === this.localPlayerIndex;
      this.peerLastRecvTime[i] = 0;
      this.peerDisconnected[i] = false;
      this.peerSynchronized[i] = i === this.localPlayerIndex;
      this.syncState[i] = 0;
    }

    this.stateBuffer.reset();
    this.timeSync.reset();
  }
}
