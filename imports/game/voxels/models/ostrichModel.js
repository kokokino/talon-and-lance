// Ostrich voxel model — multi-part rig for animation
// Bird faces +X direction. Cartoonish proportions: big round body, long neck, spindly legs.
// Coordinate system: layers[y][z][x] — y=0 is bottom of each part
// Offsets are relative to parent mesh center (VoxelBuilder centers meshes in XZ)
// Left/right named from character's own perspective (facing +X):
//   character's right = -Z, character's left = +Z

export const ostrichModel = {
  palette: {
    1: '#F5F0E0',  // Cream/white feathers (body)
    2: '#E0D8C4',  // Slightly darker cream (shading)
    3: '#3D3D3D',  // Dark feather tips (wing edges)
    4: '#E87020',  // Orange (beak, legs)
    5: '#D06018',  // Darker orange (joints, beak tip)
    6: '#1A1A1A',  // Black (eyes)
    7: '#4A3A2A',  // Brown tail feathers
  },

  parts: {
    body: {
      offset: [0, 0, 0],
      // 10w × 6d × 6h — big oval torso
      // centerX=4.5, centerZ=2.5
      layers: [
        // y=0 (belly)
        [
          [0, 0, 0, 1, 1, 1, 1, 0, 0, 0],
          [0, 0, 1, 2, 2, 2, 2, 1, 0, 0],
          [0, 1, 2, 2, 2, 2, 2, 2, 1, 0],
          [0, 1, 2, 2, 2, 2, 2, 2, 1, 0],
          [0, 0, 1, 2, 2, 2, 2, 1, 0, 0],
          [0, 0, 0, 1, 1, 1, 1, 0, 0, 0],
        ],
        // y=1
        [
          [0, 0, 1, 1, 1, 1, 1, 1, 0, 0],
          [0, 1, 1, 1, 1, 1, 1, 1, 1, 0],
          [1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
          [1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
          [0, 1, 1, 1, 1, 1, 1, 1, 1, 0],
          [0, 0, 1, 1, 1, 1, 1, 1, 0, 0],
        ],
        // y=2 (widest)
        [
          [0, 1, 1, 1, 1, 1, 1, 1, 1, 0],
          [1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
          [1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
          [1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
          [1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
          [0, 1, 1, 1, 1, 1, 1, 1, 1, 0],
        ],
        // y=3
        [
          [0, 1, 1, 1, 1, 1, 1, 1, 1, 0],
          [1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
          [1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
          [1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
          [1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
          [0, 1, 1, 1, 1, 1, 1, 1, 1, 0],
        ],
        // y=4
        [
          [0, 0, 1, 1, 1, 1, 1, 1, 0, 0],
          [0, 1, 1, 1, 1, 1, 1, 1, 1, 0],
          [1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
          [1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
          [0, 1, 1, 1, 1, 1, 1, 1, 1, 0],
          [0, 0, 1, 1, 1, 1, 1, 1, 0, 0],
        ],
        // y=5 (top/back — rear voxels cleared to avoid z-fighting with tail)
        [
          [0, 0, 0, 1, 1, 1, 1, 0, 0, 0],
          [0, 0, 1, 1, 1, 1, 1, 1, 0, 0],
          [0, 0, 0, 1, 1, 1, 1, 1, 1, 0],
          [0, 0, 0, 1, 1, 1, 1, 1, 1, 0],
          [0, 0, 1, 1, 1, 1, 1, 1, 0, 0],
          [0, 0, 0, 1, 1, 1, 1, 0, 0, 0],
        ],
      ],
    },

    neck: {
      parent: 'body',
      // Body centerX=4.5. Neck at x=3 → near front of body (+X edge at 4.5)
      // y=5 → starts at body top. z=0 → centered on body.
      offset: [3, 5, 0],
      // 3w × 3d × 5h — neck column
      // centerX=1, centerZ=1
      layers: [
        // y=0 (neck base — wider)
        [
          [0, 1, 0],
          [1, 1, 1],
          [0, 1, 0],
        ],
        // y=1
        [
          [0, 1, 0],
          [1, 1, 1],
          [0, 1, 0],
        ],
        // y=2
        [
          [0, 1, 0],
          [1, 1, 1],
          [0, 1, 0],
        ],
        // y=3
        [
          [0, 1, 0],
          [1, 1, 1],
          [0, 1, 0],
        ],
        // y=4
        [
          [0, 1, 0],
          [1, 1, 1],
          [0, 1, 0],
        ],
      ],
    },

    head: {
      parent: 'neck',
      // Neck centerX=1. Head at x=1 → slightly forward. y=5 → on top of neck.
      offset: [1, 5, 0],
      // 5w × 3d × 3h — wider head with eyes and beak
      // centerX=2, centerZ=1
      // Bird faces +X: high X values = beak direction
      layers: [
        // y=0 (bottom of head)
        [
          [0, 1, 1, 0, 0],
          [1, 1, 1, 1, 0],
          [0, 1, 1, 0, 0],
        ],
        // y=1 (eyes + beak)
        [
          [0, 6, 1, 0, 0],
          [0, 1, 1, 4, 4],
          [0, 6, 1, 0, 0],
        ],
        // y=2 (top of head)
        [
          [0, 1, 1, 0, 0],
          [0, 1, 1, 0, 0],
          [0, 1, 1, 0, 0],
        ],
      ],
    },

    leftWing: {
      parent: 'body',
      // Body centerZ=2.5. Wing at z=+3 → just past left edge (character's left = +Z)
      // x=0 → centered on body. y=2 → slightly lower attachment for bigger wing.
      offset: [0, 2, 3],
      // 7w × 2d × 5h — mirrored wing (z-rows swapped vs right)
      // centerX=3, centerZ=0.5
      layers: [
        // y=0 (bottom — narrow tip)
        [
          [0, 0, 0, 3, 0, 0, 0],
          [0, 0, 3, 3, 3, 0, 0],
        ],
        // y=1
        [
          [0, 0, 3, 2, 1, 0, 0],
          [0, 3, 3, 2, 2, 1, 0],
        ],
        // y=2 (mid — wider)
        [
          [0, 3, 3, 2, 2, 1, 0],
          [3, 3, 2, 2, 1, 1, 1],
        ],
        // y=3
        [
          [0, 3, 2, 2, 1, 1, 0],
          [3, 3, 2, 1, 1, 1, 1],
        ],
        // y=4 (top — widest, connects to body)
        [
          [0, 3, 2, 1, 1, 1, 0],
          [3, 2, 2, 1, 1, 1, 1],
        ],
      ],
    },

    rightWing: {
      parent: 'body',
      // Mirror of leftWing at z=-3 (character's right = -Z)
      offset: [0, 2, -3],
      // 7w × 2d × 5h — wing with volume, tapers bottom to top
      // centerX=3, centerZ=0.5
      layers: [
        // y=0 (bottom — narrow tip)
        [
          [0, 0, 3, 3, 3, 0, 0],
          [0, 0, 0, 3, 0, 0, 0],
        ],
        // y=1
        [
          [0, 3, 3, 2, 2, 1, 0],
          [0, 0, 3, 2, 1, 0, 0],
        ],
        // y=2 (mid — wider)
        [
          [3, 3, 2, 2, 1, 1, 1],
          [0, 3, 3, 2, 2, 1, 0],
        ],
        // y=3
        [
          [3, 3, 2, 1, 1, 1, 1],
          [0, 3, 2, 2, 1, 1, 0],
        ],
        // y=4 (top — widest, connects to body)
        [
          [3, 2, 2, 1, 1, 1, 1],
          [0, 3, 2, 1, 1, 1, 0],
        ],
      ],
    },

    leftLeg: {
      parent: 'body',
      // Mirror of rightLeg at z=+1 (character's left = +Z)
      offset: [-1, -7, 1],
      // 3w × 3d × 8h — rotated so toes point +X (bird forward), knee bends -X
      layers: [
        // y=0 (toes)
        [
          [4, 4, 5],
          [4, 5, 0],
          [4, 4, 5],
        ],
        // y=1 (foot base)
        [
          [0, 0, 0],
          [4, 5, 0],
          [0, 0, 0],
        ],
        // y=2 (thin shin)
        [
          [0, 0, 0],
          [0, 4, 0],
          [0, 0, 0],
        ],
        // y=3 (thin shin)
        [
          [0, 0, 0],
          [0, 4, 0],
          [0, 0, 0],
        ],
        // y=4 (thin shin)
        [
          [0, 0, 0],
          [0, 4, 0],
          [0, 0, 0],
        ],
        // y=5 (backward knee)
        [
          [0, 0, 0],
          [5, 5, 0],
          [0, 0, 0],
        ],
        // y=6 (thigh)
        [
          [0, 0, 0],
          [4, 5, 0],
          [0, 0, 0],
        ],
        // y=7 (thigh top — connects to body)
        [
          [0, 5, 0],
          [5, 5, 0],
          [0, 5, 0],
        ],
      ],
    },

    rightLeg: {
      parent: 'body',
      // Body centerX=4.5. Leg at x=-1 → slightly toward rear.
      // y=-7 → below body (leg is 8h, top at y=0 meets body bottom area)
      // z=-1 → slightly to right of center (character's right = -Z)
      offset: [-1, -7, -1],
      // 3w × 3d × 8h — rotated so toes point +X (bird forward), knee bends -X
      layers: [
        // y=0 (toes — spreading forward toward +X)
        [
          [4, 4, 5],
          [4, 5, 0],
          [4, 4, 5],
        ],
        // y=1 (foot base)
        [
          [0, 0, 0],
          [4, 5, 0],
          [0, 0, 0],
        ],
        // y=2 (thin shin)
        [
          [0, 0, 0],
          [0, 4, 0],
          [0, 0, 0],
        ],
        // y=3 (thin shin)
        [
          [0, 0, 0],
          [0, 4, 0],
          [0, 0, 0],
        ],
        // y=4 (thin shin)
        [
          [0, 0, 0],
          [0, 4, 0],
          [0, 0, 0],
        ],
        // y=5 (backward knee — bends toward -X)
        [
          [0, 0, 0],
          [5, 5, 0],
          [0, 0, 0],
        ],
        // y=6 (thigh)
        [
          [0, 0, 0],
          [4, 5, 0],
          [0, 0, 0],
        ],
        // y=7 (thigh top — connects to body)
        [
          [0, 5, 0],
          [5, 5, 0],
          [0, 5, 0],
        ],
      ],
    },

    tail: {
      parent: 'body',
      // Body centerX=4.5. Tail at x=-4 → near rear (-X edge at -4.5)
      // y=5 → at body top
      offset: [-4, 5, 0],
      // 3w × 3d × 3h — tail feathers
      layers: [
        // y=0
        [
          [0, 7, 0],
          [7, 7, 7],
          [0, 7, 0],
        ],
        // y=1
        [
          [7, 7, 7],
          [0, 7, 0],
          [7, 7, 7],
        ],
        // y=2
        [
          [0, 7, 0],
          [0, 7, 0],
          [0, 7, 0],
        ],
      ],
    },
  },
};
