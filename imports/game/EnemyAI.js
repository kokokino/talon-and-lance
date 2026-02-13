// Enemy AI — produces input decisions for enemy characters
// Returns { left, right, flap } matching player input format.
// Three behavior types: Bounder (random), Hunter (tracker), Shadow Lord (predator).

import {
  ENEMY_TYPE_BOUNDER, ENEMY_TYPE_HUNTER, ENEMY_TYPE_SHADOW_LORD,
} from './scoring.js';

// Minimum height — AI avoids going below this (relative to ortho bottom)
const LAVA_AVOIDANCE_Y = -3.0;
const DIRECTION_CHANGE_INTERVAL = 1.5;

export class EnemyAI {
  constructor(enemyType) {
    this.enemyType = enemyType;
    this._dirTimer = Math.random() * DIRECTION_CHANGE_INTERVAL;
    this._currentDir = Math.random() > 0.5 ? 1 : -1;
    this._flapAccum = 0;
  }

  /**
   * Decide the next input for this enemy.
   * @param {Object} enemy — enemy character state { positionX, positionY, velocityX, velocityY, playerState }
   * @param {Object|null} player — player character state (null if player is dead)
   * @param {number} orthoBottom — bottom of the view
   * @param {number} dt — frame delta time in seconds
   * @returns {{ left: boolean, right: boolean, flap: boolean }}
   */
  decide(enemy, player, orthoBottom, dt) {
    if (this.enemyType === ENEMY_TYPE_BOUNDER) {
      return this._decideBounder(enemy, player, orthoBottom, dt);
    }
    if (this.enemyType === ENEMY_TYPE_HUNTER) {
      return this._decideHunter(enemy, player, orthoBottom, dt);
    }
    return this._decideShadowLord(enemy, player, orthoBottom, dt);
  }

  /**
   * Bounder — Wanderer: random movement, occasional flaps, avoids lava.
   */
  _decideBounder(enemy, player, orthoBottom, dt) {
    let flap = false;
    let left = false;
    let right = false;

    // Random direction changes
    this._dirTimer -= dt;
    if (this._dirTimer <= 0) {
      this._dirTimer = DIRECTION_CHANGE_INTERVAL + Math.random() * 1.5;
      this._currentDir = Math.random() > 0.5 ? 1 : -1;
    }

    if (this._currentDir > 0) {
      right = true;
    } else {
      left = true;
    }

    // Occasional flapping (20% chance per second)
    this._flapAccum += dt;
    if (this._flapAccum > 0.2) {
      this._flapAccum = 0;
      if (Math.random() < 0.20) {
        flap = true;
      }
    }

    // Lava avoidance — forced flap when too low
    if (enemy.positionY < orthoBottom + 2.5) {
      flap = true;
    }

    // Also flap if falling fast
    if (enemy.velocityY < -4.0) {
      flap = true;
    }

    return { left, right, flap };
  }

  /**
   * Hunter — Tracker: seeks player horizontally, tries to gain height advantage.
   */
  _decideHunter(enemy, player, orthoBottom, dt) {
    let flap = false;
    let left = false;
    let right = false;

    if (!player) {
      // No target — wander like a bounder
      return this._decideBounder(enemy, player, orthoBottom, dt);
    }

    // Move toward player horizontally
    const dx = player.positionX - enemy.positionX;
    if (dx > 0.5) {
      right = true;
    } else if (dx < -0.5) {
      left = true;
    }

    // Try to gain height advantage
    const dy = player.positionY - enemy.positionY;
    this._flapAccum += dt;
    if (this._flapAccum > 0.15) {
      this._flapAccum = 0;
      // Flap more when below player
      if (dy > 0.5) {
        if (Math.random() < 0.55) {
          flap = true;
        }
      } else {
        // Above player — flap occasionally to maintain height
        if (Math.random() < 0.20) {
          flap = true;
        }
      }
    }

    // Lava avoidance
    if (enemy.positionY < orthoBottom + 2.5) {
      flap = true;
    }

    // Anti-fall flap
    if (enemy.velocityY < -5.0) {
      flap = true;
    }

    return { left, right, flap };
  }

  /**
   * Shadow Lord — Predator: aggressively hunts player from above, leads target.
   */
  _decideShadowLord(enemy, player, orthoBottom, dt) {
    let flap = false;
    let left = false;
    let right = false;

    if (!player) {
      return this._decideBounder(enemy, player, orthoBottom, dt);
    }

    // Lead the player's movement slightly
    const leadFactor = 0.3;
    const predictedX = player.positionX + player.velocityX * leadFactor;
    const dx = predictedX - enemy.positionX;

    if (dx > 0.3) {
      right = true;
    } else if (dx < -0.3) {
      left = true;
    }

    // Aggressively stay above player
    const dy = player.positionY - enemy.positionY;
    this._flapAccum += dt;
    if (this._flapAccum > 0.12) {
      this._flapAccum = 0;
      if (dy > -0.5) {
        // Below or near player — flap aggressively
        if (Math.random() < 0.70) {
          flap = true;
        }
      } else if (dy < -2.0) {
        // Well above player — can dive, flap less
        if (Math.random() < 0.10) {
          flap = true;
        }
      } else {
        if (Math.random() < 0.35) {
          flap = true;
        }
      }
    }

    // Lava avoidance
    if (enemy.positionY < orthoBottom + 2.5) {
      flap = true;
    }

    // Anti-fall
    if (enemy.velocityY < -5.0) {
      flap = true;
    }

    return { left, right, flap };
  }
}
