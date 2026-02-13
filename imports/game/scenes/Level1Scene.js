// Level1Scene — Joust Level 1 recreation with multi-tier rock platforms over lava.
// Player (ostrich) vs AI-controlled enemies (buzzards) with wave-based progression.
// Features: scoring, lives, HUD, egg collection, egg hatching, enemy AI.
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
import { EnemyAI } from '../EnemyAI.js';
import {
  STARTING_LIVES, EXTRA_LIFE_THRESHOLD,
  POINTS_SURVIVAL_WAVE, POINTS_EGG_MID_AIR,
  ENEMY_TYPE_BOUNDER, ENEMY_TYPE_HUNTER, ENEMY_TYPE_SHADOW_LORD,
  getKillPoints, getEggPoints, getWaveComposition,
} from '../scoring.js';
import { SkyBackground } from './SkyBackground.js';
import { buildRig, buildPart } from '../voxels/VoxelBuilder.js';
import { knightModel } from '../voxels/models/knightModel.js';
import { lanceModel } from '../voxels/models/lanceModel.js';
import { ostrichModel } from '../voxels/models/ostrichModel.js';
import { buzzardModel } from '../voxels/models/buzzardModel.js';
import { evilKnightModel } from '../voxels/models/evilKnightModel.js';
import { eggModel } from '../voxels/models/eggModel.js';
import { buildKnightPalette } from '../voxels/models/knightPalettes.js';
import { buildEvilKnightPalette } from '../voxels/models/evilKnightPalettes.js';

/**
 * Convert a hex color string (e.g. '#FF8800') to a Babylon Color3.
 */
function hexToColor3(hex) {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  return new Color3(r, g, b);
}

// ---- Size & View ----
const VOXEL_SIZE = 0.07;

const ORTHO_WIDTH = 20;
const ORTHO_LEFT = -ORTHO_WIDTH / 2;
const ORTHO_RIGHT = ORTHO_WIDTH / 2;

// ---- Movement ----
const ACCELERATION = 4.0;
const MAX_SPEED = 10.0;
const FRICTION = 3.0;
const SKID_DECEL = 12.0;
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

// ---- Joust collision ----
const JOUST_HEIGHT_DEADZONE = 0.15;
const JOUST_KNOCKBACK_X = 6.0;
const JOUST_KNOCKBACK_Y = 3.0;
const RESPAWN_DELAY = 2.0;
const INVINCIBLE_DURATION = 5.0;

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

// ---- Egg hatching ----
const HATCH_TIME = 8.0;
const WOBBLE_START = 5.0;
const LOOK_AROUND_TIME = 3.0;
const BIRD_ARRIVE_TIME = 1.5;

// ---- Wave spawning ----
const ENEMY_SPAWN_POINTS = [
  { x: -8.0, y: 1.1 },   // top-left (above midUpL)
  { x: 8.0, y: 1.1 },    // top-right (above midUpR)
  { x: -5.0, y: -1.2 },  // mid-left (above midLowL)
  { x: 5.0, y: -1.2 },   // mid-right (above midLowR)
];
const SPAWN_GROUP_INTERVAL = 2.0;
const WAVE_TRANSITION_DELAY = 2.0;

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
    // Death / respawn
    dead: false,
    hitLava: false,
    respawnTimer: 0,
    invincible: false,
    invincibleTimer: 0,
    // Joust collision
    prevPositionX: 0,
    prevPositionY: 0,
    joustCooldown: 0,
    // Enemy AI
    enemyType: undefined,
    ai: null,
  };
}

export class Level1Scene {
  /**
   * @param {{ audioManager: AudioManager, paletteIndex: number }} config
   */
  constructor({ audioManager, paletteIndex, onQuitToMenu }) {
    this._audioManager = audioManager;
    this._paletteIndex = paletteIndex;
    this._onQuitToMenu = onQuitToMenu || null;

    this.engine = null;
    this.scene = null;

    // Character state array: [0] = player, rest = enemies
    this._chars = [null, null];
    this._evilTypeIndex = 0;

    this._inputReader = null;
    this._elapsed = 0;

    // Escape overlay
    this._escapeOverlay = null;
    this._escapeVisible = false;

    // Scoring & lives
    this._score = 0;
    this._lives = STARTING_LIVES;
    this._nextLifeScore = EXTRA_LIFE_THRESHOLD;
    this._eggsCollectedThisWave = 0;
    this._playerDiedThisWave = false;
    this._gameOverActive = false;

    // Wave system
    this._waveNumber = 1;
    this._waveTextTimer = 0;
    this._waveBannerActive = false;
    this._waveState = 'SPAWNING'; // SPAWNING, PLAYING, TRANSITION
    this._spawnQueue = [];
    this._spawnTimer = 0;
    this._waveTransitionTimer = 0;

    // HUD
    this._hudUI = null;
    this._hudScoreText = null;
    this._hudLivesText = null;
    this._hudWaveText = null;
    this._hudBannerText = null;

    // Ortho bounds (Y computed from aspect ratio)
    this._orthoBottom = 0;
    this._orthoTop = 0;

    // Platform collision data (populated in _createPlatforms)
    this._platforms = [];

    // Eggs (dropped on joust death)
    this._eggs = [];

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

    // HUD
    this._createHUD();

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
    this._hideEscapeOverlay();
    if (this._hudUI) {
      this._hudUI.dispose();
      this._hudUI = null;
    }
    // Dispose materialization particles
    for (const char of this._chars) {
      if (char && char.materializeParticles) {
        char.materializeParticles.stop();
        char.materializeParticles.dispose();
        char.materializeParticles = null;
      }
    }
    this._chars = [];
    // Dispose eggs
    for (const egg of this._eggs) {
      if (egg.rig.root) {
        egg.rig.root.dispose();
      }
      for (const part of Object.values(egg.rig.parts)) {
        if (part.mesh) {
          part.mesh.dispose();
        }
      }
    }
    this._eggs = [];
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

      const padHeight = 4 * VOXEL_SIZE;
      const pad = MeshBuilder.CreateBox(`spawnPad_${sp.platformId}`, {
        width: 1.5,
        height: padHeight,
        depth: 2,
      }, this.scene);
      pad.position = new Vector3(sp.x, platform.top - padHeight / 2, -0.02);

      const mat = new StandardMaterial(`spawnPadMat_${sp.platformId}`, this.scene);
      mat.diffuseColor = new Color3(0.82, 0.71, 0.55);
      mat.specularColor = new Color3(0.2, 0.2, 0.2);
      mat.emissiveColor = new Color3(0.08, 0.07, 0.05);
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
    this._chars = [];

    // Player spawn — pick a random ground spawn
    const playerSpawn = SPAWN_POINTS[Math.floor(Math.random() * SPAWN_POINTS.length)];
    const playerPlatform = this._platforms.find(p => p.id === playerSpawn.platformId);

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
    this._chars.push(player);

    // Start materialization
    this._setCharAlpha(player, 0);
    this._createMaterializeParticles(player);

    // Start wave 1
    this._startWave(this._waveNumber);
  }

  _spawnEnemy(enemyType, spawnX, spawnY) {
    const VS = VOXEL_SIZE;
    const notLit = true;
    const paletteIndex = enemyType; // 0=Bounder, 1=Hunter, 2=Shadow Lord maps to palette indices
    const evil = createCharState('sweep');

    evil.birdRig = buildRig(this.scene, buzzardModel, VS, notLit);
    const evilPalette = buildEvilKnightPalette(paletteIndex);
    evil.knightRig = buildRig(this.scene, { ...evilKnightModel, palette: evilPalette }, VS, notLit);
    evil.lanceRig = buildRig(this.scene, lanceModel, VS, notLit);
    this._assembleCharacter(evil, VS);

    evil.positionX = spawnX;
    evil.positionY = spawnY;
    evil.playerState = 'AIRBORNE';
    evil.currentPlatform = null;
    evil.enemyType = enemyType;
    evil.ai = new EnemyAI(enemyType);

    if (evil.birdRig.root) {
      evil.birdRig.root.position = new Vector3(evil.positionX, evil.positionY, 0);
    }

    this._chars.push(evil);

    // Start materialization
    this._setCharAlpha(evil, 0);
    this._createMaterializeParticles(evil);
  }

  // ---- Wave system ----

  _startWave(waveNumber) {
    this._waveNumber = waveNumber;
    this._eggsCollectedThisWave = 0;
    this._playerDiedThisWave = false;
    this._waveState = 'SPAWNING';

    const composition = getWaveComposition(waveNumber);

    // Build a spawn queue: list of enemy types to spawn in groups of 2
    this._spawnQueue = [];
    for (let i = 0; i < composition.bounders; i++) {
      this._spawnQueue.push(ENEMY_TYPE_BOUNDER);
    }
    for (let i = 0; i < composition.hunters; i++) {
      this._spawnQueue.push(ENEMY_TYPE_HUNTER);
    }
    for (let i = 0; i < composition.shadowLords; i++) {
      this._spawnQueue.push(ENEMY_TYPE_SHADOW_LORD);
    }

    // Shuffle the queue so types are mixed
    for (let i = this._spawnQueue.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const temp = this._spawnQueue[i];
      this._spawnQueue[i] = this._spawnQueue[j];
      this._spawnQueue[j] = temp;
    }

    // Spawn first group immediately
    this._spawnTimer = 0;
    this._spawnNextGroup();

    // Show wave banner
    this._showBanner('WAVE ' + waveNumber, WAVE_TRANSITION_DELAY, null);
  }

  _spawnNextGroup() {
    if (this._spawnQueue.length === 0) {
      this._waveState = 'PLAYING';
      return;
    }

    // Spawn up to 2 enemies from the queue
    const spawnCount = Math.min(2, this._spawnQueue.length);
    const shuffledSpawns = [...ENEMY_SPAWN_POINTS].sort(() => Math.random() - 0.5);

    for (let i = 0; i < spawnCount; i++) {
      const enemyType = this._spawnQueue.shift();
      const sp = shuffledSpawns[i % shuffledSpawns.length];
      this._spawnEnemy(enemyType, sp.x, sp.y);
    }
  }

  _updateWaveSystem(dt) {
    if (this._gameOverActive) {
      return;
    }

    // Handle spawn timing
    if (this._waveState === 'SPAWNING' && this._spawnQueue.length > 0) {
      this._spawnTimer += dt;
      if (this._spawnTimer >= SPAWN_GROUP_INTERVAL) {
        this._spawnTimer = 0;
        this._spawnNextGroup();
      }
    }

    // Check wave completion
    if (this._waveState === 'PLAYING' || (this._waveState === 'SPAWNING' && this._spawnQueue.length === 0)) {
      this._waveState = 'PLAYING';

      // Count living enemies (indices > 0)
      let livingEnemies = 0;
      for (let i = 1; i < this._chars.length; i++) {
        const char = this._chars[i];
        if (char && !char.dead) {
          livingEnemies++;
        }
      }

      // Count eggs that could still hatch (enemy eggs only)
      let activeEggs = 0;
      for (const egg of this._eggs) {
        if (egg.enemyType >= 0) {
          activeEggs++;
        }
      }

      if (livingEnemies === 0 && activeEggs === 0) {
        // Wave complete!
        this._waveState = 'TRANSITION';
        this._waveTransitionTimer = WAVE_TRANSITION_DELAY;

        // Survival bonus if player didn't die
        if (!this._playerDiedThisWave) {
          this._addScore(POINTS_SURVIVAL_WAVE);
          this._showBanner('SURVIVAL BONUS!', 1.5, null);
        }

        // Clean up dead enemy slots
        this._chars = [this._chars[0]];
      }
    }

    // Handle wave transition delay
    if (this._waveState === 'TRANSITION') {
      this._waveTransitionTimer -= dt;
      if (this._waveTransitionTimer <= 0) {
        this._startWave(this._waveNumber + 1);
      }
    }
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

    const ps = new ParticleSystem('materialize', 150, this.scene);
    ps.particleTexture = tex;
    ps.emitter = new Vector3(char.positionX, char.positionY, 0);

    // Start with character-sized emit box
    ps.minEmitBox = new Vector3(-0.7, -0.7, -0.3);
    ps.maxEmitBox = new Vector3(0.7, 0.7, 0.3);

    ps.direction1 = new Vector3(-0.5, -0.5, 0);
    ps.direction2 = new Vector3(0.5, 0.5, 0);
    ps.gravity = new Vector3(0, 0, 0);

    ps.minSize = 0.04;
    ps.maxSize = 0.08;
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
      const boxSizeX = 0.7 - phase1Progress * 0.6;
      const boxSizeY = 1.0 - phase1Progress * 0.9;

      if (ps) {
        ps.minEmitBox.x = -boxSizeX;
        ps.minEmitBox.y = -boxSizeY;
        ps.maxEmitBox.x = boxSizeX;
        ps.maxEmitBox.y = boxSizeY;
        ps.emitRate = 20 + phase1Progress * 130;
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
      : { left: false, right: false, flap: false, escape: false };

    // Escape overlay toggle
    if (input.escape) {
      this._toggleEscapeOverlay();
    }

    // Sky background update
    if (this._skyBackground) {
      this._skyBackground.update(dt);
      this._modulateLighting(this._skyBackground.timeOfDay);
    }

    // Lava animation
    this._animateLava(dt);

    // Update each character
    for (let i = 0; i < this._chars.length; i++) {
      const char = this._chars[i];
      if (!char) {
        continue;
      }

      // Respawn timer for dead characters
      if (char.dead) {
        if (!this._gameOverActive) {
          char.respawnTimer -= dt;
          if (char.respawnTimer <= 0) {
            this._respawnCharacter(char, i);
          }
        }
        continue;
      }

      // Materialization update (runs before physics)
      this._updateMaterialization(dt, char);

      if (char.materializing) {
        // Quick-end: any input from player accelerates materialization
        if (i === 0 && !char.materializeQuickEnd) {
          if (input.left || input.right || input.flap) {
            char.materializeQuickEnd = true;
            char.materializeDuration = char.materializeTimer + MATERIALIZE_QUICK_DURATION;
          }
        }
        continue;
      }

      // Invincibility timer
      if (char.invincible) {
        char.invincibleTimer -= dt;
        const hasInput = i === 0 &&
          (input.left || input.right || input.flap);
        if (hasInput || char.invincibleTimer <= 0) {
          char.invincible = false;
          char.invincibleTimer = 0;
        }
      }

      // Joust cooldown tick
      if (char.joustCooldown > 0) {
        char.joustCooldown -= dt;
      }

      // Save pre-movement position for crossing detection
      char.prevPositionX = char.positionX;
      char.prevPositionY = char.positionY;

      if (i === 0) {
        this._updateCharWithInput(dt, char, input);
      } else if (char.ai) {
        // AI-controlled enemy
        const player = this._chars[0];
        const playerTarget = (player && !player.dead && !player.materializing) ? player : null;
        const aiInput = char.ai.decide(char, playerTarget, this._orthoBottom, dt);
        this._updateCharWithInput(dt, char, aiInput);
      } else {
        this._updateCharIdle(dt, char);
      }

      // Check if character hit lava this frame
      if (char.hitLava) {
        char.hitLava = false;
        this._lavaDeath(char, i);
        continue;
      }

      this._animateChar(dt, char);
    }

    // Joust collision between characters (after positions updated)
    this._checkJoustCollisions();

    // Update eggs
    this._updateEggs(dt);

    // Wave system
    this._updateWaveSystem(dt);

    // HUD + banner
    this._updateHUD();
    this._updateBanner(dt);
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
    const prevX = char.positionX;
    const prevY = char.positionY;

    char.positionX += char.velocityX * dt;
    char.positionY += char.velocityY * dt;

    // Platform collision detection
    this._checkPlatformCollisions(char, prevX, prevY);

    // Ceiling clamp
    if (char.positionY > this._orthoTop - HEAD_OFFSET - 0.1) {
      char.positionY = this._orthoTop - HEAD_OFFSET - 0.1;
      char.velocityY = 0;
    }

    // Lava kill zone
    if (char.positionY < this._orthoBottom + 1.0) {
      char.hitLava = true;
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

  _checkPlatformCollisions(char, prevX, prevY) {
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

    // Side collision: horizontal blocking against platform edges
    const currentFeetY = char.positionY - FEET_OFFSET;
    const currentHeadY = char.positionY + HEAD_OFFSET;
    const prevCharLeft = prevX - CHAR_HALF_WIDTH;
    const prevCharRight = prevX + CHAR_HALF_WIDTH;

    for (const plat of this._platforms) {
      // Vertical extent must overlap the platform body
      if (currentFeetY >= plat.top || currentHeadY <= plat.bottom) {
        continue;
      }

      // Moving right into left edge of platform
      if (prevCharRight <= plat.left && charRight > plat.left) {
        char.positionX = plat.left - CHAR_HALF_WIDTH;
        char.velocityX = 0;
      }
      // Moving left into right edge of platform
      if (prevCharLeft >= plat.right && charLeft < plat.right) {
        char.positionX = plat.right + CHAR_HALF_WIDTH;
        char.velocityX = 0;
      }
    }
  }

  _checkJoustCollisions() {
    // Check every unique pair of characters
    for (let a = 0; a < this._chars.length; a++) {
      for (let b = a + 1; b < this._chars.length; b++) {
        this._checkJoustPair(a, b);
      }
    }
  }

  _checkJoustPair(idxA, idxB) {
    const charA = this._chars[idxA];
    const charB = this._chars[idxB];

    if (!charA || !charB) {
      return;
    }

    // Skip if either is dead, materializing, invincible, or in joust cooldown
    if (charA.dead || charB.dead) {
      return;
    }
    if (charA.materializing || charB.materializing) {
      return;
    }
    if (charA.invincible || charB.invincible) {
      return;
    }
    if (charA.joustCooldown > 0 || charB.joustCooldown > 0) {
      return;
    }

    // Standard AABB overlap check
    const aLeft = charA.positionX - CHAR_HALF_WIDTH;
    const aRight = charA.positionX + CHAR_HALF_WIDTH;
    const aFeet = charA.positionY - FEET_OFFSET;
    const aHead = charA.positionY + HEAD_OFFSET;

    const bLeft = charB.positionX - CHAR_HALF_WIDTH;
    const bRight = charB.positionX + CHAR_HALF_WIDTH;
    const bFeet = charB.positionY - FEET_OFFSET;
    const bHead = charB.positionY + HEAD_OFFSET;

    let collided = !(aRight < bLeft || aLeft > bRight || aHead < bFeet || aFeet > bHead);

    // Crossing detection: catch tunneling when characters pass through each
    // other in a single frame.
    if (!collided) {
      const prevRelX = charA.prevPositionX - charB.prevPositionX;
      const currRelX = charA.positionX - charB.positionX;
      const signFlipped = (prevRelX > 0 && currRelX < 0) || (prevRelX < 0 && currRelX > 0);

      if (signFlipped) {
        const aDeltaX = Math.abs(charA.positionX - charA.prevPositionX);
        const bDeltaX = Math.abs(charB.positionX - charB.prevPositionX);
        const noWrap = aDeltaX < ORTHO_WIDTH / 2 && bDeltaX < ORTHO_WIDTH / 2;

        if (noWrap) {
          const aMinY = Math.min(charA.positionY, charA.prevPositionY) - FEET_OFFSET;
          const aMaxY = Math.max(charA.positionY, charA.prevPositionY) + HEAD_OFFSET;
          const bMinY = Math.min(charB.positionY, charB.prevPositionY) - FEET_OFFSET;
          const bMaxY = Math.max(charB.positionY, charB.prevPositionY) + HEAD_OFFSET;
          collided = aMaxY > bMinY && aMinY < bMaxY;
        }
      }
    }

    if (!collided) {
      return;
    }

    // Collision detected — compare heights
    const heightDiff = charA.positionY - charB.positionY;
    const pushA = charA.positionX <= charB.positionX ? -1 : 1;

    if (Math.abs(heightDiff) < JOUST_HEIGHT_DEADZONE) {
      // Deadzone — both bounce apart, no winner
      const overlap = CHAR_HALF_WIDTH * 2 - Math.abs(charA.positionX - charB.positionX);
      if (overlap > 0) {
        charA.positionX += pushA * (overlap / 2 + 0.01);
        charB.positionX += -pushA * (overlap / 2 + 0.01);
      }

      const bothGrounded = charA.playerState === 'GROUNDED' && charB.playerState === 'GROUNDED';
      if (bothGrounded) {
        charA.velocityX = pushA * JOUST_KNOCKBACK_X * 0.5;
        charB.velocityX = -pushA * JOUST_KNOCKBACK_X * 0.5;
      } else {
        charA.velocityX = pushA * JOUST_KNOCKBACK_X;
        charA.velocityY = JOUST_KNOCKBACK_Y;
        charA.playerState = 'AIRBORNE';
        charA.currentPlatform = null;

        charB.velocityX = -pushA * JOUST_KNOCKBACK_X;
        charB.velocityY = JOUST_KNOCKBACK_Y;
        charB.playerState = 'AIRBORNE';
        charB.currentPlatform = null;
      }

      this._startTurn(charA, pushA);
      this._startTurn(charB, -pushA);

      charA.joustCooldown = 0.15;
      charB.joustCooldown = 0.15;
    } else {
      // Higher character wins
      const winner = heightDiff > 0 ? charA : charB;
      const loser = heightDiff > 0 ? charB : charA;
      const loserIdx = heightDiff > 0 ? idxB : idxA;
      const loserKnockDir = winner.positionX < loser.positionX ? 1 : -1;

      winner.velocityY = JOUST_KNOCKBACK_Y;
      winner.velocityX = loserKnockDir * -JOUST_KNOCKBACK_X * 0.3;
      winner.playerState = 'AIRBORNE';
      winner.currentPlatform = null;

      this._killCharacter(loser, loserIdx, loserKnockDir);
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

  // ---- Escape overlay ----

  _toggleEscapeOverlay() {
    if (this._escapeVisible) {
      this._hideEscapeOverlay();
    } else {
      this._showEscapeOverlay();
    }
  }

  _showEscapeOverlay() {
    if (this._escapeVisible || !this.scene) {
      return;
    }
    this._escapeVisible = true;

    // Lazy-import GUI to avoid bundling when not needed
    import('@babylonjs/gui/2D/advancedDynamicTexture').then(({ AdvancedDynamicTexture }) => {
      import('@babylonjs/gui/2D/controls').then(({ Rectangle, TextBlock, StackPanel, Button }) => {
        if (!this._escapeVisible || !this.scene) {
          return;
        }

        const ui = AdvancedDynamicTexture.CreateFullscreenUI('escapeUI', true, this.scene);
        this._escapeOverlay = ui;

        // Semi-transparent background
        const bg = new Rectangle('escapeBg');
        bg.width = 1;
        bg.height = 1;
        bg.background = 'rgba(0, 0, 0, 0.6)';
        bg.thickness = 0;
        ui.addControl(bg);

        // Center panel
        const panel = new StackPanel('escapePanel');
        panel.width = '300px';
        panel.verticalAlignment = 1; // center
        bg.addControl(panel);

        // Title
        const title = new TextBlock('escapeTitle', 'PAUSED');
        title.color = '#FFD700';
        title.fontSize = 36;
        title.fontFamily = 'monospace';
        title.height = '60px';
        panel.addControl(title);

        // Resume button
        const resumeBtn = Button.CreateSimpleButton('resumeBtn', 'Resume');
        resumeBtn.width = '200px';
        resumeBtn.height = '50px';
        resumeBtn.color = 'white';
        resumeBtn.background = '#444';
        resumeBtn.cornerRadius = 8;
        resumeBtn.fontSize = 20;
        resumeBtn.fontFamily = 'monospace';
        resumeBtn.paddingTop = '10px';
        resumeBtn.onPointerUpObservable.add(() => {
          this._hideEscapeOverlay();
        });
        panel.addControl(resumeBtn);

        // Quit button
        const quitBtn = Button.CreateSimpleButton('quitBtn', 'Quit to Menu');
        quitBtn.width = '200px';
        quitBtn.height = '50px';
        quitBtn.color = 'white';
        quitBtn.background = '#822';
        quitBtn.cornerRadius = 8;
        quitBtn.fontSize = 20;
        quitBtn.fontFamily = 'monospace';
        quitBtn.paddingTop = '10px';
        quitBtn.onPointerUpObservable.add(() => {
          this._hideEscapeOverlay();
          if (this._onQuitToMenu) {
            this._onQuitToMenu();
          }
        });
        panel.addControl(quitBtn);
      });
    });
  }

  _hideEscapeOverlay() {
    this._escapeVisible = false;
    if (this._escapeOverlay) {
      this._escapeOverlay.dispose();
      this._escapeOverlay = null;
    }
  }

  // ---- HUD ----

  _createHUD() {
    import('@babylonjs/gui/2D/advancedDynamicTexture').then(({ AdvancedDynamicTexture }) => {
      import('@babylonjs/gui/2D/controls').then(({ TextBlock }) => {
        if (!this.scene) {
          return;
        }

        const ui = AdvancedDynamicTexture.CreateFullscreenUI('hud', true, this.scene);
        this._hudUI = ui;

        // Score — top right
        const scoreText = new TextBlock('score', '000000');
        scoreText.color = '#FFFFFF';
        scoreText.fontSize = 28;
        scoreText.fontFamily = 'monospace';
        scoreText.textHorizontalAlignment = 1; // right
        scoreText.textVerticalAlignment = 0; // top
        scoreText.top = '10px';
        scoreText.left = '-15px';
        scoreText.horizontalAlignment = 1; // right
        scoreText.verticalAlignment = 0; // top
        ui.addControl(scoreText);
        this._hudScoreText = scoreText;

        // Lives — top left
        const livesText = new TextBlock('lives', 'x' + this._lives);
        livesText.color = '#FFFFFF';
        livesText.fontSize = 28;
        livesText.fontFamily = 'monospace';
        livesText.textHorizontalAlignment = 0; // left
        livesText.textVerticalAlignment = 0; // top
        livesText.top = '10px';
        livesText.left = '15px';
        livesText.horizontalAlignment = 0; // left
        livesText.verticalAlignment = 0; // top
        ui.addControl(livesText);
        this._hudLivesText = livesText;

        // Wave — top center
        const waveText = new TextBlock('wave', 'WAVE 1');
        waveText.color = '#FFD700';
        waveText.fontSize = 22;
        waveText.fontFamily = 'monospace';
        waveText.textHorizontalAlignment = 2; // center
        waveText.textVerticalAlignment = 0; // top
        waveText.top = '10px';
        waveText.horizontalAlignment = 2; // center
        waveText.verticalAlignment = 0; // top
        ui.addControl(waveText);
        this._hudWaveText = waveText;

        // Center banner (for WAVE X, GAME OVER text)
        const banner = new TextBlock('banner', '');
        banner.color = '#FFD700';
        banner.fontSize = 48;
        banner.fontFamily = 'monospace';
        banner.textHorizontalAlignment = 2;
        banner.textVerticalAlignment = 2;
        banner.alpha = 0;
        ui.addControl(banner);
        this._hudBannerText = banner;
      });
    });
  }

  _updateHUD() {
    if (this._hudScoreText) {
      this._hudScoreText.text = String(this._score).padStart(6, '0');
    }
    if (this._hudLivesText) {
      this._hudLivesText.text = 'x' + this._lives;
    }
    if (this._hudWaveText) {
      this._hudWaveText.text = 'WAVE ' + this._waveNumber;
    }
  }

  _addScore(points) {
    if (this._gameOverActive) {
      return;
    }
    this._score += points;

    // Extra life check
    if (this._score >= this._nextLifeScore) {
      this._lives += 1;
      this._nextLifeScore += EXTRA_LIFE_THRESHOLD;
    }

    this._updateHUD();
  }

  _showBanner(text, duration, callback) {
    if (!this._hudBannerText) {
      if (callback) {
        setTimeout(callback, duration * 1000);
      }
      return;
    }
    this._hudBannerText.text = text;
    this._hudBannerText.alpha = 1;
    this._waveBannerActive = true;
    this._waveTextTimer = duration;
    this._bannerCallback = callback || null;
  }

  _updateBanner(dt) {
    if (!this._waveBannerActive) {
      return;
    }
    this._waveTextTimer -= dt;
    // Fade out in last 0.5s
    if (this._waveTextTimer < 0.5 && this._hudBannerText) {
      this._hudBannerText.alpha = Math.max(0, this._waveTextTimer / 0.5);
    }
    if (this._waveTextTimer <= 0) {
      this._waveBannerActive = false;
      if (this._hudBannerText) {
        this._hudBannerText.alpha = 0;
      }
      if (this._bannerCallback) {
        this._bannerCallback();
        this._bannerCallback = null;
      }
    }
  }

  _gameOver() {
    this._gameOverActive = true;
    this._showBanner('GAME OVER', 3, () => {
      if (this._onQuitToMenu) {
        this._onQuitToMenu();
      }
    });
  }

  // ---- Death / Explosion / Egg ----

  _killCharacter(char, charIdx, knockDir) {
    char.dead = true;
    char.respawnTimer = RESPAWN_DELAY;

    // Spawn egg at character position with their velocity
    const enemyType = charIdx > 0 ? (char.enemyType !== undefined ? char.enemyType : ENEMY_TYPE_BOUNDER) : -1;
    this._spawnEgg(char.positionX, char.positionY, char.velocityX + knockDir * 2, char.velocityY, enemyType);

    // Award kill points to player when they kill an enemy
    if (charIdx > 0) {
      this._addScore(getKillPoints(enemyType));
    }

    // Player death: decrement lives
    if (charIdx === 0) {
      this._lives -= 1;
      this._playerDiedThisWave = true;
      if (this._lives <= 0) {
        this._lives = 0;
        // Explode but don't respawn — game over
        this._explodeCharacter(char, charIdx);
        this._disposeCharMeshes(char);
        this._updateHUD();
        this._gameOver();
        return;
      }
    }

    // Explode character into voxel debris (cosmetic only)
    this._explodeCharacter(char, charIdx);

    // Hide the character meshes
    this._disposeCharMeshes(char);
  }

  _lavaDeath(char, charIdx) {
    char.dead = true;
    char.respawnTimer = RESPAWN_DELAY;

    // Player death: decrement lives
    if (charIdx === 0) {
      this._lives -= 1;
      this._playerDiedThisWave = true;
      if (this._lives <= 0) {
        this._lives = 0;
        this._explodeCharacter(char, charIdx);
        this._spawnLavaBurst();
        this._disposeCharMeshes(char);
        this._updateHUD();
        this._gameOver();
        return;
      }
    }

    // Explode into lava — no egg
    this._explodeCharacter(char, charIdx);
    this._spawnLavaBurst();

    // Hide the character meshes
    this._disposeCharMeshes(char);
  }

  _respawnCharacter(char, charIdx) {
    // Enemies don't respawn — they become eggs/hatch via wave system
    if (charIdx > 0) {
      return;
    }

    // Pick a random spawn point not occupied by another character
    const occupiedFilter = 1.5;
    const available = SPAWN_POINTS.filter(sp => {
      for (let i = 0; i < this._chars.length; i++) {
        if (i === charIdx) {
          continue;
        }
        const other = this._chars[i];
        if (other && !other.dead) {
          const dist = Math.abs(other.positionX - sp.x);
          if (dist < occupiedFilter) {
            return false;
          }
        }
      }
      return true;
    });

    const spawn = available.length > 0
      ? available[Math.floor(Math.random() * available.length)]
      : SPAWN_POINTS[Math.floor(Math.random() * SPAWN_POINTS.length)];

    const platform = this._platforms.find(p => p.id === spawn.platformId);

    // Rebuild player character meshes
    const VS = VOXEL_SIZE;
    const notLit = true;

    char.wingMode = 'updown';
    char.birdRig = buildRig(this.scene, ostrichModel, VS, notLit);
    const mergedPalette = buildKnightPalette(this._paletteIndex);
    char.knightRig = buildRig(this.scene, { ...knightModel, palette: mergedPalette }, VS, notLit);
    char.lanceRig = buildRig(this.scene, lanceModel, VS, notLit);

    this._assembleCharacter(char, VS);

    // Reset state
    char.positionX = spawn.x;
    char.positionY = platform.top + FEET_OFFSET;
    char.velocityX = 0;
    char.velocityY = 0;
    char.playerState = 'GROUNDED';
    char.currentPlatform = platform;
    char.facingDir = 1;
    char.isTurning = false;
    char.turnTimer = 0;
    char.stridePhase = 0;
    char.isFlapping = false;
    char.flapTimer = 0;
    char.dead = false;
    char.respawnTimer = 0;
    char.invincible = true;
    char.invincibleTimer = INVINCIBLE_DURATION;

    // Start materialization
    char.materializing = true;
    char.materializeTimer = 0;
    char.materializeDuration = MATERIALIZE_DURATION;
    char.materializeQuickEnd = false;

    if (char.birdRig.root) {
      char.birdRig.root.position = new Vector3(char.positionX, char.positionY, 0);
    }

    this._setCharAlpha(char, 0);
    this._createMaterializeParticles(char);
  }

  _explodeCharacter(char, charIdx) {
    // Determine the correct model definitions and palettes for each rig
    const birdModel = char.wingMode === 'updown' ? ostrichModel : buzzardModel;
    let knightPalette;
    let knightModelDef;
    if (charIdx === 0) {
      knightModelDef = knightModel;
      knightPalette = buildKnightPalette(this._paletteIndex);
    } else {
      knightModelDef = evilKnightModel;
      const paletteIdx = char.enemyType !== undefined ? char.enemyType : ENEMY_TYPE_BOUNDER;
      knightPalette = buildEvilKnightPalette(paletteIdx);
    }

    const rigSources = [
      { rig: char.birdRig, modelDef: birdModel, palette: birdModel.palette },
      { rig: char.knightRig, modelDef: knightModelDef, palette: knightPalette },
      { rig: char.lanceRig, modelDef: lanceModel, palette: lanceModel.palette },
    ];

    // Collect voxel positions grouped by hex color
    const byColor = {};

    for (const { rig, modelDef, palette } of rigSources) {
      if (!rig) {
        continue;
      }

      for (const [partName, partData] of Object.entries(modelDef.parts)) {
        if (!rig.parts[partName] || !rig.parts[partName].mesh) {
          continue;
        }

        const { layers } = partData;
        if (!layers || layers.length === 0) {
          continue;
        }

        const worldPos = rig.parts[partName].mesh.getAbsolutePosition();
        const height = layers.length;
        const depth = layers[0].length;
        const width = layers[0][0].length;
        const centerX = (width - 1) / 2;
        const centerZ = (depth - 1) / 2;

        for (let y = 0; y < height; y++) {
          for (let z = 0; z < depth; z++) {
            for (let x = 0; x < width; x++) {
              const colorIndex = layers[y][z][x];
              if (colorIndex === 0) {
                continue;
              }

              const hex = palette[colorIndex];
              if (!hex) {
                continue;
              }

              if (!byColor[hex]) {
                byColor[hex] = [];
              }
              byColor[hex].push({
                wx: worldPos.x + (x - centerX) * VOXEL_SIZE,
                wy: worldPos.y + y * VOXEL_SIZE,
                wz: worldPos.z + (z - centerZ) * VOXEL_SIZE,
              });
            }
          }
        }
      }
    }

    // One parent mesh per unique color; instances for each voxel of that color.
    // Instances share geometry — avoids creating hundreds of individual box meshes.
    const parentMeshes = [];
    const allDebris = [];

    for (const [hex, voxels] of Object.entries(byColor)) {
      const parent = MeshBuilder.CreateBox(`debrisP_${hex}`, { size: VOXEL_SIZE }, this.scene);
      const mat = new StandardMaterial(`debrisM_${hex}`, this.scene);
      mat.disableLighting = true;
      mat.emissiveColor = hexToColor3(hex);
      parent.material = mat;
      parent.isVisible = false;
      parentMeshes.push(parent);

      for (const v of voxels) {
        const inst = parent.createInstance('d');
        inst.position.set(v.wx, v.wy, v.wz);
        allDebris.push({
          mesh: inst,
          vx: (Math.random() - 0.5) * 3,
          vy: Math.random() * 2,
          life: 1.2 + Math.random() * 0.5,
        });
      }
    }

    // Single observer updates all debris each frame
    const observer = this.scene.onBeforeRenderObservable.add(() => {
      const frameDt = this.engine.getDeltaTime() / 1000;
      let remaining = 0;

      for (const d of allDebris) {
        if (d.life <= 0) {
          continue;
        }
        remaining++;

        d.vx *= 0.97;
        d.vy -= GRAVITY * frameDt;
        d.mesh.position.x += d.vx * frameDt;
        d.mesh.position.y += d.vy * frameDt;
        d.mesh.rotation.x += 5 * frameDt;
        d.mesh.rotation.z += 3 * frameDt;
        d.life -= frameDt;

        // Scale down in last 0.4s (instances can't fade alpha independently)
        if (d.life < 0.4) {
          const s = Math.max(0, d.life / 0.4);
          d.mesh.scaling.setAll(s);
        }

        if (d.life <= 0) {
          d.mesh.dispose();
        }
      }

      if (remaining === 0) {
        this.scene.onBeforeRenderObservable.remove(observer);
        for (const p of parentMeshes) {
          p.dispose();
        }
      }
    });
  }

  _spawnEgg(x, y, vx, vy, enemyType) {
    const VS = VOXEL_SIZE;
    const rig = buildRig(this.scene, eggModel, VS, true);

    if (rig.root) {
      rig.root.position = new Vector3(x, y, 0);
    }

    this._eggs.push({
      positionX: x,
      positionY: y,
      velocityX: vx,
      velocityY: vy,
      rig,
      onPlatform: false,
      bounceCount: 0,
      enemyType: enemyType !== undefined ? enemyType : ENEMY_TYPE_BOUNDER,
      // Hatching state
      hatchState: 'EGG_FALLING',
      hatchTimer: 0,
    });
  }

  _updateEggs(dt) {
    const lavaY = this._orthoBottom + 1.0;
    const player = this._chars[0];

    for (let i = this._eggs.length - 1; i >= 0; i--) {
      const egg = this._eggs[i];

      // Only apply physics to eggs in falling/platform states
      if (egg.hatchState === 'EGG_FALLING' || egg.hatchState === 'EGG_ON_PLATFORM' || egg.hatchState === 'EGG_WOBBLING') {
        // Gravity
        egg.velocityY -= GRAVITY * dt;
        if (egg.velocityY < -TERMINAL_VELOCITY) {
          egg.velocityY = -TERMINAL_VELOCITY;
        }

        // Friction
        if (egg.onPlatform) {
          if (egg.velocityX > 0) {
            egg.velocityX = Math.max(0, egg.velocityX - FRICTION * dt);
          } else if (egg.velocityX < 0) {
            egg.velocityX = Math.min(0, egg.velocityX + FRICTION * dt);
          }
        }

        egg.positionX += egg.velocityX * dt;
        egg.positionY += egg.velocityY * dt;

        // Platform collision for egg
        const eggRadius = 2 * VOXEL_SIZE;
        const eggFeet = egg.positionY - eggRadius;
        const prevEggFeet = eggFeet - egg.velocityY * dt;
        const wasOnPlatform = egg.onPlatform;
        egg.onPlatform = false;

        if (egg.velocityY <= 0) {
          for (const plat of this._platforms) {
            if (egg.positionX + eggRadius < plat.left || egg.positionX - eggRadius > plat.right) {
              continue;
            }
            if (prevEggFeet >= plat.top && eggFeet < plat.top) {
              egg.positionY = plat.top + eggRadius;
              if (Math.abs(egg.velocityY) > 0.5) {
                egg.velocityY *= -0.5;
                egg.bounceCount += 1;
              } else {
                egg.velocityY = 0;
                egg.onPlatform = true;
                if (egg.hatchState === 'EGG_FALLING') {
                  egg.hatchState = 'EGG_ON_PLATFORM';
                  egg.hatchTimer = 0;
                }
              }
              break;
            }
          }
        }

        // Keep platform state for already-landed eggs
        if (wasOnPlatform && !egg.onPlatform && egg.velocityY === 0) {
          egg.onPlatform = true;
        }

        // Screen wrap
        if (egg.positionX > ORTHO_RIGHT + eggRadius) {
          egg.positionX = ORTHO_LEFT - eggRadius;
        } else if (egg.positionX < ORTHO_LEFT - eggRadius) {
          egg.positionX = ORTHO_RIGHT + eggRadius;
        }

        // Destroy if fallen into lava — with explosion
        if (egg.positionY < lavaY) {
          this._spawnLavaBurst();
          this._disposeEgg(egg);
          this._eggs.splice(i, 1);
          continue;
        }

        // Player-egg collection check
        if (player && !player.dead && !player.materializing) {
          const pLeft = player.positionX - CHAR_HALF_WIDTH;
          const pRight = player.positionX + CHAR_HALF_WIDTH;
          const pFeet = player.positionY - FEET_OFFSET;
          const pHead = player.positionY + HEAD_OFFSET;

          const eLeft = egg.positionX - eggRadius;
          const eRight = egg.positionX + eggRadius;
          const eBottom = egg.positionY - eggRadius;
          const eTop = egg.positionY + eggRadius;

          if (pRight > eLeft && pLeft < eRight && pHead > eBottom && pFeet < eTop) {
            // Collect the egg
            const midAir = !egg.onPlatform;
            const basePoints = getEggPoints(this._eggsCollectedThisWave);
            const bonus = midAir ? POINTS_EGG_MID_AIR : 0;
            this._addScore(basePoints + bonus);
            this._eggsCollectedThisWave += 1;

            // Spawn collection effect
            this._spawnEggCollectEffect(egg.positionX, egg.positionY, player);

            this._disposeEgg(egg);
            this._eggs.splice(i, 1);
            continue;
          }
        }
      }

      // Hatch timer for platform eggs (only enemy eggs hatch)
      if (egg.enemyType >= 0 && (egg.hatchState === 'EGG_ON_PLATFORM' || egg.hatchState === 'EGG_WOBBLING')) {
        egg.hatchTimer += dt;

        // Transition to wobbling
        if (egg.hatchState === 'EGG_ON_PLATFORM' && egg.hatchTimer >= WOBBLE_START) {
          egg.hatchState = 'EGG_WOBBLING';
        }

        // Wobble animation
        if (egg.hatchState === 'EGG_WOBBLING' && egg.rig && egg.rig.root) {
          const wobbleProgress = (egg.hatchTimer - WOBBLE_START) / (HATCH_TIME - WOBBLE_START);
          const amplitude = 0.2 + wobbleProgress * 0.5;
          const frequency = 8 + wobbleProgress * 12;
          egg.rig.root.rotation.z = Math.sin(egg.hatchTimer * frequency) * amplitude;
        }

        // Hatch!
        if (egg.hatchTimer >= HATCH_TIME) {
          this._hatchEgg(egg);
          this._disposeEgg(egg);
          this._eggs.splice(i, 1);
          continue;
        }
      }

      // Update visual position
      if (egg.rig && egg.rig.root) {
        egg.rig.root.position.x = egg.positionX;
        egg.rig.root.position.y = egg.positionY;
      }
    }
  }

  _hatchEgg(egg) {
    // Egg explosion effect — gold particles burst outward
    const tex = new DynamicTexture('hatchTex', 64, this.scene, false);
    const ctx = tex.getContext();
    ctx.clearRect(0, 0, 64, 64);
    const gradient = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    gradient.addColorStop(0, 'rgba(255, 215, 0, 1)');
    gradient.addColorStop(0.5, 'rgba(218, 165, 32, 0.8)');
    gradient.addColorStop(1, 'rgba(184, 134, 11, 0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 64, 64);
    tex.update(false);
    tex.hasAlpha = true;

    const ps = new ParticleSystem('hatchBurst', 30, this.scene);
    ps.particleTexture = tex;
    ps.emitter = new Vector3(egg.positionX, egg.positionY, 0);
    ps.direction1 = new Vector3(-2, 1, 0);
    ps.direction2 = new Vector3(2, 4, 0);
    ps.gravity = new Vector3(0, -4, 0);
    ps.minSize = 0.05;
    ps.maxSize = 0.15;
    ps.minLifeTime = 0.3;
    ps.maxLifeTime = 0.6;
    ps.manualEmitCount = 20;
    ps.color1 = new Color4(1.0, 0.85, 0.2, 1);
    ps.color2 = new Color4(1.0, 0.65, 0.1, 1);
    ps.colorDead = new Color4(0.8, 0.5, 0.0, 0);
    ps.blendMode = ParticleSystem.BLENDMODE_ADD;
    ps.targetStopDuration = 0.2;
    ps.disposeOnStop = true;
    ps.start();

    // Spawn a new enemy at the egg's position
    // Upgrade enemy type after long time on platform (optional — keep same type for now)
    const spawnType = egg.enemyType;
    this._spawnEnemy(spawnType, egg.positionX, egg.positionY + 0.5);
  }

  _disposeEgg(egg) {
    if (egg.rig) {
      if (egg.rig.root) {
        egg.rig.root.dispose();
      }
      for (const part of Object.values(egg.rig.parts)) {
        if (part.mesh) {
          part.mesh.dispose();
        }
      }
    }
  }

  _spawnEggCollectEffect(x, y, player) {
    // Gold sparkle particles that spiral toward the player
    const tex = new DynamicTexture('eggCollectTex', 64, this.scene, false);
    const ctx = tex.getContext();
    ctx.clearRect(0, 0, 64, 64);
    const gradient = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    gradient.addColorStop(0, 'rgba(255, 230, 100, 1)');
    gradient.addColorStop(0.5, 'rgba(255, 200, 50, 0.8)');
    gradient.addColorStop(1, 'rgba(255, 170, 0, 0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 64, 64);
    tex.update(false);
    tex.hasAlpha = true;

    const ps = new ParticleSystem('eggCollect', 40, this.scene);
    ps.particleTexture = tex;
    ps.emitter = new Vector3(x, y, 0);

    ps.minEmitBox = new Vector3(-0.2, -0.2, 0);
    ps.maxEmitBox = new Vector3(0.2, 0.2, 0);

    // Spiral upward
    ps.direction1 = new Vector3(-1, 1, 0);
    ps.direction2 = new Vector3(1, 2, 0);
    ps.gravity = new Vector3(0, 2, 0);

    ps.minSize = 0.04;
    ps.maxSize = 0.12;
    ps.minLifeTime = 0.3;
    ps.maxLifeTime = 0.7;
    ps.emitRate = 60;
    ps.manualEmitCount = 25;

    ps.color1 = new Color4(1.0, 0.9, 0.4, 1);
    ps.color2 = new Color4(1.0, 0.75, 0.2, 1);
    ps.colorDead = new Color4(1.0, 0.6, 0.0, 0);

    ps.blendMode = ParticleSystem.BLENDMODE_ADD;
    ps.targetStopDuration = 0.3;
    ps.disposeOnStop = true;
    ps.start();

    // Brief golden aura on player — boost emissive
    if (player && player.knightRig) {
      const originalEmissives = [];
      for (const part of Object.values(player.knightRig.parts)) {
        if (part.mesh && part.mesh.material) {
          originalEmissives.push({
            mat: part.mesh.material,
            original: part.mesh.material.emissiveColor ? part.mesh.material.emissiveColor.clone() : new Color3(0, 0, 0),
          });
          part.mesh.material.emissiveColor = new Color3(0.8, 0.65, 0.1);
        }
      }

      // Fade back over 0.8s
      let auraTime = 0;
      const auraObs = this.scene.onBeforeRenderObservable.add(() => {
        const frameDt = this.engine.getDeltaTime() / 1000;
        auraTime += frameDt;
        const t = Math.min(auraTime / 0.8, 1);
        for (const entry of originalEmissives) {
          if (entry.mat) {
            entry.mat.emissiveColor = Color3.Lerp(
              new Color3(0.8, 0.65, 0.1),
              entry.original,
              t
            );
          }
        }
        if (t >= 1) {
          this.scene.onBeforeRenderObservable.remove(auraObs);
        }
      });
    }
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
