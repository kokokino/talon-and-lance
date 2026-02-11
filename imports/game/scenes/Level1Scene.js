// Level1Scene — side-scrolling gameplay scene with a mounted knight+ostrich
// running across a stone platform with screen wrap.
// Receives Engine/Scene from BabylonPage — does not own them.

import { FreeCamera } from '@babylonjs/core/Cameras/freeCamera';
import { Camera } from '@babylonjs/core/Cameras/camera';
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight';
import { DirectionalLight } from '@babylonjs/core/Lights/directionalLight';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';

import { buildRig } from '../voxels/VoxelBuilder.js';
import { knightModel } from '../voxels/models/knightModel.js';
import { lanceModel } from '../voxels/models/lanceModel.js';
import { ostrichModel } from '../voxels/models/ostrichModel.js';
import { buildKnightPalette } from '../voxels/models/knightPalettes.js';

const VOXEL_SIZE = 0.18;

// Orthographic view bounds (world units)
const ORTHO_WIDTH = 20;    // 20 units wide (-10 to +10)
const ORTHO_LEFT = -ORTHO_WIDTH / 2;
const ORTHO_RIGHT = ORTHO_WIDTH / 2;

// Movement
const ACCELERATION = 2.0;   // units/sec^2
const MAX_SPEED = 6.0;      // units/sec

// Character half-width for wrap calculation (approximate from ostrich body ~10 voxels wide)
const CHAR_HALF_WIDTH = 10 * VOXEL_SIZE / 2;

export class Level1Scene {
  /**
   * @param {{ audioManager: AudioManager, paletteIndex: number }} config
   */
  constructor({ audioManager, paletteIndex }) {
    this._audioManager = audioManager;
    this._paletteIndex = paletteIndex;

    this.engine = null;
    this.scene = null;

    // Character rigs
    this._ostrichRig = null;
    this._knightRig = null;
    this._lanceRig = null;
    this._leftShoulderNode = null;
    this._rightShoulderNode = null;

    // Movement state
    this._positionX = 0;
    this._velocityX = 0;

    // Animation phase
    this._stridePhase = 0;
    this._elapsed = 0;

    // Ortho bounds (Y computed from aspect ratio)
    this._orthoBottom = 0;
    this._orthoTop = 0;
    this._platformY = 0;
  }

  /**
   * Build all scene content into the provided Scene.
   * @param {Scene} scene
   * @param {Engine} engine
   * @param {HTMLCanvasElement} canvas
   */
  create(scene, engine, canvas) {
    this.scene = scene;
    this.engine = engine;
    this.scene.clearColor = new Color4(0.06, 0.06, 0.12, 1); // Dark night sky

    this._setupCamera(canvas);
    this._setupLighting();
    this._createPlatform();
    this._createMountedCharacter();

    // Animation callback
    this.scene.onBeforeRenderObservable.add(() => {
      const dt = engine.getDeltaTime() / 1000;
      this._update(dt);
    });
  }

  /**
   * Dispose scene-specific resources.
   * Does NOT dispose Engine, audio, or the Scene itself — BabylonPage handles that.
   */
  dispose() {
    this._ostrichRig = null;
    this._knightRig = null;
    this._lanceRig = null;
    this._leftShoulderNode = null;
    this._rightShoulderNode = null;
    this.scene = null;
    this.engine = null;
  }

  // ---- Setup ----

  _setupCamera(canvas) {
    const camera = new FreeCamera('level1Camera', new Vector3(0, 0, -10), this.scene);
    camera.setTarget(new Vector3(0, 0, 0));
    camera.mode = Camera.ORTHOGRAPHIC_CAMERA;

    // Compute vertical bounds from aspect ratio
    const aspect = canvas.width / canvas.height;
    const orthoHalfHeight = (ORTHO_WIDTH / 2) / aspect;

    camera.orthoLeft = ORTHO_LEFT;
    camera.orthoRight = ORTHO_RIGHT;
    camera.orthoBottom = -orthoHalfHeight;
    camera.orthoTop = orthoHalfHeight;

    this._orthoBottom = -orthoHalfHeight;
    this._orthoTop = orthoHalfHeight;
    this._camera = camera;
  }

  _setupLighting() {
    // Ambient fill
    const ambient = new HemisphericLight('ambientLight', new Vector3(0, 1, 0), this.scene);
    ambient.intensity = 0.6;
    ambient.diffuse = new Color3(0.9, 0.9, 1.0);
    ambient.groundColor = new Color3(0.2, 0.2, 0.3);

    // Main directional light from upper-right
    const dirLight = new DirectionalLight('dirLight', new Vector3(-1, -2, 1), this.scene);
    dirLight.intensity = 0.8;
    dirLight.diffuse = new Color3(1.0, 0.95, 0.85);
  }

  _createPlatform() {
    // Platform spans full width + extra to cover edges during wrap
    const platformWidth = ORTHO_WIDTH + 4;
    const platformHeight = 0.6;
    // Platform sits at bottom of orthographic view
    this._platformY = this._orthoBottom + platformHeight / 2;

    const platform = MeshBuilder.CreateBox('platform', {
      width: platformWidth,
      height: platformHeight,
      depth: 2,
    }, this.scene);
    platform.position = new Vector3(0, this._platformY, 0);

    const mat = new StandardMaterial('platformMat', this.scene);
    mat.diffuseColor = new Color3(0.45, 0.40, 0.35);  // Gray-brown stone
    mat.specularColor = new Color3(0.1, 0.1, 0.1);
    mat.emissiveColor = new Color3(0.05, 0.04, 0.03);
    platform.material = mat;
  }

  _createMountedCharacter() {
    // Build ostrich — faces +X by default
    this._ostrichRig = buildRig(this.scene, ostrichModel, VOXEL_SIZE);

    // Build knight with selected palette
    const mergedPalette = buildKnightPalette(this._paletteIndex);
    this._knightRig = buildRig(this.scene, { ...knightModel, palette: mergedPalette }, VOXEL_SIZE);

    // Build lance
    this._lanceRig = buildRig(this.scene, lanceModel, VOXEL_SIZE);

    // --- Set up knight shoulder pivots (same pattern as MainMenuScene) ---
    const kParts = this._knightRig.parts;
    if (kParts.leftArm && kParts.torso) {
      this._leftShoulderNode = new TransformNode('leftShoulder', this.scene);
      this._leftShoulderNode.parent = kParts.torso.mesh;
      this._leftShoulderNode.position = new Vector3(
        3 * VOXEL_SIZE, 4 * VOXEL_SIZE, 0
      );
      kParts.leftArm.mesh.parent = this._leftShoulderNode;
      kParts.leftArm.mesh.position = new Vector3(0, -4 * VOXEL_SIZE, 0);
      this._leftShoulderNode.rotation.x = Math.PI / 2;
      if (kParts.shield) {
        kParts.shield.mesh.rotation.x = -Math.PI / 2;
      }
    }

    if (kParts.rightArm && kParts.torso) {
      this._rightShoulderNode = new TransformNode('rightShoulder', this.scene);
      this._rightShoulderNode.parent = kParts.torso.mesh;
      this._rightShoulderNode.position = new Vector3(
        -3 * VOXEL_SIZE, 4 * VOXEL_SIZE, 0
      );
      kParts.rightArm.mesh.parent = this._rightShoulderNode;
      kParts.rightArm.mesh.position = new Vector3(0, -4 * VOXEL_SIZE, 0);
      this._rightShoulderNode.rotation.x = Math.PI / 2;
    }

    // --- Parent lance to right arm ---
    if (this._lanceRig.root && kParts.rightArm) {
      this._lanceRig.root.parent = kParts.rightArm.mesh;
      this._lanceRig.root.position = new Vector3(0, 0, 0);
      this._lanceRig.root.rotation.x = Math.PI;
    }

    // --- Mount knight on ostrich ---
    // Knight faces -Z, ostrich faces +X. Rotate knight -90deg around Y to align.
    if (this._knightRig.root && this._ostrichRig.parts.body) {
      this._knightRig.root.parent = this._ostrichRig.parts.body.mesh;
      this._knightRig.root.rotation.y = -Math.PI / 2;
      // Position knight on top of ostrich body (body is 6 layers tall)
      this._knightRig.root.position = new Vector3(0, 5 * VOXEL_SIZE, 0);
    }

    // --- Position ostrich root at center of platform, feet on surface ---
    // Platform top = _platformY + 0.3 (half height). Ostrich legs offset y=-7 from body,
    // body is centered vertically across its 6 layers. Feet need to rest on platform top.
    // Ostrich body center is at offset 0. Legs extend 7 voxels below body, plus 8 voxels
    // tall leg = bottom at -7*voxelSize (offset) + 0 (bottom of leg part).
    // Leg offset is [-1, -7, ...], leg is 8h → feet at body_y + (-7)*voxelSize
    // Need: body_y + (-7)*voxelSize = platformTop
    const platformTop = this._platformY + 0.3;
    const feetOffsetFromBody = -7 * VOXEL_SIZE;
    const ostrichRootY = platformTop - feetOffsetFromBody;

    if (this._ostrichRig.root) {
      this._ostrichRig.root.position = new Vector3(0, ostrichRootY, 0);
    }

    this._positionX = 0;
    this._velocityX = 0;
  }

  // ---- Update loop ----

  _update(dt) {
    this._elapsed += dt;

    // Accelerate to max speed
    this._velocityX = Math.min(this._velocityX + ACCELERATION * dt, MAX_SPEED);
    this._positionX += this._velocityX * dt;

    // Screen wrap
    if (this._positionX > ORTHO_RIGHT + CHAR_HALF_WIDTH) {
      this._positionX = ORTHO_LEFT - CHAR_HALF_WIDTH;
    }

    // Update root position
    if (this._ostrichRig?.root) {
      this._ostrichRig.root.position.x = this._positionX;
    }

    // Animate running
    this._animateRunning(dt);
  }

  _animateRunning(dt) {
    const speedRatio = this._velocityX / MAX_SPEED;
    const oParts = this._ostrichRig?.parts;
    const kParts = this._knightRig?.parts;

    if (!oParts) {
      return;
    }

    // Stride frequency scales with speed (0 at rest, ~8 Hz at max)
    const strideFreq = speedRatio * 8.0;
    this._stridePhase += strideFreq * dt;

    const phase = this._stridePhase * Math.PI * 2;
    const amplitude = speedRatio; // All amplitudes scale with speed

    // ---- Ostrich legs: alternating swing ----
    const legSwing = Math.sin(phase) * 0.7 * amplitude;
    if (oParts.leftLeg) {
      oParts.leftLeg.mesh.rotation.x = legSwing;
    }
    if (oParts.rightLeg) {
      oParts.rightLeg.mesh.rotation.x = -legSwing;
    }

    // ---- Ostrich body: vertical bob at double stride frequency ----
    if (oParts.body) {
      const bobAmount = Math.abs(Math.sin(phase * 2)) * 0.05 * amplitude;
      oParts.body.mesh.position.y = bobAmount;
    }

    // ---- Ostrich neck: forward-back bob synced to stride ----
    if (oParts.neck) {
      oParts.neck.mesh.rotation.x = Math.sin(phase) * 0.12 * amplitude;
    }

    // ---- Ostrich wings: tucked with slight bounce ----
    const wingBounce = Math.abs(Math.sin(phase * 2)) * 0.08 * amplitude;
    if (oParts.leftWing) {
      oParts.leftWing.mesh.rotation.z = wingBounce;
    }
    if (oParts.rightWing) {
      oParts.rightWing.mesh.rotation.z = -wingBounce;
    }

    // ---- Ostrich tail: slight wag ----
    if (oParts.tail) {
      oParts.tail.mesh.rotation.z = Math.sin(phase * 1.5) * 0.1 * amplitude;
    }

    // ---- Knight: subtle bounce + arm sway (inherits ostrich motion via parenting) ----
    if (kParts) {
      if (kParts.torso) {
        kParts.torso.mesh.position.y = Math.abs(Math.sin(phase * 2)) * 0.02 * amplitude;
      }
      if (kParts.head) {
        kParts.head.mesh.rotation.x = Math.sin(phase) * 0.03 * amplitude;
      }
      if (this._leftShoulderNode) {
        this._leftShoulderNode.rotation.z = Math.sin(phase + 0.5) * 0.04 * amplitude;
      }
      if (this._rightShoulderNode) {
        this._rightShoulderNode.rotation.z = Math.sin(phase - 0.5) * 0.04 * amplitude;
      }
    }
  }
}
