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

import { InputReader } from '../InputReader.js';
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
const FRICTION = 3.0;       // units/sec^2 — coast deceleration (no input)
const SKID_DECEL = 8.0;     // units/sec^2 — deceleration when pressing opposite direction
const TURN_DURATION = 0.25; // seconds for 180-degree turn rotation

// Character half-width for wrap calculation (approximate from ostrich body ~10 voxels wide)
const CHAR_HALF_WIDTH = 10 * VOXEL_SIZE / 2;

// Flying physics
const GRAVITY = 12.0;           // units/sec^2
const FLAP_IMPULSE = 5.0;       // units/sec (set, not additive — matches Joust)
const TERMINAL_VELOCITY = 10.0;  // units/sec (max fall speed)
const AIR_FRICTION = 0.5;        // units/sec^2 (vs FRICTION on ground)

// Wing flap animation
const FLAP_DURATION = 0.25;      // seconds for one full flap cycle
const WING_UP_ANGLE = -1.2;      // radians (~70 deg spread upward)
const WING_DOWN_ANGLE = 0.4;     // radians (slight overshoot below rest)
const WING_GLIDE_ANGLE = -0.3;   // radians (slight spread while falling)

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

    // Wing pivots (shoulder joints for flap rotation)
    this._leftWingPivot = null;
    this._rightWingPivot = null;

    // Movement state
    this._positionX = 0;
    this._velocityX = 0;
    this._positionY = 0;
    this._velocityY = 0;
    this._playerState = 'GROUNDED'; // 'GROUNDED' or 'AIRBORNE'
    this._facingDir = 1;      // 1 = right, -1 = left
    this._isTurning = false;
    this._turnTimer = 0;
    this._turnFrom = 0;       // rotation.y start (radians)
    this._turnTo = 0;         // rotation.y end (radians)
    this._inputReader = null;

    // Animation phase
    this._stridePhase = 0;
    this._elapsed = 0;

    // Wing flap animation
    this._isFlapping = false;
    this._flapTimer = 0;

    // Base Y positions (set during character creation, used by animation bob)
    this._ostrichBaseY = 0;
    this._knightMountY = 0;

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

    // Input — attach to Babylon scene observable (not raw window events)
    this._inputReader = new InputReader();
    this._inputReader.attach(this.scene);

    // Ensure Babylon processes keyboard events (we don't call camera.attachControl)
    this.scene.attachControl();

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
    if (this._inputReader) {
      this._inputReader.detach();
      this._inputReader = null;
    }
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
    this._leftWingPivot = null;
    this._rightWingPivot = null;
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

    // --- Ostrich wing pivots (shoulder joints for flap rotation) ---
    this._setupOstrichWingPivots(oParts, VS);

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
      this._knightMountY = 5 * VS;
      this._knightRig.root.position = new Vector3(-1 * VS, this._knightMountY, 0);
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
    this._positionY = this._ostrichBaseY;
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

  _setupOstrichWingPivots(oParts, VS) {
    // Wing pivots at shoulder joint (y=4 of wing model = top attachment point).
    // Pivot sits at the shoulder position in body space so rotation.x sweeps
    // the wing up/down. Wing mesh is offset so its y=4 layer sits at pivot origin.
    if (oParts.leftWing && oParts.body) {
      this._leftWingPivot = new TransformNode('leftWingPivot', this.scene);
      this._leftWingPivot.parent = oParts.body.mesh;
      this._leftWingPivot.position = new Vector3(0, 4 * VS, 3 * VS);
      oParts.leftWing.mesh.parent = this._leftWingPivot;
      oParts.leftWing.mesh.position = new Vector3(0, -4 * VS, 0);
    }

    if (oParts.rightWing && oParts.body) {
      this._rightWingPivot = new TransformNode('rightWingPivot', this.scene);
      this._rightWingPivot.parent = oParts.body.mesh;
      this._rightWingPivot.position = new Vector3(0, 4 * VS, -3 * VS);
      oParts.rightWing.mesh.parent = this._rightWingPivot;
      oParts.rightWing.mesh.position = new Vector3(0, -4 * VS, 0);
    }
  }

  _setupKnightHipPivots(kParts, VS) {
    // Knight legs stick forward in riding pose.
    // Knight root has rotation.y = -π/2, which maps:
    //   local X → World +Z (depth), local Z → World -X (horizontal)
    // So rotation.x on hip nodes swings legs in the world X-Y plane (visible
    // from the side camera), with positive angles pushing legs forward (+X).
    if (kParts.leftLeg && kParts.torso) {
      this._leftHipNode = new TransformNode('knightLeftHip', this.scene);
      this._leftHipNode.parent = kParts.torso.mesh;
      this._leftHipNode.position = new Vector3(1 * VS, 0, 0);
      kParts.leftLeg.mesh.parent = this._leftHipNode;
      kParts.leftLeg.mesh.position = new Vector3(0, -6 * VS, 0);
      this._leftHipNode.rotation.x = Math.PI / 2.5;
    }

    if (kParts.rightLeg && kParts.torso) {
      this._rightHipNode = new TransformNode('knightRightHip', this.scene);
      this._rightHipNode.parent = kParts.torso.mesh;
      this._rightHipNode.position = new Vector3(-1 * VS, 0, 0);
      kParts.rightLeg.mesh.parent = this._rightHipNode;
      kParts.rightLeg.mesh.position = new Vector3(0, -6 * VS, 0);
      this._rightHipNode.rotation.x = Math.PI / 2.5;
    }
  }

  // ---- Update loop ----

  _update(dt) {
    this._elapsed += dt;

    // Sample input
    const input = this._inputReader ? this._inputReader.sample() : { left: false, right: false, flap: false };
    let inputDir = 0;
    if (input.right && !input.left) {
      inputDir = 1;
    } else if (input.left && !input.right) {
      inputDir = -1;
    }

    // Handle flap input — each press sets velocity (not additive, matches Joust)
    if (input.flap) {
      this._velocityY = FLAP_IMPULSE;
      this._playerState = 'AIRBORNE';
      this._isFlapping = true;
      this._flapTimer = 0;
    }

    // Horizontal physics — reduced friction and skid in air
    const isAirborne = this._playerState === 'AIRBORNE';
    const friction = isAirborne ? AIR_FRICTION : FRICTION;
    const skidDecel = isAirborne ? SKID_DECEL * 0.3 : SKID_DECEL;

    if (inputDir !== 0) {
      const movingOpposite = (this._velocityX > 0 && inputDir < 0) ||
                             (this._velocityX < 0 && inputDir > 0);
      if (movingOpposite) {
        this._velocityX += inputDir * skidDecel * dt;
      } else {
        this._velocityX += inputDir * ACCELERATION * dt;
      }
    } else {
      this._applyFriction(dt, friction);
    }

    // Clamp horizontal velocity
    this._velocityX = Math.max(-MAX_SPEED, Math.min(MAX_SPEED, this._velocityX));

    // Detect direction change (velocity crosses zero while input is held)
    if (inputDir !== 0 && inputDir !== this._facingDir) {
      if ((inputDir > 0 && this._velocityX >= 0) ||
          (inputDir < 0 && this._velocityX <= 0)) {
        this._startTurn(inputDir);
      }
    }

    // Vertical physics — gravity while airborne
    if (isAirborne) {
      this._velocityY -= GRAVITY * dt;
      if (this._velocityY < -TERMINAL_VELOCITY) {
        this._velocityY = -TERMINAL_VELOCITY;
      }
    }

    // Update positions
    this._positionX += this._velocityX * dt;
    this._positionY += this._velocityY * dt;

    // Ground collision
    if (this._positionY <= this._ostrichBaseY) {
      this._positionY = this._ostrichBaseY;
      this._velocityY = 0;
      this._playerState = 'GROUNDED';
    }

    // Ceiling clamp
    if (this._positionY > this._orthoTop - 1.0) {
      this._positionY = this._orthoTop - 1.0;
      this._velocityY = 0;
    }

    // Bidirectional screen wrap (X axis)
    if (this._positionX > ORTHO_RIGHT + CHAR_HALF_WIDTH) {
      this._positionX = ORTHO_LEFT - CHAR_HALF_WIDTH;
    } else if (this._positionX < ORTHO_LEFT - CHAR_HALF_WIDTH) {
      this._positionX = ORTHO_RIGHT + CHAR_HALF_WIDTH;
    }

    // Update root horizontal position
    if (this._ostrichRig?.root) {
      this._ostrichRig.root.position.x = this._positionX;
    }

    // Turn animation
    this._updateTurn(dt);

    // Body animation — grounded runs, airborne glides
    if (this._playerState === 'GROUNDED') {
      this._animateRunning(dt);
    } else {
      this._animateFlying(dt);
    }

    // Wing flap always runs (coexists with running bounce via separate rotation axes)
    this._animateWingFlap(dt);
  }

  _applyFriction(dt, friction) {
    if (this._velocityX > 0) {
      this._velocityX = Math.max(0, this._velocityX - friction * dt);
    } else if (this._velocityX < 0) {
      this._velocityX = Math.min(0, this._velocityX + friction * dt);
    }
  }

  _startTurn(newFacingDir) {
    this._facingDir = newFacingDir;
    this._isTurning = true;
    this._turnTimer = 0;
    if (newFacingDir === -1) {
      // Turning right → left
      this._turnFrom = 0;
      this._turnTo = Math.PI;
    } else {
      // Turning left → right
      this._turnFrom = Math.PI;
      this._turnTo = 0;
    }
  }

  _updateTurn(dt) {
    if (!this._isTurning || !this._ostrichRig?.root) {
      return;
    }

    this._turnTimer += dt;
    let t = this._turnTimer / TURN_DURATION;
    if (t >= 1.0) {
      t = 1.0;
      this._isTurning = false;
    }

    // Cosine ease-in-out
    const easedT = 0.5 - 0.5 * Math.cos(t * Math.PI);
    this._ostrichRig.root.rotation.y = this._turnFrom + (this._turnTo - this._turnFrom) * easedT;
  }

  _animateRunning(dt) {
    const speedRatio = Math.abs(this._velocityX) / MAX_SPEED;
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
      oParts.body.mesh.position.y = this._positionY + bobAmount;
    }

    // ---- Ostrich neck: forward-back bob synced to stride ----
    if (oParts.neck) {
      oParts.neck.mesh.rotation.z = Math.sin(p) * 0.12 * amp;
    }

    // ---- Ostrich wings: tucked with slight bounce (via pivots) ----
    const wingBounce = Math.abs(Math.sin(p * 2)) * 0.08 * amp;
    if (this._leftWingPivot) {
      this._leftWingPivot.rotation.z = wingBounce;
    }
    if (this._rightWingPivot) {
      this._rightWingPivot.rotation.z = -wingBounce;
    }

    // ---- Ostrich tail: slight wag ----
    if (oParts.tail) {
      oParts.tail.mesh.rotation.z = Math.sin(p * 1.5) * 0.1 * amp;
    }

    // ---- Knight: subtle bounce + arm sway (inherits ostrich motion via parenting) ----
    if (kParts) {
      if (kParts.torso) {
        kParts.torso.mesh.position.y = this._knightMountY + Math.abs(Math.sin(p * 2)) * 0.02 * amp;
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

  _animateWingFlap(dt) {
    // Update flap timer
    if (this._isFlapping) {
      this._flapTimer += dt;
      if (this._flapTimer >= FLAP_DURATION) {
        this._isFlapping = false;
        this._flapTimer = 0;
      }
    }

    let flapAngle = 0;

    if (this._isFlapping) {
      const t = this._flapTimer / FLAP_DURATION;

      if (t < 0.3) {
        // Rest to upstroke peak (ease-out sine)
        const phase = t / 0.3;
        const eased = Math.sin(phase * Math.PI / 2);
        flapAngle = eased * WING_UP_ANGLE;
      } else if (t < 0.7) {
        // Upstroke to downstroke — power stroke (cosine ease-in-out)
        const phase = (t - 0.3) / 0.4;
        const eased = 0.5 - 0.5 * Math.cos(phase * Math.PI);
        flapAngle = WING_UP_ANGLE + eased * (WING_DOWN_ANGLE - WING_UP_ANGLE);
      } else {
        // Downstroke back to rest (cosine ease-in-out)
        const phase = (t - 0.7) / 0.3;
        const eased = 0.5 - 0.5 * Math.cos(phase * Math.PI);
        flapAngle = WING_DOWN_ANGLE + eased * (0 - WING_DOWN_ANGLE);
      }
    } else if (this._playerState === 'AIRBORNE') {
      // Glide pose — wings slightly spread while falling
      flapAngle = WING_GLIDE_ANGLE;
    }
    // Grounded + not flapping: flapAngle stays 0 (rest position)

    // Apply to wing pivots (rotation.x for flap sweep, mirrored left/right)
    if (this._leftWingPivot) {
      this._leftWingPivot.rotation.x = flapAngle;
    }
    if (this._rightWingPivot) {
      this._rightWingPivot.rotation.x = -flapAngle;
    }
  }

  _animateFlying(dt) {
    const oParts = this._ostrichRig?.parts;
    const kParts = this._knightRig?.parts;

    if (!oParts) {
      return;
    }

    // Body: no bob, stable at flight position
    if (oParts.body) {
      oParts.body.mesh.position.y = this._positionY;
    }

    // Neck: slight backward lean
    if (oParts.neck) {
      oParts.neck.mesh.rotation.z = 0.1;
    }

    // Tail: slight backward trail
    if (oParts.tail) {
      oParts.tail.mesh.rotation.z = -0.15;
    }

    // Wings: no running bounce during flight (clear rotation.z)
    if (this._leftWingPivot) {
      this._leftWingPivot.rotation.z = 0;
    }
    if (this._rightWingPivot) {
      this._rightWingPivot.rotation.z = 0;
    }

    // Legs: tucked symmetrically
    this._animateTuckedLegs();

    // Knight: stable, no bounce or sway
    if (kParts) {
      if (kParts.torso) {
        kParts.torso.mesh.position.y = this._knightMountY;
      }
      if (kParts.head) {
        kParts.head.mesh.rotation.z = 0;
      }
      if (this._leftShoulderNode) {
        this._leftShoulderNode.rotation.z = 0;
      }
      if (this._rightShoulderNode) {
        this._rightShoulderNode.rotation.z = 0;
      }
    }
  }

  _animateTuckedLegs() {
    // Both legs identical — thighs swing backward, shins fold against thighs
    if (this._leftHipPivot) {
      this._leftHipPivot.rotation.z = -0.6;
    }
    if (this._rightHipPivot) {
      this._rightHipPivot.rotation.z = -0.6;
    }
    if (this._leftKneePivot) {
      this._leftKneePivot.rotation.z = 1.2;
    }
    if (this._rightKneePivot) {
      this._rightKneePivot.rotation.z = 1.2;
    }
  }
}
