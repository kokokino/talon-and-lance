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
  FP_ORTHO_BOTTOM, FP_ORTHO_TOP,
  FP_LAVA_OFFSET, FP_BOUNCE_THRESHOLD,
  FP_EGG_HATCH_LIFT, FP_KILL_KNOCK_VX,
  FP_HATCHLING_HALF_WIDTH, FP_HATCHLING_HEIGHT,
  SPAWN_POINTS_FP, ENEMY_SPAWN_POINTS_FP,
  GAME_MODE_TEAM, GAME_MODE_PVP,
  IDLE_TIMER_THRESHOLD,
  FP_PTERO_SPAWN_MARGIN,
  buildPlatformCollisionDataFP,
  TROLL_WAVE_START, TROLL_GRAB_FRAMES,
  TROLL_RETREAT_FRAMES, TROLL_COOLDOWN_FRAMES, TROLL_GRAB_CHANCE,
  TROLL_GRAB_RADIUS_FP,
  TROLL_PUNCH_RISE_FRAMES, TROLL_PUNCH_TOTAL_FRAMES,
  FP_TROLL_REACH_ZONE, FP_TROLL_RISE_SPEED,
  FP_TROLL_PULL_ACCEL, FP_TROLL_FLAP_IMPULSE, FP_TROLL_ESCAPE_DIST,
  FP_TROLL_ESCAPE_IMPULSE, FP_TROLL_START_Y, FP_TROLL_LAVA_Y,
  buildReducedPlatformCollisionDataFP,
  INITIAL_PATROL_MIN, INITIAL_PATROL_RANGE,
} from './physics/constants.js';
import {
  checkPlatformCollisions, resolveJoust, applyBounce, applyKillToWinner,
  checkLavaKill, applyScreenWrap, resolvePterodactylCollision,
} from './physics/CollisionSystem.js';
import { DISCONNECT_BIT } from '../netcode/InputEncoder.js';
import { applyInput, applyIdle, applyFriction, applyGravity } from './physics/PhysicsSystem.js';
import {
  STARTING_LIVES, EXTRA_LIFE_THRESHOLD,
  POINTS_SURVIVAL_WAVE, POINTS_EGG_MID_AIR,
  ENEMY_TYPE_BOUNDER, ENEMY_TYPE_SHADOW_LORD, ENEMY_TYPE_PTERODACTYL,
  getKillPoints, getEggPoints, getWaveComposition,
} from './scoring.js';
import {
  MAX_HUMANS, MAX_ENEMIES, MAX_EGGS, FP_SCALE,
  TOTAL_INTS, GLOBAL_OFFSET, GLOBAL_SIZE,
  HUMANS_OFFSET, ENEMIES_OFFSET, ENEMY_AI_OFFSET, EGGS_OFFSET,
  LAVA_TROLL_OFFSET, LAVA_TROLL_SIZE,
  CHAR_SIZE, AI_SIZE, EGG_SIZE,
  G_FRAME, G_RNG_SEED, G_WAVE_NUMBER, G_WAVE_STATE,
  G_SPAWN_TIMER, G_WAVE_TRANSITION_TIMER, G_GAME_MODE, G_GAME_OVER,
  G_SPAWN_QUEUE_LEN, G_SPAWN_QUEUE_START, G_SPAWN_QUEUE_MAX,
  G_IDLE_TIMER,
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
  AI_JAW_TIMER, AI_PTERO_PHASE, AI_PHASE_TIMER,
  E_ACTIVE, E_POS_X, E_POS_Y, E_VEL_X, E_VEL_Y,
  E_ON_PLATFORM, E_ENEMY_TYPE, E_HATCH_STATE, E_HATCH_TIMER,
  E_BOUNCE_COUNT, E_PREV_POS_Y, E_HIT_LAVA,
  LT_ACTIVE, LT_STATE, LT_TARGET_SLOT, LT_TARGET_TYPE,
  LT_POS_X, LT_POS_Y, LT_TIMER, LT_COOLDOWN,
  LT_ESCAPE_PROGRESS, LT_ESCAPE_THRESHOLD, LT_SIDE,
  LT_PLATFORMS_DESTROYED, LT_INTRO_DONE,
  LT_IDLE, LT_REACHING, LT_GRABBING, LT_PULLING, LT_RETREATING, LT_PUNCH_INTRO,
  WAVE_SPAWNING, WAVE_PLAYING, WAVE_TRANSITION,
  HATCH_FALLING, HATCH_ON_PLATFORM, HATCH_WOBBLING, HATCH_HATCHLING,
  STATE_GROUNDED, STATE_AIRBORNE, STATE_GRABBED,
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
   * @param {{ gameMode: string, seed: number }} config
   */
  constructor({ gameMode, seed }) {
    this._gameMode = gameMode || GAME_MODE_TEAM;
    this._platformsFull = buildPlatformCollisionDataFP();
    this._platformsReduced = buildReducedPlatformCollisionDataFP();
    this._platforms = this._platformsFull;
    this._rng = new DeterministicRNG(seed);

    // Integer-based working state
    this._frame = 0;
    this._waveNumber = 1;
    this._waveState = WAVE_SPAWNING;
    this._spawnTimer = 0;           // frame count
    this._waveTransitionTimer = 0;  // frame count
    this._gameOver = false;
    this._spawnQueue = [];
    this._idleTimer = 0;           // frame count — hurry-up pterodactyl mechanic

    // Lava Troll state (all integers for determinism)
    this._trollActive = 0;
    this._trollState = LT_IDLE;
    this._trollTargetSlot = -1;
    this._trollTargetType = 0;       // 0=human, 1=enemy
    this._trollPosX = 0;
    this._trollPosY = FP_TROLL_START_Y;
    this._trollTimer = 0;
    this._trollCooldown = 0;
    this._trollGrabY = 0;           // Y position when grab started (for escape distance)
    this._trollEscapeThreshold = 0; // unused (kept for buffer compat)
    this._trollSide = 1;
    this._trollPlatformsDestroyed = 0;
    this._trollIntroDone = 0;

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

      // Grabbed by Lava Troll — skip normal physics
      // Position and velocity are managed by _updateLavaTroll during PULLING
      if (char.playerState === 'GRABBED') {
        char.velocityX = 0;
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
        applyInput(char, input, this._platforms, FP_ORTHO_TOP, FP_ORTHO_BOTTOM);
      } else {
        const aiIdx = i - MAX_HUMANS;
        const ai = this._ais[aiIdx];
        if (ai) {
          const target = this._findClosestActiveHuman(char);
          const aiResult = ai.decide(char, target, FP_ORTHO_BOTTOM, this._rng, this._platforms);

          if (aiResult.isPterodactyl) {
            // Pterodactyl: direct velocity control, skip normal physics
            char.positionX += aiResult.velX;
            char.positionY += aiResult.velY;
            char.velocityX = aiResult.velX;
            char.velocityY = aiResult.velY;
            char.facingDir = aiResult.facingDir;
            char.playerState = 'AIRBORNE';

            if (aiResult.isExiting) {
              // No screen wrap during exit — deactivate once fully off-screen
              if (char.positionX > FP_ORTHO_RIGHT + FP_PTERO_SPAWN_MARGIN ||
                  char.positionX < FP_ORTHO_LEFT - FP_PTERO_SPAWN_MARGIN) {
                char.active = false;
                this._ais[aiIdx] = null;
                continue;
              }
            } else {
              // Screen wrap only (no platform collisions, no gravity)
              applyScreenWrap(char, FP_ORTHO_LEFT, FP_ORTHO_RIGHT);
            }
            // Lava check — pterodactyl can die in lava
            if (checkLavaKill(char, FP_ORTHO_BOTTOM)) {
              char.hitLava = true;
            }
          } else {
            applyInput(char, aiResult, this._platforms, FP_ORTHO_TOP, FP_ORTHO_BOTTOM);
          }
        } else {
          applyIdle(char, this._platforms, FP_ORTHO_TOP, FP_ORTHO_BOTTOM);
        }
      }

      // Lava death check (hitLava stays true on the dead character so the
      // renderer can distinguish lava deaths from joust deaths)
      if (char.hitLava) {
        this._lavaDeath(char, i);
        continue;
      }

      // Advance turn animation timer (frame count) — skip for pterodactyls
      if (char.isTurning && char.enemyType !== ENEMY_TYPE_PTERODACTYL) {
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

    // Lava Troll
    this._updateLavaTroll(inputs);

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
    buf[GLOBAL_OFFSET + G_IDLE_TIMER] = this._idleTimer;
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
        buf[offset + AI_JAW_TIMER] = ai._jawTimer;
        buf[offset + AI_PTERO_PHASE] = ai._pteroPhase;
        buf[offset + AI_PHASE_TIMER] = ai._phaseTimer;
      }
    }

    // Eggs
    for (let i = 0; i < MAX_EGGS; i++) {
      this._serializeEgg(buf, EGGS_OFFSET + i * EGG_SIZE, this._eggs[i]);
    }

    // Lava Troll
    const lt = LAVA_TROLL_OFFSET;
    buf[lt + LT_ACTIVE] = this._trollActive;
    buf[lt + LT_STATE] = this._trollState;
    buf[lt + LT_TARGET_SLOT] = this._trollTargetSlot;
    buf[lt + LT_TARGET_TYPE] = this._trollTargetType;
    buf[lt + LT_POS_X] = this._trollPosX;
    buf[lt + LT_POS_Y] = this._trollPosY;
    buf[lt + LT_TIMER] = this._trollTimer;
    buf[lt + LT_COOLDOWN] = this._trollCooldown;
    buf[lt + LT_ESCAPE_PROGRESS] = this._trollGrabY;
    buf[lt + LT_ESCAPE_THRESHOLD] = this._trollEscapeThreshold;
    buf[lt + LT_SIDE] = this._trollSide;
    buf[lt + LT_PLATFORMS_DESTROYED] = this._trollPlatformsDestroyed;
    buf[lt + LT_INTRO_DONE] = this._trollIntroDone;

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
    this._idleTimer = buf[GLOBAL_OFFSET + G_IDLE_TIMER];
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
          this._ais[i]._jawTimer = buf[offset + AI_JAW_TIMER];
          this._ais[i]._pteroPhase = buf[offset + AI_PTERO_PHASE];
          this._ais[i]._phaseTimer = buf[offset + AI_PHASE_TIMER];
        } else {
          this._ais[i]._dirTimer = buf[offset + AI_DIR_TIMER];
          this._ais[i]._currentDir = buf[offset + AI_CURRENT_DIR];
          this._ais[i]._flapAccum = buf[offset + AI_FLAP_ACCUM];
          this._ais[i]._jawTimer = buf[offset + AI_JAW_TIMER];
          this._ais[i]._pteroPhase = buf[offset + AI_PTERO_PHASE];
          this._ais[i]._phaseTimer = buf[offset + AI_PHASE_TIMER];
        }
      } else {
        this._ais[i] = null;
      }
    }

    // Eggs
    for (let i = 0; i < MAX_EGGS; i++) {
      this._deserializeEgg(buf, EGGS_OFFSET + i * EGG_SIZE, this._eggs[i]);
    }

    // Lava Troll
    const lt = LAVA_TROLL_OFFSET;
    this._trollActive = buf[lt + LT_ACTIVE];
    this._trollState = buf[lt + LT_STATE];
    this._trollTargetSlot = buf[lt + LT_TARGET_SLOT];
    this._trollTargetType = buf[lt + LT_TARGET_TYPE];
    this._trollPosX = buf[lt + LT_POS_X];
    this._trollPosY = buf[lt + LT_POS_Y];
    this._trollTimer = buf[lt + LT_TIMER];
    this._trollCooldown = buf[lt + LT_COOLDOWN];
    this._trollGrabY = buf[lt + LT_ESCAPE_PROGRESS];
    this._trollEscapeThreshold = buf[lt + LT_ESCAPE_THRESHOLD];
    this._trollSide = buf[lt + LT_SIDE];
    this._trollPlatformsDestroyed = buf[lt + LT_PLATFORMS_DESTROYED];
    this._trollIntroDone = buf[lt + LT_INTRO_DONE];
    // Restore platform set based on destruction state
    this._platforms = this._trollPlatformsDestroyed
      ? this._platformsReduced : this._platformsFull;

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

  // ---- Lava Troll ----

  _updateLavaTroll(inputs) {
    if (this._waveNumber < TROLL_WAVE_START) {
      return;
    }

    // Cooldown countdown
    if (this._trollCooldown > 0) {
      this._trollCooldown -= 1;
    }

    if (this._trollState === LT_IDLE) {
      if (!this._trollActive || this._trollCooldown > 0) {
        return;
      }
      // Scan for targets below reach zone (skip if shielded by a platform)
      let bestSlot = -1;
      let bestType = 0;
      let lowestY = 0x7FFFFFFF;
      for (let i = 0; i < this._chars.length; i++) {
        const c = this._chars[i];
        if (!c.active || c.dead || c.materializing) {
          continue;
        }
        if (c.positionY < FP_TROLL_REACH_ZONE && c.positionY < lowestY) {
          // Check if a platform shields this character from a grab below
          let shielded = false;
          for (const plat of this._platforms) {
            if (plat.top < c.positionY &&
                c.positionX >= plat.left && c.positionX <= plat.right) {
              shielded = true;
              break;
            }
          }
          if (!shielded) {
            lowestY = c.positionY;
            bestSlot = i;
            bestType = i < MAX_HUMANS ? 0 : 1;
          }
        }
      }
      if (bestSlot >= 0) {
        // 1 in TROLL_GRAB_CHANCE per cooldown cycle
        if (this._rng.nextInt(TROLL_GRAB_CHANCE) === 0) {
          this._trollTargetSlot = bestSlot;
          this._trollTargetType = bestType;
          this._trollState = LT_REACHING;
          this._trollTimer = 0;
          this._trollPosX = this._chars[bestSlot].positionX;
          this._trollPosY = FP_TROLL_START_Y;
          this._trollSide = this._chars[bestSlot].positionX >= 0 ? 1 : -1;
        } else {
          // Failed the roll — wait another cooldown cycle
          this._trollCooldown = TROLL_COOLDOWN_FRAMES;
        }
      } else {
        // No valid target — reset cooldown so we don't spin every frame
        this._trollCooldown = TROLL_COOLDOWN_FRAMES;
      }
    } else if (this._trollState === LT_REACHING) {
      // Hand rises from lava, tracking target. Target moves freely.
      this._trollTimer += 1;
      const target = this._chars[this._trollTargetSlot];
      if (!target.active || target.dead) {
        this._trollState = LT_RETREATING;
        this._trollTimer = 0;
      } else {
        // Track target X position
        this._trollPosX = target.positionX;
        // Rise toward target Y
        this._trollPosY += FP_TROLL_RISE_SPEED;
        // Check if hand has reached the target (close enough in Y)
        const dy = Math.abs(this._trollPosY - target.positionY);
        if (dy < TROLL_GRAB_RADIUS_FP) {
          // Hand reached target — start closing fist
          this._trollState = LT_GRABBING;
          this._trollTimer = 0;
        } else if (target.positionY > FP_TROLL_REACH_ZONE || this._trollPosY > FP_TROLL_REACH_ZONE) {
          // Target escaped the zone — give up
          this._trollState = LT_RETREATING;
          this._trollTimer = 0;
        }
      }
    } else if (this._trollState === LT_GRABBING) {
      // Fist closing — short animation. Hand tracks X, target can escape via Y.
      this._trollTimer += 1;
      const target = this._chars[this._trollTargetSlot];
      if (!target.active || target.dead) {
        this._trollState = LT_RETREATING;
        this._trollTimer = 0;
      } else {
        // Continue tracking target X while fingers close
        this._trollPosX = target.positionX;
        if (this._trollTimer >= TROLL_GRAB_FRAMES) {
          // Fist closed — check if target is still within grab radius
          const dy = Math.abs(this._trollPosY - target.positionY);
          if (dy < TROLL_GRAB_RADIUS_FP) {
            // Grab succeeds — lock the target
            target.playerState = 'GRABBED';
            target.currentPlatform = null;
            target.platformIndex = -1;
            target.velocityY = 0;
            this._trollGrabY = target.positionY;
            this._trollState = LT_PULLING;
            this._trollTimer = 0;
          } else {
            // Target moved away — grab missed
            this._trollState = LT_RETREATING;
            this._trollTimer = 0;
          }
        }
      }
    } else if (this._trollState === LT_PULLING) {
      // Tug of war: hand pulls down, flapping pulls up.
      // Velocity halved each frame (grip drag) to prevent runaway acceleration.
      this._trollTimer += 1;
      const target = this._chars[this._trollTargetSlot];
      if (!target.active || target.dead) {
        this._trollState = LT_RETREATING;
        this._trollTimer = 0;
      } else {
        // Velocity damping — halve each frame (grip resistance)
        target.velocityY = target.velocityY >> 1;
        // Apply pull-down force
        target.velocityY -= FP_TROLL_PULL_ACCEL;
        // Apply flap impulse (humans only)
        if (this._trollTargetType === 0) {
          const input = this._decodeInput(inputs[this._trollTargetSlot] || 0);
          if (input.flap) {
            target.velocityY += FP_TROLL_FLAP_IMPULSE;
          }
        }
        // Update character position from velocity
        target.positionY += target.velocityY;
        // Hand follows the character
        this._trollPosX = target.positionX;
        this._trollPosY = target.positionY;
        // Escape: risen far enough above grab point
        if (target.positionY > this._trollGrabY + FP_TROLL_ESCAPE_DIST) {
          target.playerState = 'AIRBORNE';
          target.velocityY = FP_TROLL_ESCAPE_IMPULSE;
          this._trollState = LT_RETREATING;
          this._trollTimer = 0;
        } else if (target.positionY <= FP_TROLL_LAVA_Y) {
          // Pulled into lava — kill target
          target.hitLava = true;
          target.playerState = 'AIRBORNE';
          this._lavaDeath(target, this._trollTargetSlot);
          this._trollState = LT_RETREATING;
          this._trollTimer = 0;
        }
      }
    } else if (this._trollState === LT_RETREATING) {
      this._trollTimer += 1;
      this._trollPosY -= FP_TROLL_RISE_SPEED;
      if (this._trollTimer >= TROLL_RETREAT_FRAMES) {
        this._trollState = LT_IDLE;
        this._trollTimer = 0;
        this._trollCooldown = TROLL_COOLDOWN_FRAMES;
        this._trollPosY = FP_TROLL_START_Y;
      }
    } else if (this._trollState === LT_PUNCH_INTRO) {
      this._trollTimer += 1;
      if (this._trollTimer <= TROLL_PUNCH_RISE_FRAMES) {
        const progress = this._trollTimer;
        const totalRise = FP_TROLL_REACH_ZONE - FP_TROLL_START_Y;
        this._trollPosY = FP_TROLL_START_Y + ((totalRise * progress / TROLL_PUNCH_RISE_FRAMES) | 0);
      } else if (this._trollTimer === TROLL_PUNCH_RISE_FRAMES + 1) {
        this._trollPlatformsDestroyed = 1;
        this._platforms = this._platformsReduced;
      }
      if (this._trollTimer > TROLL_PUNCH_RISE_FRAMES + 10) {
        this._trollPosY -= FP_TROLL_RISE_SPEED;
      }
      if (this._trollTimer >= TROLL_PUNCH_TOTAL_FRAMES) {
        this._trollIntroDone = 1;
        this._trollActive = 1;
        this._trollState = LT_IDLE;
        this._trollTimer = 0;
        this._trollCooldown = TROLL_COOLDOWN_FRAMES;
        this._trollPosY = FP_TROLL_START_Y;
      }
    }
  }

  // ---- Wave system ----

  _startWave(waveNumber) {
    this._waveNumber = waveNumber;
    this._waveState = WAVE_SPAWNING;

    // Lava Troll activation — destroy base platforms and activate troll
    if (waveNumber >= TROLL_WAVE_START && !this._trollIntroDone) {
      this._trollPlatformsDestroyed = 1;
      this._platforms = this._platformsReduced;
      this._trollIntroDone = 1;
      this._trollActive = 1;
      this._trollState = LT_IDLE;
      this._trollCooldown = TROLL_COOLDOWN_FRAMES;
      this._trollPosY = FP_TROLL_START_Y;
    }

    // Reset per-wave stats for all active humans
    for (let i = 0; i < MAX_HUMANS; i++) {
      if (this._chars[i].active) {
        this._chars[i].eggsCollectedThisWave = 0;
        this._chars[i].playerDiedThisWave = false;
      }
    }

    const composition = getWaveComposition(waveNumber);

    // Reset idle timer on wave start
    this._idleTimer = 0;

    // Build spawn queue (regular enemies only — pterodactyls spawn separately)
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

    // Spawn wave pterodactyls (appear from screen edge, no materialization)
    for (let i = 0; i < composition.pterodactyls; i++) {
      this._spawnPterodactyl();
    }
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
    char.materializeDuration = MATERIALIZE_QUICK_FRAMES;
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

    // Initialize patrol state for non-pterodactyl enemies
    if (enemyType !== ENEMY_TYPE_PTERODACTYL) {
      const pIdx = platform ? this._platforms.indexOf(platform) : 0;
      this._ais[slotIdx]._jawTimer = pIdx >= 0 ? pIdx : 0;
      this._ais[slotIdx]._phaseTimer = INITIAL_PATROL_MIN + this._rng.nextInt(INITIAL_PATROL_RANGE);
    }

    return slotIdx;
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
    const slotIdx = this._spawnEnemy(enemyType, fpX, spawnY, platform);
    // Skip materialization — hatchling was already visible, enemy should be immediately active
    if (slotIdx >= 0) {
      this._chars[MAX_HUMANS + slotIdx].materializing = false;
    }
  }

  _spawnPterodactyl() {
    // Find free enemy slot
    let slotIdx = -1;
    for (let i = 0; i < MAX_ENEMIES; i++) {
      if (!this._chars[MAX_HUMANS + i].active) {
        slotIdx = i;
        break;
      }
    }
    if (slotIdx < 0) {
      return;
    }

    // Spawn from screen edge at bottom level — just above lava, below all platforms
    const target = this._findClosestActiveHuman(this._chars[0]);
    const enterFromLeft = target ? target.positionX > 0 : this._rng.nextInt(2) === 0;
    const spawnX = enterFromLeft
      ? FP_ORTHO_LEFT - FP_PTERO_SPAWN_MARGIN
      : FP_ORTHO_RIGHT + FP_PTERO_SPAWN_MARGIN;
    const spawnY = FP_ORTHO_BOTTOM + FP_LAVA_OFFSET + toFP(0.5);
    const facingDir = enterFromLeft ? 1 : -1;

    const char = this._chars[MAX_HUMANS + slotIdx];
    char.active = true;
    char.positionX = spawnX;
    char.positionY = spawnY;
    char.velocityX = 0;
    char.velocityY = 0;
    char.playerState = 'AIRBORNE';
    char.currentPlatform = null;
    char.platformIndex = -1;
    char.facingDir = facingDir;
    char.isTurning = false;
    char.turnTimer = 0;
    char.dead = false;
    char.respawnTimer = 0;
    char.invincible = false;
    char.invincibleTimer = 0;
    char.joustCooldown = 0;
    char.materializing = false;  // No materialization — rises from below
    char.materializeTimer = 0;
    char.materializeDuration = 0;
    char.materializeQuickEnd = false;
    char.enemyType = ENEMY_TYPE_PTERODACTYL;
    char.isFlapping = false;
    char.flapTimer = 0;
    char.stridePhase = 0;
    char.prevPositionX = char.positionX;
    char.prevPositionY = char.positionY;
    char.hitLava = false;
    char.bounceCount = 0;
    char.edgeBumpCount = 0;

    const ai = new EnemyAI(ENEMY_TYPE_PTERODACTYL, 60, facingDir); // 60 = PTERO_ENTER_FRAMES
    this._ais[slotIdx] = ai;
  }

  _hasPterodactylAlive() {
    for (let i = 0; i < MAX_ENEMIES; i++) {
      const char = this._chars[MAX_HUMANS + i];
      if (char.active && !char.dead && char.enemyType === ENEMY_TYPE_PTERODACTYL) {
        return true;
      }
    }
    return false;
  }

  _updateWaveSystem() {
    if (this._gameOver) {
      return;
    }

    // Pause spawn processing during troll punch intro
    if (this._trollState === LT_PUNCH_INTRO) {
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

      // Idle timer — hurry-up pterodactyl
      this._idleTimer += 1;
      if (this._idleTimer >= IDLE_TIMER_THRESHOLD && !this._hasPterodactylAlive()) {
        this._spawnPterodactyl();
        this._idleTimer = 0;
      }

      // Count living enemies (exclude pterodactyls from wave completion)
      let livingEnemies = 0;
      for (let i = 0; i < MAX_ENEMIES; i++) {
        const char = this._chars[MAX_HUMANS + i];
        if (char.active && !char.dead && char.enemyType !== ENEMY_TYPE_PTERODACTYL) {
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

        // Clean up ALL enemy slots (including pterodactyls)
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
    // Pterodactyl vs human collisions (checked first — pterodactyl is instant-kill)
    for (let ei = 0; ei < MAX_ENEMIES; ei++) {
      const enemy = this._chars[MAX_HUMANS + ei];
      if (!enemy.active || enemy.dead || enemy.enemyType !== ENEMY_TYPE_PTERODACTYL) {
        continue;
      }
      const ai = this._ais[ei];
      const jawOpen = ai ? ai.isJawOpen() : false;

      for (let hi = 0; hi < MAX_HUMANS; hi++) {
        const human = this._chars[hi];
        if (!human.active || human.dead) {
          continue;
        }

        const result = resolvePterodactylCollision(enemy, human, MAX_HUMANS + ei, hi, jawOpen);
        if (!result) {
          continue;
        }

        if (result.type === 'pteroKill') {
          // Player killed the pterodactyl — award points, no egg drop.
          // Set dead=true (not active=false) so the renderer triggers
          // the death explosion effect. The dead pterodactyl slot stays
          // occupied until wave completion cleans it up.
          this._addScore(hi, getKillPoints(ENEMY_TYPE_PTERODACTYL));
          enemy.dead = true;
          enemy.respawnTimer = RESPAWN_FRAMES;
          this._ais[ei] = null;
          this._idleTimer = 0;
          break; // Pterodactyl is dead — stop checking more humans this frame
        } else if (result.type === 'playerKill') {
          // Pterodactyl killed the player
          const knockDir = enemy.positionX < human.positionX ? 1 : -1;
          this._killCharacter(human, hi, knockDir);
        } else if (result.type === 'bounce') {
          // Invincible player — bounce both
          const pushDir = enemy.positionX <= human.positionX ? -1 : 1;
          applyBounce(enemy, human, pushDir);
          enemy.bounceCount += 1;
          human.bounceCount += 1;
        }
      }
    }

    // Standard joust collisions (skip pterodactyl enemies — handled above)
    const totalChars = MAX_HUMANS + MAX_ENEMIES;
    for (let a = 0; a < totalChars; a++) {
      for (let b = a + 1; b < totalChars; b++) {
        const charA = this._chars[a];
        const charB = this._chars[b];
        if (!charA.active || !charB.active) {
          continue;
        }

        // Skip if either is a pterodactyl (already handled above)
        if (charA.enemyType === ENEMY_TYPE_PTERODACTYL || charB.enemyType === ENEMY_TYPE_PTERODACTYL) {
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

    // Reset idle timer when an enemy dies
    if (charIdx >= MAX_HUMANS) {
      this._idleTimer = 0;
    }

    // Pterodactyls don't drop eggs — they just die
    if (char.enemyType === ENEMY_TYPE_PTERODACTYL) {
      return;
    }

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

    // Human death: decrement lives, dismiss pterodactyls, reset idle timer
    if (charIdx < MAX_HUMANS) {
      char.lives -= 1;
      char.playerDiedThisWave = true;
      this._dismissPterodactyls();
      this._idleTimer = 0;
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
      this._dismissPterodactyls();
      this._idleTimer = 0;
      if (char.lives <= 0) {
        char.lives = 0;
        this._checkGameOver();
      }
    }
  }

  _dismissPterodactyls() {
    for (let i = 0; i < MAX_ENEMIES; i++) {
      const char = this._chars[MAX_HUMANS + i];
      const ai = this._ais[i];
      if (char.active && !char.dead && char.enemyType === ENEMY_TYPE_PTERODACTYL && ai) {
        // Fly toward nearest screen edge
        const exitDir = char.positionX >= 0 ? 1 : -1;
        ai.startExit(exitDir);
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
        if (egg.positionY < FP_ORTHO_BOTTOM + FP_LAVA_OFFSET) {
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
            this._idleTimer = 0; // Reset idle timer on egg collect
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
    buf[offset + C_STATE] = char.playerState === 'AIRBORNE' ? STATE_AIRBORNE
      : (char.playerState === 'GRABBED' ? STATE_GRABBED : STATE_GROUNDED);
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
    const stateVal = buf[offset + C_STATE];
    char.playerState = stateVal === STATE_AIRBORNE ? 'AIRBORNE'
      : (stateVal === STATE_GRABBED ? 'GRABBED' : 'GROUNDED');
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
      const ai = this._ais[i];
      const isPtero = c.enemyType === ENEMY_TYPE_PTERODACTYL;
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
        wingMode: isPtero ? 'membrane' : 'sweep',
        jawOpen: isPtero && ai ? ai.isJawOpen() : false,
        pteroPhase: isPtero && ai ? ai._pteroPhase : 0,
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
      idleTimer: this._idleTimer,
      humans,
      enemies,
      eggs,
      lavaTroll: {
        active: this._trollActive,
        state: this._trollState,
        targetSlot: this._trollTargetSlot,
        targetType: this._trollTargetType,
        positionX: fromFP(this._trollPosX),
        positionY: fromFP(this._trollPosY),
        timer: this._trollTimer,
        cooldown: this._trollCooldown,
        grabY: fromFP(this._trollGrabY),
        escapeThreshold: this._trollEscapeThreshold,
        side: this._trollSide,
        platformsDestroyed: this._trollPlatformsDestroyed,
        introDone: this._trollIntroDone,
      },
    };
  }
}
