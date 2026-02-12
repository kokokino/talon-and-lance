// Egg voxel model — dropped when a character loses a joust
// Simple oval shape, cream/white coloring
// Coordinate system: layers[y][z][x] — y=0 is bottom

export const eggModel = {
  palette: {
    1: '#F5F0DC',  // Cream (main shell)
    2: '#E8DFC8',  // Slightly darker cream (shading)
    3: '#D4C9A8',  // Tan shadow (bottom/edges)
  },

  parts: {
    shell: {
      offset: [0, 0, 0],
      // 4w × 4d × 5h — egg shape
      layers: [
        // y=0 (bottom — narrow)
        [
          [0, 0, 0, 0],
          [0, 3, 3, 0],
          [0, 3, 3, 0],
          [0, 0, 0, 0],
        ],
        // y=1 (wider)
        [
          [0, 3, 3, 0],
          [3, 2, 2, 3],
          [3, 2, 2, 3],
          [0, 3, 3, 0],
        ],
        // y=2 (widest)
        [
          [0, 2, 2, 0],
          [2, 1, 1, 2],
          [2, 1, 1, 2],
          [0, 2, 2, 0],
        ],
        // y=3 (narrowing)
        [
          [0, 2, 2, 0],
          [2, 1, 1, 2],
          [2, 1, 1, 2],
          [0, 2, 2, 0],
        ],
        // y=4 (top — narrow)
        [
          [0, 0, 0, 0],
          [0, 1, 1, 0],
          [0, 1, 1, 0],
          [0, 0, 0, 0],
        ],
      ],
    },
  },
};
