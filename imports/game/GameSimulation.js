// GameSimulation — Deterministic game state + logic core.
// No Babylon dependencies. Implements tick/serialize/deserialize for rollback.
// All physics use fixed-point integer arithmetic (FP_SCALE=256) for determinism.
// Timers use frame counts (integers at 60fps).

import { DeterministicRNG } from './physics/mulberry32.js';
import { EnemyAI } from './EnemyAI.js';
import {
  MAX_SPEED,
  RESPAWN_FRAMES, INVINCIBLE_FRAMES,
  MATERIALIZE_FRAMES, MATERIALIZE_QUICK_FRAMES,
  HATCH_FRAMES, WOBBLE_START_FRAMES,
  HATCHLING_FRAMES,
  SPAWN_INTERVAL_FRAMES, WAVE_DELAY_FRAMES,
  TURN_FRAMES, FLAP_FRAMES, JOUST_COOLDOWN_FRAMES,
  FP_GRAVITY_PF, FP_TERMINAL_VELOCITY, FP_FRICTION_PF,
  FP_FEET_OFFSET, FP_HEAD_OFFSET, FP_CHAR_HALF_WIDTH,
  FP_EGG_RADIUS, FP_ORTHO_LEFT, FP_ORTHO_RIGHT,
  FP_LAVA_OFFSET, FP_BOUNCE_THRESHOLD,
  FP_EGG_HATCH_LIFT, FP_KILL_KNOCK_VX,
  FP_HATCHLING_HALF_WIDTH, FP_HATCHLING_HEIGHT,
  SPAWN_POINTS_FP, ENEMY_SPAWN_POINTS_FP,
  GAME_MODE_TEAM, GAME_MODE_PVP,
  buildPlatformCollisionDataFP,
} from './physics/constants.js';
import {
  checkPlatformCollisions, resolveJoust, applyBounce, applyKillToWinner,
  checkLavaKill, applyScreenWrap,
} from './physics/CollisionSystem.js';
import { DISCONNECT_BIT } from '../netcode/InputEncoder.js';
import { applyInput, applyIdle, applyFriction, applyGravity } from './physics/PhysicsSystem.js';
import {
  STARTING_LIVES, EXTRA_LIFE_THRESHOLD,
  POINTS_SURVIVAL_WAVE, POINTS_EGG_MID_AIR,
  ENEMY_TYPE_BOUNDER, ENEMY_TYPE_SHADOW_LORD,
  getKillPoints, getEggPoints, getWaveComposition,
} from './scoring.js';
import {
  MAX_HUMANS, MAX_ENEMIES, MAX_EGGS, FP_SCALE,
  TOTAL_INTS, GLOBAL_OFFSET, GLOBAL_SIZE,
  HUMANS_OFFSET, ENEMIES_OFFSET, ENEMY_AI_OFFSET, EGGS_OFFSET,
  CHAR_SIZE, AI_SIZE, EGG_SIZE,
  G_FRAME, G_RNG_SEED, G_WAVE_NUMBER, G_WAVE_STATE,
  G_SPAWN_TIMER, G_WAVE_TRANSITION_TIMER, G_GAME_MODE, G_GAME_OVER,
  G_SPAWN_QUEUE_LEN, G_SPAWN_QUEUE_START, G_SPAWN_QUEUE_MAX,
  C_ACTIVE, C_POS_X, C_POS_Y, C_VEL_X, C_VEL_Y, C_STATE,
  C_FACING_DIR, C_IS_TURNING, C_TURN_TIMER, C_STRIDE_PHASE,
  C_IS_FLAPPING, C_FLAP_TIMER, C_DEAD, C_RESPAWN_TIMER,
  C_INVINCIBLE, C_INVINCIBLE_TIMER, C_JOUST_COOLDOWN,
  C_MATERIALIZING, C_MATERIALIZE_TIMER, C_MATERIALIZE_DURATION,
  C_MATERIALIZE_QUICK_END,
  C_SCORE, C_LIVES, C_EGGS_COLLECTED, C_PREV_POS_X, C_PREV_POS_Y,
  C_NEXT_LIFE_SCORE, C_PALETTE_INDEX, C_PLAYER_DIED_WAVE, C_ENEMY_TYPE, C_HIT_LAVA, C_PLATFORM_INDEX,
  C_BOUNCE_COUNT, C_EDGE_BUMP_COUNT,
  AI_DIR_TIMER, AI_CURRENT_DIR, AI_FLAP_ACCUM, AI_ENEMY_TYPE,
  E_ACTIVE, E_POS_X, E_POS_Y, E_VEL_X, E_VEL_Y,
  E_ON_PLATFORM, E_ENEMY_TYPE, E_HATCH_STATE, E_HATCH_TIMER,
  E_BOUNCE_COUNT, E_PREV_POS_Y, E_HIT_LAVA,
  WAVE_SPAWNING, WAVE_PLAYING, WAVE_TRANSITION,
  HATCH_FALLING, HATCH_ON_PLATFORM, HATCH_WOBBLING, HATCH_HATCHLING,
  STATE_GROUNDED, STATE_AIRBORNE,
  toFP, fromFP, velPerFrame,
} from './physics/stateLayout.js';

const NUM_HUMAN_SLOTS = MAX_HUMANS;

// Reciprocal-multiply constant for stride phase calculation.
//
// We need: floor(absVel * 512 / (FP_MAX_SPEED * 60))
//        = floor(absVel * 512 / 153600)
//        = floor(absVel / 300)
//
// To avoid floating-point division entirely, we use the reciprocal-multiply
// trick: replace "x / D" with "(x * M) >> S" where M = ceil(2^S / D).
//
// With S=24, D=300:  M = ceil(16777216 / 300) = 55925
//
// This gives: (absVel * 55925) >> 24
//
// The >> operator in JS converts to Int32 before shifting, so the entire
// expression stays in integer domain — no IEEE 754 division involved.
// Max intermediate: 2560 * 55925 = 143,168,000 (well within Int32 range).
//
// Accuracy: the approximation (55925/2^24 = 0.0033334) slightly overestimates
// the true reciprocal (1/300 = 0.0033333). The first value where this causes
// a rounding difference vs exact division is absVel ≈ 166,799, far beyond
// FP_MAX_SPEED (2560). Identical results for all in-game velocities.
const STRIDE_RECIP_Q24 = 55925;

export class GameSimulation {
  /**
   * @param {{ gameMode: string, seed: number, orthoBottom: number, orthoTop: number }} config
   */
  constructor({ gameMode, seed, orthoBottom, orthoTop }) {
    this._gameMode = gameMode || GAME_MODE_TEAM;
    this._orthoBottomFP = toFP(orthoBottom);
    this._orthoTopFP = toFP(orthoTop);
    this._platforms = buildPlatformCollisionDataFP();
    this._rng = new DeterministicRNG(seed);

    // Integer-based working state
    this._frame = 0;
    this._waveNumber = 1;
    this._waveState = WAVE_SPAWNING;
    this._spawnTimer = 0;           // frame count
    this._waveTransitionTimer = 0;  // frame count
    this._gameOver = false;
    this._spawnQueue = [];

    // Character slots: 0..3 = humans, 4..11 = enemies
    // All positions/velocities are FP integers, all timers are frame counts
    this._chars = new Array(MAX_HUMANS + MAX_ENEMIES);
    for (let i = 0; i < this._chars.length; i++) {
      this._chars[i] = this._createEmptyChar();
    }

    // AI instances for enemy slots
    this._ais = new Array(MAX_ENEMIES);
    for (let i = 0; i < MAX_ENEMIES; i++) {
      this._ais[i] = null;
    }

    // Egg slots — all FP integers
    this._eggs = new Array(MAX_EGGS);
    for (let i = 0; i < MAX_EGGS; i++) {
      this._eggs[i] = this._createEmptyEgg();
    }

    // Public read-only state for the renderer (rebuilt each tick, converted to floats)
    this.state = null;
  }

  // ---- Public API ----

  /**
   * Activate a human player in the given slot (0-3).
   */
  activatePlayer(slot, paletteIndex) {
    if (slot < 0 || slot >= MAX_HUMANS) {
      return;
    }

    const char = this._chars[slot];
    char.active = true;
    char.dead = false;
    char.score = 0;
    char.lives = STARTING_LIVES;
    char.nextLifeScore = EXTRA_LIFE_THRESHOLD;
    char.eggsCollectedThisWave = 0;
    char.playerDiedThisWave = false;
    char.paletteIndex = paletteIndex;
    char.enemyType = -1;

    // Pick spawn purely from RNG (no position-dependent filtering).
    // Player has invincibility so overlapping at spawn is safe.
    const spawn = SPAWN_POINTS_FP[this._rng.nextInt(SPAWN_POINTS_FP.length)];
    const platform = this._platforms.find(p => p.id === spawn.platformId);
    char.positionX = spawn.x;
    char.positionY = platform.top + FP_FEET_OFFSET;
    char.velocityX = 0;
    char.velocityY = 0;
    char.playerState = 'GROUNDED';
    char.currentPlatform = platform;
    char.platformIndex = this._platforms.indexOf(platform);
    char.facingDir = 1;
    char.materializing = true;
    char.materializeTimer = 0;
    char.materializeDuration = MATERIALIZE_FRAMES;
    char.materializeQuickEnd = false;
    char.invincible = false;
    char.invincibleTimer = 0;
    char.prevPositionX = char.positionX;
    char.prevPositionY = char.positionY;
    char.hitLava = false;
    char.bounceCount = 0;
    char.edgeBumpCount = 0;
  }

  /**
   * Deactivate a human player (drop-out).
   */
  deactivatePlayer(slot) {
    if (slot < 0 || slot >= MAX_HUMANS) {
      return;
    }
    this._chars[slot].active = false;
  }

  /**
   * Start the first wave. Call after activating at least one player.
   */
  startGame() {
    this._startWave(1);
  }

  /**
   * Advance one simulation frame.
   * @param {number[]} inputs - encoded input bytes per player slot [p0, p1, p2, p3]
   */
  tick(inputs) {
    if (this._gameOver) {
      this._buildRenderState();
      return;
    }

    // Update each character
    for (let i = 0; i < this._chars.length; i++) {
      const char = this._chars[i];
      if (!char.active) {
        continue;
      }

      // Disconnect bit: deactivate player deterministically inside the tick loop
      if (i < MAX_HUMANS && (inputs[i] & DISCONNECT_BIT)) {
        char.active = false;
        continue;
      }

      // Respawn timer for dead characters (frame count)
      if (char.dead) {
        char.respawnTimer -= 1;
        if (char.respawnTimer <= 0) {
          this._respawnCharacter(char, i);
        }
        continue;
      }

      // Materialization (frame count)
      if (char.materializing) {
        char.materializeTimer += 1;

        // Quick-end for human players: input accelerates materialization
        if (i < MAX_HUMANS && !char.materializeQuickEnd) {
          const input = this._decodeInput(inputs[i] || 0);
          if (input.left || input.right || input.flap) {
            char.materializeQuickEnd = true;
            char.materializeDuration = char.materializeTimer + MATERIALIZE_QUICK_FRAMES;
          }
        }

        if (char.materializeTimer >= char.materializeDuration) {
          char.materializing = false;
        }
        continue;
      }

      // Invincibility timer (frame count)
      if (char.invincible) {
        char.invincibleTimer -= 1;
        if (i < MAX_HUMANS) {
          const input = this._decodeInput(inputs[i] || 0);
          if (input.left || input.right || input.flap) {
            char.invincible = false;
            char.invincibleTimer = 0;
          }
        }
        if (char.invincibleTimer <= 0) {
          char.invincible = false;
          char.invincibleTimer = 0;
        }
      }

      // Joust cooldown (frame count)
      if (char.joustCooldown > 0) {
        char.joustCooldown -= 1;
      }

      // Save pre-movement position
      char.prevPositionX = char.positionX;
      char.prevPositionY = char.positionY;

      // Apply physics (FP integer, no dt parameter)
      if (i < MAX_HUMANS) {
        const input = this._decodeInput(inputs[i] || 0);
        applyInput(char, input, this._platforms, this._orthoTopFP, this._orthoBottomFP);
      } else {
        const aiIdx = i - MAX_HUMANS;
        const ai = this._ais[aiIdx];
        if (ai) {
          const target = this._findClosestActiveHuman(char);
          const aiInput = ai.decide(char, target, this._orthoBottomFP, this._rng);
          applyInput(char, aiInput, this._platforms, this._orthoTopFP, this._orthoBottomFP);
        } else {
          applyIdle(char, this._platforms, this._orthoTopFP, this._orthoBottomFP);
        }
      }

      // Lava death check (hitLava stays true on the dead character so the
      // renderer can distinguish lava deaths from joust deaths)
      if (char.hitLava) {
        this._lavaDeath(char, i);
        continue;
      }

      // Advance turn animation timer (frame count)
      if (char.isTurning) {
        char.turnTimer += 1;
        if (char.turnTimer >= TURN_FRAMES) {
          char.isTurning = false;
          char.turnTimer = TURN_FRAMES;
        }
      }

      // Advance flap animation timer (frame count)
      if (char.isFlapping) {
        char.flapTimer += 1;
        if (char.flapTimer >= FLAP_FRAMES) {
          char.isFlapping = false;
          char.flapTimer = 0;
        }
      }

      // Advance stride phase for running animation (pure integer arithmetic)
      if (char.playerState === 'GROUNDED') {
        // phase += abs(vel) / 300, computed via reciprocal multiply (no float division)
        const absVel = Math.abs(char.velocityX);
        char.stridePhase += (absVel * STRIDE_RECIP_Q24) >> 24;
      } else {
        char.stridePhase = 0;
      }
    }

    // Joust collisions (after all positions updated)
    this._checkJoustCollisions();

    // Eggs
    this._updateEggs();

    // Wave system
    this._updateWaveSystem();

    this._frame++;
    this._buildRenderState();
  }

  /**
   * Serialize entire game state to an ArrayBuffer.
   * All values are already integers — direct copy, no toFP needed.
   */
  serialize() {
    const buf = new Int32Array(TOTAL_INTS);

    // Global
    buf[GLOBAL_OFFSET + G_FRAME] = this._frame;
    buf[GLOBAL_OFFSET + G_RNG_SEED] = this._rng.getSeed();
    buf[GLOBAL_OFFSET + G_WAVE_NUMBER] = this._waveNumber;
    buf[GLOBAL_OFFSET + G_WAVE_STATE] = this._waveState;
    buf[GLOBAL_OFFSET + G_SPAWN_TIMER] = this._spawnTimer;
    buf[GLOBAL_OFFSET + G_WAVE_TRANSITION_TIMER] = this._waveTransitionTimer;
    buf[GLOBAL_OFFSET + G_GAME_MODE] = this._gameMode === GAME_MODE_PVP ? 1 : 0;
    buf[GLOBAL_OFFSET + G_GAME_OVER] = this._gameOver ? 1 : 0;
    buf[GLOBAL_OFFSET + G_SPAWN_QUEUE_LEN] = Math.min(this._spawnQueue.length, G_SPAWN_QUEUE_MAX);
    for (let i = 0; i < Math.min(this._spawnQueue.length, G_SPAWN_QUEUE_MAX); i++) {
      buf[GLOBAL_OFFSET + G_SPAWN_QUEUE_START + i] = this._spawnQueue[i];
    }

    // Human characters
    for (let i = 0; i < MAX_HUMANS; i++) {
      this._serializeChar(buf, HUMANS_OFFSET + i * CHAR_SIZE, this._chars[i]);
    }

    // Enemy characters
    for (let i = 0; i < MAX_ENEMIES; i++) {
      this._serializeChar(buf, ENEMIES_OFFSET + i * CHAR_SIZE, this._chars[MAX_HUMANS + i]);
    }

    // Enemy AI state
    for (let i = 0; i < MAX_ENEMIES; i++) {
      const offset = ENEMY_AI_OFFSET + i * AI_SIZE;
      const ai = this._ais[i];
      if (ai) {
        buf[offset + AI_DIR_TIMER] = ai._dirTimer;
        buf[offset + AI_CURRENT_DIR] = ai._currentDir;
        buf[offset + AI_FLAP_ACCUM] = ai._flapAccum;
        buf[offset + AI_ENEMY_TYPE] = ai.enemyType;
      }
    }

    // Eggs
    for (let i = 0; i < MAX_EGGS; i++) {
      this._serializeEgg(buf, EGGS_OFFSET + i * EGG_SIZE, this._eggs[i]);
    }

    return buf.buffer;
  }

  /**
   * Restore game state from an ArrayBuffer.
   */
  deserialize(buffer) {
    const buf = new Int32Array(buffer);

    // Global
    this._frame = buf[GLOBAL_OFFSET + G_FRAME];
    this._rng.setSeed(buf[GLOBAL_OFFSET + G_RNG_SEED]);
    this._waveNumber = buf[GLOBAL_OFFSET + G_WAVE_NUMBER];
    this._waveState = buf[GLOBAL_OFFSET + G_WAVE_STATE];
    this._spawnTimer = buf[GLOBAL_OFFSET + G_SPAWN_TIMER];
    this._waveTransitionTimer = buf[GLOBAL_OFFSET + G_WAVE_TRANSITION_TIMER];
    this._gameMode = buf[GLOBAL_OFFSET + G_GAME_MODE] === 1 ? GAME_MODE_PVP : GAME_MODE_TEAM;
    this._gameOver = buf[GLOBAL_OFFSET + G_GAME_OVER] === 1;
    const queueLen = buf[GLOBAL_OFFSET + G_SPAWN_QUEUE_LEN];
    this._spawnQueue = [];
    for (let i = 0; i < queueLen; i++) {
      this._spawnQueue.push(buf[GLOBAL_OFFSET + G_SPAWN_QUEUE_START + i]);
    }

    // Human characters
    for (let i = 0; i < MAX_HUMANS; i++) {
      this._deserializeChar(buf, HUMANS_OFFSET + i * CHAR_SIZE, this._chars[i]);
    }

    // Enemy characters
    for (let i = 0; i < MAX_ENEMIES; i++) {
      this._deserializeChar(buf, ENEMIES_OFFSET + i * CHAR_SIZE, this._chars[MAX_HUMANS + i]);
    }

    // Enemy AI state
    for (let i = 0; i < MAX_ENEMIES; i++) {
      const offset = ENEMY_AI_OFFSET + i * AI_SIZE;
      const enemyChar = this._chars[MAX_HUMANS + i];
      if (enemyChar.active) {
        const enemyType = buf[offset + AI_ENEMY_TYPE];
        if (!this._ais[i] || this._ais[i].enemyType !== enemyType) {
          this._ais[i] = new EnemyAI(
            enemyType,
            buf[offset + AI_DIR_TIMER],
            buf[offset + AI_CURRENT_DIR]
          );
          this._ais[i]._flapAccum = buf[offset + AI_FLAP_ACCUM];
        } else {
          this._ais[i]._dirTimer = buf[offset + AI_DIR_TIMER];
          this._ais[i]._currentDir = buf[offset + AI_CURRENT_DIR];
          this._ais[i]._flapAccum = buf[offset + AI_FLAP_ACCUM];
        }
      } else {
        this._ais[i] = null;
      }
    }

    // Eggs
    for (let i = 0; i < MAX_EGGS; i++) {
      this._deserializeEgg(buf, EGGS_OFFSET + i * EGG_SIZE, this._eggs[i]);
    }

    this._buildRenderState();
  }

  /**
   * Get read-only state for renderer. Values converted to floats.
   */
  getState() {
    return this.state;
  }

  // ---- Internal helpers ----

  _createEmptyChar() {
    return {
      active: false,
      positionX: 0, positionY: 0,       // FP integers
      velocityX: 0, velocityY: 0,       // FP integers
      playerState: 'GROUNDED',
      facingDir: 1,
      isTurning: false, turnTimer: 0,   // frame count
      stridePhase: 0,                   // FP integer
      isFlapping: false, flapTimer: 0,  // frame count
      dead: false, hitLava: false, respawnTimer: 0,  // frame count
      invincible: false, invincibleTimer: 0,         // frame count
      joustCooldown: 0,                              // frame count
      materializing: false, materializeTimer: 0,     // frame count
      materializeDuration: MATERIALIZE_FRAMES, materializeQuickEnd: false,
      score: 0, lives: 0,
      eggsCollectedThisWave: 0,
      prevPositionX: 0, prevPositionY: 0,  // FP integers
      nextLifeScore: EXTRA_LIFE_THRESHOLD,
      paletteIndex: 0,
      playerDiedThisWave: false,
      enemyType: -1,
      currentPlatform: null,
      platformIndex: -1,
      bounceCount: 0,
      edgeBumpCount: 0,
    };
  }

  _createEmptyEgg() {
    return {
      active: false,
      positionX: 0, positionY: 0,   // FP integers
      velocityX: 0, velocityY: 0,   // FP integers
      onPlatform: false,
      enemyType: -1,
      hatchState: HATCH_FALLING,
      hatchTimer: 0,                // frame count
      bounceCount: 0,
      prevPositionY: 0,             // FP integer
      hitLava: false,
    };
  }

  _decodeInput(encoded) {
    return {
      left: (encoded & 0x01) !== 0,
      right: (encoded & 0x02) !== 0,
      flap: (encoded & 0x04) !== 0,
    };
  }

  _findClosestActiveHuman(enemy) {
    let closest = null;
    let closestDist = 0x7FFFFFFF; // max int

    for (let i = 0; i < MAX_HUMANS; i++) {
      const h = this._chars[i];
      if (h.active && !h.dead && !h.materializing) {
        const dist = Math.abs(h.positionX - enemy.positionX) +
                     Math.abs(h.positionY - enemy.positionY);
        if (dist < closestDist) {
          closestDist = dist;
          closest = h;
        }
      }
    }

    return closest;
  }

  // ---- Wave system ----

  _startWave(waveNumber) {
    this._waveNumber = waveNumber;
    this._waveState = WAVE_SPAWNING;

    // Reset per-wave stats for all active humans
    for (let i = 0; i < MAX_HUMANS; i++) {
      if (this._chars[i].active) {
        this._chars[i].eggsCollectedThisWave = 0;
        this._chars[i].playerDiedThisWave = false;
      }
    }

    const composition = getWaveComposition(waveNumber);

    // Build spawn queue
    this._spawnQueue = [];
    for (let i = 0; i < composition.bounders; i++) {
      this._spawnQueue.push(0); // ENEMY_TYPE_BOUNDER
    }
    for (let i = 0; i < composition.hunters; i++) {
      this._spawnQueue.push(1); // ENEMY_TYPE_HUNTER
    }
    for (let i = 0; i < composition.shadowLords; i++) {
      this._spawnQueue.push(2); // ENEMY_TYPE_SHADOW_LORD
    }

    // Fisher-Yates shuffle with deterministic RNG
    for (let i = this._spawnQueue.length - 1; i > 0; i--) {
      const j = this._rng.nextInt(i + 1);
      const temp = this._spawnQueue[i];
      this._spawnQueue[i] = this._spawnQueue[j];
      this._spawnQueue[j] = temp;
    }

    this._spawnTimer = 0;
    this._spawnNextGroup();
  }

  _spawnNextGroup() {
    if (this._spawnQueue.length === 0) {
      this._waveState = WAVE_PLAYING;
      return;
    }

    const spawnCount = Math.min(2, this._spawnQueue.length);

    // Shuffle spawn points deterministically
    const shuffledSpawns = [...ENEMY_SPAWN_POINTS_FP];
    for (let i = shuffledSpawns.length - 1; i > 0; i--) {
      const j = this._rng.nextInt(i + 1);
      const temp = shuffledSpawns[i];
      shuffledSpawns[i] = shuffledSpawns[j];
      shuffledSpawns[j] = temp;
    }

    for (let i = 0; i < spawnCount; i++) {
      const enemyType = this._spawnQueue.shift();
      const sp = shuffledSpawns[i % shuffledSpawns.length];
      const platform = this._platforms.find(p => p.id === sp.platformId);
      this._spawnEnemy(enemyType, sp.x, platform.top + FP_FEET_OFFSET, platform);
    }
  }

  _spawnEnemy(enemyType, x, y, platform) {
    // Find free enemy slot
    let slotIdx = -1;
    for (let i = 0; i < MAX_ENEMIES; i++) {
      if (!this._chars[MAX_HUMANS + i].active) {
        slotIdx = i;
        break;
      }
    }
    if (slotIdx < 0) {
      return; // no free slots
    }

    const char = this._chars[MAX_HUMANS + slotIdx];
    char.active = true;
    char.positionX = x;
    char.positionY = y;
    char.velocityX = 0;
    char.velocityY = 0;
    if (platform) {
      char.playerState = 'GROUNDED';
      char.currentPlatform = platform;
      char.platformIndex = this._platforms.indexOf(platform);
    } else {
      char.playerState = 'AIRBORNE';
      char.currentPlatform = null;
      char.platformIndex = -1;
    }
    char.facingDir = 1;
    char.isTurning = false;
    char.turnTimer = 0;
    char.dead = false;
    char.respawnTimer = 0;
    char.invincible = false;
    char.invincibleTimer = 0;
    char.joustCooldown = 0;
    char.materializing = true;
    char.materializeTimer = 0;
    char.materializeDuration = MATERIALIZE_FRAMES;
    char.materializeQuickEnd = false;
    char.enemyType = enemyType;
    char.isFlapping = false;
    char.flapTimer = 0;
    char.stridePhase = 0;
    char.prevPositionX = char.positionX;
    char.prevPositionY = char.positionY;
    char.hitLava = false;
    char.bounceCount = 0;
    char.edgeBumpCount = 0;

    // AI timers are now frame counts
    const initialDirTimer = 90 + this._rng.nextInt(90); // ~1.5s + random up to 1.5s in frames
    const initialDir = this._rng.nextInt(2) === 1 ? 1 : -1;
    this._ais[slotIdx] = new EnemyAI(enemyType, initialDirTimer, initialDir);
  }

  _spawnEnemyFromHatchling(enemyType, fpX, egg) {
    // Find the platform under the egg's position
    let platform = null;
    for (const plat of this._platforms) {
      if (fpX + FP_EGG_RADIUS >= plat.left &&
          fpX - FP_EGG_RADIUS <= plat.right &&
          Math.abs((egg.positionY - FP_EGG_RADIUS) - plat.top) <= FP_EGG_RADIUS) {
        platform = plat;
        break;
      }
    }
    const spawnY = platform ? platform.top + FP_FEET_OFFSET : egg.positionY + FP_EGG_HATCH_LIFT;
    this._spawnEnemy(enemyType, fpX, spawnY, platform);
  }

  _updateWaveSystem() {
    if (this._gameOver) {
      return;
    }

    // Handle spawn timing (frame count)
    if (this._waveState === WAVE_SPAWNING && this._spawnQueue.length > 0) {
      this._spawnTimer += 1;
      if (this._spawnTimer >= SPAWN_INTERVAL_FRAMES) {
        this._spawnTimer = 0;
        this._spawnNextGroup();
      }
    }

    // Check wave completion
    if (this._waveState === WAVE_PLAYING || (this._waveState === WAVE_SPAWNING && this._spawnQueue.length === 0)) {
      this._waveState = WAVE_PLAYING;

      let livingEnemies = 0;
      for (let i = 0; i < MAX_ENEMIES; i++) {
        const char = this._chars[MAX_HUMANS + i];
        if (char.active && !char.dead) {
          livingEnemies++;
        }
      }

      let activeEggs = 0;
      for (let i = 0; i < MAX_EGGS; i++) {
        if (this._eggs[i].active && this._eggs[i].enemyType >= 0) {
          activeEggs++;
        }
      }

      if (livingEnemies === 0 && activeEggs === 0) {
        this._waveState = WAVE_TRANSITION;
        this._waveTransitionTimer = WAVE_DELAY_FRAMES;

        // Survival bonus for humans who didn't die
        for (let i = 0; i < MAX_HUMANS; i++) {
          const h = this._chars[i];
          if (h.active && !h.playerDiedThisWave) {
            this._addScore(i, POINTS_SURVIVAL_WAVE);
          }
        }

        // Clean up dead enemy slots
        for (let i = 0; i < MAX_ENEMIES; i++) {
          this._chars[MAX_HUMANS + i].active = false;
          this._ais[i] = null;
        }
      }
    }

    // Wave transition delay (frame count)
    if (this._waveState === WAVE_TRANSITION) {
      this._waveTransitionTimer -= 1;
      if (this._waveTransitionTimer <= 0) {
        this._startWave(this._waveNumber + 1);
      }
    }
  }

  // ---- Joust collisions ----

  _checkJoustCollisions() {
    const totalChars = MAX_HUMANS + MAX_ENEMIES;
    for (let a = 0; a < totalChars; a++) {
      for (let b = a + 1; b < totalChars; b++) {
        const charA = this._chars[a];
        const charB = this._chars[b];
        if (!charA.active || !charB.active) {
          continue;
        }

        const result = resolveJoust(charA, charB, a, b, this._gameMode, NUM_HUMAN_SLOTS);
        if (!result) {
          continue;
        }

        if (result.type === 'bounce') {
          applyBounce(charA, charB, result.pushDir);
          charA.bounceCount += 1;
          charB.bounceCount += 1;
          charA.facingDir = result.pushDir;
          charA.isTurning = true;
          charA.turnTimer = 0;
          charB.facingDir = -result.pushDir;
          charB.isTurning = true;
          charB.turnTimer = 0;
        } else {
          applyKillToWinner(result.winner, result.pushDir);
          this._killCharacter(result.loser, result.loserIdx, result.pushDir);
        }
      }
    }
  }

  // ---- Death / Respawn ----

  _killCharacter(char, charIdx, knockDir) {
    char.dead = true;
    char.respawnTimer = RESPAWN_FRAMES;

    // Spawn egg — store the upgraded type it will hatch into
    // Bounder → Hunter, Hunter → Shadow Lord, Shadow Lord → Shadow Lord, Human → Bounder
    const eggType = charIdx >= MAX_HUMANS
      ? Math.min(char.enemyType + 1, ENEMY_TYPE_SHADOW_LORD)
      : ENEMY_TYPE_BOUNDER;
    this._spawnEgg(char.positionX, char.positionY, char.velocityX + knockDir * FP_KILL_KNOCK_VX, char.velocityY, eggType);

    // Award kill points to the closest active human if enemy was killed
    if (charIdx >= MAX_HUMANS) {
      let killerIdx = 0;
      let minDist = 0x7FFFFFFF;
      for (let i = 0; i < MAX_HUMANS; i++) {
        const h = this._chars[i];
        if (h.active && !h.dead) {
          const dist = Math.abs(h.positionX - char.positionX) + Math.abs(h.positionY - char.positionY);
          if (dist < minDist) {
            minDist = dist;
            killerIdx = i;
          }
        }
      }
      this._addScore(killerIdx, getKillPoints(char.enemyType));
    }

    // Human death: decrement lives
    if (charIdx < MAX_HUMANS) {
      char.lives -= 1;
      char.playerDiedThisWave = true;
      if (char.lives <= 0) {
        char.lives = 0;
        this._checkGameOver();
      }
    }
  }

  _lavaDeath(char, charIdx) {
    char.dead = true;
    char.respawnTimer = RESPAWN_FRAMES;

    if (charIdx < MAX_HUMANS) {
      char.lives -= 1;
      char.playerDiedThisWave = true;
      if (char.lives <= 0) {
        char.lives = 0;
        this._checkGameOver();
      }
    }
  }

  _checkGameOver() {
    let anyAlive = false;
    for (let i = 0; i < MAX_HUMANS; i++) {
      if (this._chars[i].active && this._chars[i].lives > 0) {
        anyAlive = true;
        break;
      }
    }
    if (!anyAlive) {
      this._gameOver = true;
    }
  }

  _respawnCharacter(char, charIdx) {
    // Enemies don't respawn
    if (charIdx >= MAX_HUMANS) {
      return;
    }

    if (char.lives <= 0) {
      return;
    }

    // Pick a spawn point purely from the RNG (no position-dependent filtering).
    // Filtering by other characters' positions causes desync in multiplayer because
    // predicted positions differ between peers during rollback. The respawning player
    // has invincibility so overlapping at spawn is safe.
    const spawn = SPAWN_POINTS_FP[this._rng.nextInt(SPAWN_POINTS_FP.length)];

    const platform = this._platforms.find(p => p.id === spawn.platformId);

    char.positionX = spawn.x;
    char.positionY = platform.top + FP_FEET_OFFSET;
    char.velocityX = 0;
    char.velocityY = 0;
    char.playerState = 'GROUNDED';
    char.currentPlatform = platform;
    char.platformIndex = this._platforms.indexOf(platform);
    char.facingDir = 1;
    char.isTurning = false;
    char.turnTimer = 0;
    char.stridePhase = 0;
    char.isFlapping = false;
    char.flapTimer = 0;
    char.dead = false;
    char.hitLava = false;
    char.respawnTimer = 0;
    char.invincible = true;
    char.invincibleTimer = INVINCIBLE_FRAMES;
    char.materializing = true;
    char.materializeTimer = 0;
    char.materializeDuration = MATERIALIZE_FRAMES;
    char.materializeQuickEnd = false;
    char.bounceCount = 0;
    char.edgeBumpCount = 0;
  }

  // ---- Scoring ----

  _addScore(humanIdx, points) {
    if (humanIdx < 0 || humanIdx >= MAX_HUMANS) {
      return;
    }
    const char = this._chars[humanIdx];
    if (!char.active || this._gameOver) {
      return;
    }

    char.score += points;

    if (char.score >= char.nextLifeScore) {
      char.lives += 1;
      char.nextLifeScore += EXTRA_LIFE_THRESHOLD;
    }
  }

  // ---- Eggs ----

  _spawnEgg(x, y, vx, vy, enemyType) {
    let slotIdx = -1;
    for (let i = 0; i < MAX_EGGS; i++) {
      if (!this._eggs[i].active) {
        slotIdx = i;
        break;
      }
    }
    if (slotIdx < 0) {
      return;
    }

    const egg = this._eggs[slotIdx];
    egg.active = true;
    egg.positionX = x;
    egg.positionY = y;
    egg.prevPositionY = y;
    egg.velocityX = vx;
    egg.velocityY = vy;
    egg.onPlatform = false;
    egg.enemyType = enemyType;
    egg.hatchState = HATCH_FALLING;
    egg.hatchTimer = 0;
    egg.bounceCount = 0;
    egg.hitLava = false;
  }

  _updateEggs() {
    for (let i = 0; i < MAX_EGGS; i++) {
      const egg = this._eggs[i];
      if (!egg.active) {
        continue;
      }

      // Physics for falling/platform eggs
      if (egg.hatchState === HATCH_FALLING || egg.hatchState === HATCH_ON_PLATFORM || egg.hatchState === HATCH_WOBBLING) {
        // Save pre-movement position for landing detection
        egg.prevPositionY = egg.positionY;

        // Gravity (per-frame, FP integer)
        egg.velocityY -= FP_GRAVITY_PF;
        if (egg.velocityY < -FP_TERMINAL_VELOCITY) {
          egg.velocityY = -FP_TERMINAL_VELOCITY;
        }

        // Friction on platform (per-frame, FP integer)
        if (egg.onPlatform) {
          if (egg.velocityX > 0) {
            egg.velocityX -= FP_FRICTION_PF;
            if (egg.velocityX < 0) {
              egg.velocityX = 0;
            }
          } else if (egg.velocityX < 0) {
            egg.velocityX += FP_FRICTION_PF;
            if (egg.velocityX > 0) {
              egg.velocityX = 0;
            }
          }
        }

        // Position update (vel/60, integer-only via reciprocal multiply)
        egg.positionX += velPerFrame(egg.velocityX);
        egg.positionY += velPerFrame(egg.velocityY);

        // Screen wrap BEFORE platform collision so checks use in-bounds position
        if (egg.positionX > FP_ORTHO_RIGHT + FP_EGG_RADIUS) {
          egg.positionX = FP_ORTHO_LEFT - FP_EGG_RADIUS;
        } else if (egg.positionX < FP_ORTHO_LEFT - FP_EGG_RADIUS) {
          egg.positionX = FP_ORTHO_RIGHT + FP_EGG_RADIUS;
        }

        // Platform collision
        const eggFeet = egg.positionY - FP_EGG_RADIUS;
        const prevEggFeet = egg.prevPositionY - FP_EGG_RADIUS;
        const wasOnPlatform = egg.onPlatform;
        egg.onPlatform = false;

        if (egg.velocityY <= 0) {
          for (const plat of this._platforms) {
            if (egg.positionX + FP_EGG_RADIUS < plat.left || egg.positionX - FP_EGG_RADIUS > plat.right) {
              continue;
            }
            if (prevEggFeet >= plat.top && eggFeet < plat.top) {
              egg.positionY = plat.top + FP_EGG_RADIUS;
              if (Math.abs(egg.velocityY) > FP_BOUNCE_THRESHOLD) {
                // Bounce: negate then halve via shift (velocityY is always negative here)
                egg.velocityY = (-egg.velocityY) >> 1;
                egg.bounceCount += 1;
              } else {
                egg.velocityY = 0;
                egg.onPlatform = true;
                if (egg.hatchState === HATCH_FALLING) {
                  egg.hatchState = HATCH_ON_PLATFORM;
                  egg.hatchTimer = 0;
                }
              }
              break;
            }
          }
        }

        if (wasOnPlatform && !egg.onPlatform && egg.velocityY === 0) {
          const feet = egg.positionY - FP_EGG_RADIUS;
          for (const plat of this._platforms) {
            if (egg.positionX + FP_EGG_RADIUS >= plat.left &&
                egg.positionX - FP_EGG_RADIUS <= plat.right &&
                Math.abs(feet - plat.top) <= 1) {
              egg.onPlatform = true;
              break;
            }
          }
        }

        // Lava (FP)
        if (egg.positionY < this._orthoBottomFP + FP_LAVA_OFFSET) {
          egg.active = false;
          egg.hitLava = true;
          continue;
        }

        // Player collection check (FP)
        for (let h = 0; h < MAX_HUMANS; h++) {
          const player = this._chars[h];
          if (!player.active || player.dead || player.materializing) {
            continue;
          }

          const pLeft = player.positionX - FP_CHAR_HALF_WIDTH;
          const pRight = player.positionX + FP_CHAR_HALF_WIDTH;
          const pFeet = player.positionY - FP_FEET_OFFSET;
          const pHead = player.positionY + FP_HEAD_OFFSET;

          const eLeft = egg.positionX - FP_EGG_RADIUS;
          const eRight = egg.positionX + FP_EGG_RADIUS;
          const eBottom = egg.positionY - FP_EGG_RADIUS;
          const eTop = egg.positionY + FP_EGG_RADIUS;

          if (pRight > eLeft && pLeft < eRight && pHead > eBottom && pFeet < eTop) {
            const midAir = !egg.onPlatform;
            const basePoints = getEggPoints(player.eggsCollectedThisWave);
            const bonus = midAir ? POINTS_EGG_MID_AIR : 0;
            this._addScore(h, basePoints + bonus);
            player.eggsCollectedThisWave += 1;
            egg.active = false;
            break;
          }
        }

        if (!egg.active) {
          continue;
        }
      }

      // Hatch timer (frame count)
      if (egg.enemyType >= 0 && (egg.hatchState === HATCH_ON_PLATFORM || egg.hatchState === HATCH_WOBBLING)) {
        egg.hatchTimer += 1;

        if (egg.hatchState === HATCH_ON_PLATFORM && egg.hatchTimer >= WOBBLE_START_FRAMES) {
          egg.hatchState = HATCH_WOBBLING;
        }

        if (egg.hatchTimer >= HATCH_FRAMES && egg.hatchState === HATCH_WOBBLING) {
          // Transition to hatchling — standing knight on platform
          egg.hatchState = HATCH_HATCHLING;
          // Timer keeps incrementing from HATCH_FRAMES
        }
      }

      // Hatchling state — standing knight, collectible by players
      if (egg.hatchState === HATCH_HATCHLING) {
        egg.hatchTimer += 1;

        // Player collection check (AABB using hatchling hitbox)
        const hLeft = egg.positionX - FP_HATCHLING_HALF_WIDTH;
        const hRight = egg.positionX + FP_HATCHLING_HALF_WIDTH;
        const hBottom = egg.positionY - FP_EGG_RADIUS;
        const hTop = hBottom + FP_HATCHLING_HEIGHT;

        for (let h = 0; h < MAX_HUMANS; h++) {
          const player = this._chars[h];
          if (!player.active || player.dead || player.materializing) {
            continue;
          }

          const pLeft = player.positionX - FP_CHAR_HALF_WIDTH;
          const pRight = player.positionX + FP_CHAR_HALF_WIDTH;
          const pFeet = player.positionY - FP_FEET_OFFSET;
          const pHead = player.positionY + FP_HEAD_OFFSET;

          if (pRight > hLeft && pLeft < hRight && pHead > hBottom && pFeet < hTop) {
            const basePoints = getEggPoints(player.eggsCollectedThisWave);
            this._addScore(h, basePoints);
            player.eggsCollectedThisWave += 1;
            egg.active = false;
            break;
          }
        }

        if (!egg.active) {
          continue;
        }

        // Mount transition — hatchling timer expired, buzzard arrives
        if (egg.hatchTimer >= HATCH_FRAMES + HATCHLING_FRAMES) {
          this._spawnEnemyFromHatchling(egg.enemyType, egg.positionX, egg);
          egg.active = false;
        }
      }
    }
  }

  // ---- Serialization helpers ----
  // All values are already integers — direct copy

  _serializeChar(buf, offset, char) {
    buf[offset + C_ACTIVE] = char.active ? 1 : 0;
    buf[offset + C_POS_X] = char.positionX;
    buf[offset + C_POS_Y] = char.positionY;
    buf[offset + C_VEL_X] = char.velocityX;
    buf[offset + C_VEL_Y] = char.velocityY;
    buf[offset + C_STATE] = char.playerState === 'AIRBORNE' ? STATE_AIRBORNE : STATE_GROUNDED;
    buf[offset + C_FACING_DIR] = char.facingDir;
    buf[offset + C_IS_TURNING] = char.isTurning ? 1 : 0;
    buf[offset + C_TURN_TIMER] = char.turnTimer;
    buf[offset + C_STRIDE_PHASE] = char.stridePhase;
    buf[offset + C_IS_FLAPPING] = char.isFlapping ? 1 : 0;
    buf[offset + C_FLAP_TIMER] = char.flapTimer;
    buf[offset + C_DEAD] = char.dead ? 1 : 0;
    buf[offset + C_RESPAWN_TIMER] = char.respawnTimer;
    buf[offset + C_INVINCIBLE] = char.invincible ? 1 : 0;
    buf[offset + C_INVINCIBLE_TIMER] = char.invincibleTimer;
    buf[offset + C_JOUST_COOLDOWN] = char.joustCooldown;
    buf[offset + C_MATERIALIZING] = char.materializing ? 1 : 0;
    buf[offset + C_MATERIALIZE_TIMER] = char.materializeTimer;
    buf[offset + C_MATERIALIZE_DURATION] = char.materializeDuration;
    buf[offset + C_MATERIALIZE_QUICK_END] = char.materializeQuickEnd ? 1 : 0;
    buf[offset + C_SCORE] = char.score;
    buf[offset + C_LIVES] = char.lives;
    buf[offset + C_EGGS_COLLECTED] = char.eggsCollectedThisWave;
    buf[offset + C_PREV_POS_X] = char.prevPositionX;
    buf[offset + C_PREV_POS_Y] = char.prevPositionY;
    buf[offset + C_NEXT_LIFE_SCORE] = char.nextLifeScore;
    buf[offset + C_PALETTE_INDEX] = char.paletteIndex;
    buf[offset + C_PLAYER_DIED_WAVE] = char.playerDiedThisWave ? 1 : 0;
    buf[offset + C_ENEMY_TYPE] = char.enemyType;
    buf[offset + C_HIT_LAVA] = char.hitLava ? 1 : 0;
    buf[offset + C_PLATFORM_INDEX] = char.platformIndex;
    buf[offset + C_BOUNCE_COUNT] = char.bounceCount;
    buf[offset + C_EDGE_BUMP_COUNT] = char.edgeBumpCount;
  }

  _deserializeChar(buf, offset, char) {
    char.active = buf[offset + C_ACTIVE] === 1;
    char.positionX = buf[offset + C_POS_X];
    char.positionY = buf[offset + C_POS_Y];
    char.velocityX = buf[offset + C_VEL_X];
    char.velocityY = buf[offset + C_VEL_Y];
    char.playerState = buf[offset + C_STATE] === STATE_AIRBORNE ? 'AIRBORNE' : 'GROUNDED';
    char.facingDir = buf[offset + C_FACING_DIR];
    char.isTurning = buf[offset + C_IS_TURNING] === 1;
    char.turnTimer = buf[offset + C_TURN_TIMER];
    char.stridePhase = buf[offset + C_STRIDE_PHASE];
    char.isFlapping = buf[offset + C_IS_FLAPPING] === 1;
    char.flapTimer = buf[offset + C_FLAP_TIMER];
    char.dead = buf[offset + C_DEAD] === 1;
    char.respawnTimer = buf[offset + C_RESPAWN_TIMER];
    char.invincible = buf[offset + C_INVINCIBLE] === 1;
    char.invincibleTimer = buf[offset + C_INVINCIBLE_TIMER];
    char.joustCooldown = buf[offset + C_JOUST_COOLDOWN];
    char.materializing = buf[offset + C_MATERIALIZING] === 1;
    char.materializeTimer = buf[offset + C_MATERIALIZE_TIMER];
    char.materializeDuration = buf[offset + C_MATERIALIZE_DURATION];
    char.materializeQuickEnd = buf[offset + C_MATERIALIZE_QUICK_END] === 1;
    char.score = buf[offset + C_SCORE];
    char.lives = buf[offset + C_LIVES];
    char.eggsCollectedThisWave = buf[offset + C_EGGS_COLLECTED];
    char.prevPositionX = buf[offset + C_PREV_POS_X];
    char.prevPositionY = buf[offset + C_PREV_POS_Y];
    char.nextLifeScore = buf[offset + C_NEXT_LIFE_SCORE];
    char.paletteIndex = buf[offset + C_PALETTE_INDEX];
    char.playerDiedThisWave = buf[offset + C_PLAYER_DIED_WAVE] === 1;
    char.enemyType = buf[offset + C_ENEMY_TYPE];
    char.hitLava = buf[offset + C_HIT_LAVA] === 1;
    // Restore platform reference from serialized index
    const platIdx = buf[offset + C_PLATFORM_INDEX];
    char.platformIndex = platIdx;
    char.currentPlatform = (platIdx >= 0 && platIdx < this._platforms.length)
      ? this._platforms[platIdx]
      : null;
    char.bounceCount = buf[offset + C_BOUNCE_COUNT];
    char.edgeBumpCount = buf[offset + C_EDGE_BUMP_COUNT];
  }

  _serializeEgg(buf, offset, egg) {
    buf[offset + E_ACTIVE] = egg.active ? 1 : 0;
    buf[offset + E_POS_X] = egg.positionX;
    buf[offset + E_POS_Y] = egg.positionY;
    buf[offset + E_VEL_X] = egg.velocityX;
    buf[offset + E_VEL_Y] = egg.velocityY;
    buf[offset + E_ON_PLATFORM] = egg.onPlatform ? 1 : 0;
    buf[offset + E_ENEMY_TYPE] = egg.enemyType;
    buf[offset + E_HATCH_STATE] = egg.hatchState;
    buf[offset + E_HATCH_TIMER] = egg.hatchTimer;
    buf[offset + E_BOUNCE_COUNT] = egg.bounceCount;
    buf[offset + E_PREV_POS_Y] = egg.prevPositionY;
    buf[offset + E_HIT_LAVA] = egg.hitLava ? 1 : 0;
  }

  _deserializeEgg(buf, offset, egg) {
    egg.active = buf[offset + E_ACTIVE] === 1;
    egg.positionX = buf[offset + E_POS_X];
    egg.positionY = buf[offset + E_POS_Y];
    egg.velocityX = buf[offset + E_VEL_X];
    egg.velocityY = buf[offset + E_VEL_Y];
    egg.onPlatform = buf[offset + E_ON_PLATFORM] === 1;
    egg.enemyType = buf[offset + E_ENEMY_TYPE];
    egg.hatchState = buf[offset + E_HATCH_STATE];
    egg.hatchTimer = buf[offset + E_HATCH_TIMER];
    egg.bounceCount = buf[offset + E_BOUNCE_COUNT];
    egg.prevPositionY = buf[offset + E_PREV_POS_Y];
    egg.hitLava = buf[offset + E_HIT_LAVA] === 1;
  }

  // ---- Build render state ----
  // Converts FP integers to floats for the renderer

  _buildRenderState() {
    const humans = [];
    for (let i = 0; i < MAX_HUMANS; i++) {
      const c = this._chars[i];
      humans.push({
        ...c,
        positionX: fromFP(c.positionX),
        positionY: fromFP(c.positionY),
        velocityX: fromFP(c.velocityX),
        velocityY: fromFP(c.velocityY),
        prevPositionX: fromFP(c.prevPositionX),
        prevPositionY: fromFP(c.prevPositionY),
        // Convert frame-count timers to seconds for the renderer
        turnTimer: c.turnTimer / 60,
        flapTimer: c.flapTimer / 60,
        stridePhase: fromFP(c.stridePhase),
        respawnTimer: c.respawnTimer / 60,
        invincibleTimer: c.invincibleTimer / 60,
        joustCooldown: c.joustCooldown / 60,
        materializeTimer: c.materializeTimer / 60,
        materializeDuration: c.materializeDuration / 60,
        slotIndex: i,
        wingMode: 'updown',
      });
    }

    const enemies = [];
    for (let i = 0; i < MAX_ENEMIES; i++) {
      const c = this._chars[MAX_HUMANS + i];
      enemies.push({
        ...c,
        positionX: fromFP(c.positionX),
        positionY: fromFP(c.positionY),
        velocityX: fromFP(c.velocityX),
        velocityY: fromFP(c.velocityY),
        prevPositionX: fromFP(c.prevPositionX),
        prevPositionY: fromFP(c.prevPositionY),
        turnTimer: c.turnTimer / 60,
        flapTimer: c.flapTimer / 60,
        stridePhase: fromFP(c.stridePhase),
        respawnTimer: c.respawnTimer / 60,
        invincibleTimer: c.invincibleTimer / 60,
        joustCooldown: c.joustCooldown / 60,
        materializeTimer: c.materializeTimer / 60,
        materializeDuration: c.materializeDuration / 60,
        slotIndex: MAX_HUMANS + i,
        wingMode: 'sweep',
      });
    }

    const eggs = [];
    for (let i = 0; i < MAX_EGGS; i++) {
      const e = this._eggs[i];
      if (e.active) {
        eggs.push({
          ...e,
          positionX: fromFP(e.positionX),
          positionY: fromFP(e.positionY),
          velocityX: fromFP(e.velocityX),
          velocityY: fromFP(e.velocityY),
          hatchTimer: e.hatchTimer / 60,
          slotIndex: i,
        });
      }
    }

    this.state = {
      frame: this._frame,
      waveNumber: this._waveNumber,
      waveState: this._waveState,
      gameOver: this._gameOver,
      gameMode: this._gameMode,
      humans,
      enemies,
      eggs,
    };
  }
}
