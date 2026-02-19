// Enemy AI — produces input decisions for enemy characters
// Returns { left, right, flap } matching player input format.
// Three behavior types: Bounder (random), Hunter (tracker), Shadow Lord (predator).
// Non-pterodactyl enemies use a 3-phase patrol state machine (PATROL → ATTACK → RETURN).
// Pterodactyl AI is unchanged — 4-phase direct velocity control.
// All randomness flows through the DeterministicRNG passed to decide().
// All timers are frame counts (integers). All thresholds are FP integers.

import {
  ENEMY_TYPE_BOUNDER, ENEMY_TYPE_HUNTER, ENEMY_TYPE_SHADOW_LORD,
  ENEMY_TYPE_PTERODACTYL,
} from './scoring.js';

import { FP_SCALE, idiv10, velPerFrame } from './physics/stateLayout.js';
import {
  FP_PTERO_SWOOP_SPEED, FP_PTERO_ENTER_SPEED,
  FP_PTERO_PULL_UP_SPEED, FP_PTERO_CIRCLE_SPEED,
  FP_PTERO_AVOID_MARGIN,
  PTERO_JAW_OPEN_FRAMES, PTERO_JAW_TOTAL,
  PTERO_ENTER_FRAMES, PTERO_SWOOP_FRAMES,
  PTERO_PULL_UP_FRAMES, PTERO_CIRCLE_FRAMES,
  FP_CHAR_HALF_WIDTH, FP_FEET_OFFSET, FP_HEAD_OFFSET,
  FP_ORTHO_WIDTH,
  FP_CEILING_AVOID,
  FP_RETURN_X_TOLERANCE, FP_RETURN_ABOVE_MARGIN,
  RETURN_TIMEOUT,
  PATROL_MIN_BOUNDER, PATROL_RANGE_BOUNDER,
  PATROL_MIN_HUNTER, PATROL_RANGE_HUNTER,
  PATROL_MIN_SHADOW, PATROL_RANGE_SHADOW,
  ATTACK_MIN_BOUNDER, ATTACK_RANGE_BOUNDER,
  ATTACK_MIN_HUNTER, ATTACK_RANGE_HUNTER,
  ATTACK_MIN_SHADOW, ATTACK_RANGE_SHADOW,
} from './physics/constants.js';

// FP thresholds (precomputed)
const FP_DX_THRESHOLD = Math.round(0.5 * FP_SCALE);       // 128
const FP_DX_THRESHOLD_SMALL = Math.round(0.3 * FP_SCALE);  // 77
const FP_DY_THRESHOLD = Math.round(0.5 * FP_SCALE);        // 128
const FP_DY_ABOVE_THRESHOLD = Math.round(2.0 * FP_SCALE);  // 512
const FP_DY_NEAR_THRESHOLD = Math.round(0.5 * FP_SCALE);   // 128
const FP_LAVA_AVOID = Math.round(2.5 * FP_SCALE);          // 640
const FP_FALL_SPEED_THRESHOLD = Math.round(4.0 * FP_SCALE); // 1024
const FP_FALL_SPEED_FAST = Math.round(5.0 * FP_SCALE);     // 1280

// Patrol edge margin — reverse direction when center is this close to platform edge
const FP_PATROL_EDGE_MARGIN = Math.round(1.0 * FP_SCALE);  // 256 FP = 1.0 world unit

// Return phase flap interval (frames between flap attempts)
const RETURN_FLAP_INTERVAL = 10;

// Frame-count timer intervals (attack phase)
const DIR_CHANGE_FRAMES = 90;          // 1.5s * 60
const BOUNDER_FLAP_INTERVAL = 12;     // 0.2s * 60
const HUNTER_FLAP_INTERVAL = 9;       // 0.15s * 60
const SHADOW_FLAP_INTERVAL = 7;       // 0.12s * 60

// Pterodactyl AI phase constants
const PTERO_PHASE_ENTER = 0;
const PTERO_PHASE_SWOOP = 1;
const PTERO_PHASE_PULL_UP = 2;
const PTERO_PHASE_CIRCLE = 3;
const PTERO_PHASE_EXIT = 4;

// Non-ptero patrol phase constants (stored in _pteroPhase field, aliased as _patrolPhase)
const PHASE_PATROL = 0;
const PHASE_ATTACK = 1;
const PHASE_RETURN = 2;

export class EnemyAI {
  constructor(enemyType, initialDirTimer, initialCurrentDir) {
    this.enemyType = enemyType;
    this._dirTimer = initialDirTimer;     // frame count
    this._currentDir = initialCurrentDir;
    this._flapAccum = 0;                  // frame count
    this._phaseTimer = 0;                 // patrol phase countdown (non-ptero); unused for ptero
    if (enemyType === ENEMY_TYPE_PTERODACTYL) {
      this._jawTimer = 0;                   // jaw open/close cycle timer
      this._pteroPhase = PTERO_PHASE_ENTER; // pterodactyl behavior phase
    } else {
      // Non-ptero: aliased fields for patrol state machine
      this._jawTimer = 0;              // aliased: target platform index (set by caller)
      this._pteroPhase = PHASE_PATROL; // aliased: patrol phase (0=PATROL, 1=ATTACK, 2=RETURN)
    }
  }

  /**
   * Decide the next input for this enemy.
   * @param {Object} enemy — enemy character state (FP integer positions/velocities)
   * @param {Object|null} player — player character state (FP integers, null if dead)
   * @param {number} orthoBottomFP — bottom of the view (FP integer)
   * @param {DeterministicRNG} rng — seedable PRNG for determinism
   * @param {Array} platforms — platform collision data (FP)
   * @returns {{ left: boolean, right: boolean, flap: boolean }}
   */
  decide(enemy, player, orthoBottomFP, rng, platforms) {
    // Pterodactyl: completely separate AI, unchanged
    if (this.enemyType === ENEMY_TYPE_PTERODACTYL) {
      return this._decidePterodactyl(enemy, player, orthoBottomFP, rng, platforms);
    }

    // Non-ptero: dispatch based on patrol phase
    if (this._pteroPhase === PHASE_PATROL) {
      return this._decidePatrol(enemy, rng, platforms);
    }
    if (this._pteroPhase === PHASE_RETURN) {
      return this._decideReturn(enemy, orthoBottomFP, rng, platforms);
    }
    return this._decideAttack(enemy, player, orthoBottomFP, rng, platforms);
  }

  // ---- Patrol state machine phases ----

  /**
   * PATROL — Walk on platform, reverse at edges. No flapping.
   * Transitions to ATTACK when timer expires, or RETURN if airborne.
   */
  _decidePatrol(enemy, rng, platforms) {
    let left = false;
    let right = false;

    // Countdown phase timer
    this._phaseTimer -= 1;
    if (this._phaseTimer <= 0) {
      this._pteroPhase = PHASE_ATTACK;
      this._phaseTimer = this._getAttackDuration(rng);
      return { left: false, right: false, flap: false };
    }

    // If airborne (fell off edge or knocked off), transition to RETURN
    if (enemy.playerState === 'AIRBORNE') {
      this._pteroPhase = PHASE_RETURN;
      this._phaseTimer = RETURN_TIMEOUT;
      return { left: false, right: false, flap: false };
    }

    // Walk in current direction
    if (this._currentDir > 0) {
      right = true;
    } else {
      left = true;
    }

    // Reverse direction at platform edges
    const platIdx = this._jawTimer;
    if (platforms && platIdx >= 0 && platIdx < platforms.length) {
      const plat = platforms[platIdx];
      if (enemy.positionX >= plat.right - FP_PATROL_EDGE_MARGIN) {
        this._currentDir = -1;
        left = true;
        right = false;
      } else if (enemy.positionX <= plat.left + FP_PATROL_EDGE_MARGIN) {
        this._currentDir = 1;
        left = false;
        right = true;
      }
    }

    return { left, right, flap: false };
  }

  /**
   * ATTACK — Fight the player using type-specific logic.
   * Ceiling avoidance suppresses flaps above threshold.
   * Transitions to RETURN when timer expires.
   */
  _decideAttack(enemy, player, orthoBottomFP, rng, platforms) {
    // Countdown phase timer
    this._phaseTimer -= 1;
    if (this._phaseTimer <= 0) {
      this._jawTimer = this._pickTargetPlatform(rng, platforms);
      this._pteroPhase = PHASE_RETURN;
      this._phaseTimer = RETURN_TIMEOUT;
      return { left: false, right: false, flap: false };
    }

    // Type-specific attack logic
    let result;
    if (this.enemyType === ENEMY_TYPE_BOUNDER) {
      result = this._decideBounderAttack(enemy, player, orthoBottomFP, rng);
    } else if (this.enemyType === ENEMY_TYPE_HUNTER) {
      result = this._decideHunterAttack(enemy, player, orthoBottomFP, rng);
    } else {
      result = this._decideShadowLordAttack(enemy, player, orthoBottomFP, rng);
    }

    // Ceiling avoidance: suppress flap above threshold to prevent clustering at top
    if (result.flap && enemy.positionY > FP_CEILING_AVOID) {
      result.flap = false;
    }

    return result;
  }

  /**
   * RETURN — Navigate toward target platform and land.
   * Transitions to PATROL on landing, or ATTACK on safety timeout.
   */
  _decideReturn(enemy, orthoBottomFP, rng, platforms) {
    let flap = false;
    let left = false;
    let right = false;

    // Safety timeout — go back to ATTACK if can't land in time
    this._phaseTimer -= 1;
    if (this._phaseTimer <= 0) {
      this._pteroPhase = PHASE_ATTACK;
      this._phaseTimer = this._getAttackDuration(rng);
      return { left: false, right: false, flap: false };
    }

    // If grounded, check whether we landed on the target platform
    if (enemy.playerState === 'GROUNDED') {
      const landedOn = enemy.platformIndex >= 0 ? enemy.platformIndex : -1;
      if (landedOn === this._jawTimer) {
        // Landed on target — patrol here
        this._pteroPhase = PHASE_PATROL;
        this._phaseTimer = this._getPatrolDuration(rng);
        return { left: false, right: false, flap: false };
      }
      // Landed on wrong platform — check if target is above or below
      const landedPlat = platforms[landedOn];
      const targetPlat = (platforms && this._jawTimer >= 0 && this._jawTimer < platforms.length)
        ? platforms[this._jawTimer] : null;
      if (targetPlat && landedPlat && targetPlat.top < landedPlat.top) {
        // Target is below — walk toward nearest edge to fall off (no flap, no re-roll)
        const platCenterX = (landedPlat.left + landedPlat.right) >> 1;
        if (enemy.positionX < platCenterX) {
          return { left: true, right: false, flap: false };
        }
        return { left: false, right: true, flap: false };
      }
      // Target is above or same level — flap to take off
      this._jawTimer = this._pickDifferentPlatform(rng, platforms, landedOn);
      return { left: false, right: false, flap: true };
    }

    // Navigate toward target platform
    const platIdx = this._jawTimer;
    let targetPlatTop = 0;
    if (platforms && platIdx >= 0 && platIdx < platforms.length) {
      const plat = platforms[platIdx];
      targetPlatTop = plat.top;
      const platCenterX = (plat.left + plat.right) >> 1;

      // Screen-wrap-aware horizontal distance
      let dx = platCenterX - enemy.positionX;
      const halfWidth = FP_ORTHO_WIDTH >> 1;
      if (dx > halfWidth) {
        dx -= FP_ORTHO_WIDTH;
      } else if (dx < -halfWidth) {
        dx += FP_ORTHO_WIDTH;
      }

      // Move horizontally toward platform center
      if (dx > FP_RETURN_X_TOLERANCE) {
        right = true;
      } else if (dx < -FP_RETURN_X_TOLERANCE) {
        left = true;
      }

      const horizontallyAligned = Math.abs(dx) <= FP_RETURN_X_TOLERANCE;
      const feetY = enemy.positionY - FP_FEET_OFFSET;

      if (feetY < plat.top) {
        // Below platform — flap to gain altitude
        this._flapAccum += 1;
        if (this._flapAccum > RETURN_FLAP_INTERVAL) {
          this._flapAccum = 0;
          flap = true;
        }
      } else if (horizontallyAligned) {
        // Above platform and aligned — coast down to land (no flap)
      } else {
        // Above platform but not aligned — descend while moving
        // Only brake for dangerously fast falls
        if (enemy.velocityY < -FP_FALL_SPEED_FAST) {
          flap = true;
        }
      }
    }

    // Lava avoidance (always active during return)
    if (enemy.positionY < orthoBottomFP + FP_LAVA_AVOID) {
      flap = true;
    }

    // Anti-fall (only when at or below target to allow descent from above)
    if (enemy.positionY <= targetPlatTop && enemy.velocityY < -FP_FALL_SPEED_THRESHOLD) {
      flap = true;
    }

    return { left, right, flap };
  }

  // ---- Type-specific attack behaviors ----

  /**
   * Bounder attack — Wanderer: random movement, occasional flaps, avoids lava.
   */
  _decideBounderAttack(enemy, player, orthoBottomFP, rng) {
    let flap = false;
    let left = false;
    let right = false;

    // Random direction changes (frame count)
    this._dirTimer -= 1;
    if (this._dirTimer <= 0) {
      this._dirTimer = DIR_CHANGE_FRAMES + rng.nextInt(90);
      this._currentDir = rng.nextInt(2) === 1 ? 1 : -1;
    }

    if (this._currentDir > 0) {
      right = true;
    } else {
      left = true;
    }

    // Occasional flapping (20% chance per check, checked every 12 frames)
    this._flapAccum += 1;
    if (this._flapAccum > BOUNDER_FLAP_INTERVAL) {
      this._flapAccum = 0;
      if (rng.nextInt(100) < 20) {
        flap = true;
      }
    }

    // Lava avoidance (FP comparison)
    if (enemy.positionY < orthoBottomFP + FP_LAVA_AVOID) {
      flap = true;
    }

    // Anti-fall flap (FP comparison)
    if (enemy.velocityY < -FP_FALL_SPEED_THRESHOLD) {
      flap = true;
    }

    return { left, right, flap };
  }

  /**
   * Hunter attack — Tracker: seeks player horizontally, tries to gain height advantage.
   */
  _decideHunterAttack(enemy, player, orthoBottomFP, rng) {
    let flap = false;
    let left = false;
    let right = false;

    if (!player) {
      return this._decideBounderAttack(enemy, player, orthoBottomFP, rng);
    }

    // Move toward player horizontally (FP comparison)
    const dx = player.positionX - enemy.positionX;
    if (dx > FP_DX_THRESHOLD) {
      right = true;
    } else if (dx < -FP_DX_THRESHOLD) {
      left = true;
    }

    // Try to gain height advantage (FP comparison)
    const dy = player.positionY - enemy.positionY;
    this._flapAccum += 1;
    if (this._flapAccum > HUNTER_FLAP_INTERVAL) {
      this._flapAccum = 0;
      if (dy > FP_DY_THRESHOLD) {
        // Below player — flap more
        if (rng.nextInt(100) < 55) {
          flap = true;
        }
      } else {
        // Above player — flap occasionally
        if (rng.nextInt(100) < 20) {
          flap = true;
        }
      }
    }

    // Lava avoidance
    if (enemy.positionY < orthoBottomFP + FP_LAVA_AVOID) {
      flap = true;
    }

    // Anti-fall
    if (enemy.velocityY < -FP_FALL_SPEED_FAST) {
      flap = true;
    }

    return { left, right, flap };
  }

  /**
   * Shadow Lord attack — Predator: aggressively hunts player from above, leads target.
   */
  _decideShadowLordAttack(enemy, player, orthoBottomFP, rng) {
    let flap = false;
    let left = false;
    let right = false;

    if (!player) {
      return this._decideBounderAttack(enemy, player, orthoBottomFP, rng);
    }

    // Lead the player's movement: predictedX = playerX + playerVelX * 0.3
    // In FP: idiv10(velX * 3) — reciprocal-multiply, no float intermediates
    const leadX = idiv10(player.velocityX * 3);
    const predictedX = player.positionX + leadX;
    const dx = predictedX - enemy.positionX;

    if (dx > FP_DX_THRESHOLD_SMALL) {
      right = true;
    } else if (dx < -FP_DX_THRESHOLD_SMALL) {
      left = true;
    }

    // Aggressively stay above player (FP comparison)
    const dy = player.positionY - enemy.positionY;
    this._flapAccum += 1;
    if (this._flapAccum > SHADOW_FLAP_INTERVAL) {
      this._flapAccum = 0;
      if (dy > -FP_DY_NEAR_THRESHOLD) {
        // Below or near player — flap aggressively
        if (rng.nextInt(100) < 70) {
          flap = true;
        }
      } else if (dy < -FP_DY_ABOVE_THRESHOLD) {
        // Well above player — can dive
        if (rng.nextInt(100) < 10) {
          flap = true;
        }
      } else {
        if (rng.nextInt(100) < 35) {
          flap = true;
        }
      }
    }

    // Lava avoidance
    if (enemy.positionY < orthoBottomFP + FP_LAVA_AVOID) {
      flap = true;
    }

    // Anti-fall
    if (enemy.velocityY < -FP_FALL_SPEED_FAST) {
      flap = true;
    }

    return { left, right, flap };
  }

  // ---- Patrol helpers ----

  /**
   * Pick a random platform guaranteed different from excludeIndex.
   * Maps [0, N-2] into [0, N-1] while skipping the excluded index.
   */
  _pickDifferentPlatform(rng, platforms, excludeIndex) {
    if (!platforms || platforms.length <= 1) {
      return 0;
    }
    const pick = rng.nextInt(platforms.length - 1);
    if (pick >= excludeIndex) {
      return pick + 1;
    }
    return pick;
  }

  /**
   * Pick a random target platform (uniform distribution).
   * Deterministic via shared RNG so all clients agree in multiplayer.
   */
  _pickTargetPlatform(rng, platforms) {
    if (!platforms || platforms.length === 0) {
      return 0;
    }
    return rng.nextInt(platforms.length);
  }

  /**
   * Random patrol duration based on enemy type.
   * Harder enemies patrol for shorter durations before attacking.
   */
  _getPatrolDuration(rng) {
    if (this.enemyType === ENEMY_TYPE_BOUNDER) {
      return PATROL_MIN_BOUNDER + rng.nextInt(PATROL_RANGE_BOUNDER);
    }
    if (this.enemyType === ENEMY_TYPE_HUNTER) {
      return PATROL_MIN_HUNTER + rng.nextInt(PATROL_RANGE_HUNTER);
    }
    return PATROL_MIN_SHADOW + rng.nextInt(PATROL_RANGE_SHADOW);
  }

  /**
   * Random attack duration based on enemy type.
   * Harder enemies attack for shorter durations before returning to patrol.
   */
  _getAttackDuration(rng) {
    if (this.enemyType === ENEMY_TYPE_BOUNDER) {
      return ATTACK_MIN_BOUNDER + rng.nextInt(ATTACK_RANGE_BOUNDER);
    }
    if (this.enemyType === ENEMY_TYPE_HUNTER) {
      return ATTACK_MIN_HUNTER + rng.nextInt(ATTACK_RANGE_HUNTER);
    }
    return ATTACK_MIN_SHADOW + rng.nextInt(ATTACK_RANGE_SHADOW);
  }

  // ---- Pterodactyl AI (unchanged) ----

  /**
   * Pterodactyl — 4-phase state machine with direct velocity control.
   * Returns { velX, velY, facingDir } instead of {left, right, flap} —
   * GameSimulation applies these directly, bypassing normal physics.
   */
  _decidePterodactyl(enemy, player, orthoBottomFP, rng, platforms) {
    // Update jaw timer (cycles continuously)
    this._jawTimer += 1;
    if (this._jawTimer >= PTERO_JAW_TOTAL) {
      this._jawTimer = 0;
    }

    // Decrement phase timer (stored in _dirTimer)
    this._dirTimer -= 1;

    // Pick target — closest active human, or center of screen
    const targetX = player ? player.positionX : 0;
    const targetY = player ? player.positionY : 0;
    const dx = targetX - enemy.positionX;

    let velX = 0;
    let velY = 0;
    let facingDir = enemy.facingDir;

    if (this._pteroPhase === PTERO_PHASE_ENTER) {
      // Fly inward from screen edge at bottom level, rising toward target
      velX = this._currentDir * velPerFrame(FP_PTERO_ENTER_SPEED);
      facingDir = this._currentDir;
      // Rise upward toward target's Y level
      const dy = targetY - enemy.positionY;
      if (dy > FP_DY_THRESHOLD) {
        velY = velPerFrame(FP_PTERO_ENTER_SPEED >> 1);
      } else if (dy < -FP_DY_THRESHOLD) {
        velY = -velPerFrame(FP_PTERO_ENTER_SPEED >> 1);
      }

      if (this._dirTimer <= 0) {
        this._pteroPhase = PTERO_PHASE_SWOOP;
        this._dirTimer = PTERO_SWOOP_FRAMES;
        // Face toward target for swoop
        this._currentDir = dx >= 0 ? 1 : -1;
      }
    } else if (this._pteroPhase === PTERO_PHASE_SWOOP) {
      // Charge toward player at high speed
      facingDir = this._currentDir;
      velX = this._currentDir * velPerFrame(FP_PTERO_SWOOP_SPEED);
      // Slight Y tracking during swoop
      const dy = targetY - enemy.positionY;
      if (Math.abs(dy) > FP_DY_THRESHOLD) {
        velY = dy > 0
          ? velPerFrame(FP_PTERO_ENTER_SPEED >> 2)
          : -velPerFrame(FP_PTERO_ENTER_SPEED >> 2);
      }

      if (this._dirTimer <= 0) {
        this._pteroPhase = PTERO_PHASE_PULL_UP;
        this._dirTimer = PTERO_PULL_UP_FRAMES;
      }
    } else if (this._pteroPhase === PTERO_PHASE_PULL_UP) {
      // Veer upward (~45 degrees), maintain horizontal direction
      facingDir = this._currentDir;
      velX = this._currentDir * velPerFrame(FP_PTERO_PULL_UP_SPEED);
      velY = velPerFrame(FP_PTERO_PULL_UP_SPEED);

      if (this._dirTimer <= 0) {
        this._pteroPhase = PTERO_PHASE_CIRCLE;
        this._dirTimer = PTERO_CIRCLE_FRAMES;
        // Reverse direction for repositioning
        this._currentDir = -this._currentDir;
        // Reset jaw timer — jaw closed during circle
        this._jawTimer = PTERO_JAW_OPEN_FRAMES;
      }
    } else if (this._pteroPhase === PTERO_PHASE_CIRCLE) {
      // Fly to opposite side, reposition at target's Y level
      facingDir = this._currentDir;
      velX = this._currentDir * velPerFrame(FP_PTERO_CIRCLE_SPEED);
      const dy = targetY - enemy.positionY;
      if (dy > FP_DY_THRESHOLD) {
        velY = velPerFrame(FP_PTERO_CIRCLE_SPEED >> 1);
      } else if (dy < -FP_DY_THRESHOLD) {
        velY = -velPerFrame(FP_PTERO_CIRCLE_SPEED >> 1);
      }

      if (this._dirTimer <= 0) {
        this._pteroPhase = PTERO_PHASE_SWOOP;
        this._dirTimer = PTERO_SWOOP_FRAMES;
        // Face toward target for next swoop
        this._currentDir = dx >= 0 ? 1 : -1;
        // Reset jaw timer for new attack run
        this._jawTimer = 0;
      }
    } else if (this._pteroPhase === PTERO_PHASE_EXIT) {
      // Fly toward nearest screen edge to leave
      facingDir = this._currentDir;
      velX = this._currentDir * velPerFrame(FP_PTERO_ENTER_SPEED);
      // Slight upward drift so it doesn't sink into lava while exiting
      velY = velPerFrame(FP_PTERO_ENTER_SPEED >> 2);
    }

    // Platform avoidance — steer around platforms after computing base velocity
    // Skip during ENTER and EXIT phases
    if (platforms && this._pteroPhase !== PTERO_PHASE_ENTER && this._pteroPhase !== PTERO_PHASE_EXIT) {
      const avoided = this._avoidPlatforms(enemy, velX, velY, platforms);
      velX = avoided.velX;
      velY = avoided.velY;
    }

    const isExiting = this._pteroPhase === PTERO_PHASE_EXIT;
    return { velX, velY, facingDir, isPterodactyl: true, isExiting };
  }

  /**
   * Platform avoidance for pterodactyl.
   * Projects next position and steers vertically/horizontally to avoid clipping platforms.
   * Stateless — no new AI fields needed, determinism preserved.
   */
  _avoidPlatforms(enemy, velX, velY, platforms) {
    const nextX = enemy.positionX + velX;
    const nextY = enemy.positionY + velY;

    // Pterodactyl AABB at projected position (using char hitbox + margin)
    const halfW = FP_CHAR_HALF_WIDTH + FP_PTERO_AVOID_MARGIN;
    const feetOff = FP_FEET_OFFSET + FP_PTERO_AVOID_MARGIN;
    const headOff = FP_HEAD_OFFSET + FP_PTERO_AVOID_MARGIN;

    const pLeft = nextX - halfW;
    const pRight = nextX + halfW;
    const pBottom = nextY - feetOff;
    const pTop = nextY + headOff;

    for (const plat of platforms) {
      // Check AABB overlap with platform
      if (pRight < plat.left || pLeft > plat.right || pTop < plat.bottom || pBottom > plat.top) {
        continue;
      }

      // Overlapping — determine steer direction
      const platCenterY = (plat.top + plat.bottom) >> 1;

      if (enemy.positionY >= platCenterY) {
        // Above platform center — steer up and over
        velY = velPerFrame(FP_PTERO_ENTER_SPEED >> 1);
      } else {
        // Below platform center — steer down and under
        velY = -velPerFrame(FP_PTERO_ENTER_SPEED >> 1);
      }

      // Also nudge horizontally away from platform center
      const platCenterX = (plat.left + plat.right) >> 1;
      if (enemy.positionX < platCenterX) {
        velX -= velPerFrame(FP_PTERO_ENTER_SPEED >> 2);
      } else {
        velX += velPerFrame(FP_PTERO_ENTER_SPEED >> 2);
      }

      break; // Only avoid the first overlapping platform
    }

    return { velX, velY };
  }

  /**
   * Transition pterodactyl to EXIT phase — fly off the nearest screen edge.
   * @param {number} exitDir — direction to exit: 1 (right) or -1 (left)
   */
  startExit(exitDir) {
    this._pteroPhase = PTERO_PHASE_EXIT;
    this._currentDir = exitDir;
    // Close jaw during exit
    this._jawTimer = PTERO_JAW_OPEN_FRAMES;
  }

  /**
   * Whether the pterodactyl's jaw is currently open (vulnerable to kill).
   */
  isJawOpen() {
    return this._jawTimer < PTERO_JAW_OPEN_FRAMES;
  }
}
