// Ring buffer of game state snapshots for rollback
// Stores serialized game states as ArrayBuffers for fast copy/restore

const BUFFER_SIZE = 64;

export class StateBuffer {
  constructor() {
    this.slots = new Array(BUFFER_SIZE);

    for (let i = 0; i < BUFFER_SIZE; i++) {
      this.slots[i] = { frame: -1, state: null, checksum: 0 };
    }
  }

  // Save a game state snapshot for the given frame.
  // state should be an ArrayBuffer (e.g., from Int32Array.buffer).
  // No copy on save — callers always serialize a fresh buffer each time.
  // The copy on load() protects the stored snapshot from mutation.
  save(frame, state) {
    const index = frame % BUFFER_SIZE;
    this.slots[index] = {
      frame,
      state,
      checksum: this._computeChecksum(state),
    };
  }

  // Load a previously saved game state for the given frame
  // Returns the ArrayBuffer or null if not found
  load(frame) {
    const index = frame % BUFFER_SIZE;
    const slot = this.slots[index];

    if (slot.frame !== frame) {
      return null;
    }

    return slot.state.slice(0); // return a copy
  }

  // Get the checksum for a saved frame
  getChecksum(frame) {
    const index = frame % BUFFER_SIZE;
    const slot = this.slots[index];

    if (slot.frame !== frame) {
      return null;
    }

    return slot.checksum;
  }

  // Create a cell object for the GGRS-style request API
  // The game calls cell.save(state) or cell.load()
  createCell(frame) {
    const self = this;
    return {
      frame,
      save(state) {
        self.save(frame, state);
      },
      load() {
        return self.load(frame);
      },
    };
  }

  // FNV-1a hash of an ArrayBuffer for desync detection
  _computeChecksum(buffer) {
    const view = new Uint8Array(buffer);
    let hash = 0x811c9dc5; // FNV offset basis

    for (let i = 0; i < view.length; i++) {
      hash ^= view[i];
      hash = Math.imul(hash, 0x01000193); // FNV prime
    }

    return hash >>> 0; // ensure unsigned 32-bit
  }

  // Reset all slots
  reset() {
    for (let i = 0; i < BUFFER_SIZE; i++) {
      this.slots[i] = { frame: -1, state: null, checksum: 0 };
    }
  }
}
