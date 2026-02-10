// Lance voxel model — single part (always separate mesh)
// Approximately 2w × 2d × 10h — brown shaft with silver/gold tip
// Defined along Y axis, rotated when held

export const lanceModel = {
  palette: {
    1: '#8B6914',  // Dark wood shaft
    2: '#A0792C',  // Light wood
    3: '#A8A8A8',  // Silver metal
    4: '#D4AA30',  // Gold trim
    5: '#C0C0C0',  // Bright silver tip
  },

  parts: {
    shaft: {
      offset: [0, 0, 0],
      // 2w × 2d × 10h
      layers: [
        // y=0 (butt end)
        [
          [1, 1],
          [1, 1],
        ],
        // y=1
        [
          [1, 2],
          [2, 1],
        ],
        // y=2
        [
          [2, 1],
          [1, 2],
        ],
        // y=3
        [
          [1, 2],
          [2, 1],
        ],
        // y=4
        [
          [2, 1],
          [1, 2],
        ],
        // y=5
        [
          [1, 2],
          [2, 1],
        ],
        // y=6 (gold grip band)
        [
          [4, 4],
          [4, 4],
        ],
        // y=7 (silver guard)
        [
          [3, 3],
          [3, 3],
        ],
        // y=8 (tip taper)
        [
          [5, 5],
          [5, 5],
        ],
        // y=9 (point)
        [
          [0, 5],
          [5, 0],
        ],
      ],
    },
  },
};
