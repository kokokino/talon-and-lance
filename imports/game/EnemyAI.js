// Enemy AI — produces input decisions for enemy characters
// Returns { left, right, flap } matching player input format.
// Three behavior types: Bounder (random), Hunter (tracker), Shadow Lord (predator).
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

// Frame-count timer intervals
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

export class EnemyAI {
  constructor(enemyType, initialDirTimer, initialCurrentDir) {
    this.enemyType = enemyType;
    this._dirTimer = initialDirTimer;     // frame count
    this._currentDir = initialCurrentDir;
    this._flapAccum = 0;                  // frame count
    // Pterodactyl-specific state
    this._jawTimer = 0;                   // jaw open/close cycle timer
    this._pteroPhase = PTERO_PHASE_ENTER; // behavior phase
  }

  /**
   * Decide the next input for this enemy.
   * @param {Object} enemy — enemy character state (FP integer positions/velocities)
   * @param {Object|null} player — player character state (FP integers, null if dead)
   * @param {number} orthoBottomFP — bottom of the view (FP integer)
   * @param {DeterministicRNG} rng — seedable PRNG for determinism
   * @param {Array|null} platforms — platform collision data (FP), passed to pterodactyl only
   * @returns {{ left: boolean, right: boolean, flap: boolean }}
   */
  decide(enemy, player, orthoBottomFP, rng, platforms) {
    if (this.enemyType === ENEMY_TYPE_BOUNDER) {
      return this._decideBounder(enemy, player, orthoBottomFP, rng);
    }
    if (this.enemyType === ENEMY_TYPE_HUNTER) {
      return this._decideHunter(enemy, player, orthoBottomFP, rng);
    }
    if (this.enemyType === ENEMY_TYPE_PTERODACTYL) {
      return this._decidePterodactyl(enemy, player, orthoBottomFP, rng, platforms);
    }
    return this._decideShadowLord(enemy, player, orthoBottomFP, rng);
  }

  /**
   * Bounder — Wanderer: random movement, occasional flaps, avoids lava.
   */
  _decideBounder(enemy, player, orthoBottomFP, rng) {
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
   * Hunter — Tracker: seeks player horizontally, tries to gain height advantage.
   */
  _decideHunter(enemy, player, orthoBottomFP, rng) {
    let flap = false;
    let left = false;
    let right = false;

    if (!player) {
      return this._decideBounder(enemy, player, orthoBottomFP, rng);
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
   * Shadow Lord — Predator: aggressively hunts player from above, leads target.
   */
  _decideShadowLord(enemy, player, orthoBottomFP, rng) {
    let flap = false;
    let left = false;
    let right = false;

    if (!player) {
      return this._decideBounder(enemy, player, orthoBottomFP, rng);
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
