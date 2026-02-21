// Shared test helpers for multiplayer sync and connectivity tests.
// Extracted from MultiplayerSync.test.js to avoid duplication.

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

// ---- Constants ----

export const ORTHO_BOTTOM = -5.2;
export const ORTHO_TOP = 5.2;
export const GAME_SEED = 42;
export const NUM_PLAYERS = 4;
export const INPUT_DELAY = 2;
export const AUTO_INPUT_SLOTS = new Set([2, 3]);
export const CHECK_INTERVAL = 600; // 10 seconds at 60fps
export const INPUT_REDUNDANCY = 5;

// ---- MockNetwork ----
// FIFO queue with per-message 1-2 frame delivery delay (via its own PRNG).
// Supports optional packet loss via dropRate (0.0-1.0).

export class MockNetwork {
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

export function generateInput(rng) {
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

export const GLOBAL_FIELD_NAMES = [
  'FRAME', 'RNG_SEED', 'WAVE_NUMBER', 'WAVE_STATE', 'SPAWN_TIMER',
  'WAVE_TRANSITION_TIMER', 'GAME_MODE', 'GAME_OVER', 'SPAWN_QUEUE_LEN',
  'SPAWN[0]', 'SPAWN[1]', 'SPAWN[2]', 'SPAWN[3]', 'SPAWN[4]',
  'SPAWN[5]', 'SPAWN[6]', 'SPAWN[7]', 'SPAWN[8]', 'SPAWN[9]',
];

export const CHAR_FIELD_NAMES = [
  'ACTIVE', 'POS_X', 'POS_Y', 'VEL_X', 'VEL_Y', 'STATE',
  'FACING_DIR', 'IS_TURNING', 'TURN_TIMER', 'STRIDE_PHASE',
  'IS_FLAPPING', 'FLAP_TIMER', 'DEAD', 'RESPAWN_TIMER',
  'INVINCIBLE', 'INVINCIBLE_TIMER', 'JOUST_COOLDOWN',
  'MATERIALIZING', 'MATERIALIZE_TIMER', 'MATERIALIZE_DURATION',
  'MATERIALIZE_QUICK_END', 'SCORE', 'LIVES', 'EGGS_COLLECTED',
  'PREV_POS_X', 'PREV_POS_Y', 'NEXT_LIFE_SCORE', 'PALETTE_INDEX',
  'PLAYER_DIED_WAVE', 'ENEMY_TYPE', 'HIT_LAVA', 'PLATFORM_INDEX',
];

export const AI_FIELD_NAMES = ['DIR_TIMER', 'CURRENT_DIR', 'FLAP_ACCUM', 'ENEMY_TYPE'];

export const EGG_FIELD_NAMES = [
  'ACTIVE', 'POS_X', 'POS_Y', 'VEL_X', 'VEL_Y', 'ON_PLATFORM',
  'ENEMY_TYPE', 'HATCH_STATE', 'HATCH_TIMER', 'BOUNCE_COUNT',
  'PREV_POS_Y', 'HIT_LAVA',
];

export function describeStateIndex(index) {
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

export function compareStates(bufA, bufB, label) {
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

export function processRequests(sim, requests, inputLog) {
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

export function createSession(localPlayerIndex, startFrame = 0, autoInputSlots = AUTO_INPUT_SLOTS) {
  return new RollbackSession({
    numPlayers: NUM_PLAYERS,
    localPlayerIndex,
    inputDelay: INPUT_DELAY,
    autoInputSlots: new Set(autoInputSlots),
    maxPredictionWindow: 8,
    disconnectTimeout: 60000, // large to prevent spurious disconnects
    startFrame,
  });
}

export function createSim() {
  return new GameSimulation({
    gameMode: GAME_MODE_TEAM,
    seed: GAME_SEED,
    orthoBottom: ORTHO_BOTTOM,
    orthoTop: ORTHO_TOP,
  });
}

// ---- 4-player helpers ----

// Build a full mesh of MockNetwork channels for numPlayers.
// nets[sender][receiver] = MockNetwork (null on diagonal).
export function buildNetworkMesh(numPlayers, baseSeed, options = {}) {
  const nets = [];
  for (let s = 0; s < numPlayers; s++) {
    nets[s] = [];
    for (let r = 0; r < numPlayers; r++) {
      if (s === r) {
        nets[s][r] = null;
      } else {
        nets[s][r] = new MockNetwork(baseSeed + s * 100 + r, options);
      }
    }
  }
  return nets;
}

// Create sessions for active player slots, pre-synchronize all peers, mark running.
// Returns array of length NUM_PLAYERS (null for inactive slots).
export function initSessionsForPlayers(activeSlots, startFrame, autoInputSlots) {
  const sessions = new Array(NUM_PLAYERS).fill(null);
  for (const slot of activeSlots) {
    sessions[slot] = createSession(slot, startFrame, autoInputSlots);
  }
  // Pre-synchronize: skip handshake, mark all peers as connected and synced
  for (const slot of activeSlots) {
    for (let i = 0; i < NUM_PLAYERS; i++) {
      sessions[slot].setPeerConnected(i, true);
      sessions[slot].peerSynchronized[i] = true;
    }
    sessions[slot].running = true;
  }
  return sessions;
}

// Core multiplayer tick loop for N players. Returns { desyncReport, finalTick }.
// config: { sims, sessions, nets, inputRngs, activeSlots, numTicks, tickOffset,
//           useRedundancy, histories, drainOnly, checkInterval, redundancyWindow }
export function runMultiplayerPhase(config) {
  const {
    sims, sessions, nets, inputRngs, activeSlots, numTicks, tickOffset = 0,
    useRedundancy = false, histories = null, drainOnly = false,
    checkInterval = 0, redundancyWindow = INPUT_REDUNDANCY,
  } = config;

  let desyncReport = null;

  for (let t = 0; t < numTicks; t++) {
    const tick = tickOffset + t;

    // 1. Deliver delayed inputs from all senders to all receivers
    for (const receiver of activeSlots) {
      for (const sender of activeSlots) {
        if (sender === receiver) {
          continue;
        }
        const msgs = nets[sender][receiver].receive(tick);
        for (const msg of msgs) {
          sessions[receiver].addRemoteInput(sender, msg.frame, msg.input);
          sessions[receiver].peerLastRecvTime[sender] = Date.now();
        }
      }
    }

    // 2. Generate local inputs and advance each session
    for (const slot of activeSlots) {
      const input = drainOnly ? 0 : generateInput(inputRngs[slot]);
      sessions[slot].addLocalInput(input);
      const reqs = sessions[slot].advanceFrame();
      processRequests(sims[slot], reqs);
    }

    // 3. Send local inputs to all peers
    for (const sender of activeSlots) {
      const local = sessions[sender].getLocalInput();
      if (local) {
        if (useRedundancy && histories) {
          histories[sender].push({ frame: local.frame, input: local.input });
          if (histories[sender].length > redundancyWindow) {
            histories[sender].shift();
          }
        }
        for (const receiver of activeSlots) {
          if (receiver === sender) {
            continue;
          }
          if (useRedundancy && histories) {
            nets[sender][receiver].sendBatch(tick, histories[sender]);
          } else {
            nets[sender][receiver].send(tick, local.frame, local.input);
          }
        }
      }
    }

    // 4. Drain events
    for (const slot of activeSlots) {
      sessions[slot].pollEvents();
    }

    // 5. Periodic state comparison
    if (checkInterval > 0 && (t + 1) % checkInterval === 0) {
      const refBuf = new Int32Array(sims[activeSlots[0]].serialize());
      for (let i = 1; i < activeSlots.length; i++) {
        const cmpBuf = new Int32Array(sims[activeSlots[i]].serialize());
        const report = compareStates(refBuf, cmpBuf,
          `tick ${tick + 1} P${activeSlots[0]} vs P${activeSlots[i]}`);
        if (report) {
          desyncReport = report;
          return { desyncReport, finalTick: tick };
        }
      }
    }
  }

  return { desyncReport, finalTick: tickOffset + numTicks };
}
