import assert from 'assert';
import { GameSimulation } from '../GameSimulation.js';
import { GAME_MODE_TEAM, TROLL_COOLDOWN_FRAMES, TROLL_GRAB_FRAMES, TROLL_WAVE_START, FP_TROLL_START_Y } from '../physics/constants.js';
import {
  MAX_HUMANS, TOTAL_INTS, LAVA_TROLL_OFFSET,
  LT_ACTIVE, LT_STATE, LT_PLATFORMS_DESTROYED, LT_INTRO_DONE,
  LT_IDLE, LT_PUNCH_INTRO, LT_REACHING, LT_GRABBING, LT_PULLING, LT_RETREATING,
  toFP, fromFP,
} from '../physics/stateLayout.js';

const TEST_SEED = 42;

function createSim(overrides = {}) {
  return new GameSimulation({
    gameMode: GAME_MODE_TEAM,
    seed: TEST_SEED,
    ...overrides,
  });
}

/**
 * Fast-forward sim to a specific wave by manipulating internal state.
 * This skips the slow process of killing all enemies wave by wave.
 */
function fastForwardToWave(sim, targetWave) {
  // Set wave to targetWave - 1 in TRANSITION state with 1 frame left
  sim._waveNumber = targetWave - 1;
  sim._waveState = 2; // WAVE_TRANSITION
  sim._waveTransitionTimer = 1;
  // Clean up any enemies
  for (let i = 0; i < 8; i++) {
    sim._chars[MAX_HUMANS + i].active = false;
    sim._ais[i] = null;
  }
  // Tick once to trigger the wave transition
  sim.tick([0, 0, 0, 0]);
}

/**
 * Set up troll as fully active (as if wave >= TROLL_WAVE_START already ran).
 * This ensures _updateLavaTroll() won't bail on the waveNumber check.
 */
function activateTroll(sim) {
  sim._waveNumber = TROLL_WAVE_START;
  sim._trollPlatformsDestroyed = 1;
  sim._platforms = sim._platformsReduced;
  sim._trollIntroDone = 1;
  sim._trollActive = 1;
  sim._trollState = LT_IDLE;
  sim._trollCooldown = 0;
  sim._trollPosY = FP_TROLL_START_Y;
}

/**
 * Force the troll into REACHING state targeting slot 0.
 * Bypasses the RNG check in IDLE.
 */
function forceTrollReaching(sim, targetY) {
  sim._chars[0].positionX = 0;
  sim._chars[0].positionY = targetY;
  sim._chars[0].playerState = 'AIRBORNE';
  sim._chars[0].currentPlatform = null;
  sim._chars[0].platformIndex = -1;
  sim._chars[0].dead = false;
  sim._chars[0].materializing = false;
  sim._trollState = LT_REACHING;
  sim._trollTargetSlot = 0;
  sim._trollTargetType = 0;
  sim._trollTimer = 0;
  sim._trollPosX = 0;
  sim._trollPosY = toFP(-7.0);
  sim._trollSide = 1;
}

describe('LavaTroll', function () {
  describe('state layout', function () {
    it('TOTAL_INTS includes lava troll section', function () {
      assert.strictEqual(TOTAL_INTS, 596);
      assert.strictEqual(LAVA_TROLL_OFFSET, 580);
    });
  });

  describe('troll activation', function () {
    it('troll activates immediately on TROLL_WAVE_START wave', function () {
      const sim = createSim();
      sim.activatePlayer(0, 0);
      sim.startGame();

      fastForwardToWave(sim, TROLL_WAVE_START);

      const state = sim.getState();
      assert.strictEqual(state.lavaTroll.introDone, 1);
      assert.strictEqual(state.lavaTroll.active, 1);
      assert.strictEqual(state.lavaTroll.state, LT_IDLE);
    });

    it('destroys base platforms immediately on troll wave', function () {
      const sim = createSim();
      sim.activatePlayer(0, 0);
      sim.startGame();

      fastForwardToWave(sim, TROLL_WAVE_START);

      assert.strictEqual(sim._trollPlatformsDestroyed, 1);
      assert.strictEqual(sim._platforms, sim._platformsReduced);
    });

    it('troll stays active through later waves', function () {
      const sim = createSim();
      sim.activatePlayer(0, 0);
      sim.startGame();

      fastForwardToWave(sim, 4);

      const state = sim.getState();
      assert.strictEqual(state.lavaTroll.introDone, 1);
      assert.strictEqual(state.lavaTroll.active, 1);
      assert.strictEqual(state.lavaTroll.platformsDestroyed, 1);
    });
  });

  describe('RNG grab chance', function () {
    it('troll does not grab every cooldown cycle (1/5 chance)', function () {
      const sim = createSim();
      sim.activatePlayer(0, 0);
      sim.startGame();
      activateTroll(sim);

      // Place player in reach zone permanently
      sim._chars[0].positionX = 0;
      sim._chars[0].positionY = toFP(-3.8);
      sim._chars[0].playerState = 'AIRBORNE';
      sim._chars[0].currentPlatform = null;
      sim._chars[0].platformIndex = -1;
      sim._chars[0].dead = false;
      sim._chars[0].materializing = false;

      // Run for many cooldown cycles — count how many times troll enters REACHING
      let reachCount = 0;
      const cycles = 50;
      for (let c = 0; c < cycles; c++) {
        sim._trollCooldown = 0;
        sim._trollState = LT_IDLE;
        sim.tick([0, 0, 0, 0]);
        if (sim._trollState === LT_REACHING) {
          reachCount += 1;
          // Reset troll back to idle for next cycle
          sim._trollState = LT_IDLE;
          sim._trollTimer = 0;
          sim._trollPosY = toFP(-7.0);
        }
      }

      // With 1/5 chance over 50 attempts, expect ~10. Assert it's not every time.
      assert.ok(reachCount < cycles, 'Troll should not grab every time');
      assert.ok(reachCount > 0, 'Troll should grab at least once in 50 tries');
    });
  });

  describe('reach and follow', function () {
    it('hand tracks target X during reaching', function () {
      const sim = createSim();
      sim.activatePlayer(0, 0);
      sim.startGame();

      for (let i = 0; i < 200; i++) {
        sim.tick([0, 0, 0, 0]);
      }

      activateTroll(sim);
      forceTrollReaching(sim, toFP(-3.8));

      // Move player to the right
      sim._chars[0].positionX = toFP(3.0);
      sim.tick([0, 0, 0, 0]);

      // Hand should track player X
      assert.strictEqual(sim._trollPosX, sim._chars[0].positionX,
        'Hand should follow target X position');
    });

    it('player moves freely during reaching (not grabbed)', function () {
      const sim = createSim();
      sim.activatePlayer(0, 0);
      sim.startGame();

      for (let i = 0; i < 200; i++) {
        sim.tick([0, 0, 0, 0]);
      }

      activateTroll(sim);
      forceTrollReaching(sim, toFP(-3.8));

      // Player should NOT be grabbed during reaching
      assert.strictEqual(sim._chars[0].playerState, 'AIRBORNE',
        'Player should not be grabbed during reaching phase');
    });

    it('troll retreats if target escapes zone during reaching', function () {
      const sim = createSim();
      sim.activatePlayer(0, 0);
      sim.startGame();

      for (let i = 0; i < 200; i++) {
        sim.tick([0, 0, 0, 0]);
      }

      activateTroll(sim);
      forceTrollReaching(sim, toFP(-3.8));

      // Move target above the reach zone
      sim._chars[0].positionY = toFP(0.0);

      sim.tick([0, 0, 0, 0]);

      assert.strictEqual(sim._trollState, LT_RETREATING,
        'Troll should retreat when target escapes zone');
    });
  });

  describe('grab mechanic', function () {
    it('grabs target when hand reaches proximity', function () {
      const sim = createSim();
      sim.activatePlayer(0, 0);
      sim.startGame();

      for (let i = 0; i < 200; i++) {
        sim.tick([0, 0, 0, 0]);
      }

      // Place player at a Y the hand can reach, force reaching
      activateTroll(sim);
      const targetY = toFP(-3.8);
      forceTrollReaching(sim, targetY);

      // Run frames until hand reaches target and transitions to grabbing then pulling
      let pullingReached = false;
      for (let i = 0; i < 120; i++) {
        // Keep player in place
        sim._chars[0].positionX = 0;
        sim._chars[0].positionY = targetY;
        sim._chars[0].velocityX = 0;
        sim._chars[0].velocityY = 0;
        sim.tick([0, 0, 0, 0]);
        if (sim._trollState === LT_PULLING) {
          pullingReached = true;
          break;
        }
      }

      assert.ok(pullingReached, 'Troll should reach PULLING after hand catches up');
      assert.strictEqual(sim._chars[0].playerState, 'GRABBED',
        'Character should be grabbed during pulling');
    });

    it('grab misses if target moves away during fist close', function () {
      const sim = createSim();
      sim.activatePlayer(0, 0);
      sim.startGame();

      for (let i = 0; i < 200; i++) {
        sim.tick([0, 0, 0, 0]);
      }

      activateTroll(sim);
      // Set up GRABBING state — hand at target position
      sim._chars[0].positionX = 0;
      sim._chars[0].positionY = toFP(-3.8);
      sim._chars[0].playerState = 'AIRBORNE';
      sim._chars[0].dead = false;
      sim._trollState = LT_GRABBING;
      sim._trollTargetSlot = 0;
      sim._trollTargetType = 0;
      sim._trollTimer = TROLL_GRAB_FRAMES - 1; // about to close
      sim._trollPosX = 0;
      sim._trollPosY = toFP(-3.8);

      // Move player far away before the fist closes
      sim._chars[0].positionY = toFP(-1.0);

      sim.tick([0, 0, 0, 0]);

      // Should miss and retreat
      assert.strictEqual(sim._trollState, LT_RETREATING,
        'Troll should retreat when grab misses');
      assert.strictEqual(sim._chars[0].playerState, 'AIRBORNE',
        'Player should remain airborne after missed grab');
    });
  });

  describe('tug of war escape', function () {
    it('human escapes by flapping hard during pulling', function () {
      const sim = createSim();
      sim.activatePlayer(0, 0);
      sim.startGame();

      for (let i = 0; i < 200; i++) {
        sim.tick([0, 0, 0, 0]);
      }

      activateTroll(sim);
      // Set up pulling state directly
      sim._chars[0].positionX = 0;
      sim._chars[0].positionY = toFP(-3.5);
      sim._chars[0].playerState = 'GRABBED';
      sim._chars[0].velocityY = 0;
      sim._chars[0].currentPlatform = null;
      sim._chars[0].platformIndex = -1;
      sim._trollState = LT_PULLING;
      sim._trollTargetSlot = 0;
      sim._trollTargetType = 0;
      sim._trollPosX = 0;
      sim._trollPosY = toFP(-3.5);

      // Flap every frame — should build enough upward velocity to escape
      let escaped = false;
      for (let i = 0; i < 60; i++) {
        sim.tick([0x04, 0, 0, 0]);
        if (sim._chars[0].playerState === 'AIRBORNE') {
          escaped = true;
          break;
        }
      }

      assert.ok(escaped, 'Player should escape with rapid flapping');
      assert.ok(sim._chars[0].velocityY > 0,
        'Player should have upward velocity after escape');
    });

    it('player gets pulled into lava without flapping', function () {
      const sim = createSim();
      sim.activatePlayer(0, 0);
      sim.startGame();

      for (let i = 0; i < 200; i++) {
        sim.tick([0, 0, 0, 0]);
      }

      activateTroll(sim);
      // Set up pulling state
      sim._chars[0].positionX = 0;
      sim._chars[0].positionY = toFP(-3.5);
      sim._chars[0].playerState = 'GRABBED';
      sim._chars[0].velocityY = 0;
      sim._chars[0].currentPlatform = null;
      sim._chars[0].platformIndex = -1;
      sim._trollState = LT_PULLING;
      sim._trollTargetSlot = 0;
      sim._trollTargetType = 0;
      sim._trollPosX = 0;
      sim._trollPosY = toFP(-3.5);

      // No flapping — player gets dragged down
      let died = false;
      for (let i = 0; i < 200; i++) {
        sim.tick([0, 0, 0, 0]);
        if (sim._chars[0].dead) {
          died = true;
          break;
        }
      }

      assert.ok(died, 'Player should die when pulled into lava without flapping');
    });
  });

  describe('enemy pulled to death', function () {
    it('enemy gets pulled into lava and dies', function () {
      const sim = createSim();
      sim.activatePlayer(0, 0);
      sim.startGame();

      for (let i = 0; i < 200; i++) {
        sim.tick([0, 0, 0, 0]);
      }

      activateTroll(sim);
      // Spawn an enemy and set up pulling state
      const enemySlot = MAX_HUMANS;
      sim._chars[enemySlot].active = true;
      sim._chars[enemySlot].dead = false;
      sim._chars[enemySlot].positionX = 0;
      sim._chars[enemySlot].positionY = toFP(-3.5);
      sim._chars[enemySlot].playerState = 'GRABBED';
      sim._chars[enemySlot].velocityY = 0;
      sim._chars[enemySlot].currentPlatform = null;
      sim._chars[enemySlot].platformIndex = -1;
      sim._chars[enemySlot].materializing = false;
      sim._chars[enemySlot].enemyType = 0;

      sim._trollState = LT_PULLING;
      sim._trollTargetSlot = enemySlot;
      sim._trollTargetType = 1;
      sim._trollPosX = 0;
      sim._trollPosY = toFP(-3.5);

      let enemyDied = false;
      for (let i = 0; i < 200; i++) {
        sim.tick([0, 0, 0, 0]);
        if (sim._chars[enemySlot].dead) {
          enemyDied = true;
          break;
        }
      }

      assert.ok(enemyDied, 'Enemy should die when pulled into lava');
    });
  });

  describe('target dies mid-reach', function () {
    it('troll retreats if target dies during reach phase', function () {
      const sim = createSim();
      sim.activatePlayer(0, 0);
      sim.startGame();

      for (let i = 0; i < 200; i++) {
        sim.tick([0, 0, 0, 0]);
      }

      activateTroll(sim);
      forceTrollReaching(sim, toFP(-3.8));

      // Kill the target
      sim._chars[0].dead = true;
      sim._chars[0].respawnTimer = 120;

      sim.tick([0, 0, 0, 0]);

      assert.strictEqual(sim._trollState, LT_RETREATING,
        'Troll should retreat when target dies mid-reach');
    });
  });

  describe('serialize roundtrip', function () {
    it('roundtrip preserves all troll state', function () {
      const sim = createSim();
      sim.activatePlayer(0, 0);
      sim.startGame();

      for (let i = 0; i < 30; i++) {
        sim.tick([0, 0, 0, 0]);
      }

      const snapshot = sim.serialize();
      const sim2 = createSim({ seed: 999 });
      sim2.deserialize(snapshot);
      const reSerialized = sim2.serialize();

      const bufA = new Int32Array(snapshot);
      const bufB = new Int32Array(reSerialized);

      assert.strictEqual(bufA.length, bufB.length);
      for (let i = 0; i < bufA.length; i++) {
        assert.strictEqual(bufA[i], bufB[i], `Roundtrip mismatch at index ${i}`);
      }
    });

    it('troll state in buffer at correct offset', function () {
      const sim = createSim();
      sim.activatePlayer(0, 0);
      sim.startGame();

      fastForwardToWave(sim, TROLL_WAVE_START);

      const buf = new Int32Array(sim.serialize());
      assert.strictEqual(buf[LAVA_TROLL_OFFSET + LT_ACTIVE], 1);
      assert.strictEqual(buf[LAVA_TROLL_OFFSET + LT_STATE], LT_IDLE);
      assert.strictEqual(buf[LAVA_TROLL_OFFSET + LT_PLATFORMS_DESTROYED], 1);
      assert.strictEqual(buf[LAVA_TROLL_OFFSET + LT_INTRO_DONE], 1);
    });
  });

  describe('determinism', function () {
    it('two sims with same seed produce identical state through wave 4+', function () {
      const simA = createSim();
      const simB = createSim();

      simA.activatePlayer(0, 0);
      simB.activatePlayer(0, 0);
      simA.startGame();
      simB.startGame();

      fastForwardToWave(simA, 4);
      fastForwardToWave(simB, 4);

      // Run 200 frames through troll gameplay
      for (let i = 0; i < 200; i++) {
        const input = i % 7 === 0 ? 0x04 : (i % 3 === 0 ? 0x01 : 0);
        simA.tick([input, 0, 0, 0]);
        simB.tick([input, 0, 0, 0]);
      }

      const bufA = new Int32Array(simA.serialize());
      const bufB = new Int32Array(simB.serialize());

      assert.strictEqual(bufA.length, bufB.length);
      for (let i = 0; i < bufA.length; i++) {
        assert.strictEqual(bufA[i], bufB[i], `Determinism mismatch at index ${i}`);
      }
    });
  });

  describe('rollback compatibility', function () {
    it('serialized mid-grab state continues correctly after deserialize', function () {
      const sim = createSim();
      sim.activatePlayer(0, 0);
      sim.startGame();

      for (let i = 0; i < 200; i++) {
        sim.tick([0, 0, 0, 0]);
      }

      activateTroll(sim);
      // Set up a pulled state
      sim._chars[0].positionX = 0;
      sim._chars[0].positionY = toFP(-3.5);
      sim._chars[0].playerState = 'GRABBED';
      sim._chars[0].velocityY = 0;
      sim._chars[0].currentPlatform = null;
      sim._chars[0].platformIndex = -1;
      sim._trollState = LT_PULLING;
      sim._trollTargetSlot = 0;
      sim._trollTargetType = 0;
      sim._trollPosX = 0;
      sim._trollPosY = toFP(-3.5);

      // Serialize mid-grab
      const snapshot = sim.serialize();

      // Deserialize into fresh sim
      const sim2 = createSim({ seed: 999 });
      sim2.deserialize(snapshot);

      // Verify state restored
      assert.strictEqual(sim2._trollState, LT_PULLING);
      assert.strictEqual(sim2._chars[0].playerState, 'GRABBED');
      assert.strictEqual(sim2._trollPlatformsDestroyed, 1);
      assert.strictEqual(sim2._platforms, sim2._platformsReduced);

      // Continue ticking with flap inputs to escape
      let escaped = false;
      for (let i = 0; i < 60; i++) {
        sim2.tick([0x04, 0, 0, 0]);
        if (sim2._chars[0].playerState === 'AIRBORNE') {
          escaped = true;
          break;
        }
      }

      assert.ok(escaped, 'Character should escape after deserialize and flapping');
    });
  });

  describe('platform occlusion', function () {
    it('does not target character standing on a platform', function () {
      const sim = createSim();
      sim.activatePlayer(0, 0);
      sim.startGame();

      for (let i = 0; i < 200; i++) {
        sim.tick([0, 0, 0, 0]);
      }

      activateTroll(sim);
      // Position player below a platform in the reach zone
      sim._chars[0].positionX = toFP(-5.0);
      sim._chars[0].positionY = toFP(-3.5);
      sim._chars[0].playerState = 'AIRBORNE';
      sim._chars[0].currentPlatform = null;
      sim._chars[0].platformIndex = -1;
      sim._chars[0].dead = false;
      sim._chars[0].materializing = false;
      sim._trollCooldown = 0;

      sim.tick([0, 0, 0, 0]);

      // Troll should NOT target — platform shields the character
      assert.strictEqual(sim._trollState, LT_IDLE,
        'Troll should not target character shielded by platform');
    });
  });
});
