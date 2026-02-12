// Level1Scene — side-scrolling gameplay scene with mounted knight+bird characters.
// Supports player (ostrich) and evil knight (buzzard) with Up/Down arrow controls
// to toggle active character and cycle enemy type.
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
import { buzzardModel } from '../voxels/models/buzzardModel.js';
import { evilKnightModel } from '../voxels/models/evilKnightModel.js';
import { buildKnightPalette } from '../voxels/models/knightPalettes.js';
import { buildEvilKnightPalette } from '../voxels/models/evilKnightPalettes.js';

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

// Character half-width for wrap calculation (approximate from body ~10 voxels wide)
const CHAR_HALF_WIDTH = 10 * VOXEL_SIZE / 2;

// Flying physics
const GRAVITY = 12.0;           // units/sec^2
const FLAP_IMPULSE = 5.0;       // units/sec (set, not additive — matches Joust)
const TERMINAL_VELOCITY = 10.0;  // units/sec (max fall speed)
const AIR_FRICTION = 0.5;        // units/sec^2 (vs FRICTION on ground)

// Wing flap animation — ostrich (up/down rotation.x)
const FLAP_DURATION = 0.25;      // seconds for one full flap cycle
const WING_UP_ANGLE = -1.2;      // radians (~70 deg spread upward)
const WING_DOWN_ANGLE = 0.4;     // radians (slight overshoot below rest)
const WING_GLIDE_ANGLE = -0.3;   // radians (slight spread while falling)

// Wing sweep animation — buzzard (forward/backward rotation.z)
const SWEEP_FORWARD_ANGLE = 0.8;   // radians (wings sweep forward)
const SWEEP_BACKWARD_ANGLE = -0.6; // radians (wings sweep backward)
const SWEEP_GLIDE_ANGLE = 0.2;     // radians (slight forward hold)

/**
 * Create a fresh character state object with default values.
 */
function createCharState(wingMode) {
  return {
    birdRig: null,
    knightRig: null,
    lanceRig: null,
    leftShoulderNode: null,
    rightShoulderNode: null,
    leftHipNode: null,
    rightHipNode: null,
    leftHipPivot: null,
    rightHipPivot: null,
    leftKneePivot: null,
    rightKneePivot: null,
    leftWingPivot: null,
    rightWingPivot: null,
    positionX: 0,
    positionY: 0,
    velocityX: 0,
    velocityY: 0,
    playerState: 'GROUNDED',
    facingDir: 1,
    isTurning: false,
    turnTimer: 0,
    turnFrom: 0,
    turnTo: 0,
    stridePhase: 0,
    isFlapping: false,
    flapTimer: 0,
    baseY: 0,
    knightMountY: 0,
    wingMode: wingMode,  // 'updown' (ostrich) or 'sweep' (buzzard)
  };
}

export class Level1Scene {
  /**
   * @param {{ audioManager: AudioManager, paletteIndex: number }} config
   */
  constructor({ audioManager, paletteIndex }) {
    this._audioManager = audioManager;
    this._paletteIndex = paletteIndex;

    this.engine = null;
    this.scene = null;

    // Character state array: [0] = player, [1] = evil
    this._chars = [null, null];
    this._activeCharIdx = 0;
    this._evilTypeIndex = 0;

    this._inputReader = null;
    this._elapsed = 0;

    // Ortho bounds (Y computed from aspect ratio)
    this._orthoBottom = 0;
    this._orthoTop = 0;
    this._platformY = 0;
  }

  /**
   * Build all scene content into the provided Scene.
   */
  create(scene, engine, canvas) {
    this.scene = scene;
    this.engine = engine;
    this.scene.clearColor = new Color4(0.06, 0.06, 0.12, 1);

    this._setupCamera(canvas);
    this._setupLighting();
    this._createPlatform();
    this._createCharacters();

    // Input
    this._inputReader = new InputReader();
    this._inputReader.attach(this.scene);
    this.scene.attachControl();

    // Animation callback
    this.scene.onBeforeRenderObservable.add(() => {
      const dt = engine.getDeltaTime() / 1000;
      this._update(dt);
    });
  }

  dispose() {
    if (this._inputReader) {
      this._inputReader.detach();
      this._inputReader = null;
    }
    this._chars = [null, null];
    this.scene = null;
    this.engine = null;
  }

  // ---- Setup ----

  _setupCamera(canvas) {
    const camera = new FreeCamera('level1Camera', new Vector3(0, 0, -10), this.scene);
    camera.setTarget(new Vector3(0, 0, 0));
    camera.mode = Camera.ORTHOGRAPHIC_CAMERA;

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
    const ambient = new HemisphericLight('ambientLight', new Vector3(0, 1, 0), this.scene);
    ambient.intensity = 0.6;
    ambient.diffuse = new Color3(0.9, 0.9, 1.0);
    ambient.groundColor = new Color3(0.2, 0.2, 0.3);

    const dirLight = new DirectionalLight('dirLight', new Vector3(-1, -2, 1), this.scene);
    dirLight.intensity = 0.8;
    dirLight.diffuse = new Color3(1.0, 0.95, 0.85);
  }

  _createPlatform() {
    const platformWidth = ORTHO_WIDTH + 4;
    const platformHeight = 0.6;
    this._platformY = this._orthoBottom + platformHeight / 2;

    const platform = MeshBuilder.CreateBox('platform', {
      width: platformWidth,
      height: platformHeight,
      depth: 2,
    }, this.scene);
    platform.position = new Vector3(0, this._platformY, 0);

    const mat = new StandardMaterial('platformMat', this.scene);
    mat.diffuseColor = new Color3(0.45, 0.40, 0.35);
    mat.specularColor = new Color3(0.1, 0.1, 0.1);
    mat.emissiveColor = new Color3(0.05, 0.04, 0.03);
    platform.material = mat;
  }

  _createCharacters() {
    const VS = VOXEL_SIZE;
    const platformTop = this._platformY + 0.3;
    const baseY = platformTop + 7.5 * VS;

    // --- Player character (knight on ostrich) ---
    const player = createCharState('updown');
    player.birdRig = buildRig(this.scene, ostrichModel, VS);
    const mergedPalette = buildKnightPalette(this._paletteIndex);
    player.knightRig = buildRig(this.scene, { ...knightModel, palette: mergedPalette }, VS);
    player.lanceRig = buildRig(this.scene, lanceModel, VS);
    this._assembleCharacter(player, VS);
    player.baseY = baseY;
    player.positionX = -3;
    player.positionY = baseY;
    if (player.birdRig.root) {
      player.birdRig.root.position = new Vector3(player.positionX, baseY, 0);
    }
    this._chars[0] = player;

    // --- Evil character (evil knight on buzzard) ---
    this._buildEvilCharacter(VS, baseY);
  }

  _buildEvilCharacter(VS, baseY) {
    const evil = createCharState('sweep');
    evil.birdRig = buildRig(this.scene, buzzardModel, VS);
    const evilPalette = buildEvilKnightPalette(this._evilTypeIndex);
    evil.knightRig = buildRig(this.scene, { ...evilKnightModel, palette: evilPalette }, VS);
    evil.lanceRig = buildRig(this.scene, lanceModel, VS);
    this._assembleCharacter(evil, VS);
    evil.baseY = baseY;
    evil.positionX = 3;
    evil.positionY = baseY;
    if (evil.birdRig.root) {
      evil.birdRig.root.position = new Vector3(evil.positionX, baseY, 0);
    }
    this._chars[1] = evil;
  }

  _assembleCharacter(char, VS) {
    const bParts = char.birdRig.parts;
    const kParts = char.knightRig.parts;

    // Bird leg pivots
    this._setupBirdLegPivots(char, bParts, VS);

    // Bird wing pivots
    this._setupBirdWingPivots(char, bParts, VS);

    // Knight shoulder pivots
    this._setupKnightShoulders(char, kParts, VS);

    // Knight hip pivots (riding pose)
    this._setupKnightHipPivots(char, kParts, VS);

    // Parent lance to right arm
    if (char.lanceRig.root && kParts.rightArm) {
      char.lanceRig.root.parent = kParts.rightArm.mesh;
      char.lanceRig.root.position = new Vector3(0, 0, 0);
      char.lanceRig.root.rotation.x = Math.PI;
    }

    // Mount knight on bird
    if (char.knightRig.root && bParts.body) {
      char.knightRig.root.parent = bParts.body.mesh;
      char.knightRig.root.rotation.y = -Math.PI / 2;
      char.knightMountY = 5 * VS;
      char.knightRig.root.position = new Vector3(-1 * VS, char.knightMountY, 0);
    }
  }

  _setupBirdLegPivots(char, bParts, VS) {
    // Left leg: hip pivot at body surface where thigh attaches
    if (bParts.leftThigh && bParts.body) {
      char.leftHipPivot = new TransformNode('leftHipPivot', this.scene);
      char.leftHipPivot.parent = bParts.body.mesh;
      char.leftHipPivot.position = new Vector3(-1 * VS, 0, 1 * VS);
      bParts.leftThigh.mesh.parent = char.leftHipPivot;
      bParts.leftThigh.mesh.position = new Vector3(0, -2 * VS, 0);
    }

    if (bParts.leftShin && bParts.leftThigh) {
      char.leftKneePivot = new TransformNode('leftKneePivot', this.scene);
      char.leftKneePivot.parent = bParts.leftThigh.mesh;
      char.leftKneePivot.position = new Vector3(0, 0, 0);
      bParts.leftShin.mesh.parent = char.leftKneePivot;
      bParts.leftShin.mesh.position = new Vector3(0, -5 * VS, 0);
    }

    // Right leg: mirror of left
    if (bParts.rightThigh && bParts.body) {
      char.rightHipPivot = new TransformNode('rightHipPivot', this.scene);
      char.rightHipPivot.parent = bParts.body.mesh;
      char.rightHipPivot.position = new Vector3(-1 * VS, 0, -1 * VS);
      bParts.rightThigh.mesh.parent = char.rightHipPivot;
      bParts.rightThigh.mesh.position = new Vector3(0, -2 * VS, 0);
    }

    if (bParts.rightShin && bParts.rightThigh) {
      char.rightKneePivot = new TransformNode('rightKneePivot', this.scene);
      char.rightKneePivot.parent = bParts.rightThigh.mesh;
      char.rightKneePivot.position = new Vector3(0, 0, 0);
      bParts.rightShin.mesh.parent = char.rightKneePivot;
      bParts.rightShin.mesh.position = new Vector3(0, -5 * VS, 0);
    }
  }

  _setupBirdWingPivots(char, bParts, VS) {
    if (bParts.leftWing && bParts.body) {
      char.leftWingPivot = new TransformNode('leftWingPivot', this.scene);
      char.leftWingPivot.parent = bParts.body.mesh;
      char.leftWingPivot.position = new Vector3(0, 4 * VS, 3 * VS);
      bParts.leftWing.mesh.parent = char.leftWingPivot;
      bParts.leftWing.mesh.position = new Vector3(0, -4 * VS, 0);
    }

    if (bParts.rightWing && bParts.body) {
      char.rightWingPivot = new TransformNode('rightWingPivot', this.scene);
      char.rightWingPivot.parent = bParts.body.mesh;
      char.rightWingPivot.position = new Vector3(0, 4 * VS, -3 * VS);
      bParts.rightWing.mesh.parent = char.rightWingPivot;
      bParts.rightWing.mesh.position = new Vector3(0, -4 * VS, 0);
    }
  }

  _setupKnightShoulders(char, kParts, VS) {
    if (kParts.leftArm && kParts.torso) {
      char.leftShoulderNode = new TransformNode('leftShoulder', this.scene);
      char.leftShoulderNode.parent = kParts.torso.mesh;
      char.leftShoulderNode.position = new Vector3(3 * VS, 4 * VS, 0);
      kParts.leftArm.mesh.parent = char.leftShoulderNode;
      kParts.leftArm.mesh.position = new Vector3(0, -4 * VS, 0);
      char.leftShoulderNode.rotation.x = Math.PI / 2;
      if (kParts.shield) {
        kParts.shield.mesh.rotation.x = -Math.PI / 2;
      }
    }

    if (kParts.rightArm && kParts.torso) {
      char.rightShoulderNode = new TransformNode('rightShoulder', this.scene);
      char.rightShoulderNode.parent = kParts.torso.mesh;
      char.rightShoulderNode.position = new Vector3(-3 * VS, 4 * VS, 0);
      kParts.rightArm.mesh.parent = char.rightShoulderNode;
      kParts.rightArm.mesh.position = new Vector3(0, -4 * VS, 0);
      char.rightShoulderNode.rotation.x = Math.PI / 2;
    }
  }

  _setupKnightHipPivots(char, kParts, VS) {
    if (kParts.leftLeg && kParts.torso) {
      char.leftHipNode = new TransformNode('knightLeftHip', this.scene);
      char.leftHipNode.parent = kParts.torso.mesh;
      char.leftHipNode.position = new Vector3(1 * VS, 0, 0);
      kParts.leftLeg.mesh.parent = char.leftHipNode;
      kParts.leftLeg.mesh.position = new Vector3(0, -6 * VS, 0);
      char.leftHipNode.rotation.x = Math.PI / 2.5;
    }

    if (kParts.rightLeg && kParts.torso) {
      char.rightHipNode = new TransformNode('knightRightHip', this.scene);
      char.rightHipNode.parent = kParts.torso.mesh;
      char.rightHipNode.position = new Vector3(-1 * VS, 0, 0);
      kParts.rightLeg.mesh.parent = char.rightHipNode;
      kParts.rightLeg.mesh.position = new Vector3(0, -6 * VS, 0);
      char.rightHipNode.rotation.x = Math.PI / 2.5;
    }
  }

  // ---- Update loop ----

  _update(dt) {
    this._elapsed += dt;

    const input = this._inputReader
      ? this._inputReader.sample()
      : { left: false, right: false, flap: false, switchChar: false, cycleType: false };

    // Toggle active character
    if (input.switchChar) {
      this._activeCharIdx = this._activeCharIdx === 0 ? 1 : 0;
    }

    // Cycle evil knight type
    if (input.cycleType) {
      this._cycleEvilType();
    }

    // Apply input to active character, idle physics to inactive
    for (let i = 0; i < 2; i++) {
      const char = this._chars[i];
      if (!char) {
        continue;
      }

      if (i === this._activeCharIdx) {
        this._updateCharWithInput(dt, char, input);
      } else {
        this._updateCharIdle(dt, char);
      }

      this._animateChar(dt, char);
    }
  }

  _updateCharWithInput(dt, char, input) {
    let inputDir = 0;
    if (input.right && !input.left) {
      inputDir = 1;
    } else if (input.left && !input.right) {
      inputDir = -1;
    }

    // Handle flap
    if (input.flap) {
      char.velocityY = FLAP_IMPULSE;
      char.playerState = 'AIRBORNE';
      char.isFlapping = true;
      char.flapTimer = 0;
    }

    // Horizontal physics
    const isAirborne = char.playerState === 'AIRBORNE';
    const friction = isAirborne ? AIR_FRICTION : FRICTION;
    const skidDecel = isAirborne ? SKID_DECEL * 0.3 : SKID_DECEL;

    if (inputDir !== 0) {
      const movingOpposite = (char.velocityX > 0 && inputDir < 0) ||
                             (char.velocityX < 0 && inputDir > 0);
      if (movingOpposite) {
        char.velocityX += inputDir * skidDecel * dt;
      } else {
        char.velocityX += inputDir * ACCELERATION * dt;
      }
    } else {
      this._applyFriction(dt, char, friction);
    }

    char.velocityX = Math.max(-MAX_SPEED, Math.min(MAX_SPEED, char.velocityX));

    // Detect direction change
    if (inputDir !== 0 && inputDir !== char.facingDir) {
      if (isAirborne ||
          (inputDir > 0 && char.velocityX >= 0) ||
          (inputDir < 0 && char.velocityX <= 0)) {
        this._startTurn(char, inputDir);
      }
    }

    // Vertical physics
    this._applyVerticalPhysics(dt, char);

    // Update positions
    this._applyPositionAndWrap(dt, char);
  }

  _updateCharIdle(dt, char) {
    // No input — just friction + gravity
    const isAirborne = char.playerState === 'AIRBORNE';
    const friction = isAirborne ? AIR_FRICTION : FRICTION;
    this._applyFriction(dt, char, friction);

    this._applyVerticalPhysics(dt, char);
    this._applyPositionAndWrap(dt, char);
  }

  _applyFriction(dt, char, friction) {
    if (char.velocityX > 0) {
      char.velocityX = Math.max(0, char.velocityX - friction * dt);
    } else if (char.velocityX < 0) {
      char.velocityX = Math.min(0, char.velocityX + friction * dt);
    }
  }

  _applyVerticalPhysics(dt, char) {
    if (char.playerState === 'AIRBORNE') {
      char.velocityY -= GRAVITY * dt;
      if (char.velocityY < -TERMINAL_VELOCITY) {
        char.velocityY = -TERMINAL_VELOCITY;
      }
    }
  }

  _applyPositionAndWrap(dt, char) {
    char.positionX += char.velocityX * dt;
    char.positionY += char.velocityY * dt;

    // Ground collision
    if (char.positionY <= char.baseY) {
      char.positionY = char.baseY;
      char.velocityY = 0;
      char.playerState = 'GROUNDED';
    }

    // Ceiling clamp
    if (char.positionY > this._orthoTop - 1.0) {
      char.positionY = this._orthoTop - 1.0;
      char.velocityY = 0;
    }

    // Screen wrap
    if (char.positionX > ORTHO_RIGHT + CHAR_HALF_WIDTH) {
      char.positionX = ORTHO_LEFT - CHAR_HALF_WIDTH;
    } else if (char.positionX < ORTHO_LEFT - CHAR_HALF_WIDTH) {
      char.positionX = ORTHO_RIGHT + CHAR_HALF_WIDTH;
    }

    // Update root position
    if (char.birdRig?.root) {
      char.birdRig.root.position.x = char.positionX;
    }

    // Turn animation
    this._updateTurn(dt, char);
  }

  _startTurn(char, newFacingDir) {
    char.facingDir = newFacingDir;
    char.isTurning = true;
    char.turnTimer = 0;
    if (newFacingDir === -1) {
      char.turnFrom = 0;
      char.turnTo = Math.PI;
    } else {
      char.turnFrom = Math.PI;
      char.turnTo = 0;
    }
  }

  _updateTurn(dt, char) {
    if (!char.isTurning || !char.birdRig?.root) {
      return;
    }

    char.turnTimer += dt;
    let t = char.turnTimer / TURN_DURATION;
    if (t >= 1.0) {
      t = 1.0;
      char.isTurning = false;
    }

    const easedT = 0.5 - 0.5 * Math.cos(t * Math.PI);
    char.birdRig.root.rotation.y = char.turnFrom + (char.turnTo - char.turnFrom) * easedT;
  }

  // ---- Animation ----

  _animateChar(dt, char) {
    // Wing flap always runs
    this._animateWingFlap(dt, char);

    if (char.playerState === 'GROUNDED') {
      this._animateRunning(dt, char);
    } else {
      this._animateFlying(dt, char);
    }
  }

  _animateRunning(dt, char) {
    const speedRatio = Math.abs(char.velocityX) / MAX_SPEED;
    const bParts = char.birdRig?.parts;
    const kParts = char.knightRig?.parts;

    if (!bParts) {
      return;
    }

    // Stride frequency scales with speed
    const strideFreq = speedRatio * 2.0;
    char.stridePhase += strideFreq * dt;

    const p = char.stridePhase * Math.PI * 2;
    const amp = speedRatio;

    // Bird legs: articulated gait via hip + knee pivots
    const HIP_AMP = 0.8;
    const KNEE_BASE = 0.3;
    const KNEE_AMP = 0.5;

    if (char.leftHipPivot) {
      char.leftHipPivot.rotation.z = Math.sin(p) * HIP_AMP * amp;
      char.leftHipPivot.position.y = 0;
    }
    if (char.rightHipPivot) {
      char.rightHipPivot.rotation.z = Math.sin(p + Math.PI) * HIP_AMP * amp;
      char.rightHipPivot.position.y = 0;
    }
    if (char.leftKneePivot) {
      char.leftKneePivot.rotation.z = (KNEE_BASE - Math.cos(p) * KNEE_AMP) * amp;
    }
    if (char.rightKneePivot) {
      char.rightKneePivot.rotation.z = (KNEE_BASE - Math.cos(p + Math.PI) * KNEE_AMP) * amp;
    }

    // Body: vertical bob at double stride frequency
    if (bParts.body) {
      const bobAmount = Math.abs(Math.sin(p * 2)) * 0.05 * amp;
      bParts.body.mesh.position.y = char.positionY + bobAmount;
    }

    // Neck: forward-back bob
    if (bParts.neck) {
      bParts.neck.mesh.rotation.z = Math.sin(p) * 0.12 * amp;
    }

    // Wings: tucked with slight bounce (via pivots, rotation.z)
    const wingBounce = Math.abs(Math.sin(p * 2)) * 0.08 * amp;
    if (char.leftWingPivot) {
      char.leftWingPivot.rotation.z = wingBounce;
    }
    if (char.rightWingPivot) {
      char.rightWingPivot.rotation.z = -wingBounce;
    }

    // Tail: slight wag
    if (bParts.tail) {
      bParts.tail.mesh.rotation.z = Math.sin(p * 1.5) * 0.1 * amp;
    }

    // Knight: subtle bounce + arm sway
    if (kParts) {
      if (kParts.torso) {
        kParts.torso.mesh.position.y = char.knightMountY + Math.abs(Math.sin(p * 2)) * 0.02 * amp;
      }
      if (kParts.head) {
        kParts.head.mesh.rotation.z = Math.sin(p) * 0.03 * amp;
      }
      if (char.leftShoulderNode) {
        char.leftShoulderNode.rotation.z = Math.sin(p + 0.5) * 0.04 * amp;
      }
      if (char.rightShoulderNode) {
        char.rightShoulderNode.rotation.z = Math.sin(p - 0.5) * 0.04 * amp;
      }
    }
  }

  _animateWingFlap(dt, char) {
    // Update flap timer
    if (char.isFlapping) {
      char.flapTimer += dt;
      if (char.flapTimer >= FLAP_DURATION) {
        char.isFlapping = false;
        char.flapTimer = 0;
      }
    }

    if (char.wingMode === 'updown') {
      this._animateWingFlapUpDown(char);
    } else {
      this._animateWingFlapSweep(char);
    }
  }

  _animateWingFlapUpDown(char) {
    let flapAngle = 0;

    if (char.isFlapping) {
      const t = char.flapTimer / FLAP_DURATION;

      if (t < 0.3) {
        const phase = t / 0.3;
        const eased = Math.sin(phase * Math.PI / 2);
        flapAngle = eased * WING_UP_ANGLE;
      } else if (t < 0.7) {
        const phase = (t - 0.3) / 0.4;
        const eased = 0.5 - 0.5 * Math.cos(phase * Math.PI);
        flapAngle = WING_UP_ANGLE + eased * (WING_DOWN_ANGLE - WING_UP_ANGLE);
      } else {
        const phase = (t - 0.7) / 0.3;
        const eased = 0.5 - 0.5 * Math.cos(phase * Math.PI);
        flapAngle = WING_DOWN_ANGLE + eased * (0 - WING_DOWN_ANGLE);
      }
    } else if (char.playerState === 'AIRBORNE') {
      flapAngle = WING_GLIDE_ANGLE;
    }

    // Apply to wing pivots (rotation.x, mirrored left/right)
    if (char.leftWingPivot) {
      char.leftWingPivot.rotation.x = flapAngle;
    }
    if (char.rightWingPivot) {
      char.rightWingPivot.rotation.x = -flapAngle;
    }
  }

  _animateWingFlapSweep(char) {
    let sweepAngle = 0;

    if (char.isFlapping) {
      const t = char.flapTimer / FLAP_DURATION;

      if (t < 0.3) {
        // Rest to forward sweep (ease-out sine)
        const phase = t / 0.3;
        const eased = Math.sin(phase * Math.PI / 2);
        sweepAngle = eased * SWEEP_FORWARD_ANGLE;
      } else if (t < 0.7) {
        // Forward to backward — power stroke (cosine ease-in-out)
        const phase = (t - 0.3) / 0.4;
        const eased = 0.5 - 0.5 * Math.cos(phase * Math.PI);
        sweepAngle = SWEEP_FORWARD_ANGLE + eased * (SWEEP_BACKWARD_ANGLE - SWEEP_FORWARD_ANGLE);
      } else {
        // Backward back to rest (cosine ease-in-out)
        const phase = (t - 0.7) / 0.3;
        const eased = 0.5 - 0.5 * Math.cos(phase * Math.PI);
        sweepAngle = SWEEP_BACKWARD_ANGLE + eased * (0 - SWEEP_BACKWARD_ANGLE);
      }
    } else if (char.playerState === 'AIRBORNE') {
      sweepAngle = SWEEP_GLIDE_ANGLE;
    }

    // Buzzard sweep: both wings move in same direction (synchronized rowing)
    if (char.leftWingPivot) {
      char.leftWingPivot.rotation.z = sweepAngle;
    }
    if (char.rightWingPivot) {
      char.rightWingPivot.rotation.z = sweepAngle;
    }
  }

  _animateFlying(dt, char) {
    const bParts = char.birdRig?.parts;
    const kParts = char.knightRig?.parts;

    if (!bParts) {
      return;
    }

    // Body: stable at flight position
    if (bParts.body) {
      bParts.body.mesh.position.y = char.positionY;
    }

    // Neck: slight backward lean
    if (bParts.neck) {
      bParts.neck.mesh.rotation.z = 0.1;
    }

    // Tail: slight backward trail
    if (bParts.tail) {
      bParts.tail.mesh.rotation.z = -0.15;
    }

    // Wings: clear running bounce (rotation.z handled by flap/sweep animation)
    // Only clear if using updown mode (sweep mode uses rotation.z for its animation)
    if (char.wingMode === 'updown') {
      if (char.leftWingPivot) {
        char.leftWingPivot.rotation.z = 0;
      }
      if (char.rightWingPivot) {
        char.rightWingPivot.rotation.z = 0;
      }
    }

    // Legs: tucked symmetrically
    this._animateTuckedLegs(char);

    // Knight: stable
    if (kParts) {
      if (kParts.torso) {
        kParts.torso.mesh.position.y = char.knightMountY;
      }
      if (kParts.head) {
        kParts.head.mesh.rotation.z = 0;
      }
      if (char.leftShoulderNode) {
        char.leftShoulderNode.rotation.z = 0;
      }
      if (char.rightShoulderNode) {
        char.rightShoulderNode.rotation.z = 0;
      }
    }
  }

  _animateTuckedLegs(char) {
    const pivotValue = 2.6;
    const tuckLift = 2 * VOXEL_SIZE;
    if (char.leftHipPivot) {
      char.leftHipPivot.rotation.z = pivotValue;
      char.leftHipPivot.position.y = tuckLift;
    }
    if (char.rightHipPivot) {
      char.rightHipPivot.rotation.z = pivotValue;
      char.rightHipPivot.position.y = tuckLift;
    }
    if (char.leftKneePivot) {
      char.leftKneePivot.rotation.z = -pivotValue;
    }
    if (char.rightKneePivot) {
      char.rightKneePivot.rotation.z = -pivotValue;
    }
  }

  // ---- Evil type cycling ----

  _cycleEvilType() {
    this._evilTypeIndex = (this._evilTypeIndex + 1) % 3;

    const evil = this._chars[1];
    if (!evil) {
      return;
    }

    // Save current state
    const savedState = {
      positionX: evil.positionX,
      positionY: evil.positionY,
      velocityX: evil.velocityX,
      velocityY: evil.velocityY,
      playerState: evil.playerState,
      facingDir: evil.facingDir,
      isTurning: evil.isTurning,
      turnTimer: evil.turnTimer,
      turnFrom: evil.turnFrom,
      turnTo: evil.turnTo,
      stridePhase: evil.stridePhase,
      isFlapping: evil.isFlapping,
      flapTimer: evil.flapTimer,
    };

    // Dispose old evil character meshes
    this._disposeCharMeshes(evil);

    // Rebuild with new palette
    const VS = VOXEL_SIZE;
    const newEvil = createCharState('sweep');
    newEvil.birdRig = buildRig(this.scene, buzzardModel, VS);
    const evilPalette = buildEvilKnightPalette(this._evilTypeIndex);
    newEvil.knightRig = buildRig(this.scene, { ...evilKnightModel, palette: evilPalette }, VS);
    newEvil.lanceRig = buildRig(this.scene, lanceModel, VS);
    this._assembleCharacter(newEvil, VS);
    newEvil.baseY = evil.baseY;

    // Restore state
    newEvil.positionX = savedState.positionX;
    newEvil.positionY = savedState.positionY;
    newEvil.velocityX = savedState.velocityX;
    newEvil.velocityY = savedState.velocityY;
    newEvil.playerState = savedState.playerState;
    newEvil.facingDir = savedState.facingDir;
    newEvil.isTurning = savedState.isTurning;
    newEvil.turnTimer = savedState.turnTimer;
    newEvil.turnFrom = savedState.turnFrom;
    newEvil.turnTo = savedState.turnTo;
    newEvil.stridePhase = savedState.stridePhase;
    newEvil.isFlapping = savedState.isFlapping;
    newEvil.flapTimer = savedState.flapTimer;

    // Apply position and facing to new rig
    if (newEvil.birdRig.root) {
      newEvil.birdRig.root.position = new Vector3(newEvil.positionX, newEvil.positionY, 0);
      if (newEvil.facingDir === -1) {
        newEvil.birdRig.root.rotation.y = Math.PI;
      }
    }

    this._chars[1] = newEvil;
  }

  _disposeCharMeshes(char) {
    // Dispose all TransformNodes we created
    const nodes = [
      char.leftHipPivot, char.rightHipPivot,
      char.leftKneePivot, char.rightKneePivot,
      char.leftWingPivot, char.rightWingPivot,
      char.leftShoulderNode, char.rightShoulderNode,
      char.leftHipNode, char.rightHipNode,
    ];
    for (const node of nodes) {
      if (node) {
        node.dispose();
      }
    }

    // Dispose rig meshes
    if (char.birdRig) {
      for (const part of Object.values(char.birdRig.parts)) {
        if (part.mesh) {
          part.mesh.dispose();
        }
      }
      if (char.birdRig.root) {
        char.birdRig.root.dispose();
      }
    }
    if (char.knightRig) {
      for (const part of Object.values(char.knightRig.parts)) {
        if (part.mesh) {
          part.mesh.dispose();
        }
      }
      if (char.knightRig.root) {
        char.knightRig.root.dispose();
      }
    }
    if (char.lanceRig) {
      for (const part of Object.values(char.lanceRig.parts)) {
        if (part.mesh) {
          part.mesh.dispose();
        }
      }
      if (char.lanceRig.root) {
        char.lanceRig.root.dispose();
      }
    }
  }
}
