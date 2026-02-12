// Evil Knight color palettes — three enemy tiers from Joust
// Each entry overrides palette keys 4 (horns/plume), 7 (primary), 8 (accent), 9 (shield)

import { evilKnightModel } from './evilKnightModel.js';

export const EVIL_KNIGHT_PALETTES = [
  {
    name: 'Bounder',
    overrides: {
      4: '#FF4444',   // Horns/plume — bright red
      7: '#AA2222',   // Primary — crimson
      8: '#881818',   // Accent — dark crimson
      9: '#6A4A2A',   // Shield — dark leather
    },
  },
  {
    name: 'Hunter',
    overrides: {
      4: '#C0C0C0',   // Horns/plume — silver
      7: '#808080',   // Primary — steel gray
      8: '#606060',   // Accent — dark steel
      9: '#505050',   // Shield — gunmetal
    },
  },
  {
    name: 'Shadow Lord',
    overrides: {
      4: '#9B59B6',   // Horns/plume — purple glow
      7: '#4A1A6B',   // Primary — deep purple
      8: '#331148',   // Accent — dark indigo
      9: '#2A0A3A',   // Shield — near-black
    },
  },
];

/**
 * Build a full palette by merging a palette entry's overrides with the base evil knight palette.
 * @param {number} index — 0–2 palette index
 * @returns {Object} Complete palette object for buildRig
 */
export function buildEvilKnightPalette(index) {
  const entry = EVIL_KNIGHT_PALETTES[index];
  return { ...evilKnightModel.palette, ...entry.overrides };
}
