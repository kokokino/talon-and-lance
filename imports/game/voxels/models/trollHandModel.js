// Lava Troll hand voxel model — 6-part rig for grab animation
// Magma/lava theme: dark rock with glowing cracks and bright fingertips
// Coordinate system: layers[y][z][x] — y=0 is bottom of each part
// Front face = z=0 (lowest z index, faces -Z direction)

export const trollHandModel = {
  palette: {
    1: '#8B0000',  // Dark red (deep rock)
    2: '#CC3300',  // Burning red (hot surface)
    3: '#FF6600',  // Orange glow (cracks/veins)
    4: '#FFB800',  // Bright yellow-orange (hottest spots, fingertips)
    5: '#4A1A00',  // Dark brown (cooled rock)
    6: '#FF4400',  // Bright red-orange (lava highlights)
  },

  parts: {
    forearm: {
      offset: [0, 0, 0],
      // 4w × 4d × 20h — tall forearm so bottom stays submerged in lava
      layers: [
        // y=0 (wrist end, bottom)
        [
          [5, 1, 1, 5],
          [1, 1, 1, 1],
          [1, 1, 1, 1],
          [5, 1, 1, 5],
        ],
        // y=1
        [
          [1, 5, 5, 1],
          [5, 1, 1, 5],
          [5, 1, 1, 5],
          [1, 5, 5, 1],
        ],
        // y=2
        [
          [5, 1, 1, 5],
          [1, 3, 3, 1],
          [1, 3, 3, 1],
          [5, 1, 1, 5],
        ],
        // y=3
        [
          [1, 5, 5, 1],
          [5, 1, 1, 5],
          [5, 1, 1, 5],
          [1, 5, 5, 1],
        ],
        // y=4
        [
          [5, 1, 1, 5],
          [1, 3, 1, 1],
          [1, 1, 3, 1],
          [5, 1, 1, 5],
        ],
        // y=5
        [
          [1, 5, 5, 1],
          [5, 1, 1, 5],
          [5, 1, 1, 5],
          [1, 5, 5, 1],
        ],
        // y=6
        [
          [5, 1, 1, 5],
          [1, 1, 3, 1],
          [1, 3, 1, 1],
          [5, 1, 1, 5],
        ],
        // y=7
        [
          [1, 5, 5, 1],
          [5, 1, 1, 5],
          [5, 1, 1, 5],
          [1, 5, 5, 1],
        ],
        // y=8 (extended forearm — repeat dark rock + vein pattern)
        [
          [5, 1, 1, 5],
          [1, 1, 1, 1],
          [1, 1, 1, 1],
          [5, 1, 1, 5],
        ],
        // y=9
        [
          [1, 5, 5, 1],
          [5, 1, 1, 5],
          [5, 1, 1, 5],
          [1, 5, 5, 1],
        ],
        // y=10
        [
          [5, 1, 1, 5],
          [1, 3, 3, 1],
          [1, 3, 3, 1],
          [5, 1, 1, 5],
        ],
        // y=11
        [
          [1, 5, 5, 1],
          [5, 1, 1, 5],
          [5, 1, 1, 5],
          [1, 5, 5, 1],
        ],
        // y=12
        [
          [5, 1, 1, 5],
          [1, 1, 3, 1],
          [1, 3, 1, 1],
          [5, 1, 1, 5],
        ],
        // y=13
        [
          [1, 5, 5, 1],
          [5, 1, 1, 5],
          [5, 1, 1, 5],
          [1, 5, 5, 1],
        ],
        // y=14
        [
          [5, 1, 1, 5],
          [1, 3, 1, 1],
          [1, 1, 3, 1],
          [5, 1, 1, 5],
        ],
        // y=15
        [
          [1, 5, 5, 1],
          [5, 1, 1, 5],
          [5, 1, 1, 5],
          [1, 5, 5, 1],
        ],
        // y=16
        [
          [5, 1, 1, 5],
          [1, 3, 3, 1],
          [1, 3, 3, 1],
          [5, 1, 1, 5],
        ],
        // y=17
        [
          [1, 5, 5, 1],
          [5, 1, 1, 5],
          [5, 1, 1, 5],
          [1, 5, 5, 1],
        ],
        // y=18
        [
          [5, 1, 1, 5],
          [1, 1, 3, 1],
          [1, 3, 1, 1],
          [5, 1, 1, 5],
        ],
        // y=19 (top of forearm)
        [
          [1, 5, 5, 1],
          [5, 1, 1, 5],
          [5, 1, 1, 5],
          [1, 5, 5, 1],
        ],
      ],
    },

    palm: {
      parent: 'forearm',
      offset: [0, 20, 0],
      // 9w × 4d × 4h — wide palm with crack detail
      layers: [
        // y=0 (base of palm)
        [
          [0, 1, 1, 1, 2, 1, 1, 1, 0],
          [1, 2, 1, 1, 1, 1, 1, 2, 1],
          [1, 1, 1, 1, 1, 1, 1, 1, 1],
          [0, 1, 2, 1, 1, 1, 2, 1, 0],
        ],
        // y=1
        [
          [0, 2, 1, 1, 1, 1, 1, 2, 0],
          [1, 1, 3, 1, 1, 1, 3, 1, 1],
          [1, 3, 1, 1, 1, 1, 1, 3, 1],
          [0, 2, 1, 1, 1, 1, 1, 2, 0],
        ],
        // y=2
        [
          [0, 1, 2, 1, 1, 1, 2, 1, 0],
          [2, 1, 1, 3, 1, 3, 1, 1, 2],
          [2, 1, 3, 1, 1, 1, 3, 1, 2],
          [0, 1, 2, 1, 1, 1, 2, 1, 0],
        ],
        // y=3 (top of palm — finger bases)
        [
          [0, 1, 1, 1, 2, 1, 1, 1, 0],
          [1, 2, 1, 1, 1, 1, 1, 2, 1],
          [1, 1, 2, 1, 1, 1, 2, 1, 1],
          [0, 1, 1, 1, 2, 1, 1, 1, 0],
        ],
      ],
    },

    thumb: {
      parent: 'palm',
      offset: [-5, 1, 0],
      // 4w × 2d × 4h — wide thumb with aggressive outward lean
      layers: [
        // y=0 (base — rightmost 2 cols filled, near palm)
        [
          [0, 0, 2, 1],
          [0, 0, 1, 2],
        ],
        // y=1
        [
          [0, 1, 2, 0],
          [0, 2, 1, 0],
        ],
        // y=2
        [
          [2, 6, 0, 0],
          [6, 2, 0, 0],
        ],
        // y=3 (tip — leftmost 2 cols filled, sticking out)
        [
          [6, 4, 0, 0],
          [4, 6, 0, 0],
        ],
      ],
    },

    indexFinger: {
      parent: 'palm',
      offset: [-3, 4, 0],
      // 3w × 2d × 5h — leans outward (left) via layer shifting
      layers: [
        // y=0 (base — right 2 cols filled, toward center)
        [
          [0, 1, 2],
          [0, 2, 1],
        ],
        // y=1
        [
          [0, 2, 1],
          [0, 1, 2],
        ],
        // y=2 (middle — shifting left)
        [
          [1, 6, 0],
          [6, 1, 0],
        ],
        // y=3
        [
          [6, 2, 0],
          [2, 6, 0],
        ],
        // y=4 (tip — left 2 cols filled, away from center)
        [
          [4, 6, 0],
          [6, 4, 0],
        ],
      ],
    },

    middleFinger: {
      parent: 'palm',
      offset: [0, 4, 0],
      // 2w × 2d × 5h
      layers: [
        // y=0
        [
          [2, 1],
          [1, 2],
        ],
        // y=1
        [
          [1, 2],
          [2, 1],
        ],
        // y=2
        [
          [6, 1],
          [1, 6],
        ],
        // y=3
        [
          [2, 6],
          [6, 2],
        ],
        // y=4 (tip)
        [
          [6, 4],
          [4, 6],
        ],
      ],
    },

    ringFinger: {
      parent: 'palm',
      offset: [3, 4, 0],
      // 3w × 2d × 5h — leans outward (right) via layer shifting (mirror of index)
      layers: [
        // y=0 (base — left 2 cols filled, toward center)
        [
          [2, 1, 0],
          [1, 2, 0],
        ],
        // y=1
        [
          [1, 2, 0],
          [2, 1, 0],
        ],
        // y=2 (middle — shifting right)
        [
          [0, 6, 1],
          [0, 1, 6],
        ],
        // y=3
        [
          [0, 2, 6],
          [0, 6, 2],
        ],
        // y=4 (tip — right 2 cols filled, away from center)
        [
          [0, 6, 4],
          [0, 4, 6],
        ],
      ],
    },
  },
};
