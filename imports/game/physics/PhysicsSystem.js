// Pure physics update functions — no Babylon dependencies.
// All functions operate on plain state objects with FP integer positionX/positionY/velocityX/velocityY.
// No dt parameter — all deltas are per-frame at 60fps.

import {
  FP_ACCEL_PF, FP_MAX_SPEED, FP_FRICTION_PF, FP_SKID_DECEL_PF,
  FP_AIR_FRICTION_PF, FP_AIR_SKID_PF,
  FP_GRAVITY_PF, FP_FLAP_IMPULSE, FP_TERMINAL_VELOCITY,
  FP_FEET_OFFSET, FP_HEAD_OFFSET, FP_CEILING_GAP,
  FP_ORTHO_LEFT, FP_ORTHO_RIGHT,
} from './constants.js';
import { checkPlatformCollisions, checkLavaKill, applyScreenWrap } from './CollisionSystem.js';

/**
 * Apply player/AI input to a character. Handles flap, horizontal physics,
 * vertical physics, position update, platform collisions, screen wrap.
 * All values are FP integers. Mutates char in place.
 *
 * @param {Object} char - character state (FP integers)
 * @param {{ left: boolean, right: boolean, flap: boolean }} input
 * @param {Array} platforms - platform collision data (FP integers)
 * @param {number} orthoTopFP - top of view (FP)
 * @param {number} orthoBottomFP - bottom of view (FP)
 */
export function applyInput(char, input, platforms, orthoTopFP, orthoBottomFP) {
  let inputDir = 0;
  if (input.right && !input.left) {
    inputDir = 1;
  } else if (input.left && !input.right) {
    inputDir = -1;
  }

  // Handle flap
  if (input.flap) {
    char.velocityY = FP_FLAP_IMPULSE;
    char.playerState = 'AIRBORNE';
    char.currentPlatform = null;
    char.platformIndex = -1;
    char.isFlapping = true;
    char.flapTimer = 0;
  }

  // Horizontal physics
  const isAirborne = char.playerState === 'AIRBORNE';
  const friction = isAirborne ? FP_AIR_FRICTION_PF : FP_FRICTION_PF;
  const skidDecel = isAirborne ? FP_AIR_SKID_PF : FP_SKID_DECEL_PF;

  if (inputDir !== 0) {
    const movingOpposite = (char.velocityX > 0 && inputDir < 0) ||
                           (char.velocityX < 0 && inputDir > 0);
    if (movingOpposite) {
      char.velocityX += inputDir * skidDecel;
    } else {
      char.velocityX += inputDir * FP_ACCEL_PF;
    }
  } else {
    applyFriction(char, friction);
  }

  // Clamp
  if (char.velocityX > FP_MAX_SPEED) {
    char.velocityX = FP_MAX_SPEED;
  }
  if (char.velocityX < -FP_MAX_SPEED) {
    char.velocityX = -FP_MAX_SPEED;
  }

  // Detect direction change
  if (inputDir !== 0 && inputDir !== char.facingDir) {
    if (isAirborne ||
        (inputDir > 0 && char.velocityX >= 0) ||
        (inputDir < 0 && char.velocityX <= 0)) {
      char.facingDir = inputDir;
      char.isTurning = true;
      char.turnTimer = 0;
    }
  }

  // Vertical physics
  applyGravity(char);

  // Update positions and resolve collisions
  applyPositionAndCollisions(char, platforms, orthoTopFP, orthoBottomFP);
}

/**
 * Apply idle physics (no input) — friction + gravity + position.
 * All values are FP integers.
 */
export function applyIdle(char, platforms, orthoTopFP, orthoBottomFP) {
  const isAirborne = char.playerState === 'AIRBORNE';
  const friction = isAirborne ? FP_AIR_FRICTION_PF : FP_FRICTION_PF;
  applyFriction(char, friction);
  applyGravity(char);
  applyPositionAndCollisions(char, platforms, orthoTopFP, orthoBottomFP);
}

/**
 * Apply friction to horizontal velocity. Mutates in place.
 * @param {number} friction - per-frame friction amount (FP)
 */
export function applyFriction(char, friction) {
  if (char.velocityX > 0) {
    char.velocityX -= friction;
    if (char.velocityX < 0) {
      char.velocityX = 0;
    }
  } else if (char.velocityX < 0) {
    char.velocityX += friction;
    if (char.velocityX > 0) {
      char.velocityX = 0;
    }
  }
}

/**
 * Apply gravity to vertical velocity. Mutates in place.
 */
export function applyGravity(char) {
  if (char.playerState === 'AIRBORNE') {
    char.velocityY -= FP_GRAVITY_PF;
    if (char.velocityY < -FP_TERMINAL_VELOCITY) {
      char.velocityY = -FP_TERMINAL_VELOCITY;
    }
  }
}

/**
 * Update position, run platform collisions, ceiling clamp, lava check, screen wrap.
 * Sets char.hitLava if character enters lava zone.
 * All values are FP integers. Mutates in place.
 */
export function applyPositionAndCollisions(char, platforms, orthoTopFP, orthoBottomFP) {
  // Position update: vel is FP/sec, divide by 60 for per-frame, truncate to int
  char.positionX += (char.velocityX / 60) | 0;
  char.positionY += (char.velocityY / 60) | 0;

  // Platform collision detection
  checkPlatformCollisions(char, char.prevPositionX, char.prevPositionY, platforms);

  // Ceiling clamp
  const ceilingLimit = orthoTopFP - FP_HEAD_OFFSET - FP_CEILING_GAP;
  if (char.positionY > ceilingLimit) {
    char.positionY = ceilingLimit;
    char.velocityY = 0;
  }

  // Lava kill zone
  if (checkLavaKill(char, orthoBottomFP)) {
    char.hitLava = true;
  }

  // Screen wrap
  applyScreenWrap(char, FP_ORTHO_LEFT, FP_ORTHO_RIGHT);
}
