// Deterministic PRNG — mulberry32 algorithm
// State is a single uint32 seed, trivially serializable into Int32Array.
// All game randomness must flow through this RNG for rollback determinism.

export class DeterministicRNG {
  constructor(seed) {
    this._seed = seed >>> 0; // coerce to uint32
  }

  // Returns a float in [0, 1) — replacement for Math.random()
  next() {
    this._seed = (this._seed + 0x6D2B79F5) >>> 0;
    let t = this._seed;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  // Returns an integer in [0, max) — replacement for Math.floor(Math.random() * max)
  nextInt(max) {
    return Math.floor(this.next() * max);
  }

  getSeed() {
    return this._seed;
  }

  setSeed(seed) {
    this._seed = seed >>> 0;
  }
}
