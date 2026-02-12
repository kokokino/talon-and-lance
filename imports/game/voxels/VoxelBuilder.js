// VoxelBuilder — converts voxel model definitions into Babylon meshes
// Uses custom VertexData geometry that only emits exposed faces (no z-fighting).
// Adjacent voxels share coplanar faces which are culled automatically.

import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';

/**
 * Parse a hex color string to [r, g, b] floats
 */
function hexToRGB(hex) {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  return [r, g, b];
}

// Face definitions: [axis, sign, vertex offsets (4 corners), normal]
// Each face has 4 vertices forming a quad, wound counter-clockwise when viewed from outside
const FACES = [
  { // +X face
    normal: [1, 0, 0],
    verts: [[1,0,0], [1,1,0], [1,1,1], [1,0,1]],
  },
  { // -X face
    normal: [-1, 0, 0],
    verts: [[0,0,1], [0,1,1], [0,1,0], [0,0,0]],
  },
  { // +Y face
    normal: [0, 1, 0],
    verts: [[0,1,0], [0,1,1], [1,1,1], [1,1,0]],
  },
  { // -Y face
    normal: [0, -1, 0],
    verts: [[0,0,1], [0,0,0], [1,0,0], [1,0,1]],
  },
  { // +Z face
    normal: [0, 0, 1],
    verts: [[1,0,1], [1,1,1], [0,1,1], [0,0,1]],
  },
  { // -Z face
    normal: [0, 0, -1],
    verts: [[0,0,0], [0,1,0], [1,1,0], [1,0,0]],
  },
];

// Neighbor offsets matching FACES order: +X, -X, +Y, -Y, +Z, -Z
const NEIGHBOR_OFFSETS = [
  [1, 0, 0], [-1, 0, 0],
  [0, 1, 0], [0, -1, 0],
  [0, 0, 1], [0, 0, -1],
];

/**
 * Build a single body part as a custom mesh with only exposed faces.
 *
 * @param {Scene} scene - Babylon scene
 * @param {Object} partData - Part definition with layers array
 * @param {Object} palette - Color palette mapping index → hex string
 * @param {number} voxelSize - Size of each voxel cube in world units
 * @param {string} partName - Name for the mesh
 * @returns {{ mesh: Mesh, sps: null }}
 */
export function buildPart(scene, partData, palette, voxelSize, partName, isUnlit = false) {
  const { layers } = partData;
  const height = layers.length;
  if (height === 0) {
    return null;
  }

  const depth = layers[0].length;
  const width = layers[0][0].length;

  // Pre-compute RGB palette
  const colors = {};
  for (const [key, hex] of Object.entries(palette)) {
    colors[key] = hexToRGB(hex);
  }

  // O(1) voxel lookup — returns 0 for out-of-bounds
  const getVoxel = (x, y, z) => {
    if (x < 0 || x >= width || y < 0 || y >= height || z < 0 || z >= depth) {
      return 0;
    }
    return layers[y][z][x];
  };

  // Centering offsets (same as old SPS approach)
  const centerX = (width - 1) / 2;
  const centerZ = (depth - 1) / 2;

  // Collect vertex data arrays
  const positions = [];
  const normals = [];
  const vertColors = [];
  const indices = [];
  let vertCount = 0;
  let hasAnyVoxel = false;

  for (let y = 0; y < height; y++) {
    for (let z = 0; z < depth; z++) {
      for (let x = 0; x < width; x++) {
        const colorIndex = layers[y][z][x];
        if (colorIndex === 0) {
          continue;
        }
        hasAnyVoxel = true;

        const rgb = colors[colorIndex] || [1, 0, 1]; // magenta fallback
        const ox = (x - centerX) * voxelSize;
        const oy = y * voxelSize;
        const oz = (z - centerZ) * voxelSize;

        // Check each face direction
        for (let f = 0; f < 6; f++) {
          const [nx, ny, nz] = NEIGHBOR_OFFSETS[f];
          if (getVoxel(x + nx, y + ny, z + nz) !== 0) {
            continue; // Neighbor present — skip this face
          }

          const face = FACES[f];
          const baseIdx = vertCount;

          // Emit 4 vertices for this face quad
          for (let v = 0; v < 4; v++) {
            const [vx, vy, vz] = face.verts[v];
            positions.push(
              ox + (vx - 0.5) * voxelSize,
              oy + (vy - 0.5) * voxelSize,
              oz + (vz - 0.5) * voxelSize
            );
            normals.push(face.normal[0], face.normal[1], face.normal[2]);
            vertColors.push(rgb[0], rgb[1], rgb[2], 1);
          }

          // Two triangles for the quad (clockwise winding for Babylon left-handed)
          indices.push(
            baseIdx, baseIdx + 2, baseIdx + 1,
            baseIdx, baseIdx + 3, baseIdx + 2
          );
          vertCount += 4;
        }
      }
    }
  }

  if (!hasAnyVoxel) {
    return null;
  }

  // Build mesh from vertex data
  const mesh = new Mesh(`mesh_${partName}`, scene);
  const vertexData = new VertexData();
  vertexData.positions = new Float32Array(positions);
  vertexData.normals = new Float32Array(normals);
  vertexData.colors = new Float32Array(vertColors);
  vertexData.indices = new Uint32Array(indices);
  vertexData.applyToMesh(mesh);

  // Material with vertex colors
  const material = new StandardMaterial(`mat_${partName}`, scene);
  if (isUnlit) {
    material.disableLighting = true;
    material.emissiveColor = new Color3(1, 1, 1);
  } else {
    material.diffuseColor = new Color3(1, 1, 1);
    material.specularColor = new Color3(0.2, 0.2, 0.2);
  }
  mesh.material = material;
  mesh.hasVertexAlpha = false;

  return { mesh, sps: null };
}

/**
 * Build a full multi-part rig from a model definition.
 *
 * @param {Scene} scene - Babylon scene
 * @param {Object} modelDef - Model definition with palette and parts
 * @param {number} voxelSize - Size of each voxel cube in world units
 * @returns {{ root: Mesh, parts: Object.<string, { mesh: Mesh, sps: null }> }}
 */
export function buildRig(scene, modelDef, voxelSize, isUnlit = false) {
  const { palette, parts } = modelDef;
  const builtParts = {};

  // First pass: build all part meshes
  for (const [name, partData] of Object.entries(parts)) {
    const result = buildPart(scene, partData, palette, voxelSize, name, isUnlit);
    if (result) {
      builtParts[name] = result;
    }
  }

  // Second pass: set up parent-child hierarchy and offsets
  let rootMesh = null;
  for (const [name, partData] of Object.entries(parts)) {
    if (!builtParts[name]) {
      continue;
    }

    const built = builtParts[name];
    const offset = partData.offset || [0, 0, 0];

    if (partData.parent && builtParts[partData.parent]) {
      built.mesh.parent = builtParts[partData.parent].mesh;
    } else if (!rootMesh) {
      rootMesh = built.mesh;
    }

    built.mesh.position = new Vector3(
      offset[0] * voxelSize,
      offset[1] * voxelSize,
      offset[2] * voxelSize
    );
  }

  return { root: rootMesh, parts: builtParts };
}
