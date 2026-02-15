// Fixed-size Int32Array layout for deterministic game state serialization.
// All float values stored as fixed-point: value * 256, truncated to int.
// This layout must stay stable — changing it breaks save/load compatibility.

export const FP_SCALE = 256; // 1/256th pixel fixed-point

// ---- Slot counts ----
export const MAX_HUMANS = 4;
export const MAX_ENEMIES = 8;
export const MAX_EGGS = 8;

// ---- Global state ----
export const GLOBAL_OFFSET = 0;
export const GLOBAL_SIZE = 20;
// Indices within global block:
export const G_FRAME = 0;
export const G_RNG_SEED = 1;
export const G_WAVE_NUMBER = 2;
export const G_WAVE_STATE = 3;       // 0=SPAWNING, 1=PLAYING, 2=TRANSITION
export const G_SPAWN_TIMER = 4;      // fixed-point
export const G_WAVE_TRANSITION_TIMER = 5; // fixed-point
export const G_GAME_MODE = 6;        // 0=team, 1=pvp
export const G_GAME_OVER = 7;        // 0 or 1
export const G_SPAWN_QUEUE_LEN = 8;
// G_SPAWN_QUEUE: 9..18 (up to 10 queued enemy types)
export const G_SPAWN_QUEUE_START = 9;
export const G_SPAWN_QUEUE_MAX = 10;

// ---- Character slot (shared between humans and enemies) ----
export const CHAR_SIZE = 34;
// Indices within a character slot:
export const C_ACTIVE = 0;
export const C_POS_X = 1;           // fixed-point
export const C_POS_Y = 2;           // fixed-point
export const C_VEL_X = 3;           // fixed-point
export const C_VEL_Y = 4;           // fixed-point
export const C_STATE = 5;           // 0=GROUNDED, 1=AIRBORNE
export const C_FACING_DIR = 6;      // -1 or 1
export const C_IS_TURNING = 7;
export const C_TURN_TIMER = 8;      // fixed-point
export const C_STRIDE_PHASE = 9;    // fixed-point
export const C_IS_FLAPPING = 10;
export const C_FLAP_TIMER = 11;     // fixed-point
export const C_DEAD = 12;
export const C_RESPAWN_TIMER = 13;   // fixed-point
export const C_INVINCIBLE = 14;
export const C_INVINCIBLE_TIMER = 15;// fixed-point
export const C_JOUST_COOLDOWN = 16;  // fixed-point
export const C_MATERIALIZING = 17;
export const C_MATERIALIZE_TIMER = 18;  // fixed-point
export const C_MATERIALIZE_DURATION = 19; // fixed-point
export const C_MATERIALIZE_QUICK_END = 20;
export const C_SCORE = 21;
export const C_LIVES = 22;
export const C_EGGS_COLLECTED = 23;
export const C_PREV_POS_X = 24;     // fixed-point
export const C_PREV_POS_Y = 25;     // fixed-point
export const C_NEXT_LIFE_SCORE = 26;
export const C_PALETTE_INDEX = 27;
export const C_PLAYER_DIED_WAVE = 28;
// Enemy-specific fields:
export const C_ENEMY_TYPE = 29;      // -1 for human, 0/1/2 for enemy types
export const C_HIT_LAVA = 30;
export const C_PLATFORM_INDEX = 31;  // index into platforms array, or -1
export const C_BOUNCE_COUNT = 32;
export const C_EDGE_BUMP_COUNT = 33;

// ---- Enemy AI state slot (parallel to enemy character slots) ----
export const AI_SIZE = 4;
export const AI_DIR_TIMER = 0;       // fixed-point
export const AI_CURRENT_DIR = 1;     // -1 or 1
export const AI_FLAP_ACCUM = 2;      // fixed-point
export const AI_ENEMY_TYPE = 3;      // mirrors C_ENEMY_TYPE for AI lookup

// ---- Egg slot ----
export const EGG_SIZE = 12;
export const E_ACTIVE = 0;
export const E_POS_X = 1;           // fixed-point
export const E_POS_Y = 2;           // fixed-point
export const E_VEL_X = 3;           // fixed-point
export const E_VEL_Y = 4;           // fixed-point
export const E_ON_PLATFORM = 5;
export const E_ENEMY_TYPE = 6;
export const E_HATCH_STATE = 7;     // 0=FALLING, 1=ON_PLATFORM, 2=WOBBLING
export const E_HATCH_TIMER = 8;     // fixed-point
export const E_BOUNCE_COUNT = 9;
export const E_PREV_POS_Y = 10; // previous Y position for landing detection
export const E_HIT_LAVA = 11;

// ---- Compute total size and section offsets ----
export const HUMANS_OFFSET = GLOBAL_OFFSET + GLOBAL_SIZE;
export const ENEMIES_OFFSET = HUMANS_OFFSET + MAX_HUMANS * CHAR_SIZE;
export const ENEMY_AI_OFFSET = ENEMIES_OFFSET + MAX_ENEMIES * CHAR_SIZE;
export const EGGS_OFFSET = ENEMY_AI_OFFSET + MAX_ENEMIES * AI_SIZE;
export const TOTAL_INTS = EGGS_OFFSET + MAX_EGGS * EGG_SIZE;
// ~532 ints = ~2128 bytes

// ---- Wave state enum ----
export const WAVE_SPAWNING = 0;
export const WAVE_PLAYING = 1;
export const WAVE_TRANSITION = 2;

// ---- Hatch state enum ----
export const HATCH_FALLING = 0;
export const HATCH_ON_PLATFORM = 1;
export const HATCH_WOBBLING = 2;

// ---- Player state enum ----
export const STATE_GROUNDED = 0;
export const STATE_AIRBORNE = 1;

// ---- Fixed-point helpers ----
export function toFP(val) {
  return (val * FP_SCALE) | 0;
}

export function fromFP(val) {
  return val / FP_SCALE;
}


/**
 * Integer division by 3 using reciprocal-multiply — no float division.
 * S=16, M=ceil(2^16/3)=21846. First disagreement vs (x/3)|0 at |x|=32767,
 * far beyond max in codebase (17, from scoring.js wave calculation).
 * Handles negative values by negating before shift to match |0 truncation-toward-zero.
 */
export function idiv3(x) {
  if (x >= 0) {
    return (x * 21846) >> 16;
  }
  return -((-x * 21846) >> 16);
}

/**
 * Integer division by 10 using reciprocal-multiply — no float division.
 * S=16, M=ceil(2^16/10)=6554. First disagreement vs (x/10)|0 at |x|=16389,
 * far beyond max in codebase (7680, from EnemyAI.js shadow lord leading).
 * Handles negative values by negating before shift to match |0 truncation-toward-zero.
 */
export function idiv10(x) {
  if (x >= 0) {
    return (x * 6554) >> 16;
  }
  return -((-x * 6554) >> 16);
}

/**
 * Divide velocity by 60 (per-frame) using reciprocal-multiply — no float division.
 * S=20, M=ceil(2^20/60)=17477. Max intermediate: 2560 * 17477 = 44,741,120 (Int32-safe).
 * Handles negative values by negating before shift to match | 0 truncation-toward-zero
 * (since >> rounds toward -infinity).
 * First disagreement vs true (v/60)|0 at v ≈ 547,000 — far beyond max velocity (2560).
 */
export function velPerFrame(vel) {
  if (vel >= 0) {
    return (vel * 17477) >> 20;
  }
  return -((-vel * 17477) >> 20);
}
