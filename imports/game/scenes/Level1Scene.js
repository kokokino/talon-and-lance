// Level1Scene — Joust Level 1 recreation with multi-tier rock platforms over lava.
// Supports player (ostrich) and evil knight (buzzard) with Up/Down arrow controls
// to toggle active character and cycle enemy type.
// Receives Engine/Scene from BabylonPage — does not own them.

import { FreeCamera } from '@babylonjs/core/Cameras/freeCamera';
import { Camera } from '@babylonjs/core/Cameras/camera';
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight';
import { DirectionalLight } from '@babylonjs/core/Lights/directionalLight';
import { PointLight } from '@babylonjs/core/Lights/pointLight';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture';
import { Texture } from '@babylonjs/core/Materials/Textures/texture';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import { ParticleSystem } from '@babylonjs/core/Particles/particleSystem';

import { InputReader } from '../InputReader.js';
import { SkyBackground } from './SkyBackground.js';
import { buildRig } from '../voxels/VoxelBuilder.js';
import { knightModel } from '../voxels/models/knightModel.js';
import { lanceModel } from '../voxels/models/lanceModel.js';
import { ostrichModel } from '../voxels/models/ostrichModel.js';
import { buzzardModel } from '../voxels/models/buzzardModel.js';
import { evilKnightModel } from '../voxels/models/evilKnightModel.js';
import { buildKnightPalette } from '../voxels/models/knightPalettes.js';
import { buildEvilKnightPalette } from '../voxels/models/evilKnightPalettes.js';

// ---- Size & View ----
const VOXEL_SIZE = 0.07;

const ORTHO_WIDTH = 20;
const ORTHO_LEFT = -ORTHO_WIDTH / 2;
const ORTHO_RIGHT = ORTHO_WIDTH / 2;

// ---- Movement ----
const ACCELERATION = 2.0;
const MAX_SPEED = 5.0;
const FRICTION = 3.0;
const SKID_DECEL = 8.0;
const TURN_DURATION = 0.25;

const CHAR_HALF_WIDTH = 10 * VOXEL_SIZE / 2;

// ---- Flying physics ----
const GRAVITY = 8.0;
const FLAP_IMPULSE = 4.0;
const TERMINAL_VELOCITY = 8.0;
const AIR_FRICTION = 0.5;

// ---- Collision offsets from body center ----
const FEET_OFFSET = 7.5 * VOXEL_SIZE;
const HEAD_OFFSET = 10.5 * VOXEL_SIZE;
const LEDGE_HEIGHT = 0.06;

// ---- Wing flap animation — ostrich (up/down rotation.x) ----
const FLAP_DURATION = 0.25;
const WING_UP_ANGLE = -1.2;
const WING_DOWN_ANGLE = 0.4;
const WING_GLIDE_ANGLE = -0.3;

// ---- Wing sweep animation — buzzard (forward/backward rotation.z) ----
const SWEEP_FORWARD_ANGLE = 0.8;
const SWEEP_BACKWARD_ANGLE = -0.6;
const SWEEP_GLIDE_ANGLE = 0.2;

// ---- Platform layout (Joust Level 1) ----
const PLATFORM_DEFS = [
  // Base tier — two sections with lava gap in center
  { id: 'baseLeft',  x: -5.5, y: -3.8, width: 9.0, height: 0.35 },
  { id: 'baseRight', x:  5.5, y: -3.8, width: 9.0, height: 0.35 },
  // Lower-middle tier
  { id: 'midLowL',   x: -5.0, y: -1.5, width: 4.5, height: 0.3 },
  { id: 'midLowR',   x:  5.0, y: -1.5, width: 4.5, height: 0.3 },
  // Upper-middle tier (L and R extend past screen edges for wrap-around)
  { id: 'midUpL',    x: -8.0, y:  0.8, width: 4.5, height: 0.3 },
  { id: 'midUpC',    x:  0.0, y:  0.8, width: 5.0, height: 0.3 },
  { id: 'midUpR',    x:  8.0, y:  0.8, width: 4.5, height: 0.3 },
  // Top tier
  { id: 'top',       x:  0.0, y:  3.2, width: 12.0, height: 0.3 },
];

// ---- Spawn points ----
const SPAWN_POINTS = [
  { x: -6.0, platformId: 'baseLeft' },
  { x:  6.0, platformId: 'baseRight' },
  { x: -5.0, platformId: 'midLowL' },
  { x:  5.0, platformId: 'midLowR' },
];

// ---- Materialization ----
const MATERIALIZE_DURATION = 10.0;
const MATERIALIZE_QUICK_DURATION = 0.5;

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
    knightMountY: 0,
    wingMode: wingMode,
    currentPlatform: null,
    // Materialization
    materializing: true,
    materializeTimer: 0,
    materializeDuration: MATERIALIZE_DURATION,
    materializeQuickEnd: false,
    materializeParticles: null,
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

    // Platform collision data (populated in _createPlatforms)
    this._platforms = [];

    // Sky background
    this._skyBackground = null;

    // Light refs for dynamic modulation
    this._ambientLight = null;
    this._dirLight = null;
    this._lavaLight = null;

    // Lava refs
    this._lavaMaterial = null;
    this._lavaTexture = null;
    this._lavaUvOffset = 0;
    this._lavaBurstTimer = 0;
  }

  /**
   * Build all scene content into the provided Scene.
   */
  create(scene, engine, canvas) {
    this.scene = scene;
    this.engine = engine;
    this.scene.clearColor = new Color4(0, 0, 0, 1);

    this._setupCamera(canvas);
    this._setupLighting();

    // Sky background — after camera, before characters
    this._skyBackground = new SkyBackground(
      this.scene, ORTHO_LEFT, ORTHO_RIGHT, this._orthoBottom, this._orthoTop
    );

    this._createPlatforms();
    this._createSpawnPads();
    this._createLava();
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
    if (this._skyBackground) {
      this._skyBackground.dispose();
      this._skyBackground = null;
    }
    // Dispose materialization particles
    for (const char of this._chars) {
      if (char && char.materializeParticles) {
        char.materializeParticles.stop();
        char.materializeParticles.dispose();
        char.materializeParticles = null;
      }
    }
    this._chars = [null, null];
    this._platforms = [];
    this._lavaMaterial = null;
    this._lavaTexture = null;
    this._lavaLight = null;
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
    this._ambientLight = new HemisphericLight('ambientLight', new Vector3(0, 1, 0), this.scene);
    this._ambientLight.intensity = 0.6;
    this._ambientLight.diffuse = new Color3(0.9, 0.9, 1.0);
    this._ambientLight.groundColor = new Color3(0.2, 0.2, 0.3);

    this._dirLight = new DirectionalLight('dirLight', new Vector3(-1, -2, 1), this.scene);
    this._dirLight.intensity = 0.8;
    this._dirLight.diffuse = new Color3(1.0, 0.95, 0.85);

    // Lava glow from below
    this._lavaLight = new PointLight('lavaLight', new Vector3(0, this._orthoBottom, 0), this.scene);
    this._lavaLight.intensity = 0.4;
    this._lavaLight.diffuse = new Color3(1.0, 0.4, 0.1);
    this._lavaLight.range = 15;
  }

  _modulateLighting(timeOfDay) {
    const dayBrightness = Math.sin(timeOfDay * Math.PI);
    const ambientMin = 0.25;
    const ambientMax = 0.7;
    const dirMin = 0.15;
    const dirMax = 0.9;

    if (this._ambientLight) {
      this._ambientLight.intensity = ambientMin + (ambientMax - ambientMin) * dayBrightness;
    }
    if (this._dirLight) {
      this._dirLight.intensity = dirMin + (dirMax - dirMin) * dayBrightness;
    }
  }

  // ---- Platforms ----

  _createPlatforms() {
    this._platforms = [];

    for (const def of PLATFORM_DEFS) {
      // Main platform body
      const body = MeshBuilder.CreateBox(`plat_${def.id}`, {
        width: def.width,
        height: def.height,
        depth: 2,
      }, this.scene);
      body.position = new Vector3(def.x, def.y, 0);

      const mat = new StandardMaterial(`plat_${def.id}_mat`, this.scene);
      mat.diffuseColor = new Color3(0.45, 0.40, 0.35);
      mat.specularColor = new Color3(0.1, 0.1, 0.1);
      mat.emissiveColor = new Color3(0.05, 0.04, 0.03);
      body.material = mat;

      // Thin metallic ledge/lip on top
      const ledge = MeshBuilder.CreateBox(`ledge_${def.id}`, {
        width: def.width + 0.1,
        height: LEDGE_HEIGHT,
        depth: 2,
      }, this.scene);
      ledge.position = new Vector3(def.x, def.y + def.height / 2 + LEDGE_HEIGHT / 2, -0.01);

      const ledgeMat = new StandardMaterial(`ledge_${def.id}_mat`, this.scene);
      ledgeMat.diffuseColor = new Color3(0.6, 0.58, 0.55);
      ledgeMat.specularColor = new Color3(0.3, 0.3, 0.3);
      ledgeMat.emissiveColor = new Color3(0.08, 0.07, 0.06);
      ledge.material = ledgeMat;

      this._platforms.push({
        id: def.id,
        x: def.x,
        y: def.y,
        width: def.width,
        height: def.height,
        top: def.y + def.height / 2 + LEDGE_HEIGHT,
        bottom: def.y - def.height / 2,
        left: def.x - def.width / 2,
        right: def.x + def.width / 2,
      });
    }
  }

  _createSpawnPads() {
    for (const sp of SPAWN_POINTS) {
      const platform = this._platforms.find(p => p.id === sp.platformId);
      if (!platform) {
        continue;
      }

      const pad = MeshBuilder.CreateBox(`spawnPad_${sp.platformId}`, {
        width: 1.5,
        height: 0.08,
        depth: 2,
      }, this.scene);
      pad.position = new Vector3(sp.x, platform.top + 0.04, -0.02);

      const mat = new StandardMaterial(`spawnPadMat_${sp.platformId}`, this.scene);
      mat.diffuseColor = new Color3(0.55, 0.53, 0.50);
      mat.specularColor = new Color3(0.2, 0.2, 0.2);
      mat.emissiveColor = new Color3(0.06, 0.06, 0.05);
      pad.material = mat;
    }
  }

  // ---- Lava ----

  _createLava() {
    const lavaWidth = ORTHO_WIDTH + 4;
    const lavaHeight = 2.0;
    const lavaY = this._orthoBottom + lavaHeight / 2 + 0.1;

    const lava = MeshBuilder.CreatePlane('lava', {
      width: lavaWidth,
      height: lavaHeight,
    }, this.scene);
    lava.position = new Vector3(0, lavaY, 0.5);

    // Procedural lava texture
    const lavaTexture = new DynamicTexture('lavaTex', 256, this.scene, false);
    const ctx = lavaTexture.getContext();
    this._drawLavaPattern(ctx, 256);
    lavaTexture.update();
    lavaTexture.wrapU = Texture.WRAP_ADDRESSMODE;
    lavaTexture.wrapV = Texture.WRAP_ADDRESSMODE;

    const lavaMat = new StandardMaterial('lavaMat', this.scene);
    lavaMat.diffuseTexture = lavaTexture;
    lavaMat.emissiveColor = new Color3(0.8, 0.25, 0.05);
    lavaMat.specularColor = new Color3(0, 0, 0);
    lavaMat.backFaceCulling = false;
    lava.material = lavaMat;

    this._lavaMaterial = lavaMat;
    this._lavaTexture = lavaTexture;
    this._lavaBurstTimer = 0.5;
  }

  _drawLavaPattern(ctx, size) {
    const imageData = ctx.createImageData(size, size);
    const data = imageData.data;

    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const idx = (y * size + x) * 4;
        const nx = x / size;
        const ny = y / size;
        const noise = (
          Math.sin(nx * 12.0 + ny * 8.0) * 0.3 +
          Math.sin(nx * 5.0 - ny * 15.0) * 0.2 +
          Math.sin((nx + ny) * 20.0) * 0.15 +
          0.5
        );
        const clamped = Math.max(0, Math.min(1, noise));

        data[idx] = Math.floor(120 + clamped * 135);
        data[idx + 1] = Math.floor(20 + clamped * 120);
        data[idx + 2] = Math.floor(5 + clamped * 25);
        data[idx + 3] = 255;
      }
    }

    ctx.putImageData(imageData, 0, 0);
  }

  _spawnLavaBurst() {
    const tex = new DynamicTexture('lavaBurstTex', 64, this.scene, false);
    const ctx = tex.getContext();
    ctx.clearRect(0, 0, 64, 64);
    const gradient = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    gradient.addColorStop(0, 'rgba(255, 200, 50, 1)');
    gradient.addColorStop(0.4, 'rgba(255, 100, 20, 0.8)');
    gradient.addColorStop(1, 'rgba(200, 40, 0, 0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 64, 64);
    tex.update(false);
    tex.hasAlpha = true;

    const ps = new ParticleSystem('lavaBurst', 30, this.scene);
    ps.particleTexture = tex;

    // Random X across screen width; Y at lava surface
    const x = (Math.random() - 0.5) * (ORTHO_WIDTH + 2);
    const lavaY = this._orthoBottom + 1.2;
    ps.emitter = new Vector3(x, lavaY, 0.4);

    // Particles shoot upward
    ps.direction1 = new Vector3(-0.3, 2, 0);
    ps.direction2 = new Vector3(0.3, 5, 0);
    ps.gravity = new Vector3(0, -6, 0);

    ps.minSize = 0.08;
    ps.maxSize = 0.25;
    ps.minLifeTime = 0.3;
    ps.maxLifeTime = 0.8;

    ps.emitRate = 40;
    ps.manualEmitCount = 12 + Math.floor(Math.random() * 10);

    ps.color1 = new Color4(1.0, 0.8, 0.2, 1);
    ps.color2 = new Color4(1.0, 0.4, 0.1, 1);
    ps.colorDead = new Color4(0.5, 0.1, 0.0, 0);

    ps.blendMode = ParticleSystem.BLENDMODE_ADD;

    ps.targetStopDuration = 0.15;
    ps.disposeOnStop = true;
    ps.start();
  }

  // ---- Characters ----

  _createCharacters() {
    const VS = VOXEL_SIZE;

    // Randomly assign 2 of 4 spawn points
    const shuffled = [...SPAWN_POINTS].sort(() => Math.random() - 0.5);
    const playerSpawn = shuffled[0];
    const evilSpawn = shuffled[1];

    const playerPlatform = this._platforms.find(p => p.id === playerSpawn.platformId);
    const evilPlatform = this._platforms.find(p => p.id === evilSpawn.platformId);

    // --- Player character (knight on ostrich) ---
    const player = createCharState('updown');
    const notLit = true;
    player.birdRig = buildRig(this.scene, ostrichModel, VS, notLit);
    const mergedPalette = buildKnightPalette(this._paletteIndex);
    player.knightRig = buildRig(this.scene, { ...knightModel, palette: mergedPalette }, VS, notLit);
    player.lanceRig = buildRig(this.scene, lanceModel, VS, notLit);
    this._assembleCharacter(player, VS);

    player.positionX = playerSpawn.x;
    player.positionY = playerPlatform.top + FEET_OFFSET;
    player.currentPlatform = playerPlatform;
    if (player.birdRig.root) {
      player.birdRig.root.position = new Vector3(player.positionX, player.positionY, 0);
    }
    this._chars[0] = player;

    // Start materialization
    this._setCharAlpha(player, 0);
    this._createMaterializeParticles(player);

    // --- Evil character (evil knight on buzzard) ---
    this._buildEvilCharacter(VS, evilSpawn, evilPlatform);
  }

  _buildEvilCharacter(VS, spawn, platform) {
    const evil = createCharState('sweep');
    const notLit = true;
    evil.birdRig = buildRig(this.scene, buzzardModel, VS, notLit);
    const evilPalette = buildEvilKnightPalette(this._evilTypeIndex);
    evil.knightRig = buildRig(this.scene, { ...evilKnightModel, palette: evilPalette }, VS, notLit);
    evil.lanceRig = buildRig(this.scene, lanceModel, VS, notLit);
    this._assembleCharacter(evil, VS);

    evil.positionX = spawn.x;
    evil.positionY = platform.top + FEET_OFFSET;
    evil.currentPlatform = platform;
    if (evil.birdRig.root) {
      evil.birdRig.root.position = new Vector3(evil.positionX, evil.positionY, 0);
    }
    this._chars[1] = evil;

    // Start materialization
    this._setCharAlpha(evil, 0);
    this._createMaterializeParticles(evil);
  }

  // ---- Materialization ----

  _createMaterializeParticles(char) {
    const tex = new DynamicTexture('matTex', 64, this.scene, false);
    const ctx = tex.getContext();
    ctx.clearRect(0, 0, 64, 64);
    const gradient = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    gradient.addColorStop(0, 'rgba(255, 255, 255, 1)');
    gradient.addColorStop(0.3, 'rgba(255, 215, 64, 0.9)');
    gradient.addColorStop(1, 'rgba(255, 180, 50, 0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 64, 64);
    tex.update(false);
    tex.hasAlpha = true;

    const ps = new ParticleSystem('materialize', 200, this.scene);
    ps.particleTexture = tex;
    ps.emitter = new Vector3(char.positionX, char.positionY, 0);

    // Start with large emit box
    ps.minEmitBox = new Vector3(-2, -2, -0.3);
    ps.maxEmitBox = new Vector3(2, 2, 0.3);

    ps.direction1 = new Vector3(-0.5, -0.5, 0);
    ps.direction2 = new Vector3(0.5, 0.5, 0);
    ps.gravity = new Vector3(0, 0, 0);

    ps.minSize = 0.04;
    ps.maxSize = 0.12;
    ps.minLifeTime = 0.3;
    ps.maxLifeTime = 0.8;
    ps.emitRate = 20;

    ps.color1 = new Color4(1.0, 1.0, 1.0, 1.0);
    ps.color2 = new Color4(1.0, 0.85, 0.25, 1.0);
    ps.colorDead = new Color4(1.0, 0.7, 0.2, 0.0);

    ps.blendMode = ParticleSystem.BLENDMODE_ADD;
    ps.start();

    char.materializeParticles = ps;
  }

  _updateMaterialization(dt, char) {
    if (!char.materializing) {
      return;
    }

    char.materializeTimer += dt;
    const duration = char.materializeDuration;
    const progress = Math.min(char.materializeTimer / duration, 1.0);
    const ps = char.materializeParticles;

    if (progress < 0.8) {
      // Phase 1: Particle swirl — character invisible
      const phase1Progress = progress / 0.8;
      const boxSize = 2.0 - phase1Progress * 1.9;

      if (ps) {
        ps.minEmitBox.x = -boxSize;
        ps.minEmitBox.y = -boxSize;
        ps.maxEmitBox.x = boxSize;
        ps.maxEmitBox.y = boxSize;
        ps.emitRate = 20 + phase1Progress * 180;
      }
      this._setCharAlpha(char, 0);
    } else {
      // Phase 2: Coalesce and reveal
      const phase2Progress = (progress - 0.8) / 0.2;

      if (ps) {
        ps.minEmitBox.x = -0.1;
        ps.minEmitBox.y = -0.1;
        ps.maxEmitBox.x = 0.1;
        ps.maxEmitBox.y = 0.1;
        ps.emitRate = Math.max(0, 200 * (1 - phase2Progress));
      }
      this._setCharAlpha(char, phase2Progress);
    }

    if (progress >= 1.0) {
      char.materializing = false;
      this._setCharAlpha(char, 1.0);
      if (ps) {
        ps.stop();
        ps.dispose();
        char.materializeParticles = null;
      }
    }
  }

  _setCharAlpha(char, alpha) {
    const rigs = [char.birdRig, char.knightRig, char.lanceRig];
    for (const rig of rigs) {
      if (!rig) {
        continue;
      }
      for (const part of Object.values(rig.parts)) {
        if (part.mesh && part.mesh.material) {
          part.mesh.material.alpha = alpha;
          if (alpha < 1.0) {
            part.mesh.material.transparencyMode = 2; // ALPHA_BLEND
          } else {
            part.mesh.material.transparencyMode = 0; // OPAQUE
          }
        }
      }
    }
  }

  // ---- Character assembly ----

  _assembleCharacter(char, VS) {
    const bParts = char.birdRig.parts;
    const kParts = char.knightRig.parts;

    this._setupBirdLegPivots(char, bParts, VS);
    this._setupBirdWingPivots(char, bParts, VS);
    this._setupKnightShoulders(char, kParts, VS);
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

    // Sky background update
    if (this._skyBackground) {
      this._skyBackground.update(dt);
      this._modulateLighting(this._skyBackground.timeOfDay);
    }

    // Lava animation
    this._animateLava(dt);

    // Toggle active character
    if (input.switchChar) {
      this._activeCharIdx = this._activeCharIdx === 0 ? 1 : 0;
    }

    // Cycle evil knight type
    if (input.cycleType) {
      this._cycleEvilType();
    }

    // Update each character
    for (let i = 0; i < 2; i++) {
      const char = this._chars[i];
      if (!char) {
        continue;
      }

      // Materialization update (runs before physics)
      this._updateMaterialization(dt, char);

      if (char.materializing) {
        // Quick-end: any input from the active character accelerates materialization
        if (i === this._activeCharIdx && !char.materializeQuickEnd) {
          if (input.left || input.right || input.flap) {
            char.materializeQuickEnd = true;
            char.materializeDuration = char.materializeTimer + MATERIALIZE_QUICK_DURATION;
          }
        }
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
      char.currentPlatform = null;
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

  // ---- Position, wrap, and collision ----

  _applyPositionAndWrap(dt, char) {
    const prevY = char.positionY;

    char.positionX += char.velocityX * dt;
    char.positionY += char.velocityY * dt;

    // Platform collision detection
    this._checkPlatformCollisions(char, prevY);

    // Ceiling clamp
    if (char.positionY > this._orthoTop - HEAD_OFFSET - 0.1) {
      char.positionY = this._orthoTop - HEAD_OFFSET - 0.1;
      char.velocityY = 0;
    }

    // Kill zone — below lava, respawn at top
    if (char.positionY < this._orthoBottom - 1) {
      char.positionX = 0;
      char.positionY = this._orthoTop - HEAD_OFFSET;
      char.velocityX = 0;
      char.velocityY = 0;
      char.playerState = 'AIRBORNE';
      char.currentPlatform = null;
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

  _checkPlatformCollisions(char, prevY) {
    const feetY = char.positionY - FEET_OFFSET;
    const prevFeetY = prevY - FEET_OFFSET;
    const headY = char.positionY + HEAD_OFFSET;
    const prevHeadY = prevY + HEAD_OFFSET;
    const charLeft = char.positionX - CHAR_HALF_WIDTH;
    const charRight = char.positionX + CHAR_HALF_WIDTH;

    // Edge fall-off: grounded character walks off current platform
    if (char.playerState === 'GROUNDED' && char.currentPlatform) {
      const plat = char.currentPlatform;
      if (charRight < plat.left || charLeft > plat.right) {
        char.playerState = 'AIRBORNE';
        char.currentPlatform = null;
      }
    }

    // Landing check: falling onto a platform top
    if (char.velocityY <= 0) {
      for (const plat of this._platforms) {
        if (charRight < plat.left || charLeft > plat.right) {
          continue;
        }
        if (prevFeetY >= plat.top && feetY < plat.top) {
          char.positionY = plat.top + FEET_OFFSET;
          char.velocityY = 0;
          char.playerState = 'GROUNDED';
          char.currentPlatform = plat;
          break;
        }
      }
    }

    // Head bump check: rising into platform underside
    if (char.velocityY > 0) {
      for (const plat of this._platforms) {
        if (charRight < plat.left || charLeft > plat.right) {
          continue;
        }
        if (prevHeadY <= plat.bottom && headY > plat.bottom) {
          char.positionY = plat.bottom - HEAD_OFFSET;
          char.velocityY = 0;
          break;
        }
      }
    }
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

    const strideFreq = speedRatio * 2.0;
    char.stridePhase += strideFreq * dt;

    const p = char.stridePhase * Math.PI * 2;
    const amp = speedRatio;

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

    // Wings: tucked with slight bounce
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
        const phase = t / 0.3;
        const eased = Math.sin(phase * Math.PI / 2);
        sweepAngle = eased * SWEEP_FORWARD_ANGLE;
      } else if (t < 0.7) {
        const phase = (t - 0.3) / 0.4;
        const eased = 0.5 - 0.5 * Math.cos(phase * Math.PI);
        sweepAngle = SWEEP_FORWARD_ANGLE + eased * (SWEEP_BACKWARD_ANGLE - SWEEP_FORWARD_ANGLE);
      } else {
        const phase = (t - 0.7) / 0.3;
        const eased = 0.5 - 0.5 * Math.cos(phase * Math.PI);
        sweepAngle = SWEEP_BACKWARD_ANGLE + eased * (0 - SWEEP_BACKWARD_ANGLE);
      }
    } else if (char.playerState === 'AIRBORNE') {
      sweepAngle = SWEEP_GLIDE_ANGLE;
    }

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

    if (bParts.body) {
      bParts.body.mesh.position.y = char.positionY;
    }

    if (bParts.neck) {
      bParts.neck.mesh.rotation.z = 0.1;
    }

    if (bParts.tail) {
      bParts.tail.mesh.rotation.z = -0.15;
    }

    if (char.wingMode === 'updown') {
      if (char.leftWingPivot) {
        char.leftWingPivot.rotation.z = 0;
      }
      if (char.rightWingPivot) {
        char.rightWingPivot.rotation.z = 0;
      }
    }

    this._animateTuckedLegs(char);

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

  // ---- Lava animation ----

  _animateLava(dt) {
    if (!this._lavaMaterial) {
      return;
    }

    // Emissive intensity pulse
    const pulse = 0.6 + Math.sin(this._elapsed * (2 * Math.PI / 4)) * 0.2;
    this._lavaMaterial.emissiveColor = new Color3(pulse, pulse * 0.3, pulse * 0.06);

    // UV scroll
    if (this._lavaMaterial.diffuseTexture) {
      this._lavaUvOffset += dt * 0.02;
      this._lavaMaterial.diffuseTexture.uOffset = this._lavaUvOffset;
      this._lavaMaterial.diffuseTexture.vOffset = this._lavaUvOffset * 0.7;
    }

    // Lava burst spawning
    this._lavaBurstTimer -= dt;
    if (this._lavaBurstTimer <= 0) {
      this._spawnLavaBurst();
      this._lavaBurstTimer = 0.4 + Math.random() * 1.1;
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
      currentPlatform: evil.currentPlatform,
      materializing: evil.materializing,
      materializeTimer: evil.materializeTimer,
      materializeDuration: evil.materializeDuration,
      materializeQuickEnd: evil.materializeQuickEnd,
    };

    // Dispose old evil character meshes
    this._disposeCharMeshes(evil);

    // Rebuild with new palette
    const VS = VOXEL_SIZE;
    const notLit = true;
    const newEvil = createCharState('sweep');
    newEvil.birdRig = buildRig(this.scene, buzzardModel, VS, notLit);
    const evilPalette = buildEvilKnightPalette(this._evilTypeIndex);
    newEvil.knightRig = buildRig(this.scene, { ...evilKnightModel, palette: evilPalette }, VS, notLit);
    newEvil.lanceRig = buildRig(this.scene, lanceModel, VS, notLit);
    this._assembleCharacter(newEvil, VS);

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
    newEvil.currentPlatform = savedState.currentPlatform;
    newEvil.materializing = savedState.materializing;
    newEvil.materializeTimer = savedState.materializeTimer;
    newEvil.materializeDuration = savedState.materializeDuration;
    newEvil.materializeQuickEnd = savedState.materializeQuickEnd;

    // Apply position and facing to new rig
    if (newEvil.birdRig.root) {
      newEvil.birdRig.root.position = new Vector3(newEvil.positionX, newEvil.positionY, 0);
      if (newEvil.facingDir === -1) {
        newEvil.birdRig.root.rotation.y = Math.PI;
      }
    }

    // Handle alpha if still materializing
    if (newEvil.materializing) {
      const progress = Math.min(newEvil.materializeTimer / newEvil.materializeDuration, 1.0);
      if (progress < 0.8) {
        this._setCharAlpha(newEvil, 0);
      } else {
        this._setCharAlpha(newEvil, (progress - 0.8) / 0.2);
      }
      this._createMaterializeParticles(newEvil);
    }

    this._chars[1] = newEvil;
  }

  _disposeCharMeshes(char) {
    // Dispose materialization particles
    if (char.materializeParticles) {
      char.materializeParticles.stop();
      char.materializeParticles.dispose();
      char.materializeParticles = null;
    }

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
