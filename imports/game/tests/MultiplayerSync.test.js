// Multiplayer desync detection test.
// Simulates two human players connected via in-memory mock transport with
// realistic network delay, driving both through the rollback pipeline and
// verifying state stays in sync.

import assert from 'assert';
import { GameSimulation } from '../GameSimulation.js';
import { RollbackSession } from '../../netcode/RollbackSession.js';
import { DeterministicRNG } from '../physics/mulberry32.js';
import { GAME_MODE_TEAM } from '../physics/constants.js';
import {
  TOTAL_INTS, GLOBAL_OFFSET, GLOBAL_SIZE,
  HUMANS_OFFSET, ENEMIES_OFFSET, ENEMY_AI_OFFSET, EGGS_OFFSET,
  CHAR_SIZE, AI_SIZE, EGG_SIZE,
  MAX_HUMANS, MAX_ENEMIES, MAX_EGGS,
  G_FRAME, G_RNG_SEED, G_WAVE_NUMBER, G_WAVE_STATE,
  C_ACTIVE, C_POS_X, C_POS_Y, C_VEL_X, C_VEL_Y,
  C_SCORE, C_LIVES, C_DEAD, C_STATE,
  E_ACTIVE, E_POS_X, E_POS_Y,
  fromFP,
} from '../physics/stateLayout.js';

const ORTHO_BOTTOM = -5.2;
const ORTHO_TOP = 5.2;
const GAME_SEED = 42;
const NUM_PLAYERS = 4;
const INPUT_DELAY = 2;
const AUTO_INPUT_SLOTS = new Set([2, 3]);
const CHECK_INTERVAL = 600; // 10 seconds at 60fps
const INPUT_REDUNDANCY = 5;

// ---- MockNetwork ----
// FIFO queue with per-message 1-2 frame delivery delay (via its own PRNG).
// Supports optional packet loss via dropRate (0.0-1.0).

class MockNetwork {
  constructor(seed, options = {}) {
    this._rng = new DeterministicRNG(seed);
    this._queue = [];
    this._dropRate = options.dropRate || 0;
    this._dropRng = options.dropRate ? new DeterministicRNG(seed + 999) : null;
    this._maxDelay = options.maxDelay || 2;
  }

  send(currentTick, frame, input) {
    if (this._dropRate > 0 && this._dropRng.nextInt(1000) < this._dropRate * 1000) {
      return; // packet dropped
    }
    const delay = 1 + this._rng.nextInt(this._maxDelay); // 1 to maxDelay frames
    this._queue.push({ deliveryTick: currentTick + delay, frame, input });
  }

  // Send a batch of inputs as a single packet (for redundancy).
  // The entire batch is either delivered or dropped together.
  sendBatch(currentTick, inputs) {
    if (this._dropRate > 0 && this._dropRng.nextInt(1000) < this._dropRate * 1000) {
      return; // packet dropped
    }
    const delay = 1 + this._rng.nextInt(this._maxDelay);
    for (const inp of inputs) {
      this._queue.push({ deliveryTick: currentTick + delay, frame: inp.frame, input: inp.input });
    }
  }

  receive(currentTick) {
    const ready = [];
    const pending = [];
    for (const msg of this._queue) {
      if (msg.deliveryTick <= currentTick) {
        ready.push(msg);
      } else {
        pending.push(msg);
      }
    }
    this._queue = pending;
    return ready;
  }
}

// ---- Input generation ----
// Produces a realistic mix of inputs using a per-player deterministic RNG.
// 0x01=left, 0x02=right, 0x04=flap

function generateInput(rng) {
  const roll = rng.nextInt(100);
  let input = 0;
  if (roll < 15) {
    input = 0;          // idle (15%)
  } else if (roll < 30) {
    input = 0x01;       // left (15%)
  } else if (roll < 45) {
    input = 0x02;       // right (15%)
  } else if (roll < 60) {
    input = 0x04;       // flap (15%)
  } else if (roll < 72) {
    input = 0x05;       // flap + left (12%)
  } else if (roll < 84) {
    input = 0x06;       // flap + right (12%)
  } else if (roll < 92) {
    input = 0x03;       // left + right (8%)
  } else {
    input = 0x07;       // all (8%)
  }
  return input;
}

// ---- State description utilities ----

const GLOBAL_FIELD_NAMES = [
  'FRAME', 'RNG_SEED', 'WAVE_NUMBER', 'WAVE_STATE', 'SPAWN_TIMER',
  'WAVE_TRANSITION_TIMER', 'GAME_MODE', 'GAME_OVER', 'SPAWN_QUEUE_LEN',
  'SPAWN[0]', 'SPAWN[1]', 'SPAWN[2]', 'SPAWN[3]', 'SPAWN[4]',
  'SPAWN[5]', 'SPAWN[6]', 'SPAWN[7]', 'SPAWN[8]', 'SPAWN[9]',
];

const CHAR_FIELD_NAMES = [
  'ACTIVE', 'POS_X', 'POS_Y', 'VEL_X', 'VEL_Y', 'STATE',
  'FACING_DIR', 'IS_TURNING', 'TURN_TIMER', 'STRIDE_PHASE',
  'IS_FLAPPING', 'FLAP_TIMER', 'DEAD', 'RESPAWN_TIMER',
  'INVINCIBLE', 'INVINCIBLE_TIMER', 'JOUST_COOLDOWN',
  'MATERIALIZING', 'MATERIALIZE_TIMER', 'MATERIALIZE_DURATION',
  'MATERIALIZE_QUICK_END', 'SCORE', 'LIVES', 'EGGS_COLLECTED',
  'PREV_POS_X', 'PREV_POS_Y', 'NEXT_LIFE_SCORE', 'PALETTE_INDEX',
  'PLAYER_DIED_WAVE', 'ENEMY_TYPE', 'HIT_LAVA', 'PLATFORM_INDEX',
];

const AI_FIELD_NAMES = ['DIR_TIMER', 'CURRENT_DIR', 'FLAP_ACCUM', 'ENEMY_TYPE'];

const EGG_FIELD_NAMES = [
  'ACTIVE', 'POS_X', 'POS_Y', 'VEL_X', 'VEL_Y', 'ON_PLATFORM',
  'ENEMY_TYPE', 'HATCH_STATE', 'HATCH_TIMER', 'BOUNCE_COUNT',
  'PREV_POS_Y', 'HIT_LAVA',
];

function describeStateIndex(index) {
  if (index < HUMANS_OFFSET) {
    const field = index - GLOBAL_OFFSET;
    return `GLOBAL.${GLOBAL_FIELD_NAMES[field] || `field_${field}`}`;
  }
  if (index < ENEMIES_OFFSET) {
    const rel = index - HUMANS_OFFSET;
    const slot = Math.floor(rel / CHAR_SIZE);
    const field = rel % CHAR_SIZE;
    return `HUMAN[${slot}].${CHAR_FIELD_NAMES[field] || `field_${field}`}`;
  }
  if (index < ENEMY_AI_OFFSET) {
    const rel = index - ENEMIES_OFFSET;
    const slot = Math.floor(rel / CHAR_SIZE);
    const field = rel % CHAR_SIZE;
    return `ENEMY[${slot}].${CHAR_FIELD_NAMES[field] || `field_${field}`}`;
  }
  if (index < EGGS_OFFSET) {
    const rel = index - ENEMY_AI_OFFSET;
    const slot = Math.floor(rel / AI_SIZE);
    const field = rel % AI_SIZE;
    return `AI[${slot}].${AI_FIELD_NAMES[field] || `field_${field}`}`;
  }
  const rel = index - EGGS_OFFSET;
  const slot = Math.floor(rel / EGG_SIZE);
  const field = rel % EGG_SIZE;
  return `EGG[${slot}].${EGG_FIELD_NAMES[field] || `field_${field}`}`;
}

// Compare two serialized state buffers and return a diagnostic report (or null if in sync).

function compareStates(bufA, bufB, label) {
  const diffs = [];
  for (let i = 0; i < bufA.length; i++) {
    if (bufA[i] !== bufB[i]) {
      diffs.push({ index: i, name: describeStateIndex(i), a: bufA[i], b: bufB[i] });
    }
  }

  if (diffs.length === 0) {
    return null;
  }

  const lines = [`DESYNC at ${label} — ${diffs.length} field(s) differ`];
  lines.push('');

  // Global state
  lines.push('=== Global State ===');
  lines.push(`  Frame:   A=${bufA[GLOBAL_OFFSET + G_FRAME]}, B=${bufB[GLOBAL_OFFSET + G_FRAME]}`);
  lines.push(`  RNG:     A=${bufA[GLOBAL_OFFSET + G_RNG_SEED] >>> 0}, B=${bufB[GLOBAL_OFFSET + G_RNG_SEED] >>> 0}`);
  lines.push(`  Wave:    A=${bufA[GLOBAL_OFFSET + G_WAVE_NUMBER]}, B=${bufB[GLOBAL_OFFSET + G_WAVE_NUMBER]}`);
  lines.push(`  WaveSt:  A=${bufA[GLOBAL_OFFSET + G_WAVE_STATE]}, B=${bufB[GLOBAL_OFFSET + G_WAVE_STATE]}`);
  lines.push('');

  // Human players
  lines.push('=== Human Players ===');
  for (let i = 0; i < MAX_HUMANS; i++) {
    const o = HUMANS_OFFSET + i * CHAR_SIZE;
    if (bufA[o + C_ACTIVE] || bufB[o + C_ACTIVE]) {
      lines.push(`  P${i}: A(pos=${fromFP(bufA[o + C_POS_X]).toFixed(1)},${fromFP(bufA[o + C_POS_Y]).toFixed(1)} vel=${fromFP(bufA[o + C_VEL_X]).toFixed(1)},${fromFP(bufA[o + C_VEL_Y]).toFixed(1)} score=${bufA[o + C_SCORE]} lives=${bufA[o + C_LIVES]} dead=${bufA[o + C_DEAD]})`);
      lines.push(`      B(pos=${fromFP(bufB[o + C_POS_X]).toFixed(1)},${fromFP(bufB[o + C_POS_Y]).toFixed(1)} vel=${fromFP(bufB[o + C_VEL_X]).toFixed(1)},${fromFP(bufB[o + C_VEL_Y]).toFixed(1)} score=${bufB[o + C_SCORE]} lives=${bufB[o + C_LIVES]} dead=${bufB[o + C_DEAD]})`);
    }
  }
  lines.push('');

  // Active enemies
  lines.push('=== Active Enemies ===');
  for (let i = 0; i < MAX_ENEMIES; i++) {
    const o = ENEMIES_OFFSET + i * CHAR_SIZE;
    if (bufA[o + C_ACTIVE] || bufB[o + C_ACTIVE]) {
      lines.push(`  E${i}: A(pos=${fromFP(bufA[o + C_POS_X]).toFixed(1)},${fromFP(bufA[o + C_POS_Y]).toFixed(1)} dead=${bufA[o + C_DEAD]}) B(pos=${fromFP(bufB[o + C_POS_X]).toFixed(1)},${fromFP(bufB[o + C_POS_Y]).toFixed(1)} dead=${bufB[o + C_DEAD]})`);
    }
  }
  lines.push('');

  // Active eggs
  lines.push('=== Active Eggs ===');
  for (let i = 0; i < MAX_EGGS; i++) {
    const o = EGGS_OFFSET + i * EGG_SIZE;
    if (bufA[o + E_ACTIVE] || bufB[o + E_ACTIVE]) {
      lines.push(`  Egg${i}: A(pos=${fromFP(bufA[o + E_POS_X]).toFixed(1)},${fromFP(bufA[o + E_POS_Y]).toFixed(1)}) B(pos=${fromFP(bufB[o + E_POS_X]).toFixed(1)},${fromFP(bufB[o + E_POS_Y]).toFixed(1)})`);
    }
  }
  lines.push('');

  // Field-level diffs (capped at 30)
  lines.push('=== Differing Fields ===');
  const shown = Math.min(diffs.length, 30);
  for (let i = 0; i < shown; i++) {
    const d = diffs[i];
    lines.push(`  [${d.index}] ${d.name}: A=${d.a} B=${d.b}`);
  }
  if (diffs.length > 30) {
    lines.push(`  ... and ${diffs.length - 30} more`);
  }

  return lines.join('\n');
}

// ---- Request processor ----
// Mirrors GameLoop._tick(): handles SaveGameState, LoadGameState, AdvanceFrame.

function processRequests(sim, requests, inputLog) {
  for (const req of requests) {
    switch (req.type) {
      case 'SaveGameState':
        req.cell.save(sim.serialize());
        break;
      case 'LoadGameState':
        sim.deserialize(req.cell.load());
        break;
      case 'AdvanceFrame':
        if (inputLog) {
          // Record the final inputs used for each frame (post-rollback overwrites earlier entries)
          inputLog.set(sim._frame, req.inputs.slice());
        }
        sim.tick(req.inputs);
        break;
    }
  }
}

// ---- Factories ----

function createSession(localPlayerIndex, startFrame = 0) {
  return new RollbackSession({
    numPlayers: NUM_PLAYERS,
    localPlayerIndex,
    inputDelay: INPUT_DELAY,
    autoInputSlots: new Set(AUTO_INPUT_SLOTS),
    maxPredictionWindow: 8,
    disconnectTimeout: 60000, // large to prevent spurious disconnects
    startFrame,
  });
}

function createSim() {
  return new GameSimulation({
    gameMode: GAME_MODE_TEAM,
    seed: GAME_SEED,
    orthoBottom: ORTHO_BOTTOM,
    orthoTop: ORTHO_TOP,
  });
}

// ---- Main test harness ----

function runMultiplayerSyncTest(totalFrames, options = {}) {
  const { dropRate = 0, useRedundancy = false, maxDelay = 2, drainFrames = 0 } = options;

  // Two complete game stacks
  const simA = createSim();
  const simB = createSim();
  const sessionA = createSession(0);
  const sessionB = createSession(1);

  // Pre-synchronize: skip handshake, mark all peers as connected and synced
  for (let i = 0; i < NUM_PLAYERS; i++) {
    sessionA.setPeerConnected(i, true);
    sessionB.setPeerConnected(i, true);
    sessionA.peerSynchronized[i] = true;
    sessionB.peerSynchronized[i] = true;
  }
  sessionA.running = true;
  sessionB.running = true;

  // Initialize games identically
  simA.activatePlayer(0, 0);
  simA.activatePlayer(1, 1);
  simB.activatePlayer(0, 0);
  simB.activatePlayer(1, 1);
  simA.startGame();
  simB.startGame();

  // Mock networks with independent delay RNGs
  const netAtoB = new MockNetwork(300, { dropRate, maxDelay });
  const netBtoA = new MockNetwork(400, { dropRate, maxDelay });

  // Per-player input RNGs
  const rngP0 = new DeterministicRNG(100);
  const rngP1 = new DeterministicRNG(200);

  // Input history for redundancy
  const historyA = [];
  const historyB = [];

  let desyncReport = null;

  for (let tick = 0; tick < totalFrames; tick++) {
    // 1. Deliver delayed inputs from mock network
    const msgsForA = netBtoA.receive(tick);
    for (const msg of msgsForA) {
      sessionA.addRemoteInput(1, msg.frame, msg.input);
      sessionA.peerLastRecvTime[1] = Date.now();
    }

    const msgsForB = netAtoB.receive(tick);
    for (const msg of msgsForB) {
      sessionB.addRemoteInput(0, msg.frame, msg.input);
      sessionB.peerLastRecvTime[0] = Date.now();
    }

    // 2. Generate local inputs
    const inputP0 = generateInput(rngP0);
    const inputP1 = generateInput(rngP1);

    // 3. Feed inputs to sessions and advance
    sessionA.addLocalInput(inputP0);
    const reqsA = sessionA.advanceFrame();
    processRequests(simA, reqsA);

    sessionB.addLocalInput(inputP1);
    const reqsB = sessionB.advanceFrame();
    processRequests(simB, reqsB);

    // 4. Send local inputs over network
    const localA = sessionA.getLocalInput();
    if (localA) {
      if (useRedundancy) {
        historyA.push({ frame: localA.frame, input: localA.input });
        if (historyA.length > INPUT_REDUNDANCY) {
          historyA.shift();
        }
        netAtoB.sendBatch(tick, historyA);
      } else {
        netAtoB.send(tick, localA.frame, localA.input);
      }
    }

    const localB = sessionB.getLocalInput();
    if (localB) {
      if (useRedundancy) {
        historyB.push({ frame: localB.frame, input: localB.input });
        if (historyB.length > INPUT_REDUNDANCY) {
          historyB.shift();
        }
        netBtoA.sendBatch(tick, historyB);
      } else {
        netBtoA.send(tick, localB.frame, localB.input);
      }
    }

    // 5. Drain events to prevent queue buildup
    sessionA.pollEvents();
    sessionB.pollEvents();

    // 6. Periodic state comparison (skipped when drain phase is used,
    //    since high-delay configs can have transient prediction disagreements)
    if (drainFrames === 0 && (tick + 1) % CHECK_INTERVAL === 0) {
      const bufA = new Int32Array(simA.serialize());
      const bufB = new Int32Array(simB.serialize());
      const report = compareStates(bufA, bufB, `tick ${tick + 1} (frame ${bufA[G_FRAME]})`);
      if (report) {
        desyncReport = report;
        break;
      }
    }
  }

  // Drain phase: continue delivering in-flight inputs and processing rollbacks
  // without generating new inputs. This lets all delayed packets arrive so the
  // final comparison reflects fully-converged state.
  if (!desyncReport && drainFrames > 0) {
    for (let d = 0; d < drainFrames; d++) {
      const drainTick = totalFrames + d;

      const msgsForA = netBtoA.receive(drainTick);
      for (const msg of msgsForA) {
        sessionA.addRemoteInput(1, msg.frame, msg.input);
        sessionA.peerLastRecvTime[1] = Date.now();
      }

      const msgsForB = netAtoB.receive(drainTick);
      for (const msg of msgsForB) {
        sessionB.addRemoteInput(0, msg.frame, msg.input);
        sessionB.peerLastRecvTime[0] = Date.now();
      }

      // Feed idle inputs (0) so sessions can still advance and process rollbacks
      sessionA.addLocalInput(0);
      const reqsA = sessionA.advanceFrame();
      processRequests(simA, reqsA);

      sessionB.addLocalInput(0);
      const reqsB = sessionB.advanceFrame();
      processRequests(simB, reqsB);

      // Still send local inputs during drain so the remote side can confirm
      const localA = sessionA.getLocalInput();
      if (localA) {
        netAtoB.send(drainTick, localA.frame, localA.input);
      }

      const localB = sessionB.getLocalInput();
      if (localB) {
        netBtoA.send(drainTick, localB.frame, localB.input);
      }

      sessionA.pollEvents();
      sessionB.pollEvents();
    }
  }

  // Final comparison
  if (!desyncReport) {
    const bufA = new Int32Array(simA.serialize());
    const bufB = new Int32Array(simB.serialize());
    desyncReport = compareStates(bufA, bufB, `final (tick ${totalFrames + drainFrames}, frame ${bufA[G_FRAME]})`);
  }

  return desyncReport;
}

// ---- Staggered join test harness ----
// Player 0 runs solo for soloFrames, then player 1 joins via state sync.

function runStaggeredJoinSyncTest(soloFrames, multiplayerFrames, options = {}) {
  const { drainFrames = 0 } = options;
  const simA = createSim();
  const rngP0 = new DeterministicRNG(100);

  // Player 0 runs solo
  simA.activatePlayer(0, 0);
  simA.startGame();

  for (let tick = 0; tick < soloFrames; tick++) {
    const input = generateInput(rngP0);
    const inputs = [input, 0, 0, 0];
    simA.tick(inputs);
  }

  // Player 1 joins: host activates player 1, serializes, joiner deserializes
  simA.activatePlayer(1, 1);
  const stateBuffer = simA.serialize();
  const joinFrame = simA._frame;

  const simB = createSim();
  simB.deserialize(stateBuffer);

  // Both create rollback sessions starting at the join frame
  const sessionA = createSession(0, joinFrame);
  const sessionB = createSession(1, joinFrame);

  for (let i = 0; i < NUM_PLAYERS; i++) {
    sessionA.setPeerConnected(i, true);
    sessionB.setPeerConnected(i, true);
    sessionA.peerSynchronized[i] = true;
    sessionB.peerSynchronized[i] = true;
  }
  sessionA.running = true;
  sessionB.running = true;

  // Mock networks
  const netAtoB = new MockNetwork(300);
  const netBtoA = new MockNetwork(400);

  const rngP1 = new DeterministicRNG(200);

  let desyncReport = null;

  for (let tick = 0; tick < multiplayerFrames; tick++) {
    // Deliver
    const msgsForA = netBtoA.receive(tick);
    for (const msg of msgsForA) {
      sessionA.addRemoteInput(1, msg.frame, msg.input);
      sessionA.peerLastRecvTime[1] = Date.now();
    }

    const msgsForB = netAtoB.receive(tick);
    for (const msg of msgsForB) {
      sessionB.addRemoteInput(0, msg.frame, msg.input);
      sessionB.peerLastRecvTime[0] = Date.now();
    }

    // Inputs
    const inputP0 = generateInput(rngP0);
    const inputP1 = generateInput(rngP1);

    sessionA.addLocalInput(inputP0);
    const reqsA = sessionA.advanceFrame();
    processRequests(simA, reqsA);

    sessionB.addLocalInput(inputP1);
    const reqsB = sessionB.advanceFrame();
    processRequests(simB, reqsB);

    // Send
    const localA = sessionA.getLocalInput();
    if (localA) {
      netAtoB.send(tick, localA.frame, localA.input);
    }

    const localB = sessionB.getLocalInput();
    if (localB) {
      netBtoA.send(tick, localB.frame, localB.input);
    }

    sessionA.pollEvents();
    sessionB.pollEvents();

    // Periodic check (skip when drain phase is used, since
    // recent frames may have undelivered inputs causing transient
    // prediction disagreements)
    if (drainFrames === 0 && (tick + 1) % CHECK_INTERVAL === 0) {
      const bufA = new Int32Array(simA.serialize());
      const bufB = new Int32Array(simB.serialize());
      const report = compareStates(bufA, bufB, `tick ${tick + 1} (frame ${bufA[G_FRAME]})`);
      if (report) {
        desyncReport = report;
        break;
      }
    }
  }

  // Drain phase: continue delivering in-flight inputs and processing rollbacks
  // without generating new inputs, so the final comparison reflects fully-converged state.
  if (!desyncReport && drainFrames > 0) {
    for (let d = 0; d < drainFrames; d++) {
      const drainTick = multiplayerFrames + d;

      const msgsForA = netBtoA.receive(drainTick);
      for (const msg of msgsForA) {
        sessionA.addRemoteInput(1, msg.frame, msg.input);
        sessionA.peerLastRecvTime[1] = Date.now();
      }

      const msgsForB = netAtoB.receive(drainTick);
      for (const msg of msgsForB) {
        sessionB.addRemoteInput(0, msg.frame, msg.input);
        sessionB.peerLastRecvTime[0] = Date.now();
      }

      sessionA.addLocalInput(0);
      const reqsA = sessionA.advanceFrame();
      processRequests(simA, reqsA);

      sessionB.addLocalInput(0);
      const reqsB = sessionB.advanceFrame();
      processRequests(simB, reqsB);

      const localA = sessionA.getLocalInput();
      if (localA) {
        netAtoB.send(drainTick, localA.frame, localA.input);
      }

      const localB = sessionB.getLocalInput();
      if (localB) {
        netBtoA.send(drainTick, localB.frame, localB.input);
      }

      sessionA.pollEvents();
      sessionB.pollEvents();
    }
  }

  // Final comparison
  if (!desyncReport) {
    const totalTicks = multiplayerFrames + drainFrames;
    const bufA = new Int32Array(simA.serialize());
    const bufB = new Int32Array(simB.serialize());
    desyncReport = compareStates(bufA, bufB, `final (tick ${totalTicks}, frame ${bufA[G_FRAME]})`);
  }

  return desyncReport;
}

// ---- Mocha test suite ----

describe('Multiplayer Sync', function () {
  // All tests use a drain phase so the final comparison reflects fully-converged
  // state. Without draining, the last 1-3 frames may have undelivered inputs
  // causing transient prediction disagreements that are NOT real desyncs.

  it('stays in sync for 10 seconds (600 frames)', function () {
    this.timeout(30000);
    const report = runMultiplayerSyncTest(600, { drainFrames: 10 });
    assert.strictEqual(report, null, report || 'Simulations should be in sync');
  });

  it('stays in sync for 5 minutes (18000 frames)', function () {
    this.timeout(360000);
    const report = runMultiplayerSyncTest(18000, { drainFrames: 10 });
    assert.strictEqual(report, null, report || 'Simulations should be in sync');
  });

  it('desyncs when packets are lost without redundancy', function () {
    this.timeout(60000);
    const report = runMultiplayerSyncTest(3600, { dropRate: 0.02, drainFrames: 10 });
    assert.notStrictEqual(report, null, 'Should desync without input redundancy under packet loss');
  });

  it('stays in sync with 2% packet loss using input redundancy', function () {
    this.timeout(60000);
    const report = runMultiplayerSyncTest(3600, { dropRate: 0.02, useRedundancy: true, drainFrames: 10 });
    assert.strictEqual(report, null, report || 'Should stay in sync with redundant inputs');
  });

  it('stays in sync with high delay (4-frame max)', function () {
    this.timeout(120000);
    const report = runMultiplayerSyncTest(3600, { maxDelay: 4, useRedundancy: true, drainFrames: 20 });
    assert.strictEqual(report, null, report || 'Should stay in sync under high delay');
  });

  it('stays in sync with staggered join', function () {
    this.timeout(60000);
    const report = runStaggeredJoinSyncTest(300, 3600, { drainFrames: 10 });
    assert.strictEqual(report, null, report || 'Should stay in sync after staggered join');
  });

  // ---- Diagnostic: input-level divergence finder ----
  // When a sync test fails, change `it.skip` to `it` to find the exact frame
  // and player where the final (post-rollback) inputs diverge between sessions.
  // The output shows the first divergent frame, surrounding context, and totals.

  it.skip('DIAGNOSTIC: find first frame of input divergence', function () {
    this.timeout(60000);
    const totalFrames = 600;
    const drainFrames = 100;

    const simA = createSim();
    const simB = createSim();
    const sessionA = createSession(0);
    const sessionB = createSession(1);

    for (let i = 0; i < NUM_PLAYERS; i++) {
      sessionA.setPeerConnected(i, true);
      sessionB.setPeerConnected(i, true);
      sessionA.peerSynchronized[i] = true;
      sessionB.peerSynchronized[i] = true;
    }
    sessionA.running = true;
    sessionB.running = true;

    simA.activatePlayer(0, 0);
    simA.activatePlayer(1, 1);
    simB.activatePlayer(0, 0);
    simB.activatePlayer(1, 1);
    simA.startGame();
    simB.startGame();

    const netAtoB = new MockNetwork(300);
    const netBtoA = new MockNetwork(400);
    const rngP0 = new DeterministicRNG(100);
    const rngP1 = new DeterministicRNG(200);

    const inputLogA = new Map();
    const inputLogB = new Map();
    let skipsA = 0;
    let skipsB = 0;

    for (let tick = 0; tick < totalFrames; tick++) {
      const msgsForA = netBtoA.receive(tick);
      for (const msg of msgsForA) {
        sessionA.addRemoteInput(1, msg.frame, msg.input);
        sessionA.peerLastRecvTime[1] = Date.now();
      }
      const msgsForB = netAtoB.receive(tick);
      for (const msg of msgsForB) {
        sessionB.addRemoteInput(0, msg.frame, msg.input);
        sessionB.peerLastRecvTime[0] = Date.now();
      }

      const inputP0 = generateInput(rngP0);
      const inputP1 = generateInput(rngP1);

      sessionA.addLocalInput(inputP0);
      const reqsA = sessionA.advanceFrame();
      if (reqsA.length === 0) { skipsA++; }
      processRequests(simA, reqsA, inputLogA);

      sessionB.addLocalInput(inputP1);
      const reqsB = sessionB.advanceFrame();
      if (reqsB.length === 0) { skipsB++; }
      processRequests(simB, reqsB, inputLogB);

      const localA = sessionA.getLocalInput();
      if (localA) { netAtoB.send(tick, localA.frame, localA.input); }
      const localB = sessionB.getLocalInput();
      if (localB) { netBtoA.send(tick, localB.frame, localB.input); }

      sessionA.pollEvents();
      sessionB.pollEvents();
    }

    // Drain: deliver remaining in-flight packets, no new gameplay inputs
    for (let d = 0; d < drainFrames; d++) {
      const drainTick = totalFrames + d;
      for (const msg of netBtoA.receive(drainTick)) {
        sessionA.addRemoteInput(1, msg.frame, msg.input);
        sessionA.peerLastRecvTime[1] = Date.now();
      }
      for (const msg of netAtoB.receive(drainTick)) {
        sessionB.addRemoteInput(0, msg.frame, msg.input);
        sessionB.peerLastRecvTime[0] = Date.now();
      }

      sessionA.addLocalInput(0);
      processRequests(simA, sessionA.advanceFrame(), inputLogA);
      sessionB.addLocalInput(0);
      processRequests(simB, sessionB.advanceFrame(), inputLogB);

      const localA = sessionA.getLocalInput();
      if (localA) { netAtoB.send(drainTick, localA.frame, localA.input); }
      const localB = sessionB.getLocalInput();
      if (localB) { netBtoA.send(drainTick, localB.frame, localB.input); }

      sessionA.pollEvents();
      sessionB.pollEvents();
    }

    // --- Analysis ---
    const maxFrame = Math.max(...inputLogA.keys(), ...inputLogB.keys());
    console.log(`\n=== Input Divergence Report ===`);
    console.log(`Skips: A=${skipsA}, B=${skipsB}`);
    console.log(`Final frames: A=${sessionA.currentFrame}, B=${sessionB.currentFrame}`);
    console.log(`Input log sizes: A=${inputLogA.size}, B=${inputLogB.size}`);

    let firstDivergence = -1;
    let divergentCount = 0;

    for (let f = 0; f <= maxFrame; f++) {
      const inpA = inputLogA.get(f);
      const inpB = inputLogB.get(f);

      if (!inpA && !inpB) { continue; }
      if (!inpA || !inpB) {
        divergentCount++;
        if (firstDivergence < 0) {
          firstDivergence = f;
          console.log(`Frame ${f}: MISSING in ${!inpA ? 'A' : 'B'}`);
        }
        continue;
      }

      let differs = false;
      for (let p = 0; p < NUM_PLAYERS; p++) {
        if (inpA[p] !== inpB[p]) { differs = true; }
      }
      if (differs) {
        divergentCount++;
        if (firstDivergence < 0) {
          firstDivergence = f;
          console.log(`\nFIRST DIVERGENCE at frame ${f}:`);
          console.log(`  A: [${inpA.join(', ')}]`);
          console.log(`  B: [${inpB.join(', ')}]`);
          console.log(`\nSurrounding frames:`);
          for (let ff = Math.max(0, f - 5); ff <= Math.min(maxFrame, f + 5); ff++) {
            const a = inputLogA.get(ff);
            const b = inputLogB.get(ff);
            const tag = (a && b && a.every((v, i) => v === b[i])) ? 'OK' : 'DIFF';
            const aStr = a ? `[${a.join(',')}]` : 'MISSING';
            const bStr = b ? `[${b.join(',')}]` : 'MISSING';
            console.log(`  frame ${ff}: A=${aStr} B=${bStr}  ${tag}`);
          }
        }
      }
    }

    console.log(`\nTotal divergent frames: ${divergentCount} / ${maxFrame + 1}`);
    if (divergentCount === 0) {
      console.log('All inputs match — divergence is in game simulation, not input delivery.');
    }
    console.log('');

    // Final state comparison for full context
    const bufA = new Int32Array(simA.serialize());
    const bufB = new Int32Array(simB.serialize());
    const report = compareStates(bufA, bufB, `final (frame ${bufA[G_FRAME]})`);
    if (report) {
      console.log(report);
    } else {
      console.log('Final states match — no desync.');
    }

    assert.ok(true, 'Diagnostic test — see console output');
  });
});
