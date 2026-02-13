import assert from 'assert';
import {
  checkPlatformCollisions,
  resolveJoust,
  applyBounce,
  applyKillToWinner,
  checkLavaKill,
  applyScreenWrap,
  checkEggPlatformCollision,
  checkEggCollection,
} from '../physics/CollisionSystem.js';
import {
  FP_CHAR_HALF_WIDTH, FP_FEET_OFFSET, FP_HEAD_OFFSET,
  FP_JOUST_DEADZONE, FP_JOUST_KNOCKBACK_X, FP_JOUST_KNOCKBACK_Y,
  FP_ORTHO_LEFT, FP_ORTHO_RIGHT, FP_EGG_RADIUS, FP_LAVA_OFFSET,
  GAME_MODE_TEAM, GAME_MODE_PVP,
  JOUST_COOLDOWN_FRAMES,
  buildPlatformCollisionDataFP,
} from '../physics/constants.js';
import { toFP } from '../physics/stateLayout.js';

function makeChar(overrides = {}) {
  return {
    positionX: 0,
    positionY: 0,
    velocityX: 0,
    velocityY: 0,
    playerState: 'GROUNDED',
    facingDir: 1,
    dead: false,
    materializing: false,
    invincible: false,
    joustCooldown: 0,
    prevPositionX: 0,
    prevPositionY: 0,
    currentPlatform: null,
    isTurning: false,
    turnTimer: 0,
    ...overrides,
  };
}

function makeEgg(overrides = {}) {
  return {
    positionX: 0,
    positionY: 0,
    velocityX: 0,
    velocityY: 0,
    onPlatform: false,
    bounceCount: 0,
    ...overrides,
  };
}

describe('CollisionSystem', function () {
  const platforms = buildPlatformCollisionDataFP();

  describe('checkPlatformCollisions', function () {
    it('lands character on platform when falling through top', function () {
      const plat = platforms.find(p => p.id === 'top');
      const char = makeChar({
        positionX: ((plat.left + plat.right) / 2) | 0,
        positionY: plat.top + FP_FEET_OFFSET - toFP(0.1), // just below platform top
        velocityY: -toFP(2),
        playerState: 'AIRBORNE',
      });
      const prevX = char.positionX;
      const prevY = plat.top + FP_FEET_OFFSET + toFP(0.1); // was above

      checkPlatformCollisions(char, prevX, prevY, platforms);

      assert.strictEqual(char.playerState, 'GROUNDED');
      assert.strictEqual(char.velocityY, 0);
      assert.strictEqual(char.currentPlatform, plat);
    });

    it('does not land character if moving upward', function () {
      const plat = platforms.find(p => p.id === 'top');
      const char = makeChar({
        positionX: ((plat.left + plat.right) / 2) | 0,
        positionY: plat.top + FP_FEET_OFFSET + toFP(0.5),
        velocityY: toFP(2),
        playerState: 'AIRBORNE',
      });
      const prevX = char.positionX;
      const prevY = plat.top + FP_FEET_OFFSET + toFP(0.1);

      checkPlatformCollisions(char, prevX, prevY, platforms);

      assert.strictEqual(char.playerState, 'AIRBORNE');
    });

    it('bumps head on platform underside when rising', function () {
      const plat = platforms.find(p => p.id === 'top');
      const char = makeChar({
        positionX: ((plat.left + plat.right) / 2) | 0,
        positionY: plat.bottom - FP_HEAD_OFFSET + toFP(0.1), // just past bottom
        velocityY: toFP(3),
        playerState: 'AIRBORNE',
      });
      const prevX = char.positionX;
      const prevY = plat.bottom - FP_HEAD_OFFSET - toFP(0.1); // was below

      checkPlatformCollisions(char, prevX, prevY, platforms);

      assert.strictEqual(char.velocityY, 0);
    });

    it('detects edge fall-off when grounded character walks off platform', function () {
      const plat = platforms.find(p => p.id === 'top');
      const char = makeChar({
        positionX: plat.right + FP_CHAR_HALF_WIDTH + toFP(1), // far past right edge
        positionY: plat.top + FP_FEET_OFFSET,
        playerState: 'GROUNDED',
        currentPlatform: plat,
      });

      checkPlatformCollisions(char, char.positionX, char.positionY, platforms);

      assert.strictEqual(char.playerState, 'AIRBORNE');
      assert.strictEqual(char.currentPlatform, null);
    });
  });

  describe('resolveJoust', function () {
    it('returns null when characters do not overlap', function () {
      const charA = makeChar({ positionX: toFP(-5), positionY: 0 });
      const charB = makeChar({ positionX: toFP(5), positionY: 0 });

      const result = resolveJoust(charA, charB, 0, 4, GAME_MODE_TEAM, 4);

      assert.strictEqual(result, null);
    });

    it('returns null if either character is dead', function () {
      const charA = makeChar({ positionX: 0, positionY: 0, dead: true });
      const charB = makeChar({ positionX: toFP(0.1), positionY: 0 });

      const result = resolveJoust(charA, charB, 0, 4, GAME_MODE_TEAM, 4);

      assert.strictEqual(result, null);
    });

    it('returns null if either character is invincible', function () {
      const charA = makeChar({ positionX: 0, positionY: 0, invincible: true });
      const charB = makeChar({ positionX: toFP(0.1), positionY: 0 });

      const result = resolveJoust(charA, charB, 0, 4, GAME_MODE_TEAM, 4);

      assert.strictEqual(result, null);
    });

    it('returns null if either has joust cooldown', function () {
      const charA = makeChar({ positionX: 0, positionY: 0, joustCooldown: 5 });
      const charB = makeChar({ positionX: toFP(0.1), positionY: 0 });

      const result = resolveJoust(charA, charB, 0, 4, GAME_MODE_TEAM, 4);

      assert.strictEqual(result, null);
    });

    it('bounces when height difference is within deadzone', function () {
      const charA = makeChar({ positionX: 0, positionY: 0 });
      const charB = makeChar({ positionX: toFP(0.1), positionY: (FP_JOUST_DEADZONE * 0.5) | 0 });

      const result = resolveJoust(charA, charB, 0, 4, GAME_MODE_PVP, 4);

      assert.strictEqual(result.type, 'bounce');
    });

    it('kills loser when height difference exceeds deadzone (human vs enemy)', function () {
      const charA = makeChar({ positionX: 0, positionY: toFP(1.0) }); // human, higher
      const charB = makeChar({ positionX: toFP(0.1), positionY: 0 }); // enemy, lower

      const result = resolveJoust(charA, charB, 0, 4, GAME_MODE_TEAM, 4);

      assert.strictEqual(result.type, 'kill');
      assert.strictEqual(result.winner, charA);
      assert.strictEqual(result.loser, charB);
    });

    it('buzzard-buzzard always bounces regardless of height', function () {
      const charA = makeChar({ positionX: 0, positionY: toFP(0.5) }); // enemy slot 4
      const charB = makeChar({ positionX: toFP(0.1), positionY: 0 }); // enemy slot 5

      const result = resolveJoust(charA, charB, 4, 5, GAME_MODE_TEAM, 4);

      assert.strictEqual(result.type, 'bounce');
    });

    it('team play humans always bounce regardless of height', function () {
      const charA = makeChar({ positionX: 0, positionY: toFP(0.5) }); // human slot 0
      const charB = makeChar({ positionX: toFP(0.1), positionY: 0 }); // human slot 1

      const result = resolveJoust(charA, charB, 0, 1, GAME_MODE_TEAM, 4);

      assert.strictEqual(result.type, 'bounce');
    });

    it('PvP humans joust normally — higher wins', function () {
      const charA = makeChar({ positionX: 0, positionY: toFP(0.5) }); // human slot 0, higher
      const charB = makeChar({ positionX: toFP(0.1), positionY: 0 }); // human slot 1, lower

      const result = resolveJoust(charA, charB, 0, 1, GAME_MODE_PVP, 4);

      assert.strictEqual(result.type, 'kill');
      assert.strictEqual(result.winner, charA);
      assert.strictEqual(result.loser, charB);
    });

    it('detects crossing tunneling via sign-flip check', function () {
      const charA = makeChar({
        positionX: toFP(0.5), positionY: 0,
        prevPositionX: toFP(-0.5), prevPositionY: 0,
      });
      const charB = makeChar({
        positionX: toFP(-0.5), positionY: 0,
        prevPositionX: toFP(0.5), prevPositionY: 0,
      });

      const result = resolveJoust(charA, charB, 0, 4, GAME_MODE_TEAM, 4);

      assert.notStrictEqual(result, null);
    });
  });

  describe('applyBounce', function () {
    it('separates overlapping characters and applies knockback', function () {
      const charA = makeChar({ positionX: 0, positionY: toFP(1), playerState: 'AIRBORNE' });
      const charB = makeChar({ positionX: toFP(0.1), positionY: toFP(1), playerState: 'AIRBORNE' });
      const pushDir = -1;

      applyBounce(charA, charB, pushDir);

      assert.ok(charA.velocityX !== 0, 'charA should have knockback velocity');
      assert.ok(charB.velocityX !== 0, 'charB should have knockback velocity');
      assert.strictEqual(charA.joustCooldown, JOUST_COOLDOWN_FRAMES);
      assert.strictEqual(charB.joustCooldown, JOUST_COOLDOWN_FRAMES);
    });

    it('applies reduced ground bounce when both grounded', function () {
      const charA = makeChar({ positionX: 0, positionY: toFP(1), playerState: 'GROUNDED' });
      const charB = makeChar({ positionX: toFP(0.1), positionY: toFP(1), playerState: 'GROUNDED' });
      const pushDir = -1;

      applyBounce(charA, charB, pushDir);

      // Ground bounce gives half knockback, no vertical
      assert.strictEqual(charA.velocityX, pushDir * ((FP_JOUST_KNOCKBACK_X / 2) | 0));
      assert.strictEqual(charA.velocityY, 0);
    });
  });

  describe('applyKillToWinner', function () {
    it('gives winner upward bounce and slight horizontal push', function () {
      const winner = makeChar({ positionX: 0, positionY: toFP(1), playerState: 'GROUNDED' });

      applyKillToWinner(winner, 1);

      assert.strictEqual(winner.velocityY, FP_JOUST_KNOCKBACK_Y);
      assert.strictEqual(winner.playerState, 'AIRBORNE');
      assert.ok(winner.velocityX !== 0);
    });
  });

  describe('checkLavaKill', function () {
    it('returns true when character is in lava zone', function () {
      const orthoBottomFP = toFP(-4.5);
      const char = makeChar({ positionY: orthoBottomFP + FP_LAVA_OFFSET - toFP(1) }); // below lava line
      assert.strictEqual(checkLavaKill(char, orthoBottomFP), true);
    });

    it('returns false when character is above lava zone', function () {
      const orthoBottomFP = toFP(-4.5);
      const char = makeChar({ positionY: orthoBottomFP + FP_LAVA_OFFSET + toFP(1) }); // above lava line
      assert.strictEqual(checkLavaKill(char, orthoBottomFP), false);
    });
  });

  describe('applyScreenWrap', function () {
    it('wraps character from right edge to left edge', function () {
      const char = makeChar({ positionX: FP_ORTHO_RIGHT + FP_CHAR_HALF_WIDTH + toFP(1) });

      applyScreenWrap(char, FP_ORTHO_LEFT, FP_ORTHO_RIGHT);

      assert.strictEqual(char.positionX, FP_ORTHO_LEFT - FP_CHAR_HALF_WIDTH);
    });

    it('wraps character from left edge to right edge', function () {
      const char = makeChar({ positionX: FP_ORTHO_LEFT - FP_CHAR_HALF_WIDTH - toFP(1) });

      applyScreenWrap(char, FP_ORTHO_LEFT, FP_ORTHO_RIGHT);

      assert.strictEqual(char.positionX, FP_ORTHO_RIGHT + FP_CHAR_HALF_WIDTH);
    });

    it('does not wrap character within bounds', function () {
      const char = makeChar({ positionX: toFP(3) });
      const originalX = char.positionX;

      applyScreenWrap(char, FP_ORTHO_LEFT, FP_ORTHO_RIGHT);

      assert.strictEqual(char.positionX, originalX);
    });
  });

  describe('checkEggCollection', function () {
    it('returns true when player overlaps egg', function () {
      const egg = makeEgg({ positionX: 0, positionY: 0 });
      const player = makeChar({ positionX: toFP(0.1), positionY: 0 });

      assert.strictEqual(checkEggCollection(egg, player), true);
    });

    it('returns false when player is far from egg', function () {
      const egg = makeEgg({ positionX: 0, positionY: 0 });
      const player = makeChar({ positionX: toFP(5), positionY: toFP(5) });

      assert.strictEqual(checkEggCollection(egg, player), false);
    });

    it('returns false when player is dead', function () {
      const egg = makeEgg({ positionX: 0, positionY: 0 });
      const player = makeChar({ positionX: toFP(0.1), positionY: 0, dead: true });

      assert.strictEqual(checkEggCollection(egg, player), false);
    });

    it('returns false when player is materializing', function () {
      const egg = makeEgg({ positionX: 0, positionY: 0 });
      const player = makeChar({ positionX: toFP(0.1), positionY: 0, materializing: true });

      assert.strictEqual(checkEggCollection(egg, player), false);
    });

    it('returns false when player is null', function () {
      const egg = makeEgg({ positionX: 0, positionY: 0 });

      assert.strictEqual(checkEggCollection(egg, null), false);
    });
  });
});
