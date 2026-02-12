// Buzzard voxel model — dark vulture/condor mount for evil knights
// Same part names as ostrichModel for rig compatibility.
// Hunched silhouette, bald head, menacing wingspan.
// Coordinate system: layers[y][z][x] — y=0 is bottom of each part
// Left/right named from character's own perspective (facing +X):
//   character's right = -Z, character's left = +Z

export const buzzardModel = {
  palette: {
    1: '#2A2018',  // Dark brown body (primary)
    2: '#1A1410',  // Near-black shading
    3: '#0A0A0A',  // Black feather tips/edges
    4: '#CC3333',  // Red (wattle, head skin)
    5: '#882222',  // Dark red (beak, joints)
    6: '#FFD700',  // Yellow-gold (eyes)
    7: '#1A1410',  // Dark tail feathers
  },

  parts: {
    body: {
      offset: [0, 0, 0],
      // 10w × 6d × 6h — darker, hunched silhouette
      layers: [
        // y=0 (belly)
        [
          [0, 0, 0, 2, 2, 2, 2, 0, 0, 0],
          [0, 0, 2, 1, 1, 1, 1, 2, 0, 0],
          [0, 2, 1, 1, 1, 1, 1, 1, 2, 0],
          [0, 2, 1, 1, 1, 1, 1, 1, 2, 0],
          [0, 0, 2, 1, 1, 1, 1, 2, 0, 0],
          [0, 0, 0, 2, 2, 2, 2, 0, 0, 0],
        ],
        // y=1
        [
          [0, 0, 2, 2, 1, 1, 2, 2, 0, 0],
          [0, 2, 1, 1, 1, 1, 1, 1, 2, 0],
          [2, 1, 1, 1, 1, 1, 1, 1, 1, 2],
          [2, 1, 1, 1, 1, 1, 1, 1, 1, 2],
          [0, 2, 1, 1, 1, 1, 1, 1, 2, 0],
          [0, 0, 2, 2, 1, 1, 2, 2, 0, 0],
        ],
        // y=2 (widest)
        [
          [0, 2, 1, 1, 1, 1, 1, 1, 2, 0],
          [2, 1, 1, 1, 1, 1, 1, 1, 1, 2],
          [1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
          [1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
          [2, 1, 1, 1, 1, 1, 1, 1, 1, 2],
          [0, 2, 1, 1, 1, 1, 1, 1, 2, 0],
        ],
        // y=3
        [
          [0, 2, 1, 1, 1, 1, 1, 1, 2, 0],
          [2, 1, 1, 1, 1, 1, 1, 1, 1, 2],
          [1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
          [1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
          [2, 1, 1, 1, 1, 1, 1, 1, 1, 2],
          [0, 2, 1, 1, 1, 1, 1, 1, 2, 0],
        ],
        // y=4
        [
          [0, 0, 2, 1, 1, 1, 1, 2, 0, 0],
          [0, 2, 1, 1, 1, 1, 1, 1, 2, 0],
          [2, 1, 1, 1, 1, 1, 1, 1, 1, 2],
          [2, 1, 1, 1, 1, 1, 1, 1, 1, 2],
          [0, 2, 1, 1, 1, 1, 1, 1, 2, 0],
          [0, 0, 2, 1, 1, 1, 1, 2, 0, 0],
        ],
        // y=5 (top/back — rear cleared for tail)
        [
          [0, 0, 0, 2, 1, 1, 2, 0, 0, 0],
          [0, 0, 2, 1, 1, 1, 1, 2, 0, 0],
          [0, 0, 0, 1, 1, 1, 1, 1, 2, 0],
          [0, 0, 0, 1, 1, 1, 1, 1, 2, 0],
          [0, 0, 2, 1, 1, 1, 1, 2, 0, 0],
          [0, 0, 0, 2, 1, 1, 2, 0, 0, 0],
        ],
      ],
    },

    neck: {
      parent: 'body',
      // Cranes forward (+x) and drops low — predatory vulture posture
      offset: [4, 3, 0],
      // 3w × 3d × 4h — thicker, hunched vulture neck
      layers: [
        // y=0 (neck base — wider)
        [
          [0, 2, 0],
          [2, 1, 2],
          [0, 2, 0],
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
          [0, 2, 0],
          [2, 1, 2],
          [0, 2, 0],
        ],
      ],
    },

    head: {
      parent: 'neck',
      // Pushed forward and dropped — juts ahead of/below the lance
      offset: [2, 3, 0],
      // 5w × 3d × 3h — bald vulture head with red skin and hooked beak
      layers: [
        // y=0 (bottom of head)
        [
          [0, 4, 4, 0, 0],
          [4, 4, 4, 5, 0],
          [0, 4, 4, 0, 0],
        ],
        // y=1 (eyes + beak)
        [
          [0, 6, 4, 0, 0],
          [0, 4, 4, 5, 5],
          [0, 6, 4, 0, 0],
        ],
        // y=2 (top of head — bald)
        [
          [0, 4, 4, 0, 0],
          [0, 4, 4, 0, 0],
          [0, 4, 4, 0, 0],
        ],
      ],
    },

    leftWing: {
      parent: 'body',
      // One voxel wider than ostrich (8w instead of 7w) for menacing wingspan
      offset: [0, 0, 3],
      // 8w × 2d × 5h
      layers: [
        // y=0 (bottom — narrow tip)
        [
          [0, 0, 0, 0, 3, 0, 0, 0],
          [0, 0, 0, 3, 3, 3, 0, 0],
        ],
        // y=1
        [
          [0, 0, 0, 3, 2, 1, 0, 0],
          [0, 0, 3, 3, 2, 2, 1, 0],
        ],
        // y=2 (mid — wider)
        [
          [0, 0, 3, 3, 2, 2, 1, 0],
          [0, 3, 3, 2, 2, 1, 1, 1],
        ],
        // y=3
        [
          [0, 3, 3, 2, 2, 1, 1, 0],
          [3, 3, 2, 2, 1, 1, 1, 1],
        ],
        // y=4 (top — widest, connects to body)
        [
          [0, 3, 2, 2, 1, 1, 1, 0],
          [3, 3, 2, 1, 1, 1, 1, 1],
        ],
      ],
    },

    rightWing: {
      parent: 'body',
      // Mirror of leftWing at -Z
      offset: [0, 0, -3],
      // 8w × 2d × 5h
      layers: [
        // y=0 (bottom — narrow tip)
        [
          [0, 0, 0, 3, 3, 3, 0, 0],
          [0, 0, 0, 0, 3, 0, 0, 0],
        ],
        // y=1
        [
          [0, 0, 3, 3, 2, 2, 1, 0],
          [0, 0, 0, 3, 2, 1, 0, 0],
        ],
        // y=2 (mid — wider)
        [
          [0, 3, 3, 2, 2, 1, 1, 1],
          [0, 0, 3, 3, 2, 2, 1, 0],
        ],
        // y=3
        [
          [3, 3, 2, 2, 1, 1, 1, 1],
          [0, 3, 3, 2, 2, 1, 1, 0],
        ],
        // y=4 (top — widest, connects to body)
        [
          [3, 3, 2, 1, 1, 1, 1, 1],
          [0, 3, 2, 2, 1, 1, 1, 0],
        ],
      ],
    },

    leftThigh: {
      parent: 'body',
      // Same structure as ostrich, gray-brown legs
      offset: [-1, -2, 1],
      // 3w × 3d × 3h
      layers: [
        // y=0 (backward knee)
        [
          [0, 0, 0],
          [2, 2, 0],
          [0, 0, 0],
        ],
        // y=1 (thigh)
        [
          [0, 0, 0],
          [2, 2, 0],
          [0, 0, 0],
        ],
        // y=2 (thigh top — connects to body)
        [
          [0, 2, 0],
          [2, 2, 0],
          [0, 2, 0],
        ],
      ],
    },

    leftShin: {
      parent: 'leftThigh',
      // Dark gray claws instead of orange toes
      offset: [0, -5, 0],
      // 3w × 3d × 5h
      layers: [
        // y=0 (claws)
        [
          [3, 3, 2],
          [3, 2, 0],
          [3, 3, 2],
        ],
        // y=1 (foot base)
        [
          [0, 0, 0],
          [2, 2, 0],
          [0, 0, 0],
        ],
        // y=2 (thin shin)
        [
          [0, 0, 0],
          [0, 2, 0],
          [0, 0, 0],
        ],
        // y=3 (thin shin)
        [
          [0, 0, 0],
          [0, 2, 0],
          [0, 0, 0],
        ],
        // y=4 (thin shin top)
        [
          [0, 0, 0],
          [0, 2, 0],
          [0, 0, 0],
        ],
      ],
    },

    rightThigh: {
      parent: 'body',
      // Mirror of left
      offset: [-1, -2, -1],
      // 3w × 3d × 3h
      layers: [
        // y=0 (backward knee)
        [
          [0, 0, 0],
          [2, 2, 0],
          [0, 0, 0],
        ],
        // y=1 (thigh)
        [
          [0, 0, 0],
          [2, 2, 0],
          [0, 0, 0],
        ],
        // y=2 (thigh top — connects to body)
        [
          [0, 2, 0],
          [2, 2, 0],
          [0, 2, 0],
        ],
      ],
    },

    rightShin: {
      parent: 'rightThigh',
      // Dark gray claws
      offset: [0, -5, 0],
      // 3w × 3d × 5h
      layers: [
        // y=0 (claws)
        [
          [3, 3, 2],
          [3, 2, 0],
          [3, 3, 2],
        ],
        // y=1 (foot base)
        [
          [0, 0, 0],
          [2, 2, 0],
          [0, 0, 0],
        ],
        // y=2 (thin shin)
        [
          [0, 0, 0],
          [0, 2, 0],
          [0, 0, 0],
        ],
        // y=3 (thin shin)
        [
          [0, 0, 0],
          [0, 2, 0],
          [0, 0, 0],
        ],
        // y=4 (thin shin top)
        [
          [0, 0, 0],
          [0, 2, 0],
          [0, 0, 0],
        ],
      ],
    },

    tail: {
      parent: 'body',
      // Scraggly dark feathers at rear
      offset: [-4, 5, 0],
      // 3w × 3d × 3h
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
