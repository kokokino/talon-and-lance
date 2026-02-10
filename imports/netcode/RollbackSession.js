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
    } = config;

    this.numPlayers = numPlayers;
    this.localPlayerIndex = localPlayerIndex;
    this.maxPredictionWindow = maxPredictionWindow;
    this.inputDelay = inputDelay;
    this.disconnectTimeout = disconnectTimeout;

    // Per-player input queues
    this.inputQueues = [];
    for (let i = 0; i < numPlayers; i++) {
      this.inputQueues.push(new InputQueue());
    }

    this.stateBuffer = new StateBuffer();
    this.timeSync = new TimeSync(numPlayers, localPlayerIndex);

    // Frame tracking
    this.currentFrame = 0;
    this.syncFrame = -1; // highest frame where all inputs are confirmed
    this.lastSavedFrame = -1;

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

    // Checksum tracking for desync detection
    this.lastChecksumFrame = -1;
    this.remoteChecksums = new Map(); // frame -> { peerIndex -> checksum }
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

    // If this input caused a misprediction, we need to rollback
    if (mispredicted) {
      return true; // signals that a rollback will be needed
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

    // Save state for current frame (before advancing)
    requests.push({
      type: 'SaveGameState',
      cell: this.stateBuffer.createCell(this.currentFrame),
    });

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
    const inputFrame = this.currentFrame + this.inputDelay;
    const result = this.inputQueues[this.localPlayerIndex].getInput(inputFrame);
    return {
      frame: inputFrame,
      input: result.input,
    };
  }

  // Get the checksum for the current frame (for sending to peers)
  getCurrentChecksum() {
    if (this.currentFrame > 0 && this.currentFrame % CHECKSUM_INTERVAL === 0) {
      const checksum = this.stateBuffer.getChecksum(this.currentFrame);
      if (checksum !== null) {
        this.lastChecksumFrame = this.currentFrame;
        return { frame: this.currentFrame, checksum };
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
      inputs[i] = this.inputQueues[i].getInput(frame).input;
    }
    return inputs;
  }

  // Find the earliest frame that needs rollback due to misprediction
  _findRollbackFrame() {
    let rollbackFrame = -1;

    for (let i = 0; i < this.numPlayers; i++) {
      if (i === this.localPlayerIndex) {
        continue;
      }

      const confirmedFrame = this.inputQueues[i].getConfirmedFrame();

      // Check each frame from syncFrame+1 to confirmedFrame for mispredictions
      for (let f = this.syncFrame + 1; f <= confirmedFrame; f++) {
        const result = this.inputQueues[i].getInput(f);
        // If this frame's input is now confirmed, the prediction phase is over for it
        // We need to check if the saved state at this frame was simulated with a different input
        if (!result.predicted) {
          if (rollbackFrame < 0 || f < rollbackFrame) {
            // Check if we have a saved state to rollback to
            const savedState = this.stateBuffer.load(f);
            if (savedState !== null) {
              rollbackFrame = f;
            }
          }
        }
      }
    }

    return rollbackFrame;
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
    for (const [frame, peerChecksums] of this.remoteChecksums) {
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

      // Clean up old checksums we've already compared
      if (frame < this.syncFrame) {
        this.remoteChecksums.delete(frame);
      }
    }
  }

  // Check if any peer has timed out
  _checkDisconnects() {
    const now = Date.now();

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

      const lastRecv = this.peerLastRecvTime[i];
      if (lastRecv > 0 && (now - lastRecv) > this.disconnectTimeout) {
        this.peerDisconnected[i] = true;
        this.events.push({ type: 'Disconnected', peer: i });
      } else if (lastRecv > 0 && (now - lastRecv) > (this.disconnectTimeout / 2)) {
        this.events.push({
          type: 'NetworkInterrupted',
          peer: i,
          disconnectTimeout: this.disconnectTimeout - (now - lastRecv),
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

  // Reset the entire session
  reset() {
    this.currentFrame = 0;
    this.syncFrame = -1;
    this.lastSavedFrame = -1;
    this.events = [];
    this.pendingLocalInput = null;
    this.running = false;
    this.lastChecksumFrame = -1;
    this.remoteChecksums.clear();

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
