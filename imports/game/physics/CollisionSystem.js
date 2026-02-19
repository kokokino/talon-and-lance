// Pure collision detection functions — no Babylon dependencies.
// All functions operate on plain state objects with FP integer positions/velocities.

import {
  FP_CHAR_HALF_WIDTH, FP_FEET_OFFSET, FP_HEAD_OFFSET,
  FP_JOUST_DEADZONE, FP_JOUST_KNOCKBACK_X, FP_JOUST_KNOCKBACK_Y, FP_KILL_RECOIL_VX,
  FP_ORTHO_WIDTH, FP_EGG_RADIUS,
  FP_LAVA_OFFSET, FP_OVERLAP_PUSH,
  JOUST_COOLDOWN_FRAMES,
  GAME_MODE_TEAM,
} from './constants.js';

// Pterodactyl hitbox — larger to match bigger model
const FP_PTERO_HALF_WIDTH = FP_CHAR_HALF_WIDTH + 50; // ~0.20 wider per side

/**
 * Check platform collisions for a character.
 * All values are FP integers. Mutates char in place.
 */
export function checkPlatformCollisions(char, prevX, prevY, platforms) {
  const feetY = char.positionY - FP_FEET_OFFSET;
  const prevFeetY = prevY - FP_FEET_OFFSET;
  const headY = char.positionY + FP_HEAD_OFFSET;
  const prevHeadY = prevY + FP_HEAD_OFFSET;
  const charLeft = char.positionX - FP_CHAR_HALF_WIDTH;
  const charRight = char.positionX + FP_CHAR_HALF_WIDTH;

  // Edge fall-off: grounded character walks off current platform
  if (char.playerState === 'GROUNDED' && char.currentPlatform) {
    const plat = char.currentPlatform;
    if (charRight < plat.left || charLeft > plat.right) {
      char.playerState = 'AIRBORNE';
      char.currentPlatform = null;
      char.platformIndex = -1;
    }
  }

  // Landing check: falling onto a platform top
  if (char.velocityY <= 0) {
    for (let pi = 0; pi < platforms.length; pi++) {
      const plat = platforms[pi];
      if (charRight < plat.left || charLeft > plat.right) {
        continue;
      }
      if (prevFeetY >= plat.top && feetY < plat.top) {
        char.positionY = plat.top + FP_FEET_OFFSET;
        char.velocityY = 0;
        char.playerState = 'GROUNDED';
        char.currentPlatform = plat;
        char.platformIndex = pi;
        break;
      }
    }
  }

  // Head bump check: rising into platform underside
  if (char.velocityY > 0) {
    for (const plat of platforms) {
      if (charRight < plat.left || charLeft > plat.right) {
        continue;
      }
      if (prevHeadY <= plat.bottom && headY > plat.bottom) {
        char.positionY = plat.bottom - FP_HEAD_OFFSET;
        char.velocityY = 0;
        break;
      }
    }
  }

  // Side collision: horizontal blocking against platform edges
  const currentFeetY = char.positionY - FP_FEET_OFFSET;
  const currentHeadY = char.positionY + FP_HEAD_OFFSET;
  const prevCharLeft = prevX - FP_CHAR_HALF_WIDTH;
  const prevCharRight = prevX + FP_CHAR_HALF_WIDTH;

  for (const plat of platforms) {
    // Vertical extent must overlap the platform body
    if (currentFeetY >= plat.top || currentHeadY <= plat.bottom) {
      continue;
    }

    // Moving right into left edge of platform
    if (prevCharRight <= plat.left && charRight > plat.left) {
      char.positionX = plat.left - FP_CHAR_HALF_WIDTH;
      char.velocityX = 0;
      char.edgeBumpCount += 1;
    }
    // Moving left into right edge of platform
    if (prevCharLeft >= plat.right && charLeft < plat.right) {
      char.positionX = plat.right + FP_CHAR_HALF_WIDTH;
      char.velocityX = 0;
      char.edgeBumpCount += 1;
    }
  }
}

/**
 * Resolve a joust collision between two characters.
 * All positions are FP integers.
 * Returns { type: 'bounce' | 'kill', winner, loser, winnerIdx, loserIdx, pushDir }
 * or null if no collision.
 */
export function resolveJoust(charA, charB, idxA, idxB, gameMode, numHumanSlots) {
  if (!charA || !charB) {
    return null;
  }

  // Skip if either is dead, materializing, grabbed, invincible, or in joust cooldown
  if (charA.dead || charB.dead) {
    return null;
  }
  if (charA.materializing || charB.materializing) {
    return null;
  }
  if (charA.playerState === 'GRABBED' || charB.playerState === 'GRABBED') {
    return null;
  }
  if (charA.invincible || charB.invincible) {
    return null;
  }
  if (charA.joustCooldown > 0 || charB.joustCooldown > 0) {
    return null;
  }

  // Standard AABB overlap check (FP integers)
  const aLeft = charA.positionX - FP_CHAR_HALF_WIDTH;
  const aRight = charA.positionX + FP_CHAR_HALF_WIDTH;
  const aFeet = charA.positionY - FP_FEET_OFFSET;
  const aHead = charA.positionY + FP_HEAD_OFFSET;

  const bLeft = charB.positionX - FP_CHAR_HALF_WIDTH;
  const bRight = charB.positionX + FP_CHAR_HALF_WIDTH;
  const bFeet = charB.positionY - FP_FEET_OFFSET;
  const bHead = charB.positionY + FP_HEAD_OFFSET;

  let collided = !(aRight < bLeft || aLeft > bRight || aHead < bFeet || aFeet > bHead);

  // Crossing detection: catch tunneling when characters pass through each other
  if (!collided) {
    const prevRelX = charA.prevPositionX - charB.prevPositionX;
    const currRelX = charA.positionX - charB.positionX;
    const signFlipped = (prevRelX > 0 && currRelX < 0) || (prevRelX < 0 && currRelX > 0);

    if (signFlipped) {
      const aDeltaX = Math.abs(charA.positionX - charA.prevPositionX);
      const bDeltaX = Math.abs(charB.positionX - charB.prevPositionX);
      const halfWidth = FP_ORTHO_WIDTH >> 1;
      const noWrap = aDeltaX < halfWidth && bDeltaX < halfWidth;

      if (noWrap) {
        const aMinY = Math.min(charA.positionY, charA.prevPositionY) - FP_FEET_OFFSET;
        const aMaxY = Math.max(charA.positionY, charA.prevPositionY) + FP_HEAD_OFFSET;
        const bMinY = Math.min(charB.positionY, charB.prevPositionY) - FP_FEET_OFFSET;
        const bMaxY = Math.max(charB.positionY, charB.prevPositionY) + FP_HEAD_OFFSET;
        collided = aMaxY > bMinY && aMinY < bMaxY;
      }
    }
  }

  if (!collided) {
    return null;
  }

  const heightDiff = charA.positionY - charB.positionY;
  const pushDir = charA.positionX <= charB.positionX ? -1 : 1;

  // Determine if this should always bounce
  const aIsHuman = idxA < numHumanSlots;
  const bIsHuman = idxB < numHumanSlots;
  const bothEnemies = !aIsHuman && !bIsHuman;
  const bothHumanTeam = aIsHuman && bIsHuman && gameMode === GAME_MODE_TEAM;
  const forceBounce = bothEnemies || bothHumanTeam;

  if (forceBounce || Math.abs(heightDiff) < FP_JOUST_DEADZONE) {
    return { type: 'bounce', charA, charB, idxA, idxB, pushDir };
  }

  // Higher character wins
  const winner = heightDiff > 0 ? charA : charB;
  const loser = heightDiff > 0 ? charB : charA;
  const winnerIdx = heightDiff > 0 ? idxA : idxB;
  const loserIdx = heightDiff > 0 ? idxB : idxA;
  const loserKnockDir = winner.positionX < loser.positionX ? 1 : -1;

  return { type: 'kill', winner, loser, winnerIdx, loserIdx, pushDir: loserKnockDir };
}

/**
 * Apply bounce result to both characters. FP integers. Mutates in place.
 */
export function applyBounce(charA, charB, pushDir) {
  const overlap = FP_CHAR_HALF_WIDTH * 2 - Math.abs(charA.positionX - charB.positionX);
  if (overlap > 0) {
    charA.positionX += pushDir * (overlap >> 1) + pushDir * FP_OVERLAP_PUSH;
    charB.positionX += -pushDir * (overlap >> 1) + -pushDir * FP_OVERLAP_PUSH;
  }

  const bothGrounded = charA.playerState === 'GROUNDED' && charB.playerState === 'GROUNDED';
  if (bothGrounded) {
    charA.velocityX = pushDir * (FP_JOUST_KNOCKBACK_X >> 1);
    charB.velocityX = -pushDir * (FP_JOUST_KNOCKBACK_X >> 1);
  } else {
    charA.velocityX = pushDir * FP_JOUST_KNOCKBACK_X;
    charA.velocityY = FP_JOUST_KNOCKBACK_Y;
    charA.playerState = 'AIRBORNE';
    charA.currentPlatform = null;
    charA.platformIndex = -1;

    charB.velocityX = -pushDir * FP_JOUST_KNOCKBACK_X;
    charB.velocityY = FP_JOUST_KNOCKBACK_Y;
    charB.playerState = 'AIRBORNE';
    charB.currentPlatform = null;
    charB.platformIndex = -1;
  }

  charA.joustCooldown = JOUST_COOLDOWN_FRAMES;
  charB.joustCooldown = JOUST_COOLDOWN_FRAMES;
}

/**
 * Apply kill result to winner. FP integers. Mutates winner in place.
 */
export function applyKillToWinner(winner, loserKnockDir) {
  winner.velocityY = FP_JOUST_KNOCKBACK_Y;
  // 0.3 × knockback recoil, precomputed as FP_KILL_RECOIL_VX
  winner.velocityX = -(loserKnockDir * FP_KILL_RECOIL_VX);
  winner.playerState = 'AIRBORNE';
  winner.currentPlatform = null;
  winner.platformIndex = -1;
}

/**
 * Check if character position is in the lava kill zone. FP integers.
 */
export function checkLavaKill(char, orthoBottomFP) {
  return char.positionY < orthoBottomFP + FP_LAVA_OFFSET;
}

/**
 * Apply screen wrap to character position. FP integers. Mutates in place.
 */
export function applyScreenWrap(char, orthoLeftFP, orthoRightFP) {
  if (char.positionX > orthoRightFP + FP_CHAR_HALF_WIDTH) {
    char.positionX = orthoLeftFP - FP_CHAR_HALF_WIDTH;
  } else if (char.positionX < orthoLeftFP - FP_CHAR_HALF_WIDTH) {
    char.positionX = orthoRightFP + FP_CHAR_HALF_WIDTH;
  }
}

/**
 * Resolve a pterodactyl collision with a player.
 * Pterodactyl is an instant-kill threat — killable only by lancing its open mouth head-on.
 *
 * Returns { type: 'pteroKill' | 'playerKill' | 'bounce', pteroIdx, playerIdx }
 * or null if no collision.
 */
export function resolvePterodactylCollision(ptero, player, pteroIdx, playerIdx, jawOpen) {
  if (!ptero || !player) {
    return null;
  }
  if (ptero.dead || player.dead) {
    return null;
  }
  if (ptero.materializing || player.materializing) {
    return null;
  }
  if (ptero.joustCooldown > 0 || player.joustCooldown > 0) {
    return null;
  }

  // AABB overlap check (pterodactyl uses slightly wider hitbox)
  const pLeft = ptero.positionX - FP_PTERO_HALF_WIDTH;
  const pRight = ptero.positionX + FP_PTERO_HALF_WIDTH;
  const pFeet = ptero.positionY - FP_FEET_OFFSET;
  const pHead = ptero.positionY + FP_HEAD_OFFSET;

  const hLeft = player.positionX - FP_CHAR_HALF_WIDTH;
  const hRight = player.positionX + FP_CHAR_HALF_WIDTH;
  const hFeet = player.positionY - FP_FEET_OFFSET;
  const hHead = player.positionY + FP_HEAD_OFFSET;

  const collided = !(pRight < hLeft || pLeft > hRight || pHead < hFeet || pFeet > hHead);
  if (!collided) {
    return null;
  }

  // Invincible player bounces off
  if (player.invincible) {
    return { type: 'bounce', pteroIdx, playerIdx };
  }

  // Kill check: player kills pterodactyl if facing it AND jaw is open
  const playerFacingPtero = (player.facingDir === 1 && ptero.positionX > player.positionX) ||
                            (player.facingDir === -1 && ptero.positionX < player.positionX);

  if (playerFacingPtero && jawOpen) {
    return { type: 'pteroKill', pteroIdx, playerIdx };
  }

  // Otherwise, pterodactyl kills the player
  return { type: 'playerKill', pteroIdx, playerIdx };
}

/**
 * Check if a player character overlaps an egg (for collection).
 * FP integers. Returns true if overlapping.
 */
export function checkEggCollection(egg, playerChar) {
  if (!playerChar || playerChar.dead || playerChar.materializing) {
    return false;
  }

  const pLeft = playerChar.positionX - FP_CHAR_HALF_WIDTH;
  const pRight = playerChar.positionX + FP_CHAR_HALF_WIDTH;
  const pFeet = playerChar.positionY - FP_FEET_OFFSET;
  const pHead = playerChar.positionY + FP_HEAD_OFFSET;

  const eLeft = egg.positionX - FP_EGG_RADIUS;
  const eRight = egg.positionX + FP_EGG_RADIUS;
  const eBottom = egg.positionY - FP_EGG_RADIUS;
  const eTop = egg.positionY + FP_EGG_RADIUS;

  return pRight > eLeft && pLeft < eRight && pHead > eBottom && pFeet < eTop;
}
