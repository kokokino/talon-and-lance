// Evil Knight voxel model — same part structure as knightModel but with horned helmet
// Darker gunmetal armor, overridable accent colors for Bounder/Hunter/Shadow Lord tiers.
// Coordinate system: layers[y][z][x] — y=0 is bottom of each part
// Front face = z=0 (lowest z index, faces -Z direction)
// Left/right named from character's own perspective (facing -Z):
//   character's right = -X, character's left = +X

export const evilKnightModel = {
  palette: {
    1: '#808080',  // Dark gunmetal armor
    2: '#505050',  // Shadow steel (visor, joints)
    3: '#303030',  // Deep shadow
    4: '#CC2222',  // Horn/plume accent (overridable)
    5: '#8B7500',  // Tarnished gold trim
    6: '#C0A080',  // Skin (face slit, slightly tanned)
    7: '#AA2222',  // Armor primary (overridable) — red for Bounder
    8: '#881818',  // Armor accent (overridable)
    9: '#6A4A2A',  // Shield — dark leather/wood (overridable)
  },

  parts: {
    torso: {
      offset: [0, 0, 0],
      // 6w × 4d × 5h — same structure as knightModel, darker palette
      layers: [
        // y=0 (waist)
        [
          [0, 8, 7, 7, 8, 0],
          [8, 7, 7, 7, 7, 8],
          [8, 7, 7, 7, 7, 8],
          [0, 8, 8, 8, 8, 0],
        ],
        // y=1
        [
          [0, 7, 7, 7, 7, 0],
          [7, 7, 7, 7, 7, 7],
          [7, 7, 7, 7, 7, 7],
          [0, 8, 7, 7, 8, 0],
        ],
        // y=2 (chest)
        [
          [8, 7, 7, 7, 7, 8],
          [7, 7, 7, 7, 7, 7],
          [7, 7, 7, 7, 7, 7],
          [8, 7, 7, 7, 7, 8],
        ],
        // y=3 (upper chest)
        [
          [8, 7, 7, 7, 7, 8],
          [7, 7, 7, 7, 7, 7],
          [7, 7, 7, 7, 7, 7],
          [8, 7, 7, 7, 7, 8],
        ],
        // y=4 (shoulders / pauldrons)
        [
          [3, 7, 7, 7, 7, 3],
          [0, 7, 7, 7, 7, 0],
          [0, 7, 7, 7, 7, 0],
          [3, 7, 7, 7, 7, 3],
        ],
      ],
    },

    head: {
      parent: 'torso',
      offset: [0, 5, 0],
      // 6w × 4d × 7h — helmet with horns (2 extra layers above knightModel)
      layers: [
        // y=0 (neck/chin guard)
        [
          [0, 2, 7, 7, 2, 0],
          [0, 7, 7, 7, 7, 0],
          [0, 7, 7, 7, 7, 0],
          [0, 2, 7, 7, 2, 0],
        ],
        // y=1 (visor level — skin visible on front face)
        [
          [0, 2, 6, 6, 2, 0],
          [7, 7, 2, 2, 7, 7],
          [7, 7, 7, 7, 7, 7],
          [0, 7, 7, 7, 7, 0],
        ],
        // y=2 (helmet)
        [
          [0, 7, 7, 7, 7, 0],
          [7, 7, 7, 7, 7, 7],
          [7, 7, 7, 7, 7, 7],
          [0, 7, 7, 7, 7, 0],
        ],
        // y=3 (helmet dome)
        [
          [0, 0, 7, 7, 0, 0],
          [0, 7, 7, 7, 7, 0],
          [0, 7, 7, 7, 7, 0],
          [0, 0, 7, 7, 0, 0],
        ],
        // y=4 (plume)
        [
          [0, 0, 4, 4, 0, 0],
          [0, 0, 4, 4, 0, 0],
          [0, 0, 4, 4, 0, 0],
          [0, 0, 0, 0, 0, 0],
        ],
        // y=5 (horn bases — at outer edges)
        [
          [0, 4, 0, 0, 4, 0],
          [0, 0, 0, 0, 0, 0],
          [0, 0, 0, 0, 0, 0],
          [0, 0, 0, 0, 0, 0],
        ],
        // y=6 (horn tips — angle outward)
        [
          [4, 0, 0, 0, 0, 4],
          [0, 0, 0, 0, 0, 0],
          [0, 0, 0, 0, 0, 0],
          [0, 0, 0, 0, 0, 0],
        ],
      ],
    },

    leftArm: {
      parent: 'torso',
      offset: [3, 3, 0],
      // 2w × 2d × 5h — gauntlet with dark armor
      layers: [
        // y=0 (hand)
        [
          [2, 2],
          [2, 2],
        ],
        // y=1
        [
          [7, 7],
          [7, 7],
        ],
        // y=2
        [
          [7, 7],
          [7, 7],
        ],
        // y=3 (elbow)
        [
          [8, 8],
          [8, 8],
        ],
        // y=4 (shoulder cap)
        [
          [3, 3],
          [3, 3],
        ],
      ],
    },

    shield: {
      parent: 'leftArm',
      offset: [0, -1, 2],
      // 4w × 1d × 5h — dark leather/wood shield
      layers: [
        // y=0 (bottom)
        [
          [0, 9, 9, 0],
        ],
        // y=1
        [
          [9, 9, 9, 9],
        ],
        // y=2 (center)
        [
          [9, 9, 9, 9],
        ],
        // y=3
        [
          [9, 9, 9, 9],
        ],
        // y=4 (top)
        [
          [0, 9, 9, 0],
        ],
      ],
    },

    rightArm: {
      parent: 'torso',
      offset: [-3, 3, 0],
      // 2w × 2d × 5h — gauntlet with dark armor
      layers: [
        // y=0 (hand)
        [
          [2, 2],
          [2, 2],
        ],
        // y=1
        [
          [7, 7],
          [7, 7],
        ],
        // y=2
        [
          [7, 7],
          [7, 7],
        ],
        // y=3 (elbow)
        [
          [8, 8],
          [8, 8],
        ],
        // y=4 (shoulder cap)
        [
          [3, 3],
          [3, 3],
        ],
      ],
    },

    leftLeg: {
      parent: 'torso',
      offset: [1, -6, 0],
      // 3w × 3d × 7h — armored boot, darker palette
      layers: [
        // y=0 (foot — armored boot)
        [
          [2, 2, 2],
          [2, 8, 2],
          [0, 2, 0],
        ],
        // y=1 (ankle)
        [
          [0, 8, 0],
          [0, 8, 0],
          [0, 8, 0],
        ],
        // y=2 (shin)
        [
          [0, 7, 0],
          [0, 7, 0],
          [0, 7, 0],
        ],
        // y=3 (shin)
        [
          [0, 7, 0],
          [0, 7, 0],
          [0, 7, 0],
        ],
        // y=4 (knee guard)
        [
          [0, 7, 0],
          [0, 7, 0],
          [0, 7, 0],
        ],
        // y=5 (upper leg)
        [
          [0, 8, 0],
          [0, 7, 0],
          [0, 8, 0],
        ],
        // y=6 (hip joint)
        [
          [0, 2, 0],
          [0, 2, 0],
          [0, 2, 0],
        ],
      ],
    },

    rightLeg: {
      parent: 'torso',
      offset: [-1, -6, 0],
      // 3w × 3d × 7h — armored boot, darker palette
      layers: [
        // y=0 (foot — armored boot)
        [
          [2, 2, 2],
          [2, 8, 2],
          [0, 2, 0],
        ],
        // y=1 (ankle)
        [
          [0, 8, 0],
          [0, 8, 0],
          [0, 8, 0],
        ],
        // y=2 (shin)
        [
          [0, 7, 0],
          [0, 7, 0],
          [0, 7, 0],
        ],
        // y=3 (shin)
        [
          [0, 7, 0],
          [0, 7, 0],
          [0, 7, 0],
        ],
        // y=4 (knee guard)
        [
          [0, 7, 0],
          [0, 7, 0],
          [0, 7, 0],
        ],
        // y=5 (upper leg)
        [
          [0, 8, 0],
          [0, 7, 0],
          [0, 8, 0],
        ],
        // y=6 (hip joint)
        [
          [0, 2, 0],
          [0, 2, 0],
          [0, 2, 0],
        ],
      ],
    },
  },
};
