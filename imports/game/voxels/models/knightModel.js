// Knight voxel model — multi-part rig for animation + destruction
// Approximately 6w × 4d × 18h total, blue/silver armor inspired by classic voxel knight
// Coordinate system: layers[y][z][x] — y=0 is bottom of each part
// Front face = z=0 (lowest z index, faces -Z direction)
// Left/right named from character's own perspective (facing -Z):
//   character's right = -X, character's left = +X

export const knightModel = {
  palette: {
    1: '#A8A8A8',  // Silver armor
    2: '#707070',  // Dark steel (visor, joints)
    3: '#505050',  // Shadow steel
    4: '#CC2222',  // Red plume
    5: '#D4AA30',  // Gold trim
    6: '#F0D0A0',  // Skin (face slit)
    7: '#2855A0',  // Blue armor (primary)
    8: '#1E3F78',  // Dark blue (accent)
    9: '#C0A040',  // Shield gold/tan
  },

  parts: {
    torso: {
      offset: [0, 0, 0],
      // 6w × 4d × 5h — breastplate with detail on outer faces
      layers: [
        // y=0 (waist)
        [
          [0, 8, 7, 7, 8, 0],  // front — blue belt
          [8, 7, 7, 7, 7, 8],
          [8, 7, 7, 7, 7, 8],
          [0, 8, 8, 8, 8, 0],  // back — dark blue
        ],
        // y=1
        [
          [0, 7, 7, 7, 7, 0],  // front — blue trim
          [7, 7, 7, 7, 7, 7],
          [7, 7, 7, 7, 7, 7],
          [0, 8, 7, 7, 8, 0],  // back
        ],
        // y=2 (chest)
        [
          [8, 7, 7, 7, 7, 8],  // front — blue chest
          [7, 7, 7, 7, 7, 7],
          [7, 7, 7, 7, 7, 7],
          [8, 7, 7, 7, 7, 8],  // back
        ],
        // y=3 (upper chest)
        [
          [8, 7, 7, 7, 7, 8],  // front — blue upper chest
          [7, 7, 7, 7, 7, 7],
          [7, 7, 7, 7, 7, 7],
          [8, 7, 7, 7, 7, 8],  // back
        ],
        // y=4 (shoulders / pauldrons)
        [
          [3, 7, 7, 7, 7, 3],  // front — shoulder trim
          [0, 7, 7, 7, 7, 0],
          [0, 7, 7, 7, 7, 0],
          [3, 7, 7, 7, 7, 3],  // back
        ],
      ],
    },

    head: {
      parent: 'torso',
      offset: [0, 5, 0],
      // 6w × 4d × 5h — helmet with visor on FRONT face (z=0)
      layers: [
        // y=0 (neck/chin guard)
        [
          [0, 2, 7, 7, 2, 0],  // front
          [0, 7, 7, 7, 7, 0],
          [0, 7, 7, 7, 7, 0],
          [0, 2, 7, 7, 2, 0],  // back
        ],
        // y=1 (visor level — skin visible on FRONT face)
        [
          [0, 2, 6, 6, 2, 0],  // front — visor slit with skin showing
          [7, 7, 2, 2, 7, 7],
          [7, 7, 7, 7, 7, 7],
          [0, 7, 7, 7, 7, 0],  // back — solid blue
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
      ],
    },

    leftArm: {
      parent: 'torso',
      offset: [3, 3, 0],
      // 2w × 2d × 5h — gauntlet with blue armor (holds shield)
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
      // Centered on fist — rotated in scene to face forward
      offset: [0, -1, 2],
      // 4w × 1d × 5h — solid gold shield
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
      // 2w × 2d × 5h — gauntlet with blue armor (holds lance)
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
      // 3w × 3d × 7h — armored boot with blue armor
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
      // 3w × 3d × 7h — armored boot with blue armor
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
