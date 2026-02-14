import { idiv } from './physics/stateLayout.js';

// Scoring constants for Talon & Lance — based on arcade Joust point values

// ---- Kill points by enemy type ----
export const POINTS_KILL_BOUNDER = 500;
export const POINTS_KILL_HUNTER = 750;
export const POINTS_KILL_SHADOW_LORD = 1000;
export const POINTS_KILL_PTERODACTYL = 1000;
export const POINTS_KILL_PLAYER = 750;

// ---- Egg collection (progressive per wave) ----
export const POINTS_EGG_FIRST = 250;
export const POINTS_EGG_SECOND = 500;
export const POINTS_EGG_THIRD = 750;
export const POINTS_EGG_SUBSEQUENT = 1000;
export const POINTS_EGG_MID_AIR = 500;

// ---- Wave bonuses ----
export const POINTS_SURVIVAL_WAVE = 3000;
export const POINTS_TEAM_WAVE = 3000;
export const POINTS_GLADIATOR_WAVE = 3000;

// ---- Lives ----
export const STARTING_LIVES = 5;
export const EXTRA_LIFE_THRESHOLD = 20000;

// ---- Enemy types ----
export const ENEMY_TYPE_BOUNDER = 0;
export const ENEMY_TYPE_HUNTER = 1;
export const ENEMY_TYPE_SHADOW_LORD = 2;

// ---- Wave progression ----
export const WAVE_HUNTER_INTRO = 4;
export const WAVE_SHADOW_LORD_INTRO = 16;
export const WAVE_SHADOW_LORD_ONLY = 22;

/**
 * Get the kill points for a given enemy type.
 */
export function getKillPoints(enemyType) {
  if (enemyType === ENEMY_TYPE_BOUNDER) {
    return POINTS_KILL_BOUNDER;
  }
  if (enemyType === ENEMY_TYPE_HUNTER) {
    return POINTS_KILL_HUNTER;
  }
  return POINTS_KILL_SHADOW_LORD;
}

/**
 * Get the egg collection points based on how many eggs collected this wave.
 * @param {number} eggsCollected — number of eggs already collected (0-based)
 */
export function getEggPoints(eggsCollected) {
  if (eggsCollected === 0) {
    return POINTS_EGG_FIRST;
  }
  if (eggsCollected === 1) {
    return POINTS_EGG_SECOND;
  }
  if (eggsCollected === 2) {
    return POINTS_EGG_THIRD;
  }
  return POINTS_EGG_SUBSEQUENT;
}

/**
 * Get the enemy composition for a given wave number.
 * Returns { bounders, hunters, shadowLords } counts.
 */
export function getWaveComposition(waveNumber) {
  let bounders = 0;
  let hunters = 0;
  let shadowLords = 0;

  if (waveNumber >= WAVE_SHADOW_LORD_ONLY) {
    // Wave 22+: shadow lords only
    shadowLords = 3 + Math.min(waveNumber - WAVE_SHADOW_LORD_ONLY, 5);
  } else if (waveNumber >= WAVE_SHADOW_LORD_INTRO) {
    // Wave 16-21: mixed with shadow lords
    bounders = Math.max(0, 3 - (waveNumber - WAVE_SHADOW_LORD_INTRO));
    hunters = 2;
    shadowLords = 1 + ((waveNumber - WAVE_SHADOW_LORD_INTRO) >> 1);
  } else if (waveNumber >= WAVE_HUNTER_INTRO) {
    // Wave 4-15: bounders + hunters
    bounders = Math.max(1, 5 - idiv(waveNumber - WAVE_HUNTER_INTRO, 3));
    hunters = 2 + ((waveNumber - WAVE_HUNTER_INTRO) >> 1);
  } else {
    // Wave 1-3: bounders only
    bounders = waveNumber + 2; // 3, 4, 5
  }

  return { bounders, hunters, shadowLords };
}
