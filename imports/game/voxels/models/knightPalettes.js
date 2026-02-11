// Knight color palettes — four colorblind-safe schemes
// Each entry overrides palette keys 4 (plume), 7 (primary), 8 (accent), 9 (shield)

import { knightModel } from './knightModel.js';

export const KNIGHT_PALETTES = [
  {
    name: 'Blue',
    overrides: {
      4: '#CC2222',   // Plume — red
      7: '#2855A0',   // Primary — blue
      8: '#1E3F78',   // Accent — dark blue
      9: '#C0A040',   // Shield — gold
    },
  },
  {
    name: 'Orange',
    overrides: {
      4: '#E0E0E0',   // Plume — white
      7: '#B85C1A',   // Primary — orange
      8: '#8A4515',   // Accent — dark orange
      9: '#5C3A1A',   // Shield — brown
    },
  },
  {
    name: 'Purple',
    overrides: {
      4: '#D4AA30',   // Plume — gold
      7: '#7B3FA0',   // Primary — purple
      8: '#5C2E78',   // Accent — dark purple
      9: '#A8A8A8',   // Shield — silver
    },
  },
  {
    name: 'Silver',
    overrides: {
      4: '#1A1A1A',   // Plume — black
      7: '#D8D8E0',   // Primary — silver
      8: '#A0A0A8',   // Accent — dark silver
      9: '#505050',   // Shield — gunmetal
    },
  },
];

/**
 * Build a full palette by merging a palette entry's overrides with the base knight palette.
 * @param {number} index — 0–3 palette index
 * @returns {Object} Complete palette object for buildRig
 */
export function buildKnightPalette(index) {
  const entry = KNIGHT_PALETTES[index];
  return { ...knightModel.palette, ...entry.overrides };
}
