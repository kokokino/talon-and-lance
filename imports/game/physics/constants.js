// Shared physics constants and level data for Talon & Lance
// All game logic modules import from here — single source of truth.

// ---- Size & View ----
export const VOXEL_SIZE = 0.07;
export const ORTHO_WIDTH = 20;
export const ORTHO_LEFT = -ORTHO_WIDTH / 2;
export const ORTHO_RIGHT = ORTHO_WIDTH / 2;
export const ORTHO_HEIGHT = ORTHO_WIDTH * 9 / 16;  // = 11.25 (16:9 aspect)
export const ORTHO_BOTTOM = -ORTHO_HEIGHT / 2;      // = -5.625
export const ORTHO_TOP = ORTHO_HEIGHT / 2;           // = 5.625

// ---- Movement ----
export const ACCELERATION = 4.0;
export const MAX_SPEED = 10.0;
export const FRICTION = 3.0;
export const SKID_DECEL = 12.0;
export const TURN_DURATION = 0.25;
export const CHAR_HALF_WIDTH = 10 * VOXEL_SIZE / 2;

// ---- Flying physics ----
export const GRAVITY = 8.0;
export const FLAP_IMPULSE = 4.0;
export const TERMINAL_VELOCITY = 8.0;
export const AIR_FRICTION = 0.5;

// ---- Collision offsets from body center ----
export const FEET_OFFSET = 7.5 * VOXEL_SIZE;
export const HEAD_OFFSET = 10.5 * VOXEL_SIZE;
export const LEDGE_HEIGHT = 0.06;

// ---- Joust collision ----
export const JOUST_HEIGHT_DEADZONE = 0.15;
export const JOUST_KNOCKBACK_X = 6.0;
export const JOUST_KNOCKBACK_Y = 3.0;
export const RESPAWN_DELAY = 2.0;
export const INVINCIBLE_DURATION = 5.0;

// ---- Wing flap animation — ostrich (up/down rotation.x) ----
export const FLAP_DURATION = 0.25;
export const WING_UP_ANGLE = -1.2;
export const WING_DOWN_ANGLE = 0.4;
export const WING_GLIDE_ANGLE = -0.3;

// ---- Wing sweep animation — buzzard (forward/backward rotation.z) ----
export const SWEEP_FORWARD_ANGLE = 0.8;
export const SWEEP_BACKWARD_ANGLE = -0.6;
export const SWEEP_GLIDE_ANGLE = 0.2;

// ---- Materialization ----
export const MATERIALIZE_DURATION = 10.0;
export const MATERIALIZE_QUICK_DURATION = 0.5;

// ---- Egg hatching ----
export const HATCH_TIME = 8.0;
export const WOBBLE_START = 5.0;
export const LOOK_AROUND_TIME = 3.0;
export const BIRD_ARRIVE_TIME = 1.5;
export const EGG_RADIUS = 2 * VOXEL_SIZE;

// ---- Wave spawning ----
export const SPAWN_GROUP_INTERVAL = 2.0;
export const WAVE_TRANSITION_DELAY = 2.0;

// ---- Platform layout (Joust Level 1) ----
export const PLATFORM_DEFS = [
  // Base tier — two sections with lava gap in center
  { id: 'baseLeft',  x: -5.5, y: -3.8, width: 9.0, height: 0.35 },
  { id: 'baseRight', x:  5.5, y: -3.8, width: 9.0, height: 0.35 },
  // Lower-middle tier
  { id: 'midLowL',   x: -5.0, y: -1.5, width: 4.5, height: 0.3 },
  { id: 'midLowR',   x:  5.0, y: -1.5, width: 4.5, height: 0.3 },
  // Upper-middle tier (L and R extend past screen edges for wrap-around)
  { id: 'midUpL',    x: -8.0, y:  0.8, width: 4.5, height: 0.3 },
  { id: 'midUpC',    x:  0.0, y:  0.8, width: 5.0, height: 0.3 },
  { id: 'midUpR',    x:  8.0, y:  0.8, width: 4.5, height: 0.3 },
  // Top tier
  { id: 'top',       x:  0.0, y:  3.2, width: 12.0, height: 0.3 },
];

// ---- Spawn points ----
export const SPAWN_POINTS = [
  { x: -6.0, platformId: 'baseLeft' },
  { x:  6.0, platformId: 'baseRight' },
  { x: -5.0, platformId: 'midLowL' },
  { x:  5.0, platformId: 'midLowR' },
];

// ---- Enemy spawn points ----
export const ENEMY_SPAWN_POINTS = [
  { x: -8.0, platformId: 'midUpL' },   // top-left
  { x:  8.0, platformId: 'midUpR' },   // top-right
  { x: -5.0, platformId: 'midLowL' },  // mid-left
  { x:  5.0, platformId: 'midLowR' },  // mid-right
];

// ---- Pterodactyl physics ----
export const PTERO_SWOOP_SPEED = 14.0;       // Faster than MAX_SPEED
export const PTERO_ENTER_SPEED = 8.0;        // Entrance speed
export const PTERO_PULL_UP_SPEED = 6.0;      // Vertical escape speed
export const PTERO_CIRCLE_SPEED = 5.0;       // Repositioning speed

// ---- Pterodactyl jaw cycle (frames at 60fps) ----
export const PTERO_JAW_OPEN_FRAMES = 30;     // 0.5s vulnerable window
export const PTERO_JAW_CLOSED_FRAMES = 45;   // 0.75s invulnerable window
export const PTERO_JAW_TOTAL = 75;           // Full cycle = 1.25s

// ---- Pterodactyl phase durations (frames at 60fps) ----
export const PTERO_ENTER_FRAMES = 60;        // 1s entrance
export const PTERO_SWOOP_FRAMES = 90;        // 1.5s swoop charge
export const PTERO_PULL_UP_FRAMES = 30;      // 0.5s upward veer
export const PTERO_CIRCLE_FRAMES = 60;       // 1s repositioning

// ---- Idle timer thresholds (frames at 60fps) ----
export const IDLE_TIMER_THRESHOLD = 3600;    // 60 seconds before pterodactyl spawns
export const IDLE_TIMER_WARNING = 3300;      // 55 seconds — audio warning cue (5s before spawn)

// ---- Lava Troll ----
export const TROLL_WAVE_START = 1;//4;
export const TROLL_GRAB_FRAMES = 10;        // 0.167s finger close
export const TROLL_RETREAT_FRAMES = 30;      // 0.5s to sink back
export const TROLL_COOLDOWN_FRAMES = 60;    // 1 second between grab attempts
export const TROLL_GRAB_CHANCE = 2;          // 1 in N chance to grab when target in range
export const TROLL_GRAB_RADIUS_FP = toFP(1.0); // how close hand must be to grab
export const TROLL_PUNCH_RISE_FRAMES = 40;   // intro: fist rises
export const TROLL_PUNCH_TOTAL_FRAMES = 120; // intro: total sequence

// Spawn pillars replace base platforms after troll destruction
export const SPAWN_PILLAR_LEFT = { id: 'baseLeft', x: -6.0, y: -3.8, width: 2.5, height: 0.35 };
export const SPAWN_PILLAR_RIGHT = { id: 'baseRight', x: 6.0, y: -3.8, width: 2.5, height: 0.35 };

// ---- Game modes ----
export const GAME_MODE_TEAM = 'team';
export const GAME_MODE_PVP = 'pvp';

/**
 * Build collision data for platforms (pre-compute edges) — float version.
 * Used by the renderer (Level1Scene) for visual positioning.
 */
export function buildPlatformCollisionData() {
  return PLATFORM_DEFS.map(def => ({
    id: def.id,
    x: def.x,
    y: def.y,
    width: def.width,
    height: def.height,
    top: def.y + def.height / 2 + LEDGE_HEIGHT,
    bottom: def.y - def.height / 2,
    left: def.x - def.width / 2,
    right: def.x + def.width / 2,
  }));
}

// ========================================================================
// Fixed-Point Constants (FP_SCALE = 256, 8 fractional bits)
// All game simulation physics use these for cross-platform determinism.
// ========================================================================

import { FP_SCALE, toFP } from './stateLayout.js';

const FP = FP_SCALE;

// ---- Velocity constants (FP per second) ----
export const FP_FLAP_IMPULSE = Math.round(FLAP_IMPULSE * FP);
export const FP_MAX_SPEED = Math.round(MAX_SPEED * FP);
export const FP_TERMINAL_VELOCITY = Math.round(TERMINAL_VELOCITY * FP);
export const FP_JOUST_KNOCKBACK_X = Math.round(JOUST_KNOCKBACK_X * FP);
export const FP_JOUST_KNOCKBACK_Y = Math.round(JOUST_KNOCKBACK_Y * FP);

// Winner recoil after a kill: 0.3 × knockback, precomputed in FP.
// 77/256 ≈ 0.30078 (closest integer ratio to 0.3 in 8-bit fixed-point).
// 1536 * 77 / 256 = 461.8125 → 461 in integer.
export const FP_KILL_RECOIL_VX = (FP_JOUST_KNOCKBACK_X * 77) >> 8;

// ---- Per-frame deltas (constant * FP / 60) ----
export const FP_ACCEL_PF = Math.round(ACCELERATION * FP / 60);
export const FP_FRICTION_PF = Math.round(FRICTION * FP / 60);
export const FP_SKID_DECEL_PF = Math.round(SKID_DECEL * FP / 60);
export const FP_AIR_FRICTION_PF = Math.round(AIR_FRICTION * FP / 60);
export const FP_GRAVITY_PF = Math.round(GRAVITY * FP / 60);
export const FP_AIR_SKID_PF = Math.round(SKID_DECEL * 0.3 * FP / 60);

// ---- Collision/offset constants (FP position units) ----
export const FP_CHAR_HALF_WIDTH = Math.round(CHAR_HALF_WIDTH * FP);
export const FP_FEET_OFFSET = Math.round(FEET_OFFSET * FP);
export const FP_HEAD_OFFSET = Math.round(HEAD_OFFSET * FP);
export const FP_EGG_RADIUS = Math.round(EGG_RADIUS * FP);
export const FP_JOUST_DEADZONE = Math.round(JOUST_HEIGHT_DEADZONE * FP);
export const FP_ORTHO_LEFT = Math.round(ORTHO_LEFT * FP);
export const FP_ORTHO_RIGHT = Math.round(ORTHO_RIGHT * FP);
export const FP_ORTHO_WIDTH = Math.round(ORTHO_WIDTH * FP);
export const FP_ORTHO_BOTTOM = Math.round(ORTHO_BOTTOM * FP);
export const FP_ORTHO_TOP = Math.round(ORTHO_TOP * FP);

// ---- Timer constants (frame counts at 60fps) ----
export const RESPAWN_FRAMES = Math.round(RESPAWN_DELAY * 60);
export const INVINCIBLE_FRAMES = Math.round(INVINCIBLE_DURATION * 60);
export const MATERIALIZE_FRAMES = Math.round(MATERIALIZE_DURATION * 60);
export const MATERIALIZE_QUICK_FRAMES = Math.round(MATERIALIZE_QUICK_DURATION * 60);
export const HATCH_FRAMES = Math.round(HATCH_TIME * 60);
export const WOBBLE_START_FRAMES = Math.round(WOBBLE_START * 60);
export const SPAWN_INTERVAL_FRAMES = Math.round(SPAWN_GROUP_INTERVAL * 60);
export const WAVE_DELAY_FRAMES = Math.round(WAVE_TRANSITION_DELAY * 60);
export const TURN_FRAMES = Math.round(TURN_DURATION * 60);
export const FLAP_FRAMES = Math.round(FLAP_DURATION * 60);
export const JOUST_COOLDOWN_FRAMES = Math.round(0.15 * 60);
export const HATCHLING_FRAMES = Math.round(LOOK_AROUND_TIME * 60);   // 180 frames
export const BIRD_ARRIVE_FRAMES = Math.round(BIRD_ARRIVE_TIME * 60); // 90 frames

// ---- Hatchling hitbox (standing knight only, no bird) ----
export const HATCHLING_HALF_WIDTH = 4 * VOXEL_SIZE;
export const HATCHLING_HEIGHT = 13 * VOXEL_SIZE;
export const FP_HATCHLING_HALF_WIDTH = Math.round(HATCHLING_HALF_WIDTH * FP);
export const FP_HATCHLING_HEIGHT = Math.round(HATCHLING_HEIGHT * FP);

// ---- Pterodactyl FP velocities (per second, converted to FP) ----
export const FP_PTERO_SWOOP_SPEED = Math.round(PTERO_SWOOP_SPEED * FP);
export const FP_PTERO_ENTER_SPEED = Math.round(PTERO_ENTER_SPEED * FP);
export const FP_PTERO_PULL_UP_SPEED = Math.round(PTERO_PULL_UP_SPEED * FP);
export const FP_PTERO_CIRCLE_SPEED = Math.round(PTERO_CIRCLE_SPEED * FP);

// ---- Pterodactyl spawn margin (FP) ----
export const FP_PTERO_SPAWN_MARGIN = Math.round(2.0 * FP);

// ---- Pterodactyl platform avoidance margin (FP) ----
export const FP_PTERO_AVOID_MARGIN = Math.round(1.0 * FP);

// ---- Patrol AI phase durations (frames at 60fps) ----
// Patrol: walk on platform before attacking
export const PATROL_MIN_BOUNDER = 180;    // 3s
export const PATROL_RANGE_BOUNDER = 120;  // +0-2s random
export const PATROL_MIN_HUNTER = 120;     // 2s
export const PATROL_RANGE_HUNTER = 120;   // +0-2s random
export const PATROL_MIN_SHADOW = 90;      // 1.5s
export const PATROL_RANGE_SHADOW = 90;    // +0-1.5s random

// Attack: fight player before returning to a platform
export const ATTACK_MIN_BOUNDER = 180;    // 3s
export const ATTACK_RANGE_BOUNDER = 180;  // +0-3s random
export const ATTACK_MIN_HUNTER = 180;     // 3s
export const ATTACK_RANGE_HUNTER = 120;   // +0-2s random
export const ATTACK_MIN_SHADOW = 120;     // 2s
export const ATTACK_RANGE_SHADOW = 120;   // +0-2s random

// Return: navigate back to a platform (safety timeout)
export const RETURN_TIMEOUT = 300;        // 5s

// Ceiling avoidance — suppress flaps above this Y (just above top platform at y=3.2)
export const FP_CEILING_AVOID = toFP(3.5);

// Return navigation thresholds
export const FP_RETURN_X_TOLERANCE = toFP(1.5);
export const FP_RETURN_ABOVE_MARGIN = toFP(0.5);

// Initial patrol duration for freshly spawned enemies
export const INITIAL_PATROL_MIN = 60;     // 1s
export const INITIAL_PATROL_RANGE = 60;   // +0-1s random

// ---- Misc FP thresholds ----
export const FP_LAVA_OFFSET = Math.round(1.0 * FP);
export const FP_CEILING_GAP = Math.round(0.1 * FP);
export const FP_OVERLAP_PUSH = Math.round(0.01 * FP);
export const FP_BOUNCE_THRESHOLD = Math.round(0.5 * FP);
export const FP_PLATFORM_EPSILON = Math.round(0.1 * FP);
export const FP_EGG_HATCH_LIFT = Math.round(0.5 * FP);
export const FP_KILL_KNOCK_VX = Math.round(2 * FP);

// ---- Lava Troll FP constants ----
// Lava visual top matches Level1Scene._createLava() lavaTop
const LAVA_VISUAL_TOP = -3.6;
export const FP_TROLL_REACH_ZONE = toFP(LAVA_VISUAL_TOP + 25 * VOXEL_SIZE);  // ~25 voxels above lava top
export const FP_TROLL_RISE_SPEED = Math.round(15.0 * FP / 60);  // per-frame rise speed
export const FP_TROLL_PULL_ACCEL = Math.round(1.5 * FP / 60);  // tug-of-war: pull-down per frame (~6 FP)
export const FP_TROLL_FLAP_IMPULSE = Math.round(0.4 * FP);     // tug-of-war: flap kick (~102 FP)
export const FP_TROLL_ESCAPE_DIST = toFP(1.5);                 // escape when 1.5 world units above grab point
export const FP_TROLL_ESCAPE_IMPULSE = Math.round(5.0 * FP);   // upward velocity on escape
export const FP_TROLL_START_Y = toFP(-7.0);       // below viewport for hidden position
export const FP_TROLL_LAVA_Y = FP_ORTHO_BOTTOM + FP_LAVA_OFFSET; // death threshold

/**
 * Build platform collision data in fixed-point units.
 * Used by GameSimulation for deterministic physics.
 */
export function buildPlatformCollisionDataFP() {
  return PLATFORM_DEFS.map(def => ({
    id: def.id,
    top: toFP(def.y + def.height / 2 + LEDGE_HEIGHT),
    bottom: toFP(def.y - def.height / 2),
    left: toFP(def.x - def.width / 2),
    right: toFP(def.x + def.width / 2),
  }));
}

/**
 * Build reduced platform collision data in FP — replaces baseLeft/baseRight
 * with smaller spawn pillars after the Lava Troll destroys them.
 */
export function buildReducedPlatformCollisionDataFP() {
  const pillars = [SPAWN_PILLAR_LEFT, SPAWN_PILLAR_RIGHT];
  return PLATFORM_DEFS.map(def => {
    const pillar = pillars.find(p => p.id === def.id);
    const src = pillar || def;
    return {
      id: src.id,
      top: toFP(src.y + src.height / 2 + LEDGE_HEIGHT),
      bottom: toFP(src.y - src.height / 2),
      left: toFP(src.x - src.width / 2),
      right: toFP(src.x + src.width / 2),
    };
  });
}

/** Spawn points in FP */
export const SPAWN_POINTS_FP = SPAWN_POINTS.map(sp => ({
  x: toFP(sp.x),
  platformId: sp.platformId,
}));

/** Enemy spawn points in FP */
export const ENEMY_SPAWN_POINTS_FP = ENEMY_SPAWN_POINTS.map(sp => ({
  x: toFP(sp.x),
  platformId: sp.platformId,
}));
