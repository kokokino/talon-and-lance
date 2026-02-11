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

    // Knight hip pivots (riding pose)
    this._leftHipNode = null;
    this._rightHipNode = null;

    // Ostrich leg pivots (articulated gait)
    this._leftHipPivot = null;
    this._rightHipPivot = null;
    this._leftKneePivot = null;
    this._rightKneePivot = null;

    // Movement state
    this._positionX = 0;
    this._velocityX = 0;

    // Animation phase
    this._stridePhase = 0;
    this._elapsed = 0;

    // Base Y position for ostrich root (set during character creation)
    this._ostrichBaseY = 0;

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
    this._leftHipNode = null;
    this._rightHipNode = null;
    this._leftHipPivot = null;
    this._rightHipPivot = null;
    this._leftKneePivot = null;
    this._rightKneePivot = null;
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
    const VS = VOXEL_SIZE;

    // Build ostrich — faces +X by default
    this._ostrichRig = buildRig(this.scene, ostrichModel, VS);

    // Build knight with selected palette
    const mergedPalette = buildKnightPalette(this._paletteIndex);
    this._knightRig = buildRig(this.scene, { ...knightModel, palette: mergedPalette }, VS);

    // Build lance
    this._lanceRig = buildRig(this.scene, lanceModel, VS);

    const oParts = this._ostrichRig.parts;
    const kParts = this._knightRig.parts;

    // --- Ostrich leg pivots (articulated bird gait) ---
    this._setupOstrichLegPivots(oParts, VS);

    // --- Knight shoulder pivots (same pattern as MainMenuScene) ---
    if (kParts.leftArm && kParts.torso) {
      this._leftShoulderNode = new TransformNode('leftShoulder', this.scene);
      this._leftShoulderNode.parent = kParts.torso.mesh;
      this._leftShoulderNode.position = new Vector3(3 * VS, 4 * VS, 0);
      kParts.leftArm.mesh.parent = this._leftShoulderNode;
      kParts.leftArm.mesh.position = new Vector3(0, -4 * VS, 0);
      this._leftShoulderNode.rotation.x = Math.PI / 2;
      if (kParts.shield) {
        kParts.shield.mesh.rotation.x = -Math.PI / 2;
      }
    }

    if (kParts.rightArm && kParts.torso) {
      this._rightShoulderNode = new TransformNode('rightShoulder', this.scene);
      this._rightShoulderNode.parent = kParts.torso.mesh;
      this._rightShoulderNode.position = new Vector3(-3 * VS, 4 * VS, 0);
      kParts.rightArm.mesh.parent = this._rightShoulderNode;
      kParts.rightArm.mesh.position = new Vector3(0, -4 * VS, 0);
      this._rightShoulderNode.rotation.x = Math.PI / 2;
    }

    // --- Knight hip pivots (riding pose — legs angled forward) ---
    this._setupKnightHipPivots(kParts, VS);

    // --- Parent lance to right arm ---
    if (this._lanceRig.root && kParts.rightArm) {
      this._lanceRig.root.parent = kParts.rightArm.mesh;
      this._lanceRig.root.position = new Vector3(0, 0, 0);
      this._lanceRig.root.rotation.x = Math.PI;
    }

    // --- Mount knight on ostrich ---
    // Knight faces -Z, ostrich faces +X. Rotate knight -90deg around Y to align.
    if (this._knightRig.root && oParts.body) {
      this._knightRig.root.parent = oParts.body.mesh;
      this._knightRig.root.rotation.y = -Math.PI / 2;
      // Position knight so butt rests on ostrich's back (saddle area)
      this._knightRig.root.position = new Vector3(0, 5 * VS, 0);
    }

    // --- Position ostrich root so toes rest on platform surface ---
    // Chain: root → body → hipPivot → thigh → kneePivot → shin → toes
    // hipPivot y=0, thigh mesh y=-2*VS, kneePivot y=0, shin mesh y=-5*VS,
    // toe bottom face = shin y=0 center - 0.5*VS = -0.5*VS
    // Total toe bottom from body root: 0 + (-2) + 0 + (-5) + (-0.5) = -7.5 * VS
    const platformTop = this._platformY + 0.3;
    const ostrichRootY = platformTop + 7.5 * VS;

    this._ostrichBaseY = ostrichRootY;
    if (this._ostrichRig.root) {
      this._ostrichRig.root.position = new Vector3(0, ostrichRootY, 0);
    }

    this._positionX = 0;
    this._velocityX = 0;
  }

  _setupOstrichLegPivots(oParts, VS) {
    // Left leg: hip pivot at body surface where thigh attaches
    if (oParts.leftThigh && oParts.body) {
      this._leftHipPivot = new TransformNode('leftHipPivot', this.scene);
      this._leftHipPivot.parent = oParts.body.mesh;
      // Position at where thigh top meets body (thigh offset x=-1, z=1)
      this._leftHipPivot.position = new Vector3(-1 * VS, 0, 1 * VS);
      oParts.leftThigh.mesh.parent = this._leftHipPivot;
      // Offset thigh mesh so hip (y=2 top) aligns with pivot
      oParts.leftThigh.mesh.position = new Vector3(0, -2 * VS, 0);
    }

    if (oParts.leftShin && oParts.leftThigh) {
      this._leftKneePivot = new TransformNode('leftKneePivot', this.scene);
      this._leftKneePivot.parent = oParts.leftThigh.mesh;
      // Position at thigh's knee end (y=0 of thigh)
      this._leftKneePivot.position = new Vector3(0, 0, 0);
      oParts.leftShin.mesh.parent = this._leftKneePivot;
      // Offset shin so top (y=4) meets knee
      oParts.leftShin.mesh.position = new Vector3(0, -5 * VS, 0);
    }

    // Right leg: mirror of left
    if (oParts.rightThigh && oParts.body) {
      this._rightHipPivot = new TransformNode('rightHipPivot', this.scene);
      this._rightHipPivot.parent = oParts.body.mesh;
      this._rightHipPivot.position = new Vector3(-1 * VS, 0, -1 * VS);
      oParts.rightThigh.mesh.parent = this._rightHipPivot;
      oParts.rightThigh.mesh.position = new Vector3(0, -2 * VS, 0);
    }

    if (oParts.rightShin && oParts.rightThigh) {
      this._rightKneePivot = new TransformNode('rightKneePivot', this.scene);
      this._rightKneePivot.parent = oParts.rightThigh.mesh;
      this._rightKneePivot.position = new Vector3(0, 0, 0);
      oParts.rightShin.mesh.parent = this._rightKneePivot;
      oParts.rightShin.mesh.position = new Vector3(0, -5 * VS, 0);
    }
  }

  _setupKnightHipPivots(kParts, VS) {
    // Knight legs stick forward in riding pose.
    // After knight is rotated -π/2 on Y for mounting, knight's local Z aligns
    // with ostrich's forward direction (+X). So rotation.z on hip nodes swings
    // legs in the sagittal plane as seen from the side camera.
    if (kParts.leftLeg && kParts.torso) {
      this._leftHipNode = new TransformNode('knightLeftHip', this.scene);
      this._leftHipNode.parent = kParts.torso.mesh;
      this._leftHipNode.position = new Vector3(1 * VS, 0, 0);
      kParts.leftLeg.mesh.parent = this._leftHipNode;
      kParts.leftLeg.mesh.position = new Vector3(0, -6 * VS, 0);
      this._leftHipNode.rotation.z = Math.PI / 2.5;
    }

    if (kParts.rightLeg && kParts.torso) {
      this._rightHipNode = new TransformNode('knightRightHip', this.scene);
      this._rightHipNode.parent = kParts.torso.mesh;
      this._rightHipNode.position = new Vector3(-1 * VS, 0, 0);
      kParts.rightLeg.mesh.parent = this._rightHipNode;
      kParts.rightLeg.mesh.position = new Vector3(0, -6 * VS, 0);
      this._rightHipNode.rotation.z = Math.PI / 2.5;
    }
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
    const strideFreq = speedRatio * 2.0;
    this._stridePhase += strideFreq * dt;

    const p = this._stridePhase * Math.PI * 2;
    const amp = speedRatio; // All amplitudes scale with speed

    // ---- Ostrich legs: articulated bird gait via hip + knee pivots ----
    const HIP_AMP = 0.8;
    const KNEE_BASE = 0.3;
    const KNEE_AMP = 0.5;

    if (this._leftHipPivot) {
      this._leftHipPivot.rotation.z = Math.sin(p) * HIP_AMP * amp;
    }
    if (this._rightHipPivot) {
      this._rightHipPivot.rotation.z = Math.sin(p + Math.PI) * HIP_AMP * amp;
    }
    if (this._leftKneePivot) {
      this._leftKneePivot.rotation.z = (KNEE_BASE - Math.cos(p) * KNEE_AMP) * amp;
    }
    if (this._rightKneePivot) {
      this._rightKneePivot.rotation.z = (KNEE_BASE - Math.cos(p + Math.PI) * KNEE_AMP) * amp;
    }

    // ---- Ostrich body: vertical bob at double stride frequency ----
    if (oParts.body) {
      const bobAmount = Math.abs(Math.sin(p * 2)) * 0.05 * amp;
      oParts.body.mesh.position.y = this._ostrichBaseY + bobAmount;
    }

    // ---- Ostrich neck: forward-back bob synced to stride ----
    if (oParts.neck) {
      oParts.neck.mesh.rotation.z = Math.sin(p) * 0.12 * amp;
    }

    // ---- Ostrich wings: tucked with slight bounce ----
    const wingBounce = Math.abs(Math.sin(p * 2)) * 0.08 * amp;
    if (oParts.leftWing) {
      oParts.leftWing.mesh.rotation.z = wingBounce;
    }
    if (oParts.rightWing) {
      oParts.rightWing.mesh.rotation.z = -wingBounce;
    }

    // ---- Ostrich tail: slight wag ----
    if (oParts.tail) {
      oParts.tail.mesh.rotation.z = Math.sin(p * 1.5) * 0.1 * amp;
    }

    // ---- Knight: subtle bounce + arm sway (inherits ostrich motion via parenting) ----
    if (kParts) {
      if (kParts.torso) {
        kParts.torso.mesh.position.y = Math.abs(Math.sin(p * 2)) * 0.02 * amp;
      }
      if (kParts.head) {
        kParts.head.mesh.rotation.z = Math.sin(p) * 0.03 * amp;
      }
      if (this._leftShoulderNode) {
        this._leftShoulderNode.rotation.z = Math.sin(p + 0.5) * 0.04 * amp;
      }
      if (this._rightShoulderNode) {
        this._rightShoulderNode.rotation.z = Math.sin(p - 0.5) * 0.04 * amp;
      }
    }
  }
}
