// Enemy AI — produces input decisions for enemy characters
// Returns { left, right, flap } matching player input format.
// Three behavior types: Bounder (random), Hunter (tracker), Shadow Lord (predator).
// All randomness flows through the DeterministicRNG passed to decide().
// All timers are frame counts (integers). All thresholds are FP integers.

import {
  ENEMY_TYPE_BOUNDER, ENEMY_TYPE_HUNTER, ENEMY_TYPE_SHADOW_LORD,
} from './scoring.js';

import { FP_SCALE, idiv } from './physics/stateLayout.js';

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

export class EnemyAI {
  constructor(enemyType, initialDirTimer, initialCurrentDir) {
    this.enemyType = enemyType;
    this._dirTimer = initialDirTimer;     // frame count
    this._currentDir = initialCurrentDir;
    this._flapAccum = 0;                  // frame count
  }

  /**
   * Decide the next input for this enemy.
   * @param {Object} enemy — enemy character state (FP integer positions/velocities)
   * @param {Object|null} player — player character state (FP integers, null if dead)
   * @param {number} orthoBottomFP — bottom of the view (FP integer)
   * @param {DeterministicRNG} rng — seedable PRNG for determinism
   * @returns {{ left: boolean, right: boolean, flap: boolean }}
   */
  decide(enemy, player, orthoBottomFP, rng) {
    if (this.enemyType === ENEMY_TYPE_BOUNDER) {
      return this._decideBounder(enemy, player, orthoBottomFP, rng);
    }
    if (this.enemyType === ENEMY_TYPE_HUNTER) {
      return this._decideHunter(enemy, player, orthoBottomFP, rng);
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
    // In FP: idiv(velX * 3, 10) — explicit integer division, no float intermediates
    const leadX = idiv(player.velocityX * 3, 10);
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
}
