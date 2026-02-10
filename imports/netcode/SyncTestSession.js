// Determinism validation tool
// Runs the game with forced rollbacks every frame at configurable depth
// Checksums game state after rollback+resimulate and compares to original
// Detects non-determinism bugs without needing network
//
// Usage:
//   const syncTest = new SyncTestSession({ rollbackDepth: 2 });
//   // In your game loop:
//   const requests = syncTest.advanceFrame(localInput);
//   // Process requests same as RollbackSession

import { StateBuffer } from './StateBuffer.js';

export class SyncTestSession {
  constructor(config = {}) {
    const {
      rollbackDepth = 2,
      numPlayers = 1,
    } = config;

    this.rollbackDepth = rollbackDepth;
    this.numPlayers = numPlayers;
    this.currentFrame = 0;
    this.stateBuffer = new StateBuffer();
    this.checksumLog = []; // record of frame -> checksum for debugging
    this.errors = [];
  }

  // Advance one frame with forced rollback for testing determinism
  // Returns an array of requests just like RollbackSession
  advanceFrame(inputs) {
    const requests = [];

    // Normalize inputs to array
    const inputArray = Array.isArray(inputs) ? inputs : [inputs];

    // Save current state before advancing
    requests.push({
      type: 'SaveGameState',
      cell: this.stateBuffer.createCell(this.currentFrame),
    });

    // Advance the game normally
    requests.push({ type: 'AdvanceFrame', inputs: inputArray });

    this.currentFrame++;

    // Save state after advancing (this is the "correct" state)
    requests.push({
      type: 'SaveGameState',
      cell: this.stateBuffer.createCell(this.currentFrame),
    });

    // Now force a rollback if we have enough history
    if (this.currentFrame > this.rollbackDepth) {
      const rollbackTarget = this.currentFrame - this.rollbackDepth;

      // Load state from rollbackDepth frames ago
      requests.push({
        type: 'LoadGameState',
        cell: this.stateBuffer.createCell(rollbackTarget),
      });

      // Resimulate forward to current frame
      // The game must apply the same inputs in the same order
      for (let f = rollbackTarget; f < this.currentFrame; f++) {
        requests.push({
          type: 'AdvanceFrame',
          inputs: inputArray, // same inputs
        });
      }

      // Now save the resimulated state under a temporary frame marker
      // so we can compare checksums
      requests.push({
        type: 'SaveGameState',
        cell: this._createVerificationCell(this.currentFrame),
      });
    }

    return requests;
  }

  // After the game processes all requests from advanceFrame(), call this
  // to check if the rollback+resimulate produced the same state
  verify() {
    if (this._pendingVerification) {
      const { frame, checksum } = this._pendingVerification;
      const originalChecksum = this.stateBuffer.getChecksum(frame);

      if (originalChecksum !== null && checksum !== null && originalChecksum !== checksum) {
        const error = {
          frame,
          originalChecksum,
          resimulatedChecksum: checksum,
          message: `Desync at frame ${frame}: original=${originalChecksum.toString(16)}, resimulated=${checksum.toString(16)}`,
        };
        this.errors.push(error);
        console.error('[SyncTest]', error.message);
        return false;
      }

      this._pendingVerification = null;
    }

    return true;
  }

  // Get all recorded errors
  getErrors() {
    return this.errors;
  }

  // Check if any errors have been detected
  hasErrors() {
    return this.errors.length > 0;
  }

  // Reset the test session
  reset() {
    this.currentFrame = 0;
    this.stateBuffer.reset();
    this.checksumLog = [];
    this.errors = [];
    this._pendingVerification = null;
  }

  // --- Private ---

  // Create a cell that captures the checksum for verification
  // instead of saving to the main buffer
  _createVerificationCell(frame) {
    const self = this;
    return {
      frame,
      save(state) {
        // Compute checksum of resimulated state
        const view = new Uint8Array(state);
        let hash = 0x811c9dc5;
        for (let i = 0; i < view.length; i++) {
          hash ^= view[i];
          hash = Math.imul(hash, 0x01000193);
        }
        self._pendingVerification = {
          frame,
          checksum: hash >>> 0,
        };
      },
      load() {
        return self.stateBuffer.load(frame);
      },
    };
  }
}
